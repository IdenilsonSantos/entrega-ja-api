import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGuard } from './common/auth';
import { RateLimitGuard } from './common/rate-limit';
import { config } from './config';
import { dataSourceOptions } from './infra/database/data-source';
import { EventsModule } from './infra/events/events.module';
import { MailModule } from './infra/mail/mail.service';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.module';
import { StorageModule } from './infra/storage/storage.service';
import { AddressesModule } from './modules/addresses/addresses.controller';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CouriersModule } from './modules/couriers/couriers.module';
import { EventsHttpModule } from './modules/events/events.controller';
import { HealthModule } from './modules/health/health.controller';
import { MerchantModule } from './modules/merchant/merchant.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersCoreModule } from './modules/orders/orders-core.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SettingsModule } from './modules/settings/settings.service';
import { StoresModule } from './modules/stores/stores.module';

@Module({
  imports: [
    // infraestrutura
    TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: false }),
    TypeOrmModule.forFeature(dataSourceOptions.entities),
    JwtModule.register({ global: true, secret: config.jwt.secret, signOptions: { expiresIn: config.jwt.expiresIn as never } }),
    RedisModule,
    QueueModule,
    EventsModule,
    StorageModule,
    MailModule,
    // transversais
    SettingsModule,
    NotificationsModule,
    OrdersCoreModule,
    // funcionalidades
    AuthModule,
    MerchantModule,
    StoresModule,
    AddressesModule,
    OrdersModule,
    CouriersModule,
    ModerationModule,
    AdminModule,
    EventsHttpModule,
    HealthModule,
  ],
  // a ordem importa: o limite vem antes do login, para uma enxurrada não chegar ao banco
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
