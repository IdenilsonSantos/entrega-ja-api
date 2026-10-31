import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser, Public, Roles } from '../../common/auth';
import { MenuService } from '../catalog/menu.service';
import { Role } from '../users/user.entity';
import { AvailabilityDto, CategoryDto, InviteDto, OpenDto, ProductDto, ReorderDto, RoleDto, StoreDto, UpdateStoreDto } from './merchant.dto';
import { MerchantStoresService } from './merchant-stores.service';
import { TeamService } from './team.service';

const id = new ParseUUIDPipe();

/** Painel do lojista: lojas, equipe e cardápio. Os pedidos ficam em OrdersModule. */
@Controller('merchant')
@Roles(Role.MERCHANT)
export class MerchantController {
  constructor(private readonly stores: MerchantStoresService, private readonly team: TeamService, private readonly menu: MenuService) {}

  @Get('stores')
  myStores(@CurrentUser() u: AuthUser) {
    return this.team.myStores(u.id);
  }

  @Post('stores')
  create(@CurrentUser() u: AuthUser, @Body() dto: StoreDto) {
    return this.stores.create(u.id, dto);
  }

  @Get('stores/:storeId')
  get(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string) {
    return this.stores.get(u.id, storeId);
  }

  @Patch('stores/:storeId')
  update(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Body() dto: UpdateStoreDto) {
    return this.stores.update(u.id, storeId, dto);
  }

  @Post('stores/:storeId/open')
  @HttpCode(200)
  open(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Body() dto: OpenDto) {
    return this.stores.setOpen(u.id, storeId, dto.isOpen);
  }

  @Post('stores/:storeId/logo')
  @UseInterceptors(FileInterceptor('file'))
  logo(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @UploadedFile() file?: Express.Multer.File) {
    return this.stores.image(u.id, storeId, 'logo', file);
  }

  @Post('stores/:storeId/cover')
  @UseInterceptors(FileInterceptor('file'))
  cover(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @UploadedFile() file?: Express.Multer.File) {
    return this.stores.image(u.id, storeId, 'cover', file);
  }

  // ── equipe

  @Get('stores/:storeId/team')
  teamList(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string) {
    return this.team.list(u.id, storeId);
  }

  @Post('stores/:storeId/invites')
  invite(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Body() dto: InviteDto) {
    return this.team.invite(u.id, storeId, dto.email, dto.role);
  }

  @Delete('stores/:storeId/invites/:inviteId')
  revoke(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('inviteId', id) inviteId: string) {
    return this.team.revokeInvite(u.id, storeId, inviteId);
  }

  @Patch('stores/:storeId/members/:memberId')
  role(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('memberId', id) memberId: string, @Body() dto: RoleDto) {
    return this.team.changeRole(u.id, storeId, memberId, dto.role);
  }

  @Delete('stores/:storeId/members/:memberId')
  removeMember(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('memberId', id) memberId: string) {
    return this.team.remove(u.id, storeId, memberId);
  }

  @Post('stores/:storeId/members/:memberId/transfer-ownership')
  @HttpCode(200)
  transfer(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('memberId', id) memberId: string) {
    return this.team.transferOwnership(u.id, storeId, memberId);
  }

  // ── cardápio

  @Get('stores/:storeId/menu')
  menuGet(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string) {
    return this.menu.menu(u.id, storeId);
  }

  @Post('stores/:storeId/categories')
  catCreate(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Body() dto: CategoryDto) {
    return this.menu.createCategory(u.id, storeId, dto);
  }

  @Put('stores/:storeId/categories/order')
  catOrder(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Body() dto: ReorderDto) {
    return this.menu.reorderCategories(u.id, storeId, dto.ids);
  }

  @Patch('stores/:storeId/categories/:catId')
  catRename(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('catId', id) catId: string, @Body() dto: CategoryDto) {
    return this.menu.renameCategory(u.id, storeId, catId, dto);
  }

  @Delete('stores/:storeId/categories/:catId')
  catDelete(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('catId', id) catId: string) {
    return this.menu.deleteCategory(u.id, storeId, catId);
  }

  @Post('stores/:storeId/products')
  prodCreate(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Body() dto: ProductDto) {
    return this.menu.createProduct(u.id, storeId, dto);
  }

  @Put('stores/:storeId/products/order')
  prodOrder(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Body() dto: ReorderDto) {
    return this.menu.reorderProducts(u.id, storeId, dto.ids);
  }

  @Put('stores/:storeId/products/:productId')
  prodUpdate(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('productId', id) productId: string, @Body() dto: ProductDto) {
    return this.menu.updateProduct(u.id, storeId, productId, dto);
  }

  @Post('stores/:storeId/products/:productId/availability')
  @HttpCode(200)
  prodAvail(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('productId', id) productId: string, @Body() dto: AvailabilityDto) {
    return this.menu.setAvailable(u.id, storeId, productId, dto.available);
  }

  @Post('stores/:storeId/products/:productId/photo')
  @UseInterceptors(FileInterceptor('file'))
  prodPhoto(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('productId', id) productId: string, @UploadedFile() file?: Express.Multer.File) {
    return this.menu.photo(u.id, storeId, productId, file);
  }

  @Delete('stores/:storeId/products/:productId')
  prodDelete(@CurrentUser() u: AuthUser, @Param('storeId', id) storeId: string, @Param('productId', id) productId: string) {
    return this.menu.deleteProduct(u.id, storeId, productId);
  }
}

/** Convites: a tela pública mostra os dados; aceitar exige estar logado como lojista */
@Controller('invites')
export class InvitesController {
  constructor(private readonly team: TeamService) {}

  @Public()
  @Get(':token')
  info(@Param('token') token: string) {
    return this.team.inviteInfo(token);
  }

  @Roles(Role.MERCHANT)
  @Post(':token/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('token') token: string) {
    return this.team.acceptByToken(u, token);
  }
}
