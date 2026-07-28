import { Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { REDIS_CLIENT, type Redis } from '../redis';
import { UserService } from '../user';
import { DISPATCH_EVENTS, DISPATCH_ROOMS } from './dispatch-events';
import { DispatchSnapshotService } from './dispatch-snapshot.service';

type DispatchSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  { identity?: { userId: string; sessionId: string; deviceId: string | null } }
>;

@WebSocketGateway({
  namespace: '/dispatch',
  cors: { origin: true, credentials: true },
})
export class DispatchEventsGateway {
  private readonly logger = new Logger(DispatchEventsGateway.name);
  private adapterConfigured = false;
  private pubClient?: Redis;
  private subClient?: Redis;

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly auth: AuthService,
    private readonly users: UserService,
    private readonly snapshot: DispatchSnapshotService,
  ) {}

  afterInit(server: Server | Namespace) {
    if (!this.adapterConfigured) {
      this.pubClient = this.redis.duplicate();
      this.subClient = this.redis.duplicate();
      const rootServer = 'server' in server ? server.server : server;
      rootServer.adapter(createAdapter(this.pubClient, this.subClient));
      this.adapterConfigured = true;
    }

    server.use((socket: DispatchSocket, next) => {
      void this.authenticateSocket(socket, next);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([
      this.pubClient?.quit().catch(() => this.pubClient?.disconnect()),
      this.subClient?.quit().catch(() => this.subClient?.disconnect()),
    ]);
  }

  handleConnection(socket: DispatchSocket) {
    const identity = socket.data.identity;
    if (!identity) {
      return;
    }

    const userRoom = DISPATCH_ROOMS.user(identity.userId);
    void socket.join(userRoom);
    this.logger.debug(
      `User ${identity.userId} connected and joined room ${userRoom}`,
    );
  }

  handleDisconnect(socket: DispatchSocket) {
    const identity = socket.data.identity;
    if (!identity) {
      return;
    }

    this.logger.debug(`User ${identity.userId} disconnected`);
  }

  @SubscribeMessage('dispatch:snapshot:request')
  async handleSnapshotRequest(
    @ConnectedSocket() socket: DispatchSocket,
    @MessageBody() payload: { requestId?: string },
  ) {
    const identity = socket.data.identity;
    if (!identity) {
      return { error: 'unauthorized' };
    }

    try {
      this.logger.debug(
        `Snapshot request received userId=${identity.userId} requestId=${payload.requestId ?? 'current'}`,
      );
      const snapshot = await this.snapshot.generateSnapshot(
        identity.userId,
        payload.requestId,
      );

      return {
        event: DISPATCH_EVENTS.REQUEST_SNAPSHOT,
        data: {
          schemaVersion: snapshot.version,
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          userId: identity.userId,
          snapshot,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Snapshot generation failed: ${message}`);
      return { error: 'snapshot_failed' };
    }
  }

  @SubscribeMessage('dispatch:request:join')
  async handleRequestJoin(
    @ConnectedSocket() socket: DispatchSocket,
    @MessageBody() payload: { requestId: string },
  ) {
    const identity = socket.data.identity;
    if (!identity) {
      return { error: 'unauthorized' };
    }

    const authorized = await this.snapshot.isRequestParticipant(
      identity.userId,
      payload.requestId,
    );

    if (!authorized) {
      this.logger.debug(
        `Unauthorized request room join userId=${identity.userId} requestId=${payload.requestId}`,
      );
      return { error: 'unauthorized' };
    }

    const requestRoom = DISPATCH_ROOMS.request(payload.requestId);
    void socket.join(requestRoom);

    this.logger.debug(
      `User ${identity.userId} joined request room ${requestRoom}`,
    );

    return { success: true, room: requestRoom };
  }

  @SubscribeMessage('dispatch:offer:join')
  async handleOfferJoin(
    @ConnectedSocket() socket: DispatchSocket,
    @MessageBody() payload: { offerId: string },
  ) {
    const identity = socket.data.identity;
    if (!identity) {
      return { error: 'unauthorized' };
    }

    const authorized = await this.snapshot.isOfferParticipant(
      identity.userId,
      payload.offerId,
    );

    if (!authorized) {
      this.logger.debug(
        `Unauthorized offer room join userId=${identity.userId} offerId=${payload.offerId}`,
      );
      return { error: 'unauthorized' };
    }

    const offerRoom = DISPATCH_ROOMS.offer(payload.offerId);
    void socket.join(offerRoom);

    this.logger.debug(`User ${identity.userId} joined offer room ${offerRoom}`);

    return { success: true, room: offerRoom };
  }

  private async authenticateSocket(
    socket: DispatchSocket,
    next: (error?: Error) => void,
  ) {
    try {
      const token = this.extractAccessToken(socket);
      const payload = this.auth.verifyAccessToken(token);
      const session = await this.auth.assertActiveMobileSession(
        payload.sub,
        payload.sid,
      );
      const user = await this.users.findById(payload.sub);
      if (!user || !user.isActive) {
        return next(new Error('rejected_unauthorized'));
      }

      socket.data.identity = {
        userId: user.id,
        sessionId: payload.sid,
        deviceId: session.deviceId,
      };
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(`dispatch socket rejected: ${message}`);
      next(new Error('rejected_unauthorized'));
    }
  }

  private extractAccessToken(socket: DispatchSocket) {
    const authToken = socket.handshake.auth?.token as unknown;
    if (typeof authToken === 'string' && authToken.trim()) {
      const [scheme, token] = authToken.split(' ');
      if (scheme === 'Bearer' && token) {
        return token;
      }

      throw new Error('missing bearer access token');
    }

    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string') {
      const [scheme, token] = header.split(' ');
      if (scheme === 'Bearer' && token) {
        return token;
      }
    }

    throw new Error('missing access token');
  }
}
