import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  authConfig,
  databaseConfig,
  dispatchConfig,
  notificationsConfig,
  redisConfig,
  storageConfig,
} from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authSession } from '../auth/schema/session.schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { user } from '../user';
import {
  DriverEligibilityService,
  type DriverOperationalState,
} from '../driver-presence';
import { driverOperationalProfile } from '../driver-presence/schema';
import { rideRequest } from '../ride-requests/schema';
import { CandidateRevalidationService } from './candidate-revalidation.service';
import type { CoarseDiscoveryCandidate } from './coarse-discovery.service';

type DocumentType = typeof documentTable.$inferInsert.documentType;

const PICKUP = { latitude: 9.0106, longitude: 38.7613 };
const FAR_INSIDE = { latitude: 9.03, longitude: 38.77 }; // ~2.4 km
const OUTSIDE = { latitude: 9.08, longitude: 38.82 }; // ~10 km

describe('CandidateRevalidationService (integration)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let service: CandidateRevalidationService;
  const requestIds = new Set<string>();
  const driverIds = new Set<string>();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            authConfig,
            redisConfig,
            databaseConfig,
            dispatchConfig,
            storageConfig,
            notificationsConfig,
          ],
        }),
        DatabaseModule,
      ],
      providers: [DriverEligibilityService, CandidateRevalidationService],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    service = moduleRef.get(CandidateRevalidationService);
  });

  afterEach(async () => {
    for (const requestId of requestIds) {
      await db.delete(rideRequest).where(eq(rideRequest.id, requestId));
    }
    requestIds.clear();
    for (const driverId of driverIds) {
      await db
        .delete(driverOperationalProfile)
        .where(eq(driverOperationalProfile.userId, driverId))
        .catch(() => undefined);
      await db
        .delete(authSession)
        .where(eq(authSession.userId, driverId))
        .catch(() => undefined);
      await db
        .delete(documentTable)
        .where(eq(documentTable.userId, driverId))
        .catch(() => undefined);
      await db.delete(vehicle).where(eq(vehicle.userId, driverId));
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, driverId));
      await db.delete(authIdentity).where(eq(authIdentity.userId, driverId));
      await db.delete(user).where(eq(user.id, driverId));
    }
    driverIds.clear();
  });

  afterAll(async () => {
    await moduleRef?.get<Pool>(PG_POOL).end();
  });

  const createRideRequest = async () => {
    const rider = await db
      .insert(user)
      .values({
        firstName: 'Rider',
        lastName: 'Test',
        roles: ['rider'],
      })
      .returning();
    const createdRider = rider[0];
    if (!createdRider) throw new Error('failed to create rider');
    const [request] = await db
      .insert(rideRequest)
      .values({
        riderId: createdRider.id,
        pickup: PICKUP,
        destination: { latitude: 9.02, longitude: 38.78 },
        idempotencyKey: randomUUID(),
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: new Date(Date.now() + 90_000),
      })
      .returning();
    if (!request) throw new Error('failed to create request');
    requestIds.add(request.id);
    return request.id;
  };

  const createDriver = async (
    operationalState: DriverOperationalState,
    lat: number,
    lng: number,
  ) => {
    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Driver',
        lastName: 'Test',
        phoneVerified: true,
        roles: ['driver'],
      })
      .returning();
    if (!createdUser) throw new Error('failed to create user');
    driverIds.add(createdUser.id);

    await db.insert(authIdentity).values({
      userId: createdUser.id,
      type: 'phone',
      identifier: `+2519${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      verifiedAt: new Date(),
    });

    const [application] = await db
      .insert(driverApplication)
      .values({
        userId: createdUser.id,
        status: 'approved',
      })
      .returning();
    if (!application) throw new Error('failed to create application');

    const [activeVehicle] = await db
      .insert(vehicle)
      .values({
        userId: createdUser.id,
        ownershipType: 'owner',
        make: 'Toyota',
        model: 'Vitz',
        color: 'white',
        year: 2022,
        plateRegion: 'aa',
        plateCode: '01',
        plateNumber: `P${randomUUID().replaceAll('-', '').slice(0, 6)}`,
        tinNumber: 'TIN-123',
        isApproved: true,
      })
      .returning();
    if (!activeVehicle) throw new Error('failed to create vehicle');

    const [session] = await db
      .insert(authSession)
      .values({
        userId: createdUser.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (!session) throw new Error('failed to create session');

    const requiredDocuments: DocumentType[] = [
      'vehicle_ownership',
      'driver_license_front',
      'driver_license_back',
      'vehicle_photo_front',
      'vehicle_photo_side',
      'vehicle_photo_back',
      'bolo',
      'third_party_insurance',
      'trade_license',
    ];
    const VEHICLE_DOCUMENTS = new Set<DocumentType>([
      'vehicle_ownership',
      'representation_letter',
      'vehicle_photo_front',
      'vehicle_photo_side',
      'vehicle_photo_back',
      'bolo',
      'third_party_insurance',
    ]);
    const EXPIRY_TRACKED_DOCUMENTS = new Set<DocumentType>([
      'driver_license_front',
      'driver_license_back',
      'bolo',
      'third_party_insurance',
      'trade_license',
    ]);

    for (const documentType of requiredDocuments) {
      await db.insert(documentTable).values({
        userId: createdUser.id,
        driverApplicationId: VEHICLE_DOCUMENTS.has(documentType)
          ? null
          : application.id,
        vehicleId: VEHICLE_DOCUMENTS.has(documentType)
          ? activeVehicle.id
          : null,
        documentType,
        storageKey: `documents/${createdUser.id}/${documentType}/${randomUUID()}.jpg`,
        reviewStatus: 'approved',
        reviewedAt: new Date(),
        expiresAt: EXPIRY_TRACKED_DOCUMENTS.has(documentType)
          ? new Date(Date.now() + 86_400_000)
          : null,
      });
    }

    const isActivePresence = ['online', 'offered', 'assigned'].includes(
      operationalState,
    );
    await db.insert(driverOperationalProfile).values({
      userId: createdUser.id,
      operationalState,
      ownerSessionId: isActivePresence ? session.id : null,
      presenceSessionId: isActivePresence
        ? randomUUID().replaceAll('-', '')
        : null,
      presenceGeneration: isActivePresence ? 1 : 0,
    });

    return {
      userId: createdUser.id,
      candidate: {
        driverId: createdUser.id,
        straightLineKm: 0,
        location: { latitude: lat, longitude: lng },
      } satisfies CoarseDiscoveryCandidate,
    };
  };

  it('returns empty array for empty coarse candidates', async () => {
    const requestId = await createRideRequest();
    const result = await service.revalidate(requestId, []);
    expect(result).toEqual([]);
  });

  it('throws NotFoundException when request does not exist', async () => {
    await expect(service.revalidate(randomUUID(), [])).rejects.toThrow(
      'ride request not found',
    );
  });

  it('filters out drivers not durably online', async () => {
    const requestId = await createRideRequest();
    const online = await createDriver(
      'online',
      PICKUP.latitude + 0.0001,
      PICKUP.longitude,
    );
    const offline = await createDriver(
      'offline',
      PICKUP.latitude + 0.0002,
      PICKUP.longitude,
    );

    const result = await service.revalidate(requestId, [
      online.candidate,
      offline.candidate,
    ]);

    expect(result.map((r) => r.driverId)).toEqual([online.userId]);
  });

  it('filters out ineligible drivers', async () => {
    const requestId = await createRideRequest();
    const eligible = await createDriver(
      'online',
      PICKUP.latitude + 0.0001,
      PICKUP.longitude,
    );
    const ineligibleUser = await db
      .insert(user)
      .values({
        firstName: 'Driver',
        lastName: 'Inactive',
        phoneVerified: true,
        roles: ['driver'],
        isActive: false,
      })
      .returning();
    const createdIneligibleUser = ineligibleUser[0];
    if (!createdIneligibleUser)
      throw new Error('failed to create inactive user');
    driverIds.add(createdIneligibleUser.id);
    const [ineligibleSession] = await db
      .insert(authSession)
      .values({
        userId: createdIneligibleUser.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (ineligibleSession === undefined)
      throw new Error('failed to create inactive session');
    await db.insert(driverOperationalProfile).values({
      userId: createdIneligibleUser.id,
      operationalState: 'online',
      ownerSessionId: ineligibleSession.id,
      presenceSessionId: randomUUID().replaceAll('-', ''),
      presenceGeneration: 1,
    });

    const result = await service.revalidate(requestId, [
      eligible.candidate,
      {
        driverId: createdIneligibleUser.id,
        straightLineKm: 0,
        location: {
          latitude: PICKUP.latitude + 0.0002,
          longitude: PICKUP.longitude,
        },
      },
    ]);

    expect(result.map((r) => r.driverId)).toEqual([eligible.userId]);
  });

  it('filters out drivers outside exact PostGIS radius', async () => {
    const requestId = await createRideRequest();
    const inside = await createDriver(
      'online',
      FAR_INSIDE.latitude,
      FAR_INSIDE.longitude,
    );
    const outside = await createDriver(
      'online',
      OUTSIDE.latitude,
      OUTSIDE.longitude,
    );

    const result = await service.revalidate(requestId, [
      inside.candidate,
      outside.candidate,
    ]);

    expect(result.map((r) => r.driverId)).toEqual([inside.userId]);
    const [firstResult] = result;
    if (!firstResult) throw new Error('expected revalidated candidate');
    expect(firstResult.exactDistanceKm).toBeGreaterThan(0);
    expect(firstResult.exactDistanceKm).toBeLessThanOrEqual(3);
  });

  it('excludes previously-offered driver IDs', async () => {
    const requestId = await createRideRequest();
    const candidate = await createDriver(
      'online',
      PICKUP.latitude + 0.0001,
      PICKUP.longitude,
    );

    const result = await service.revalidate(
      requestId,
      [candidate.candidate],
      new Set([candidate.userId]),
    );
    expect(result).toEqual([]);
  });
});
