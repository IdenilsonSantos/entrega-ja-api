import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, In } from 'typeorm';
import { AuthUser, invalidateAuth } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { round } from '../../common/geo';
import { mapPage, paginate } from '../../common/pagination';
import { EventsService } from '../../infra/events/events.service';
import { REDIS } from '../../infra/redis/redis.module';
import { ModerationStatus, Product } from '../catalog/catalog.entity';
import { CourierProfile } from '../couriers/courier-profile.entity';
import { DispatchService } from '../dispatch/dispatch.service';
import { PresenceService } from '../dispatch/presence.service';
import { StoreAccessService } from '../merchant/store-access.service';
import { StoreMember } from '../merchant/store-member.entity';
import { AuditService } from '../moderation/audit.service';
import { AuditLog, Report, ReportStatus, ReportTarget } from '../moderation/moderation.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderCore } from '../orders/order-core.service';
import { ACTIVE_STATUSES, Order, OrderStatus } from '../orders/order.entity';
import { viewOrder } from '../orders/order-view';
import { OrdersService } from '../orders/orders.service';
import { Store, StoreStatus } from '../stores/store.entity';
import { publicUser, Role, User, UserStatus } from '../users/user.entity';
import { OrdersQuery, ReportsQuery, ResolveReportDto, StoresQuery, UsersQuery } from './admin.dto';

const like = (q: string) => `%${q.replace(/[%_]/g, '')}%`;

