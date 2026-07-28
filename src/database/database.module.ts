import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { databaseConfig } from '../config';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;
export type DBTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
export type DBExecutor = Database | DBTransaction;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) =>
        new Pool({ connectionString: config.url }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database =>
        drizzle(pool, { schema, casing: 'snake_case' }),
    },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
