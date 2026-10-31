import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS } from '../../infra/redis/redis.module';
import { Setting } from './setting.entity';

/** Regras da plataforma, com os valores padrão. O admin muda pelo painel. */
export const DEFAULT_SETTINGS = {
  /** Comissão da plataforma sobre o subtotal do pedido, em % */
  commissionPercent: 12,
  /** Pagamento do entregador: fixo + por km da loja até a cliente */
  courierBaseCents: 500,
  courierPerKmCents: 150,
  /** Até onde procurar entregadores a partir da loja */
  dispatchRadiusKm: 6,
};
export type PlatformSettings = typeof DEFAULT_SETTINGS;

const CACHE = 'settings';

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(Setting) private readonly repo: Repository<Setting>, @Inject(REDIS) private readonly redis: Redis) {}

  async get(): Promise<PlatformSettings> {
    const cached = await this.redis.get(CACHE);
    if (cached) return JSON.parse(cached);
    const rows = await this.repo.find();
    const values = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) } as PlatformSettings;
    await this.redis.set(CACHE, JSON.stringify(values), 'EX', 300);
    return values;
  }

  async update(patch: Partial<PlatformSettings>) {
    const entries = Object.entries(patch).filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined);
    if (entries.length) await this.repo.save(entries.map(([key, value]) => ({ key, value })));
    await this.redis.del(CACHE);
    return this.get();
  }
}

@Global()
@Module({ imports: [TypeOrmModule.forFeature([Setting])], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
