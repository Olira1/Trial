import { Pool } from 'pg';

describe('PostGIS database support (integration)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('can execute PostGIS functions against the real database', async () => {
    const result = await pool.query<{
      postgisVersion: string;
      nearby: boolean;
    }>(`
      SELECT
        PostGIS_Version() AS "postgisVersion",
        ST_DWithin(
          ST_SetSRID(ST_MakePoint(38.7525, 9.0192), 4326)::geography,
          ST_SetSRID(ST_MakePoint(38.7612, 9.0301), 4326)::geography,
          2000
        ) AS nearby
    `);

    expect(result.rows[0]?.postgisVersion).toEqual(expect.any(String));
    expect(result.rows[0]?.nearby).toBe(true);
  });
});
