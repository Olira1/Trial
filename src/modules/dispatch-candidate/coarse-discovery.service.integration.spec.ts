import { randomUUID } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { latLngToCell } from 'h3-js';
import { Redis } from 'ioredis';
import { AppModule } from '../../app.module';
import { dispatchConfig, validateEnv } from '../../config';
import { REDIS_CLIENT } from '../redis';
import { driverPresenceRedisKeys } from '../driver-presence/driver-presence-redis-keys';
import type {
  DriverPresenceLeaseSnapshot,
  DriverPresenceOwnerLease,
} from '../driver-presence/driver-presence-lease.service';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import { DispatchCandidateModule } from './dispatch-candidate.module';
import { CoarseDiscoveryService } from './coarse-discovery.service';

const PICKUP = { latitude: 9.0106, longitude: 38.7613 };

type SeededDriver = {
  userId: string;
  presenceSessionId: string;
  ownerSessionId: string;
  presenceGeneration: number;
  latitude: number;
  longitude: number;
};

describe('CoarseDiscoveryService (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let redis: Redis;
  let service: CoarseDiscoveryService;
  let config: ConfigType<typeof dispatchConfig>;

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();
    process.env.DISPATCH_QUEUE_PREFIX = harness.namespace;
    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
    });

    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DispatchCandidateModule],
    }).compile();

    redis = moduleRef.get(REDIS_CLIENT);
    service = moduleRef.get(CoarseDiscoveryService);
    config = moduleRef.get(dispatchConfig.KEY);
  });

  afterEach(async () => {
    await harness.cleanupRedisNamespace();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await harness?.close();
  });

  const seedDriver = async (
    latitude: number,
    longitude: number,
    stale = false,
  ): Promise<SeededDriver> => {
    const userId = randomUUID();
    const presenceSessionId = randomUUID();
    const ownerSessionId = randomUUID();
    const presenceGeneration = 1;
    const now = new Date();
    const ttlSeconds = config.locationCleanupTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
    const freshUntil = stale
      ? new Date(now.getTime() - 1_000)
      : new Date(now.getTime() + config.locationFreshnessSeconds * 1_000);

    const h3Cell = latLngToCell(latitude, longitude, config.h3Resolution);

    const lease: DriverPresenceLeaseSnapshot = {
      userId,
      ownerSessionId,
      presenceSessionId,
      presenceGeneration,
      leaseId: randomUUID(),
      leaseSequence: 0,
      h3Cell,
      freshUntil: freshUntil.toISOString(),
      expiresAt: expiresAt.toISOString(),
      location: {
        latitude,
        longitude,
        accuracyMeters: 10,
        capturedAt: now.toISOString(),
      },
    };

    const owner: DriverPresenceOwnerLease = {
      userId,
      ownerSessionId,
      presenceSessionId,
      presenceGeneration,
      leaseId: lease.leaseId,
    };

    await redis
      .multi()
      .set(
        driverPresenceRedisKeys.lease(config.queuePrefix, presenceSessionId),
        JSON.stringify(lease),
        'EX',
        ttlSeconds,
      )
      .set(
        driverPresenceRedisKeys.owner(config.queuePrefix, userId),
        JSON.stringify(owner),
        'EX',
        ttlSeconds,
      )
      .zadd(
        driverPresenceRedisKeys.h3Cell(
          config.queuePrefix,
          config.h3Resolution,
          h3Cell,
        ),
        expiresAt.getTime(),
        userId,
      )
      .expire(
        driverPresenceRedisKeys.h3Cell(
          config.queuePrefix,
          config.h3Resolution,
          h3Cell,
        ),
        ttlSeconds,
      )
      .exec();

    return {
      userId,
      presenceSessionId,
      ownerSessionId,
      presenceGeneration,
      latitude,
      longitude,
    };
  };

  it('finds fresh drivers within the search radius', async () => {
    const close = await seedDriver(9.0108, 38.7614);
    const far = await seedDriver(9.03, 38.77); // ~2.8km from pickup
    const outside = await seedDriver(9.08, 38.82); // outside 3km

    const candidates = await service.findCandidates(
      PICKUP.latitude,
      PICKUP.longitude,
    );

    const ids = candidates.map((c) => c.driverId);
    expect(ids).toContain(close.userId);
    expect(ids).toContain(far.userId);
    expect(ids).not.toContain(outside.userId);
  });

  it('excludes stale drivers', async () => {
    const fresh = await seedDriver(9.0108, 38.7614);
    await seedDriver(9.0109, 38.7615, true);

    const candidates = await service.findCandidates(
      PICKUP.latitude,
      PICKUP.longitude,
    );

    expect(candidates.map((c) => c.driverId)).toEqual([fresh.userId]);
  });

  it('excludes previously rejected drivers', async () => {
    const accepted = await seedDriver(9.0108, 38.7614);
    const rejected = await seedDriver(9.0109, 38.7615);

    const candidates = await service.findCandidates(
      PICKUP.latitude,
      PICKUP.longitude,
      new Set([rejected.userId]),
    );

    expect(candidates.map((c) => c.driverId)).toEqual([accepted.userId]);
  });

  it('returns an empty array when no drivers are present', async () => {
    const candidates = await service.findCandidates(
      PICKUP.latitude,
      PICKUP.longitude,
    );
    expect(candidates).toEqual([]);
  });

  it('caps results at maxCandidates and sorts by straight-line distance', async () => {
    const drivers = await Promise.all(
      Array.from({ length: config.maxCandidates + 5 }).map((_, i) =>
        seedDriver(PICKUP.latitude + i * 0.0002, PICKUP.longitude + i * 0.0002),
      ),
    );

    const candidates = await service.findCandidates(
      PICKUP.latitude,
      PICKUP.longitude,
    );

    expect(candidates.length).toBeLessThanOrEqual(config.maxCandidates);
    const sorted = [...candidates].every((c, i, arr) => {
      if (i === 0) return true;
      const previous = arr[i - 1];
      if (!previous) throw new Error('expected previous candidate');
      return c.straightLineKm >= previous.straightLineKm;
    });
    expect(sorted).toBe(true);
    const [firstCandidate] = candidates;
    const [firstDriver] = drivers;
    if (!firstCandidate) throw new Error('expected discovered candidate');
    if (!firstDriver) throw new Error('expected seeded driver');
    expect(firstCandidate.driverId).toBe(firstDriver.userId);
  });

  it('deduplicates drivers that appear in multiple cells', async () => {
    // Two very close locations will end up in different res-10 child cells
    // of the same res-9 discovery cell, but the same driver should appear once.
    const driver = await seedDriver(9.01061, 38.76131);
    const candidates = await service.findCandidates(
      PICKUP.latitude,
      PICKUP.longitude,
    );

    const matching = candidates.filter((c) => c.driverId === driver.userId);
    expect(matching.length).toBeLessThanOrEqual(1);
  });
});
