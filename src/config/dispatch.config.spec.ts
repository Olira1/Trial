import { dispatchConfig } from './dispatch.config';
import { validateEnv } from './env.schema';

describe('dispatchConfig', () => {
  const minimal = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_PASSWORD: 'test-password',
    S3_BUCKET: 'test-bucket',
    S3_REGION: 'us-east-1',
    JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  };

  it('exposes the approved V1 dispatch defaults through a typed namespace', () => {
    const env = validateEnv(minimal);

    expect(env.DISPATCH_OFFER_TTL_SECONDS).toBe(15);
    expect(env.DISPATCH_ENABLE_NEW_REQUESTS).toBe(true);
    expect(env.DISPATCH_ENABLE_NEW_MATCHING).toBe(true);
    expect(env.DISPATCH_ENABLE_SHADOW_RANKING).toBe(false);
    expect(env.DISPATCH_INTERNAL_RIDER_ALLOWLIST).toEqual([]);
    expect(env.DISPATCH_INTERNAL_DRIVER_ALLOWLIST).toEqual([]);
    expect(env.DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE).toBeUndefined();
    expect(env.DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE).toBeUndefined();
    expect(env.DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE).toBeUndefined();
    expect(env.DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE).toBeUndefined();
    expect(env.DISPATCH_ROLLOUT_START_HOUR_LOCAL).toBeUndefined();
    expect(env.DISPATCH_ROLLOUT_END_HOUR_LOCAL).toBeUndefined();
    expect(env.DISPATCH_ROLLOUT_TIMEZONE).toBe('Africa/Addis_Ababa');
    expect(env.DISPATCH_MATCHING_DEADLINE_SECONDS).toBe(90);
    expect(env.DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS).toBe(3_000);
    expect(env.DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS).toBe(3);
    expect(env.DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS).toBe(1);
    expect(env.DISPATCH_LOCATION_FRESHNESS_SECONDS).toBe(12);
    expect(env.DISPATCH_LOCATION_CLEANUP_TTL_SECONDS).toBe(30);
    expect(env.DISPATCH_H3_RESOLUTION).toBe(10);
    expect(env.DISPATCH_MAX_LOCATION_ACCURACY_METERS).toBe(50);
    expect(env.DISPATCH_CAPTURED_AT_MAX_AGE_SECONDS).toBe(30);
    expect(env.DISPATCH_CAPTURED_AT_MAX_FUTURE_SKEW_SECONDS).toBe(10);
    expect(env.DISPATCH_QUEUE_PREFIX).toBe('ubel:dispatch');
    expect(env.DISPATCH_QUEUE_DEFAULT_ATTEMPTS).toBe(3);
    expect(env.DISPATCH_QUEUE_BACKOFF_DELAY_MS).toBe(1_000);
    expect(env.DISPATCH_QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS).toBe(5_000);
    expect(env.DISPATCH_SEARCH_RADIUS_KM).toBe(3);
    expect(env.DISPATCH_DISCOVERY_H3_RESOLUTION).toBe(9);
    expect(env.DISPATCH_MAX_RINGS).toBe(9);
    expect(env.DISPATCH_MAX_CANDIDATES).toBe(9);
    expect(env.GEBETA_BASE_URL).toBe('https://api.gebeta.app');
    expect(env.GEBETA_TIMEOUT_MS).toBe(3_000);
    expect(env.DISPATCH_ROUTING_MAX_CONCURRENCY).toBe(3);
    expect(env.DISPATCH_ROUTING_MAX_CALLS_PER_SECOND).toBe(0);

    expect(dispatchConfig()).toEqual({
      offerTtlSeconds: 15,
      enableNewRequests: true,
      enableNewMatching: true,
      enableShadowRanking: false,
      internalRiderAllowlist: [],
      internalDriverAllowlist: [],
      rolloutPickupBounds: null,
      rolloutHours: null,
      matchingDeadlineSeconds: 90,
      routingProviderTimeoutMs: 3_000,
      locationUpdateIntervalSeconds: 3,
      locationMinUpdateIntervalSeconds: 1,
      locationFreshnessSeconds: 12,
      locationCleanupTtlSeconds: 30,
      h3Resolution: 10,
      maxLocationAccuracyMeters: 50,
      capturedAtMaxAgeSeconds: 30,
      capturedAtMaxFutureSkewSeconds: 10,
      queuePrefix: 'ubel:dispatch',
      queueDefaultAttempts: 3,
      queueBackoffDelayMs: 1_000,
      queueWorkerShutdownTimeoutMs: 5_000,
      searchRadiusKm: 3,
      discoveryH3Resolution: 9,
      maxRings: 9,
      maxCandidates: 9,
      gebetaApiKey: undefined,
      gebetaBaseUrl: 'https://api.gebeta.app',
      gebetaTimeoutMs: 3_000,
      routingMaxConcurrency: 3,
      routingMaxCallsPerSecond: 0,
    });
  });

  it('coerces configured dispatch values into the typed namespace', () => {
    validateEnv({
      ...minimal,
      DISPATCH_OFFER_TTL_SECONDS: '20',
      DISPATCH_ENABLE_NEW_REQUESTS: 'false',
      DISPATCH_ENABLE_NEW_MATCHING: 'false',
      DISPATCH_ENABLE_SHADOW_RANKING: 'true',
      DISPATCH_INTERNAL_RIDER_ALLOWLIST: 'rider-1, rider-2',
      DISPATCH_INTERNAL_DRIVER_ALLOWLIST: 'driver-1,driver-2',
      DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE: '8.9',
      DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE: '9.1',
      DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE: '38.7',
      DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE: '38.9',
      DISPATCH_ROLLOUT_START_HOUR_LOCAL: '6',
      DISPATCH_ROLLOUT_END_HOUR_LOCAL: '22',
      DISPATCH_ROLLOUT_TIMEZONE: 'Africa/Addis_Ababa',
      DISPATCH_MATCHING_DEADLINE_SECONDS: '120',
      DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS: '2500',
      DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS: '4',
      DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS: '2',
      DISPATCH_LOCATION_FRESHNESS_SECONDS: '16',
      DISPATCH_LOCATION_CLEANUP_TTL_SECONDS: '45',
      DISPATCH_H3_RESOLUTION: '9',
      DISPATCH_MAX_LOCATION_ACCURACY_METERS: '35.5',
      DISPATCH_CAPTURED_AT_MAX_AGE_SECONDS: '40',
      DISPATCH_CAPTURED_AT_MAX_FUTURE_SKEW_SECONDS: '5',
      DISPATCH_QUEUE_PREFIX: 'dispatch:test',
      DISPATCH_QUEUE_DEFAULT_ATTEMPTS: '5',
      DISPATCH_QUEUE_BACKOFF_DELAY_MS: '2000',
      DISPATCH_QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS: '7500',
      DISPATCH_SEARCH_RADIUS_KM: '5',
      DISPATCH_DISCOVERY_H3_RESOLUTION: '8',
      DISPATCH_MAX_RINGS: '12',
      DISPATCH_MAX_CANDIDATES: '15',
      GEBETA_API_KEY: 'test-key',
      GEBETA_BASE_URL: 'https://gebeta.test',
      GEBETA_TIMEOUT_MS: '1500',
      DISPATCH_ROUTING_MAX_CONCURRENCY: '5',
      DISPATCH_ROUTING_MAX_CALLS_PER_SECOND: '10',
    });

    expect(dispatchConfig()).toEqual({
      offerTtlSeconds: 20,
      enableNewRequests: false,
      enableNewMatching: false,
      enableShadowRanking: true,
      internalRiderAllowlist: ['rider-1', 'rider-2'],
      internalDriverAllowlist: ['driver-1', 'driver-2'],
      rolloutPickupBounds: {
        minLatitude: 8.9,
        maxLatitude: 9.1,
        minLongitude: 38.7,
        maxLongitude: 38.9,
      },
      rolloutHours: {
        startHourLocal: 6,
        endHourLocal: 22,
        timezone: 'Africa/Addis_Ababa',
      },
      matchingDeadlineSeconds: 120,
      routingProviderTimeoutMs: 2_500,
      locationUpdateIntervalSeconds: 4,
      locationMinUpdateIntervalSeconds: 2,
      locationFreshnessSeconds: 16,
      locationCleanupTtlSeconds: 45,
      h3Resolution: 9,
      maxLocationAccuracyMeters: 35.5,
      capturedAtMaxAgeSeconds: 40,
      capturedAtMaxFutureSkewSeconds: 5,
      queuePrefix: 'dispatch:test',
      queueDefaultAttempts: 5,
      queueBackoffDelayMs: 2_000,
      queueWorkerShutdownTimeoutMs: 7_500,
      searchRadiusKm: 5,
      discoveryH3Resolution: 8,
      maxRings: 12,
      maxCandidates: 15,
      gebetaApiKey: 'test-key',
      gebetaBaseUrl: 'https://gebeta.test',
      gebetaTimeoutMs: 1_500,
      routingMaxConcurrency: 5,
      routingMaxCallsPerSecond: 10,
    });
  });

  it.each([
    ['DISPATCH_OFFER_TTL_SECONDS', '0'],
    ['DISPATCH_MATCHING_DEADLINE_SECONDS', '0'],
    ['DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS', '0'],
    ['DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS', '0'],
    ['DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS', '0'],
    ['DISPATCH_LOCATION_FRESHNESS_SECONDS', '0'],
    ['DISPATCH_LOCATION_CLEANUP_TTL_SECONDS', '0'],
    ['DISPATCH_H3_RESOLUTION', '16'],
    ['DISPATCH_MAX_LOCATION_ACCURACY_METERS', '0'],
    ['DISPATCH_CAPTURED_AT_MAX_AGE_SECONDS', '0'],
    ['DISPATCH_CAPTURED_AT_MAX_FUTURE_SKEW_SECONDS', '-1'],
    ['DISPATCH_QUEUE_DEFAULT_ATTEMPTS', '0'],
    ['DISPATCH_QUEUE_BACKOFF_DELAY_MS', '0'],
    ['DISPATCH_QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS', '0'],
    ['DISPATCH_ROUTING_MAX_CONCURRENCY', '0'],
    ['DISPATCH_ROUTING_MAX_CALLS_PER_SECOND', '-1'],
  ])('rejects invalid dispatch bound for %s', (key, value) => {
    expect(() => validateEnv({ ...minimal, [key]: value })).toThrow(
      new RegExp(key),
    );
  });

  it('rejects search radius exceeding ring coverage', () => {
    expect(() =>
      validateEnv({
        ...minimal,
        DISPATCH_SEARCH_RADIUS_KM: '10',
        DISPATCH_DISCOVERY_H3_RESOLUTION: '9',
        DISPATCH_MAX_RINGS: '6',
      }),
    ).toThrow(/DISPATCH_MAX_RINGS/);
  });

  it('accepts search radius within ring coverage', () => {
    expect(() =>
      validateEnv({
        ...minimal,
        DISPATCH_SEARCH_RADIUS_KM: '2',
        DISPATCH_DISCOVERY_H3_RESOLUTION: '9',
        DISPATCH_MAX_RINGS: '6',
      }),
    ).not.toThrow();
  });

  it('rejects an unsafe dispatch queue prefix', () => {
    expect(() =>
      validateEnv({ ...minimal, DISPATCH_QUEUE_PREFIX: 'dispatch prefix' }),
    ).toThrow(/DISPATCH_QUEUE_PREFIX/);
  });

  it.each([
    [
      'matching deadline must exceed offer TTL',
      {
        DISPATCH_OFFER_TTL_SECONDS: '15',
        DISPATCH_MATCHING_DEADLINE_SECONDS: '15',
      },
      /DISPATCH_MATCHING_DEADLINE_SECONDS/,
    ],
    [
      'provider timeout must fit inside the matching deadline',
      {
        DISPATCH_MATCHING_DEADLINE_SECONDS: '3',
        DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS: '3000',
      },
      /DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS/,
    ],
    [
      'minimum update interval cannot exceed expected update interval',
      {
        DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS: '3',
        DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS: '4',
      },
      /DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS/,
    ],
    [
      'cleanup TTL must exceed freshness threshold',
      {
        DISPATCH_LOCATION_FRESHNESS_SECONDS: '12',
        DISPATCH_LOCATION_CLEANUP_TTL_SECONDS: '12',
      },
      /DISPATCH_LOCATION_CLEANUP_TTL_SECONDS/,
    ],
    [
      'rollout pickup bounds must be configured together',
      {
        DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE: '8.9',
      },
      /DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE/,
    ],
    [
      'rollout pickup latitude min must be less than max',
      {
        DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE: '9.1',
        DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE: '8.9',
        DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE: '38.7',
        DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE: '38.9',
      },
      /DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE/,
    ],
    [
      'rollout pickup longitude min must be less than max',
      {
        DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE: '8.9',
        DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE: '9.1',
        DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE: '38.9',
        DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE: '38.7',
      },
      /DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE/,
    ],
    [
      'rollout hours must be configured together',
      {
        DISPATCH_ROLLOUT_START_HOUR_LOCAL: '6',
      },
      /DISPATCH_ROLLOUT_START_HOUR_LOCAL/,
    ],
    [
      'rollout hours must define a non-zero window',
      {
        DISPATCH_ROLLOUT_START_HOUR_LOCAL: '6',
        DISPATCH_ROLLOUT_END_HOUR_LOCAL: '6',
      },
      /DISPATCH_ROLLOUT_START_HOUR_LOCAL/,
    ],
  ])('rejects invalid dispatch combination: %s', (_name, values, message) => {
    expect(() => validateEnv({ ...minimal, ...values })).toThrow(message);
  });
});
