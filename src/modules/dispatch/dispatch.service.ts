import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { DataSource, ILike, In } from 'typeorm';
import { config } from '../../config';
import { badRequest, conflict, notFound } from '../../common/errors';
import { distanceKm, round } from '../../common/geo';
import { EventsService } from '../../infra/events/events.service';
import { DISPATCH_QUEUE } from '../../infra/queue/queues';
import { REDIS } from '../../infra/redis/redis.module';
import { CourierProfile } from '../couriers/courier-profile.entity';
import { AuditService } from '../moderation/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderCore } from '../orders/order-core.service';
import { Order, OrderStatus } from '../orders/order.entity';
import { viewOrder } from '../orders/order-view';
import { SettingsService } from '../settings/settings.service';
import { Role, User, UserStatus } from '../users/user.entity';
import { PresenceService } from './presence.service';

/** Chaves do despacho no Redis */
const K = {
  offer: (orderId: string) => `dispatch:offer:${orderId}`, // → courierId com a oferta em aberto
  holding: (courierId: string) => `dispatch:holding:${courierId}`, // → orderId (uma oferta por vez)
  tried: (orderId: string) => `dispatch:tried:${orderId}`, // quem recusou ou deixou expirar
  round: (orderId: string) => `dispatch:round:${orderId}`,
};

export type DispatchJob = { kind: 'find'; orderId: string } | { kind: 'expire'; orderId: string; courierId: string };

/**
 * Busca de entregador. Começa quando a loja marca o pedido como PRONTO:
 *   1. pega o entregador online mais perto da loja que esteja livre e não tenha recusado;
 *   2. manda a oferta (tempo real + push com prioridade alta) e espera DISPATCH_OFFER_TTL_SEC;
 *   3. aceitou → pedido é dele; recusou ou expirou → próximo da lista;
 *   4. ninguém disponível → tenta de novo a cada DISPATCH_RETRY_DELAY_MS e avisa o admin
 *      depois de algumas rodadas, para ele atribuir alguém manualmente.
 * O trabalho pesado roda no worker (fila "dispatch"); a API só agenda.
 */
