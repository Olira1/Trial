import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import {
  authConfig,
  databaseConfig,
  dispatchConfig,
  notificationsConfig,
  redisConfig,
  storageConfig,
  validateEnv,
} from '../../config';
import {
  DRIZZLE,
  DatabaseModule,
  type Database,
} from '../../database/database.module';
import { authSession } from '../auth/schema/session.schema';
import { RedisModule } from '../redis';
import { user } from '../user';
import type { UserRole } from '../user/schema/user.schema';
import { DISPATCH_EVENTS, DISPATCH_ROOMS } from './dispatch-events';
import { DispatchEventsGateway } from './dispatch-events.gateway';
import { DispatchRealtimeModule } from './dispatch-realtime.module';
import { DispatchSnapshotService } from './dispatch-snapshot.service';

describe('DispatchEventsGateway (integration)', () => {
  type GatewayAck = (response: unknown) => void;

  let harness: DispatchIntegrationTestHarness;
  let moduleRef: TestingModule;
  let db: Database;
  let gateway: DispatchEventsGateway;
  let snapshotService: DispatchSnapshotService;
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  let httpServer: HttpServer;
  let ioServer: Server;
  let socketUrl: string;
  let jwtSecret: string;

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            authConfig,
            databaseConfig,
            dispatchConfig,
            notificationsConfig,
            redisConfig,
            storageConfig,
          ],
        }),
        DatabaseModule,
        RedisModule,
        DispatchRealtimeModule,
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    gateway = moduleRef.get(DispatchEventsGateway);
    snapshotService = moduleRef.get(DispatchSnapshotService);

    jwtSecret = process.env.JWT_SECRET ?? 'test-secret';

    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = httpServer.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    socketUrl = `http://127.0.0.1:${port}/dispatch`;

    ioServer = new Server(httpServer, {
      cors: { origin: '*', credentials: true },
    });
    const dispatchNamespace = ioServer.of('/dispatch');
    gateway.server = dispatchNamespace as unknown as Server;
    gateway.afterInit(dispatchNamespace);
    dispatchNamespace.on('connection', (socket: ServerSocket) => {
      gateway.handleConnection(socket as never);
      socket.on(
        'dispatch:snapshot:request',
        async (
          payload: { requestId?: string } | undefined,
          ack: GatewayAck,
        ) => {
          ack(
            await gateway.handleSnapshotRequest(socket as never, payload ?? {}),
          );
        },
      );
      socket.on(
        'dispatch:request:join',
        async (payload: { requestId: string }, ack: GatewayAck) => {
          ack(await gateway.handleRequestJoin(socket as never, payload));
        },
      );
      socket.on(
        'dispatch:offer:join',
        async (payload: { offerId: string }, ack: GatewayAck) => {
          ack(await gateway.handleOfferJoin(socket as never, payload));
        },
      );
      socket.on('disconnect', () => {
        gateway.handleDisconnect(socket as never);
      });
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const sessionId of sessionIds) {
      await db
        .delete(authSession)
        .where(eq(authSession.id, sessionId))
        .catch(() => undefined);
    }
    for (const userId of userIds) {
      await db
        .delete(user)
        .where(eq(user.id, userId))
        .catch(() => undefined);
    }
    userIds.clear();
    sessionIds.clear();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      void ioServer?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve());
    });
    await moduleRef?.close();
    await harness?.close();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  });

  const createUser = async (roles: UserRole[] = ['rider']) => {
    const [created] = await db
      .insert(user)
      .values({ firstName: 'Test', lastName: 'User', roles })
      .returning();
    if (!created) throw new Error('failed to create user');
    userIds.add(created.id);
    return created;
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
    sessionIds.add(session.id);

    return {
      sessionId: session.id,
      refreshToken,
      accessToken: jwt.sign({ sub: userId, sid: session.id }, jwtSecret, {
        expiresIn: 900,
      }),
    };
  };

  const connectSocket = async (token: string): Promise<ClientSocket> => {
    const socket: ClientSocket = io(socketUrl, {
      auth: { token: `Bearer ${token}` },
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error: Error) => reject(error));
    });

    return socket;
  };

  const createRideRequest = async (riderId: string) => {
    const requestId = randomUUID();
    await db.execute(sql`
      INSERT INTO "ride_request" (
        "id",
        "rider_id",
        "state",
        "pickup",
        "destination",
        "idempotency_key",
        "offer_ttl_seconds",
        "matching_deadline_seconds",
        "matching_deadline_at"
      ) VALUES (
        ${requestId},
        ${riderId},
        'searching',
        ST_SetSRID(ST_MakePoint(38.7525, 9.0192), 4326)::geography,
        ST_SetSRID(ST_MakePoint(38.7612, 9.0301), 4326)::geography,
        ${`idem-${requestId}`},
        15,
        90,
        NOW() + INTERVAL '90 seconds'
      )
    `);

    return requestId;
  };

  const createOffer = async (
    requestId: string,
    driverId: string,
    options?: { state?: 'pending' | 'accepted' | 'rejected' | 'expired' },
  ) => {
    const attemptId = randomUUID();
    const offerId = randomUUID();
    const state = options?.state ?? 'pending';

    await db.execute(sql`
      INSERT INTO "dispatch_attempt" (
        "id",
        "request_id",
        "attempt_number",
        "state"
      ) VALUES (
        ${attemptId},
        ${requestId},
        1,
        'in_progress'
      )
    `);

    await db.execute(sql`
      INSERT INTO "dispatch_offer" (
        "id",
        "request_id",
        "attempt_id",
        "driver_id",
        "state",
        "offered_at",
        "expires_at",
        "responded_at",
        "eta_seconds",
        "distance_meters"
      ) VALUES (
        ${offerId},
        ${requestId},
        ${attemptId},
        ${driverId},
        ${state},
        NOW(),
        NOW() + INTERVAL '15 seconds',
        ${
          state === 'accepted' || state === 'rejected' || state === 'expired'
            ? sql`NOW()`
            : null
        },
        240,
        1800
      )
    `);

    if (state === 'accepted') {
      await db.execute(sql`
        UPDATE "ride_request"
        SET "state" = 'assigned', "updated_at" = NOW()
        WHERE "id" = ${requestId}
      `);
      await db.execute(sql`
        INSERT INTO "dispatch_assignment" (
          "request_id",
          "offer_id",
          "rider_id",
          "driver_id",
          "assigned_at",
          "driver_full_name",
          "driver_phone",
          "driver_rating",
          "vehicle_make",
          "vehicle_model",
          "vehicle_color",
          "vehicle_plate_region",
          "vehicle_plate_code",
          "vehicle_plate_code_subtype",
          "vehicle_plate_number"
        )
        SELECT
          ${requestId},
          ${offerId},
          "rider_id",
          ${driverId},
          NOW(),
          'Test Driver',
          '+251911111111',
          5,
          'Toyota',
          'Vitz',
          'Blue',
          'aa',
          '03',
          'transport_service',
          '12345'
        FROM "ride_request"
        WHERE "id" = ${requestId}
      `);
    } else {
      await db.execute(sql`
        UPDATE "ride_request"
        SET "state" = 'offered', "updated_at" = NOW()
        WHERE "id" = ${requestId}
      `);
    }

    return offerId;
  };

  const namespaceHasSocketInRoom = async (room: string, socketId: string) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return (
      ioServer.of('/dispatch').adapter.rooms.get(room)?.has(socketId) ?? false
    );
  };

  it('authenticates a socket with a valid Bearer access token', async () => {
    const rider = await createUser();
    const { accessToken } = await issueAccessToken(rider.id);

    const socket: ClientSocket = await connectSocket(accessToken);

    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it('joins the authenticated socket to its user room on connect', async () => {
    const rider = await createUser();
    const { accessToken } = await issueAccessToken(rider.id);

    const socket = await connectSocket(accessToken);

    await expect(
      namespaceHasSocketInRoom(DISPATCH_ROOMS.user(rider.id), socket.id ?? ''),
    ).resolves.toBe(true);

    socket.disconnect();
  });

  it('rejects a socket when auth.token omits the Bearer scheme', async () => {
    const rider = await createUser();
    const { accessToken } = await issueAccessToken(rider.id);

    const socket = io(socketUrl, {
      auth: { token: accessToken },
      transports: ['websocket'],
      forceNew: true,
    });

    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('connect', () => reject(new Error('should not connect')));
        socket.once('connect_error', () => resolve());
      }),
    ).resolves.toBeUndefined();

    socket.disconnect();
  });

  it('rejects a socket with an invalid token', async () => {
    const socket = io(socketUrl, {
      auth: { token: 'invalid-access-token' },
      transports: ['websocket'],
      forceNew: true,
    });

    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('connect', () => reject(new Error('should not connect')));
        socket.once('connect_error', () => resolve());
      }),
    ).resolves.toBeUndefined();

    socket.disconnect();
  });

  it('responds to snapshot requests with current state', async () => {
    const rider = await createUser();
    const response = (await gateway.handleSnapshotRequest(
      {
        data: {
          identity: {
            userId: rider.id,
            sessionId: randomUUID(),
            deviceId: `device-${randomUUID()}`,
          },
        },
      } as never,
      {},
    )) as {
      event: string;
      data?: {
        userId: string;
        schemaVersion: string;
        eventId?: string;
        occurredAt?: string;
      };
    };

    expect(response as unknown).toMatchObject({
      event: DISPATCH_EVENTS.REQUEST_SNAPSHOT,
      data: {
        userId: rider.id,
        schemaVersion: 'v1',
        snapshot: {
          version: 'v1',
          userId: rider.id,
          activeRequest: null,
          activeOffer: null,
          activeAssignment: null,
        },
      },
    });
    expect(response.data?.eventId).toEqual(expect.any(String));
    expect(response.data?.occurredAt).toEqual(expect.any(String));
  });

  it('returns the current pending offer snapshot for a reconnecting driver', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRideRequest(rider.id);
    const offerId = await createOffer(requestId, driver.id);
    const { accessToken } = await issueAccessToken(driver.id);
    const socket = await connectSocket(accessToken);

    const response: unknown = await socket.emitWithAck(
      'dispatch:snapshot:request',
      {},
    );

    expect(response).toMatchObject({
      event: DISPATCH_EVENTS.REQUEST_SNAPSHOT,
      data: {
        userId: driver.id,
        schemaVersion: 'v1',
        snapshot: {
          userId: driver.id,
          activeRequest: null,
          activeOffer: {
            offerId,
            requestId,
            driverId: driver.id,
            state: 'pending',
          },
          activeAssignment: null,
        },
      },
    });

    socket.disconnect();
  });

  it('logs snapshot request and resolved offer details for a reconnecting driver', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRideRequest(rider.id);
    const offerId = await createOffer(requestId, driver.id);
    const { accessToken } = await issueAccessToken(driver.id);
    const gatewayDebugSpy = jest
      .spyOn(
        (gateway as unknown as { logger: { debug: (message: string) => void } })
          .logger,
        'debug',
      )
      .mockImplementation(() => undefined);
    const snapshotDebugSpy = jest
      .spyOn(
        (
          snapshotService as unknown as {
            logger: { debug: (message: string) => void };
          }
        ).logger,
        'debug',
      )
      .mockImplementation(() => undefined);
    const socket = await connectSocket(accessToken);

    await socket.emitWithAck('dispatch:snapshot:request', {});

    expect(gatewayDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Snapshot request received userId=${driver.id} requestId=current`,
      ),
    );
    expect(snapshotDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Generated dispatch snapshot userId=${driver.id} requestId=none requestState=none offerId=${offerId} offerState=pending assignmentId=none`,
      ),
    );

    socket.disconnect();
  });

  it('returns the request snapshot for a driver with an active offered request when requestId is supplied', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRideRequest(rider.id);
    await createOffer(requestId, driver.id);
    const { accessToken } = await issueAccessToken(driver.id);
    const socket = await connectSocket(accessToken);

    const response: unknown = await socket.emitWithAck(
      'dispatch:snapshot:request',
      { requestId },
    );

    expect(response).toMatchObject({
      event: DISPATCH_EVENTS.REQUEST_SNAPSHOT,
      data: {
        userId: driver.id,
        schemaVersion: 'v1',
        snapshot: {
          userId: driver.id,
          activeRequest: {
            requestId,
            state: 'offered',
          },
          activeOffer: {
            requestId,
            driverId: driver.id,
            state: 'pending',
          },
        },
      },
    });

    socket.disconnect();
  });

  it('returns the latest durable assignment snapshot after a rider misses prior events', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRideRequest(rider.id);
    const offerId = await createOffer(requestId, driver.id, {
      state: 'accepted',
    });
    const assignmentResult = await db.execute<{ id: string }>(sql`
      SELECT "id"
      FROM "dispatch_assignment"
      WHERE "offer_id" = ${offerId}
      LIMIT 1
    `);
    const assignmentId = assignmentResult.rows[0]?.id;
    if (!assignmentId)
      throw new Error('test setup failed to create assignment');
    const pickupResult = await db.execute<{ id: string }>(sql`
      INSERT INTO "dispatch_assignment_pickup" (
        "assignment_id",
        "request_id",
        "offer_id",
        "rider_id",
        "driver_id",
        "state",
        "arrived_at",
        "warning_due_at",
        "no_show_cancellable_at"
      )
      VALUES (
        ${assignmentId},
        ${requestId},
        ${offerId},
        ${rider.id},
        ${driver.id},
        'arrived',
        NOW(),
        NOW() + INTERVAL '60 seconds',
        NOW() + INTERVAL '60 seconds'
      )
      RETURNING "id"
    `);
    const pickupId = pickupResult.rows[0]?.id;
    if (!pickupId) throw new Error('test setup failed to create pickup');
    const { accessToken } = await issueAccessToken(rider.id);
    const socket = await connectSocket(accessToken);

    const first: unknown = await socket.emitWithAck(
      'dispatch:snapshot:request',
      {},
    );
    const second: unknown = await socket.emitWithAck(
      'dispatch:snapshot:request',
      {},
    );

    expect(first).toMatchObject({
      event: DISPATCH_EVENTS.REQUEST_SNAPSHOT,
      data: {
        userId: rider.id,
        schemaVersion: 'v1',
        snapshot: {
          userId: rider.id,
          activeRequest: {
            requestId,
            state: 'assigned',
          },
          activeOffer: {
            offerId,
            requestId,
            driverId: driver.id,
            state: 'accepted',
          },
          activeAssignment: {
            id: assignmentId,
            offerId,
            requestId,
            riderId: rider.id,
            driverId: driver.id,
            state: 'assigned',
            driver: {
              fullName: 'Test Driver',
              phone: '+251911111111',
              rating: 5,
            },
            vehicle: {
              make: 'Toyota',
              model: 'Vitz',
              color: 'Blue',
              plateRegion: 'aa',
              plateCode: '03',
              plateCodeSubtype: 'transport_service',
              plateNumber: '12345',
            },
            pickup: {
              id: pickupId,
              state: 'arrived',
              warningSentAt: null,
              noShowCancelledAt: null,
            },
          },
        },
      },
    });
    expect(second).toMatchObject({
      event: DISPATCH_EVENTS.REQUEST_SNAPSHOT,
      data: {
        userId: rider.id,
        schemaVersion: 'v1',
        snapshot: {
          userId: rider.id,
          activeRequest: {
            requestId,
            state: 'assigned',
          },
          activeOffer: {
            offerId,
            requestId,
            driverId: driver.id,
            state: 'accepted',
          },
          activeAssignment: {
            id: assignmentId,
            offerId,
            requestId,
            riderId: rider.id,
            driverId: driver.id,
            state: 'assigned',
            driver: {
              fullName: 'Test Driver',
              phone: '+251911111111',
              rating: 5,
            },
            vehicle: {
              make: 'Toyota',
              model: 'Vitz',
              color: 'Blue',
              plateRegion: 'aa',
              plateCode: '03',
              plateCodeSubtype: 'transport_service',
              plateNumber: '12345',
            },
            pickup: {
              id: pickupId,
              state: 'arrived',
              warningSentAt: null,
              noShowCancelledAt: null,
            },
          },
        },
      },
    });

    socket.disconnect();
  });

  it('rejects joining another rider request room and does not join the room', async () => {
    const requestOwner = await createUser();
    const otherRider = await createUser();
    const requestId = await createRideRequest(requestOwner.id);
    const { accessToken } = await issueAccessToken(otherRider.id);
    const socket = await connectSocket(accessToken);

    const response: unknown = await socket.emitWithAck(
      'dispatch:request:join',
      {
        requestId,
      },
    );

    expect(response).toEqual({ error: 'unauthorized' });
    await expect(
      namespaceHasSocketInRoom(
        DISPATCH_ROOMS.request(requestId),
        socket.id ?? '',
      ),
    ).resolves.toBe(false);

    socket.disconnect();
  });

  it('logs unauthorized request room join attempts', async () => {
    const requestOwner = await createUser();
    const otherRider = await createUser();
    const requestId = await createRideRequest(requestOwner.id);
    const { accessToken } = await issueAccessToken(otherRider.id);
    const debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const socket = await connectSocket(accessToken);

    const response: unknown = await socket.emitWithAck(
      'dispatch:request:join',
      { requestId },
    );

    expect(response).toEqual({ error: 'unauthorized' });
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Unauthorized request room join userId=${otherRider.id} requestId=${requestId}`,
      ),
    );

    socket.disconnect();
  });

  it('allows the rider participant to join their request room', async () => {
    const rider = await createUser();
    const requestId = await createRideRequest(rider.id);
    const { accessToken } = await issueAccessToken(rider.id);
    const socket = await connectSocket(accessToken);

    const response: unknown = await socket.emitWithAck(
      'dispatch:request:join',
      {
        requestId,
      },
    );

    expect(response).toEqual({
      success: true,
      room: DISPATCH_ROOMS.request(requestId),
    });
    await expect(
      namespaceHasSocketInRoom(
        DISPATCH_ROOMS.request(requestId),
        socket.id ?? '',
      ),
    ).resolves.toBe(true);

    socket.disconnect();
  });

  it('rejects a previously rejected driver from joining the rider request room', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRideRequest(rider.id);
    await createOffer(requestId, driver.id, { state: 'rejected' });
    const { accessToken } = await issueAccessToken(driver.id);
    const socket = await connectSocket(accessToken);

    const response: unknown = await socket.emitWithAck(
      'dispatch:request:join',
      {
        requestId,
      },
    );

    expect(response).toEqual({ error: 'unauthorized' });
    await expect(
      namespaceHasSocketInRoom(
        DISPATCH_ROOMS.request(requestId),
        socket.id ?? '',
      ),
    ).resolves.toBe(false);

    socket.disconnect();
  });

  it('allows the driver participant to join their offer room', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRideRequest(rider.id);
    const offerId = await createOffer(requestId, driver.id);
    const { accessToken } = await issueAccessToken(driver.id);
    const socket = await connectSocket(accessToken);

    const response: unknown = await socket.emitWithAck('dispatch:offer:join', {
      offerId,
    });

    expect(response).toEqual({
      success: true,
      room: DISPATCH_ROOMS.offer(offerId),
    });
    await expect(
      namespaceHasSocketInRoom(DISPATCH_ROOMS.offer(offerId), socket.id ?? ''),
    ).resolves.toBe(true);

    socket.disconnect();
  });

  it('removes the socket from its user room after disconnect', async () => {
    const rider = await createUser();
    const { accessToken } = await issueAccessToken(rider.id);
    const socket = await connectSocket(accessToken);
    const userRoom = DISPATCH_ROOMS.user(rider.id);
    const socketId = socket.id ?? '';

    await expect(namespaceHasSocketInRoom(userRoom, socketId)).resolves.toBe(
      true,
    );

    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(namespaceHasSocketInRoom(userRoom, socketId)).resolves.toBe(
      false,
    );
  });
});
