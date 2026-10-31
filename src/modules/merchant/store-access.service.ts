import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { forbidden, notFound } from '../../common/errors';
import { Store } from '../stores/store.entity';
import { PERMISSIONS, StoreMember, StorePermission } from './store-member.entity';

/**
 * Quem pode fazer o quê em cada loja. Toda rota do lojista passa por require(), que
 * confere se a pessoa é da equipe daquela loja e se o papel dela tem a permissão.
 */
@Injectable()
export class StoreAccessService {
  constructor(
    @InjectRepository(StoreMember) private readonly members: Repository<StoreMember>,
    @InjectRepository(Store) private readonly stores: Repository<Store>,
  ) {}

  async require(userId: string, storeId: string, perm: StorePermission) {
    const member = await this.members.findOne({ where: { storeId, userId }, relations: { store: true } });
    if (!member) throw notFound('Loja');
    if (!PERMISSIONS[member.role].includes(perm)) throw forbidden('Seu papel nesta loja não permite isso');
    return { member, store: member.store };
  }

  /** Todos da equipe (para avisar de pedido novo, por exemplo) */
  async memberIds(storeId: string, perm: StorePermission = 'orders') {
    const rows = await this.members.find({ select: { userId: true, role: true }, where: { storeId } });
    return rows.filter((r) => PERMISSIONS[r.role].includes(perm)).map((r) => r.userId);
  }

  async store(storeId: string) {
    const s = await this.stores.findOneBy({ id: storeId });
    if (!s) throw notFound('Loja');
    return s;
  }
}
