import { registerAs } from '@nestjs/config';
import { env } from './env.schema';

type RedisConfig = {
  host: string;
  port: number;
  password?: string;
};

export const redisConfig = registerAs('redis', (): RedisConfig => {
  const e = env();
  return {
    host: e.REDIS_HOST,
    port: e.REDIS_PORT,
    password: e.REDIS_PASSWORD,
  };
});
