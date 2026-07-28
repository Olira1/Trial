import { registerAs } from '@nestjs/config';
import { env, type Env } from './env.schema';

type AppConfig = {
  nodeEnv: Env['NODE_ENV'];
  port: number;
  allowedOrigins: string[];
  trustProxy: number;
  jsonBodyLimit: string;
};

export const appConfig = registerAs('app', (): AppConfig => {
  const e = env();
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    allowedOrigins: e.ALLOWED_ORIGINS,
    trustProxy: e.TRUST_PROXY,
    jsonBodyLimit: e.JSON_BODY_LIMIT,
  };
});
