import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Response } from 'express';
import Redis from 'ioredis';
import { REDIS, REDIS_SUB } from '../redis/redis.module';

/**
 * Tempo real por SSE, funcionando com várias réplicas da API.
 *
 * Cada conexão escuta "salas": a da própria pessoa (u:<id>) e, para o admin, "admins".
 * publish() grava o evento num Redis Stream da sala (para reenviar o que se perdeu numa
 * queda de conexão, via Last-Event-ID) e avisa todas as réplicas por pub/sub. Cada réplica
 * entrega só para as conexões que ela segura.
 *
 * Eventos efêmeros (posição do entregador) não vão para o stream: se perder um, o próximo
 * chega em segundos.
 */
const CHANNEL = 'rt';
const STREAM_MAX = 200;
const streamKey = (room: string) => `rt:${room}`;

export const userRoom = (id: string) => `u:${id}`;
export const ADMIN_ROOM = 'admins';

interface Client {
  res: Response;
  rooms: string[];
}

@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Events');
  private readonly clients = new Set<Client>();
  private heartbeat?: NodeJS.Timeout;

  constructor(@Inject(REDIS) private readonly redis: Redis, @Inject(REDIS_SUB) private readonly sub: Redis) {}

  async onModuleInit() {
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_ch, raw) => {
      const { room, id, event, data } = JSON.parse(raw);
      for (const c of this.clients) if (c.rooms.includes(room)) this.write(c.res, event, data, id);
    });
    // comentário a cada 25s mantém a conexão viva atrás de proxies
    this.heartbeat = setInterval(() => this.clients.forEach((c) => c.res.write(': ping\n\n')), 25_000);
  }

  onModuleDestroy() {
    clearInterval(this.heartbeat);
    this.clients.forEach((c) => c.res.end());
  }

  get connections() {
    return this.clients.size;
  }

  /** Envia um evento para as salas. Sem `ephemeral`, ele fica guardado para reenvio. */
  async publish(rooms: string[], event: string, data: unknown, opts: { ephemeral?: boolean } = {}) {
    const unique = [...new Set(rooms)];
    const pipe = this.redis.pipeline();
    const payload = JSON.stringify({ event, data });
    const ids: (string | null)[] = [];
    if (!opts.ephemeral) {
      for (const room of unique) pipe.xadd(streamKey(room), 'MAXLEN', '~', STREAM_MAX, '*', 'p', payload);
      const res = (await pipe.exec()) ?? [];
      res.forEach(([, id]) => ids.push(id as string));
    }
    const pub = this.redis.pipeline();
    unique.forEach((room, i) => pub.publish(CHANNEL, JSON.stringify({ room, id: ids[i] ?? null, event, data })));
    await pub.exec();
  }

  toUsers(userIds: (string | null | undefined)[], event: string, data: unknown, opts?: { ephemeral?: boolean }) {
    const ids = userIds.filter((x): x is string => !!x);
    return ids.length ? this.publish(ids.map(userRoom), event, data, opts) : Promise.resolve();
  }

  toAdmins(event: string, data: unknown, opts?: { ephemeral?: boolean }) {
    return this.publish([ADMIN_ROOM], event, data, opts);
  }

  /** Abre a conexão SSE e reenvia o que ficou para trás desde lastEventId. */
  async connect(res: Response, rooms: string[], lastEventId?: string) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const client: Client = { res, rooms };
    this.clients.add(client);
    res.on('close', () => this.clients.delete(client));

    // O id do evento é o id do stream da sala pessoal (a primeira); as outras salas não reenviam.
    if (lastEventId && /^\d+-\d+$/.test(lastEventId)) {
      try {
        const missed = await this.redis.xrange(streamKey(rooms[0]), `(${lastEventId}`, '+', 'COUNT', STREAM_MAX);
        for (const [id, fields] of missed) {
          const { event, data } = JSON.parse(fields[1]);
          this.write(res, event, data, id);
        }
      } catch (e) {
        this.log.warn(`Falha ao reenviar eventos: ${(e as Error).message}`);
      }
    }
    this.write(res, 'ready', { at: new Date().toISOString() });
  }

  private write(res: Response, event: string, data: unknown, id?: string | null) {
    res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
