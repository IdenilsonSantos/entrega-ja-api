import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { conflict, notFound } from '../../common/errors';
import { EventsService } from '../../infra/events/events.service';
import { CourierProfile } from '../couriers/courier-profile.entity';
import { StoreAccessService } from '../merchant/store-access.service';
import { NotificationsService, NotifyInput } from '../notifications/notifications.service';
import { Order, OrderEvent, OrderStatus } from './order.entity';
import { LoadedOrder, viewOrder } from './order-view';

export interface Audience {
  customer?: NotifyInput;
  store?: NotifyInput;
  courier?: NotifyInput & { urgent?: boolean };
  /** quem mais precisa saber (ex.: entregador que foi trocado) */
  extra?: { userId: string; n: NotifyInput }[];
}

/**
 * Núcleo do pedido usado por todos os módulos (cliente, loja, entregador, despacho, admin):
 * carrega, muda o status com segurança, registra na linha do tempo e avisa todo mundo.
 */
@Injectable()
export class OrderCore {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly access: StoreAccessService,
  ) {}

  async load(id: string): Promise<LoadedOrder> {
    const o = await this.ds
      .getRepository(Order)
      .createQueryBuilder('o')
      .addSelect('o.deliveryCode')
      .leftJoinAndSelect('o.store', 'store')
      .leftJoinAndSelect('o.customer', 'customer')
      .leftJoinAndSelect('o.courier', 'courier')
      .where('o.id = :id', { id })
      .getOne();
    if (!o) throw notFound('Pedido');
    const lo = o as LoadedOrder;
    lo.courierProfile = o.courierId ? await this.ds.getRepository(CourierProfile).findOneBy({ userId: o.courierId }) : null;
    return lo;
  }

  /**
   * Muda o status só se o pedido ainda estiver num dos estados esperados (UPDATE … WHERE status IN).
   * Duas pessoas clicando ao mesmo tempo: uma ganha, a outra recebe "o pedido mudou".
   */
  async transition(id: string, from: OrderStatus[], patch: Partial<Order>, extraWhere = '', params: Record<string, unknown> = {}, m?: EntityManager) {
    const res = await (m ?? this.ds.manager)
      .createQueryBuilder()
      .update(Order)
      .set(patch)
      .where('id = :id AND status IN (:...from)' + (extraWhere ? ` AND ${extraWhere}` : ''), { id, from, ...params })
      .execute();
    if (!res.affected) throw conflict('O pedido mudou de situação. Atualize a tela');
  }

  timeline(orderId: string, type: string, actorId: string | null, note?: string | null, m?: EntityManager) {
    return (m ?? this.ds.manager).insert(OrderEvent, { orderId, type, actorId, note: note ?? null });
  }

  async history(orderId: string) {
    const rows = await this.ds.getRepository(OrderEvent).find({ where: { orderId }, order: { createdAt: 'ASC' } });
    return rows.map((e) => ({ type: e.type, actorId: e.actorId, note: e.note, at: e.createdAt }));
  }

  /** Manda a versão certa do pedido para cada participante e cria as notificações */
  async broadcast(order: LoadedOrder, audience: Audience = {}) {
    const staff = await this.access.memberIds(order.storeId);
    await Promise.all([
      this.events.toUsers([order.customerId], 'order.updated', viewOrder(order, 'customer')),
      this.events.toUsers(staff, 'order.updated', viewOrder(order, 'store')),
      order.courierId ? this.events.toUsers([order.courierId], 'order.updated', viewOrder(order, 'courier')) : null,
      this.events.toAdmins('order.updated', viewOrder(order, 'admin'), { ephemeral: true }),
    ]);
    const link = (path: string) => path.replace(':id', order.id);
    const tasks: Promise<unknown>[] = [];
    if (audience.customer) tasks.push(this.notifications.notify([order.customerId], { ...audience.customer, link: audience.customer.link ?? link('/pedidos/:id') }));
    if (audience.store) tasks.push(this.notifications.notify(staff, { ...audience.store, link: audience.store.link ?? `/loja/${order.storeId}/pedidos?id=${order.id}` }));
    if (audience.courier && order.courierId) {
      const { urgent, ...n } = audience.courier;
      tasks.push(this.notifications.notify([order.courierId], { ...n, link: n.link ?? '/entregador' }, { urgent }));
    }
    for (const e of audience.extra ?? []) tasks.push(this.notifications.notify([e.userId], e.n));
    await Promise.all(tasks);
  }

  /** Pedidos ativos de um conjunto de entregadores (para saber quem está ocupado) */
  async busyCouriers(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await this.ds.getRepository(Order).find({
      select: { courierId: true },
      where: { courierId: In(ids), status: In([OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.PICKED_UP]) },
    });
    return new Set(rows.map((r) => r.courierId!));
  }
}
