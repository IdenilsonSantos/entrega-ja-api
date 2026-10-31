import { Column, CreateDateColumn, Entity, Generated, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Store } from '../stores/store.entity';
import { User } from '../users/user.entity';

/**
 * Ciclo do pedido:
 *
 *   PENDING ──loja aceita──▶ PREPARING ──loja marca pronto──▶ READY ──entregador retira──▶ PICKED_UP ──código──▶ DELIVERED
 *      │                         │                              │
 *      ├─loja recusa─▶ REJECTED  └──loja/admin cancela──▶ CANCELLED ◀──admin cancela──┘
 *      └─cliente cancela─▶ CANCELLED
 *
 * A busca por entregador só começa em READY: a comida já está pronta quando ele chega,
 * e a cliente só vê a entrega a partir daí.
 */
export enum OrderStatus {
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
  PICKED_UP = 'PICKED_UP',
  DELIVERED = 'DELIVERED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export const ACTIVE_STATUSES = [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.PICKED_UP];
export const FINAL_STATUSES = [OrderStatus.DELIVERED, OrderStatus.REJECTED, OrderStatus.CANCELLED];
/** A partir daqui a entrega aparece para a cliente */
export const DELIVERY_VISIBLE = [OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.DELIVERED];

export enum PaymentMethod {
  PIX = 'PIX',
  CARD = 'CARD',
  CASH = 'CASH',
}

/** Foto do item no momento do pedido: preço e nome não mudam se o cardápio mudar depois */
export interface OrderItem {
  productId: string;
  name: string;
  qty: number;
  unitCents: number;
  options: { group: string; name: string; priceCents: number }[];
  totalCents: number;
  notes?: string;
}

@Entity('orders')
@Index('IDX_orders_created', ['createdAt', 'id'])
@Index('IDX_orders_customer', ['customerId', 'createdAt', 'id'])
@Index('IDX_orders_store', ['storeId', 'createdAt', 'id'])
@Index('IDX_orders_courier', ['courierId', 'createdAt', 'id'])
@Index('IDX_orders_status', ['status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Número curto para falar ao telefone: "#4821" */
  @Column('int')
  @Generated('increment')
  number: number;

  @Column('uuid')
  customerId: string;

  @ManyToOne(() => User)
  customer: User;

  @Column('uuid')
  storeId: string;

  @ManyToOne(() => Store)
  store: Store;

  @Column({ type: 'uuid', nullable: true })
  courierId: string | null;

  @ManyToOne(() => User, { nullable: true })
  courier: User | null;

  @Column({ type: 'enum', enum: OrderStatus, enumName: 'order_status', default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ type: 'jsonb' })
  items: OrderItem[];

  @Column('int')
  subtotalCents: number;

  @Column('int')
  deliveryFeeCents: number;

  @Column('int')
  totalCents: number;

  /** Quanto o entregador recebe */
  @Column({ type: 'int', default: 0 })
  courierFeeCents: number;

  /** Comissão da plataforma sobre o subtotal */
  @Column({ type: 'int', default: 0 })
  platformFeeCents: number;

  @Column({ type: 'enum', enum: PaymentMethod, enumName: 'payment_method' })
  paymentMethod: PaymentMethod;

  /** Troco para (pagamento em dinheiro) */
  @Column({ type: 'int', nullable: true })
  changeForCents: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;

  @Column({ length: 200 })
  deliveryAddress: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  deliveryComplement: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  deliveryReference: string | null;

  @Column('double precision')
  deliveryLat: number;

  @Column('double precision')
  deliveryLng: number;

  @Column('double precision')
  distanceKm: number;

  /** A cliente diz ao entregador para confirmar a entrega */
  @Column({ length: 4, select: false })
  deliveryCode: string;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pickedUpAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cancelledBy: 'CUSTOMER' | 'STORE' | 'ADMIN' | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  cancelReason: string | null;

  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ratingComment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Linha do tempo do pedido: quem fez o quê e quando (aparece no detalhe do admin e da loja) */
@Entity('order_events')
@Index('IDX_order_events_order', ['orderId', 'createdAt'])
export class OrderEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order: Order;

  @Column({ length: 40 })
  type: string;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
