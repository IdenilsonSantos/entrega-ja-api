import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { CustomerOrdersController, MerchantOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersWorker } from './orders.worker';

@Module({
  imports: [DispatchModule],
  controllers: [CustomerOrdersController, MerchantOrdersController],
  providers: [OrdersService, OrdersWorker],
  exports: [OrdersService, DispatchModule],
})
export class OrdersModule {}
