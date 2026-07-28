import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { DatabaseHealthIndicator } from './database.health';

describe('DatabaseHealthIndicator (integration)', () => {
  let pool: Pool;
  let indicator: DatabaseHealthIndicator;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      providers: [
        DatabaseHealthIndicator,
        { provide: PG_POOL, useValue: pool },
      ],
    }).compile();
    indicator = moduleRef.get(DatabaseHealthIndicator);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('reports up when SELECT 1 succeeds against the real pool', async () => {
    const result = await indicator.isHealthy('database');
    expect(result.database.status).toBe('up');
  });

  it('reports down when the pool query fails', async () => {
    const fakePool = {
      query: () => Promise.reject(new Error('connection refused')),
    } as unknown as Pool;
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      providers: [
        DatabaseHealthIndicator,
        { provide: PG_POOL, useValue: fakePool },
      ],
    }).compile();
    const broken = moduleRef.get(DatabaseHealthIndicator);

    const result = await broken.isHealthy('database');
    expect(result.database.status).toBe('down');
    expect(result.database).toMatchObject({ message: 'connection refused' });
  });

  it('reports down when PostgreSQL is reachable but PostGIS is unavailable', async () => {
    const fakePool = {
      query: (sql: string) => {
        if (sql.includes('PostGIS_Version')) {
          return Promise.reject(
            new Error('function postgis_version() does not exist'),
          );
        }

        return Promise.resolve({ rows: [{ ok: 1 }] });
      },
    } as unknown as Pool;
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      providers: [
        DatabaseHealthIndicator,
        { provide: PG_POOL, useValue: fakePool },
      ],
    }).compile();
    const missingPostgis = moduleRef.get(DatabaseHealthIndicator);

    const result = await missingPostgis.isHealthy('database');
    expect(result.database.status).toBe('down');
    expect(result.database).toMatchObject({
      message: 'function postgis_version() does not exist',
    });
  });
});
