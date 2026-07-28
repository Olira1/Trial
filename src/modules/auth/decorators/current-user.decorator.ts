import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../../user';
import type { AuthenticatedRequest } from '../types';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
