import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly indicators: HealthIndicatorService,
  ) {}

  async isHealthy<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const session = this.indicators.check(key);
    try {
      await this.pool.query('SELECT 1, PostGIS_Version()');
      return session.up();
    } catch (err) {
      return session.down({
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
}
