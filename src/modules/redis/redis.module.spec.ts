import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { redisConfig } from '../../config';
import { REDIS_CLIENT, RedisModule } from './redis.module';

describe('RedisModule (integration)', () => {
  let moduleRef: TestingModule;
  let redis: Redis;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [redisConfig] }),
        RedisModule,
      ],
    }).compile();
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await redis.quit().catch(() => undefined);
  });

  it('exposes a Redis client that responds to ping', async () => {
    expect(await redis.ping()).toBe('PONG');
  });

  it('lets callers run basic key/value commands end-to-end', async () => {
    await redis.set('redis-module:test', 'hello', 'EX', 5);
    expect(await redis.get('redis-module:test')).toBe('hello');
    await redis.del('redis-module:test');
  });
});
