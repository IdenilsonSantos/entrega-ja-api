import { Module } from '@nestjs/common';
import { AuditService } from '../moderation/audit.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../moderation/moderation.entity';
import { DispatchService } from './dispatch.service';
import { DispatchWorker } from './dispatch.worker';
import { PresenceService } from './presence.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [DispatchService, DispatchWorker, PresenceService, AuditService],
  exports: [DispatchService, PresenceService, AuditService],
})
export class DispatchModule {}
