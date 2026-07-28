import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { DRIZZLE, type Database } from '../../../database/database.module';
import { user } from '../../user/schema/user.schema';
import { userSatisfiesRole } from '../decorators/roles.decorator';
import { authSession } from '../schema/session.schema';

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();

    const token = req.cookies?.ubel_admin_session as string | undefined;
    if (!token) throw new UnauthorizedException();

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const [row] = await this.db
      .select({ session: authSession, user })
      .from(authSession)
      .innerJoin(user, eq(authSession.userId, user.id))
      .where(
        and(
          eq(authSession.tokenHash, tokenHash),
          isNull(authSession.revokedAt),
          gt(authSession.expiresAt, new Date()),
          eq(user.isActive, true),
          isNull(user.deletedAt),
        ),
      )
      .limit(1);

    if (!row) throw new UnauthorizedException();
    if (!userSatisfiesRole(row.user.roles, 'admin'))
      throw new ForbiddenException();

    req.user = row.user;
    return true;
  }
}
