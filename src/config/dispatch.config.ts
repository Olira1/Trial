import { registerAs } from '@nestjs/config';
import { env } from './env.schema';

export type DispatchConfig = {
  offerTtlSeconds: number;
  enableNewRequests: boolean;
  enableNewMatching: boolean;
  enableShadowRanking: boolean;
  internalRiderAllowlist: string[];
  internalDriverAllowlist: string[];
  rolloutPickupBounds: {
    minLatitude: number;
    maxLatitude: number;
    minLongitude: number;
    maxLongitude: number;
  } | null;
  rolloutHours: {
    startHourLocal: number;
    endHourLocal: number;
    timezone: string;
  } | null;
  matchingDeadlineSeconds: number;
  routingProviderTimeoutMs: number;
  locationUpdateIntervalSeconds: number;
  locationMinUpdateIntervalSeconds: number;
  locationFreshnessSeconds: number;
  locationCleanupTtlSeconds: number;
  h3Resolution: number;
  maxLocationAccuracyMeters: number;
  capturedAtMaxAgeSeconds: number;
  capturedAtMaxFutureSkewSeconds: number;
  queuePrefix: string;
  queueDefaultAttempts: number;
  queueBackoffDelayMs: number;
  queueWorkerShutdownTimeoutMs: number;
  searchRadiusKm: number;
  discoveryH3Resolution: number;
  maxRings: number;
  maxCandidates: number;
  gebetaApiKey?: string;
  gebetaBaseUrl: string;
  gebetaTimeoutMs: number;
  routingMaxConcurrency: number;
  routingMaxCallsPerSecond: number;
};

export const dispatchConfig = registerAs('dispatch', (): DispatchConfig => {
  const e = env();
  const rolloutPickupBounds =
    e.DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE !== undefined
      ? {
          minLatitude: e.DISPATCH_ROLLOUT_PICKUP_MIN_LATITUDE,
          maxLatitude: e.DISPATCH_ROLLOUT_PICKUP_MAX_LATITUDE!,
          minLongitude: e.DISPATCH_ROLLOUT_PICKUP_MIN_LONGITUDE!,
          maxLongitude: e.DISPATCH_ROLLOUT_PICKUP_MAX_LONGITUDE!,
        }
      : null;
  const rolloutHours =
    e.DISPATCH_ROLLOUT_START_HOUR_LOCAL !== undefined
      ? {
          startHourLocal: e.DISPATCH_ROLLOUT_START_HOUR_LOCAL,
          endHourLocal: e.DISPATCH_ROLLOUT_END_HOUR_LOCAL!,
          timezone: e.DISPATCH_ROLLOUT_TIMEZONE,
        }
      : null;

  return {
    offerTtlSeconds: e.DISPATCH_OFFER_TTL_SECONDS,
    enableNewRequests: e.DISPATCH_ENABLE_NEW_REQUESTS,
    enableNewMatching: e.DISPATCH_ENABLE_NEW_MATCHING,
    enableShadowRanking: e.DISPATCH_ENABLE_SHADOW_RANKING,
    internalRiderAllowlist: e.DISPATCH_INTERNAL_RIDER_ALLOWLIST,
    internalDriverAllowlist: e.DISPATCH_INTERNAL_DRIVER_ALLOWLIST,
    rolloutPickupBounds,
    rolloutHours,
    matchingDeadlineSeconds: e.DISPATCH_MATCHING_DEADLINE_SECONDS,
    routingProviderTimeoutMs: e.DISPATCH_ROUTING_PROVIDER_TIMEOUT_MS,
    locationUpdateIntervalSeconds: e.DISPATCH_LOCATION_UPDATE_INTERVAL_SECONDS,
    locationMinUpdateIntervalSeconds:
      e.DISPATCH_LOCATION_MIN_UPDATE_INTERVAL_SECONDS,
    locationFreshnessSeconds: e.DISPATCH_LOCATION_FRESHNESS_SECONDS,
    locationCleanupTtlSeconds: e.DISPATCH_LOCATION_CLEANUP_TTL_SECONDS,
    h3Resolution: e.DISPATCH_H3_RESOLUTION,
    maxLocationAccuracyMeters: e.DISPATCH_MAX_LOCATION_ACCURACY_METERS,
    capturedAtMaxAgeSeconds: e.DISPATCH_CAPTURED_AT_MAX_AGE_SECONDS,
    capturedAtMaxFutureSkewSeconds:
      e.DISPATCH_CAPTURED_AT_MAX_FUTURE_SKEW_SECONDS,
    queuePrefix: e.DISPATCH_QUEUE_PREFIX,
    queueDefaultAttempts: e.DISPATCH_QUEUE_DEFAULT_ATTEMPTS,
    queueBackoffDelayMs: e.DISPATCH_QUEUE_BACKOFF_DELAY_MS,
    queueWorkerShutdownTimeoutMs: e.DISPATCH_QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS,
    searchRadiusKm: e.DISPATCH_SEARCH_RADIUS_KM,
    discoveryH3Resolution: e.DISPATCH_DISCOVERY_H3_RESOLUTION,
    maxRings: e.DISPATCH_MAX_RINGS,
    maxCandidates: e.DISPATCH_MAX_CANDIDATES,
    gebetaApiKey: e.GEBETA_API_KEY,
    gebetaBaseUrl: e.GEBETA_BASE_URL,
    gebetaTimeoutMs: e.GEBETA_TIMEOUT_MS,
    routingMaxConcurrency: e.DISPATCH_ROUTING_MAX_CONCURRENCY,
    routingMaxCallsPerSecond: e.DISPATCH_ROUTING_MAX_CALLS_PER_SECOND,
  };
});
