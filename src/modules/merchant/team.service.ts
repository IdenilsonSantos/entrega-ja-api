import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, IsNull, MoreThan } from 'typeorm';
import { config } from '../../config';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { Store } from '../stores/store.entity';
import { Role, User } from '../users/user.entity';
import { PERMISSIONS, StoreInvite, StoreMember, StoreRole } from './store-member.entity';
import { StoreAccessService } from './store-access.service';

const INVITE_DAYS = 7;
const ROLE_LABEL: Record<StoreRole, string> = { OWNER: 'dono', MANAGER: 'gerente', ATTENDANT: 'atendente' };

/** Quem pode mexer em quem: o dono gerencia todos; o gerente, só os atendentes. */
const canManage = (actor: StoreRole, target: StoreRole) =>
  actor === StoreRole.OWNER ? target !== StoreRole.OWNER : actor === StoreRole.MANAGER && target === StoreRole.ATTENDANT;

@Injectable()
export class TeamService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly access: StoreAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  private members = () => this.ds.getRepository(StoreMember);
  private invites = () => this.ds.getRepository(StoreInvite);

  /** Lojas em que a pessoa trabalha, com o papel e as permissões dela em cada uma */
  async myStores(userId: string) {
    const rows = await this.members().find({ where: { userId }, relations: { store: true }, order: { createdAt: 'ASC' } });
    return rows.map((m) => ({
      id: m.store.id,
      name: m.store.name,
      logoUrl: m.store.logoUrl,
      status: m.store.status,
      statusReason: m.store.statusReason,
      isOpen: m.store.isOpen,
      role: m.role,
      permissions: PERMISSIONS[m.role],
    }));
  }

  async list(userId: string, storeId: string) {
    await this.access.require(userId, storeId, 'team');
    const [members, invites] = await Promise.all([
      this.members().find({ where: { storeId }, relations: { user: true }, order: { createdAt: 'ASC' } }),
      this.invites().find({ where: { storeId, acceptedAt: IsNull(), expiresAt: MoreThan(new Date()) }, order: { createdAt: 'DESC' } }),
    ]);
    return {
      members: members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl, role: m.role, since: m.createdAt })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, link: this.link(i.token) })),
    };
  }

  private link = (token: string) => `${config.appUrl}/convite/${token}`;

  async invite(actorId: string, storeId: string, email: string, role: StoreRole) {
    const { member: actor, store } = await this.access.require(actorId, storeId, 'team');
    if (role === StoreRole.OWNER) throw badRequest('Para passar a loja para outra pessoa, use "Transferir propriedade"');
    if (!canManage(actor.role, role)) throw forbidden(`Como ${ROLE_LABEL[actor.role]}, você não pode convidar um ${ROLE_LABEL[role]}`);
    const existing = await this.ds.getRepository(User).findOneBy({ email });
    if (existing && existing.role !== Role.MERCHANT) throw conflict('Este e-mail já é de uma conta de cliente ou entregador. Peça para a pessoa usar outro e-mail');
    if (existing && (await this.members().exists({ where: { storeId, userId: existing.id } }))) throw conflict('Esta pessoa já faz parte da equipe');
    // um convite aberto por e-mail: convidar de novo renova o link
    await this.invites().delete({ storeId, email, acceptedAt: IsNull() });
    const invite = await this.invites().save(
      this.invites().create({ storeId, email, role, token: randomBytes(24).toString('hex'), invitedById: actorId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) }),
    );
    if (existing) {
      await this.notifications.notify([existing.id], { type: 'team.invite', title: `Convite de ${store.name}`, body: `Você foi convidado para ser ${ROLE_LABEL[role]} da loja.`, link: `/convite/${invite.token}` });
    }
    return { id: invite.id, email, role, expiresAt: invite.expiresAt, link: this.link(invite.token), accountExists: !!existing };
  }

  async revokeInvite(actorId: string, storeId: string, inviteId: string) {
    await this.access.require(actorId, storeId, 'team');
    await this.invites().delete({ id: inviteId, storeId });
    return { ok: true };
  }

  async validInvite(token: string) {
    const inv = await this.invites().findOne({ where: { token }, relations: { store: true } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw badRequest('Convite inválido ou expirado');
    return inv;
  }

  /** Tela pública do convite: "Pizzaria X te convidou para ser atendente" */
  async inviteInfo(token: string) {
    const inv = await this.validInvite(token);
    return {
      storeName: inv.store.name,
      storeLogoUrl: inv.store.logoUrl,
      email: inv.email,
      role: inv.role,
      accountExists: await this.ds.getRepository(User).exists({ where: { email: inv.email } }),
    };
  }

  async acceptByToken(user: { id: string }, token: string) {
    const inv = await this.validInvite(token);
    const u = await this.ds.getRepository(User).findOneByOrFail({ id: user.id });
    return this.accept(inv, u);
  }

  async accept(inv: StoreInvite & { store?: Store }, user: User) {
    if (user.role !== Role.MERCHANT) throw forbidden('Entre com uma conta de lojista para aceitar o convite');
    if (user.email !== inv.email) throw forbidden(`Este convite é para ${inv.email}`);
    await this.ds.transaction(async (m) => {
      const already = await m.exists(StoreMember, { where: { storeId: inv.storeId, userId: user.id } });
      if (!already) await m.insert(StoreMember, { storeId: inv.storeId, userId: user.id, role: inv.role });
      await m.update(StoreInvite, inv.id, { acceptedAt: new Date() });
    });
    const store = inv.store ?? (await this.access.store(inv.storeId));
    await this.notifications.notify([inv.invitedById], { type: 'team.joined', title: 'Convite aceito', body: `${user.name} entrou na equipe de ${store.name} como ${ROLE_LABEL[inv.role]}.`, link: `/loja/${store.id}/equipe` });
    return { storeId: inv.storeId, role: inv.role };
  }

  private async target(storeId: string, memberId: string) {
    const t = await this.members().findOne({ where: { id: memberId, storeId }, relations: { user: true } });
    if (!t) throw notFound('Membro');
    return t;
  }

  async changeRole(actorId: string, storeId: string, memberId: string, role: StoreRole) {
    const { member: actor, store } = await this.access.require(actorId, storeId, 'team');
    const t = await this.target(storeId, memberId);
    if (role === StoreRole.OWNER) throw badRequest('Use "Transferir propriedade"');
    if (t.userId === actorId) throw badRequest('Você não pode mudar o próprio papel');
    if (!canManage(actor.role, t.role) || !canManage(actor.role, role)) throw forbidden();
    await this.members().update(t.id, { role });
    await this.notifications.notify([t.userId], { type: 'team.role', title: store.name, body: `Seu papel agora é ${ROLE_LABEL[role]}.`, link: `/loja/${storeId}` });
    return { ok: true };
  }

  /** Remove alguém da equipe, ou a própria pessoa sai (menos o dono) */
  async remove(actorId: string, storeId: string, memberId: string) {
    const t = await this.target(storeId, memberId);
    if (t.role === StoreRole.OWNER) throw badRequest('O dono não pode sair da loja. Transfira a propriedade antes');
    if (t.userId !== actorId) {
      const { member: actor } = await this.access.require(actorId, storeId, 'team');
      if (!canManage(actor.role, t.role)) throw forbidden();
      const store = await this.access.store(storeId);
      await this.notifications.notify([t.userId], { type: 'team.removed', title: store.name, body: 'Você não faz mais parte da equipe desta loja.' });
    }
    await this.members().delete(t.id);
    return { ok: true };
  }

  async transferOwnership(actorId: string, storeId: string, memberId: string) {
    const { member: actor, store } = await this.access.require(actorId, storeId, 'team.owner');
    const t = await this.target(storeId, memberId);
    if (t.userId === actorId) throw badRequest('Você já é o dono');
    await this.ds.transaction(async (m) => {
      await m.update(StoreMember, actor.id, { role: StoreRole.MANAGER });
      await m.update(StoreMember, t.id, { role: StoreRole.OWNER });
      await m.update(Store, storeId, { ownerId: t.userId });
    });
    await this.notifications.notify([t.userId], { type: 'team.owner', title: store.name, body: `${actor.user?.name ?? 'O dono'} passou a loja para você. Agora você é o dono.`, link: `/loja/${storeId}` });
    return { ok: true };
  }
}
