import { registerAs } from '@nestjs/config';
import { env } from './env.schema';

type DatabaseConfig = {
  url: string;
};

export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  const e = env();
  return {
    url: e.DATABASE_URL,
  };
});
