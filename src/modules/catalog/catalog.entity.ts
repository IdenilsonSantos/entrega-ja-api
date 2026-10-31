import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Store } from '../stores/store.entity';

/** Seção do cardápio ("Lanches", "Bebidas"…) */
@Entity('menu_categories')
@Index('IDX_menu_categories_store', ['storeId', 'position'])
export class MenuCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  store: Store;

  @Column({ length: 60 })
  name: string;

  @Column({ type: 'int', default: 0 })
  position: number;
}

export interface ProductOption {
  id: string;
  name: string;
  priceCents: number;
}

/** Grupo de opções: "Ponto da carne" (escolha 1), "Adicionais" (até 3)… */
export interface OptionGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: ProductOption[];
}

export enum ModerationStatus {
  VISIBLE = 'VISIBLE',
  REMOVED = 'REMOVED',
}

@Entity('products')
@Index('IDX_products_store', ['storeId', 'position'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  store: Store;

  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => MenuCategory, { onDelete: 'SET NULL' })
  category: MenuCategory | null;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column('int')
  priceCents: number;

  @Column({ type: 'varchar', nullable: true })
  photoUrl: string | null;

  /** A loja marca como esgotado sem apagar */
  @Column({ default: true })
  available: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  optionGroups: OptionGroup[];

  @Column({ type: 'int', default: 0 })
  position: number;

  /** Produto tirado do ar pela moderação: a loja vê o motivo e não consegue reativar */
  @Column({ type: 'enum', enum: ModerationStatus, enumName: 'moderation_status', default: ModerationStatus.VISIBLE })
  moderation: ModerationStatus;

  @Column({ type: 'varchar', length: 300, nullable: true })
  moderationReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
