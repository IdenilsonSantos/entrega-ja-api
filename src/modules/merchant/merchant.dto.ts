import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional,
  IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { StoreRole } from './store-member.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class StoreDto {
  @Transform(trim) @IsString() @Length(2, 120) name: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @Transform(trim) @IsString() @Length(2, 40) category: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
  @Transform(trim) @IsString() @Length(5, 200) address: string;
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
  @IsOptional() @IsInt() @Min(0) @Max(5000) deliveryFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) minOrderCents?: number;
  @IsOptional() @IsInt() @Min(5) @Max(180) prepTimeMin?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(20) deliveryRadiusKm?: number;
}

export class UpdateStoreDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 40) category?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(5, 200) address?: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5000) deliveryFeeCents?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) minOrderCents?: number;
  @IsOptional() @IsInt() @Min(5) @Max(180) prepTimeMin?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(20) deliveryRadiusKm?: number;
}

export class OpenDto {
  @IsBoolean() isOpen: boolean;
}

export class InviteDto {
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' }) email: string;
  @IsEnum(StoreRole) role: StoreRole;
}

export class RoleDto {
  @IsEnum(StoreRole) role: StoreRole;
}

export class CategoryDto {
  @Transform(trim) @IsString() @Length(1, 60) name: string;
}

export class ReorderDto {
  @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) ids: string[];
}

class OptionDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @Transform(trim) @IsString() @Length(1, 60) name: string;
  @IsInt() @Min(0) @Max(100000) priceCents: number;
}

class OptionGroupDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @Transform(trim) @IsString() @Length(1, 60) name: string;
  @IsInt() @Min(0) @Max(20) min: number;
  @IsInt() @Min(1) @Max(20) max: number;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OptionDto) options: OptionDto[];
}

export class ProductDto {
  @Transform(trim) @IsString() @Length(1, 120) name: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsInt() @Min(1) @Max(1000000) priceCents: number;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => OptionGroupDto) optionGroups?: OptionGroupDto[];
}

export class AvailabilityDto {
  @IsBoolean() available: boolean;
}
