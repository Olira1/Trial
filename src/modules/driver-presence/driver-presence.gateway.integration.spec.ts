import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { latLngToCell } from 'h3-js';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../../app.module';
import { authConfig, validateEnv } from '../../config';
import {
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authSession } from '../auth/schema/session.schema';
import { AuthService } from '../auth/auth.service';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { driverOperationalProfile } from './schema';
import { DriverPresenceLeaseService } from './driver-presence-lease.service';
import { REDIS_CLIENT, type Redis } from '../redis';
import { user } from '../user';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';

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

type PresenceCommandBody = {
  presenceSessionId: string;
  leaseId: string;
};

type PresenceUpdateAck = {
  status:
    | 'accepted'
    | 'ignored_duplicate'
    | 'ignored_stale_sequence'
    | 'ignored_rate_limited'
    | 'rejected_invalid'
    | 'rejected_unauthorized'
    | 'rejected_not_owner'
    | 'rejected_expired_lease'
    | 'rejected_stale_capture'
    | 'unavailable_redis';
};

type LeaseBody = {
  userId: string;
  ownerSessionId: string;
  presenceSessionId: string;
  leaseId: string;
  leaseSequence: number;
  h3Cell?: string;
  freshUntil?: string;
  expiresAt?: string;
  serverReceivedAt?: string;
  location: {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
  };
};

