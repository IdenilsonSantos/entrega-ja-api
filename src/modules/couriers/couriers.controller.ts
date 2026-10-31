import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { AllowPending, AuthUser, CurrentUser, Roles } from '../../common/auth';
import { badRequest } from '../../common/errors';
import { EventsService } from '../../infra/events/events.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PresenceService } from '../dispatch/presence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeliverDto, OptionalReasonDto, OrderListQuery } from '../orders/orders.dto';
import { OrdersService } from '../orders/orders.service';
import { DELIVERY_VISIBLE, Order, OrderStatus } from '../orders/order.entity';
import { Role, UserStatus } from '../users/user.entity';
import { CourierProfile, NEEDS_PLATE, VehicleType } from './courier-profile.entity';
import { In } from 'typeorm';

const id = new ParseUUIDPipe();
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]/g, '') : value);
const digits = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CourierProfileDto {
  @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) vehicleModel?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) vehicleColor?: string;
  @IsOptional() @Transform(upper) @Matches(/^([A-Z]{3}\d[A-Z0-9]\d{2})?$/, { message: 'Placa inválida (ex.: ABC1D23)' }) vehiclePlate?: string;
  @IsOptional() @Transform(digits) @Matches(/^(\d{11})?$/, { message: 'CPF precisa ter 11 dígitos' }) document?: string;
  @IsOptional() @Transform(digits) @Matches(/^(\d{9,11})?$/, { message: 'CNH inválida' }) licenseNumber?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) pixKey?: string;
}

class PresenceDto {
  @IsBoolean() online: boolean;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
}

class LocationDto {
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
  @IsOptional() @IsNumber() heading?: number;
}

/** O que mudar sem passar por nova análise. Trocar veículo ou documento avisa a moderação. */
const SENSITIVE: (keyof CourierProfileDto)[] = ['vehicleType', 'vehiclePlate', 'document', 'licenseNumber'];

