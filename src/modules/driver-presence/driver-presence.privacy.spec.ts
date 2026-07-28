import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { App } from 'supertest/types';
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

type DocumentType = typeof documentTable.$inferInsert.documentType;

const REQUIRED_DOCUMENTS = [
  'vehicle_ownership',
  'driver_license_front',
  'driver_license_back',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
] as const satisfies readonly DocumentType[];

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

const COORDINATE_PATTERNS = ['latitude', 'longitude'] as const;

type OnlineResponseBody = {
  operationalState: 'online' | 'offline';
  presenceSessionId: string | null;
  leaseId: string | null;
  leaseSequence: number | null;
  resumeRequired: boolean;
};

type LeaseSnapshot = {
  location: { latitude: number; longitude: number };
};

type OwnerRecord = Record<string, unknown>;

function resolvePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as Record<string, unknown>;
  }
  return payload as Record<string, unknown>;
}

function assertNoCoordinates(actual: unknown, path = 'root'): void {
  if (actual === null || actual === undefined) {
    return;
  }
  if (Array.isArray(actual)) {
    actual.forEach((item, index) =>
      assertNoCoordinates(item, `${path}[${index}]`),
    );
    return;
  }
  if (typeof actual === 'object' && !(actual instanceof Date)) {
    const obj = actual as Record<string, unknown>;
    for (const key of COORDINATE_PATTERNS) {
      if (key in obj) {
        throw new Error(
          `unexpected coordinate key "${key}" found at ${path} in response: ${JSON.stringify(actual)}`,
        );
      }
    }
    for (const [key, val] of Object.entries(obj)) {
      assertNoCoordinates(val, `${path}.${key}`);
    }
  }
}

