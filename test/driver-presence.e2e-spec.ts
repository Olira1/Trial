import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { authConfig, validateEnv } from '../src/config';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { authIdentity } from '../src/modules/auth/schema/auth-identity.schema';
import { authSession } from '../src/modules/auth/schema/session.schema';
import { dispatchOutboxEvent } from '../src/modules/dispatch-outbox/schema';
import { document as documentTable } from '../src/modules/driver/schema/document.schema';
import { driverApplication } from '../src/modules/driver/schema/driver-application.schema';
import { vehicle } from '../src/modules/driver/schema/vehicle.schema';
import { DriverPresenceLeaseService } from '../src/modules/driver-presence/driver-presence-lease.service';
import { driverOperationalProfile } from '../src/modules/driver-presence/schema';
import { REDIS_CLIENT, type Redis } from '../src/modules/redis';
import { user } from '../src/modules/user';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from './dispatch-integration-harness';

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

type DriverPresenceCommandBody = {
  operationalState: 'online' | 'offline';
  presenceSessionId: string | null;
  leaseId: string | null;
  leaseSequence: number | null;
  resumeRequired: boolean;
};

type DriverPresenceSnapshotBody = {
  operationalState: 'offline' | 'online' | 'offered' | 'assigned' | 'suspended';
  isCurrentSessionOwner: boolean;
  presenceSessionId: string | null;
  dispatchAvailable: boolean;
  unavailableReasons: string[];
};

type DriverPresenceLeaseBody = {
  userId: string;
  presenceSessionId: string;
  leaseId: string;
  leaseSequence: number;
  location: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
  };
};

const commandBody = (response: { body: unknown }) =>
  response.body as DriverPresenceCommandBody;

const snapshotBody = (response: { body: unknown }) =>
  response.body as DriverPresenceSnapshotBody;

const leaseBody = (raw: string) => JSON.parse(raw) as DriverPresenceLeaseBody;

