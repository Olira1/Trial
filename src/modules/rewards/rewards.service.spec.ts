import assert from 'node:assert';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig } from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { user, type User } from '../user';
import { RewardsService } from './rewards.service';

describe('RewardsService - early joiner rewards (integration)', () => {
  let service: RewardsService;
  let db: Database;
  let pool: Pool;
  const createdUsers: User[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig],
        }),
        DatabaseModule,
      ],
      providers: [RewardsService],
    }).compile();

    service = moduleRef.get(RewardsService);
    db = moduleRef.get<Database>(DRIZZLE);
    pool = moduleRef.get<Pool>(PG_POOL);
  });

  afterEach(async () => {
    for (const createdUser of createdUsers.splice(0)) {
      await db.delete(user).where(eq(user.id, createdUser.id));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  const createUser = async (
    roles: User['roles'],
    createdAt: Date,
  ): Promise<User> => {
    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Reward',
        lastName: `User ${createdUsers.length}`,
        roles,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    assert(createdUser, 'test setup: user insert returned no row');
    createdUsers.push(createdUser);
    return createdUser;
  };

  it('backfills 3.3 miles per UTC day for eligible riders', async () => {
    const rider = await createUser(
      ['rider'],
      new Date('2026-05-30T12:00:00.000Z'),
    );

    await service.grantEarlyJoinerRewardsThrough(
      new Date('2026-06-01T23:59:59.000Z'),
    );

    await expect(service.getMilesForUser(rider.id)).resolves.toBeCloseTo(9.9);
  });

  it('rewards eligible drivers and does not duplicate reruns', async () => {
    const driver = await createUser(
      ['driver'],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    await service.grantEarlyJoinerRewardsThrough(
      new Date('2026-06-02T00:00:00.000Z'),
    );
    await service.grantEarlyJoinerRewardsThrough(
      new Date('2026-06-02T00:00:00.000Z'),
    );

    await expect(service.getMilesForUser(driver.id)).resolves.toBeCloseTo(6.6);
  });

  it('uses a caller-provided transaction context', async () => {
    const rider = await createUser(
      ['rider'],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    await expect(
      db.transaction(async (tx) => {
        await service.grantEarlyJoinerRewardsThrough(
          new Date('2026-06-01T00:00:00.000Z'),
          tx,
        );
        await expect(
          service.getMilesForUser(rider.id, tx),
        ).resolves.toBeCloseTo(3.3);
        tx.rollback();
      }),
    ).rejects.toThrow();

    await expect(service.getMilesForUser(rider.id)).resolves.toBe(0);
  });

  it('rewards riders and drivers created after the original early joiner cutoff', async () => {
    const lateRider = await createUser(
      ['rider'],
      new Date('2026-06-10T00:00:00.000Z'),
    );
    const lateDriver = await createUser(
      ['driver'],
      new Date('2026-06-10T12:00:00.000Z'),
    );

    await service.grantEarlyJoinerRewardsThrough(
      new Date('2026-06-11T00:00:00.000Z'),
    );

    await expect(service.getMilesForUser(lateRider.id)).resolves.toBeCloseTo(
      6.6,
    );
    await expect(service.getMilesForUser(lateDriver.id)).resolves.toBeCloseTo(
      6.6,
    );
  });

  it('ignores users without rider or driver roles', async () => {
    const admin = await createUser(
      ['admin'],
      new Date('2026-05-30T00:00:00.000Z'),
    );

    await service.grantEarlyJoinerRewardsThrough(
      new Date('2026-06-01T00:00:00.000Z'),
    );

    await expect(service.getMilesForUser(admin.id)).resolves.toBe(0);
  });

  it('does not grant rewards after the campaign end date', async () => {
    const rider = await createUser(
      ['rider'],
      new Date('2026-06-01T00:00:00.000Z'),
    );

    await service.grantEarlyJoinerRewardsThrough(
      new Date('2027-06-03T00:00:00.000Z'),
    );

    await expect(service.getMilesForUser(rider.id)).resolves.toBeCloseTo(
      1207.8,
    );
  });
});
