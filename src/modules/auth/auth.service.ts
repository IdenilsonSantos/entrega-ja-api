import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { invalidateAuth } from '../../common/auth';
import { badRequest, conflict, forbidden } from '../../common/errors';
import { config } from '../../config';
import { MailService } from '../../infra/mail/mail.service';
import { REDIS } from '../../infra/redis/redis.module';
import { IMAGE, StorageService } from '../../infra/storage/storage.service';
import { CourierProfile, VehicleType } from '../couriers/courier-profile.entity';
import { TeamService } from '../merchant/team.service';
import { NotificationsService } from '../notifications/notifications.service';
import { publicUser, Role, User, UserStatus } from '../users/user.entity';
import { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto, UpdateMeDto } from './auth.dto';

/**
 * Link de "esqueci minha senha": o token vai só no e-mail; no Redis fica o hash dele, com validade.
 * Cada conta tem no máximo um link valendo: pedir outro invalida o anterior.
 */
const resetKey = (hash: string) => `pwreset:${hash}`;
const resetUserKey = (userId: string) => `pwreset:user:${userId}`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly jwt: JwtService,
    private readonly team: TeamService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private users = () => this.ds.getRepository(User);

  private session(u: User) {
    return { token: this.jwt.sign({ sub: u.id, tv: u.tokenVersion }), user: publicUser(u) };
  }

  async register(dto: RegisterDto) {
    if (await this.users().exists({ where: { email: dto.email } })) throw conflict('Já existe uma conta com este e-mail');
    // Convite de loja: a conta nasce como lojista, com o e-mail do convite
    const invite = dto.inviteToken ? await this.team.validInvite(dto.inviteToken) : null;
    if (invite && invite.email !== dto.email) throw badRequest('Use o mesmo e-mail que recebeu o convite');
    const role = invite ? Role.MERCHANT : dto.role;

    const user = await this.ds.transaction(async (m) => {
      const u = await m.save(
        m.create(User, {
          name: dto.name,
          email: dto.email,
          phone: dto.phone || null,
          passwordHash: await bcrypt.hash(dto.password, 10),
          role,
          // entregador começa em análise; a plataforma confere os dados antes de liberar
          status: role === Role.COURIER ? UserStatus.PENDING : UserStatus.ACTIVE,
        }),
      );
      if (role === Role.COURIER) await m.save(m.create(CourierProfile, { userId: u.id, vehicleType: dto.vehicleType ?? VehicleType.MOTORCYCLE }));
      return u;
    });
    if (invite) await this.team.accept(invite, user);
    if (role === Role.COURIER) {
      await this.notifications.notifyAdmins({ type: 'courier.pending', title: 'Novo entregador para aprovar', body: `${user.name} se cadastrou e aguarda análise.`, link: '/admin/aprovacoes' });
    }
    return this.session(user);
  }

  async login(dto: LoginDto) {
    const u = await this.users().createQueryBuilder('u').addSelect('u.passwordHash').where('u.email = :e', { e: dto.email }).getOne();
    if (!u || !(await bcrypt.compare(dto.password, u.passwordHash))) throw new UnauthorizedException('E-mail ou senha incorretos');
    if (u.status === UserStatus.BLOCKED) throw forbidden(`Conta bloqueada${u.statusReason ? `: ${u.statusReason}` : ''}`);
    return this.session(u);
  }

  /** Conta + o que cada papel precisa logo ao abrir o app */
  async me(id: string) {
    const u = await this.users().findOneByOrFail({ id });
    const extra: Record<string, unknown> = {};
    if (u.role === Role.COURIER) extra.courier = await this.ds.getRepository(CourierProfile).findOneBy({ userId: id });
    if (u.role === Role.MERCHANT) extra.stores = await this.team.myStores(id);
    return { ...publicUser(u), ...extra };
  }

  async update(id: string, dto: UpdateMeDto) {
    await this.users().update(id, { ...(dto.name && { name: dto.name }), ...(dto.phone !== undefined && { phone: dto.phone || null }) });
    await invalidateAuth(this.redis, id);
    return this.me(id);
  }

  /** Troca a senha e derruba as outras sessões (o token atual é reemitido) */
  async changePassword(id: string, dto: ChangePasswordDto) {
    const u = await this.users().createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id }).getOneOrFail();
    if (!(await bcrypt.compare(dto.current, u.passwordHash))) throw badRequest('Senha atual incorreta');
    u.passwordHash = await bcrypt.hash(dto.next, 10);
    u.tokenVersion += 1;
    await this.users().save(u);
    await invalidateAuth(this.redis, id);
    await this.mail.passwordChanged(u.email, u.name);
    return this.session(u);
  }

  async forgotPassword(email: string) {
    const u = await this.users().findOneBy({ email });
    // conta bloqueada não recupera acesso por aqui; a resposta é a mesma para não dar pista
    if (u && u.status !== UserStatus.BLOCKED) {
      const token = randomBytes(32).toString('base64url');
      const hash = sha256(token);
      const ttl = config.passwordResetTtlMin * 60;
      const previous = await this.redis.getset(resetUserKey(u.id), hash);
      await this.redis.multi().expire(resetUserKey(u.id), ttl).set(resetKey(hash), u.id, 'EX', ttl).exec();
      if (previous) await this.redis.del(resetKey(previous));
      await this.mail.passwordReset(u.email, u.name, `${config.appUrl}/redefinir-senha/${token}`);
    }
    return { message: 'Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.' };
  }

  /** Dono do link, se ele ainda vale */
  private async resetOwner(token: string) {
    const hash = sha256(token);
    const userId = await this.redis.get(resetKey(hash));
    if (!userId || (await this.redis.get(resetUserKey(userId))) !== hash) throw badRequest('Este link expirou ou já foi usado. Peça um novo.');
    return { userId, hash };
  }

  async checkResetToken(token: string) {
    const { userId } = await this.resetOwner(token);
    const u = await this.users().findOneByOrFail({ id: userId });
    // e-mail mascarado: confirma a conta sem expor o endereço a quem pegar o link
    const [name, domain] = u.email.split('@');
    return { email: `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 1))}@${domain}` };
  }

  /** Troca a senha pelo link, encerra todas as sessões e já entra com a senha nova */
  async resetPassword(dto: ResetPasswordDto) {
    const { userId, hash } = await this.resetOwner(dto.token);
    // DEL é atômico: com dois envios ao mesmo tempo, só um apaga a chave e segue
    if (!(await this.redis.del(resetKey(hash)))) throw badRequest('Este link expirou ou já foi usado. Peça um novo.');
    await this.redis.del(resetUserKey(userId));
    const u = await this.users().createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: userId }).getOneOrFail();
    if (u.status === UserStatus.BLOCKED) throw forbidden(`Conta bloqueada${u.statusReason ? `: ${u.statusReason}` : ''}`);
    u.passwordHash = await bcrypt.hash(dto.password, 10);
    u.tokenVersion += 1;
    await this.users().save(u);
    await invalidateAuth(this.redis, u.id);
    await this.mail.passwordChanged(u.email, u.name);
    return this.session(u);
  }

  async avatar(id: string, file?: Express.Multer.File) {
    const url = await this.storage.saveImage(file, IMAGE.avatar);
    const u = await this.users().findOneByOrFail({ id });
    await this.storage.remove(u.avatarUrl);
    await this.users().update(id, { avatarUrl: url });
    return { avatarUrl: url };
  }
}