@Controller('courier')
@Roles(Role.COURIER)
export class CourierController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly presence: PresenceService,
    private readonly dispatch: DispatchService,
    private readonly orders: OrdersService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  private profiles = () => this.ds.getRepository(CourierProfile);

  // ── perfil e veículo

  @AllowPending()
  @Get('profile')
  async profile(@CurrentUser() u: AuthUser) {
    const p = await this.profiles().findOneByOrFail({ userId: u.id });
    return { ...p, missing: this.missing(p) };
  }

  /** O que falta para a aprovação (a tela mostra uma lista de pendências) */
  private missing(p: CourierProfile) {
    const m: string[] = [];
    if (NEEDS_PLATE.includes(p.vehicleType)) {
      if (!p.vehiclePlate) m.push('vehiclePlate');
      if (!p.licenseNumber) m.push('licenseNumber');
    }
    if (p.vehicleType !== VehicleType.WALKING && !p.vehicleModel) m.push('vehicleModel');
    if (!p.document) m.push('document');
    if (!p.pixKey) m.push('pixKey');
    return m;
  }

  @AllowPending()
  @Patch('profile')
  async update(@CurrentUser() u: AuthUser, @Body() dto: CourierProfileDto) {
    const p = await this.profiles().findOneByOrFail({ userId: u.id });
    const changed = SENSITIVE.filter((k) => dto[k] !== undefined && (dto[k] || null) !== (p[k as keyof CourierProfile] ?? null));
    // só os campos enviados; string vazia apaga o campo
    const sent = Object.entries(dto).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === '' ? null : v]);
    const next = { ...p, ...Object.fromEntries(sent) } as CourierProfile;
    if (!NEEDS_PLATE.includes(next.vehicleType)) next.vehiclePlate = null;
    await this.profiles().save(next);
    if (changed.length && u.status === UserStatus.ACTIVE) {
      await this.notifications.notifyAdmins({ type: 'courier.updated', title: 'Entregador alterou dados', body: `${u.name} mudou ${changed.length > 1 ? 'dados do veículo/documentos' : 'um dado do veículo/documento'}. Confira se está tudo certo.`, link: `/admin/entregadores?id=${u.id}` });
    }
    return { ...next, missing: this.missing(next) };
  }

  // ── turno

  /** Estado ao abrir o app: online?, oferta em aberto, entregas em andamento */
  @AllowPending()
  @Get('status')
  async status(@CurrentUser() u: AuthUser) {
    const pending = u.status !== UserStatus.ACTIVE;
    const profile = await this.profiles().findOneByOrFail({ userId: u.id });
    const [online, offer, active] = pending ? [false, null, []] : await Promise.all([this.presence.isOnline(u.id), this.dispatch.currentOffer(u.id), this.orders.courierActive(u.id)]);
    // wantsOnline: o app liga sozinho ao abrir (só falta mandar a localização)
    return { approved: !pending, online, wantsOnline: !pending && profile.wantsOnline, offer, active };
  }

  @Post('presence')
  @HttpCode(200)
  async setPresence(@CurrentUser() u: AuthUser, @Body() dto: PresenceDto) {
    if (dto.online) {
      if (dto.lat === undefined || dto.lng === undefined) throw badRequest('Ative a localização para ficar online');
      const p = await this.profiles().findOneByOrFail({ userId: u.id });
      if (this.missing(p).length) throw badRequest('Complete seu perfil (veículo, documentos e Pix) para ficar online');
      await this.presence.online(u.id, dto.lat, dto.lng);
      if (!p.wantsOnline) await this.profiles().update({ userId: u.id }, { wantsOnline: true });
      await this.events.toAdmins('fleet.location', { courierId: u.id, name: u.name, lat: dto.lat, lng: dto.lng, online: true }, { ephemeral: true });
    } else {
      const offer = await this.dispatch.currentOffer(u.id);
      if (offer) await this.dispatch.decline(u.id, offer.orderId);
      await this.presence.offline(u.id);
      await this.profiles().update({ userId: u.id }, { wantsOnline: false });
      await this.events.toAdmins('fleet.location', { courierId: u.id, online: false }, { ephemeral: true });
    }
    return { online: dto.online };
  }

  /** Enviado a cada poucos segundos pelo app enquanto online */
  @Post('location')
  @HttpCode(200)
  async location(@CurrentUser() u: AuthUser, @Body() dto: LocationDto) {
    let online = await this.presence.move(u.id, dto.lat, dto.lng);
    if (!online) {
      // caiu por falta de sinal (presença expirou) mas não escolheu sair: volta sozinho
      const p = await this.profiles().findOneBy({ userId: u.id });
      if (!p?.wantsOnline) return { online: false };
      await this.presence.online(u.id, dto.lat, dto.lng);
      online = true;
    }
    const active = await this.ds.getRepository(Order).find({ select: { id: true, customerId: true, status: true }, where: { courierId: u.id, status: In([OrderStatus.READY, OrderStatus.PICKED_UP]) } });
    const pos = { courierId: u.id, lat: dto.lat, lng: dto.lng, heading: dto.heading ?? null, at: new Date().toISOString() };
    await Promise.all([
      ...active.filter((o) => DELIVERY_VISIBLE.includes(o.status)).map((o) => this.events.toUsers([o.customerId], 'courier.location', { ...pos, orderId: o.id }, { ephemeral: true })),
      this.events.toAdmins('fleet.location', { ...pos, name: u.name, online: true, busy: active.length > 0 }, { ephemeral: true }),
    ]);
    return { online: true };
  }

  // ── ofertas e entregas

  @Post('offers/:orderId/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('orderId', id) orderId: string) {
    return this.dispatch.accept(u.id, orderId);
  }

  @Post('offers/:orderId/decline')
  @HttpCode(200)
  decline(@CurrentUser() u: AuthUser, @Param('orderId', id) orderId: string) {
    return this.dispatch.decline(u.id, orderId);
  }

  @Post('orders/:orderId/pickup')
  @HttpCode(200)
  pickup(@CurrentUser() u: AuthUser, @Param('orderId', id) orderId: string) {
    return this.orders.pickup(u.id, orderId);
  }

  @Post('orders/:orderId/deliver')
  @HttpCode(200)
  deliver(@CurrentUser() u: AuthUser, @Param('orderId', id) orderId: string, @Body() dto: DeliverDto) {
    return this.orders.deliver(u.id, orderId, dto.code);
  }

  @Post('orders/:orderId/drop')
  @HttpCode(200)
  drop(@CurrentUser() u: AuthUser, @Param('orderId', id) orderId: string, @Body() dto: OptionalReasonDto) {
    return this.dispatch.drop(u.id, orderId, dto.reason);
  }

  @Get('deliveries')
  history(@CurrentUser() u: AuthUser, @Query() q: OrderListQuery) {
    return this.orders.courierHistory(u.id, q);
  }

  @Get('earnings')
  earnings(@CurrentUser() u: AuthUser) {
    return this.orders.courierEarnings(u.id);
  }
}
