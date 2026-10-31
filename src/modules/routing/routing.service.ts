import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../../config';
import { distanceKm, round } from '../../common/geo';
import { REDIS } from '../../infra/redis/redis.module';

export type Profile = 'driving' | 'cycling' | 'walking';
export interface Point {
  lat: number;
  lng: number;
}
export interface Route {
  /** [lat, lng] do início ao fim, seguindo as ruas */
  coordinates: [number, number][];
  distanceKm: number;
  durationMin: number;
  /** de onde veio: o serviço de rotas ou a reserva em linha reta */
  source: 'osrm' | 'mapbox' | 'straight';
}

/** Velocidade média usada quando não há serviço de rotas */
const FALLBACK_KMH: Record<Profile, number> = { driving: 22, cycling: 14, walking: 5 };
const CACHE_TTL = 600;
/** ~11 m: pontos tão próximos usam a mesma rota em cache */
const key = (p: Profile, a: Point, b: Point) => `route:${p}:${a.lat.toFixed(4)},${a.lng.toFixed(4)}:${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

/**
 * Melhor caminho entre dois pontos. Fica atrás da API (e não no navegador) para:
 * guardar em cache, trocar de provedor sem mexer no app e não expor chaves.
 */
@Injectable()
export class RoutingService {
  private readonly log = new Logger('Routing');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async route(from: Point, to: Point, profile: Profile = 'driving'): Promise<Route> {
    const k = key(profile, from, to);
    const cached = await this.redis.get(k);
    if (cached) return JSON.parse(cached);
    let route: Route | null = null;
    try {
      if (config.routing.provider === 'osrm') route = await this.osrm(from, to, profile);
      if (config.routing.provider === 'mapbox') route = await this.mapbox(from, to, profile);
    } catch (e) {
      this.log.warn(`Serviço de rotas falhou, usando linha reta: ${(e as Error).message}`);
    }
    route ??= this.straight(from, to, profile);
    // a reserva fica pouco tempo em cache: assim que o serviço voltar, a rota real aparece
    await this.redis.set(k, JSON.stringify(route), 'EX', route.source === 'straight' ? 30 : CACHE_TTL);
    return route;
  }

  private async fetchJson(url: string) {
    const res = await fetch(url, { signal: AbortSignal.timeout(config.routing.timeoutMs), headers: { 'user-agent': 'entrega-ja-api' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<any>;
  }

  private async osrm(a: Point, b: Point, profile: Profile): Promise<Route | null> {
    // o servidor público só tem o perfil de carro; um OSRM próprio pode ter bike e a pé
    const p = config.routing.url.includes('project-osrm.org') ? 'driving' : profile;
    const data = await this.fetchJson(`${config.routing.url.replace(/\/$/, '')}/route/v1/${p}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    const r = data.routes?.[0];
    if (!r) return null;
    const minutes = profile === 'driving' ? r.duration / 60 : (r.distance / 1000 / FALLBACK_KMH[profile]) * 60;
    return { coordinates: r.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]), distanceKm: round(r.distance / 1000, 2), durationMin: Math.max(1, Math.round(minutes)), source: 'osrm' };
  }

  private async mapbox(a: Point, b: Point, profile: Profile): Promise<Route | null> {
    if (!config.routing.mapboxToken) throw new Error('MAPBOX_TOKEN ausente');
    const p = profile === 'driving' ? 'driving-traffic' : profile;
    const data = await this.fetchJson(`https://api.mapbox.com/directions/v5/mapbox/${p}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&access_token=${config.routing.mapboxToken}`);
    const r = data.routes?.[0];
    if (!r) return null;
    return { coordinates: r.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]), distanceKm: round(r.distance / 1000, 2), durationMin: Math.max(1, Math.round(r.duration / 60)), source: 'mapbox' };
  }

  private straight(a: Point, b: Point, profile: Profile): Route {
    const km = distanceKm(a, b) * 1.3; // ruas não são retas
    return { coordinates: [[a.lat, a.lng], [b.lat, b.lng]], distanceKm: round(km, 2), durationMin: Math.max(1, Math.round((km / FALLBACK_KMH[profile]) * 60)), source: 'straight' };
  }
}
