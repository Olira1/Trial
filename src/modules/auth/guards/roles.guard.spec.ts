import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

const makeCtx = (
  roles: string[] | null,
  handler: object = {},
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user: roles ? { roles } : null }),
    }),
    getHandler: () => handler,
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no roles are required on the handler', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeCtx(['rider']))).toBe(true);
  });

  it('allows access when user has the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(guard.canActivate(makeCtx(['admin']))).toBe(true);
  });

  it('throws ForbiddenException when user lacks the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(makeCtx(['driver']))).toThrow(
      ForbiddenException,
    );
  });

  it('throws UnauthorizedException when request has no user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(makeCtx(null))).toThrow(
      UnauthorizedException,
    );
  });
});
