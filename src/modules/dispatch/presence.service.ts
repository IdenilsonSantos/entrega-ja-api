import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../../config';
import { REDIS } from '../../infra/redis/redis.module';

const GEO = 'couriers:geo';
const alive = (id: string) => `courier:alive:${id}`;

/**
 * Onde estão os entregadores online (Redis GEO) e quem ainda está mandando sinal.
 * Cada localização renova a chave "alive"; sem sinal por COURIER_PRESENCE_TTL_SEC,
 * o entregador deixa de receber ofertas e sai do mapa.
 */
@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async online(id: string, lat: number, lng: number) {
    await this.redis.multi().geoadd(GEO, lng, lat, id).set(alive(id), '1', 'EX', config.presenceTtlSec).exec();
  }

  async offline(id: string) {
    await this.redis.multi().zrem(GEO, id).del(alive(id)).exec();
  }

  /** Atualiza a posição; devolve false se o entregador não estava online */
  async move(id: string, lat: number, lng: number) {
    const was = await this.redis.exists(alive(id));
    if (!was) return false;
    await this.online(id, lat, lng);
    return true;
  }

  async isOnline(id: string) {
    return (await this.redis.exists(alive(id))) === 1;
  }

  async onlineSet(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const res = await this.redis.pipeline(ids.map((id) => ['exists', alive(id)])).exec();
    return new Set(ids.filter((_, i) => res?.[i]?.[1] === 1));
  }

  async position(id: string) {
    const [pos] = await this.redis.geopos(GEO, id);
    return pos ? { lat: Number(pos[1]), lng: Number(pos[0]) } : null;
  }

  async positions(ids: string[]) {
    if (!ids.length) return new Map<string, { lat: number; lng: number }>();
    const res = await this.redis.geopos(GEO, ...ids);
    const map = new Map<string, { lat: number; lng: number }>();
    res.forEach((p, i) => p && map.set(ids[i], { lat: Number(p[1]), lng: Number(p[0]) }));
    return map;
  }

  /** Entregadores online perto de um ponto, do mais perto para o mais longe */
  async nearby(lat: number, lng: number, radiusKm: number, count = 30) {
    const rows = (await this.redis.geosearch(GEO, 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusKm, 'km', 'ASC', 'COUNT', count, 'WITHDIST')) as [string, string][];
    const live = await this.onlineSet(rows.map((r) => r[0]));
    // quem caiu sem avisar sai do índice
    const stale = rows.filter((r) => !live.has(r[0])).map((r) => r[0]);
    if (stale.length) await this.redis.zrem(GEO, ...stale);
    return rows.filter((r) => live.has(r[0])).map(([id, km]) => ({ id, km: Number(km) }));
  }

  /** Todos os online (mapa do admin) */
  async all() {
    const ids = await this.redis.zrange(GEO, 0, -1);
    const live = await this.onlineSet(ids);
    const pos = await this.positions([...live]);
    return [...pos.entries()].map(([id, p]) => ({ id, ...p }));
  }
}