describe('Driver presence privacy invariants', () => {
  let harness: DispatchIntegrationTestHarness;
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let db: Database;
  let redis: Redis;
  let jwtSecret: string;
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
    jwtSecret = moduleFixture.get<ConfigType<typeof authConfig>>(
      authConfig.KEY,
    ).jwtSecret;

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
    jest.restoreAllMocks();
    await harness?.cleanupRedisNamespace();

    for (const userId of userIds) {
      await db
        ?.delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, userId))
        .catch(() => undefined);
      await db
        ?.delete(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, userId))
        .catch(() => undefined);
      await db
        ?.delete(documentTable)
        .where(eq(documentTable.userId, userId))
        .catch(() => undefined);
      await db?.delete(vehicle).where(eq(vehicle.userId, userId));
      await db
        ?.delete(driverApplication)
        .where(eq(driverApplication.userId, userId));
      await db?.delete(authIdentity).where(eq(authIdentity.userId, userId));
      await db?.delete(authSession).where(eq(authSession.userId, userId));
      await db?.delete(user).where(eq(user.id, userId));
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

  describe('database schema', () => {
    it('driver_operational_profile has no coordinate columns', async () => {
      const { rows } = await db.execute(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'driver_operational_profile'
           AND column_name IN ('latitude', 'longitude')`,
      );

      expect(rows).toEqual([]);
    });
  });

  describe('REST API responses exclude coordinates', () => {
    it('GET /me snapshot response contains no coordinates', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken } = await issueAccessToken(fixture.userId);

      const onlineResponse = await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/online')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          initialLocation: {
            latitude: 9.013,
            longitude: 38.766,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        })
        .expect(200);

      assertNoCoordinates(onlineResponse.body);

      const snapshotResponse = await request(app.getHttpServer())
        .get('/api/v1/drivers/presence/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      assertNoCoordinates(snapshotResponse.body);
    });

    it('POST /online response contains no coordinates', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken } = await issueAccessToken(fixture.userId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/online')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          initialLocation: {
            latitude: 9.014,
            longitude: 38.767,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        })
        .expect(200);

      assertNoCoordinates(response.body);
    });

    it('POST /offline response contains no coordinates', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
      const presenceSessionId = randomUUID();

      await db.insert(driverOperationalProfile).values({
        userId: fixture.userId,
        operationalState: 'online',
        ownerSessionId: sessionId,
        presenceSessionId,
        presenceGeneration: 1,
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/offline')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(200);

      assertNoCoordinates(response.body);
    });

    it('POST /resume response contains no coordinates', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
      const presenceSessionId = randomUUID();

      await db.insert(driverOperationalProfile).values({
        userId: fixture.userId,
        operationalState: 'online',
        ownerSessionId: sessionId,
        presenceSessionId,
        presenceGeneration: 4,
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/resume')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          presenceSessionId,
          currentLocation: {
            latitude: 9.015,
            longitude: 38.768,
            accuracyMeters: 10,
            capturedAt: new Date().toISOString(),
          },
        })
        .expect(200);

      assertNoCoordinates(response.body);
    });

    it('error responses contain no coordinates', async () => {
      const fixture = await createEligibleDriver({
        applicationPatch: { status: 'pending' },
      });
      const { accessToken } = await issueAccessToken(fixture.userId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/online')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          initialLocation: {
            latitude: 9.016,
            longitude: 38.769,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        })
        .expect(403);

      assertNoCoordinates(response.body);
    });
  });

  describe('outbox event payloads exclude coordinates', () => {
    it('online outbox event payload has no coordinates', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken } = await issueAccessToken(fixture.userId);

      await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/online')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          initialLocation: {
            latitude: 9.017,
            longitude: 38.77,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        })
        .expect(200);

      const [event] = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));

      expect(event).toBeDefined();
      const payload = resolvePayload(event!.payload);

      expect(payload).not.toHaveProperty('latitude');
      expect(payload).not.toHaveProperty('longitude');
    });

    it('offline outbox event payload has no coordinates', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
      await db.insert(driverOperationalProfile).values({
        userId: fixture.userId,
        operationalState: 'online',
        ownerSessionId: sessionId,
        presenceSessionId: randomUUID(),
        presenceGeneration: 1,
      });

      await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/offline')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(200);

      const [event] = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));

      expect(event).toBeDefined();
      const payload = resolvePayload(event!.payload);

      expect(payload).not.toHaveProperty('latitude');
      expect(payload).not.toHaveProperty('longitude');
    });
  });

  describe('Redis ephemeral storage contains coordinates (control assertion)', () => {
    it('Redis lease snapshot does contain coordinate data', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken } = await issueAccessToken(fixture.userId);

      const onlineResponse = await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/online')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          initialLocation: {
            latitude: 9.018,
            longitude: 38.771,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        })
        .expect(200);

      const presenceSessionId = (onlineResponse.body as OnlineResponseBody)
        .presenceSessionId;
      const leaseRaw = await redis.get(
        `${harness.namespace}:driver_presence:lease:${presenceSessionId}`,
      );
      expect(leaseRaw).not.toBeNull();

      const lease = JSON.parse(leaseRaw as string) as LeaseSnapshot;
      expect(lease.location.latitude).toBe(9.018);
      expect(lease.location.longitude).toBe(38.771);
    });

    it('Redis owner authority has no coordinates', async () => {
      const fixture = await createEligibleDriver();
      const { accessToken } = await issueAccessToken(fixture.userId);

      await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/online')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          initialLocation: {
            latitude: 9.019,
            longitude: 38.772,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        })
        .expect(200);

      const ownerRaw = await redis.get(
        `${harness.namespace}:driver_presence:owner:${fixture.userId}`,
      );
      expect(ownerRaw).not.toBeNull();

      const owner = JSON.parse(ownerRaw as string) as OwnerRecord;
      assertNoCoordinates(owner);
    });
  });

  const createEligibleDriver = async (options?: {
    applicationPatch?: Partial<typeof driverApplication.$inferInsert>;
  }) => {
    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Privacy',
        lastName: 'Test',
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
        ...options?.applicationPatch,
      })
      .returning();
    if (!application) {
      throw new Error('test setup failed to create driver application');
    }

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
      accessToken: jwt.sign({ sub: userId, sid: session.id }, jwtSecret, {
        expiresIn: 900,
      }),
    };
  };
});
