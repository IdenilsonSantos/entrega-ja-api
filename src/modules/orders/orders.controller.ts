import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { Role } from '../users/user.entity';
import { viewOrder } from './order-view';
import { CreateOrderDto, OrderListQuery, RateDto, ReasonDto, StatsQuery } from './orders.dto';
import { OrdersService } from './orders.service';

const id = new ParseUUIDPipe();

@Controller('orders')
@Roles(Role.CUSTOMER)
export class CustomerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(u, dto);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: OrderListQuery) {
    return this.orders.listMine(u, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string) {
    return this.orders.getForCustomer(u, orderId);
  }

  @Get(':id/tracking')
  tracking(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string) {
    return this.orders.tracking(u, orderId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string) {
    return this.orders.cancelByCustomer(u, orderId);
  }

  @Post(':id/rate')
  @HttpCode(200)
  rate(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string, @Body() dto: RateDto) {
    return this.orders.rate(u, orderId, dto.rating, dto.comment);
  }
}

@Controller('merchant')
@Roles(Role.MERCHANT)
export class MerchantOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('stores/:storeId/orders')
  list(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Query() q: OrderListQuery) {
    return this.orders.listForStore(u.id, storeId, q);
  }

  @Get('stores/:storeId/stats')
  stats(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Query() q: StatsQuery) {
    return this.orders.storeStats(u.id, storeId, q.days);
  }

  @Get('orders/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string) {
    return this.orders.getForStore(u.id, orderId);
  }

  @Post('orders/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string) {
    return this.orders.accept(u, orderId);
  }

  @Post('orders/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string, @Body() dto: ReasonDto) {
    return this.orders.reject(u, orderId, dto.reason);
  }

  @Post('orders/:id/ready')
  @HttpCode(200)
  ready(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string) {
    return this.orders.ready(u, orderId);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() u: AuthUser, @Param('id', id) orderId: string, @Body() dto: ReasonDto) {
    return viewOrder(await this.orders.cancelByStore(u, orderId, dto.reason), 'store');
  }
}
