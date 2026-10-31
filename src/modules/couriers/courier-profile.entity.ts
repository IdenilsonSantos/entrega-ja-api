import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum VehicleType {
  MOTORCYCLE = 'MOTORCYCLE',
  BICYCLE = 'BICYCLE',
  CAR = 'CAR',
  SCOOTER = 'SCOOTER',
  WALKING = 'WALKING',
}

/** Veículos que precisam de placa */
export const NEEDS_PLATE = [VehicleType.MOTORCYCLE, VehicleType.CAR];

/** Dados do entregador além da conta: veículo, documentos e recebimento. */
@Entity('courier_profiles')
export class CourierProfile {
  @PrimaryColumn('uuid')
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: VehicleType, enumName: 'vehicle_type', default: VehicleType.MOTORCYCLE })
  vehicleType: VehicleType;

  @Column({ type: 'varchar', length: 60, nullable: true })
  vehicleModel: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  vehicleColor: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  vehiclePlate: string | null;

  /** CPF, só dígitos */
  @Column({ type: 'varchar', length: 11, nullable: true })
  document: string | null;

  /** Número da CNH (obrigatória para moto e carro) */
  @Column({ type: 'varchar', length: 20, nullable: true })
  licenseNumber: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  pixKey: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  deliveriesCount: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
