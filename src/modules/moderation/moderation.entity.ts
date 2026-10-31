import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum ReportTarget {
  STORE = 'STORE',
  PRODUCT = 'PRODUCT',
  USER = 'USER',
  ORDER = 'ORDER',
}

export enum ReportReason {
  OFFENSIVE = 'OFFENSIVE',
  FRAUD = 'FRAUD',
  WRONG_INFO = 'WRONG_INFO',
  FOOD_SAFETY = 'FOOD_SAFETY',
  BEHAVIOR = 'BEHAVIOR',
  OTHER = 'OTHER',
}

export enum ReportStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

/** Denúncia feita por qualquer usuário; a moderação decide */
@Entity('reports')
@Index('IDX_reports_status', ['status', 'createdAt', 'id'])
@Index('IDX_reports_created', ['createdAt', 'id'])
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  reporterId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  reporter: User;

  @Column({ type: 'enum', enum: ReportTarget, enumName: 'report_target' })
  targetType: ReportTarget;

  @Column('uuid')
  targetId: string;

  /** Nome do alvo na hora da denúncia (para a lista não precisar buscar) */
  @Column({ length: 160 })
  targetName: string;

  @Column({ type: 'enum', enum: ReportReason, enumName: 'report_reason' })
  reason: ReportReason;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  details: string | null;

  @Column({ type: 'enum', enum: ReportStatus, enumName: 'report_status', default: ReportStatus.OPEN })
  status: ReportStatus;

  @Column({ type: 'uuid', nullable: true })
  resolvedById: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Registro de tudo o que a administração fez (quem, o quê, em quem, por quê) */
@Entity('audit_logs')
@Index('IDX_audit_logs_created', ['createdAt', 'id'])
@Index('IDX_audit_logs_target', ['targetType', 'targetId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  actorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  actor: User;

  /** store.approve, user.block, product.remove, order.assign… */
  @Column({ length: 40 })
  action: string;

  @Column({ length: 20 })
  targetType: string;

  @Column('uuid')
  targetId: string;

  @Column({ length: 160 })
  targetName: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
