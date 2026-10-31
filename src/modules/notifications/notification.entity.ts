import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

/** Notificação da central (o sininho). Também vira push no navegador e no celular. */
@Entity('notifications')
@Index('IDX_notifications_user', ['userId', 'createdAt', 'id'])
@Index('IDX_notifications_unread', ['userId'], { where: '"readAt" IS NULL' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  /** order.new, order.ready, offer.new, store.approved… (o front escolhe o ícone por aqui) */
  @Column({ length: 40 })
  type: string;

  @Column({ length: 120 })
  title: string;

  @Column({ length: 300 })
  body: string;

  /** Caminho no site aberto ao tocar: /pedidos/123 */
  @Column({ type: 'varchar', length: 200, nullable: true })
  link: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Inscrição de web push de um navegador */
@Entity('push_subscriptions')
@Index('IDX_push_subscriptions_user', ['userId'])
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Index('UQ_push_subscriptions_endpoint', { unique: true })
  @Column({ length: 600 })
  endpoint: string;

  @Column({ length: 200 })
  p256dh: string;

  @Column({ length: 100 })
  auth: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Token do Expo de um celular com o app do entregador */
@Entity('device_tokens')
@Index('IDX_device_tokens_user', ['userId'])
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Index('UQ_device_tokens_token', { unique: true })
  @Column({ length: 200 })
  token: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  platform: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
