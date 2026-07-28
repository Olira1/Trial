import { randomUUID } from 'node:crypto';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig, dispatchConfig } from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { RoutingProviderFailureError } from '../dispatch-routing';
import {
  CandidateRankingService,
  type RankedCandidate,
} from '../dispatch-candidate';
import { DispatchOutboxService } from '../dispatch-outbox';
import { user } from '../user';
import type { UserRole } from '../user/schema/user.schema';
import { rideRequest } from '../ride-requests/schema';
import { MatchOrchestrator } from './match-orchestrator.service';
import { OfferReservationService } from './offer-reservation.service';
import { OfferExpirationWorkerService } from './offer-expiration-worker.service';
import { dispatchAttempt } from './schema/dispatch-attempt.schema';
import { dispatchOffer } from './schema/dispatch-offer.schema';

const createPoint = (lat: number, lon: number) =>
  sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography`;

const candidate: RankedCandidate = {
  driverId: randomUUID(),
  etaSeconds: 120,
  distanceMeters: 1_500,
};

const createDeferred = () => {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  if (resolve === undefined) throw new Error('failed to create deferred');

  return { promise, resolve };
};

describe('MatchOrchestrator (integration)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let service: MatchOrchestrator;
  let ranking: jest.Mocked<CandidateRankingService>;
  let reservation: jest.Mocked<OfferReservationService>;
  const userIds = new Set<string>();
  const requestIds = new Set<string>();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, dispatchConfig],
        }),
        DatabaseModule,
      ],
      providers: [
        MatchOrchestrator,
        DispatchOutboxService,
        {
          provide: CandidateRankingService,
          useValue: {
            rankForRequest: jest.fn(),
          },
        },
        {
          provide: OfferReservationService,
          useValue: {
            tryReserve: jest.fn(),
          },
        },
        {
          provide: OfferExpirationWorkerService,
          useValue: {
            scheduleExpiration: jest.fn().mockResolvedValue({ id: 'mock-job' }),
          },
        },
      ],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    service = moduleRef.get(MatchOrchestrator);
    ranking = moduleRef.get(CandidateRankingService);
    reservation = moduleRef.get(OfferReservationService);
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM "dispatch_outbox_event"`);
    for (const requestId of requestIds) {
      await db
        .delete(dispatchOffer)
        .where(eq(dispatchOffer.requestId, requestId))
        .catch(() => undefined);
      await db
        .delete(dispatchAttempt)
        .where(eq(dispatchAttempt.requestId, requestId))
        .catch(() => undefined);
      await db.execute(
        sql`DELETE FROM "ride_request" WHERE "id" = ${requestId}`,
      );
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
      .values({ firstName: 'Test', lastName: 'User', roles })
      .returning();
    if (!created) throw new Error('failed to create user');
    userIds.add(created.id);
    return created;
  };

  const createRequest = async (
    riderId: string,
    overrides?: { state?: 'searching' | 'offered'; matchingDeadlineAt?: Date },
  ) => {
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO "ride_request" (
        "rider_id", "state", "pickup", "destination",
        "idempotency_key", "offer_ttl_seconds",
        "matching_deadline_seconds", "matching_deadline_at"
      )
      VALUES (
        ${riderId},
        ${overrides?.state ?? 'searching'},
        ${createPoint(9.02, 38.75)},
        ${createPoint(9.03, 38.76)},
        ${randomUUID()},
        15,
        90,
        ${overrides?.matchingDeadlineAt ?? new Date(Date.now() + 90_000)}
      )
      RETURNING "id"
    `);

    const request = result.rows[0];
    if (request === undefined) throw new Error('failed to create request');
    const requestId = request.id;
    requestIds.add(requestId);
    return requestId;
  };

  const countAttempts = async (requestId: string) => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM "dispatch_attempt"
      WHERE "request_id" = ${requestId}
    `);

    return Number(result.rows[0]?.count ?? 0);
  };

  const countOutboxEvents = async (requestId: string, eventType: string) => {
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM "dispatch_outbox_event"
      WHERE "aggregate_id" = ${requestId}
        AND "event_type" = ${eventType}
    `);

    return Number(result.rows[0]?.count ?? 0);
  };

  const expireRequest = async (requestId: string) => {
    const createdAt = new Date(Date.now() - 120_000);
    const matchingDeadlineAt = new Date(Date.now() - 60_000);

    await db.execute(sql`
      UPDATE "ride_request"
      SET
        "created_at" = ${createdAt},
        "matching_deadline_at" = ${matchingDeadlineAt},
        "updated_at" = ${new Date()}
      WHERE "id" = ${requestId}
    `);
  };

  it('makes duplicate match jobs for one request harmless', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    const gate = createDeferred();
    let rankingCalls = 0;

    ranking.rankForRequest.mockImplementation(async () => {
      rankingCalls += 1;
      if (rankingCalls === 2) {
        gate.resolve();
      }
      await gate.promise;
      return [candidate];
    });
    reservation.tryReserve.mockResolvedValue({ status: 'lost_race' });

    const results = await Promise.all([
      service.attemptMatch(requestId),
      service.attemptMatch(requestId),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        { status: 'no_driver_found' },
        { status: 'noop' },
      ]),
    );
    expect(await countAttempts(requestId)).toBe(1);
    await expect(
      db.select().from(rideRequest).where(eq(rideRequest.id, requestId)),
    ).resolves.toMatchObject([{ state: 'no_driver_found' }]);
    expect(
      await countOutboxEvents(requestId, 'ride_request.no_driver_found.v1'),
    ).toBe(1);
  });

  it('returns noop when the request is no longer searching', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id, { state: 'offered' });

    const result = await service.attemptMatch(requestId);

    expect(result).toEqual({ status: 'noop' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(ranking.rankForRequest).not.toHaveBeenCalled();
    expect(await countAttempts(requestId)).toBe(0);
  });

  it('marks an expired request without creating an attempt', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);
    await expireRequest(requestId);

    const result = await service.attemptMatch(requestId);

    expect(result).toEqual({ status: 'expired' });
    expect(await countAttempts(requestId)).toBe(0);
    await expect(
      db.select().from(rideRequest).where(eq(rideRequest.id, requestId)),
    ).resolves.toMatchObject([{ state: 'expired' }]);
    expect(await countOutboxEvents(requestId, 'ride_request.expired.v1')).toBe(
      1,
    );
  });

  it('marks system_failed when ranking fails before an attempt is claimed', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);

    ranking.rankForRequest.mockRejectedValue(
      new RoutingProviderFailureError('routing failed'),
    );

    const result = await service.attemptMatch(requestId);

    expect(result).toEqual({ status: 'system_failed' });
    expect(await countAttempts(requestId)).toBe(0);
    await expect(
      db.select().from(rideRequest).where(eq(rideRequest.id, requestId)),
    ).resolves.toMatchObject([{ state: 'system_failed' }]);
    expect(
      await countOutboxEvents(requestId, 'ride_request.system_failed.v1'),
    ).toBe(1);
  });

  it('marks no_driver_found when ranking returns no candidates without creating an attempt', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);

    ranking.rankForRequest.mockResolvedValue([]);

    const result = await service.attemptMatch(requestId);

    expect(result).toEqual({ status: 'no_driver_found' });
    expect(await countAttempts(requestId)).toBe(0);
    await expect(
      db.select().from(rideRequest).where(eq(rideRequest.id, requestId)),
    ).resolves.toMatchObject([{ state: 'no_driver_found' }]);
    expect(
      await countOutboxEvents(requestId, 'ride_request.no_driver_found.v1'),
    ).toBe(1);
  });

  it('runs shadow ranking without creating attempts, offers, or request events', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);

    ranking.rankForRequest.mockResolvedValue([candidate]);

    const shadowModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, dispatchConfig],
        }),
        DatabaseModule,
      ],
      providers: [
        {
          provide: MatchOrchestrator,
          useFactory: (
            database: Database,
            config: ConfigType<typeof dispatchConfig>,
            rankingService: CandidateRankingService,
            reservationService: OfferReservationService,
            outboxService: DispatchOutboxService,
            expirationWorker: OfferExpirationWorkerService,
          ) =>
            new MatchOrchestrator(
              database,
              {
                ...config,
                enableNewMatching: true,
                enableShadowRanking: true,
              },
              rankingService,
              reservationService,
              outboxService,
              expirationWorker,
            ),
          inject: [
            DRIZZLE,
            dispatchConfig.KEY,
            CandidateRankingService,
            OfferReservationService,
            DispatchOutboxService,
            OfferExpirationWorkerService,
          ],
        },
        DispatchOutboxService,
        {
          provide: CandidateRankingService,
          useValue: ranking,
        },
        {
          provide: OfferReservationService,
          useValue: reservation,
        },
        {
          provide: OfferExpirationWorkerService,
          useValue: {
            scheduleExpiration: jest.fn().mockResolvedValue({ id: 'mock-job' }),
          },
        },
      ],
    }).compile();

    const shadowService = shadowModule.get(MatchOrchestrator);

    const result = await shadowService.attemptMatch(requestId);

    expect(result).toEqual({ status: 'shadow', candidateCount: 1 });
    expect(await countAttempts(requestId)).toBe(0);
    await expect(
      db.select().from(rideRequest).where(eq(rideRequest.id, requestId)),
    ).resolves.toMatchObject([{ state: 'searching' }]);
    expect(
      await db
        .select()
        .from(dispatchOffer)
        .where(eq(dispatchOffer.requestId, requestId)),
    ).toHaveLength(0);
    expect(
      await countOutboxEvents(requestId, 'ride_request.no_driver_found.v1'),
    ).toBe(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(reservation.tryReserve).not.toHaveBeenCalled();

    await shadowModule.close();
  });

  it('rechecks the deadline during attempt claim and expires instead of creating an attempt', async () => {
    const rider = await createUser();
    const requestId = await createRequest(rider.id);

    ranking.rankForRequest.mockImplementation(async () => {
      await expireRequest(requestId);
      return [candidate];
    });

    const result = await service.attemptMatch(requestId);

    expect(result).toEqual({ status: 'expired' });
    expect(await countAttempts(requestId)).toBe(0);
    expect(await countOutboxEvents(requestId, 'ride_request.expired.v1')).toBe(
      1,
    );
  });
});
