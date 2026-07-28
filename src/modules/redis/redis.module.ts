import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redisConfig } from '../../config';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) =>
        new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }
}

export type { Redis };
