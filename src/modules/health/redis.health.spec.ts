import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis';
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  const createIndicator = async (redis: Partial<Redis>) => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      providers: [
        RedisHealthIndicator,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    return moduleRef.get(RedisHealthIndicator);
  };

  it('reports up when Redis responds to ping', async () => {
    const redis = {
      status: 'ready',
      ping: jest.fn().mockResolvedValue('PONG'),
    };
    const indicator = await createIndicator(redis as Partial<Redis>);

    const result = await indicator.isHealthy('redis');

    expect(redis.ping).toHaveBeenCalledTimes(1);
    expect(result.redis.status).toBe('up');
  });

  it('reports down without leaking connection details when ping fails', async () => {
    const redis = {
      status: 'ready',
      ping: jest.fn().mockRejectedValue(new Error('NOAUTH invalid-password')),
    };
    const indicator = await createIndicator(redis as Partial<Redis>);

    const result = await indicator.isHealthy('redis');

    expect(result.redis.status).toBe('down');
    expect(result.redis).toMatchObject({ message: 'redis ping failed' });
    expect(JSON.stringify(result.redis)).not.toContain('invalid-password');
  });

  it('reports down when Redis returns an unexpected ping response', async () => {
    const redis = { status: 'ready', ping: jest.fn().mockResolvedValue('OK') };
    const indicator = await createIndicator(redis as Partial<Redis>);

    const result = await indicator.isHealthy('redis');

    expect(result.redis.status).toBe('down');
    expect(result.redis).toMatchObject({
      message: 'redis ping returned unexpected response',
    });
  });

  it('reports down without pinging while Redis is still connecting', async () => {
    const redis = { status: 'connecting', ping: jest.fn() };
    const indicator = await createIndicator(redis as Partial<Redis>);

    const result = await indicator.isHealthy('redis');

    expect(redis.ping).not.toHaveBeenCalled();
    expect(result.redis.status).toBe('down');
    expect(result.redis).toMatchObject({
      message: 'redis client is connecting',
    });
  });

  it('reports recovered after Redis starts responding again', async () => {
    const redis = {
      status: 'ready',
      ping: jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce('PONG'),
    };
    const indicator = await createIndicator(redis as Partial<Redis>);

    await expect(indicator.isHealthy('redis')).resolves.toMatchObject({
      redis: { status: 'down', message: 'redis ping failed' },
    });
    await expect(indicator.isHealthy('redis')).resolves.toMatchObject({
      redis: { status: 'up' },
    });
  });

  it('reports down after the Redis client shuts down', async () => {
    const redis = { status: 'end', ping: jest.fn() };
    const indicator = await createIndicator(redis as Partial<Redis>);

    const result = await indicator.isHealthy('redis');

    expect(redis.ping).not.toHaveBeenCalled();
    expect(result.redis.status).toBe('down');
    expect(result.redis).toMatchObject({ message: 'redis client is end' });
  });
});
