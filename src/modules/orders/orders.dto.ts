import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString,
  IsUUID, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/pagination';
import { PaymentMethod } from './order.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ItemOptionDto {
  @IsString() @MaxLength(40) groupId: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) optionIds: string[];
}

class ItemDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(50) qty: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ItemOptionDto) options?: ItemOptionDto[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) notes?: string;
}

export class CreateOrderDto {
  @IsUUID() storeId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ItemDto) items: ItemDto[];
  /** Endereço salvo, ou os campos soltos abaixo */
  @IsOptional() @IsUUID() addressId?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(5, 200) deliveryAddress?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) deliveryComplement?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) deliveryReference?: string;
  @IsOptional() @IsLatitude() deliveryLat?: number;
  @IsOptional() @IsLongitude() deliveryLng?: number;
  @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) changeForCents?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) notes?: string;
}

export class ReasonDto {
  @Transform(trim) @IsString() @Length(3, 300, { message: 'Explique o motivo (3 a 300 caracteres)' }) reason: string;
}

export class OptionalReasonDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}

export class RateDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) comment?: string;
}

export class DeliverDto {
  @IsString() @Length(4, 4, { message: 'O código tem 4 dígitos' }) code: string;
}

export class OrderListQuery extends PageQuery {
  /** active = em andamento; history = finalizados; vazio = todos */
  @IsOptional() @IsIn(['active', 'history']) scope?: 'active' | 'history';
}

export class StatsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}
