import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig } from '../../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../../database/database.module';
import { user } from '../../user';
import type { UserRole } from '../../user/schema/user.schema';
import { rideRequest } from '../../ride-requests/schema/ride-request.schema';
import { dispatchAttempt } from './dispatch-attempt.schema';
import { dispatchOffer } from './dispatch-offer.schema';

describe('dispatch offer schema (integration)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();

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
    for (const offerId of userIds) {
      await db
        .delete(dispatchOffer)
        .where(sql`${dispatchOffer.driverId} = ${offerId}`)
        .catch(() => undefined);
    }
    for (const requestId of requestIds) {
      await db
        .delete(dispatchAttempt)
        .where(eq(dispatchAttempt.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(rideRequest)
        .where(eq(rideRequest.id, requestId))
        .catch(() => undefined);
    }
    for (const userId of userIds) {
      await db
        .delete(user)
        .where(eq(user.id, userId))
        .catch(() => undefined);
    }
    userIds.clear();
    requestIds.clear();
  });

  afterAll(async () => {
    await moduleRef?.get<Pool>(PG_POOL).end();
  });

  const createUser = async (roles: UserRole[] = ['rider']) => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: 'Test',
        lastName: 'User',
        roles,
      })
      .returning();

    if (!created) throw new Error('test setup failed to create user');
    userIds.add(created.id);
    return created;
  };

  const createRequest = async (riderId: string) => {
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO "ride_request" (
        "rider_id", "pickup", "destination",
        "idempotency_key", "offer_ttl_seconds",
        "matching_deadline_seconds", "matching_deadline_at"
      )
      VALUES (
        ${riderId},
        ST_SetSRID(ST_MakePoint(38.75, 9.02), 4326)::geography,
        ST_SetSRID(ST_MakePoint(38.76, 9.03), 4326)::geography,
        ${randomUUID()},
        15,
        90,
        ${new Date(Date.now() + 90_000)}
      )
      RETURNING "id"
    `);
    const request = result.rows[0];
    if (request === undefined) throw new Error('failed to create request');
    const requestId = request.id;
    requestIds.add(requestId);
    return requestId;
  };

  const createAttempt = async (requestId: string, attemptNumber = 1) => {
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO "dispatch_attempt" ("request_id", "attempt_number")
      VALUES (${requestId}, ${attemptNumber})
      RETURNING "id"
    `);
    const attempt = result.rows[0];
    if (attempt === undefined) throw new Error('failed to create attempt');
    return attempt.id;
  };

  it('creates a pending offer with defaults', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    const result = await db.execute<{
      id: string;
      state: string;
      request_id: string;
      attempt_id: string;
      driver_id: string;
    }>(sql`
      INSERT INTO "dispatch_offer" (
        "request_id", "attempt_id", "driver_id", "expires_at"
      )
      VALUES (
        ${requestId},
        ${attemptId},
        ${driver.id},
        ${new Date(Date.now() + 15_000)}
      )
      RETURNING *
    `);

    expect(result.rows[0]).toMatchObject({
      state: 'pending',
      request_id: requestId,
      attempt_id: attemptId,
      driver_id: driver.id,
    });
  });

  it('rejects a duplicate attempt number for the same request', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    await createAttempt(requestId, 1);

    await expect(createAttempt(requestId, 1)).rejects.toThrow();
  });

  it('rejects two pending offers for the same request', async () => {
    const rider = await createUser();
    const driverA = await createUser(['driver']);
    const driverB = await createUser(['driver']);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    await db.execute(sql`
      INSERT INTO "dispatch_offer" (
        "request_id", "attempt_id", "driver_id", "expires_at"
      )
      VALUES (
        ${requestId},
        ${attemptId},
        ${driverA.id},
        ${new Date(Date.now() + 15_000)}
      )
    `);

    await expect(
      db.execute(sql`
        INSERT INTO "dispatch_offer" (
          "request_id", "attempt_id", "driver_id", "expires_at"
        )
        VALUES (
          ${requestId},
          ${attemptId},
          ${driverB.id},
          ${new Date(Date.now() + 15_000)}
        )
      `),
    ).rejects.toThrow();
  });

  it('rejects two pending offers for the same driver', async () => {
    const riderA = await createUser();
    const riderB = await createUser();
    const driver = await createUser(['driver']);
    const requestA = await createRequest(riderA.id);
    const requestB = await createRequest(riderB.id);
    const attemptA = await createAttempt(requestA);
    const attemptB = await createAttempt(requestB);

    await db.execute(sql`
      INSERT INTO "dispatch_offer" (
        "request_id", "attempt_id", "driver_id", "expires_at"
      )
      VALUES (
        ${requestA},
        ${attemptA},
        ${driver.id},
        ${new Date(Date.now() + 15_000)}
      )
    `);

    await expect(
      db.execute(sql`
        INSERT INTO "dispatch_offer" (
          "request_id", "attempt_id", "driver_id", "expires_at"
        )
        VALUES (
          ${requestB},
          ${attemptB},
          ${driver.id},
          ${new Date(Date.now() + 15_000)}
        )
      `),
    ).rejects.toThrow();
  });

  it('rejects expires_at before or equal to offered_at', async () => {
    const rider = await createUser();
    const driver = await createUser(['driver']);
    const requestId = await createRequest(rider.id);
    const attemptId = await createAttempt(requestId);

    await expect(
      db.execute(sql`
        INSERT INTO "dispatch_offer" (
          "request_id", "attempt_id", "driver_id", "expires_at"
        )
        VALUES (
          ${requestId},
          ${attemptId},
          ${driver.id},
          ${new Date(Date.now() - 1)}
        )
      `),
    ).rejects.toThrow();
  });

  it('rejects an offer for a non-existent request', async () => {
    const driver = await createUser(['driver']);
    const fakeRequestId = '00000000-0000-0000-0000-000000000000';
    const fakeAttemptId = '00000000-0000-0000-0000-000000000000';

    await expect(
      db.execute(sql`
        INSERT INTO "dispatch_offer" (
          "request_id", "attempt_id", "driver_id", "expires_at"
        )
        VALUES (
          ${fakeRequestId},
          ${fakeAttemptId},
          ${driver.id},
          ${new Date(Date.now() + 15_000)}
        )
      `),
    ).rejects.toThrow();
  });
});
