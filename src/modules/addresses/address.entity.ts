import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('addresses')
@Index('IDX_addresses_user', ['userId'])
export class Address {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  /** "Casa", "Trabalho"… */
  @Column({ length: 40 })
  label: string;

  @Column({ length: 200 })
  street: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  complement: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  reference: string | null;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
