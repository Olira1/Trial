import assert from 'node:assert';
import { GoneException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { user } from '../user';
import { NotificationsService } from '../notifications';
import { AuthService } from './auth.service';
import {
  createAuthTestContext,
  deleteUserForIdentity,
} from '../../../test/auth-test.utils';
import { hashAuthIdentityIdentifier } from './auth-identity-history';
import { authIdentity } from './schema/auth-identity.schema';
import { authIdentityHistory } from './schema/auth-identity-history.schema';
import { otpChallenge } from './schema/otp-challenge.schema';
import { authSession } from './schema/session.schema';

const TEST_PHONE = '+251911000096';
const SIGNUP_VERIFY_DEVICE_ID = 'signup-verify-device';
const SIGNUP_PUSH_TOKEN = 'signup-push-token';

describe('AuthService - signup (integration)', () => {
  let service: AuthService;
  let db: Database;
  let closeTestContext: () => Promise<void>;
  let notifications: jest.Mocked<
    Pick<
      NotificationsService,
      'registerDeviceToken' | 'sendWelcomeNotification'
    >
  >;

  const clearSignupUser = async () => {
    await deleteUserForIdentity(db, TEST_PHONE);
    await db
      .delete(user)
      .where(inArray(user.firstName, ['Signup', 'DeletedSignup']));
  };

  const startSignup = (
    signupIntent: 'rider' | 'driver',
    middleName: string | null = 'Test',
  ) =>
    service.signUpStart({
      phoneNumber: TEST_PHONE,
      firstName: 'Signup',
      ...(middleName && { middleName }),
      lastName: 'User',
      gender: 'female',
      deviceId: 'signup-device',
      signupIntent,
    });

  beforeAll(async () => {
    notifications = {
      registerDeviceToken: jest
        .fn()
        .mockResolvedValue({ message: 'device token registered' }),
      sendWelcomeNotification: jest.fn().mockResolvedValue(undefined),
    };
    ({
      service,
      db,
      close: closeTestContext,
    } = await createAuthTestContext({ notifications }));
    await clearSignupUser();
  });

  beforeEach(async () => {
    notifications.registerDeviceToken.mockClear();
    notifications.sendWelcomeNotification.mockClear();
    await clearSignupUser();
  });

  afterAll(async () => {
    await clearSignupUser();
    await closeTestContext();
  });

  it('does not self-grant driver capability on a new driver-intent signup', async () => {
    const result = await startSignup('driver');
    const [identity] = await db
      .select()
      .from(authIdentity)
      .where(eq(authIdentity.identifier, TEST_PHONE));
    assert(identity, 'expected signup identity');

    const [createdUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, identity.userId));
    const [challenge] = await db
      .select()
      .from(otpChallenge)
      .where(eq(otpChallenge.id, result.signUpChallengeId));

    expect(createdUser?.roles).toEqual(['rider']);
    expect(createdUser?.signupIntent).toBe('driver');
    expect(createdUser).toMatchObject({
      firstName: 'Signup',
      middleName: 'Test',
      lastName: 'User',
    });
    expect(challenge?.purpose).toBe('sign_up');
  });

  it('updates signup intent without granting driver capability on restarted signup', async () => {
    const first = await startSignup('rider');
    await db
      .update(otpChallenge)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(otpChallenge.id, first.signUpChallengeId));

    await startSignup('driver', null);

    const [identity] = await db
      .select()
      .from(authIdentity)
      .where(eq(authIdentity.identifier, TEST_PHONE));
    assert(identity, 'expected signup identity');
    const [updatedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, identity.userId));
    expect(updatedUser?.roles).toEqual(['rider']);
    expect(updatedUser?.signupIntent).toBe('driver');
    expect(updatedUser).toMatchObject({
      firstName: 'Signup',
      middleName: null,
      lastName: 'User',
    });
  });

  it('starts signup with a phone from a soft-deleted account', async () => {
    const [deletedUser] = await db
      .insert(user)
      .values({
        firstName: 'DeletedSignup',
        lastName: 'User',
        roles: ['rider'],
        isActive: false,
        deletedAt: new Date(),
      })
      .returning();
    assert(deletedUser, 'test setup: user insert returned no row');
    const [deletedIdentity] = await db
      .insert(authIdentity)
      .values({
        userId: deletedUser.id,
        type: 'phone',
        identifier: TEST_PHONE,
        verifiedAt: new Date(),
      })
      .returning();
    assert(deletedIdentity, 'test setup: identity insert returned no row');

    const result = await startSignup('rider');

    expect(result.signUpChallengeId).toEqual(expect.any(String));

    const identities = await db
      .select()
      .from(authIdentity)
      .where(eq(authIdentity.identifier, TEST_PHONE));
    expect(identities).toHaveLength(1);
    assert(identities[0], 'expected replacement identity row');
    expect(identities[0].userId).not.toBe(deletedUser.id);

    const history = await db
      .select()
      .from(authIdentityHistory)
      .where(eq(authIdentityHistory.userId, deletedUser.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      userId: deletedUser.id,
      identityId: deletedIdentity.id,
      type: 'phone',
      identifierHash: hashAuthIdentityIdentifier('phone', TEST_PHONE),
      verifiedAt: expect.any(Date) as Date,
      deletedAt: expect.any(Date) as Date,
    });
    expect(history[0]?.identifierMasked).not.toBe(TEST_PHONE);
  });

  it('resends signup OTPs after cooldown and invalidates the old challenge', async () => {
    const first = await startSignup('rider');
    await db
      .update(otpChallenge)
      .set({ createdAt: new Date(Date.now() - 86_400_000) })
      .where(eq(otpChallenge.id, first.signUpChallengeId));

    const resent = await service.resendOtp({
      challengeId: first.signUpChallengeId,
    });

    await expect(
      service.signUpVerify({
        challengeId: first.signUpChallengeId,
        code: '000000',
        deviceId: SIGNUP_VERIFY_DEVICE_ID,
      }),
    ).rejects.toBeInstanceOf(GoneException);
    const verified = await service.signUpVerify({
      challengeId: resent.challengeId,
      code: '000000',
      deviceId: SIGNUP_VERIFY_DEVICE_ID,
    });
    const payload = service.verifyAccessToken(verified.accessToken);
    const [session] = await db
      .select()
      .from(authSession)
      .where(eq(authSession.id, payload.sid));

    expect(verified.refreshToken).toEqual(expect.any(String));
    expect(verified.signupIntent).toBe('rider');
    expect(session?.deviceId).toBe(SIGNUP_VERIFY_DEVICE_ID);
    expect(notifications.registerDeviceToken).not.toHaveBeenCalled();
  });

  it('registers push token data after signup OTP verification', async () => {
    const started = await startSignup('rider');
    const verified = await service.signUpVerify({
      challengeId: started.signUpChallengeId,
      code: '000000',
      deviceId: SIGNUP_VERIFY_DEVICE_ID,
      pushToken: SIGNUP_PUSH_TOKEN,
      platform: 'ios',
    });

    const [identity] = await db
      .select()
      .from(authIdentity)
      .where(eq(authIdentity.identifier, TEST_PHONE));
    assert(identity, 'expected signup identity');

    expect(verified.refreshToken).toEqual(expect.any(String));
    expect(verified.signupIntent).toBe('rider');
    expect(notifications.registerDeviceToken).toHaveBeenCalledWith(
      identity.userId,
      {
        deviceId: SIGNUP_VERIFY_DEVICE_ID,
        pushToken: SIGNUP_PUSH_TOKEN,
        platform: 'ios',
      },
      expect.anything(),
    );
    expect(notifications.sendWelcomeNotification).not.toHaveBeenCalled();
  });
});
