import {
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import assert from 'node:assert';
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
import { authSession } from './schema/session.schema';

const TEST_EMAIL = 'admin+test@ubel.test';
const TEST_PASSWORD = 'adminpass123';

describe('AuthService – admin login (integration)', () => {
  let service: AuthService;
  let db: Database;
  let closeTestContext: () => Promise<void>;
  let adminUser: User;

  beforeAll(async () => {
    ({ service, db, close: closeTestContext } = await createAuthTestContext());

    await deleteUserForIdentity(db, TEST_EMAIL);

    const passwordHash = await hashPassword(TEST_PASSWORD);

    const [u] = await db
      .insert(user)
      .values({ firstName: 'Admin', lastName: 'User', roles: ['admin'] })
      .returning();
    assert(u, 'test setup: user insert returned no row');
    adminUser = u;

    await db.insert(authIdentity).values({
      userId: adminUser.id,
      type: 'email',
      identifier: TEST_EMAIL,
      passwordHash,
      verifiedAt: new Date(),
    });
  });

  beforeEach(async () => {
    await db
      .delete(otpChallenge)
      .where(eq(otpChallenge.destination, TEST_EMAIL));
    await db.delete(authSession).where(eq(authSession.userId, adminUser.id));
    await db
      .update(user)
      .set({ isActive: true, deletedAt: null })
      .where(eq(user.id, adminUser.id));
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, adminUser.id));
    await closeTestContext();
  });

  // ─── adminLoginStart ──────────────────────────────────────────────────────────

  describe('adminLoginStart', () => {
    it('returns challengeId + expiresIn for valid admin credentials', async () => {
      const result = await service.adminLoginStart({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });

      expect(result.challengeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('throws 401 when the email is not registered', async () => {
      await expect(
        service.adminLoginStart({
          email: 'notfound@ubel.test',
          password: TEST_PASSWORD,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when the password is wrong', async () => {
      await expect(
        service.adminLoginStart({
          email: TEST_EMAIL,
          password: 'wrongpassword',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 401 when the admin has been soft deleted', async () => {
      await db
        .update(user)
        .set({ deletedAt: new Date() })
        .where(eq(user.id, adminUser.id));

      try {
        await expect(
          service.adminLoginStart({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
          }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      } finally {
        await db
          .update(user)
          .set({ deletedAt: null })
          .where(eq(user.id, adminUser.id));
      }
    });

    it('throws 401 when the user does not have admin role', async () => {
      const NON_ADMIN_EMAIL = 'nonadmin+test@ubel.test';
      const passwordHash = await hashPassword(TEST_PASSWORD);

      const [u] = await db
        .insert(user)
        .values({ firstName: 'Non', lastName: 'Admin', roles: ['rider'] })
        .returning();
      assert(u, 'test setup: user insert returned no row');
      await db.insert(authIdentity).values({
        userId: u.id,
        type: 'email',
        identifier: NON_ADMIN_EMAIL,
        passwordHash,
        verifiedAt: new Date(),
      });

      try {
        await expect(
          service.adminLoginStart({
            email: NON_ADMIN_EMAIL,
            password: TEST_PASSWORD,
          }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      } finally {
        await db.delete(user).where(eq(user.id, u.id));
      }
    });

    it('throws 429 with retryAfter when an active challenge exists', async () => {
      await service.adminLoginStart({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });

      const error = await service
        .adminLoginStart({ email: TEST_EMAIL, password: TEST_PASSWORD })
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

  // ─── adminLoginVerify ─────────────────────────────────────────────────────────

  describe('adminLoginVerify', () => {
    let challengeId: string;

    beforeEach(async () => {
      const result = await service.adminLoginStart({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      challengeId = result.challengeId;
    });

    it('returns a full token set for a correct OTP', async () => {
      const result = await service.adminLoginVerify({
        challengeId,
        code: '000000',
      });

      expect(result.sessionToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.sessionExpiresIn).toBeGreaterThan(0);
    });

    it('throws 404 when the challenge does not exist', async () => {
      await expect(
        service.adminLoginVerify({
          challengeId: '00000000-0000-0000-0000-000000000000',
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 410 when the challenge has already been consumed', async () => {
      await service.adminLoginVerify({ challengeId, code: '000000' });

      await expect(
        service.adminLoginVerify({ challengeId, code: '000000' }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws 401 for a wrong OTP code', async () => {
      await expect(
        service.adminLoginVerify({ challengeId, code: '999999' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('cannot use an issued challenge after the admin is soft deleted', async () => {
      await db
        .update(user)
        .set({ deletedAt: new Date() })
        .where(eq(user.id, adminUser.id));

      try {
        await expect(
          service.adminLoginVerify({ challengeId, code: '000000' }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      } finally {
        await db
          .update(user)
          .set({ deletedAt: null })
          .where(eq(user.id, adminUser.id));
      }
    });

    it('cannot use an issued challenge after the admin account is deactivated', async () => {
      await db
        .update(user)
        .set({ isActive: false })
        .where(eq(user.id, adminUser.id));

      await expect(
        service.adminLoginVerify({ challengeId, code: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('creates a replacement admin OTP after resend', async () => {
      await db
        .update(otpChallenge)
        .set({ createdAt: new Date(Date.now() - 86_400_000) })
        .where(eq(otpChallenge.id, challengeId));

      const resent = await service.resendOtp({ challengeId });

      const verified = await service.adminLoginVerify({
        challengeId: resent.challengeId,
        code: '000000',
      });
      expect(verified.sessionToken).toEqual(expect.any(String));
    });
  });

  describe('adminLogout', () => {
    it('revokes only the cookie-backed admin session', async () => {
      const firstChallenge = await service.adminLoginStart({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      const first = await service.adminLoginVerify({
        challengeId: firstChallenge.challengeId,
        code: '000000',
      });
      const secondChallenge = await service.adminLoginStart({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      const second = await service.adminLoginVerify({
        challengeId: secondChallenge.challengeId,
        code: '000000',
      });

      await expect(service.adminLogout(first.sessionToken)).resolves.toEqual({
        message: 'logged out',
      });

      const firstHash = createHash('sha256')
        .update(first.sessionToken)
        .digest('hex');
      const secondHash = createHash('sha256')
        .update(second.sessionToken)
        .digest('hex');
      const sessions = await db.select().from(authSession);
      const firstRow = sessions.find(
        (session) => session.tokenHash === firstHash,
      );
      const secondRow = sessions.find(
        (session) => session.tokenHash === secondHash,
      );

      expect(firstRow?.revokedAt).not.toBeNull();
      expect(firstRow?.deviceId).toBeNull();
      expect(secondRow?.revokedAt).toBeNull();
      expect(secondRow?.deviceId).toBeNull();
    });
  });
});