describe('Driver presence (e2e)', () => {
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

  it('brings an eligible authenticated driver online with a durable owner profile and Redis lease', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken, sessionId } = await issueAccessToken(fixture.userId);

    const response = await request(app.getHttpServer())
      .post('/api/v1/drivers/presence/online')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        initialLocation: {
          latitude: 9.0105,
          longitude: 38.761,
          accuracyMeters: 8,
          capturedAt: new Date().toISOString(),
        },
      })
      .expect(200);

    const body = commandBody(response);

    expect(body).toMatchObject({
      operationalState: 'online',
      leaseSequence: 0,
      resumeRequired: false,
    });
    expect(body.presenceSessionId).toEqual(expect.any(String));
    expect(body.leaseId).toEqual(expect.any(String));

    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      userId: fixture.userId,
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId: body.presenceSessionId,
      presenceGeneration: 1,
    });

    const leaseRaw = await redis.get(
      `${harness.namespace}:driver_presence:lease:${body.presenceSessionId}`,
    );
    expect(leaseRaw).not.toBeNull();
    expect(leaseBody(leaseRaw as string)).toMatchObject({
      userId: fixture.userId,
      presenceSessionId: body.presenceSessionId,
      leaseId: body.leaseId,
      leaseSequence: 0,
      location: {
        latitude: 9.0105,
        longitude: 38.761,
        accuracyMeters: 8,
      },
    });

    const [event] = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));
    expect(event).toMatchObject({
      eventType: 'driver_presence.online.v1',
      aggregateType: 'driver_presence',
      aggregateId: fixture.userId,
      actorUserId: fixture.userId,
    });
    expect(event?.payload).toMatchObject({
      userId: fixture.userId,
      operationalState: 'online',
      presenceSessionId: body.presenceSessionId,
      presenceGeneration: 1,
    });
    expect(JSON.stringify(event?.payload)).not.toContain('latitude');
    expect(JSON.stringify(event?.payload)).not.toContain('longitude');
  });

  it('takes an online driver offline by clearing owner authority and advancing generation', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
    await db.insert(driverOperationalProfile).values({
      userId: fixture.userId,
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId: randomUUID(),
      presenceGeneration: 1,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/drivers/presence/offline')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(200);

    expect(commandBody(response)).toEqual({
      operationalState: 'offline',
      presenceSessionId: null,
      leaseId: null,
      leaseSequence: null,
      resumeRequired: false,
    });

    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      userId: fixture.userId,
      operationalState: 'offline',
      ownerSessionId: null,
      presenceSessionId: null,
      presenceGeneration: 2,
    });

    const [event] = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));
    expect(event).toMatchObject({
      eventType: 'driver_presence.offline.v1',
      aggregateType: 'driver_presence',
      aggregateId: fixture.userId,
      actorUserId: fixture.userId,
    });
    expect(event?.payload).toMatchObject({
      userId: fixture.userId,
      operationalState: 'offline',
      presenceGeneration: 2,
    });
    expect(JSON.stringify(event?.payload)).not.toContain('latitude');
    expect(JSON.stringify(event?.payload)).not.toContain('longitude');
  });

  it('resumes an owned online presence session without changing durable generation', async () => {
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
          latitude: 9.012,
          longitude: 38.765,
          accuracyMeters: 10,
          capturedAt: new Date().toISOString(),
        },
      })
      .expect(200);

    const body = commandBody(response);

    expect(body).toMatchObject({
      operationalState: 'online',
      presenceSessionId,
      leaseSequence: 0,
      resumeRequired: false,
    });
    expect(body.leaseId).toEqual(expect.any(String));

    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      userId: fixture.userId,
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId,
      presenceGeneration: 4,
    });

    const leaseRaw = await redis.get(
      `${harness.namespace}:driver_presence:lease:${presenceSessionId}`,
    );
    expect(leaseRaw).not.toBeNull();
    expect(leaseBody(leaseRaw as string)).toMatchObject({
      userId: fixture.userId,
      presenceSessionId,
      leaseId: body.leaseId,
      leaseSequence: 0,
      location: {
        latitude: 9.012,
        longitude: 38.765,
        accuracyMeters: 10,
      },
    });

    const events = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));
    expect(events).toEqual([]);
  });

  it('returns the authenticated driver presence snapshot without precise coordinates', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const online = await request(app.getHttpServer())
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
    const onlineBody = commandBody(online);

    const response = await request(app.getHttpServer())
      .get('/api/v1/drivers/presence/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = snapshotBody(response);

    expect(body).toEqual({
      operationalState: 'online',
      isCurrentSessionOwner: true,
      presenceSessionId: onlineBody.presenceSessionId,
      dispatchAvailable: true,
      unavailableReasons: [],
    });
    expect(JSON.stringify(body)).not.toContain('latitude');
    expect(JSON.stringify(body)).not.toContain('longitude');
  });

  it('rejects ineligible drivers without creating durable presence', async () => {
    const fixture = await createEligibleDriver({
      applicationPatch: { status: 'pending' },
    });
    const { accessToken } = await issueAccessToken(fixture.userId);

    await request(app.getHttpServer())
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
      .expect(403);

    await expect(loadProfile(fixture.userId)).resolves.toBeUndefined();
    const events = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));
    expect(events).toEqual([]);
  });

  it('requires confirmation before another mobile session takes over online presence', async () => {
    const fixture = await createEligibleDriver();
    const firstSession = await issueAccessToken(fixture.userId);
    const secondSession = await issueAccessToken(fixture.userId);
    const originalPresenceSessionId = randomUUID();
    await db.insert(driverOperationalProfile).values({
      userId: fixture.userId,
      operationalState: 'online',
      ownerSessionId: firstSession.sessionId,
      presenceSessionId: originalPresenceSessionId,
      presenceGeneration: 7,
    });

    await request(app.getHttpServer())
      .post('/api/v1/drivers/presence/online')
      .set('Authorization', `Bearer ${secondSession.accessToken}`)
      .send({
        initialLocation: {
          latitude: 9.015,
          longitude: 38.768,
          accuracyMeters: 9,
          capturedAt: new Date().toISOString(),
        },
      })
      .expect(409);

    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      ownerSessionId: firstSession.sessionId,
      presenceSessionId: originalPresenceSessionId,
      presenceGeneration: 7,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/drivers/presence/online')
      .set('Authorization', `Bearer ${secondSession.accessToken}`)
      .send({
        initialLocation: {
          latitude: 9.015,
          longitude: 38.768,
          accuracyMeters: 9,
          capturedAt: new Date().toISOString(),
        },
        takeoverConfirmed: true,
      })
      .expect(200);

    const body = commandBody(response);

    expect(body).toMatchObject({
      operationalState: 'online',
      leaseSequence: 0,
      resumeRequired: false,
    });
    expect(body.presenceSessionId).not.toBe(originalPresenceSessionId);
    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      ownerSessionId: secondSession.sessionId,
      presenceSessionId: body.presenceSessionId,
      presenceGeneration: 8,
    });

    const [event] = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));
    expect(event).toMatchObject({
      eventType: 'driver_presence.takeover.v1',
      payload: {
        operationalState: 'online',
        presenceSessionId: body.presenceSessionId,
        presenceGeneration: 8,
      },
    });
  });

  it.each(['offered', 'assigned'] as const)(
    'rejects online and offline commands while driver state is %s',
    async (operationalState) => {
      const fixture = await createEligibleDriver();
      const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
      await db.insert(driverOperationalProfile).values({
        userId: fixture.userId,
        operationalState,
        ownerSessionId: sessionId,
        presenceSessionId: randomUUID(),
        presenceGeneration: 2,
      });

      await request(app.getHttpServer())
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
        .expect(409);

      await request(app.getHttpServer())
        .post('/api/v1/drivers/presence/offline')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(409);

      await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
        operationalState,
        ownerSessionId: sessionId,
        presenceGeneration: 2,
      });
    },
  );

  it('rejects resume from a mobile session that does not own presence authority', async () => {
    const fixture = await createEligibleDriver();
    const ownerSession = await issueAccessToken(fixture.userId);
    const otherSession = await issueAccessToken(fixture.userId);
    const presenceSessionId = randomUUID();
    await db.insert(driverOperationalProfile).values({
      userId: fixture.userId,
      operationalState: 'online',
      ownerSessionId: ownerSession.sessionId,
      presenceSessionId,
      presenceGeneration: 5,
    });

    await request(app.getHttpServer())
      .post('/api/v1/drivers/presence/resume')
      .set('Authorization', `Bearer ${otherSession.accessToken}`)
      .send({
        presenceSessionId,
        currentLocation: {
          latitude: 9.017,
          longitude: 38.77,
          accuracyMeters: 9,
          capturedAt: new Date().toISOString(),
        },
      })
      .expect(409);

    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      ownerSessionId: ownerSession.sessionId,
      presenceSessionId,
      presenceGeneration: 5,
    });
    expect(
      await redis.get(
        `${harness.namespace}:driver_presence:lease:${presenceSessionId}`,
      ),
    ).toBeNull();
  });

  it('commits durable online state with resumeRequired when Redis lease creation fails', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
    jest
      .spyOn(
        moduleFixture.get(DriverPresenceLeaseService),
        'createInitialLease',
      )
      .mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await request(app.getHttpServer())
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

    const body = commandBody(response);

    expect(body).toMatchObject({
      operationalState: 'online',
      leaseId: null,
      leaseSequence: null,
      resumeRequired: true,
    });
    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId: body.presenceSessionId,
      presenceGeneration: 1,
    });
  });

  it('returns 503 from resume when Redis lease creation fails without changing durable state', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
    const presenceSessionId = randomUUID();
    await db.insert(driverOperationalProfile).values({
      userId: fixture.userId,
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId,
      presenceGeneration: 3,
    });
    jest
      .spyOn(
        moduleFixture.get(DriverPresenceLeaseService),
        'createInitialLease',
      )
      .mockRejectedValueOnce(new Error('redis unavailable'));

    await request(app.getHttpServer())
      .post('/api/v1/drivers/presence/resume')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        presenceSessionId,
        currentLocation: {
          latitude: 9.019,
          longitude: 38.772,
          accuracyMeters: 9,
          capturedAt: new Date().toISOString(),
        },
      })
      .expect(503);

    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId,
      presenceGeneration: 3,
    });
  });

  it('rejects initial locations less accurate than the dispatch limit', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);

    await request(app.getHttpServer())
      .post('/api/v1/drivers/presence/online')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        initialLocation: {
          latitude: 9.02,
          longitude: 38.773,
          accuracyMeters: 51,
          capturedAt: new Date().toISOString(),
        },
      })
      .expect(400);

    await expect(loadProfile(fixture.userId)).resolves.toBeUndefined();
  });

  const createEligibleDriver = async (options?: {
    applicationPatch?: Partial<typeof driverApplication.$inferInsert>;
  }) => {
    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Presence',
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

  const loadProfile = async (userId: string) => {
    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, userId));
    return profile;
  };
});
