import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { runsWorkers } from '../../config';
import { QUEUE } from '../../infra/queue/queues';
import { createRedis } from '../../infra/redis/redis.module';
import { OrdersService } from './orders.service';

/** Automações do pedido (só no worker) */
@Injectable()
export class OrdersWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OrdersWorker');
  private worker?: Worker<{ orderId: string }>;

  constructor(private readonly orders: OrdersService) {}

  onModuleInit() {
    if (!runsWorkers) return;
    this.worker = new Worker<{ orderId: string }>(QUEUE.orders, (job) => (job.name === 'autoReady' ? this.orders.autoReady(job.data.orderId) : Promise.resolve('unknown')), { connection: createRedis(), concurrency: 20 });
    this.worker.on('failed', (job, err) => this.log.warn(`Automação ${job?.id} falhou: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
