import { Global, Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module';
import { OrderCore } from './order-core.service';

@Global()
@Module({ imports: [MerchantModule], providers: [OrderCore], exports: [OrderCore, MerchantModule] })
export class OrdersCoreModule {}
