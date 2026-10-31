import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { badRequest, notFound } from '../../common/errors';
import { IMAGE, StorageService } from '../../infra/storage/storage.service';
import { StoreAccessService } from '../merchant/store-access.service';
import { CategoryDto, ProductDto } from '../merchant/merchant.dto';
import { MenuCategory, ModerationStatus, OptionGroup, Product } from './catalog.entity';

/** Cardápio visto e editado pela equipe da loja */
@Injectable()
export class MenuService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly access: StoreAccessService,
    private readonly storage: StorageService,
  ) {}

  private cats = () => this.ds.getRepository(MenuCategory);
  private products = () => this.ds.getRepository(Product);

  async menu(userId: string, storeId: string) {
    await this.access.require(userId, storeId, 'orders');
    const [categories, products] = await Promise.all([
      this.cats().find({ where: { storeId }, order: { position: 'ASC', name: 'ASC' } }),
      this.products().find({ where: { storeId }, order: { position: 'ASC', createdAt: 'ASC' } }),
    ]);
    return { categories, products };
  }

  // ── seções

  async createCategory(userId: string, storeId: string, dto: CategoryDto) {
    await this.access.require(userId, storeId, 'menu.edit');
    const position = await this.cats().count({ where: { storeId } });
    return this.cats().save(this.cats().create({ storeId, name: dto.name, position }));
  }

  async renameCategory(userId: string, storeId: string, id: string, dto: CategoryDto) {
    await this.access.require(userId, storeId, 'menu.edit');
    const r = await this.cats().update({ id, storeId }, { name: dto.name });
    if (!r.affected) throw notFound('Seção');
    return { ok: true };
  }

  /** Apagar a seção não apaga os produtos: eles ficam em "Sem seção" */
  async deleteCategory(userId: string, storeId: string, id: string) {
    await this.access.require(userId, storeId, 'menu.edit');
    await this.cats().delete({ id, storeId });
    return { ok: true };
  }

  async reorderCategories(userId: string, storeId: string, ids: string[]) {
    await this.access.require(userId, storeId, 'menu.edit');
    await this.ds.transaction((m) => Promise.all(ids.map((id, position) => m.update(MenuCategory, { id, storeId }, { position }))));
    return { ok: true };
  }

  // ── produtos

  private normalizeGroups(groups: ProductDto['optionGroups'] = []): OptionGroup[] {
    return groups.map((g) => {
      if (g.min > g.max) throw badRequest(`"${g.name}": o mínimo não pode passar do máximo`);
      if (g.options.length < g.min) throw badRequest(`"${g.name}" precisa de pelo menos ${g.min} opções`);
      return { id: g.id || randomUUID().slice(0, 8), name: g.name, min: g.min, max: Math.min(g.max, g.options.length || g.max), options: g.options.map((o) => ({ id: o.id || randomUUID().slice(0, 8), name: o.name, priceCents: o.priceCents })) };
    });
  }

  private async checkCategory(storeId: string, categoryId?: string | null) {
    if (categoryId && !(await this.cats().exists({ where: { id: categoryId, storeId } }))) throw badRequest('Seção inválida');
  }

  async createProduct(userId: string, storeId: string, dto: ProductDto) {
    await this.access.require(userId, storeId, 'menu.edit');
    await this.checkCategory(storeId, dto.categoryId);
    const position = await this.products().count({ where: { storeId } });
    return this.products().save(
      this.products().create({ storeId, name: dto.name, description: dto.description || null, priceCents: dto.priceCents, categoryId: dto.categoryId ?? null, available: dto.available ?? true, optionGroups: this.normalizeGroups(dto.optionGroups), position }),
    );
  }

  private async product(storeId: string, id: string) {
    const p = await this.products().findOneBy({ id, storeId });
    if (!p) throw notFound('Produto');
    return p;
  }

  async updateProduct(userId: string, storeId: string, id: string, dto: ProductDto) {
    await this.access.require(userId, storeId, 'menu.edit');
    const p = await this.product(storeId, id);
    await this.checkCategory(storeId, dto.categoryId);
    Object.assign(p, { name: dto.name, description: dto.description || null, priceCents: dto.priceCents, categoryId: dto.categoryId ?? null, optionGroups: this.normalizeGroups(dto.optionGroups) });
    if (dto.available !== undefined) p.available = dto.available;
    return this.products().save(p);
  }

  /** Esgotado / disponível: o atendente também pode */
  async setAvailable(userId: string, storeId: string, id: string, available: boolean) {
    await this.access.require(userId, storeId, 'menu.availability');
    const p = await this.product(storeId, id);
    if (available && p.moderation === ModerationStatus.REMOVED) throw badRequest(`Produto removido pela moderação: ${p.moderationReason ?? ''}`);
    await this.products().update(id, { available });
    return { available };
  }

  async deleteProduct(userId: string, storeId: string, id: string) {
    await this.access.require(userId, storeId, 'menu.edit');
    const p = await this.product(storeId, id);
    await this.products().delete(p.id);
    await this.storage.remove(p.photoUrl);
    return { ok: true };
  }

  async reorderProducts(userId: string, storeId: string, ids: string[]) {
    await this.access.require(userId, storeId, 'menu.edit');
    const found = await this.products().count({ where: { storeId, id: In(ids) } });
    if (found !== ids.length) throw badRequest('Lista de produtos inválida');
    await this.ds.transaction((m) => Promise.all(ids.map((id, position) => m.update(Product, { id, storeId }, { position }))));
    return { ok: true };
  }

  async photo(userId: string, storeId: string, id: string, file?: Express.Multer.File) {
    await this.access.require(userId, storeId, 'menu.edit');
    const p = await this.product(storeId, id);
    const url = await this.storage.saveImage(file, IMAGE.product);
    await this.storage.remove(p.photoUrl);
    await this.products().update(id, { photoUrl: url });
    return { photoUrl: url };
  }
}
