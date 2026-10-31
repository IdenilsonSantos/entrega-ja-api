import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Papéis da conta.
 * MERCHANT é quem trabalha numa loja (dono, gerente ou atendente); o papel dentro de cada
 * loja fica em StoreMember. Um lojista pode ter várias lojas e participar da equipe de outras.
 */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  COURIER = 'COURIER',
  MERCHANT = 'MERCHANT',
  ADMIN = 'ADMIN',
}

/**
 * ACTIVE  → usa tudo
 * PENDING → entregador recém-cadastrado aguardando aprovação (entra, mas não fica online)
 * BLOCKED → conta bloqueada pela moderação; nenhuma requisição é aceita
 */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  BLOCKED = 'BLOCKED',
}

@Entity('users')
@Index('IDX_users_role_created', ['role', 'createdAt', 'id'])
@Index('IDX_users_created', ['createdAt', 'id'])
@Check('CHK_users_email_lower', '"email" = lower("email")')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Index('UQ_users_email', { unique: true })
  @Column({ length: 160 })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'enum', enum: Role, enumName: 'user_role' })
  role: Role;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'user_status', default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  statusReason: string | null;

  /** Muda a cada troca de senha ou bloqueio: tokens antigos param de valer */
  @Column({ default: 0 })
  tokenVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** Dados públicos da conta (o que vai para o front). */
export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  avatarUrl: u.avatarUrl,
  role: u.role,
  status: u.status,
  statusReason: u.statusReason,
  createdAt: u.createdAt,
});
export type PublicUser = ReturnType<typeof publicUser>;
