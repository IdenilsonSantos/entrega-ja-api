import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { Role } from '../users/user.entity';
import { Address } from './address.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class AddressDto {
  @Transform(trim) @IsString() @Length(1, 40) label: string;
  @Transform(trim) @IsString() @Length(5, 200) street: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) complement?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reference?: string;
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

const MAX = 20;

@Controller('addresses')
@Roles(Role.CUSTOMER)
export class AddressesController {
  constructor(@InjectRepository(Address) private readonly repo: Repository<Address>) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.repo.find({ where: { userId: u.id }, order: { isDefault: 'DESC', createdAt: 'DESC' } });
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: AddressDto) {
    const count = await this.repo.count({ where: { userId: u.id } });
    if (count >= MAX) throw badRequest(`Limite de ${MAX} endereços`);
    const isDefault = dto.isDefault || count === 0;
    if (isDefault) await this.repo.update({ userId: u.id }, { isDefault: false });
    return this.repo.save(this.repo.create({ ...dto, complement: dto.complement || null, reference: dto.reference || null, userId: u.id, isDefault }));
  }

  @Put(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AddressDto) {
    const a = await this.repo.findOneBy({ id, userId: u.id });
    if (!a) throw notFound('Endereço');
    if (dto.isDefault) await this.repo.update({ userId: u.id }, { isDefault: false });
    return this.repo.save({ ...a, ...dto, complement: dto.complement || null, reference: dto.reference || null, isDefault: dto.isDefault ?? a.isDefault });
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const a = await this.repo.findOneBy({ id, userId: u.id });
    if (!a) throw notFound('Endereço');
    await this.repo.delete(id);
    // se apagou o padrão, o mais recente vira padrão
    if (a.isDefault) {
      const next = await this.repo.findOne({ where: { userId: u.id }, order: { createdAt: 'DESC' } });
      if (next) await this.repo.update(next.id, { isDefault: true });
    }
    return { ok: true };
  }
}

@Module({ imports: [TypeOrmModule.forFeature([Address])], controllers: [AddressesController] })
export class AddressesModule {}
