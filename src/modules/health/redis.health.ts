import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { REDIS_CLIENT, type Redis } from '../redis';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly indicators: HealthIndicatorService,
  ) {}

  async isHealthy<Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const session = this.indicators.check(key);

    if (this.redis.status !== 'ready') {
      return session.down({ message: `redis client is ${this.redis.status}` });
    }

    try {
      const response = await this.redis.ping();
      if (response !== 'PONG') {
        return session.down({
          message: 'redis ping returned unexpected response',
        });
      }

      return session.up();
    } catch {
      return session.down({ message: 'redis ping failed' });
    }
  }
}
