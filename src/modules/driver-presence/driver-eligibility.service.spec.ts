import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig } from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { document as documentTable } from '../driver/schema/document.schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { driverComplianceEvent } from '../driver/schema/driver-compliance-event.schema';
import { vehicle } from '../driver/schema/vehicle.schema';
import { user } from '../user';
import { DriverEligibilityService } from './driver-eligibility.service';

type DocumentType = typeof documentTable.$inferInsert.documentType;

const REQUIRED_DOCUMENTS = [
  'vehicle_ownership',
  'driver_license_front',
  'driver_license_back',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
] as const satisfies readonly DocumentType[];

const EXPIRY_TRACKED_DOCUMENTS = new Set<DocumentType>([
  'driver_license_front',
  'driver_license_back',
  'bolo',
  'third_party_insurance',
  'trade_license',
]);

const VEHICLE_DOCUMENTS = new Set<DocumentType>([
  'vehicle_ownership',
  'representation_letter',
  'vehicle_photo_front',
  'vehicle_photo_side',
  'vehicle_photo_back',
  'bolo',
  'third_party_insurance',
]);

describe('DriverEligibilityService (integration)', () => {
  let moduleRef: TestingModule;
  let db: Database;
  let service: DriverEligibilityService;
  const userIds = new Set<string>();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
        DatabaseModule,
      ],
      providers: [DriverEligibilityService],
    }).compile();

    db = moduleRef.get(DRIZZLE);
    service = moduleRef.get(DriverEligibilityService);
  });

  afterEach(async () => {
    for (const userId of userIds) {
      await db
        .delete(documentTable)
        .where(eq(documentTable.userId, userId))
        .catch(() => undefined);
      await db
        .delete(driverComplianceEvent)
        .where(eq(driverComplianceEvent.userId, userId))
        .catch(() => undefined);
      await db.delete(vehicle).where(eq(vehicle.userId, userId));
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, userId));
      await db.delete(authIdentity).where(eq(authIdentity.userId, userId));
      await db.delete(user).where(eq(user.id, userId));
    }
    userIds.clear();
  });

  afterAll(async () => {
    await moduleRef?.get<Pool>(PG_POOL).end();
  });

  it('returns eligible when every durable Instant Ride qualification fact is valid', async () => {
    const fixture = await createEligibleDriver();

    await expect(
      service.evaluateInstantRideDriverEligibility(fixture.userId),
    ).resolves.toEqual({
      userId: fixture.userId,
      eligible: true,
      denials: [],
    });
  });

  it.each([
    ['01', null, true],
    ['02', null, false],
    ['03', 'transport_service', true],
    ['03', 'other', false],
  ] as const)(
    'evaluates plate code %s subtype %s',
    async (plateCode, plateCodeSubtype, eligible) => {
      const fixture = await createEligibleDriver({
        plateCode,
        plateCodeSubtype,
      });

      const result = await service.evaluateInstantRideDriverEligibility(
        fixture.userId,
      );

      expect(result.eligible).toBe(eligible);
      expect(reasonCodes(result)).toEqual(
        eligible ? [] : ['plate_not_eligible_for_instant_ride'],
      );
    },
  );

  it.each([
    ['inactive user', { isActive: false }, 'user_inactive'],
    ['deleted user', { deletedAt: new Date() }, 'user_deleted'],
    ['unverified phone flag', { phoneVerified: false }, 'phone_not_verified'],
    [
      'missing driver role',
      { roles: ['rider'] as 'rider'[] },
      'driver_capability_missing',
    ],
  ] as const)('denies %s', async (_label, userPatch, reason) => {
    const fixture = await createEligibleDriver({ userPatch });

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(reasonCodes(result)).toContain(reason);
  });

  it('requires a verified phone identity, not only the user phone flag', async () => {
    const fixture = await createEligibleDriver();
    await db
      .update(authIdentity)
      .set({ verifiedAt: null })
      .where(eq(authIdentity.userId, fixture.userId));

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(reasonCodes(result)).toContain('phone_not_verified');
  });

  it.each([
    [
      'pending application',
      { status: 'pending' },
      'driver_application_not_approved',
    ],
    [
      'revoked application',
      { status: 'revoked' },
      'driver_application_not_approved',
    ],
  ] as const)('denies %s', async (_label, applicationPatch, reason) => {
    const fixture = await createEligibleDriver({ applicationPatch });

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(reasonCodes(result)).toContain(reason);
  });

  it.each([
    [
      'unapproved vehicle',
      { isApproved: false },
      'active_vehicle_not_approved',
    ],
    ['deleted vehicle', { deletedAt: new Date() }, 'active_vehicle_missing'],
  ] as const)('denies %s', async (_label, vehiclePatch, reason) => {
    const fixture = await createEligibleDriver({ vehiclePatch });

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(reasonCodes(result)).toContain(reason);
  });

  it('requires every mandatory document to be approved, current, and owned by the active qualification fact', async () => {
    const fixture = await createEligibleDriver({
      skipDocuments: ['bolo'],
    });

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(result.denials).toContainEqual({
      reason: 'required_document_missing',
      documentType: 'bolo',
    });
  });

  it('requires representative drivers to have an approved representation letter', async () => {
    const fixture = await createEligibleDriver({
      ownershipType: 'representative',
      skipDocuments: ['representation_letter'],
    });

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(result.denials).toContainEqual({
      reason: 'required_document_missing',
      documentType: 'representation_letter',
    });
  });

  it('rejects expired expiry-tracked documents', async () => {
    const fixture = await createEligibleDriver({
      documentPatch: {
        documentType: 'third_party_insurance',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(result.denials).toContainEqual({
      reason: 'required_document_expired',
      documentType: 'third_party_insurance',
    });
  });

  it('rejects documents that are present but not approved', async () => {
    const fixture = await createEligibleDriver({
      documentPatch: {
        documentType: 'driver_license_front',
        reviewStatus: 'pending',
      },
    });

    const result = await service.evaluateInstantRideDriverEligibility(
      fixture.userId,
    );

    expect(result.eligible).toBe(false);
    expect(result.denials).toContainEqual({
      reason: 'required_document_not_approved',
      documentType: 'driver_license_front',
    });
  });

  it('uses the latest compliance event to deny or allow qualification', async () => {
    const fixture = await createEligibleDriver();
    await db.insert(driverComplianceEvent).values({
      userId: fixture.userId,
      actorId: fixture.userId,
      action: 'suspended',
      reason: 'manual compliance hold',
      occurredAt: new Date(Date.now() - 1_000),
    });

    await expect(
      service.evaluateInstantRideDriverEligibility(fixture.userId),
    ).resolves.toMatchObject({
      eligible: false,
      denials: [{ reason: 'driver_compliance_suspended' }],
    });

    await db.insert(driverComplianceEvent).values({
      userId: fixture.userId,
      actorId: fixture.userId,
      action: 'reinstated',
      reason: 'cleared',
      occurredAt: new Date(),
    });

    await expect(
      service.evaluateInstantRideDriverEligibility(fixture.userId),
    ).resolves.toMatchObject({ eligible: true, denials: [] });
  });

  it('batch evaluates multiple drivers', async () => {
    const eligible = await createEligibleDriver();
    const ineligible = await createEligibleDriver({
      userPatch: { isActive: false },
    });
    const missingUserId = randomUUID();

    const results = await service.batchEvaluateInstantRideDriverEligibility([
      eligible.userId,
      ineligible.userId,
      missingUserId,
    ]);

    expect(results.get(eligible.userId)).toEqual({
      userId: eligible.userId,
      eligible: true,
      denials: [],
    });
    expect(results.get(ineligible.userId)?.eligible).toBe(false);
    expect(results.get(ineligible.userId)?.denials).toContainEqual(
      expect.objectContaining({ reason: 'user_inactive' }),
    );
    expect(results.get(missingUserId)?.eligible).toBe(false);
  });

  const createEligibleDriver = async (options?: {
    userPatch?: Partial<typeof user.$inferInsert>;
    applicationPatch?: Partial<typeof driverApplication.$inferInsert>;
    vehiclePatch?: Partial<typeof vehicle.$inferInsert>;
    plateCode?: '01' | '02' | '03';
    plateCodeSubtype?: 'transport_service' | 'other' | null;
    ownershipType?: 'owner' | 'representative';
    skipDocuments?: readonly DocumentType[];
    documentPatch?: Partial<typeof documentTable.$inferInsert> & {
      documentType: DocumentType;
    };
  }) => {
    const [createdUser] = await db
      .insert(user)
      .values({
        firstName: 'Eligible',
        lastName: 'Driver',
        phoneVerified: true,
        roles: ['driver'],
        ...options?.userPatch,
      })
      .returning();

    if (!createdUser) throw new Error('test setup failed to create user');
    userIds.add(createdUser.id);

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
        ...options?.applicationPatch,
      })
      .returning();

    if (!application) {
      throw new Error('test setup failed to create driver application');
    }

    const plateCode = options?.plateCode ?? '01';
    const [activeVehicle] = await db
      .insert(vehicle)
      .values({
        userId: createdUser.id,
        ownershipType: options?.ownershipType ?? 'owner',
        make: 'Toyota',
        model: 'Vitz',
        color: 'white',
        year: 2022,
        plateRegion: 'aa',
        plateCode,
        plateCodeSubtype:
          plateCode === '03'
            ? (options?.plateCodeSubtype ?? 'transport_service')
            : null,
        plateNumber: `P${randomUUID().replaceAll('-', '').slice(0, 6)}`,
        tinNumber: plateCode === '02' ? null : 'TIN-123',
        isApproved: true,
        ...options?.vehiclePatch,
      })
      .returning();

    if (!activeVehicle) throw new Error('test setup failed to create vehicle');

    const requiredDocuments = new Set<DocumentType>(REQUIRED_DOCUMENTS);
    if ((options?.ownershipType ?? 'owner') === 'representative') {
      requiredDocuments.add('representation_letter');
    }

    for (const documentType of requiredDocuments) {
      if (options?.skipDocuments?.includes(documentType)) continue;
      const patch =
        options?.documentPatch?.documentType === documentType
          ? options.documentPatch
          : undefined;
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
        ...patch,
      });
    }

    return {
      userId: createdUser.id,
      applicationId: application.id,
      vehicleId: activeVehicle.id,
    };
  };
});

const reasonCodes = (
  result: Awaited<
    ReturnType<DriverEligibilityService['evaluateInstantRideDriverEligibility']>
  >,
) => result.denials.map((denial) => denial.reason);
