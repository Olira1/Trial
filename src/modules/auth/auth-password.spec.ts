import assert from 'node:assert';
import {
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
import { authIdentity } from './schema/auth-identity.schema';
import { otpChallenge } from './schema/otp-challenge.schema';

const TEST_EMAIL = 'admin+pwtest@ubel.test';
const TEST_PASSWORD = 'OldPass123!';

describe('AuthService – password flows (integration)', () => {
  let service: AuthService;
  let db: Database;
  let closeTestContext: () => Promise<void>;
  let testUser: User;
  let testIdentityId: string;

  beforeAll(async () => {
    ({ service, db, close: closeTestContext } = await createAuthTestContext());

    await deleteUserForIdentity(db, TEST_EMAIL);

    const [u] = await db
      .insert(user)
      .values({ firstName: 'Password', lastName: 'Admin', roles: ['admin'] })
      .returning();
    assert(u, 'test setup: user insert returned no row');
    testUser = u;

    const passwordHash = await hashPassword(TEST_PASSWORD);
    const [identity] = await db
      .insert(authIdentity)
      .values({
        userId: testUser.id,
        type: 'email',
        identifier: TEST_EMAIL,
        passwordHash,
        verifiedAt: new Date(),
      })
      .returning({ id: authIdentity.id });
    assert(identity, 'test setup: identity insert returned no row');
    testIdentityId = identity.id;
  });

  beforeEach(async () => {
    await db
      .delete(otpChallenge)
      .where(eq(otpChallenge.destination, TEST_EMAIL));
    await db
      .update(authIdentity)
      .set({ passwordHash: await hashPassword(TEST_PASSWORD) })
      .where(eq(authIdentity.id, testIdentityId));
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, testUser.id));
    await closeTestContext();
  });

  // ─── passwordResetStart ───────────────────────────────────────────────────────

  describe('passwordResetStart', () => {
    it('returns challengeId + expiresIn for a registered email', async () => {
      const result = await service.passwordResetStart({ email: TEST_EMAIL });

      expect(result.challengeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('throws 404 when email is not registered', async () => {
      await expect(
        service.passwordResetStart({ email: 'nobody@ubel.test' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 429 when an active challenge already exists', async () => {
      await service.passwordResetStart({ email: TEST_EMAIL });

      const error = await service
        .passwordResetStart({ email: TEST_EMAIL })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });
  });

  // ─── passwordResetVerify ──────────────────────────────────────────────────────

  describe('passwordResetVerify', () => {
    let challengeId: string;

    beforeEach(async () => {
      const result = await service.passwordResetStart({ email: TEST_EMAIL });
      challengeId = result.challengeId;
    });

    it('updates the password so the new one works for login', async () => {
      await service.passwordResetVerify({
        challengeId,
        code: '000000',
        newPassword: 'NewPass456!',
      });

      await expect(
        service.adminLoginStart({ email: TEST_EMAIL, password: 'NewPass456!' }),
      ).resolves.toBeDefined();
    });

    it('throws 404 when the challenge does not exist', async () => {
      await expect(
        service.passwordResetVerify({
          challengeId: '00000000-0000-0000-0000-000000000000',
          code: '000000',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 410 when the challenge has expired', async () => {
      const { GoneException } = await import('@nestjs/common');
      await db
        .update(otpChallenge)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(otpChallenge.id, challengeId));

      await expect(
        service.passwordResetVerify({
          challengeId,
          code: '000000',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws 410 when the challenge has already been consumed', async () => {
      const { GoneException } = await import('@nestjs/common');
      await service.passwordResetVerify({
        challengeId,
        code: '000000',
        newPassword: 'NewPass456!',
      });

      await expect(
        service.passwordResetVerify({
          challengeId,
          code: '000000',
          newPassword: 'AnotherPass789!',
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws 401 for a wrong OTP code', async () => {
      await expect(
        service.passwordResetVerify({
          challengeId,
          code: '999999',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('resets a password with a replacement OTP after resend', async () => {
      await db
        .update(otpChallenge)
        .set({ createdAt: new Date(Date.now() - 86_400_000) })
        .where(eq(otpChallenge.id, challengeId));

      const resent = await service.resendOtp({ challengeId });

      await service.passwordResetVerify({
        challengeId: resent.challengeId,
        code: '000000',
        newPassword: 'NewPass456!',
      });
      await expect(
        service.adminLoginStart({ email: TEST_EMAIL, password: 'NewPass456!' }),
      ).resolves.toBeDefined();
    });
  });

  // ─── changePassword ───────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates the password so the new one works for login', async () => {
      await service.changePassword(testUser.id, {
        oldPassword: TEST_PASSWORD,
        newPassword: 'NewPass456!',
      });

      await expect(
        service.adminLoginStart({ email: TEST_EMAIL, password: 'NewPass456!' }),
      ).resolves.toBeDefined();
    });

    it('throws 401 for a wrong old password', async () => {
      await expect(
        service.changePassword(testUser.id, {
          oldPassword: 'WrongPass999!',
          newPassword: 'NewPass456!',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 404 when the user has no email identity', async () => {
      const [noEmailUser] = await db
        .insert(user)
        .values({ firstName: 'No Email', lastName: 'User', roles: ['rider'] })
        .returning();
      assert(noEmailUser, 'test setup: user insert returned no row');

      try {
        await expect(
          service.changePassword(noEmailUser.id, {
            oldPassword: TEST_PASSWORD,
            newPassword: 'NewPass456!',
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        await db.delete(user).where(eq(user.id, noEmailUser.id));
      }
    });
  });
});
