import {
  FIFTEEN_MIN_IN_SECONDS,
  ONE_DAY_IN_SECONDS,
  THIRTY_DAYS_IN_SECONDS,
} from 'src/constants/time';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('production'),
    PORT: z.coerce.number().int().positive().default(3000),

    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    // Number of proxy hops to trust for `req.ip` (Express `trust proxy` setting).
    // 0 = trust nothing, 1 = trust one hop (typical behind a single load balancer).
    TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),

    // Max JSON body size accepted by the global body parser (e.g. "1mb", "100kb").
    JSON_BODY_LIMIT: z.string().default('100kb'),

    DATABASE_URL: z.url(),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string(),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(THIRTY_DAYS_IN_SECONDS),
    JWT_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(FIFTEEN_MIN_IN_SECONDS),
    COOKIE_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(ONE_DAY_IN_SECONDS),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60),

    JWT_SECRET: z.string().min(32),

    S3_BUCKET: z.string(),
    S3_REGION: z.string(),
    S3_ENDPOINT: z.url().optional(),
    S3_FORCE_PATH_STYLE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    FIREBASE_PROJECT_ID: z.string().trim().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().trim().min(1).optional(),

    FARE_STANDARD_RATE_MINOR_PER_KM: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    FARE_ESTIMATE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

    DISPATCH_OFFER_TTL_SECONDS: z.coerce.number().int().positive().default(15),
    DISPATCH_ENABLE_NEW_REQUESTS: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    DISPATCH_ENABLE_NEW_MATCHING: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    DISPATCH_ENABLE_SHADOW_RANKING: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    DISPATCH_INTERNAL_RIDER_ALLOWLIST: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    DISPATCH_INTERNAL_DRIVER_ALLOWLIST: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE: z.coerce.number().optional(),
    DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE: z.coerce.number().optional(),
    DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE: z.coerce.number().optional(),
    DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE: z.coerce.number().optional(),
    DISPATCH_ROLLOUT_START_HOUR_LOCAL: z.coerce
      .number()
      .int()
      .min(0)
      .max(23)
      .optional(),
    DISPATCH_ROLLOUT_END_HOUR_LOCAL: z.coerce
      .number()
      .int()
      .min(0)
      .max(23)
      .optional(),
    DISPATCH_ROLLOUT_TIMEZONE: z
      .string()
      .trim()
      .min(1)
      .default('Africa/Addis_Ababa'),
    DISPATCH_MATCHING_DEADLINE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(90),
    DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(3_000),
    DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(1),
    DISPATCH_LOCATION_FRESHNESS_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(12),
    DISPATCH_LOCATION_CLEANUP_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30),
    DISPATCH_H3_RESOLUTION: z.coerce.number().int().min(0).max(15).default(10),
    DISPATCH_MAX_LOCATION_ACCURACY_METERS: z.coerce
      .number()
      .positive()
      .default(50),
    DISPATCH_CAPTURED_AT_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30),
    DISPATCH_CAPTURED_AT_MAX_FUTURE_SKEW_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(10),
    DISPATCH_QUEUE_PREFIX: z
      .string()
      .trim()
      .min(1)
      .regex(/^[A-Za-z0-9:_-]+$/)
      .default('ubel:dispatch'),
    DISPATCH_QUEUE_DEFAULT_ATTEMPTS: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    DISPATCH_QUEUE_BACKOFF_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(1_000),
    DISPATCH_QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),
    DISPATCH_SEARCH_RADIUS_KM: z.coerce.number().positive().default(3),
    DISPATCH_DISCOVERY_H3_RESOLUTION: z.coerce
      .number()
      .int()
      .min(0)
      .max(15)
      .default(9),
    DISPATCH_MAX_RINGS: z.coerce.number().int().positive().default(9),
    DISPATCH_MAX_CANDIDATES: z.coerce.number().int().positive().default(9),
    GEBETA_API_KEY: z.string().trim().min(1).optional(),
    GEBETA_BASE_URL: z.url().default('https://api.gebeta.app'),
    GEBETA_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
    DISPATCH_ROUTING_MAX_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    DISPATCH_ROUTING_MAX_CALLS_PER_SECOND: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(0),
  })
  .superRefine((env, ctx) => {
    const firebaseValues = [
      env.FIREBASE_PROJECT_ID,
      env.FIREBASE_CLIENT_EMAIL,
      env.FIREBASE_PRIVATE_KEY,
    ];
    const configuredCount = firebaseValues.filter(Boolean).length;
    if (configuredCount > 0 && configuredCount < firebaseValues.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_PROJECT_ID'],
        message:
          'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must be configured together',
      });
    }
    if (
      env.DISPATCH_MATCHING_DEADLINE_SECONDS <= env.DISPATCH_OFFER_TTL_SECONDS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_MATCHING_DEADLINE_SECONDS'],
        message:
          'DISPATCH_MATCHING_DEADLINE_SECONDS must be greater than DISPATCH_OFFER_TTL_SECONDS',
      });
    }
    if (
      env.DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS >=
      env.DISPATCH_MATCHING_DEADLINE_SECONDS * 1_000
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS'],
        message:
          'DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS must be less than DISPATCH_MATCHING_DEADLINE_SECONDS',
      });
    }
    if (
      env.DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS >
      env.DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS'],
        message:
          'DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS must be less than or equal to DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS',
      });
    }
    if (
      env.DISPATCH_LOCATION_CLEANUP_TTL_SECONDS <=
      env.DISPATCH_LOCATION_FRESHNESS_SECONDS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_LOCATION_CLEANUP_TTL_SECONDS'],
        message:
          'DISPATCH_LOCATION_CLEANUP_TTL_SECONDS must be greater than DISPATCH_LOCATION_FRESHNESS_SECONDS',
      });
    }
    const rolloutBounds = [
      env.DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE,
      env.DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE,
      env.DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE,
      env.DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE,
    ];
    const configuredRolloutBounds = rolloutBounds.filter(
      (value) => value !== undefined,
    ).length;
    if (
      configuredRolloutBounds > 0 &&
      configuredRolloutBounds < rolloutBounds.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE'],
        message:
          'DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE, DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE, DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE, and DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE must be configured together',
      });
    }
    if (
      env.DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE !== undefined &&
      env.DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE !== undefined &&
      env.DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE >=
        env.DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE'],
        message:
          'DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE must be less than DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE',
      });
    }
    if (
      env.DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE !== undefined &&
      env.DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE !== undefined &&
      env.DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE >=
        env.DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE'],
        message:
          'DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE must be less than DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE',
      });
    }
    const rolloutHoursConfigured = [
      env.DISPATCH_ROLLOUT_START_HOUR_LOCAL,
      env.DISPATCH_ROLLOUT_END_HOUR_LOCAL,
    ].filter((value) => value !== undefined).length;
    if (rolloutHoursConfigured === 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_ROLLOUT_START_HOUR_LOCAL'],
        message:
          'DISPATCH_ROLLOUT_START_HOUR_LOCAL and DISPATCH_ROLLOUT_END_HOUR_LOCAL must be configured together',
      });
    }
    if (
      env.DISPATCH_ROLLOUT_START_HOUR_LOCAL !== undefined &&
      env.DISPATCH_ROLLOUT_END_HOUR_LOCAL !== undefined &&
      env.DISPATCH_ROLLOUT_START_HOUR_LOCAL ===
        env.DISPATCH_ROLLOUT_END_HOUR_LOCAL
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_ROLLOUT_START_HOUR_LOCAL'],
        message:
          'DISPATCH_ROLLOUT_START_HOUR_LOCAL must differ from DISPATCH_ROLLOUT_END_HOUR_LOCAL',
      });
    }

    const h3RingCoverageKm: Record<number, number> = {
      6: 0.879,
      7: 0.505,
      8: 0.299,
      9: 0.174,
      10: 0.1,
      11: 0.058,
      12: 0.033,
      13: 0.019,
      14: 0.011,
      15: 0.006,
    };
    const res = env.DISPATCH_DISCOVERY_H3_RESOLUTION;
    const edge = h3RingCoverageKm[res] ?? 0.174;
    const maxCoverageKm = env.DISPATCH_MAX_RINGS * edge * 2;
    if (env.DISPATCH_SEARCH_RADIUS_KM > maxCoverageKm) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISPATCH_MAX_RINGS'],
        message: `DISPATCH_MAX_RINGS=${env.DISPATCH_MAX_RINGS} at resolution ${res} covers at most ~${maxCoverageKm.toFixed(1)}km, but DISPATCH_SEARCH_RADIUS_KM=${env.DISPATCH_SEARCH_RADIUS_KM}`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cachedEnv = parsed.data;
  return parsed.data;
};

let cachedEnv: Env | undefined;

/**
 * Returns the validated, fully-typed env. Safe to call from `registerAs`
 * factories — `validateEnv` runs first via `ConfigModule.forRoot({ validate })`,
 * so the cache is populated before any config namespace is built.
 */
export const env = (): Env => {
  if (!cachedEnv) {
    // Fallback for contexts where ConfigModule hasn't initialised yet
    // (e.g. drizzle-kit CLI invocations).
    cachedEnv = validateEnv(process.env);
  }
  return cachedEnv;
};
