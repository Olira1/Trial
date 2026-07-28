import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../../user';
import { AuthService } from '../auth.service';
import { SessionGuard } from './session.guard';

describe('SessionGuard', () => {
  const payload = { sub: 'user-id', sid: 'session-id' };
  const makeUser = (
    isActive = true,
  ): NonNullable<Awaited<ReturnType<UserService['findById']>>> => ({
    id: payload.sub,
    firstName: 'Session',
    middleName: null,
    lastName: 'User',
    emailVerified: false,
    imageKey: null,
    phoneVerified: true,
    deviceId: null,
    roles: ['rider'],
    signupIntent: 'rider',
    gender: null,
    isActive,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  let auth: jest.Mocked<{
    verifyAccessToken: AuthService['verifyAccessToken'];
    assertActiveMobileSession: (
      userId: string,
      sessionId: string,
    ) => Promise<{ deviceId: string | null }>;
  }>;
  let users: jest.Mocked<Pick<UserService, 'findById'>>;
  let guard: SessionGuard;

  beforeEach(() => {
    auth = {
      verifyAccessToken: jest.fn().mockReturnValue(payload),
      assertActiveMobileSession: jest
        .fn()
        .mockResolvedValue({ deviceId: 'session-device' }),
    };
    users = {
      findById: jest.fn().mockResolvedValue(makeUser()),
    };
    guard = new SessionGuard(
      auth as unknown as AuthService,
      users as unknown as UserService,
    );
  });

  function requestContext() {
    const request = {
      headers: { authorization: 'Bearer access-token' },
    } as {
      headers: { authorization: string };
      sessionId?: string;
      deviceId?: string | null;
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { context, request };
  }

  it('accepts a token only after validating its persisted session', async () => {
    const { context, request } = requestContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(auth.assertActiveMobileSession).toHaveBeenCalledWith(
      payload.sub,
      payload.sid,
    );
    expect(request.sessionId).toBe(payload.sid);
    expect(request.deviceId).toBe('session-device');
  });

  it('rejects a token backed by a revoked session', async () => {
    const { context } = requestContext();
    auth.assertActiveMobileSession.mockRejectedValue(
      new UnauthorizedException('invalid or expired session'),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('rejects a valid token when the user account is inactive', async () => {
    const { context } = requestContext();
    users.findById.mockResolvedValue(makeUser(false));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