/**
 * Administração da plataforma: acesso total e moderação.
 * Toda ação que muda algo de outra pessoa fica no registro de auditoria e avisa quem foi afetado.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly orders: OrdersService,
    private readonly core: OrderCore,
    private readonly dispatch: DispatchService,
    private readonly presence: PresenceService,
    private readonly access: StoreAccessService,
    private readonly events: EventsService,
  ) {}

  // ───────────── visão geral

  async overview() {
    const [today] = await this.ds.query(
      `SELECT count(*)::int AS orders,
              count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
              count(*) FILTER (WHERE status IN ('REJECTED','CANCELLED'))::int AS lost,
              coalesce(sum("totalCents") FILTER (WHERE status = 'DELIVERED'), 0)::int AS gmv,
              coalesce(sum("platformFeeCents") FILTER (WHERE status = 'DELIVERED'), 0)::int AS revenue,
              coalesce(avg(extract(epoch FROM ("deliveredAt" - "createdAt")) / 60) FILTER (WHERE status = 'DELIVERED'), 0)::float AS "avgMin"
         FROM orders WHERE "createdAt" >= date_trunc('day', now())`,
    );
    const statusRows: { status: OrderStatus; n: number }[] = await this.ds.query(`SELECT status, count(*)::int AS n FROM orders WHERE status = ANY($1) GROUP BY status`, [ACTIVE_STATUSES]);
    const [pending] = await this.ds.query(
      `SELECT (SELECT count(*) FROM stores WHERE status = 'PENDING')::int AS stores,
              (SELECT count(*) FROM users WHERE role = 'COURIER' AND status = 'PENDING')::int AS couriers,
              (SELECT count(*) FROM reports WHERE status = 'OPEN')::int AS reports,
              (SELECT count(*) FROM orders WHERE status = 'READY' AND "courierId" IS NULL)::int AS "waitingCourier"`,
    );
    const daily = await this.ds.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(x.orders, 0)::int AS orders, coalesce(x.gmv, 0)::int AS gmv
         FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), '1 day') d
         LEFT JOIN (SELECT date_trunc('day', "createdAt") AS day, count(*) AS orders, sum("totalCents") FILTER (WHERE status = 'DELIVERED') AS gmv
                      FROM orders WHERE "createdAt" >= now() - interval '14 days' GROUP BY 1) x ON x.day = d ORDER BY d`,
    );
    const fleet = await this.presence.all();
    return {
      today: { ...today, avgMin: round(today.avgMin, 1) },
      active: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
      pending,
      couriersOnline: fleet.length,
      daily,
    };
  }

  /** Mapa ao vivo: entregadores online e pedidos em entrega */
  async fleet() {
    const online = await this.presence.all();
    const ids = online.map((o) => o.id);
    const [users, busy] = await Promise.all([ids.length ? this.ds.getRepository(User).findBy({ id: In(ids) }) : [], this.core.busyCouriers(ids)]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    const orders = await this.ds.getRepository(Order).find({ where: { status: In([OrderStatus.READY, OrderStatus.PICKED_UP]) }, relations: { store: true } });
    return {
      couriers: online.map((c) => ({ courierId: c.id, name: names.get(c.id) ?? '—', lat: c.lat, lng: c.lng, busy: busy.has(c.id) })),
      orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, courierId: o.courierId, store: { name: o.store.name, lat: o.store.lat, lng: o.store.lng }, deliveryLat: o.deliveryLat, deliveryLng: o.deliveryLng })),
    };
  }

  // ───────────── contas

  async users(q: UsersQuery) {
    const qb = this.ds.getRepository(User).createQueryBuilder('u');
    if (q.role) qb.andWhere('u.role = :r', { r: q.role });
    if (q.status) qb.andWhere('u.status = :s', { s: q.status });
    if (q.q) qb.andWhere('(u.name ILIKE :q OR u.email ILIKE :q)', { q: like(q.q) });
    const page = await paginate(qb, q);
    const online = await this.presence.onlineSet(page.items.filter((u) => u.role === Role.COURIER).map((u) => u.id));
    return mapPage(page, (u) => ({ ...publicUser(u), ...(u.role === Role.COURIER && { online: online.has(u.id) }) }));
  }

  async user(id: string) {
    const u = await this.ds.getRepository(User).findOneBy({ id });
    if (!u) throw notFound('Conta');
    const extra: Record<string, unknown> = {};
    if (u.role === Role.COURIER) {
      extra.courier = await this.ds.getRepository(CourierProfile).findOneBy({ userId: id });
      extra.online = await this.presence.isOnline(id);
      extra.earnings = await this.orders.courierEarnings(id);
    }
    if (u.role === Role.MERCHANT) {
      const m = await this.ds.getRepository(StoreMember).find({ where: { userId: id }, relations: { store: true } });
      extra.stores = m.map((x) => ({ id: x.store.id, name: x.store.name, status: x.store.status, role: x.role }));
    }
    const [counts] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE "customerId" = $1)::int AS "asCustomer", count(*) FILTER (WHERE "courierId" = $1)::int AS "asCourier" FROM orders WHERE "customerId" = $1 OR "courierId" = $1`,
      [id],
    );
    const reports = await this.ds.getRepository(Report).count({ where: { targetType: ReportTarget.USER, targetId: id } });
    return { ...publicUser(u), ...extra, orders: counts, reports };
  }

  private async setUserStatus(admin: AuthUser, id: string, status: UserStatus, action: string, reason: string | null) {
    const u = await this.ds.getRepository(User).findOneBy({ id });
    if (!u) throw notFound('Conta');
    if (u.id === admin.id) throw badRequest('Você não pode mudar a própria conta');
    if (u.role === Role.ADMIN && status === UserStatus.BLOCKED) throw badRequest('Contas de admin não podem ser bloqueadas por aqui');
    // bloquear derruba as sessões abertas
    await this.ds.getRepository(User).update(id, { status, statusReason: reason, ...(status === UserStatus.BLOCKED && { tokenVersion: () => '"tokenVersion" + 1' }) });
    if (status === UserStatus.ACTIVE && u.role === Role.COURIER) await this.ds.getRepository(CourierProfile).update({ userId: id }, { approvedAt: new Date() });
    if (status !== UserStatus.ACTIVE && u.role === Role.COURIER) await this.presence.offline(id);
    await invalidateAuth(this.redis, id);
    await this.audit.record({ actorId: admin.id, action, targetType: 'USER', targetId: id, targetName: u.name, reason });
    return u;
  }

  async approveCourier(admin: AuthUser, id: string) {
    const u = await this.ds.getRepository(User).findOneBy({ id, role: Role.COURIER });
    if (!u) throw notFound('Entregador');
    if (u.status !== UserStatus.PENDING) throw badRequest('Este entregador não está em análise');
    await this.setUserStatus(admin, id, UserStatus.ACTIVE, 'courier.approve', null);
    await this.notifications.notify([id], { type: 'account.approved', title: 'Cadastro aprovado', body: 'Você já pode ficar online e receber corridas.', link: '/entregador' });
    return { ok: true };
  }

  /** Devolve o cadastro com o que precisa corrigir (continua em análise) */
  async requestChanges(admin: AuthUser, id: string, reason: string) {
    const u = await this.ds.getRepository(User).findOneBy({ id, role: Role.COURIER, status: UserStatus.PENDING });
    if (!u) throw notFound('Entregador em análise');
    await this.ds.getRepository(User).update(id, { statusReason: reason });
    await invalidateAuth(this.redis, id);
    await this.audit.record({ actorId: admin.id, action: 'courier.changes', targetType: 'USER', targetId: id, targetName: u.name, reason });
    await this.notifications.notify([id], { type: 'account.changes', title: 'Ajuste no cadastro', body: reason, link: '/entregador/perfil' });
    return { ok: true };
  }

  async block(admin: AuthUser, id: string, reason: string) {
    const u = await this.setUserStatus(admin, id, UserStatus.BLOCKED, 'user.block', reason);
    await this.events.toUsers([id], 'session.revoked', { reason });
    return { ok: true, name: u.name };
  }

  async unblock(admin: AuthUser, id: string) {
    const u = await this.ds.getRepository(User).findOneBy({ id });
    if (!u) throw notFound('Conta');
    if (u.status !== UserStatus.BLOCKED) throw badRequest('Esta conta não está bloqueada');
    await this.setUserStatus(admin, id, UserStatus.ACTIVE, 'user.unblock', null);
    await this.notifications.notify([id], { type: 'account.unblocked', title: 'Conta liberada', body: 'Sua conta voltou a funcionar normalmente.' });
    return { ok: true };
  }

  async approvals() {
    const [stores, couriers] = await Promise.all([
      this.ds.getRepository(Store).find({ where: { status: StoreStatus.PENDING }, relations: { owner: true }, order: { createdAt: 'ASC' } }),
      this.ds.getRepository(User).find({ where: { role: Role.COURIER, status: UserStatus.PENDING }, order: { createdAt: 'ASC' } }),
    ]);
    const profiles = couriers.length ? await this.ds.getRepository(CourierProfile).findBy({ userId: In(couriers.map((c) => c.id)) }) : [];
    const pmap = new Map(profiles.map((p) => [p.userId, p]));
    return {
      stores: stores.map((s) => ({ ...s, owner: { id: s.owner.id, name: s.owner.name, email: s.owner.email, phone: s.owner.phone } })),
      couriers: couriers.map((c) => ({ ...publicUser(c), courier: pmap.get(c.id) ?? null })),
    };
  }

  // ───────────── lojas

  async stores(q: StoresQuery) {
    const qb = this.ds.getRepository(Store).createQueryBuilder('s').leftJoinAndSelect('s.owner', 'owner');
    if (q.status) qb.andWhere('s.status = :st', { st: q.status });
    if (q.q) qb.andWhere('(s.name ILIKE :q OR s.category ILIKE :q OR owner.name ILIKE :q)', { q: like(q.q) });
    const page = await paginate(qb, q);
    return mapPage(page, (s) => ({ ...s, owner: { id: s.owner.id, name: s.owner.name, email: s.owner.email } }));
  }

  async store(id: string) {
    const s = await this.ds.getRepository(Store).findOne({ where: { id }, relations: { owner: true } });
    if (!s) throw notFound('Loja');
    const [team, products, [stats], reports] = await Promise.all([
      this.ds.getRepository(StoreMember).find({ where: { storeId: id }, relations: { user: true }, order: { createdAt: 'ASC' } }),
      this.ds.getRepository(Product).find({ where: { storeId: id }, order: { position: 'ASC' } }),
      this.ds.query(
        `SELECT count(*)::int AS orders, count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered, count(*) FILTER (WHERE status IN ('REJECTED','CANCELLED'))::int AS lost, coalesce(sum("subtotalCents") FILTER (WHERE status = 'DELIVERED'), 0)::int AS revenue FROM orders WHERE "storeId" = $1 AND "createdAt" >= now() - interval '30 days'`,
        [id],
      ),
      this.ds.getRepository(Report).count({ where: { targetType: ReportTarget.STORE, targetId: id } }),
    ]);
    return {
      ...s,
      owner: { id: s.owner.id, name: s.owner.name, email: s.owner.email, phone: s.owner.phone },
      team: team.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role })),
      products,
      stats30d: stats,
      reports,
    };
  }

  private async setStoreStatus(admin: AuthUser, id: string, status: StoreStatus, action: string, reason: string | null, notice: { title: string; body: string }) {
    const s = await this.ds.getRepository(Store).findOneBy({ id });
    if (!s) throw notFound('Loja');
    await this.ds.getRepository(Store).update(id, { status, statusReason: reason, ...(status !== StoreStatus.ACTIVE && { isOpen: false }) });
    await this.audit.record({ actorId: admin.id, action, targetType: 'STORE', targetId: id, targetName: s.name, reason });
    const staff = await this.access.memberIds(id);
    await this.notifications.notify(staff, { ...notice, type: action, link: `/loja/${id}` });
    return { ok: true };
  }

  approveStore(admin: AuthUser, id: string) {
    return this.setStoreStatus(admin, id, StoreStatus.ACTIVE, 'store.approve', null, { title: 'Loja aprovada', body: 'Sua loja já pode abrir e receber pedidos.' });
  }

  suspendStore(admin: AuthUser, id: string, reason: string) {
    return this.setStoreStatus(admin, id, StoreStatus.SUSPENDED, 'store.suspend', reason, { title: 'Loja suspensa', body: reason });
  }

  reactivateStore(admin: AuthUser, id: string) {
    return this.setStoreStatus(admin, id, StoreStatus.ACTIVE, 'store.reactivate', null, { title: 'Loja reativada', body: 'Sua loja voltou ao ar.' });
  }

  async removeProduct(admin: AuthUser, id: string, reason: string) {
    const p = await this.ds.getRepository(Product).findOne({ where: { id }, relations: { store: true } });
    if (!p) throw notFound('Produto');
    await this.ds.getRepository(Product).update(id, { moderation: ModerationStatus.REMOVED, moderationReason: reason, available: false });
    await this.audit.record({ actorId: admin.id, action: 'product.remove', targetType: 'PRODUCT', targetId: id, targetName: `${p.name} (${p.store.name})`, reason });
    await this.notifications.notify(await this.access.memberIds(p.storeId, 'menu.edit'), { type: 'product.removed', title: 'Produto removido do cardápio', body: `${p.name}: ${reason}`, link: `/loja/${p.storeId}/cardapio` });
    return { ok: true };
  }

  async restoreProduct(admin: AuthUser, id: string) {
    const p = await this.ds.getRepository(Product).findOne({ where: { id }, relations: { store: true } });
    if (!p) throw notFound('Produto');
    await this.ds.getRepository(Product).update(id, { moderation: ModerationStatus.VISIBLE, moderationReason: null });
    await this.audit.record({ actorId: admin.id, action: 'product.restore', targetType: 'PRODUCT', targetId: id, targetName: `${p.name} (${p.store.name})` });
    await this.notifications.notify(await this.access.memberIds(p.storeId, 'menu.edit'), { type: 'product.restored', title: 'Produto liberado', body: `${p.name} pode voltar ao cardápio. Marque como disponível quando quiser.`, link: `/loja/${p.storeId}/cardapio` });
    return { ok: true };
  }

  // ───────────── pedidos

  ordersList(q: OrdersQuery) {
    return this.orders.listPage(
      (qb) => {
        qb.where('1=1');
        if (q.status) qb.andWhere('o.status = :st', { st: q.status });
        if (q.storeId) qb.andWhere('o.storeId = :s', { s: q.storeId });
        if (q.userId) qb.andWhere('(o.customerId = :u OR o.courierId = :u)', { u: q.userId });
        if (q.number) qb.andWhere('o.number = :n', { n: q.number });
      },
      q,
      'admin',
    );
  }

  async order(id: string) {
    const o = await this.core.load(id);
    return { ...viewOrder(o, 'admin'), deliveryCode: o.deliveryCode, timeline: await this.core.history(id) };
  }

  async cancelOrder(admin: AuthUser, id: string, reason: string) {
    const o = await this.orders.cancel(id, ACTIVE_STATUSES, 'ADMIN', admin.id, reason);
    await this.audit.record({ actorId: admin.id, action: 'order.cancel', targetType: 'ORDER', targetId: id, targetName: `#${o.number}`, reason });
    return viewOrder(o, 'admin');
  }

  // ───────────── denúncias e auditoria

  async reports(q: ReportsQuery) {
    const qb = this.ds.getRepository(Report).createQueryBuilder('r').leftJoinAndSelect('r.reporter', 'reporter');
    if (q.status) qb.andWhere('r.status = :s', { s: q.status });
    const page = await paginate(qb, q);
    return mapPage(page, (r) => ({ ...r, reporter: { id: r.reporter.id, name: r.reporter.name, role: r.reporter.role } }));
  }

  async resolveReport(admin: AuthUser, id: string, dto: ResolveReportDto) {
    const r = await this.ds.getRepository(Report).findOneBy({ id });
    if (!r) throw notFound('Denúncia');
    if (r.status !== ReportStatus.OPEN) throw badRequest('Esta denúncia já foi tratada');
    if (dto.action) {
      const expected = { block_user: ReportTarget.USER, suspend_store: ReportTarget.STORE, remove_product: ReportTarget.PRODUCT }[dto.action];
      if (r.targetType !== expected) throw badRequest('Esta ação não serve para o item denunciado');
      if (dto.action === 'block_user') await this.block(admin, r.targetId, dto.resolution);
      if (dto.action === 'suspend_store') await this.suspendStore(admin, r.targetId, dto.resolution);
      if (dto.action === 'remove_product') await this.removeProduct(admin, r.targetId, dto.resolution);
    }
    await this.ds.getRepository(Report).update(id, { status: dto.status, resolution: dto.resolution, resolvedById: admin.id, resolvedAt: new Date() });
    await this.audit.record({ actorId: admin.id, action: dto.status === ReportStatus.RESOLVED ? 'report.resolve' : 'report.dismiss', targetType: 'REPORT', targetId: id, targetName: r.targetName, reason: dto.resolution });
    await this.notifications.notify([r.reporterId], { type: 'report.closed', title: 'Sua denúncia foi analisada', body: `${r.targetName}: ${dto.status === ReportStatus.RESOLVED ? 'tomamos providências' : 'não encontramos problema'}. Obrigado por avisar.` });
    return { ok: true };
  }

  async auditLog(q: { limit?: number; cursor?: string }) {
    const qb = this.ds.getRepository(AuditLog).createQueryBuilder('a').leftJoinAndSelect('a.actor', 'actor');
    const page = await paginate(qb, q);
    return mapPage(page, (a) => ({ ...a, actor: { id: a.actor.id, name: a.actor.name } }));
  }
}
