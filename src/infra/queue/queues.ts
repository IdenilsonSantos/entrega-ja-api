import { Queue } from 'bullmq';
import { createRedis } from '../redis/redis.module';

/**
 * Filas do BullMQ. A API só coloca trabalhos; quem processa é o worker (APP_ROLE=worker).
 *   dispatch → procurar entregador, expirar oferta, tentar de novo
 *   push     → enviar web push e push do Expo
 */
export const QUEUE = { dispatch: 'dispatch', push: 'push' } as const;

export const DISPATCH_QUEUE = Symbol('DISPATCH_QUEUE');
export const PUSH_QUEUE = Symbol('PUSH_QUEUE');

const defaults = { removeOnComplete: 1000, removeOnFail: 1000 };

export const queueProviders = [
  { provide: DISPATCH_QUEUE, useFactory: () => new Queue(QUEUE.dispatch, { connection: createRedis(), defaultJobOptions: defaults }) },
  { provide: PUSH_QUEUE, useFactory: () => new Queue(QUEUE.push, { connection: createRedis(), defaultJobOptions: { ...defaults, attempts: 3, backoff: { type: 'exponential', delay: 2000 } } }) },
];
