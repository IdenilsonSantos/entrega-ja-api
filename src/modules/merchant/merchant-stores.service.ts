import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { badRequest, defined } from '../../common/errors';
import { IMAGE, StorageService } from '../../infra/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isValidTimeZone, openState } from '../stores/opening-hours';
import { Store, StoreStatus } from '../stores/store.entity';
import { StoreMember, StoreRole } from './store-member.entity';
import { StoreAccessService } from './store-access.service';
import { StoreDto, UpdateStoreDto } from './merchant.dto';

@Injectable()
export class MerchantStoresService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly access: StoreAccessService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Nova loja entra em análise; quem cria vira o dono */
  async create(userId: string, dto: StoreDto) {
    const store = await this.ds.transaction(async (m) => {
      const s = await m.save(m.create(Store, { ...dto, description: dto.description || null, phone: dto.phone || null, ownerId: userId, status: StoreStatus.PENDING }));
      await m.insert(StoreMember, { storeId: s.id, userId, role: StoreRole.OWNER });
      return s;
    });
    await this.notifications.notifyAdmins({ type: 'store.pending', title: 'Nova loja para aprovar', body: `${store.name} (${store.category}) aguarda análise.`, link: '/admin/aprovacoes' });
    return store;
  }

  async get(userId: string, storeId: string) {
    const { store, member } = await this.access.require(userId, storeId, 'orders');
    return { ...store, ...openState(store), myRole: member.role };
  }

  async update(userId: string, storeId: string, dto: UpdateStoreDto) {
    await this.access.require(userId, storeId, 'store.edit');
    const patch: Partial<Store> = defined(dto) as Partial<Store>;
    if (dto.description !== undefined) patch.description = dto.description || null;
    if (dto.phone !== undefined) patch.phone = dto.phone || null;
    if (dto.timezone !== undefined && !isValidTimeZone(dto.timezone)) throw badRequest('Fuso horário inválido');
    if (dto.openingHours?.some((r) => r.open === r.close && r.open !== '00:00')) throw badRequest('Abertura e fechamento iguais: use 00:00 às 00:00 para o dia inteiro');
    // lista vazia é o mesmo que tirar o horário
    if (dto.openingHours !== undefined) patch.openingHours = dto.openingHours?.length ? dto.openingHours.map(({ day, open, close }) => ({ day, open, close })) : null;
    await this.ds.getRepository(Store).update(storeId, patch);
    return this.get(userId, storeId);
  }

  /** Abrir e fechar faz parte do dia a dia: atendentes também podem */
  async setOpen(userId: string, storeId: string, isOpen: boolean) {
    const { store } = await this.access.require(userId, storeId, 'orders');
    if (isOpen && store.status !== StoreStatus.ACTIVE) {
      throw badRequest(store.status === StoreStatus.PENDING ? 'A loja ainda está em análise pela plataforma' : `Loja suspensa: ${store.statusReason ?? 'fale com o suporte'}`);
    }
    await this.ds.getRepository(Store).update(storeId, { isOpen });
    return { isOpen };
  }

  async image(userId: string, storeId: string, kind: 'logo' | 'cover', file?: Express.Multer.File) {
    const { store } = await this.access.require(userId, storeId, 'store.edit');
    const url = await this.storage.saveImage(file, IMAGE[kind]);
    const field = kind === 'logo' ? 'logoUrl' : 'coverUrl';
    await this.storage.remove(store[field]);
    await this.ds.getRepository(Store).update(storeId, { [field]: url });
    return { [field]: url };
  }
}
