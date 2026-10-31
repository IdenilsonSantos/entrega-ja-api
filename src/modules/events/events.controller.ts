import { Controller, Get, Headers, Module, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AllowPending, AuthUser, CurrentUser } from '../../common/auth';
import { ADMIN_ROOM, EventsService, userRoom } from '../../infra/events/events.service';
import { Role } from '../users/user.entity';

/**
 * GET /api/events/stream — conexão SSE da pessoa logada.
 * Eventos: notification, notification.read, order.updated, offer.new, offer.expired,
 * offer.cancelled, courier.location, fleet.location (admin), session.revoked.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @AllowPending()
  @Get('stream')
  stream(@CurrentUser() u: AuthUser, @Res() res: Response, @Headers('last-event-id') lastId?: string, @Query('lastEventId') lastIdQuery?: string) {
    const rooms = [userRoom(u.id), ...(u.role === Role.ADMIN ? [ADMIN_ROOM] : [])];
    return this.events.connect(res, rooms, lastId ?? lastIdQuery);
  }
}

@Module({ controllers: [EventsController] })
export class EventsHttpModule {}
