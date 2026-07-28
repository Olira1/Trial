import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { Pool, type PoolClient } from 'pg';

export type DispatchIntegrationDependencyStatus = {
  postgisVersion: string;
  redisPing: 'PONG';
};

export type DispatchIntegrationTestHarnessOptions = {
  namespace?: string;
  databaseUrl?: string;
  redisHost?: string;
  redisPort?: number;
  redisPassword?: string;
};

export type DispatchIntegrationTestHarness = {
  namespace: string;
  redis: Redis;
  redisKey: (suffix: string) => string;
  cleanupRedisNamespace: () => Promise<void>;
  createDbClient: () => Promise<PoolClient>;
  withRollbackTransaction: <T>(
    callback: (client: PoolClient) => Promise<T>,
  ) => Promise<T>;
  verifyDependencies: () => Promise<DispatchIntegrationDependencyStatus>;
  close: () => Promise<void>;
};

const requireConfig = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Dispatch integration harness requires ${name}`);
  }

  return value;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const assertSafeNamespace = (namespace: string) => {
  if (!/^[A-Za-z0-9:_-]+$/.test(namespace)) {
    throw new Error(
      'Dispatch integration harness namespace is unsafe. Use only letters, numbers, colon, underscore, or hyphen.',
    );
  }
};

export const createDispatchIntegrationTestHarness = (
  options: DispatchIntegrationTestHarnessOptions = {},
): DispatchIntegrationTestHarness => {
  const namespace = options.namespace ?? `dispatch:${randomUUID()}`;
  assertSafeNamespace(namespace);
  const databaseUrl = requireConfig(
    'DATABASE_URL',
    options.databaseUrl ?? process.env.DATABASE_URL,
  );
  const redisPassword = requireConfig(
    'REDIS_PASSWORD',
    options.redisPassword ?? process.env.REDIS_PASSWORD,
  );
  const pool = new Pool({ connectionString: databaseUrl });
  const redis = new Redis({
    host: options.redisHost ?? process.env.REDIS_HOST ?? 'localhost',
    port: options.redisPort ?? Number(process.env.REDIS_PORT ?? 6379),
    password: redisPassword,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  const ensureRedisConnected = async () => {
    if (redis.status === 'wait') {
      await redis.connect();
    }
  };
  const redisKey = (suffix: string) => `${namespace}:${suffix}`;

  return {
    namespace,
    redis,
    redisKey,
    cleanupRedisNamespace: async () => {
      await ensureRedisConnected();

      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${namespace}:*`,
          'COUNT',
          100,
        );
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        cursor = nextCursor;
      } while (cursor !== '0');
    },
    createDbClient: () => pool.connect(),
    withRollbackTransaction: async <T>(
      callback: (client: PoolClient) => Promise<T>,
    ): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        return await callback(client);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    },
    verifyDependencies: async () => {
      let postgisVersion: string | undefined;
      try {
        const postgisResult = await pool.query<{ postgisVersion: string }>(
          'SELECT PostGIS_Version() AS "postgisVersion"',
        );
        postgisVersion = postgisResult.rows[0]?.postgisVersion;
      } catch (error) {
        throw new Error(
          'Dispatch integration harness could not verify PostgreSQL/PostGIS. ' +
            'Check DATABASE_URL, the local postgres service, and migrations. ' +
            `Cause: ${errorMessage(error)}`,
        );
      }

      if (!postgisVersion) {
        throw new Error(
          'Dispatch integration harness could not verify PostgreSQL/PostGIS. ' +
            'PostGIS_Version() returned no version string.',
        );
      }

      let redisPing: string;
      try {
        await ensureRedisConnected();
        redisPing = await redis.ping();
      } catch (error) {
        throw new Error(
          'Dispatch integration harness could not verify Redis. ' +
            'Check REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, and the local redis service. ' +
            `Cause: ${errorMessage(error)}`,
        );
      }

      if (redisPing !== 'PONG') {
        throw new Error(
          `Dispatch integration harness expected Redis PONG but received ${redisPing}`,
        );
      }

      return {
        postgisVersion,
        redisPing,
      };
    },
    close: async () => {
      const closeRedis = async () => {
        if (redis.status === 'end') {
          return;
        }

        if (redis.status === 'wait') {
          redis.disconnect();
          return;
        }

        await redis.quit().catch(() => redis.disconnect());
      };

      await Promise.all([pool.end(), closeRedis()]);
    },
  };
};
