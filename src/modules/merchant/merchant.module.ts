import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuCategory, Product } from '../catalog/catalog.entity';
import { MenuService } from '../catalog/menu.service';
import { Store } from '../stores/store.entity';
import { User } from '../users/user.entity';
import { InvitesController, MerchantController } from './merchant.controller';
import { MerchantStoresService } from './merchant-stores.service';
import { StoreAccessService } from './store-access.service';
import { StoreInvite, StoreMember } from './store-member.entity';
import { TeamService } from './team.service';

@Module({
  imports: [TypeOrmModule.forFeature([Store, StoreMember, StoreInvite, MenuCategory, Product, User])],
  controllers: [MerchantController, InvitesController],
  providers: [StoreAccessService, TeamService, MerchantStoresService, MenuService],
  exports: [StoreAccessService, TeamService],
})
export class MerchantModule {}
