import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({ imports: [OrdersModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
