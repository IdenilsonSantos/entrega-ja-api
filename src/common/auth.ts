import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../infra/redis/redis.module';
import { Role, User, UserStatus } from '../modules/users/user.entity';
import { forbidden } from './errors';

/** O que fica disponível em toda requisição autenticada */
export interface AuthUser {
  id: string;
  role: Role;
  status: UserStatus;
  name: string;
}

export interface JwtPayload {
  sub: string;
  tv: number;
}

const PUBLIC = 'isPublic';
const ROLES = 'roles';
const ALLOW_PENDING = 'allowPending';

/** Rota aberta, sem login */
export const Public = () => SetMetadata(PUBLIC, true);
/** Só estes papéis. ADMIN não passa automaticamente: o admin tem rotas próprias. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
/** Contas PENDING também podem usar (ex.: entregador completando o perfil enquanto espera) */
export const AllowPending = () => SetMetadata(ALLOW_PENDING, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

const cacheKey = (id: string) => `auth:${id}`;
const CACHE_TTL = 60;

/** Chame depois de bloquear, aprovar, trocar papel ou senha: o próximo request relê do banco. */
export const invalidateAuth = (redis: Redis, userId: string) => redis.del(cacheKey(userId));

/**
 * Guard global: valida o token, confere no banco (com cache de 60s no Redis) se a conta
 * continua ativa e se o token não foi revogado, e aplica @Roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly ds: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    // EventSource e o app nativo às vezes não mandam header: aceitamos ?token= só no stream
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.path.endsWith('/events/stream') ? req.query.token : undefined;
    if (!token) throw new UnauthorizedException('Faça login para continuar');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Sessão expirada. Entre de novo');
    }
    const user = await this.load(payload.sub);
    if (!user || user.tv !== payload.tv) throw new UnauthorizedException('Sessão expirada. Entre de novo');
    if (user.status === UserStatus.BLOCKED) throw forbidden(`Conta bloqueada${user.reason ? `: ${user.reason}` : ''}`);
    if (user.status === UserStatus.PENDING && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, targets)) {
      throw forbidden('Sua conta ainda está em análise');
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) throw forbidden();
    req.user = { id: payload.sub, role: user.role, status: user.status, name: user.name } satisfies AuthUser;
    return true;
  }

  private async load(id: string) {
    const cached = await this.redis.get(cacheKey(id));
    if (cached) return JSON.parse(cached) as { role: Role; status: UserStatus; tv: number; name: string; reason: string | null };
    const u = await this.ds.getRepository(User).findOne({ where: { id } });
    if (!u) return null;
    const v = { role: u.role, status: u.status, tv: u.tokenVersion, name: u.name, reason: u.statusReason };
    await this.redis.set(cacheKey(id), JSON.stringify(v), 'EX', CACHE_TTL);
    return v;
  }
}
