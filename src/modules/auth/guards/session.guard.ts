import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { UserService } from '../../user';
import { AuthService } from '../auth.service';
import type { AuthenticatedRequest } from '../types';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { headers: Record<string, string> }>();

    const header = req.headers.authorization;
    if (!header)
      throw new UnauthorizedException('missing Authorization header');

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('expected Bearer token');
    }

    try {
      const payload = this.auth.verifyAccessToken(token);
      const session = await this.auth.assertActiveMobileSession(
        payload.sub,
        payload.sid,
      );
      const user = await this.users.findById(payload.sub);
      if (!user || !user.isActive)
        throw new UnauthorizedException('user not found or inactive');
      req.user = user;
      req.sessionId = payload.sid;
      req.deviceId = session.deviceId;
      return true;
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw new UnauthorizedException('access token expired');
      }
      if (err instanceof JsonWebTokenError) {
        throw new UnauthorizedException('invalid access token');
      }
      throw err;
    }
  }
}