@Injectable()
export class DispatchService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DISPATCH_QUEUE) private readonly queue: Queue<DispatchJob>,
    private readonly presence: PresenceService,
    private readonly core: OrderCore,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async start(orderId: string) {
    await this.redis.del(K.tried(orderId), K.round(orderId));
    await this.queue.add('find', { kind: 'find', orderId }, { jobId: `find-${orderId}-${Date.now()}` });
  }

  /** Pedido cancelado ou atribuído à mão: a oferta em aberto deixa de valer */
  async stop(orderId: string) {
    const courierId = await this.redis.get(K.offer(orderId));
    await this.redis.del(K.offer(orderId), K.tried(orderId), K.round(orderId));
    if (courierId) {
      await this.redis.del(K.holding(courierId));
      await this.events.toUsers([courierId], 'offer.cancelled', { orderId });
    }
  }

  // ───────────── worker

  async run(job: DispatchJob) {
    if (job.kind === 'expire') return this.expire(job.orderId, job.courierId);
    return this.find(job.orderId);
  }

  private async find(orderId: string) {
    const order = await this.ds.getRepository(Order).findOne({ where: { id: orderId }, relations: { store: true } });
    if (!order || order.status !== OrderStatus.READY || order.courierId) return 'done';
    if (await this.redis.exists(K.offer(orderId))) return 'offer-open';

    const { dispatchRadiusKm } = await this.settings.get();
    const near = await this.presence.nearby(order.store.lat, order.store.lng, dispatchRadiusKm);
    const tried = new Set(await this.redis.smembers(K.tried(orderId)));
    const busy = await this.core.busyCouriers(near.map((n) => n.id));
    const holding = await this.redis.mget(...(near.length ? near.map((n) => K.holding(n.id)) : ['_']));
    const candidates = near.filter((n, i) => !tried.has(n.id) && !busy.has(n.id) && !holding[i]);
    const active = candidates.length
      ? await this.ds.getRepository(User).find({ select: { id: true }, where: { id: In(candidates.map((c) => c.id)), role: Role.COURIER, status: UserStatus.ACTIVE } })
      : [];
    const ok = new Set(active.map((a) => a.id));
    const pick = candidates.find((c) => ok.has(c.id));

    if (!pick) return this.retryLater(order);

    const ttl = config.dispatch.offerTtlSec;
    const claimed = await this.redis.set(K.offer(orderId), pick.id, 'EX', ttl + 5, 'NX');
    if (!claimed) return 'offer-open';
    await this.redis.set(K.holding(pick.id), orderId, 'EX', ttl + 5);
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const offer = {
      orderId,
      number: order.number,
      storeName: order.store.name,
      storeAddress: order.store.address,
      storeLat: order.store.lat,
      storeLng: order.store.lng,
      deliveryAddress: order.deliveryAddress,
      deliveryLat: order.deliveryLat,
      deliveryLng: order.deliveryLng,
      pickupKm: round(pick.km, 1),
      tripKm: order.distanceKm,
      feeCents: order.courierFeeCents,
      expiresAt,
    };
    await this.events.toUsers([pick.id], 'offer.new', offer);
    await this.notifications.notify(
      [pick.id],
      { type: 'offer.new', title: 'Nova corrida', body: `${order.store.name} → ${order.deliveryAddress} · R$ ${(order.courierFeeCents / 100).toFixed(2).replace('.', ',')}`, link: '/entregador' },
      { urgent: true },
    );
    await this.queue.add('expire', { kind: 'expire', orderId, courierId: pick.id }, { delay: ttl * 1000, jobId: `expire-${orderId}-${pick.id}-${Date.now()}` });
    return `offered:${pick.id}`;
  }

  private async retryLater(order: Order) {
    const round_ = await this.redis.incr(K.round(order.id));
    await this.redis.expire(K.round(order.id), 6 * 3600);
    // a cada 3 rodadas, quem recusou volta a ser considerado (pode ter ficado livre)
    if (round_ % 3 === 0) await this.redis.del(K.tried(order.id));
    if (round_ === config.dispatch.alertAfterAttempts) {
      await this.notifications.notifyAdmins({ type: 'dispatch.stuck', title: `Pedido #${order.number} sem entregador`, body: `${order.store.name}: ninguém aceitou até agora. Atribua manualmente.`, link: `/admin/pedidos?id=${order.id}` });
    }
    await this.queue.add('find', { kind: 'find', orderId: order.id }, { delay: config.dispatch.retryDelayMs, jobId: `find-${order.id}-${Date.now()}` });
    return 'retry';
  }

  private async expire(orderId: string, courierId: string) {
    const current = await this.redis.get(K.offer(orderId));
    if (current !== courierId) return 'stale';
    await this.release(orderId, courierId);
    await this.events.toUsers([courierId], 'offer.expired', { orderId });
    return this.find(orderId);
  }

  private async release(orderId: string, courierId: string) {
    await this.redis.multi().del(K.offer(orderId)).del(K.holding(courierId)).sadd(K.tried(orderId), courierId).expire(K.tried(orderId), 6 * 3600).exec();
  }

  // ───────────── entregador

  async currentOffer(courierId: string) {
    const orderId = await this.redis.get(K.holding(courierId));
    if (!orderId || (await this.redis.get(K.offer(orderId))) !== courierId) return null;
    const ttl = await this.redis.ttl(K.offer(orderId));
    const o = await this.ds.getRepository(Order).findOne({ where: { id: orderId }, relations: { store: true } });
    if (!o) return null;
    const pos = await this.presence.position(courierId);
    return {
      orderId,
      number: o.number,
      storeName: o.store.name,
      storeAddress: o.store.address,
      storeLat: o.store.lat,
      storeLng: o.store.lng,
      deliveryAddress: o.deliveryAddress,
      deliveryLat: o.deliveryLat,
      deliveryLng: o.deliveryLng,
      pickupKm: pos ? round(distanceKm(pos, o.store), 1) : null,
      tripKm: o.distanceKm,
      feeCents: o.courierFeeCents,
      expiresAt: new Date(Date.now() + Math.max(0, ttl - 5) * 1000).toISOString(),
    };
  }

  async accept(courierId: string, orderId: string) {
    if ((await this.redis.get(K.offer(orderId))) !== courierId) throw conflict('Esta oferta não está mais disponível');
    await this.core.transition(orderId, [OrderStatus.READY], { courierId, assignedAt: new Date() }, '"courierId" IS NULL');
    await this.redis.del(K.offer(orderId), K.holding(courierId), K.tried(orderId), K.round(orderId));
    await this.core.timeline(orderId, 'assigned', courierId);
    const order = await this.core.load(orderId);
    await this.core.broadcast(order, {
      customer: { type: 'order.assigned', title: 'Entregador a caminho da loja', body: `${order.courier!.name} vai buscar seu pedido em ${order.store.name}.` },
      store: { type: 'order.assigned', title: `Pedido #${order.number}`, body: `${order.courier!.name} está indo retirar.` },
    });
    return viewOrder(order, 'courier');
  }

  async decline(courierId: string, orderId: string) {
    if ((await this.redis.get(K.offer(orderId))) !== courierId) return { ok: true };
    await this.release(orderId, courierId);
    await this.queue.add('find', { kind: 'find', orderId }, { jobId: `find-${orderId}-${Date.now()}` });
    return { ok: true };
  }

  /** Entregador desiste antes de retirar: o pedido volta para a busca */
  async drop(courierId: string, orderId: string, reason?: string) {
    await this.core.transition(orderId, [OrderStatus.READY, OrderStatus.PREPARING], { courierId: null, assignedAt: null }, '"courierId" = :c', { c: courierId });
    await this.redis.sadd(K.tried(orderId), courierId);
    await this.core.timeline(orderId, 'dropped', courierId, reason);
    const order = await this.core.load(orderId);
    if (order.status === OrderStatus.READY) await this.queue.add('find', { kind: 'find', orderId }, { jobId: `find-${orderId}-${Date.now()}` });
    await this.core.broadcast(order, { store: { type: 'order.dropped', title: `Pedido #${order.number}`, body: 'O entregador desistiu. Estamos procurando outro.' } });
    return { ok: true };
  }

  // ───────────── admin

  /** Lista para "Atribuir entregador": todos os aprovados, os livres e mais perto primeiro */
  async candidates(orderId: string, q?: string) {
    const order = await this.ds.getRepository(Order).findOne({ where: { id: orderId }, relations: { store: true } });
    if (!order) throw notFound('Pedido');
    const couriers = await this.ds.getRepository(User).find({
      where: { role: Role.COURIER, status: UserStatus.ACTIVE, ...(q && { name: ILike(`%${q.replace(/[%_]/g, '')}%`) }) },
      order: { name: 'ASC' },
      take: 200,
    });
    const ids = couriers.map((c) => c.id);
    const [online, pos, busy, profiles] = await Promise.all([
      this.presence.onlineSet(ids),
      this.presence.positions(ids),
      this.core.busyCouriers(ids),
      ids.length ? this.ds.getRepository(CourierProfile).find({ where: { userId: In(ids) } }) : [],
    ]);
    const prof = new Map(profiles.map((p) => [p.userId, p]));
    const rank = (x: { online: boolean; busy: boolean }) => (x.online ? (x.busy ? 1 : 0) : 2);
    return couriers
      .map((c) => {
        const p = pos.get(c.id);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          avatarUrl: c.avatarUrl,
          online: online.has(c.id),
          busy: busy.has(c.id) && order.courierId !== c.id,
          current: order.courierId === c.id,
          distanceKm: p && online.has(c.id) ? round(distanceKm(p, order.store), 1) : null,
          vehicleType: prof.get(c.id)?.vehicleType ?? null,
          vehiclePlate: prof.get(c.id)?.vehiclePlate ?? null,
        };
      })
      .sort((a, b) => rank(a) - rank(b) || (a.distanceKm ?? 999) - (b.distanceKm ?? 999) || a.name.localeCompare(b.name, 'pt-BR'));
  }

  async assign(adminId: string, orderId: string, courierId: string) {
    const courier = await this.ds.getRepository(User).findOneBy({ id: courierId, role: Role.COURIER });
    if (!courier) throw notFound('Entregador');
    if (courier.status !== UserStatus.ACTIVE) throw badRequest('Este entregador não está ativo');
    const before = await this.core.load(orderId);
    if (before.courierId === courierId) throw badRequest('Este entregador já está no pedido');
    await this.stop(orderId);
    await this.core.transition(orderId, [OrderStatus.PREPARING, OrderStatus.READY], { courierId, assignedAt: new Date() });
    await this.core.timeline(orderId, 'assigned.manual', adminId, courier.name);
    await this.audit.record({ actorId: adminId, action: 'order.assign', targetType: 'ORDER', targetId: orderId, targetName: `#${before.number}`, reason: `Entregador: ${courier.name}` });
    const order = await this.core.load(orderId);
    const ready = order.status === OrderStatus.READY;
    await this.core.broadcast(order, {
      courier: { type: 'order.assigned', title: 'Você recebeu uma entrega', body: `${order.store.name} → ${order.deliveryAddress}${ready ? '' : ' (ainda em preparo)'}`, urgent: true },
      ...(ready && { customer: { type: 'order.assigned', title: 'Entregador a caminho da loja', body: `${courier.name} vai buscar seu pedido.` } }),
      store: { type: 'order.assigned', title: `Pedido #${order.number}`, body: `${courier.name} foi designado pela plataforma.` },
      extra: before.courierId ? [{ userId: before.courierId, n: { type: 'order.unassigned', title: `Pedido #${order.number}`, body: 'A plataforma passou esta entrega para outro entregador.' } }] : [],
    });
    return viewOrder(order, 'admin');
  }

  async unassign(adminId: string, orderId: string) {
    const before = await this.core.load(orderId);
    if (!before.courierId) throw badRequest('O pedido está sem entregador');
    await this.core.transition(orderId, [OrderStatus.PREPARING, OrderStatus.READY], { courierId: null, assignedAt: null });
    await this.core.timeline(orderId, 'unassigned', adminId);
    await this.audit.record({ actorId: adminId, action: 'order.unassign', targetType: 'ORDER', targetId: orderId, targetName: `#${before.number}` });
    const order = await this.core.load(orderId);
    if (order.status === OrderStatus.READY) await this.start(orderId);
    await this.core.broadcast(order, { extra: [{ userId: before.courierId, n: { type: 'order.unassigned', title: `Pedido #${order.number}`, body: 'A plataforma tirou esta entrega de você.' } }] });
    return viewOrder(order, 'admin');
  }
}
