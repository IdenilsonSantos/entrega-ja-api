import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, IsNull, Repository } from 'typeorm';
import { mapPage, PageQuery, paginate } from '../../common/pagination';
import { EventsService } from '../../infra/events/events.service';
import { PUSH_QUEUE } from '../../infra/queue/queues';
import { Role, User } from '../users/user.entity';
import { Notification } from './notification.entity';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  link?: string | null;
}

export interface PushJob extends NotifyInput {
  userId: string;
  notificationId: string;
  /** Ofertas de corrida: som e prioridade alta no celular */
  urgent?: boolean;
}

export const toDto = (n: Notification) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt,
  createdAt: n.createdAt,
});

/**
 * Um único ponto para avisar alguém. Cada aviso:
 *   1. fica salvo na central (sininho), com lido/não lido;
 *   2. chega na hora pelo SSE para quem está com o app aberto;
 *   3. vira push no navegador e no celular (pela fila, processada pelo worker).
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly events: EventsService,
    @Inject(PUSH_QUEUE) private readonly push: Queue,
  ) {}

  async notify(userIds: (string | null | undefined)[], input: NotifyInput, opts: { urgent?: boolean } = {}) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    const rows = await this.repo.save(ids.map((userId) => this.repo.create({ userId, ...input, link: input.link ?? null })));
    await Promise.all(rows.map((n) => this.events.toUsers([n.userId], 'notification', toDto(n))));
    await this.push.addBulk(
      rows.map((n) => ({
        name: 'send',
        data: { userId: n.userId, notificationId: n.id, type: n.type, title: n.title, body: n.body, link: n.link, urgent: opts.urgent } satisfies PushJob,
      })),
    );
  }

  /** Avisa todos os admins da plataforma */
  async notifyAdmins(input: NotifyInput) {
    const admins = await this.users.find({ select: { id: true }, where: { role: Role.ADMIN } });
    return this.notify(admins.map((a) => a.id), input);
  }

  async list(userId: string, q: PageQuery & { unread?: boolean }) {
    const qb = this.repo.createQueryBuilder('n').where('n.userId = :userId', { userId });
    if (q.unread) qb.andWhere('n.readAt IS NULL');
    return mapPage(await paginate(qb, q), toDto);
  }

  unreadCount(userId: string) {
    return this.repo.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, ids?: string[]) {
    await this.repo.update({ userId, readAt: IsNull(), ...(ids?.length && { id: In(ids) }) }, { readAt: new Date() });
    const unread = await this.unreadCount(userId);
    await this.events.toUsers([userId], 'notification.read', { ids: ids ?? null, unread }, { ephemeral: true });
    return { unread };
  }
}
