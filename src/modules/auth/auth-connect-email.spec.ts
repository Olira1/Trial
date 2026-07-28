import assert from 'node:assert';
import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { user, type User } from '../user';
import { AuthService } from './auth.service';
import {
  createAuthTestContext,
  deleteUserForIdentity,
} from '../../../test/auth-test.utils';
import { hashAuthIdentityIdentifier } from './auth-identity-history';
import { authIdentity } from './schema/auth-identity.schema';
import { authIdentityHistory } from './schema/auth-identity-history.schema';
import { otpChallenge } from './schema/otp-challenge.schema';

const TEST_EMAIL = 'connect+test@ubel.test';
const OTHER_EMAIL = 'other+connect@ubel.test';

describe('AuthService – connect email (integration)', () => {
  let service: AuthService;
  let db: Database;
  let closeTestContext: () => Promise<void>;
  let testUser: User;
  let otherUser: User;

  beforeAll(async () => {
    ({ service, db, close: closeTestContext } = await createAuthTestContext());

    for (const email of [TEST_EMAIL, OTHER_EMAIL]) {
      await deleteUserForIdentity(db, email);
    }

    const [u1] = await db
      .insert(user)
      .values({ firstName: 'Connect', lastName: 'User', roles: ['rider'] })
      .returning();
    const [u2] = await db
      .insert(user)
      .values({ firstName: 'Other', lastName: 'User', roles: ['rider'] })
      .returning();
    assert(u1, 'test setup: user insert returned no row');
    assert(u2, 'test setup: user insert returned no row');
    testUser = u1;
    otherUser = u2;
  });

  beforeEach(async () => {
    await db
      .delete(authIdentity)
      .where(
        and(
          eq(authIdentity.type, 'email'),
          eq(authIdentity.userId, testUser.id),
        ),
      );
    await db
      .delete(authIdentity)
      .where(
        and(
          eq(authIdentity.type, 'email'),
          eq(authIdentity.userId, otherUser.id),
        ),
      );
    await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, testUser.id));
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, testUser.id));
    await db.delete(user).where(eq(user.id, otherUser.id));
    await closeTestContext();
  });

  // ─── connectEmailStart ──────────────────────────────────────────────────────

  describe('connectEmailStart', () => {
    it('creates an identity + challenge and returns challengeId + expiresIn', async () => {
      const result = await service.connectEmailStart(testUser.id, {
        email: TEST_EMAIL,
        password: 'password123',
      });

      expect(result.challengeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.expiresIn).toBeGreaterThan(0);

      const [identity] = await db
        .select()
        .from(authIdentity)
        .where(
          and(
            eq(authIdentity.type, 'email'),
            eq(authIdentity.userId, testUser.id),
          ),
        );
      assert(identity, 'expected identity row');
      expect(identity.verifiedAt).toBeNull();
      expect(identity.passwordHash).not.toBeNull();
    });

    it('throws 409 when the email is already verified by another user', async () => {
      await db.insert(authIdentity).values({
        userId: otherUser.id,
        type: 'email',
        identifier: TEST_EMAIL,
        verifiedAt: new Date(),
      });

      await expect(
        service.connectEmailStart(testUser.id, {
          email: TEST_EMAIL,
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reclaims a verified email from a soft-deleted user', async () => {
      const [deletedUser] = await db
        .insert(user)
        .values({
          firstName: 'DeletedEmail',
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
          type: 'email',
          identifier: TEST_EMAIL,
          verifiedAt: new Date(),
        })
        .returning();
      assert(deletedIdentity, 'test setup: identity insert returned no row');

      try {
        await service.connectEmailStart(testUser.id, {
          email: TEST_EMAIL,
          password: 'password123',
        });

        const identities = await db
          .select()
          .from(authIdentity)
          .where(eq(authIdentity.identifier, TEST_EMAIL));
        expect(identities).toHaveLength(1);
        assert(identities[0], 'expected replacement identity row');
        expect(identities[0].userId).toBe(testUser.id);

        const history = await db
          .select()
          .from(authIdentityHistory)
          .where(eq(authIdentityHistory.userId, deletedUser.id));
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
          userId: deletedUser.id,
          identityId: deletedIdentity.id,
          type: 'email',
          identifierHash: hashAuthIdentityIdentifier('email', TEST_EMAIL),
          verifiedAt: expect.any(Date) as Date,
          deletedAt: expect.any(Date) as Date,
        });
        expect(history[0]?.identifierMasked).not.toBe(TEST_EMAIL);
      } finally {
        await db.delete(user).where(eq(user.id, deletedUser.id));
      }
    });

    it('throws 409 when the current user already has a verified email', async () => {
      await db.insert(authIdentity).values({
        userId: testUser.id,
        type: 'email',
        identifier: OTHER_EMAIL,
        verifiedAt: new Date(),
      });

      await expect(
        service.connectEmailStart(testUser.id, {
          email: TEST_EMAIL,
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws 429 with retryAfter when an active OTP challenge exists', async () => {
      await service.connectEmailStart(testUser.id, {
        email: TEST_EMAIL,
        password: 'password123',
      });

      const error = await service
        .connectEmailStart(testUser.id, {
          email: TEST_EMAIL,
          password: 'password123',
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const response = httpError.getResponse() as Record<string, unknown>;
      expect(typeof response.retryAfter).toBe('number');
    });

    it('replaces an existing unverified identity when the previous challenge has expired', async () => {
      const [identity1] = await db
        .insert(authIdentity)
        .values({ userId: testUser.id, type: 'email', identifier: TEST_EMAIL })
        .returning();
      assert(identity1, 'test setup: identity insert returned no row');
      await db.insert(otpChallenge).values({
        identityId: identity1.id,
        destination: TEST_EMAIL,
        channel: 'email',
        purpose: 'connect_email',
        codeHash: 'oldhash',
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.connectEmailStart(testUser.id, {
        email: TEST_EMAIL,
        password: 'newpassword123',
      });

      expect(result.challengeId).toBeDefined();

      const identities = await db
        .select()
        .from(authIdentity)
        .where(
          and(
            eq(authIdentity.type, 'email'),
            eq(authIdentity.userId, testUser.id),
          ),
        );
      expect(identities).toHaveLength(1);
      assert(identities[0], 'expected one identity row');
      expect(identities[0].id).not.toBe(identity1.id);
    });

    it('reclaims an email from an expired unverified attempt by another user', async () => {
      const [abandonedIdentity] = await db
        .insert(authIdentity)
        .values({ userId: otherUser.id, type: 'email', identifier: TEST_EMAIL })
        .returning();
      assert(abandonedIdentity, 'test setup: identity insert returned no row');
      await db.insert(otpChallenge).values({
        identityId: abandonedIdentity.id,
        destination: TEST_EMAIL,
        channel: 'email',
        purpose: 'connect_email',
        codeHash: 'expiredhash',
        expiresAt: new Date(Date.now() - 1000),
      });

      await service.connectEmailStart(testUser.id, {
        email: TEST_EMAIL,
        password: 'password123',
      });

      const [identity] = await db
        .select()
        .from(authIdentity)
        .where(
          and(
            eq(authIdentity.type, 'email'),
            eq(authIdentity.identifier, TEST_EMAIL),
          ),
        );
      assert(identity, 'expected replacement identity row');
      expect(identity.userId).toBe(testUser.id);
      expect(identity.id).not.toBe(abandonedIdentity.id);
    });
  });

  // ─── connectEmailVerify ─────────────────────────────────────────────────────

  describe('connectEmailVerify', () => {
    let challengeId: string;

    beforeEach(async () => {
      const result = await service.connectEmailStart(testUser.id, {
        email: TEST_EMAIL,
        password: 'password123',
      });
      challengeId = result.challengeId;
    });

    it('marks the identity verified and sets emailVerified on the user', async () => {
      await service.connectEmailVerify(testUser.id, {
        challengeId,
        code: '000000',
      });

      const [identity] = await db
        .select()
        .from(authIdentity)
        .where(
          and(
            eq(authIdentity.type, 'email'),
            eq(authIdentity.userId, testUser.id),
          ),
        );
      assert(identity, 'expected identity row after verify');
      expect(identity.verifiedAt).not.toBeNull();

      const [updatedUser] = await db
        .select()
        .from(user)
        .where(eq(user.id, testUser.id));
      assert(updatedUser, 'expected user row after verify');
      expect(updatedUser.emailVerified).toBe(true);
    });

    it('throws 404 when the challenge does not exist', async () => {
      await expect(
        service.connectEmailVerify(testUser.id, {
          challengeId: '00000000-0000-0000-0000-000000000000',
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 401 when the challenge belongs to a different user', async () => {
      await expect(
        service.connectEmailVerify(otherUser.id, {
          challengeId,
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 410 when the challenge has already been consumed', async () => {
      await service.connectEmailVerify(testUser.id, {
        challengeId,
        code: '000000',
      });

      await expect(
        service.connectEmailVerify(testUser.id, {
          challengeId,
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws 410 when the challenge has expired', async () => {
      await db
        .update(otpChallenge)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(otpChallenge.id, challengeId));

      await expect(
        service.connectEmailVerify(testUser.id, {
          challengeId,
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws 429 when OTP attempts are exhausted', async () => {
      await db
        .update(otpChallenge)
        .set({ attempts: 5 })
        .where(eq(otpChallenge.id, challengeId));

      const error = await service
        .connectEmailVerify(testUser.id, { challengeId, code: '000000' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    it('throws 401 for a wrong OTP code', async () => {
      await expect(
        service.connectEmailVerify(testUser.id, {
          challengeId,
          code: '999999',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('verifies a replacement connect-email OTP after resend', async () => {
      await db
        .update(otpChallenge)
        .set({ createdAt: new Date(Date.now() - 86_400_000) })
        .where(eq(otpChallenge.id, challengeId));

      const resent = await service.resendOtp({ challengeId });

      await expect(
        service.connectEmailVerify(testUser.id, {
          challengeId,
          code: '000000',
        }),
      ).rejects.toBeInstanceOf(GoneException);
      await expect(
        service.connectEmailVerify(testUser.id, {
          challengeId: resent.challengeId,
          code: '000000',
        }),
      ).resolves.toEqual({ message: 'email connected' });
    });
  });
});
