import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Role } from '../users/user.entity';
import { VehicleType } from '../couriers/courier-profile.entity';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LoginDto {
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' }) email: string;
  @IsString() @MinLength(1) password: string;
}

export class RegisterDto {
  @Transform(trim) @IsString() @Length(2, 120, { message: 'Informe seu nome' }) name: string;
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' }) @MaxLength(160) email: string;
  @IsString() @MinLength(6, { message: 'A senha precisa ter pelo menos 6 caracteres' }) @MaxLength(100) password: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
  @IsIn([Role.CUSTOMER, Role.COURIER, Role.MERCHANT], { message: 'Tipo de conta inválido' }) role: Role;
  /** Entregador informa o veículo no cadastro */
  @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  /** Cadastro aberto por um link de convite de loja */
  @IsOptional() @IsString() @MaxLength(64) inviteToken?: string;
}

export class UpdateMeDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
}

export class ChangePasswordDto {
  @IsString() current: string;
  @IsString() @MinLength(6, { message: 'A nova senha precisa ter pelo menos 6 caracteres' }) @MaxLength(100) next: string;
}

export const PLATE = /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/;
export const plateMatch = Matches(PLATE, { message: 'Placa inválida (ex.: ABC1D23)' });
