import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { DeviceToken, Notification, PushSubscription } from './notification.entity';
import { NotificationsController, PushController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { PushWorker } from './push.worker';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification, PushSubscription, DeviceToken, User])],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, PushService, PushWorker],
  exports: [NotificationsService],
})
export class NotificationsModule {}
