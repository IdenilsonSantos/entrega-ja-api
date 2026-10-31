import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { runsWorkers } from '../../config';
import { QUEUE } from '../../infra/queue/queues';
import { createRedis } from '../../infra/redis/redis.module';
import { DispatchJob, DispatchService } from './dispatch.service';

@Injectable()
export class DispatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DispatchWorker');
  private worker?: Worker<DispatchJob>;

  constructor(private readonly dispatch: DispatchService) {}

  onModuleInit() {
    if (!runsWorkers) return;
    this.worker = new Worker<DispatchJob>(QUEUE.dispatch, (job) => this.dispatch.run(job.data), { connection: createRedis(), concurrency: 20 });
    this.worker.on('failed', (job, err) => this.log.error(`Despacho ${job?.id} falhou: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
