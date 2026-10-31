import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CourierController } from './couriers.controller';

@Module({ imports: [OrdersModule], controllers: [CourierController] })
export class CouriersModule {}