describe('DriverPresenceGateway (integration)', () => {
  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let app: INestApplication;
  let db: Database;
  let redis: Redis;
  let jwtSecret: string;
  let baseUrl: string;
  const userIds = new Set<string>();
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();
    process.env.DISPATCH_QUEUE_PREFIX = harness.namespace;
    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
    });

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    redis = moduleRef.get(REDIS_CLIENT);
    jwtSecret = moduleRef.get<ConfigType<typeof authConfig>>(
      authConfig.KEY,
    ).jwtSecret;

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'v',
      defaultVersion: '1',
    });
    app.enableShutdownHooks();
    await app.listen(0);

    const httpServer = app.getHttpServer() as {
      address: () => AddressInfo | string | null;
    };
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('test setup failed to bind HTTP server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    sockets.clear();

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
    for (const socket of sockets) {
      socket.disconnect();
    }
    await app?.close();
    if (redis?.status !== 'end') {
      await redis.quit().catch(() => redis.disconnect());
    }
    await moduleRef
      ?.get<Pool>(PG_POOL)
      .end()
      .catch(() => undefined);
    await harness.cleanupRedisNamespace();
    await harness.close();
  });

  it('rejects an unauthenticated dispatch socket handshake', async () => {
    const socket = io(`${baseUrl}/dispatch`, {
      transports: ['websocket'],
      auth: { token: 'invalid-access-token' },
      reconnection: false,
    });
    sockets.add(socket);

    await expect(
      new Promise<Error>((resolve) => {
        socket.on('connect_error', (error) => resolve(error));
      }),
    ).resolves.toMatchObject({ message: 'rejected_unauthorized' });
  });

  it('accepts ordered location updates for the owning lease and mutates only Redis fast-path state', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken, sessionId } = await issueAccessToken(fixture.userId);
    const presence = await goOnline(accessToken);
    const socket = await connectDispatchSocket(accessToken);

    const ack = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 1,
      latitude: 9.021,
      longitude: 38.781,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;

    expect(ack).toEqual({ status: 'accepted' });

    const lease = await loadLease(presence.presenceSessionId);
    expect(lease).toMatchObject({
      userId: fixture.userId,
      ownerSessionId: sessionId,
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      leaseSequence: 1,
      location: {
        latitude: 9.021,
        longitude: 38.781,
        accuracyMeters: 9,
      },
    });

    await expect(loadProfile(fixture.userId)).resolves.toMatchObject({
      operationalState: 'online',
      ownerSessionId: sessionId,
      presenceSessionId: presence.presenceSessionId,
      presenceGeneration: 1,
    });

    const [event] = await db
      .select()
      .from(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, fixture.userId));
    expect(event?.payload).not.toMatchObject({
      latitude: expect.any(Number) as number,
    });
  });

  it('indexes the initial lease into the driver H3 cell and removes it on offline', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const presence = await goOnline(accessToken);

    const lease = await loadLease(presence.presenceSessionId);
    const expectedCell = latLngToCell(9.02, 38.78, 10);

    expect(lease.h3Cell).toBe(expectedCell);
    await expect(loadCellMembers(expectedCell)).resolves.toContain(
      fixture.userId,
    );

    const offlineResponse = await fetch(
      `${baseUrl}/api/v1/drivers/presence/offline`,
      {
        method: 'POST',
        headers: requestHeaders(accessToken),
        body: JSON.stringify({}),
      },
    );
    expect(offlineResponse.status).toBe(200);

    await expect(loadCellMembers(expectedCell)).resolves.not.toContain(
      fixture.userId,
    );
  });

  it('moves H3 membership to the latest accepted cell and clears it after session revocation', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken, refreshToken } = await issueAccessToken(
      fixture.userId,
    );
    const presence = await goOnline(accessToken);
    const socket = await connectDispatchSocket(accessToken);
    const initialCell = latLngToCell(9.02, 38.78, 10);
    const movedCell = latLngToCell(9.03, 38.79, 10);
    expect(movedCell).not.toBe(initialCell);

    await setLeaseServerReceivedAt(
      presence.presenceSessionId,
      new Date(Date.now() - 2_000).toISOString(),
    );

    const movedAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 1,
      latitude: 9.03,
      longitude: 38.79,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;

    expect(movedAck).toEqual({ status: 'accepted' });
    await expect(loadCellMembers(initialCell)).resolves.not.toContain(
      fixture.userId,
    );
    await expect(loadCellMembers(movedCell)).resolves.toContain(fixture.userId);

    await expect(
      moduleRef.get(AuthService).logout({ refreshToken }),
    ).resolves.toEqual({ message: 'logged out' });

    await expect(loadCellMembers(movedCell)).resolves.not.toContain(
      fixture.userId,
    );
  });

  it('lists only fresh current-generation candidates for a cell', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const presence = await goOnline(accessToken);
    const leaseService = moduleRef.get(DriverPresenceLeaseService);
    const cell = latLngToCell(9.02, 38.78, 10);

    await expect(leaseService.listActiveCellCandidates(cell)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: fixture.userId,
          presenceSessionId: presence.presenceSessionId,
          leaseId: presence.leaseId,
          h3Cell: cell,
        }),
      ]),
    );

    await redis.del(
      `${harness.namespace}:driver_presence:owner:${fixture.userId}`,
    );

    await expect(leaseService.listActiveCellCandidates(cell)).resolves.toEqual(
      [],
    );
  });

  it('drops expired cell members and excludes generation-mismatched snapshots from candidate lookup', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const presence = await goOnline(accessToken);
    const leaseService = moduleRef.get(DriverPresenceLeaseService);
    const cell = latLngToCell(9.02, 38.78, 10);

    await redis.set(
      `${harness.namespace}:driver_presence:owner:${fixture.userId}`,
      JSON.stringify({
        userId: fixture.userId,
        ownerSessionId: 'mismatched-owner',
        presenceSessionId: presence.presenceSessionId,
        presenceGeneration: 99,
        leaseId: presence.leaseId,
      }),
      'EX',
      30,
    );
    await expect(leaseService.listActiveCellCandidates(cell)).resolves.toEqual(
      [],
    );

    await redis.zadd(
      `${harness.namespace}:driver_presence:h3:10:${cell}`,
      Date.now() - 1_000,
      fixture.userId,
    );
    await expect(
      leaseService.listActiveCellCandidates(cell, new Date()),
    ).resolves.toEqual([]);
    await expect(loadCellMembers(cell)).resolves.toEqual([]);
  });

  it('rejects further location updates after the owning mobile session is revoked', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken, refreshToken } = await issueAccessToken(
      fixture.userId,
    );
    const presence = await goOnline(accessToken);
    const socket = await connectDispatchSocket(accessToken);

    await expect(
      moduleRef.get(AuthService).logout({ refreshToken }),
    ).resolves.toEqual({ message: 'logged out' });

    const ack = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 1,
      latitude: 9.022,
      longitude: 38.782,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;

    expect(ack).toEqual({ status: 'rejected_expired_lease' });
  });

  it('acknowledges duplicate, stale-sequence, and rate-limited updates deterministically', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const presence = await goOnline(accessToken);
    const socket = await connectDispatchSocket(accessToken);

    const firstAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 1,
      latitude: 9.023,
      longitude: 38.783,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;
    expect(firstAck).toEqual({ status: 'accepted' });

    const duplicateAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 1,
      latitude: 9.023,
      longitude: 38.783,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;
    expect(duplicateAck).toEqual({ status: 'ignored_duplicate' });

    const rateLimitedAck = (await socket.emitWithAck(
      'presence:location:update',
      {
        presenceSessionId: presence.presenceSessionId,
        leaseId: presence.leaseId,
        sequence: 2,
        latitude: 9.024,
        longitude: 38.784,
        accuracyMeters: 9,
        capturedAt: new Date().toISOString(),
      },
    )) as PresenceUpdateAck;
    expect(rateLimitedAck).toEqual({ status: 'ignored_rate_limited' });

    await setLeaseServerReceivedAt(
      presence.presenceSessionId,
      new Date(Date.now() - 2_000).toISOString(),
    );

    const secondAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 2,
      latitude: 9.024,
      longitude: 38.784,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;
    expect(secondAck).toEqual({ status: 'accepted' });

    const staleAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 1,
      latitude: 9.023,
      longitude: 38.783,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;
    expect(staleAck).toEqual({ status: 'ignored_stale_sequence' });
  });

  it('rejects updates from the prior lease after resume establishes a new lease', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const initialPresence = await goOnline(accessToken);
    const socket = await connectDispatchSocket(accessToken);

    const resumeResponse = await fetch(
      `${baseUrl}/api/v1/drivers/presence/resume`,
      {
        method: 'POST',
        headers: requestHeaders(accessToken),
        body: JSON.stringify({
          presenceSessionId: initialPresence.presenceSessionId,
          currentLocation: {
            latitude: 9.025,
            longitude: 38.785,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
        }),
      },
    );
    expect(resumeResponse.status).toBe(200);
    const resumedPresence =
      (await resumeResponse.json()) as PresenceCommandBody;

    const oldLeaseAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: initialPresence.presenceSessionId,
      leaseId: initialPresence.leaseId,
      sequence: 1,
      latitude: 9.026,
      longitude: 38.786,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
    })) as PresenceUpdateAck;

    expect(resumedPresence.leaseId).not.toBe(initialPresence.leaseId);
    expect(oldLeaseAck).toEqual({ status: 'rejected_expired_lease' });
  });

  it('rejects updates from the previous session after explicit takeover changes the owner', async () => {
    const fixture = await createEligibleDriver();
    const firstSession = await issueAccessToken(fixture.userId);
    const secondSession = await issueAccessToken(fixture.userId);
    const initialPresence = await goOnline(firstSession.accessToken);
    const firstSocket = await connectDispatchSocket(firstSession.accessToken);

    const takeoverResponse = await fetch(
      `${baseUrl}/api/v1/drivers/presence/online`,
      {
        method: 'POST',
        headers: requestHeaders(secondSession.accessToken),
        body: JSON.stringify({
          initialLocation: {
            latitude: 9.028,
            longitude: 38.788,
            accuracyMeters: 9,
            capturedAt: new Date().toISOString(),
          },
          takeoverConfirmed: true,
        }),
      },
    );
    expect(takeoverResponse.status).toBe(200);

    const oldOwnerAck = (await firstSocket.emitWithAck(
      'presence:location:update',
      {
        presenceSessionId: initialPresence.presenceSessionId,
        leaseId: initialPresence.leaseId,
        sequence: 1,
        latitude: 9.029,
        longitude: 38.789,
        accuracyMeters: 9,
        capturedAt: new Date().toISOString(),
      },
    )) as PresenceUpdateAck;

    expect(oldOwnerAck).toEqual({ status: 'rejected_not_owner' });
  });

  it('rejects invalid location update payloads before touching Redis state', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const presence = await goOnline(accessToken);
    const socket = await connectDispatchSocket(accessToken);

    const invalidAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 0,
      latitude: 9.03,
      longitude: 38.79,
      accuracyMeters: 9,
      capturedAt: new Date().toISOString(),
      unexpected: true,
    })) as PresenceUpdateAck;

    expect(invalidAck).toEqual({ status: 'rejected_invalid' });
    await expect(loadLease(presence.presenceSessionId)).resolves.toMatchObject({
      leaseSequence: 0,
    });
  });

  it('rejects stale capture timestamps without mutating the lease sequence', async () => {
    const fixture = await createEligibleDriver();
    const { accessToken } = await issueAccessToken(fixture.userId);
    const presence = await goOnline(accessToken);
    const socket = await connectDispatchSocket(accessToken);

    const staleAck = (await socket.emitWithAck('presence:location:update', {
      presenceSessionId: presence.presenceSessionId,
      leaseId: presence.leaseId,
      sequence: 1,
      latitude: 9.027,
      longitude: 38.787,
      accuracyMeters: 9,
      capturedAt: new Date(Date.now() - 31_000).toISOString(),
    })) as PresenceUpdateAck;

    expect(staleAck).toEqual({ status: 'rejected_stale_capture' });
    await expect(loadLease(presence.presenceSessionId)).resolves.toMatchObject({
      leaseSequence: 0,
    });
  });

  const connectDispatchSocket = async (accessToken: string) => {
    const socket = io(`${baseUrl}/dispatch`, {
      transports: ['websocket'],
      auth: { token: `Bearer ${accessToken}` },
      reconnection: false,
    });
    sockets.add(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) => reject(error));
    });
    return socket;
  };

  const goOnline = async (
    accessToken: string,
  ): Promise<PresenceCommandBody> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(
        `${baseUrl}/api/v1/drivers/presence/online`,
        {
          method: 'POST',
          headers: requestHeaders(accessToken),
          body: JSON.stringify({
            initialLocation: {
              latitude: 9.02,
              longitude: 38.78,
              accuracyMeters: 8,
              capturedAt: new Date().toISOString(),
            },
          }),
        },
      );
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      expect(response.status).toBe(200);
      const body = (await response.json()) as PresenceCommandBody;
      return body;
    }

    throw new Error('goOnline exhausted retry budget after repeated 429s');
  };

  const requestHeaders = (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'x-forwarded-for': `127.0.0.${Math.floor(Math.random() * 200) + 1}`,
  });

  const createEligibleDriver = async () => {
    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Gateway',
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
    if (!application) {
      throw new Error('test setup failed to create application');
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
      refreshToken,
      accessToken: jwt.sign({ sub: userId, sid: session.id }, jwtSecret, {
        expiresIn: 900,
      }),
    };
  };

  const loadLease = async (presenceSessionId: string): Promise<LeaseBody> => {
    const raw = await redis.get(
      `${harness.namespace}:driver_presence:lease:${presenceSessionId}`,
    );
    if (!raw) throw new Error('expected lease to exist');
    return JSON.parse(raw) as LeaseBody;
  };

  const setLeaseServerReceivedAt = async (
    presenceSessionId: string,
    serverReceivedAt: string,
  ) => {
    const raw = await redis.get(
      `${harness.namespace}:driver_presence:lease:${presenceSessionId}`,
    );
    if (!raw) throw new Error('expected lease to exist');
    const lease = JSON.parse(raw) as LeaseBody;
    await redis.set(
      `${harness.namespace}:driver_presence:lease:${presenceSessionId}`,
      JSON.stringify({ ...lease, serverReceivedAt }),
      'EX',
      30,
    );
  };

  const loadCellMembers = async (cell: string) =>
    redis.zrange(`${harness.namespace}:driver_presence:h3:10:${cell}`, 0, -1);

  const loadProfile = async (userId: string) => {
    const [profile] = await db
      .select()
      .from(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, userId));
    return profile;
  };
});
