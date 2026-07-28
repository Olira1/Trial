import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig, fareConfig } from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { ROUTING_PROVIDER, type RoutingProvider } from '../dispatch-routing';
import { user } from '../user';
import { FareEstimatesService } from './fare-estimates.service';

describe('FareEstimatesService (integration)', () => {
  let moduleRef: TestingModule;
  let service: FareEstimatesService;
  let db: Database;
  let pool: Pool;
  let riderId: string;

  const routingProvider: jest.Mocked<RoutingProvider> = {
    estimateBatch: jest.fn(),
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, fareConfig],
        }),
        DatabaseModule,
      ],
      providers: [
        FareEstimatesService,
        { provide: ROUTING_PROVIDER, useValue: routingProvider },
      ],
    }).compile();

    service = moduleRef.get(FareEstimatesService);
    db = moduleRef.get<Database>(DRIZZLE);
    pool = moduleRef.get<Pool>(PG_POOL);

    const [rider] = await db
      .insert(user)
      .values({ firstName: 'Fare', lastName: 'Rider', roles: ['rider'] })
      .returning();
    if (!rider) throw new Error('test setup failed to create rider');
    riderId = rider.id;
  });

  afterEach(() => {
    routingProvider.estimateBatch.mockReset();
  });

  afterAll(async () => {
    if (riderId) {
      await db.delete(user).where(eq(user.id, riderId));
    }
    await pool?.end();
  });

  it('creates a five-minute standard fare estimate from routed distance', async () => {
    routingProvider.estimateBatch.mockResolvedValue([
      { status: 'routed', distanceMeters: 1_250, durationSeconds: 180 },
    ]);
    const before = Date.now();

    const estimate = await service.create(riderId, {
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      vehicleType: 'standard',
    });

    expect(estimate).toMatchObject({
      riderId,
      vehicleType: 'standard',
      currency: 'ETB',
      distanceMeters: 1_250,
      durationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
    });
    expect(estimate.id).toEqual(expect.any(String));
    expect(estimate.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 300_000,
    );
    expect(estimate.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 300_000,
    );
  });

  it('rejects an unreachable route', async () => {
    routingProvider.estimateBatch.mockResolvedValue([
      { status: 'unreachable' },
    ]);

    await expect(
      service.create(riderId, {
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        vehicleType: 'standard',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it.each(['reported', 'thrown'] as const)(
    'maps a %s routing-provider failure to service unavailable',
    async (failureMode) => {
      if (failureMode === 'reported') {
        routingProvider.estimateBatch.mockResolvedValue([
          { status: 'provider_failure', reason: 'provider unavailable' },
        ]);
      } else {
        routingProvider.estimateBatch.mockRejectedValue(
          new Error('provider unavailable'),
        );
      }

      await expect(
        service.create(riderId, {
          pickup: { latitude: 9.0192, longitude: 38.7525 },
          destination: { latitude: 9.0301, longitude: 38.7612 },
          vehicleType: 'standard',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

  it('rejects a non-positive routed estimate', async () => {
    routingProvider.estimateBatch.mockResolvedValue([
      { status: 'routed', distanceMeters: 0, durationSeconds: 0 },
    ]);

    await expect(
      service.create(riderId, {
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0192, longitude: 38.7525 },
        vehicleType: 'standard',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
