import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { PageQuery } from '../../common/pagination';
import { DispatchService } from '../dispatch/dispatch.service';
import { AuditService } from '../moderation/audit.service';
import { SettingsService } from '../settings/settings.service';
import { Role } from '../users/user.entity';
import { AdminReasonDto, AssignDto, OrdersQuery, ReportsQuery, ResolveReportDto, SearchQuery, SettingsDto, StoresQuery, UsersQuery } from './admin.dto';
import { AdminService } from './admin.service';

const id = new ParseUUIDPipe();

@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly dispatch: DispatchService, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('fleet')
  fleet() {
    return this.admin.fleet();
  }

  @Get('approvals')
  approvals() {
    return this.admin.approvals();
  }

  // ── contas
  @Get('users')
  users(@Query() q: UsersQuery) {
    return this.admin.users(q);
  }

  @Get('users/:id')
  user(@Param('id', id) userId: string) {
    return this.admin.user(userId);
  }

  @Post('users/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() a: AuthUser, @Param('id', id) userId: string) {
    return this.admin.approveCourier(a, userId);
  }

  @Post('users/:id/request-changes')
  @HttpCode(200)
  changes(@CurrentUser() a: AuthUser, @Param('id', id) userId: string, @Body() dto: AdminReasonDto) {
    return this.admin.requestChanges(a, userId, dto.reason);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  block(@CurrentUser() a: AuthUser, @Param('id', id) userId: string, @Body() dto: AdminReasonDto) {
    return this.admin.block(a, userId, dto.reason);
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  unblock(@CurrentUser() a: AuthUser, @Param('id', id) userId: string) {
    return this.admin.unblock(a, userId);
  }

  // ── lojas e cardápio
  @Get('stores')
  stores(@Query() q: StoresQuery) {
    return this.admin.stores(q);
  }

  @Get('stores/:id')
  store(@Param('id', id) storeId: string) {
    return this.admin.store(storeId);
  }

  @Post('stores/:id/approve')
  @HttpCode(200)
  approveStore(@CurrentUser() a: AuthUser, @Param('id', id) storeId: string) {
    return this.admin.approveStore(a, storeId);
  }

  @Post('stores/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() a: AuthUser, @Param('id', id) storeId: string, @Body() dto: AdminReasonDto) {
    return this.admin.suspendStore(a, storeId, dto.reason);
  }

  @Post('stores/:id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() a: AuthUser, @Param('id', id) storeId: string) {
    return this.admin.reactivateStore(a, storeId);
  }

  @Post('products/:id/remove')
  @HttpCode(200)
  removeProduct(@CurrentUser() a: AuthUser, @Param('id', id) productId: string, @Body() dto: AdminReasonDto) {
    return this.admin.removeProduct(a, productId, dto.reason);
  }

  @Post('products/:id/restore')
  @HttpCode(200)
  restoreProduct(@CurrentUser() a: AuthUser, @Param('id', id) productId: string) {
    return this.admin.restoreProduct(a, productId);
  }

  // ── pedidos
  @Get('orders')
  orders(@Query() q: OrdersQuery) {
    return this.admin.ordersList(q);
  }

  @Get('orders/:id')
  order(@Param('id', id) orderId: string) {
    return this.admin.order(orderId);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() a: AuthUser, @Param('id', id) orderId: string, @Body() dto: AdminReasonDto) {
    return this.admin.cancelOrder(a, orderId, dto.reason);
  }

  /** Lista para o seletor "Atribuir entregador" */
  @Get('orders/:id/couriers')
  candidates(@Param('id', id) orderId: string, @Query() q: SearchQuery) {
    return this.dispatch.candidates(orderId, q.q);
  }

  @Post('orders/:id/assign')
  @HttpCode(200)
  assign(@CurrentUser() a: AuthUser, @Param('id', id) orderId: string, @Body() dto: AssignDto) {
    return this.dispatch.assign(a.id, orderId, dto.courierId);
  }

  @Post('orders/:id/unassign')
  @HttpCode(200)
  unassign(@CurrentUser() a: AuthUser, @Param('id', id) orderId: string) {
    return this.dispatch.unassign(a.id, orderId);
  }

  // ── moderação
  @Get('reports')
  reports(@Query() q: ReportsQuery) {
    return this.admin.reports(q);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() a: AuthUser, @Param('id', id) reportId: string, @Body() dto: ResolveReportDto) {
    return this.admin.resolveReport(a, reportId, dto);
  }

  @Get('audit')
  auditLog(@Query() q: PageQuery) {
    return this.admin.auditLog(q);
  }

  // ── regras da plataforma
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  async putSettings(@CurrentUser() a: AuthUser, @Body() dto: SettingsDto) {
    const v = await this.settings.update(dto);
    await this.audit.record({ actorId: a.id, action: 'settings.update', targetType: 'SETTINGS', targetId: a.id, targetName: 'Regras da plataforma', reason: JSON.stringify(dto) });
    return v;
  }
}
