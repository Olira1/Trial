import { registerAs } from '@nestjs/config';
import { env } from './env.schema';

export type FareConfig = {
  standardRateMinorPerKm: number;
  estimateTtlSeconds: number;
};

export const fareConfig = registerAs('fare', (): FareConfig => {
  const e = env();

  return {
    standardRateMinorPerKm: e.FARE_STANDARD_RATE_MINOR_PER_KM,
    estimateTtlSeconds: e.FARE_ESTIMATE_TTL_SECONDS,
  };
});
