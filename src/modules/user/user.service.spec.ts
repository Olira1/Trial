import assert from 'node:assert';
import { NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../database/schema';
import { hashAuthIdentityIdentifier } from '../auth/auth-identity-history';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authIdentityHistory } from '../auth/schema/auth-identity-history.schema';
import { authSession } from '../auth/schema/session.schema';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverOperationalProfile } from '../driver-presence/schema';
import { pushDeviceToken } from '../notifications/schema/push-device-token.schema';
import type { StorageService } from '../storage';
import { user } from './schema/user.schema';
import { UserService } from './user.service';

describe('UserService (integration)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let service: UserService;
  const storage = {
    getDownloadUrl: (key: string) => Promise.resolve(key),
  } as StorageService;
  const outboxCleanupUserIds = new Set<string>();

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema, casing: 'snake_case' });
    service = new UserService(db, storage);
  });

  const testPhones = [
    '+251911000001',
    '+251911000002',
    '+251911000003',
    '+251911000004',
    '+251911000005',
    '+251911000006',
  ];

  beforeEach(async () => {
    await db
      .delete(authIdentity)
      .where(inArray(authIdentity.identifier, testPhones));
    await db
      .delete(user)
      .where(
        inArray(user.firstName, [
          'Abel',
          'Sara',
          'Deleted',
          'DualRole',
          'SequentialDriver',
          'IntentRider',
          'IntentDriver',
          'ApprovedDriver',
        ]),
      );
  });

  afterEach(async () => {
    for (const userId of outboxCleanupUserIds) {
      await db
        .delete(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, userId));
    }
    outboxCleanupUserIds.clear();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('findByPhone', () => {
    it('returns the phone identity when one exists', async () => {
      const created = await service.createProfile({
        firstName: 'Abel',
        lastName: 'Bekele',
        gender: 'male',
        role: 'rider',
      });
      await db.insert(authIdentity).values({
        userId: created.id,
        type: 'phone',
        identifier: '+251911000001',
        verifiedAt: new Date(),
      });

      const found = await service.findByPhone('+251911000001');
      expect(found).toMatchObject({
        userId: created.id,
        type: 'phone',
        identifier: '+251911000001',
      });
    });

    it('returns undefined when no user matches', async () => {
      const found = await service.findByPhone('+251911999999');
      expect(found).toBeUndefined();
    });
  });

  describe('transactions', () => {
    it('uses the provided transaction for profile writes', async () => {
      const created = await db.transaction((tx) =>
        service.createProfile(
          {
            firstName: 'Sara',
            lastName: 'Ali',
            gender: 'female',
            role: 'driver',
          },
          tx,
        ),
      );

      const [row] = await db
        .select()
        .from(user)
        .where(eq(user.id, created.id))
        .limit(1);

      expect(row).toMatchObject({
        id: created.id,
        firstName: 'Sara',
        lastName: 'Ali',
        gender: 'female',
        roles: ['driver'],
      });
    });

    it('lists drivers without overlapping transaction queries', async () => {
      const created = await service.createProfile({
        firstName: 'SequentialDriver',
        lastName: 'Test',
        role: 'driver',
      });

      const result = await service.listDriversForAdmin({
        status: 'all',
        limit: 100,
        offset: 0,
      });

      expect(result.items).toContainEqual(
        expect.objectContaining({
          id: created.id,
          fullName: 'SequentialDriver Test',
        }),
      );
    });

    it('uses signup intent to separate admin driver and rider management lists', async () => {
      const [riderOnly] = await db
        .insert(user)
        .values({
          firstName: 'IntentRider',
          lastName: 'Test',
          roles: ['rider'],
          signupIntent: 'rider',
        })
        .returning();
      const [driverApplicant] = await db
        .insert(user)
        .values({
          firstName: 'IntentDriver',
          lastName: 'Test',
          roles: ['rider'],
          signupIntent: 'driver',
        })
        .returning();
      const [approvedDriver] = await db
        .insert(user)
        .values({
          firstName: 'ApprovedDriver',
          lastName: 'Test',
          roles: ['rider', 'driver'],
          signupIntent: 'driver',
        })
        .returning();
      assert(riderOnly, 'test setup: rider insert returned no row');
      assert(
        driverApplicant,
        'test setup: driver applicant insert returned no row',
      );
      assert(
        approvedDriver,
        'test setup: approved driver insert returned no row',
      );

      const [drivers, riders] = await Promise.all([
        service.listDriversForAdmin({
          status: 'all',
          limit: 100,
          offset: 0,
        }),
        service.listRidersForAdmin({
          status: 'all',
          limit: 100,
          offset: 0,
        }),
      ]);

      expect(drivers.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: driverApplicant.id }),
          expect.objectContaining({ id: approvedDriver.id }),
        ]),
      );
      expect(drivers.items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: riderOnly.id })]),
      );
      expect(riders.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: riderOnly.id })]),
      );
      expect(riders.items).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: driverApplicant.id }),
          expect.objectContaining({ id: approvedDriver.id }),
        ]),
      );
    });
  });

  describe('updateProfile', () => {
    it('preserves dual rider and driver capability when a legacy role update is provided', async () => {
      const [created] = await db
        .insert(user)
        .values({
          firstName: 'DualRole',
          lastName: 'User',
          roles: ['rider', 'driver'],
        })
        .returning();
      assert(created, 'test setup: user insert returned no row');

      const updated = await service.updateProfile(created.id, {
        firstName: 'DualRole',
        role: 'rider',
      });

      expect(updated.roles).toEqual(['rider', 'driver']);
    });
  });

  describe('deleteUser', () => {
    it('soft deletes the user and disables their access in one transaction', async () => {
      const created = await service.createProfile({
        firstName: 'Deleted',
        lastName: 'User',
        role: 'driver',
      });
      outboxCleanupUserIds.add(created.id);
      const [session] = await db
        .insert(authSession)
        .values({
          userId: created.id,
          tokenHash: `delete-user-session-${created.id}`,
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning({ id: authSession.id });
      assert(session, 'test setup: session insert returned no row');
      await db.insert(driverOperationalProfile).values({
        userId: created.id,
        operationalState: 'online',
        ownerSessionId: session.id,
        presenceSessionId: `presence-${created.id}`,
        presenceGeneration: 1,
      });
      await db.insert(pushDeviceToken).values({
        userId: created.id,
        deviceId: `delete-user-device-${created.id}`,
        platform: 'android',
        token: `delete-user-token-${created.id}`,
      });
      const [identity] = await db
        .insert(authIdentity)
        .values({
          userId: created.id,
          type: 'phone',
          identifier: '+251911000006',
          verifiedAt: new Date(),
        })
        .returning();
      assert(identity, 'test setup: identity insert returned no row');

      await expect(service.deleteUser(created.id)).resolves.toEqual({
        message: 'user deleted',
      });

      const [deletedUser] = await db
        .select()
        .from(user)
        .where(eq(user.id, created.id));
      const [revokedSession] = await db
        .select()
        .from(authSession)
        .where(eq(authSession.userId, created.id));
      const [presenceProfile] = await db
        .select()
        .from(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, created.id));
      const [presenceEvent] = await db
        .select()
        .from(dispatchOutboxEvent)
        .where(eq(dispatchOutboxEvent.aggregateId, created.id));
      const [deviceToken] = await db
        .select()
        .from(pushDeviceToken)
        .where(eq(pushDeviceToken.userId, created.id));
      const identities = await db
        .select()
        .from(authIdentity)
        .where(eq(authIdentity.userId, created.id));
      const history = await db
        .select()
        .from(authIdentityHistory)
        .where(eq(authIdentityHistory.userId, created.id));

      expect(deletedUser).toMatchObject({
        isActive: false,
        deletedAt: expect.any(Date) as Date,
      });
      expect(revokedSession?.revokedAt).toEqual(expect.any(Date));
      expect(presenceProfile).toMatchObject({
        operationalState: 'offline',
        ownerSessionId: null,
        presenceSessionId: null,
        presenceGeneration: 2,
      });
      expect(presenceEvent).toMatchObject({
        eventType: 'driver_presence.offline.v1',
        aggregateType: 'driver_presence',
        aggregateId: created.id,
        actorUserId: created.id,
      });
      expect(deviceToken?.isActive).toBe(false);
      expect(identities).toEqual([]);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        userId: created.id,
        identityId: identity.id,
        type: 'phone',
        identifierHash: hashAuthIdentityIdentifier('phone', '+251911000006'),
        verifiedAt: expect.any(Date) as Date,
        deletedAt: expect.any(Date) as Date,
      });
      expect(history[0]?.identifierMasked).not.toBe('+251911000006');
      await expect(service.findById(created.id)).resolves.toBeUndefined();
      await expect(service.deleteUser(created.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects deleting a missing or already-deleted user', async () => {
      await expect(
        service.deleteUser('00000000-0000-0000-0000-000000000000'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
