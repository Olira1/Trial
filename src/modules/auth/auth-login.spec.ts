import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { hashPassword } from '../../utils/password';
import { user, type User } from '../user';
import { AuthService } from './auth.service';
import {
  createAuthTestContext,
  deleteUserForIdentity,
} from '../../../test/auth-test.utils';
import { NotificationsService } from '../notifications';
import { authIdentity } from './schema/auth-identity.schema';
import { otpChallenge } from './schema/otp-challenge.schema';
import { authSession } from './schema/session.schema';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverOperationalProfile } from '../driver-presence/schema';

const TEST_PHONE = '+251911000099';
const TEST_PHONE_WITH_EMAIL = '+251911000097';
const TEST_EMAIL = 'login+emailtest@ubel.test';
const TEST_PASSWORD = 'EmailPass123!';
const OTP_DEVICE_ID = 'otp-login-device';
const PASSWORD_DEVICE_ID = 'password-login-device';
const OTP_PUSH_TOKEN = 'otp-login-push-token';
const PASSWORD_PUSH_TOKEN = 'password-login-push-token';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('AuthService – login (integration)', () => {
  let service: AuthService;
  let db: Database;
  let closeTestContext: () => Promise<void>;
  let testUser: User;
  let testUserWithEmail: User;
  let notifications: jest.Mocked<
    Pick<
      NotificationsService,
      'registerDeviceToken' | 'sendWelcomeNotification'
    >
  >;

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
    } = await createAuthTestContext({
      notifications,
    }));

    for (const phone of [TEST_PHONE, TEST_PHONE_WITH_EMAIL]) {
      await deleteUserForIdentity(db, phone);
    }
    await deleteUserForIdentity(db, TEST_EMAIL);

    const [u] = await db
      .insert(user)
      .values({
        firstName: 'Login',
        middleName: 'Test',
        lastName: 'User',
        roles: ['rider'],
        signupIntent: 'driver',
      })
      .returning();
    assert(u, 'test setup: user insert returned no row');
    testUser = u;
    await db.insert(authIdentity).values({
      userId: testUser.id,
      type: 'phone',
      identifier: TEST_PHONE,
      verifiedAt: new Date(),
    });

    const [ue] = await db
      .insert(user)
      .values({
        firstName: 'Login',
        middleName: 'Test',
        lastName: 'Email User',
        roles: ['rider'],
        signupIntent: 'driver',
      })
      .returning();
    assert(ue, 'test setup: user insert returned no row');
    testUserWithEmail = ue;
    await db.insert(authIdentity).values({
      userId: testUserWithEmail.id,
      type: 'phone',
      identifier: TEST_PHONE_WITH_EMAIL,
      verifiedAt: new Date(),
    });
    const passwordHash = await hashPassword(TEST_PASSWORD);
    await db.insert(authIdentity).values({
      userId: testUserWithEmail.id,
      type: 'email',
      identifier: TEST_EMAIL,
      passwordHash,
      verifiedAt: new Date(),
    });
  });

  beforeEach(async () => {
    notifications.registerDeviceToken.mockClear();
    notifications.sendWelcomeNotification.mockClear();
    await db
      .delete(otpChallenge)
      .where(eq(otpChallenge.destination, TEST_PHONE));
    await db
      .delete(otpChallenge)
      .where(eq(otpChallenge.destination, TEST_PHONE_WITH_EMAIL));
    await db
      .delete(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, testUser.id));
    await db
      .delete(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, testUserWithEmail.id));
    await db
      .delete(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, testUser.id));
    await db
      .delete(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, testUserWithEmail.id));
    await db.delete(authSession).where(eq(authSession.userId, testUser.id));
    await db
      .delete(authSession)
      .where(eq(authSession.userId, testUserWithEmail.id));
    await db
      .update(user)
      .set({
        deviceId: null,
        isActive: true,
        deletedAt: null,
        signupIntent: 'driver',
      })
      .where(eq(user.id, testUser.id));
    await db
      .update(user)
      .set({
        deviceId: null,
        isActive: true,
        deletedAt: null,
        signupIntent: 'driver',
      })
      .where(eq(user.id, testUserWithEmail.id));
  });

  afterEach(async () => {
    await db
      .delete(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, testUser.id));
    await db
      .delete(dispatchOutboxEvent)
      .where(eq(dispatchOutboxEvent.aggregateId, testUserWithEmail.id));
    await db
      .delete(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, testUser.id));
    await db
      .delete(driverOperationalProfile)
      .where(eq(driverOperationalProfile.userId, testUserWithEmail.id));
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, testUser.id));
    await db.delete(user).where(eq(user.id, testUserWithEmail.id));
    await closeTestContext();
  });

  // ─── loginStart ──────────────────────────────────────────────────────────────

  describe('loginStart', () => {
    it('returns { method: otp, challengeId, expiresIn } for a phone-only user', async () => {
      const result = await service.loginStart({ phoneNumber: TEST_PHONE });

      expect(result.method).toBe('otp');
      assert(result.method === 'otp');
      expect(result.challengeId).toMatch(UUID_RE);
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('returns { method: email_password } when user has a verified email+password', async () => {
      const result = await service.loginStart({
        phoneNumber: TEST_PHONE_WITH_EMAIL,
      });

      expect(result.method).toBe('email_password');
    });

    it('throws 401 when the phone number is not registered', async () => {
      await expect(
        service.loginStart({ phoneNumber: '+251900000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when the user has been soft deleted', async () => {
      await db
        .update(user)
        .set({ deletedAt: new Date() })
        .where(eq(user.id, testUser.id));

      try {
        await expect(
          service.loginStart({ phoneNumber: TEST_PHONE }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      } finally {
        await db
          .update(user)
          .set({ deletedAt: null })
          .where(eq(user.id, testUser.id));
      }
    });

    it('throws 401 when the user account is inactive', async () => {
      await db
        .update(user)
        .set({ isActive: false })
        .where(eq(user.id, testUser.id));

      await expect(
        service.loginStart({ phoneNumber: TEST_PHONE }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when the phone identity has not been verified', async () => {
      const UNVERIFIED_PHONE = '+251911000098';
      const [u] = await db
        .insert(user)
        .values({
          firstName: 'Unverified',
          lastName: 'User',
          roles: ['rider'],
        })
        .returning();
      assert(u, 'test setup: user insert returned no row');
      await db.insert(authIdentity).values({
        userId: u.id,
        type: 'phone',
        identifier: UNVERIFIED_PHONE,
      });

      try {
        await expect(
          service.loginStart({ phoneNumber: UNVERIFIED_PHONE }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      } finally {
        await db.delete(user).where(eq(user.id, u.id));
      }
    });

    it('throws 429 with retryAfter when an active OTP challenge exists', async () => {
      await service.loginStart({ phoneNumber: TEST_PHONE });

      const error = await service
        .loginStart({ phoneNumber: TEST_PHONE })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      const response = (error as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(typeof response.retryAfter).toBe('number');
    });
  });

  // ─── loginVerify (OTP) ───────────────────────────────────────────────────────

  describe('loginVerify', () => {
    let challengeId: string;

    beforeEach(async () => {
      const result = await service.loginStart({ phoneNumber: TEST_PHONE });
      assert(result.method === 'otp', 'expected otp method in test setup');
      challengeId = result.challengeId;
    });

    it('returns a full token set for a correct OTP', async () => {
      const result = await service.loginVerify({
        challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
      });
      const payload = service.verifyAccessToken(result.accessToken);
      const [updatedUser] = await db
        .select({ deviceId: user.deviceId })
        .from(user)
        .where(eq(user.id, testUser.id));

      expect(result.accessToken).toBeTruthy();
      expect(result.accessExpiresIn).toBeGreaterThan(0);
      expect(result.refreshToken).toMatch(UUID_RE);
      expect(result.refreshExpiresIn).toBeGreaterThan(0);
      expect(result.roles).toEqual(['rider']);
      expect(result.user).toMatchObject({
        id: testUser.id,
        firstName: 'Login',
        middleName: 'Test',
        lastName: 'User',
        roles: ['rider'],
        signupIntent: 'driver',
        image: null,
        phoneVerified: false,
        emailVerified: false,
      });
      expect(payload.sid).toMatch(UUID_RE);
      await expect(
        service.assertActiveMobileSession(payload.sub, payload.sid),
      ).resolves.toEqual({ deviceId: OTP_DEVICE_ID });
      expect(updatedUser?.deviceId).toBe(OTP_DEVICE_ID);
      expect(notifications.registerDeviceToken).not.toHaveBeenCalled();
      expect(notifications.sendWelcomeNotification).not.toHaveBeenCalled();
    });

    it('registers a push token and sends a best-effort welcome notification', async () => {
      const result = await service.loginVerify({
        challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
        pushToken: OTP_PUSH_TOKEN,
        platform: 'android',
      });

      expect(result.refreshToken).toMatch(UUID_RE);
      expect(notifications.registerDeviceToken).toHaveBeenCalledWith(
        testUser.id,
        {
          deviceId: OTP_DEVICE_ID,
          pushToken: OTP_PUSH_TOKEN,
          platform: 'android',
        },
        expect.anything(),
      );
      expect(notifications.sendWelcomeNotification).toHaveBeenCalledWith(
        OTP_PUSH_TOKEN,
      );
    });

    it('still logs in when welcome notification delivery fails', async () => {
      notifications.sendWelcomeNotification.mockRejectedValueOnce(
        new Error('fcm unavailable'),
      );

      const result = await service.loginVerify({
        challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
        pushToken: OTP_PUSH_TOKEN,
        platform: 'android',
      });

      expect(result.refreshToken).toMatch(UUID_RE);
    });

    it('creates a session row in the database', async () => {
      await service.loginVerify({
        challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
      });

      const [session] = await db
        .select()
        .from(authSession)
        .where(eq(authSession.userId, testUser.id));
      expect(session).toBeDefined();
      expect(
        (session as unknown as { deviceId: string | null })?.deviceId,
      ).toBe(OTP_DEVICE_ID);
    });

    it('throws 404 when the challenge does not exist', async () => {
      await expect(
        service.loginVerify({
          challengeId: '00000000-0000-0000-0000-000000000000',
          code: '000000',
          deviceId: OTP_DEVICE_ID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 410 when the challenge has expired', async () => {
      await db
        .update(otpChallenge)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(otpChallenge.id, challengeId));

      await expect(
        service.loginVerify({
          challengeId,
          code: '000000',
          deviceId: OTP_DEVICE_ID,
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws 410 when the challenge has already been consumed', async () => {
      await service.loginVerify({
        challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
      });

      await expect(
        service.loginVerify({
          challengeId,
          code: '000000',
          deviceId: OTP_DEVICE_ID,
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws 429 when OTP attempts are exhausted', async () => {
      await db
        .update(otpChallenge)
        .set({ attempts: 5 })
        .where(eq(otpChallenge.id, challengeId));

      const error = await service
        .loginVerify({
          challengeId,
          code: '000000',
          deviceId: OTP_DEVICE_ID,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    it('throws 401 for a wrong OTP code', async () => {
      await db
        .update(user)
        .set({ deviceId: 'existing-device' })
        .where(eq(user.id, testUser.id));

      await expect(
        service.loginVerify({
          challengeId,
          code: '999999',
          deviceId: 'untrusted-device',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const [unchangedUser] = await db
        .select({ deviceId: user.deviceId })
        .from(user)
        .where(eq(user.id, testUser.id));
      expect(unchangedUser?.deviceId).toBe('existing-device');
    });

    it('cannot use an issued challenge after the user is soft deleted', async () => {
      await db
        .update(user)
        .set({ deletedAt: new Date() })
        .where(eq(user.id, testUser.id));

      try {
        await expect(
          service.loginVerify({
            challengeId,
            code: '000000',
            deviceId: OTP_DEVICE_ID,
          }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      } finally {
        await db
          .update(user)
          .set({ deletedAt: null })
          .where(eq(user.id, testUser.id));
      }
    });

    it('cannot consume a login challenge through signup verification', async () => {
      await expect(
        service.signUpVerify({
          challengeId,
          code: '000000',
          deviceId: OTP_DEVICE_ID,
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });
  });

  describe('resendOtp', () => {
    let challengeId: string;

    beforeEach(async () => {
      const result = await service.loginStart({ phoneNumber: TEST_PHONE });
      assert(result.method === 'otp', 'expected otp method in test setup');
      challengeId = result.challengeId;
    });

    it('throws 429 before the resend cooldown expires', async () => {
      const error = await service
        .resendOtp({ challengeId })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    it('replaces an expired login challenge after cooldown', async () => {
      await db
        .update(otpChallenge)
        .set({
          createdAt: new Date(Date.now() - 86_400_000),
          expiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(otpChallenge.id, challengeId));

      const resent = await service.resendOtp({ challengeId });

      await expect(
        service.loginVerify({
          challengeId,
          code: '000000',
          deviceId: OTP_DEVICE_ID,
        }),
      ).rejects.toBeInstanceOf(GoneException);
      const verified = await service.loginVerify({
        challengeId: resent.challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
      });
      expect(verified.refreshToken).toMatch(UUID_RE);
    });

    it('does not resend a stale challenge over a newer active challenge', async () => {
      await db
        .update(otpChallenge)
        .set({
          createdAt: new Date(Date.now() - 86_400_000),
          expiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(otpChallenge.id, challengeId));
      const newer = await service.loginStart({ phoneNumber: TEST_PHONE });
      assert(newer.method === 'otp', 'expected replacement OTP in test setup');

      await expect(service.resendOtp({ challengeId })).rejects.toBeInstanceOf(
        HttpException,
      );
      const verified = await service.loginVerify({
        challengeId: newer.challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
      });
      expect(verified.refreshToken).toMatch(UUID_RE);
    });
  });

  // ─── loginVerifyPassword ─────────────────────────────────────────────────────

  describe('loginVerifyPassword', () => {
    it('returns a full token set for a correct password', async () => {
      const result = await service.loginVerifyPassword({
        phoneNumber: TEST_PHONE_WITH_EMAIL,
        password: TEST_PASSWORD,
        deviceId: PASSWORD_DEVICE_ID,
      });
      const [updatedUser] = await db
        .select({ deviceId: user.deviceId })
        .from(user)
        .where(eq(user.id, testUserWithEmail.id));

      expect(result.accessToken).toBeTruthy();
      expect(result.accessExpiresIn).toBeGreaterThan(0);
      expect(result.refreshToken).toMatch(UUID_RE);
      expect(result.refreshExpiresIn).toBeGreaterThan(0);
      expect(result.roles).toEqual(['rider']);
      expect(result.user).toMatchObject({
        id: testUserWithEmail.id,
        firstName: 'Login',
        middleName: 'Test',
        lastName: 'Email User',
        roles: ['rider'],
        signupIntent: 'driver',
        image: null,
        phoneVerified: false,
        emailVerified: false,
      });
      expect(updatedUser?.deviceId).toBe(PASSWORD_DEVICE_ID);
    });

    it('registers push token data on password login', async () => {
      const result = await service.loginVerifyPassword({
        phoneNumber: TEST_PHONE_WITH_EMAIL,
        password: TEST_PASSWORD,
        deviceId: PASSWORD_DEVICE_ID,
        pushToken: PASSWORD_PUSH_TOKEN,
        platform: 'ios',
      });

      expect(result.refreshToken).toMatch(UUID_RE);
      expect(notifications.registerDeviceToken).toHaveBeenCalledWith(
        testUserWithEmail.id,
        {
          deviceId: PASSWORD_DEVICE_ID,
          pushToken: PASSWORD_PUSH_TOKEN,
          platform: 'ios',
        },
        expect.anything(),
      );
      expect(notifications.sendWelcomeNotification).toHaveBeenCalledWith(
        PASSWORD_PUSH_TOKEN,
      );
    });

    it('creates a session row in the database', async () => {
      await service.loginVerifyPassword({
        phoneNumber: TEST_PHONE_WITH_EMAIL,
        password: TEST_PASSWORD,
        deviceId: PASSWORD_DEVICE_ID,
      });

      const [session] = await db
        .select()
        .from(authSession)
        .where(eq(authSession.userId, testUserWithEmail.id));
      expect(session).toBeDefined();
      expect(session?.deviceId).toBe(PASSWORD_DEVICE_ID);
    });

    it('throws 401 for a wrong password', async () => {
      await db
        .update(user)
        .set({ deviceId: 'existing-device' })
        .where(eq(user.id, testUserWithEmail.id));

      await expect(
        service.loginVerifyPassword({
          phoneNumber: TEST_PHONE_WITH_EMAIL,
          password: 'WrongPass999!',
          deviceId: 'untrusted-device',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const [unchangedUser] = await db
        .select({ deviceId: user.deviceId })
        .from(user)
        .where(eq(user.id, testUserWithEmail.id));
      expect(unchangedUser?.deviceId).toBe('existing-device');
    });

    it('throws 401 when the user has no email identity', async () => {
      await expect(
        service.loginVerifyPassword({
          phoneNumber: TEST_PHONE,
          password: TEST_PASSWORD,
          deviceId: PASSWORD_DEVICE_ID,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes only the selected mobile refresh-token session', async () => {
      const firstStart = await service.loginStart({ phoneNumber: TEST_PHONE });
      assert(firstStart.method === 'otp', 'expected OTP for first login');
      const first = await service.loginVerify({
        challengeId: firstStart.challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
      });

      const secondStart = await service.loginStart({ phoneNumber: TEST_PHONE });
      assert(secondStart.method === 'otp', 'expected OTP for second login');
      const second = await service.loginVerify({
        challengeId: secondStart.challengeId,
        code: '000000',
        deviceId: 'otp-login-device-second',
      });
      const firstPayload = service.verifyAccessToken(first.accessToken);
      const secondPayload = service.verifyAccessToken(second.accessToken);

      await expect(
        service.logout({ refreshToken: first.refreshToken }),
      ).resolves.toEqual({ message: 'logged out' });
      await expect(
        service.logout({ refreshToken: first.refreshToken }),
      ).resolves.toEqual({ message: 'logged out' });

      await expect(
        service.refresh({ refreshToken: first.refreshToken }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.assertActiveMobileSession(firstPayload.sub, firstPayload.sid),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.assertActiveMobileSession(secondPayload.sub, secondPayload.sid),
      ).resolves.toEqual({ deviceId: 'otp-login-device-second' });
      const refreshed = await service.refresh({
        refreshToken: second.refreshToken,
      });
      expect(refreshed.accessToken).toBeTruthy();
    });

    it('forces an owning online driver presence profile offline on logout', async () => {
      const loginStart = await service.loginStart({ phoneNumber: TEST_PHONE });
      assert(loginStart.method === 'otp', 'expected OTP login');
      const issued = await service.loginVerify({
        challengeId: loginStart.challengeId,
        code: '000000',
        deviceId: OTP_DEVICE_ID,
      });
      const payload = service.verifyAccessToken(issued.accessToken);
      await db.insert(driverOperationalProfile).values({
        userId: testUser.id,
        operationalState: 'online',
        ownerSessionId: payload.sid,
        presenceSessionId: randomUUID(),
        presenceGeneration: 1,
      });

      await expect(
        service.logout({ refreshToken: issued.refreshToken }),
      ).resolves.toEqual({ message: 'logged out' });

      const [profile] = await db
        .select()
        .from(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, testUser.id));
      expect(profile).toMatchObject({
        operationalState: 'offline',
        ownerSessionId: null,
        presenceSessionId: null,
        presenceGeneration: 2,
      });
      const [event] = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, testUser.id));
      expect(event).toMatchObject({
        eventType: 'driver_presence.offline.v1',
        aggregateType: 'driver_presence',
        aggregateId: testUser.id,
        actorUserId: testUser.id,
        payload: {
          userId: testUser.id,
          operationalState: 'offline',
          presenceSessionId: null,
          presenceGeneration: 2,
        },
      });
    });
  });

  describe('refresh', () => {
    it('keeps access tokens bound to the persisted mobile session', async () => {
      const issued = await service.loginVerifyPassword({
        phoneNumber: TEST_PHONE_WITH_EMAIL,
        password: TEST_PASSWORD,
        deviceId: PASSWORD_DEVICE_ID,
      });

      const refreshed = await service.refresh({
        refreshToken: issued.refreshToken,
      });
      const refreshedPayload = service.verifyAccessToken(refreshed.accessToken);

      expect(refreshedPayload.sid).toBe(
        service.verifyAccessToken(issued.accessToken).sid,
      );
      await expect(
        service.assertActiveMobileSession(
          testUserWithEmail.id,
          refreshedPayload.sid,
        ),
      ).resolves.toEqual({ deviceId: PASSWORD_DEVICE_ID });
    });

    it('rejects refresh tokens after the user account becomes inactive', async () => {
      const issued = await service.loginVerifyPassword({
        phoneNumber: TEST_PHONE_WITH_EMAIL,
        password: TEST_PASSWORD,
        deviceId: PASSWORD_DEVICE_ID,
      });

      await db
        .update(user)
        .set({ isActive: false })
        .where(eq(user.id, testUserWithEmail.id));

      await expect(
        service.refresh({ refreshToken: issued.refreshToken }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects persisted mobile sessions after the user account becomes inactive', async () => {
      const issued = await service.loginVerifyPassword({
        phoneNumber: TEST_PHONE_WITH_EMAIL,
        password: TEST_PASSWORD,
        deviceId: PASSWORD_DEVICE_ID,
      });
      const payload = service.verifyAccessToken(issued.accessToken);

      await db
        .update(user)
        .set({ isActive: false })
        .where(eq(user.id, testUserWithEmail.id));

      await expect(
        service.assertActiveMobileSession(payload.sub, payload.sid),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
