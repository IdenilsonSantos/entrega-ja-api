import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './moderation.entity';

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  reason?: string | null;
}

/** Toda ação da administração passa por aqui e fica registrada */
@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  record(e: AuditEntry) {
    return this.repo.insert({ ...e, reason: e.reason ?? null });
  }
}
