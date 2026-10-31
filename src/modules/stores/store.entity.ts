import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

/**
 * PENDING   → criada pelo lojista, aguardando aprovação da plataforma (não aparece para clientes)
 * ACTIVE    → no ar
 * SUSPENDED → tirada do ar pela moderação (o lojista vê o motivo)
 */
export enum StoreStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

@Entity('stores')
@Index('IDX_stores_status_name', ['status', 'name', 'id'])
@Index('IDX_stores_created', ['createdAt', 'id'])
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Dono atual (também tem uma linha OWNER em store_members) */
  @Column('uuid')
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  owner: User;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  /** Tipo de cozinha: "Lanches", "Japonesa", "Mercado"… */
  @Column({ length: 40 })
  category: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  @Column({ length: 200 })
  address: string;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  @Column({ type: 'varchar', nullable: true })
  logoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  coverUrl: string | null;

  /** Taxa de entrega cobrada da cliente */
  @Column({ type: 'int', default: 599 })
  deliveryFeeCents: number;

  @Column({ type: 'int', default: 0 })
  minOrderCents: number;

  /** Tempo médio de preparo mostrado à cliente */
  @Column({ type: 'int', default: 30 })
  prepTimeMin: number;

  /** Raio de entrega da loja */
  @Column({ type: 'double precision', default: 6 })
  deliveryRadiusKm: number;

  /** A loja abre e fecha pelo painel */
  @Column({ default: false })
  isOpen: boolean;

  @Column({ type: 'enum', enum: StoreStatus, enumName: 'store_status', default: StoreStatus.PENDING })
  status: StoreStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  statusReason: string | null;

  @Column({ type: 'double precision', default: 0 })
  ratingAvg: number;

  @Column({ type: 'int', default: 0 })
  ratingCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
