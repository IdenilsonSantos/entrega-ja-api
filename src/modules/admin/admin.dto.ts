import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../common/pagination';
import { ReportStatus } from '../moderation/moderation.entity';
import { OrderStatus } from '../orders/order.entity';
import { StoreStatus } from '../stores/store.entity';
import { Role, UserStatus } from '../users/user.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UsersQuery extends PageQuery {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
}

export class StoresQuery extends PageQuery {
  @IsOptional() @IsEnum(StoreStatus) status?: StoreStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
}

export class OrdersQuery extends PageQuery {
  @IsOptional() @IsIn(['active', 'history']) scope?: 'active' | 'history';
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsUUID() userId?: string;
  /** número do pedido */
  @IsOptional() @Type(() => Number) @IsInt() number?: number;
}

export class ReportsQuery extends PageQuery {
  @IsOptional() @IsEnum(ReportStatus) status?: ReportStatus;
}

export class ProductsQuery {
  @IsUUID() storeId: string;
}

export class SearchQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
}

export class AdminReasonDto {
  @Transform(trim) @IsString() @Length(3, 300, { message: 'Explique o motivo (3 a 300 caracteres)' }) reason: string;
}

export class AssignDto {
  @IsUUID() courierId: string;
}

export class ResolveReportDto {
  @IsIn([ReportStatus.RESOLVED, ReportStatus.DISMISSED]) status: ReportStatus.RESOLVED | ReportStatus.DISMISSED;
  @Transform(trim) @IsString() @Length(3, 500) resolution: string;
  /** Ação aplicada no alvo junto com a resolução */
  @IsOptional() @IsIn(['block_user', 'suspend_store', 'remove_product']) action?: 'block_user' | 'suspend_store' | 'remove_product';
}

export class SettingsDto {
  @IsOptional() @IsNumber() @Min(0) @Max(50) commissionPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5000) courierBaseCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2000) courierPerKmCents?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(30) dispatchRadiusKm?: number;
}

export class RoleChangeDto {
  @IsEnum(Role) role: Role;
}
