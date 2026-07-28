import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { AppModule } from '../../app.module';
import { authConfig, validateEnv } from '../../config';
import { DRIZZLE, type Database } from '../../database/database.module';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authSession } from '../auth/schema/session.schema';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { REDIS_CLIENT, type Redis } from '../redis';
import { user } from '../user';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import { driverOperationalProfile } from './schema';
import { DriverPresenceReconciliationService } from './driver-presence-reconciliation.service';
import { DriverPresenceService } from './driver-presence.service';
import { driverPresenceRedisKeys } from './driver-presence-redis-keys';
import type {
  DriverPresenceLeaseSnapshot,
  DriverPresenceOwnerLease,
} from './driver-presence-lease.service';

type DocumentType = typeof documentTable.$inferInsert.documentType;
type LeaseWithH3Cell = { h3Cell: string };

const REQUIRED_DOCUMENTS: readonly DocumentType[] = [
  'vehicle_ownership',
  'driver_license_front',
  'driver_license_back',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
];

const EXPIRY_TRACKED_DOCUMENTS = new Set<DocumentType>([
  'driver_license_front',
  'driver_license_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
]);

const VEHICLE_DOCUMENTS = new Set<DocumentType>([
  'vehicle_ownership',
  'representation_letter',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasH3Cell = (value: unknown): value is LeaseWithH3Cell =>
  isRecord(value) && typeof value.h3Cell === 'string';

describe('DriverPresenceReconciliationService', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleFixture: TestingModule;
  let app: INestApplication;
  let db: Database;
  let redis: Redis;
  let authCfg: ConfigType<typeof authConfig>;
  const userIds = new Set<string>();

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();
    process.env.DISPATCH_QUEUE_PREFIX = harness.namespace;
    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
    });

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    db = moduleFixture.get(DRIZZLE);
    redis = moduleFixture.get(REDIS_CLIENT);
    authCfg = moduleFixture.get(authConfig.KEY);

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'v',
      defaultVersion: '1',
    });
    app.enableShutdownHooks();
    await app.init();
  });

  afterEach(async () => {
    await harness.cleanupRedisNamespace();
    for (const userId of userIds) {
      await db
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, userId))
        .catch(() => undefined);
      await db
        .delete(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, userId))
        .catch(() => undefined);
      await db
        .delete(documentTable)
        .where(eq(documentTable.userId, userId))
        .catch(() => undefined);
      await db.delete(vehicle).where(eq(vehicle.userId, userId));
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, userId));
      await db.delete(authIdentity).where(eq(authIdentity.userId, userId));
      await db.delete(authSession).where(eq(authSession.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
    userIds.clear();
  });

  afterAll(async () => {
    await app?.close();
    if (redis?.status !== 'end') {
      await redis?.quit().catch(() => redis.disconnect());
    }
    await harness?.cleanupRedisNamespace();
    await harness?.close();
  });

  describe('reconcile', () => {
    it('removes stale Redis owner/lease entries when driver has no operational profile', async () => {
      const fixture = await createEligibleDriver();
      const prefix = harness.namespace;
      const sessionId = randomUUID();
      const presenceSessionId = randomUUID();
      const leaseId = randomUUID();

      const ownerKey = driverPresenceRedisKeys.owner(prefix, fixture.userId);
      const leaseKey = driverPresenceRedisKeys.lease(prefix, presenceSessionId);

      await redis.set(
        ownerKey,
        JSON.stringify({
          userId: fixture.userId,
          ownerSessionId: sessionId,
          presenceSessionId,
          presenceGeneration: 1,
          leaseId,
        } satisfies DriverPresenceOwnerLease),
        'EX',
        30,
      );
      await redis.set(
        leaseKey,
        JSON.stringify({
          userId: fixture.userId,
          ownerSessionId: sessionId,
          presenceSessionId,
          presenceGeneration: 1,
          leaseId,
          leaseSequence: 0,
          h3Cell: 'test-cell',
          freshUntil: new Date(Date.now() + 12_000).toISOString(),
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          location: {
            latitude: 9.01,
            longitude: 38.76,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        } satisfies DriverPresenceLeaseSnapshot),
        'EX',
        30,
      );

      expect(await redis.exists(ownerKey)).toBe(1);
      expect(await redis.exists(leaseKey)).toBe(1);

      const service = moduleFixture.get(DriverPresenceReconciliationService);
      const result = await service.reconcile();

      expect(result.cleanedUserIds).toContain(fixture.userId);
      expect(await redis.exists(ownerKey)).toBe(0);
      expect(await redis.exists(leaseKey)).toBe(0);
    });

    it('removes stale Redis entries when driver is explicitly offline in durable state', async () => {
      const { userId, sessionId } = await setupOnlineDriver();
      const prefix = harness.namespace;

      const presenceService = moduleFixture.get(DriverPresenceService);
      await presenceService.goOffline({ userId, sessionId });

      const ownerKey = driverPresenceRedisKeys.owner(prefix, userId);
      const presenceSessionId = (
        await db
          .select({
            presenceSessionId: driverOperationalProfile.presenceSessionId,
          })
          .from(driverOperationalProfile)
          .where(eq(driverOperationalProfile.userId, userId))
          .execute()
      )[0]?.presenceSessionId;
      const leaseKey = driverPresenceRedisKeys.lease(
        prefix,
        presenceSessionId ?? '',
      );

      const service = moduleFixture.get(DriverPresenceReconciliationService);
      await service.reconcile();

      expect(await redis.exists(ownerKey)).toBe(0);
      expect(await redis.exists(leaseKey)).toBe(0);
    });

    it('does not disturb valid online drivers with fresh Redis leases', async () => {
      const { userId } = await setupOnlineDriver();
      const prefix = harness.namespace;
      const ownerKey = driverPresenceRedisKeys.owner(prefix, userId);

      expect(await redis.exists(ownerKey)).toBe(1);

      const service = moduleFixture.get(DriverPresenceReconciliationService);
      const result = await service.reconcile();

      expect(result.cleanedUserIds).not.toContain(userId);
      expect(await redis.exists(ownerKey)).toBe(1);
    });

    it('detects disagreement when driver is online in PG but has no Redis lease', async () => {
      const { userId } = await setupOnlineDriver();
      const prefix = harness.namespace;
      const ownerKey = driverPresenceRedisKeys.owner(prefix, userId);

      await redis.del(ownerKey);

      const service = moduleFixture.get(DriverPresenceReconciliationService);
      const result = await service.reconcile();

      expect(result.disagreementCount).toBeGreaterThanOrEqual(1);
    });

    it('removes H3 cell membership alongside stale owner/lease', async () => {
      const { userId } = await setupOnlineDriver();
      const prefix = harness.namespace;

      const profile = await db
        .select()
        .from(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, userId))
        .execute()
        .then((r) => r[0]);
      expect(profile).toBeDefined();
      if (!profile) throw new Error('expected driver profile');

      const presenceSessionId = profile.presenceSessionId;
      if (presenceSessionId === null) {
        throw new Error('expected driver profile presence session');
      }
      const leaseKey = driverPresenceRedisKeys.lease(prefix, presenceSessionId);
      const leaseRaw = await redis.get(leaseKey);
      expect(leaseRaw).toBeDefined();
      if (leaseRaw === null) throw new Error('expected Redis lease');
      const leaseJson: unknown = JSON.parse(leaseRaw);
      if (!hasH3Cell(leaseJson)) throw new Error('expected Redis lease cell');

      await db
        .update(driverOperationalProfile)
        .set({
          operationalState: 'offline',
          ownerSessionId: null,
          presenceSessionId: null,
        })
        .where(eq(driverOperationalProfile.userId, userId));

      const cellKey = `${prefix}:driver_presence:h3:${10}:${leaseJson.h3Cell}`;
      const membersBefore = await redis.zrange(cellKey, 0, -1);
      expect(membersBefore).toContain(userId);

      const service = moduleFixture.get(DriverPresenceReconciliationService);
      await service.reconcile();

      const membersAfter = await redis.zrange(cellKey, 0, -1);
      expect(membersAfter).not.toContain(userId);
    });

    it('handles Redis unavailability gracefully', async () => {
      const service = moduleFixture.get(DriverPresenceReconciliationService);
      const scanSpy = jest
        .spyOn(redis, 'scan')
        .mockRejectedValueOnce(new Error('Redis unreachable'));

      const result = await service.reconcile();

      expect(result.cleanedUserIds).toEqual([]);
      expect(result.disagreementCount).toBe(0);

      scanSpy.mockRestore();
    });
  });

  const createEligibleDriver = async () => {
    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Reconciliation',
        lastName: 'Driver',
        phoneVerified: true,
        roles: ['driver'],
      })
      .returning();
    if (!createdUser) throw new Error('test setup failed to create user');
    userIds.add(createdUser.id);

    await db.insert(authIdentity).values({
      userId: createdUser.id,
      type: 'phone',
      identifier: `+2519${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      verifiedAt: new Date(),
    });

    const [application] = await db
      .insert(driverApplication)
      .values({
        userId: createdUser.id,
        status: 'approved',
      })
      .returning();
    if (!application)
      throw new Error('test setup failed to create application');

    const [activeVehicle] = await db
      .insert(vehicle)
      .values({
        userId: createdUser.id,
        ownershipType: 'owner',
        make: 'Toyota',
        model: 'Vitz',
        color: 'white',
        year: 2022,
        plateRegion: 'aa',
        plateCode: '01',
        plateCodeSubtype: null,
        plateNumber: `P${randomUUID().replaceAll('-', '').slice(0, 6)}`,
        tinNumber: 'TIN-123',
        isApproved: true,
      })
      .returning();
    if (!activeVehicle) throw new Error('test setup failed to create vehicle');

    for (const documentType of REQUIRED_DOCUMENTS) {
      await db.insert(documentTable).values({
        userId: createdUser.id,
        driverApplicationId: VEHICLE_DOCUMENTS.has(documentType)
          ? null
          : application.id,
        vehicleId: VEHICLE_DOCUMENTS.has(documentType)
          ? activeVehicle.id
          : null,
        documentType,
        storageKey: `documents/${createdUser.id}/${documentType}/${randomUUID()}.jpg`,
        reviewStatus: 'approved',
        reviewedAt: new Date(),
        expiresAt: EXPIRY_TRACKED_DOCUMENTS.has(documentType)
          ? new Date(Date.now() + 86_400_000)
          : null,
      });
    }

    return { userId: createdUser.id };
  };

  const issueAccessToken = async (userId: string) => {
    const refreshToken = randomUUID();
    const [session] = await db
      .insert(authSession)
      .values({
        userId,
        tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        deviceId: `device-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: authSession.id });
    if (!session) throw new Error('test setup failed to create auth session');
    return {
      sessionId: session.id,
      refreshToken,
      accessToken: jwt.sign(
        { sub: userId, sid: session.id },
        authCfg.jwtSecret,
        {
          expiresIn: 900,
        },
      ),
    };
  };

  const setupOnlineDriver = async () => {
    const { userId } = await createEligibleDriver();
    const { sessionId } = await issueAccessToken(userId);

    const presenceService = moduleFixture.get(DriverPresenceService);
    await presenceService.goOnline({
      userId,
      sessionId,
      initialLocation: {
        latitude: 9.02,
        longitude: 38.78,
        accuracyMeters: 8,
        capturedAt: new Date(),
      },
      takeoverConfirmed: false,
    });

    return { userId, sessionId };
  };
});
