import { fareConfig } from './fare.config';
import { validateEnv } from './env.schema';

describe('fareConfig', () => {
  const minimal = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_PASSWORD: 'test-password',
    S3_BUCKET: 'test-bucket',
    S3_REGION: 'us-east-1',
    JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  };

  it('exposes temporary fare defaults through a typed namespace', () => {
    const env = validateEnv(minimal);

    expect(env.FARE_STANDARD_RATE_MINOR_PER_KM).toBe(900);
    expect(env.FARE_ESTIMATE_TTL_SECONDS).toBe(300);
    expect(fareConfig()).toEqual({
      standardRateMinorPerKm: 900,
      estimateTtlSeconds: 300,
    });
  });

  it('coerces configured fare values into the typed namespace', () => {
    validateEnv({
      ...minimal,
      FARE_STANDARD_RATE_MINOR_PER_KM: '1200',
      FARE_ESTIMATE_TTL_SECONDS: '180',
    });

    expect(fareConfig()).toEqual({
      standardRateMinorPerKm: 1_200,
      estimateTtlSeconds: 180,
    });
  });

  it.each([
    ['FARE_STANDARD_RATE_MINOR_PER_KM', '0'],
    ['FARE_ESTIMATE_TTL_SECONDS', '0'],
  ])('rejects invalid fare bound for %s', (key, value) => {
    expect(() => validateEnv({ ...minimal, [key]: value })).toThrow(
      new RegExp(key),
    );
  });
});
