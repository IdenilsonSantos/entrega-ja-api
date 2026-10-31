import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({ imports: [MerchantModule], controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
