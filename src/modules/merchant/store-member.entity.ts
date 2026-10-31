import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Store } from '../stores/store.entity';
import { User } from '../users/user.entity';

/**
 * Papel de alguém numa loja.
 * OWNER     → tudo, inclusive equipe e excluir a loja
 * MANAGER   → dados da loja, cardápio, pedidos, relatórios e atendentes
 * ATTENDANT → pedidos e disponibilidade dos produtos
 */
export enum StoreRole {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  ATTENDANT = 'ATTENDANT',
}

/** O que cada papel pode fazer. Os controllers checam permissões, não papéis. */
export type StorePermission = 'orders' | 'menu.availability' | 'menu.edit' | 'store.edit' | 'reports' | 'team' | 'team.owner';

export const PERMISSIONS: Record<StoreRole, StorePermission[]> = {
  OWNER: ['orders', 'menu.availability', 'menu.edit', 'store.edit', 'reports', 'team', 'team.owner'],
  MANAGER: ['orders', 'menu.availability', 'menu.edit', 'store.edit', 'reports', 'team'],
  ATTENDANT: ['orders', 'menu.availability'],
};

@Entity('store_members')
@Unique('UQ_store_members', ['storeId', 'userId'])
@Index('IDX_store_members_user', ['userId'])
export class StoreMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  store: Store;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'enum', enum: StoreRole, enumName: 'store_role' })
  role: StoreRole;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Convite para entrar na equipe. O link leva o token; vale 7 dias e só uma vez. */
@Entity('store_invites')
@Index('IDX_store_invites_store', ['storeId'])
export class StoreInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  store: Store;

  @Column({ length: 160 })
  email: string;

  @Column({ type: 'enum', enum: StoreRole, enumName: 'store_role' })
  role: StoreRole;

  @Index('UQ_store_invites_token', { unique: true })
  @Column({ length: 64 })
  token: string;

  @Column('uuid')
  invitedById: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
