import { Controller, Get, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import { Public } from '../../common/auth';
import { SkipRateLimit } from '../../common/rate-limit';
import { config, runsWorkers } from '../../config';
import { EventsService } from '../../infra/events/events.service';
import { DISPATCH_QUEUE, MAIL_QUEUE, PUSH_QUEUE } from '../../infra/queue/queues';
import { REDIS } from '../../infra/redis/redis.module';

/** Workers marcam presença aqui a cada 10 s; quem some por 30 s é dado como parado */
const WORKERS_KEY = 'health:workers';
const BEAT_MS = 10_000;
const DEAD_AFTER_MS = 30_000;

@Injectable()
class WorkerHeartbeat implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly id = `${hostname()}:${process.pid}`;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit() {
    if (!runsWorkers) return;
    const beat = () => this.redis.zadd(WORKERS_KEY, Date.now(), this.id).catch(() => undefined);
    beat();
    this.timer = setInterval(beat, BEAT_MS);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    if (runsWorkers) await this.redis.zrem(WORKERS_KEY, this.id).catch(() => undefined);
  }
}

/**
 * /health/live  → o processo responde (liveness; não olha dependências, para não reiniciar à toa)
 * /health       → pronto para atender: banco e Redis no ar, senão 503 (readiness, usado no deploy)
 * Workers e filas vão junto só como informação: worker parado não deixa a API fora do ar,
 * mas aparece aqui (workers.alive = 0) e as filas acumulam.
 */
@Controller('health')
export class HealthController {
  private readonly queues: [string, Queue][];

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventsService,
    @Inject(DISPATCH_QUEUE) dispatch: Queue,
    @Inject(PUSH_QUEUE) push: Queue,
    @Inject(MAIL_QUEUE) mail: Queue,
  ) {
    this.queues = [['dispatch', dispatch], ['push', push], ['mail', mail]];
  }

  @Public()
  @SkipRateLimit()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }

  @Public()
  @SkipRateLimit()
  @Get()
  async check() {
    const timeout = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
    const [db, redis] = await Promise.allSettled([timeout(this.ds.query('SELECT 1')), timeout(this.redis.ping())]);
    const ok = db.status === 'fulfilled' && redis.status === 'fulfilled';
    const body = {
      status: ok ? 'ok' : 'degraded',
      role: config.role,
      database: db.status === 'fulfilled',
      redis: redis.status === 'fulfilled',
      sseConnections: this.events.connections,
      uptimeSec: Math.round(process.uptime()),
      ...(redis.status === 'fulfilled' && (await this.workersAndQueues().catch(() => ({})))),
    };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }

  private async workersAndQueues() {
    const cutoff = Date.now() - DEAD_AFTER_MS;
    await this.redis.zremrangebyscore(WORKERS_KEY, 0, cutoff);
    const alive = await this.redis.zcard(WORKERS_KEY);
    const counts = await Promise.all(this.queues.map(async ([name, q]) => [name, await q.getJobCounts('waiting', 'active', 'delayed', 'failed')] as const));
    return { workers: { alive }, queues: Object.fromEntries(counts) };
  }
}

@Module({ controllers: [HealthController], providers: [WorkerHeartbeat] })
export class HealthModule {}
