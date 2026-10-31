import { Body, Controller, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DataSource, MoreThan } from 'typeorm';
import { AuthUser, CurrentUser } from '../../common/auth';
import { badRequest, notFound } from '../../common/errors';
import { Product } from '../catalog/catalog.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Order } from '../orders/order.entity';
import { Store } from '../stores/store.entity';
import { User } from '../users/user.entity';
import { Report, ReportReason, ReportTarget } from './moderation.entity';

class ReportDto {
  @IsEnum(ReportTarget) targetType: ReportTarget;
  @IsUUID() targetId: string;
  @IsEnum(ReportReason) reason: ReportReason;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(1000) details?: string;
}

const DAILY_LIMIT = 10;

/** Qualquer pessoa logada pode denunciar uma loja, produto, conta ou pedido */
@Controller('reports')
export class ReportsController {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly notifications: NotificationsService) {}

  private async targetName(type: ReportTarget, id: string) {
    switch (type) {
      case ReportTarget.STORE:
        return (await this.ds.getRepository(Store).findOneBy({ id }))?.name;
      case ReportTarget.PRODUCT: {
        const p = await this.ds.getRepository(Product).findOne({ where: { id }, relations: { store: true } });
        return p && `${p.name} (${p.store.name})`;
      }
      case ReportTarget.USER:
        return (await this.ds.getRepository(User).findOneBy({ id }))?.name;
      case ReportTarget.ORDER: {
        const o = await this.ds.getRepository(Order).findOneBy({ id });
        return o && `Pedido #${o.number}`;
      }
    }
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: ReportDto) {
    const today = await this.ds.getRepository(Report).count({ where: { reporterId: u.id, createdAt: MoreThan(new Date(Date.now() - 86400_000)) } });
    if (today >= DAILY_LIMIT) throw badRequest('Você já enviou muitas denúncias hoje. Tente amanhã');
    const name = await this.targetName(dto.targetType, dto.targetId);
    if (!name) throw notFound('Item denunciado');
    const r = await this.ds.getRepository(Report).save(this.ds.getRepository(Report).create({ reporterId: u.id, ...dto, targetName: name, details: dto.details || null }));
    await this.notifications.notifyAdmins({ type: 'report.new', title: 'Nova denúncia', body: `${name}: ${dto.details?.slice(0, 100) || dto.reason}`, link: `/admin/denuncias?id=${r.id}` });
    return { id: r.id, status: r.status };
  }
}
