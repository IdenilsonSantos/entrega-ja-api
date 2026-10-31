import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Regras da plataforma ajustáveis pelo admin sem novo deploy */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ length: 60 })
  key: string;

  @Column('jsonb')
  value: unknown;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
