import { createDispatchIntegrationTestHarness } from '../../test/dispatch-integration-harness';

describe('dispatch integration test harness', () => {
  it('rejects unsafe Redis cleanup namespaces', () => {
    expect(() =>
      createDispatchIntegrationTestHarness({
        namespace: 'dispatch-harness-*',
      }),
    ).toThrow('Dispatch integration harness namespace is unsafe');
  });

  it('verifies real PostGIS and Redis dependencies', async () => {
    const harness = createDispatchIntegrationTestHarness({
      namespace: 'dispatch-harness-readiness',
    });

    try {
      const dependencyStatus = await harness.verifyDependencies();

      expect(dependencyStatus.postgisVersion.length).toBeGreaterThan(0);
      expect(dependencyStatus.redisPing).toBe('PONG');
    } finally {
      await harness.close();
    }
  });

  it('cleans only keys in its Redis namespace', async () => {
    const harness = createDispatchIntegrationTestHarness({
      namespace: `dispatch-harness-cleanup-${Date.now()}`,
    });
    const ownedKey = harness.redisKey('owned');
    const outsideKey = `dispatch-harness-outside-${Date.now()}`;

    try {
      await harness.verifyDependencies();
      await harness.redis.set(ownedKey, 'owned');
      await harness.redis.set(outsideKey, 'outside');

      await harness.cleanupRedisNamespace();

      await expect(harness.redis.get(ownedKey)).resolves.toBeNull();
      await expect(harness.redis.get(outsideKey)).resolves.toBe('outside');
    } finally {
      await harness.redis.del(outsideKey);
      await harness.close();
    }
  });

  it('creates independent PostgreSQL clients for concurrency tests', async () => {
    const harness = createDispatchIntegrationTestHarness({
      namespace: `dispatch-harness-db-clients-${Date.now()}`,
    });

    try {
      const firstClient = await harness.createDbClient();
      const secondClient = await harness.createDbClient();

      try {
        const [firstResult, secondResult] = await Promise.all([
          firstClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
          secondClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
        ]);

        expect(firstResult.rows[0]?.pid).toEqual(expect.any(Number));
        expect(secondResult.rows[0]?.pid).toEqual(expect.any(Number));
        expect(firstResult.rows[0]?.pid).not.toBe(secondResult.rows[0]?.pid);
      } finally {
        firstClient.release();
        secondClient.release();
      }
    } finally {
      await harness.close();
    }
  });

  it('rolls back transaction-scoped database work', async () => {
    const harness = createDispatchIntegrationTestHarness({
      namespace: `dispatch-harness-transaction-${Date.now()}`,
    });
    const tableName = `dispatch_harness_tx_${Date.now()}_${Math.trunc(
      Math.random() * 1_000_000,
    )}`;
    const assertClient = await harness.createDbClient();

    try {
      await harness.withRollbackTransaction(async (transactionClient) => {
        await transactionClient.query(
          `CREATE TABLE ${tableName} (id integer NOT NULL)`,
        );
        await transactionClient.query(
          `INSERT INTO ${tableName} (id) VALUES (1)`,
        );

        const countResult = await transactionClient.query<{ count: string }>(
          `SELECT count(*) AS count FROM ${tableName}`,
        );
        expect(Number(countResult.rows[0]?.count)).toBe(1);
      });

      const relationResult = await assertClient.query<{
        relation: string | null;
      }>('SELECT to_regclass($1::text) AS relation', [`public.${tableName}`]);

      expect(relationResult.rows[0]?.relation).toBeNull();
    } finally {
      await assertClient
        .query(`DROP TABLE IF EXISTS ${tableName}`)
        .catch(() => undefined);
      assertClient.release();
      await harness.close();
    }
  });

  it('reports PostgreSQL/PostGIS readiness failures with harness context', async () => {
    const harness = createDispatchIntegrationTestHarness({
      namespace: `dispatch-harness-pg-failure-${Date.now()}`,
      databaseUrl: 'postgres://ubel:ubel@127.0.0.1:1/ubel',
    });

    try {
      await expect(harness.verifyDependencies()).rejects.toThrow(
        'Dispatch integration harness could not verify PostgreSQL/PostGIS',
      );
    } finally {
      await harness.close();
    }
  });

  it('reports Redis readiness failures with harness context', async () => {
    const harness = createDispatchIntegrationTestHarness({
      namespace: `dispatch-harness-redis-failure-${Date.now()}`,
      redisPort: 1,
    });

    try {
      await expect(harness.verifyDependencies()).rejects.toThrow(
        'Dispatch integration harness could not verify Redis',
      );
    } finally {
      await harness.close();
    }
  });
});
