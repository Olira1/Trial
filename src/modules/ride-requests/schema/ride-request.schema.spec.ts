import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig } from '../../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../../database/database.module';
import { user } from '../../user';
import { rideRequest } from './ride-request.schema';

describe('rideRequest schema (integration)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  const riderIds = new Set<string>();

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
    for (const riderId of riderIds) {
      await db
        .delete(rideRequest)
        .where(eq(rideRequest.riderId, riderId))
        .catch(() => undefined);
      await db
        .delete(user)
        .where(eq(user.id, riderId))
        .catch(() => undefined);
    }
    riderIds.clear();
  });

  afterAll(async () => {
    await moduleRef?.get<Pool>(PG_POOL).end();
  });

  const createRider = async () => {
    const [created] = await db
      .insert(user)
      .values({
        firstName: 'Ride',
        lastName: 'Requester',
        roles: ['rider'],
      })
      .returning();

    if (created === undefined)
      throw new Error('test setup failed to create user');
    riderIds.add(created.id);
    return created;
  };

  const insertRequest = async ({
    riderId,
    idempotencyKey = randomUUID(),
    longitude = 38.7525,
    latitude = 9.0192,
    destLongitude = 38.7612,
    destLatitude = 9.0301,
    offerTtlSeconds = 15,
    matchingDeadlineSeconds = 90,
  }: {
    riderId: string;
    idempotencyKey?: string;
    longitude?: number;
    latitude?: number;
    destLongitude?: number;
    destLatitude?: number;
    offerTtlSeconds?: number;
    matchingDeadlineSeconds?: number;
  }) => {
    const matchingDeadlineAt = new Date(
      Date.now() + matchingDeadlineSeconds * 1000,
    );
    const result = await db.execute<{
      id: string;
      state: string;
      rider_id: string;
      pickup: unknown;
      destination: unknown;
      idempotency_key: string;
      offer_ttl_seconds: number;
      matching_deadline_seconds: number;
      matching_deadline_at: string;
      created_at: string;
      updated_at: string;
    }>(sql`
      INSERT INTO "ride_request" (
        "rider_id", "pickup", "destination",
        "idempotency_key", "offer_ttl_seconds",
        "matching_deadline_seconds", "matching_deadline_at"
      )
      VALUES (
        ${riderId},
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${destLongitude}, ${destLatitude}), 4326)::geography,
        ${idempotencyKey},
        ${offerTtlSeconds},
        ${matchingDeadlineSeconds},
        ${matchingDeadlineAt}
      )
      RETURNING *
    `);
    const [firstRow] = result.rows;
    if (firstRow === undefined)
      throw new Error('expected inserted request row');
    return firstRow;
  };

  it('defaults to searching state when created', async () => {
    const rider = await createRider();
    const request = await insertRequest({ riderId: rider.id });
    expect(request.state).toBe('searching');
  });

  it('stores pickup and destination as lon/lat geography points', async () => {
    const rider = await createRider();
    const request = await insertRequest({
      riderId: rider.id,
      longitude: 38.7525,
      latitude: 9.0192,
      destLongitude: 38.7612,
      destLatitude: 9.0301,
    });

    const geoResult = await db.execute<{
      pickup_lon: number;
      pickup_lat: number;
      dest_lon: number;
      dest_lat: number;
      pickup_srid: number;
    }>(sql`
      SELECT
        ST_X("pickup"::geometry)::float8 AS pickup_lon,
        ST_Y("pickup"::geometry)::float8 AS pickup_lat,
        ST_X("destination"::geometry)::float8 AS dest_lon,
        ST_Y("destination"::geometry)::float8 AS dest_lat,
        ST_SRID("pickup"::geometry) AS pickup_srid
      FROM "ride_request"
      WHERE "id" = ${request.id}
    `);

    const [firstRow] = geoResult.rows;
    if (firstRow === undefined)
      throw new Error('expected geography query result');
    expect(firstRow).toMatchObject({
      pickup_lon: 38.7525,
      pickup_lat: 9.0192,
      dest_lon: 38.7612,
      dest_lat: 9.0301,
      pickup_srid: 4326,
    });
  });

  it('rejects duplicate idempotency key for the same rider', async () => {
    const rider = await createRider();
    const idempotencyKey = randomUUID();
    await insertRequest({ riderId: rider.id, idempotencyKey });

    await expect(
      db.execute(sql`
        INSERT INTO "ride_request" (
          "rider_id", "pickup", "destination",
          "idempotency_key", "offer_ttl_seconds",
          "matching_deadline_seconds", "matching_deadline_at"
        )
        VALUES (
          ${rider.id},
          ST_SetSRID(ST_MakePoint(38.75, 9.02), 4326)::geography,
          ST_SetSRID(ST_MakePoint(38.76, 9.03), 4326)::geography,
          ${idempotencyKey},
          15, 90, ${new Date(Date.now() + 90_000)}
        )
      `),
    ).rejects.toThrow();
  });

  it('rejects a second active (searching) request for the same rider', async () => {
    const rider = await createRider();
    await insertRequest({ riderId: rider.id, idempotencyKey: randomUUID() });

    await expect(
      insertRequest({ riderId: rider.id, idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
  });

  it('allows a new request when the previous request was assigned', async () => {
    const rider = await createRider();
    const first = await insertRequest({
      riderId: rider.id,
      idempotencyKey: randomUUID(),
    });

    await db.execute(
      sql`UPDATE "ride_request" SET "state" = 'assigned' WHERE "id" = ${first.id}`,
    );

    const second = await insertRequest({
      riderId: rider.id,
      idempotencyKey: randomUUID(),
    });
    expect(second).toBeDefined();
  });

  it('rejects offer_ttl_seconds <= 0', async () => {
    const rider = await createRider();

    await expect(
      insertRequest({
        riderId: rider.id,
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 0,
      }),
    ).rejects.toThrow();

    await expect(
      insertRequest({
        riderId: rider.id,
        idempotencyKey: randomUUID(),
        offerTtlSeconds: -1,
      }),
    ).rejects.toThrow();
  });

  it('rejects matching_deadline_at before or equal to created_at', async () => {
    const rider = await createRider();

    await expect(
      db.execute(sql`
        INSERT INTO "ride_request" (
          "rider_id", "pickup", "destination",
          "idempotency_key", "offer_ttl_seconds",
          "matching_deadline_seconds", "matching_deadline_at"
        )
        VALUES (
          ${rider.id},
          ST_SetSRID(ST_MakePoint(38.75, 9.02), 4326)::geography,
          ST_SetSRID(ST_MakePoint(38.76, 9.03), 4326)::geography,
          ${randomUUID()},
          15, 90, ${new Date(Date.now() - 1)}
        )
      `),
    ).rejects.toThrow();
  });

  it('rejects a request with a non-existent rider FK', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    await expect(
      db.execute(sql`
        INSERT INTO "ride_request" (
          "rider_id", "pickup", "destination",
          "idempotency_key", "offer_ttl_seconds",
          "matching_deadline_seconds", "matching_deadline_at"
        )
        VALUES (
          ${fakeId},
          ST_SetSRID(ST_MakePoint(38.75, 9.02), 4326)::geography,
          ST_SetSRID(ST_MakePoint(38.76, 9.03), 4326)::geography,
          ${randomUUID()},
          15, 90, ${new Date(Date.now() + 90_000)}
        )
      `),
    ).rejects.toThrow();
  });
});
