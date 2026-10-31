import { Controller, Get, Inject, Module } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../../common/auth';
import { config } from '../../config';
import { EventsService } from '../../infra/events/events.service';
import { REDIS } from '../../infra/redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource, @Inject(REDIS) private readonly redis: Redis, private readonly events: EventsService) {}

  @Public()
  @Get()
  async check() {
    const [db, redis] = await Promise.allSettled([this.ds.query('SELECT 1'), this.redis.ping()]);
    const ok = db.status === 'fulfilled' && redis.status === 'fulfilled';
    return { status: ok ? 'ok' : 'degraded', role: config.role, database: db.status === 'fulfilled', redis: redis.status === 'fulfilled', sseConnections: this.events.connections, uptimeSec: Math.round(process.uptime()) };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
