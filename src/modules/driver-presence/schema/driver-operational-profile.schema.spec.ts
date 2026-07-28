import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig } from '../../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../../database/database.module';
import { authSession } from '../../auth/schema/session.schema';
import { user } from '../../user';
import { driverOperationalProfile } from './driver-operational-profile.schema';

describe('driverOperationalProfile schema (integration)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  const userIds = new Set<string>();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
        DatabaseModule,
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
  });

  afterEach(async () => {
    for (const userId of userIds) {
      await db
        .delete(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, userId))
        .catch(() => undefined);
      await db
        .delete(authSession)
        .where(eq(authSession.userId, userId))
        .catch(() => undefined);
      await db
        .delete(user)
        .where(eq(user.id, userId))
        .catch(() => undefined);
    }
    userIds.clear();
  });

  afterAll(async () => {
    await moduleRef?.get<Pool>(PG_POOL).end();
  });

  const createDriver = async () => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: 'Presence',
        lastName: 'Driver',
        roles: ['driver'],
      })
      .returning();

    if (!created) throw new Error('test setup failed to create user');
    userIds.add(created.id);
    return created;
  };

  const createMobileSession = async (userId: string) => {
    const [session] = await db
      .insert(authSession)
      .values({
        userId,
        tokenHash: `presence-test:${randomUUID()}`,
        deviceId: `device:${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    if (!session) throw new Error('test setup failed to create auth session');
    return session;
  };

  it('creates an offline profile without live coordinates or derived availability', async () => {
    const driver = await createDriver();

    const [profile] = await db
      .insert(driverOperationalProfile)
      .values({ userId: driver.id })
      .returning();

    expect(profile).toMatchObject({
      userId: driver.id,
      operationalState: 'offline',
      ownerSessionId: null,
      presenceSessionId: null,
      presenceGeneration: 0,
    });
    expect(Object.keys(driverOperationalProfile)).not.toEqual(
      expect.arrayContaining([
        'latitude',
        'longitude',
        'location',
        'isAvailable',
        'available',
      ]),
    );
  });

  it('persists online presence authority only with an owning mobile session and generation', async () => {
    const driver = await createDriver();
    const session = await createMobileSession(driver.id);
    const presenceSessionId = `ps_${randomUUID()}`;

    const [profile] = await db
      .insert(driverOperationalProfile)
      .values({
        userId: driver.id,
        operationalState: 'online',
        ownerSessionId: session.id,
        presenceSessionId,
        presenceGeneration: 1,
      })
      .returning();

    expect(profile).toMatchObject({
      operationalState: 'online',
      ownerSessionId: session.id,
      presenceSessionId,
      presenceGeneration: 1,
    });
  });

  it('rejects active states without complete presence authority', async () => {
    const driver = await createDriver();

    await expect(
      db.insert(driverOperationalProfile).values({
        userId: driver.id,
        operationalState: 'online',
      }),
    ).rejects.toThrow();
  });

  it('rejects inactive states that still carry presence authority', async () => {
    const driver = await createDriver();
    const session = await createMobileSession(driver.id);

    await expect(
      db.insert(driverOperationalProfile).values({
        userId: driver.id,
        operationalState: 'offline',
        ownerSessionId: session.id,
        presenceSessionId: `ps_${randomUUID()}`,
        presenceGeneration: 1,
      }),
    ).rejects.toThrow();
  });

  it('rejects negative presence generations', async () => {
    const driver = await createDriver();

    await expect(
      db.insert(driverOperationalProfile).values({
        userId: driver.id,
        presenceGeneration: -1,
      }),
    ).rejects.toThrow();
  });
});
