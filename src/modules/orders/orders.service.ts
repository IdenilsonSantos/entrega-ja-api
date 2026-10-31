import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { DataSource, In } from 'typeorm';
import { AuthUser } from '../../common/auth';
import { badRequest, forbidden, notFound } from '../../common/errors';
import { distanceKm, round } from '../../common/geo';
import { mapPage, paginate } from '../../common/pagination';
import { Address } from '../addresses/address.entity';
import { ModerationStatus, Product } from '../catalog/catalog.entity';
import { CourierProfile } from '../couriers/courier-profile.entity';
import { DispatchService } from '../dispatch/dispatch.service';
import { PresenceService } from '../dispatch/presence.service';
import { StoreAccessService } from '../merchant/store-access.service';
import { SettingsService } from '../settings/settings.service';
import { Store, StoreStatus } from '../stores/store.entity';
import { OrderCore } from './order-core.service';
import { ACTIVE_STATUSES, DELIVERY_VISIBLE, FINAL_STATUSES, Order, OrderItem, OrderStatus, PaymentMethod } from './order.entity';
import { viewOrder, Viewer } from './order-view';
import { CreateOrderDto, OrderListQuery } from './orders.dto';

const money = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly core: OrderCore,
    private readonly dispatch: DispatchService,
    private readonly presence: PresenceService,
    private readonly access: StoreAccessService,
    private readonly settings: SettingsService,
  ) {}

  // ───────────── cliente

  async create(customer: AuthUser, dto: CreateOrderDto) {
    const store = await this.ds.getRepository(Store).findOneBy({ id: dto.storeId });
    if (!store || store.status !== StoreStatus.ACTIVE) throw notFound('Loja');
    if (!store.isOpen) throw badRequest('A loja está fechada agora');

    const dest = await this.destination(customer.id, dto);
    const km = distanceKm(store, { lat: dest.deliveryLat, lng: dest.deliveryLng });
    if (km > store.deliveryRadiusKm) throw badRequest(`A loja entrega até ${store.deliveryRadiusKm} km. Seu endereço está a ${round(km, 1)} km`);

    const items = await this.priceItems(store.id, dto);
    const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
    if (subtotalCents < store.minOrderCents) throw badRequest(`Pedido mínimo de ${money(store.minOrderCents)}`);
    const totalCents = subtotalCents + store.deliveryFeeCents;
    if (dto.paymentMethod === PaymentMethod.CASH && dto.changeForCents && dto.changeForCents < totalCents) throw badRequest('O troco precisa ser maior que o total');

    const s = await this.settings.get();
    const order = await this.ds.getRepository(Order).save(
      this.ds.getRepository(Order).create({
        customerId: customer.id,
        storeId: store.id,
        items,
        subtotalCents,
        deliveryFeeCents: store.deliveryFeeCents,
        totalCents,
        courierFeeCents: Math.round(s.courierBaseCents + s.courierPerKmCents * km),
        platformFeeCents: Math.round((subtotalCents * s.commissionPercent) / 100),
        paymentMethod: dto.paymentMethod,
        changeForCents: dto.paymentMethod === PaymentMethod.CASH ? (dto.changeForCents ?? null) : null,
        notes: dto.notes || null,
        ...dest,
        distanceKm: round(km, 2),
        deliveryCode: String(randomInt(0, 10000)).padStart(4, '0'),
      }),
    );
    await this.core.timeline(order.id, 'created', customer.id);
    const full = await this.core.load(order.id);
    await this.core.broadcast(full, {
      store: { type: 'order.new', title: `Novo pedido #${full.number}`, body: `${customer.name} · ${items.length} ${items.length > 1 ? 'itens' : 'item'} · ${money(totalCents)}` },
    });
    return viewOrder(full, 'customer');
  }

  private async destination(customerId: string, dto: CreateOrderDto) {
    if (dto.addressId) {
      const a = await this.ds.getRepository(Address).findOneBy({ id: dto.addressId, userId: customerId });
      if (!a) throw notFound('Endereço');
      return { deliveryAddress: a.street, deliveryComplement: a.complement, deliveryReference: a.reference, deliveryLat: a.lat, deliveryLng: a.lng };
    }
    if (!dto.deliveryAddress || dto.deliveryLat === undefined || dto.deliveryLng === undefined) throw badRequest('Informe o endereço de entrega');
    return { deliveryAddress: dto.deliveryAddress, deliveryComplement: dto.deliveryComplement || null, deliveryReference: dto.deliveryReference || null, deliveryLat: dto.deliveryLat, deliveryLng: dto.deliveryLng };
  }

  /** Preço calculado aqui, com o cardápio atual (o front nunca define preço) */
  private async priceItems(storeId: string, dto: CreateOrderDto): Promise<OrderItem[]> {
    const ids = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.ds.getRepository(Product).findBy({ id: In(ids), storeId });
    const byId = new Map(products.map((p) => [p.id, p]));
    return dto.items.map((it) => {
      const p = byId.get(it.productId);
      if (!p || p.moderation !== ModerationStatus.VISIBLE) throw badRequest('Um dos produtos não está mais no cardápio');
      if (!p.available) throw badRequest(`${p.name} esgotou`);
      const chosen = new Map((it.options ?? []).map((o) => [o.groupId, o.optionIds]));
      const options: OrderItem['options'] = [];
      for (const g of p.optionGroups) {
        const picked = [...new Set(chosen.get(g.id) ?? [])];
        if (picked.length < g.min) throw badRequest(`${p.name}: escolha ${g.min > 1 ? `${g.min} opções` : 'uma opção'} em "${g.name}"`);
        if (picked.length > g.max) throw badRequest(`${p.name}: no máximo ${g.max} em "${g.name}"`);
        for (const oid of picked) {
          const opt = g.options.find((o) => o.id === oid);
          if (!opt) throw badRequest(`${p.name}: opção inválida em "${g.name}"`);
          options.push({ group: g.name, name: opt.name, priceCents: opt.priceCents });
        }
        chosen.delete(g.id);
      }
      if (chosen.size) throw badRequest(`${p.name}: grupo de opções inválido`);
      const unitCents = p.priceCents + options.reduce((s, o) => s + o.priceCents, 0);
      return { productId: p.id, name: p.name, qty: it.qty, unitCents, options, totalCents: unitCents * it.qty, ...(it.notes && { notes: it.notes }) };
    });
  }

  private scope(qb: ReturnType<typeof this.qb>, scope?: 'active' | 'history') {
    if (scope === 'active') qb.andWhere('o.status IN (:...st)', { st: ACTIVE_STATUSES });
    if (scope === 'history') qb.andWhere('o.status IN (:...st)', { st: FINAL_STATUSES });
    return qb;
  }

  private qb() {
    return this.ds.getRepository(Order).createQueryBuilder('o').leftJoinAndSelect('o.store', 'store').leftJoinAndSelect('o.customer', 'customer').leftJoinAndSelect('o.courier', 'courier');
  }

  /** Lista com o veículo do entregador (uma consulta para a página toda) */
  private async withProfiles(orders: Order[]) {
    const ids = [...new Set(orders.map((o) => o.courierId).filter(Boolean))] as string[];
    const profiles = ids.length ? await this.ds.getRepository(CourierProfile).findBy({ userId: In(ids) }) : [];
    const map = new Map(profiles.map((p) => [p.userId, p]));
    return orders.map((o) => Object.assign(o, { courierProfile: o.courierId ? map.get(o.courierId) ?? null : null }));
  }

  async listPage(where: (qb: ReturnType<typeof this.qb>) => void, q: OrderListQuery, viewer: Viewer, withCode = false) {
    const qb = this.qb();
    if (withCode) qb.addSelect('o.deliveryCode');
    where(qb);
    this.scope(qb, q.scope);
    const page = await paginate(qb, q);
    await this.withProfiles(page.items);
    return mapPage(page, (o) => viewOrder(o, viewer));
  }

  listMine(customer: AuthUser, q: OrderListQuery) {
    return this.listPage((qb) => qb.where('o.customerId = :id', { id: customer.id }), q, 'customer', true);
  }

  async getForCustomer(customer: AuthUser, id: string) {
    const o = await this.core.load(id);
    if (o.customerId !== customer.id) throw notFound('Pedido');
    return { ...viewOrder(o, 'customer'), timeline: await this.core.history(id) };
  }

  /** Posição do entregador, só depois que o pedido está pronto */
  async tracking(customer: AuthUser, id: string) {
    const o = await this.ds.getRepository(Order).findOneBy({ id, customerId: customer.id });
    if (!o) throw notFound('Pedido');
    if (!o.courierId || !DELIVERY_VISIBLE.includes(o.status) || o.status === OrderStatus.DELIVERED) return { courier: null };
    return { courier: await this.presence.position(o.courierId) };
  }

  async cancelByCustomer(customer: AuthUser, id: string) {
    await this.core.transition(id, [OrderStatus.PENDING], { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelledBy: 'CUSTOMER', cancelReason: 'Cancelado pela cliente' }, '"customerId" = :c', { c: customer.id });
    await this.core.timeline(id, 'cancelled', customer.id, 'Cancelado pela cliente');
    const o = await this.core.load(id);
    await this.core.broadcast(o, { store: { type: 'order.cancelled', title: `Pedido #${o.number} cancelado`, body: 'A cliente cancelou antes de você aceitar.' } });
    return viewOrder(o, 'customer');
  }

  async rate(customer: AuthUser, id: string, rating: number, comment?: string) {
    const o = await this.ds.getRepository(Order).findOneBy({ id, customerId: customer.id });
    if (!o) throw notFound('Pedido');
    if (o.status !== OrderStatus.DELIVERED) throw badRequest('Só dá para avaliar pedidos entregues');
    if (o.rating) throw badRequest('Este pedido já foi avaliado');
    await this.ds.transaction(async (m) => {
      await m.update(Order, id, { rating, ratingComment: comment || null });
      // média incremental, sem recalcular todos os pedidos
      await m.query(`UPDATE stores SET "ratingAvg" = ("ratingAvg" * "ratingCount" + $1) / ("ratingCount" + 1), "ratingCount" = "ratingCount" + 1 WHERE id = $2`, [rating, o.storeId]);
    });
    const full = await this.core.load(id);
    await this.core.broadcast(full, { store: { type: 'order.rated', title: `Avaliação do pedido #${full.number}`, body: `${'★'.repeat(rating)}${comment ? ` "${comment.slice(0, 80)}"` : ''}` } });
    return viewOrder(full, 'customer');
  }

  // ───────────── loja

  listForStore(userId: string, storeId: string, q: OrderListQuery) {
    return this.access.require(userId, storeId, 'orders').then(() => this.listPage((qb) => qb.where('o.storeId = :s', { s: storeId }), q, 'store'));
  }

  private async storeOrder(userId: string, id: string) {
    const o = await this.ds.getRepository(Order).findOne({ select: { id: true, storeId: true }, where: { id } });
    if (!o) throw notFound('Pedido');
    await this.access.require(userId, o.storeId, 'orders');
    return o;
  }

  async getForStore(userId: string, id: string) {
    await this.storeOrder(userId, id);
    const o = await this.core.load(id);
    return { ...viewOrder(o, 'store'), timeline: await this.core.history(id) };
  }

  async accept(user: AuthUser, id: string) {
    await this.storeOrder(user.id, id);
    await this.core.transition(id, [OrderStatus.PENDING], { status: OrderStatus.PREPARING, acceptedAt: new Date() });
    await this.core.timeline(id, 'accepted', user.id);
    const o = await this.core.load(id);
    await this.core.broadcast(o, { customer: { type: 'order.accepted', title: 'Pedido aceito', body: `${o.store.name} está preparando seu pedido (cerca de ${o.store.prepTimeMin} min).` } });
    return viewOrder(o, 'store');
  }

  async reject(user: AuthUser, id: string, reason: string) {
    await this.storeOrder(user.id, id);
    await this.core.transition(id, [OrderStatus.PENDING], { status: OrderStatus.REJECTED, cancelledAt: new Date(), cancelledBy: 'STORE', cancelReason: reason });
    await this.core.timeline(id, 'rejected', user.id, reason);
    const o = await this.core.load(id);
    await this.core.broadcast(o, { customer: { type: 'order.rejected', title: 'A loja não pôde aceitar', body: `${o.store.name}: ${reason}` } });
    return viewOrder(o, 'store');
  }

  /** Comida pronta: só agora a busca por entregador começa */
  async ready(user: AuthUser, id: string) {
    await this.storeOrder(user.id, id);
    await this.core.transition(id, [OrderStatus.PREPARING], { status: OrderStatus.READY, readyAt: new Date() });
    await this.core.timeline(id, 'ready', user.id);
    const o = await this.core.load(id);
    if (!o.courierId) await this.dispatch.start(id);
    await this.core.broadcast(o, {
      customer: o.courierId
        ? { type: 'order.ready', title: 'Pedido pronto', body: `${o.courier!.name} vai buscar seu pedido em ${o.store.name}.` }
        : { type: 'order.ready', title: 'Pedido pronto', body: 'Estamos chamando um entregador.' },
      courier: { type: 'order.ready', title: `Pedido #${o.number} pronto`, body: `Pode retirar em ${o.store.name}.`, urgent: true },
    });
    return viewOrder(o, 'store');
  }

  async cancelByStore(user: AuthUser, id: string, reason: string) {
    await this.storeOrder(user.id, id);
    return this.cancel(id, [OrderStatus.PREPARING, OrderStatus.READY], 'STORE', user.id, reason);
  }

  /** Cancelamento depois de aceito (loja) ou em qualquer etapa ativa (admin) */
  async cancel(id: string, from: OrderStatus[], by: 'STORE' | 'ADMIN', actorId: string, reason: string) {
    await this.core.transition(id, from, { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelledBy: by, cancelReason: reason });
    await this.dispatch.stop(id);
    await this.core.timeline(id, 'cancelled', actorId, reason);
    const o = await this.core.load(id);
    const who = by === 'STORE' ? o.store.name : 'A plataforma';
    await this.core.broadcast(o, {
      customer: { type: 'order.cancelled', title: 'Pedido cancelado', body: `${who}: ${reason}` },
      ...(by === 'ADMIN' && { store: { type: 'order.cancelled', title: `Pedido #${o.number} cancelado`, body: `Pela plataforma: ${reason}` } }),
      courier: { type: 'order.cancelled', title: `Pedido #${o.number} cancelado`, body: 'Não precisa mais fazer esta entrega.' },
    });
    return o;
  }

  /** Painel da loja: números do período e por dia */
  async storeStats(userId: string, storeId: string, days = 7) {
    await this.access.require(userId, storeId, 'reports');
    const since = new Date(Date.now() - days * 86400_000);
    const [totals] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
              count(*) FILTER (WHERE status IN ('REJECTED','CANCELLED'))::int AS lost,
              coalesce(sum("subtotalCents") FILTER (WHERE status = 'DELIVERED'), 0)::int AS revenue,
              coalesce(sum("platformFeeCents") FILTER (WHERE status = 'DELIVERED'), 0)::int AS fees,
              coalesce(avg(extract(epoch FROM ("readyAt" - "acceptedAt")) / 60) FILTER (WHERE "readyAt" IS NOT NULL), 0)::float AS "prepMin",
              coalesce(avg(rating) FILTER (WHERE rating IS NOT NULL), 0)::float AS rating
         FROM orders WHERE "storeId" = $1 AND "createdAt" >= $2`,
      [storeId, since],
    );
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(x.orders, 0)::int AS orders, coalesce(x.revenue, 0)::int AS revenue
         FROM generate_series(date_trunc('day', $2::timestamptz), date_trunc('day', now()), '1 day') d
         LEFT JOIN (SELECT date_trunc('day', "createdAt") AS day, count(*) AS orders, sum("subtotalCents") AS revenue
                      FROM orders WHERE "storeId" = $1 AND status = 'DELIVERED' AND "createdAt" >= $2 GROUP BY 1) x ON x.day = d
        ORDER BY d`,
      [storeId, since],
    );
    const top = await this.ds.query(
      `SELECT i->>'name' AS name, sum((i->>'qty')::int)::int AS qty
         FROM orders, jsonb_array_elements(items) i
        WHERE "storeId" = $1 AND status = 'DELIVERED' AND "createdAt" >= $2
        GROUP BY 1 ORDER BY qty DESC LIMIT 5`,
      [storeId, since],
    );
    return { days, ...totals, prepMin: round(totals.prepMin, 1), rating: round(totals.rating, 1), daily, top };
  }

  // ───────────── entregador

  async courierActive(courierId: string) {
    const rows = await this.qb().where('o.courierId = :c', { c: courierId }).andWhere('o.status IN (:...st)', { st: [OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.PICKED_UP] }).orderBy('o.assignedAt', 'ASC').getMany();
    return rows.map((o) => viewOrder(o, 'courier'));
  }

  courierHistory(courierId: string, q: OrderListQuery) {
    return this.listPage((qb) => qb.where('o.courierId = :c', { c: courierId }), { ...q, scope: 'history' }, 'courier');
  }

  async pickup(courierId: string, id: string) {
    const o0 = await this.ds.getRepository(Order).findOneBy({ id, courierId });
    if (!o0) throw notFound('Pedido');
    if (o0.status === OrderStatus.PREPARING) throw badRequest('A loja ainda não marcou o pedido como pronto');
    await this.core.transition(id, [OrderStatus.READY], { status: OrderStatus.PICKED_UP, pickedUpAt: new Date() }, '"courierId" = :c', { c: courierId });
    await this.core.timeline(id, 'picked_up', courierId);
    const o = await this.core.load(id);
    await this.core.broadcast(o, {
      customer: { type: 'order.picked_up', title: 'Saiu para entrega', body: `${o.courier!.name} está levando seu pedido. Tenha o código ${o.deliveryCode} em mãos.` },
      store: { type: 'order.picked_up', title: `Pedido #${o.number} retirado`, body: `${o.courier!.name} saiu para entrega.` },
    });
    return viewOrder(o, 'courier');
  }

  async deliver(courierId: string, id: string, code: string) {
    const o0 = await this.ds.getRepository(Order).createQueryBuilder('o').addSelect('o.deliveryCode').where('o.id = :id AND o.courierId = :c', { id, c: courierId }).getOne();
    if (!o0) throw notFound('Pedido');
    if (o0.status !== OrderStatus.PICKED_UP) throw badRequest('Retire o pedido na loja antes de entregar');
    if (o0.deliveryCode !== code) throw badRequest('Código incorreto. Peça para a cliente conferir no app');
    await this.ds.transaction(async (m) => {
      await this.core.transition(id, [OrderStatus.PICKED_UP], { status: OrderStatus.DELIVERED, deliveredAt: new Date() }, '"courierId" = :c', { c: courierId }, m);
      await m.increment(CourierProfile, { userId: courierId }, 'deliveriesCount', 1);
    });
    await this.core.timeline(id, 'delivered', courierId);
    const o = await this.core.load(id);
    await this.core.broadcast(o, {
      customer: { type: 'order.delivered', title: 'Pedido entregue', body: `Bom apetite! Conte como foi o pedido de ${o.store.name}.` },
      store: { type: 'order.delivered', title: `Pedido #${o.number} entregue`, body: `Entregue por ${o.courier!.name}.` },
    });
    return viewOrder(o, 'courier');
  }

  async courierEarnings(courierId: string) {
    const [t] = await this.ds.query(
      `SELECT coalesce(sum("courierFeeCents") FILTER (WHERE "deliveredAt" >= date_trunc('day', now())), 0)::int AS today,
              count(*) FILTER (WHERE "deliveredAt" >= date_trunc('day', now()))::int AS "todayCount",
              coalesce(sum("courierFeeCents") FILTER (WHERE "deliveredAt" >= now() - interval '7 days'), 0)::int AS week,
              count(*) FILTER (WHERE "deliveredAt" >= now() - interval '7 days')::int AS "weekCount",
              coalesce(sum("courierFeeCents") FILTER (WHERE "deliveredAt" >= date_trunc('month', now())), 0)::int AS month,
              coalesce(sum("courierFeeCents"), 0)::int AS total,
              count(*)::int AS "totalCount",
              coalesce(sum("distanceKm"), 0)::float AS km
         FROM orders WHERE "courierId" = $1 AND status = 'DELIVERED'`,
      [courierId],
    );
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(x.cents, 0)::int AS cents, coalesce(x.n, 0)::int AS count
         FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), '1 day') d
         LEFT JOIN (SELECT date_trunc('day', "deliveredAt") AS day, sum("courierFeeCents") AS cents, count(*) AS n
                      FROM orders WHERE "courierId" = $1 AND status = 'DELIVERED' AND "deliveredAt" >= now() - interval '7 days' GROUP BY 1) x ON x.day = d
        ORDER BY d`,
      [courierId],
    );
    return { ...t, km: round(t.km, 1), daily };
  }

  ensureCustomer(u: AuthUser) {
    if (u.role !== 'CUSTOMER') throw forbidden();
  }
}
