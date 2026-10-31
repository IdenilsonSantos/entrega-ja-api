import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from '../../config';
import { ENTITIES } from './entities';

/** Usado pelas migrations e pelo seed (a aplicação usa o TypeOrmModule com as mesmas opções). */
export const dataSourceOptions = {
  type: 'postgres' as const,
  url: config.databaseUrl,
  entities: ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
