import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { Public } from '../../common/auth';
import { notFound } from '../../common/errors';
import { distanceKm, round } from '../../common/geo';
import { MenuCategory, ModerationStatus, Product } from '../catalog/catalog.entity';
import { openState, OpeningRange } from './opening-hours';
import { Store, StoreStatus } from './store.entity';

class NearbyQuery {
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lng: number;
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
}

const publicStore = (s: Store, km?: number) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  category: s.category,
  address: s.address,
  lat: s.lat,
  lng: s.lng,
  logoUrl: s.logoUrl,
  coverUrl: s.coverUrl,
  deliveryFeeCents: s.deliveryFeeCents,
  minOrderCents: s.minOrderCents,
  prepTimeMin: s.prepTimeMin,
  deliveryRadiusKm: s.deliveryRadiusKm,
  // isOpen continua por compatibilidade; o que vale para pedir é openNow
  ...(({ openNow, opensAt, closesAt }) => ({ isOpen: openNow, openNow, opensAt, closesAt }))(openState(s)),
  openingHours: s.openingHours as OpeningRange[] | null,
  ratingAvg: round(s.ratingAvg, 1),
  ratingCount: s.ratingCount,
  ...(km !== undefined && { distanceKm: round(km, 1) }),
});

/** Vitrine para a cliente: só lojas aprovadas e produtos não removidos pela moderação */
@Public()
@Controller('stores')
export class StoresController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Lojas que entregam no ponto, abertas primeiro e depois as mais perto */
  @Get()
  async nearby(@Query() q: NearbyQuery) {
    const qb = this.ds.getRepository(Store).createQueryBuilder('s').where('s.status = :st', { st: StoreStatus.ACTIVE });
    if (q.category) qb.andWhere('s.category = :c', { c: q.category });
    if (q.q) {
      // busca no nome da loja, na categoria e nos produtos
      qb.andWhere(
        `(s.name ILIKE :q OR s.category ILIKE :q OR EXISTS (SELECT 1 FROM products p WHERE p."storeId" = s.id AND p.moderation = 'VISIBLE' AND p.name ILIKE :q))`,
        { q: `%${q.q.replace(/[%_]/g, '')}%` },
      );
    }
    const rows = await qb.getMany();
    return rows
      .map((s) => publicStore(s, distanceKm(q, s)))
      .filter((s) => s.distanceKm! <= s.deliveryRadiusKm)
      .sort((a, b) => Number(b.openNow) - Number(a.openNow) || a.distanceKm! - b.distanceKm!);
  }

  @Get('categories')
  async categories() {
    const rows = await this.ds.query(`SELECT category, count(*)::int AS stores FROM stores WHERE status = 'ACTIVE' GROUP BY category ORDER BY stores DESC, category`);
    return rows as { category: string; stores: number }[];
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    const s = await this.ds.getRepository(Store).findOneBy({ id, status: StoreStatus.ACTIVE });
    if (!s) throw notFound('Loja');
    const [categories, products] = await Promise.all([
      this.ds.getRepository(MenuCategory).find({ where: { storeId: id }, order: { position: 'ASC' } }),
      this.ds.getRepository(Product).find({ where: { storeId: id, moderation: ModerationStatus.VISIBLE }, order: { position: 'ASC' } }),
    ]);
    const toDto = (p: Product) => ({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents, photoUrl: p.photoUrl, available: p.available, optionGroups: p.optionGroups });
    const sections = categories.map((c) => ({ id: c.id, name: c.name, products: products.filter((p) => p.categoryId === c.id).map(toDto) }));
    const loose = products.filter((p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId));
    if (loose.length) sections.push({ id: 'outros', name: 'Outros', products: loose.map(toDto) });
    return { ...publicStore(s), sections: sections.filter((x) => x.products.length) };
  }
}
