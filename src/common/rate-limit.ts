import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { config } from '../config';
import { REDIS } from '../infra/redis/redis.module';

/** Um limite: no máximo `limit` requisições a cada `windowSec`, contadas por IP ou pelo e-mail do corpo */
export interface Limit {
  name: string;
  limit: number;
  windowSec: number;
  by: 'ip' | 'email';
}

const LIMITS = 'rateLimits';
const SKIP = 'skipRateLimit';

/** Limites próprios da rota, além do geral por IP. Ex.: login por e-mail para segurar força bruta. */
export const RateLimit = (...limits: Limit[]) => SetMetadata(LIMITS, limits);
/** Fora de qualquer limite (healthcheck do orquestrador) */
export const SkipRateLimit = () => SetMetadata(SKIP, true);

const GLOBAL: Omit<Limit, 'limit'> = { name: 'all', windowSec: 60, by: 'ip' };

/**
 * Guard global de janela fixa no Redis, então vale somado entre as réplicas.
 * Passou do limite: 429 com Retry-After. Se o Redis falhar, deixa passar (melhor que derrubar a API).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly log = new Logger('RateLimit');

  constructor(private readonly reflector: Reflector, @Inject(REDIS) private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext) {
    if (!config.rateLimit.enabled) return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const limits = [{ ...GLOBAL, limit: config.rateLimit.perMinute }, ...(this.reflector.getAllAndOverride<Limit[]>(LIMITS, targets) ?? [])];

    let retryAfter = 0;
    try {
      for (const l of limits) {
        const who = l.by === 'ip' ? req.ip : typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;
        if (!who) continue;
        const key = `rl:${l.name}:${l.by}:${who}`;
        const [[, count], , [, ttl]] = (await this.redis.multi().incr(key).expire(key, l.windowSec, 'NX').ttl(key).exec()) as [unknown, number][];
        if (count > l.limit) retryAfter = Math.max(retryAfter, ttl > 0 ? ttl : l.windowSec);
      }
    } catch (e) {
      this.log.warn(`Redis indisponível, requisição liberada: ${(e as Error).message}`);
      return true;
    }
    if (!retryAfter) return true;

    ctx.switchToHttp().getResponse().setHeader('Retry-After', String(retryAfter));
    const wait = retryAfter < 60 ? `${retryAfter} s` : `${Math.ceil(retryAfter / 60)} min`;
    throw new HttpException({ statusCode: 429, message: `Muitas tentativas. Tente de novo em ${wait}`, retryAfterSec: retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
