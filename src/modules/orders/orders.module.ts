import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { CustomerOrdersController, MerchantOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [DispatchModule],
  controllers: [CustomerOrdersController, MerchantOrdersController],
  providers: [OrdersService],
  exports: [OrdersService, DispatchModule],
})
export class OrdersModule {}
