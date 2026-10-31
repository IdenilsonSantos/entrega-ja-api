import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { AllowPending, AuthUser, CurrentUser, Public } from '../../common/auth';
import { PageQuery } from '../../common/pagination';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceToken, PushSubscription } from './notification.entity';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

class ListQuery extends PageQuery {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean;
}

class ReadDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids?: string[];
}

class SubKeys {
  @IsString() @MaxLength(200) p256dh: string;
  @IsString() @MaxLength(100) auth: string;
}

class SubscribeDto {
  @IsUrl({ require_tld: false }) @MaxLength(600) endpoint: string;
  @ValidateNested() @Type(() => SubKeys) keys: SubKeys;
}

class UnsubscribeDto {
  @IsString() @MaxLength(600) endpoint: string;
}

class DeviceDto {
  @IsString() @MaxLength(200) token: string;
  @IsOptional() @IsIn(['ios', 'android', 'web']) platform?: string;
}

@Controller('notifications')
@AllowPending()
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.svc.list(u.id, q);
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: AuthUser) {
    return { unread: await this.svc.unreadCount(u.id) };
  }

  /** Sem ids marca todas como lidas */
  @Post('read')
  @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Body() dto: ReadDto) {
    return this.svc.markRead(u.id, dto.ids);
  }
}

@Controller('push')
@AllowPending()
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly notifications: NotificationsService,
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
    @InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>,
  ) {}

  @Public()
  @Get('vapid-key')
  async key() {
    return { publicKey: (await this.push.vapidKeys()).publicKey };
  }

  /** Inscreve este navegador. O mesmo endpoint troca de dono se outra pessoa entrar nele. */
  @Post('subscriptions')
  async subscribe(@CurrentUser() u: AuthUser, @Body() dto: SubscribeDto) {
    await this.subs.upsert({ userId: u.id, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth }, ['endpoint']);
    return { ok: true };
  }

  @Delete('subscriptions')
  async unsubscribe(@CurrentUser() u: AuthUser, @Body() dto: UnsubscribeDto) {
    await this.subs.delete({ userId: u.id, endpoint: dto.endpoint });
    return { ok: true };
  }

  @Post('devices')
  async device(@CurrentUser() u: AuthUser, @Body() dto: DeviceDto) {
    await this.devices.upsert({ userId: u.id, token: dto.token, platform: dto.platform ?? null }, ['token']);
    return { ok: true };
  }

  @Delete('devices/:token')
  async removeDevice(@CurrentUser() u: AuthUser, @Param('token') token: string) {
    await this.devices.delete({ userId: u.id, token });
    return { ok: true };
  }

  /** Botão "Enviar notificação de teste" nas configurações */
  @Post('test')
  @HttpCode(200)
  async test(@CurrentUser() u: AuthUser) {
    const [web, native] = await Promise.all([this.subs.count({ where: { userId: u.id } }), this.devices.count({ where: { userId: u.id } })]);
    await this.notifications.notify([u.id], { type: 'test', title: 'Notificações ligadas', body: 'É assim que os avisos do Entrega Já vão chegar.' });
    return { web, native };
  }
}
