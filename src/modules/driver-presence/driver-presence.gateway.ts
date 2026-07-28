import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../user';
import {
  DriverPresenceLiveLocationService,
  type DriverPresenceSocketIdentity,
} from './driver-presence-live-location.service';

type DispatchSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  { identity?: DriverPresenceSocketIdentity }
>;

@WebSocketGateway({
  namespace: '/dispatch',
  cors: { origin: true, credentials: true },
})
export class DriverPresenceGateway {
  private readonly logger = new Logger(DriverPresenceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly users: UserService,
    private readonly liveLocation: DriverPresenceLiveLocationService,
  ) {}

  afterInit(server: Server) {
    server.use((socket: DispatchSocket, next) => {
      void this.authenticateSocket(socket, next);
    });
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

  @SubscribeMessage('presence:location:update')
  handlePresenceLocationUpdate(
    @ConnectedSocket() socket: DispatchSocket,
    @MessageBody() payload: unknown,
  ) {
    return this.liveLocation.acknowledgeLocationUpdate(
      socket.data.identity,
      payload,
    );
  }

  private extractAccessToken(socket: DispatchSocket) {
    const authToken = socket.handshake.auth?.token as unknown;
    if (typeof authToken === 'string' && authToken.trim()) {
      const trimmed = authToken.trim();
      const [scheme, token] = trimmed.split(' ');
      if (scheme === 'Bearer' && token) {
        return token;
      }
      return trimmed;
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
