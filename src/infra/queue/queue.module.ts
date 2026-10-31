import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DISPATCH_QUEUE, PUSH_QUEUE, queueProviders } from './queues';

@Injectable()
class QueueShutdown implements OnApplicationShutdown {
  constructor(@Inject(DISPATCH_QUEUE) private readonly a: Queue, @Inject(PUSH_QUEUE) private readonly b: Queue) {}
  async onApplicationShutdown() {
    await Promise.allSettled([this.a.close(), this.b.close()]);
  }
}

@Global()
@Module({ providers: [...queueProviders, QueueShutdown], exports: [DISPATCH_QUEUE, PUSH_QUEUE] })
export class QueueModule {}
