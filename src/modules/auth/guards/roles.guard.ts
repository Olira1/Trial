import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from 'src/database/schema';
import { ROLES_KEY, userSatisfiesRole } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw new UnauthorizedException();

    if (!required.some((r) => userSatisfiesRole(req.user.roles, r))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
