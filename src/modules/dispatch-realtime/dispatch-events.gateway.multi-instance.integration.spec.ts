import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { Server, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
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
import { RedisModule } from '../redis';
import {
  createDispatchIntegrationTestHarness,
  type DispatchIntegrationTestHarness,
} from '../../../test/dispatch-integration-harness';
import { authSession } from '../auth/schema/session.schema';
import { user } from '../user';
import type { UserRole } from '../user/schema/user.schema';
import { DispatchEventsGateway } from './dispatch-events.gateway';
import { DISPATCH_EVENTS, DISPATCH_ROOMS } from './dispatch-events';
import { DispatchRealtimeModule } from './dispatch-realtime.module';

describe('DispatchEventsGateway (multi-instance integration)', () => {
  type GatewayAck = (response: unknown) => void;

  let harness: DispatchIntegrationTestHarness;
  let moduleRefA: TestingModule;
  let moduleRefB: TestingModule;
  let db: Database;
  let gatewayA: DispatchEventsGateway;
  let gatewayB: DispatchEventsGateway;
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  let httpServerA: HttpServer;
  let httpServerB: HttpServer;
  let ioServerA: Server;
  let ioServerB: Server;
  let socketUrlB: string;
  let jwtSecret: string;

  beforeAll(async () => {
    harness = createDispatchIntegrationTestHarness();
    await harness.verifyDependencies();

    validateEnv({
      ...process.env,
      DISPATCH_QUEUE_PREFIX: harness.namespace,
    });

    const buildModule = () =>
      Test.createTestingModule({
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

    moduleRefA = await buildModule();
    moduleRefB = await buildModule();

    db = moduleRefA.get(DRIZZLE);
    gatewayA = moduleRefA.get(DispatchEventsGateway);
    gatewayB = moduleRefB.get(DispatchEventsGateway);
    jwtSecret = process.env.JWT_SECRET ?? 'test-secret';

    const attachNamespace = (
      gateway: DispatchEventsGateway,
      httpServer: HttpServer,
    ) => {
      const ioServer = new Server(httpServer, {
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
              await gateway.handleSnapshotRequest(
                socket as never,
                payload ?? {},
              ),
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

      return ioServer;
    };

    httpServerA = createServer();
    httpServerB = createServer();

    await new Promise<void>((resolve) => {
      httpServerA.listen(0, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve) => {
      httpServerB.listen(0, '127.0.0.1', () => resolve());
    });

    const addressB = httpServerB.address();
    const portB =
      typeof addressB === 'object' && addressB !== null ? addressB.port : 0;
    socketUrlB = `http://127.0.0.1:${portB}/dispatch`;

    ioServerA = attachNamespace(gatewayA, httpServerA);
    ioServerB = attachNamespace(gatewayB, httpServerB);
  });

  afterEach(async () => {
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
    await harness.cleanupRedisNamespace();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      void ioServerA?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      void ioServerB?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      httpServerA?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      httpServerB?.close(() => resolve());
    });
    await moduleRefA?.close();
    await moduleRefB?.close();
    await harness?.close();
  });

  const createUser = async (roles: UserRole[] = ['rider']) => {
    const [created] = await db
      .insert(user)
      .values({ firstName: 'Multi', lastName: 'Instance', roles })
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

    if (!session) {
      throw new Error('test setup failed to create auth session');
    }
    sessionIds.add(session.id);

    return jwt.sign({ sub: userId, sid: session.id }, jwtSecret, {
      expiresIn: 900,
    });
  };

  const connectSocket = async (
    socketUrl: string,
    token: string,
  ): Promise<ClientSocket> => {
    const socket = io(socketUrl, {
      auth: { token: `Bearer ${token}` },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
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

  it('delivers a user-room event across API instances', async () => {
    const rider = await createUser();
    const token = await issueAccessToken(rider.id);
    const socket = await connectSocket(socketUrlB, token);

    const received = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('cross-instance user-room event not delivered')),
        1_500,
      );
      socket.once(DISPATCH_EVENTS.REQUEST_SNAPSHOT, (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    gatewayA.server
      .to(DISPATCH_ROOMS.user(rider.id))
      .emit(DISPATCH_EVENTS.REQUEST_SNAPSHOT, {
        schemaVersion: 'v1',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: rider.id,
        snapshot: {
          version: 'v1',
          userId: rider.id,
          activeRequest: null,
          activeOffer: null,
          activeAssignment: null,
          generatedAt: new Date().toISOString(),
        },
      });

    await expect(received).resolves.toMatchObject({
      userId: rider.id,
      schemaVersion: 'v1',
    });
    socket.disconnect();
  });

  it('delivers a request-room event across API instances after joining on another instance', async () => {
    const rider = await createUser();
    const requestId = await createRideRequest(rider.id);
    const token = await issueAccessToken(rider.id);
    const socket = await connectSocket(socketUrlB, token);

    await expect(
      socket.emitWithAck('dispatch:request:join', { requestId }),
    ).resolves.toEqual({
      success: true,
      room: DISPATCH_ROOMS.request(requestId),
    });

    const received = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(new Error('cross-instance request-room event not delivered')),
        1_500,
      );
      socket.once(DISPATCH_EVENTS.REQUEST_SNAPSHOT, (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    gatewayA.server
      .to(DISPATCH_ROOMS.request(requestId))
      .emit(DISPATCH_EVENTS.REQUEST_SNAPSHOT, {
        schemaVersion: 'v1',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: rider.id,
        snapshot: {
          version: 'v1',
          userId: rider.id,
          activeRequest: {
            requestId,
            state: 'searching',
            pickupLatitude: 9.0192,
            pickupLongitude: 38.7525,
            destinationLatitude: 9.0301,
            destinationLongitude: 38.7612,
            matchingDeadlineAt: new Date(Date.now() + 90_000).toISOString(),
            createdAt: new Date().toISOString(),
          },
          activeOffer: null,
          activeAssignment: null,
          generatedAt: new Date().toISOString(),
        },
      });

    await expect(received).resolves.toMatchObject({
      userId: rider.id,
      snapshot: {
        activeRequest: {
          requestId,
          state: 'searching',
        },
      },
    });
    socket.disconnect();
  });
});
