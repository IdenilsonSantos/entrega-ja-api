import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { runsWorkers } from '../../config';
import { QUEUE } from '../../infra/queue/queues';
import { createRedis } from '../../infra/redis/redis.module';
import type { PushJob } from './notifications.service';
import { PushService } from './push.service';

/** Processa a fila de push (só no worker). Falha de rede tenta de novo com espera crescente. */
@Injectable()
export class PushWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PushWorker');
  private worker?: Worker<PushJob>;

  constructor(private readonly push: PushService) {}

  onModuleInit() {
    if (!runsWorkers) return;
    this.worker = new Worker<PushJob>(QUEUE.push, (job) => this.push.send(job.data), { connection: createRedis(), concurrency: 20 });
    this.worker.on('failed', (job, err) => this.log.warn(`Push ${job?.id} falhou: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
