import assert from 'node:assert';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { databaseConfig, storageConfig } from '../../config';
import {
  DatabaseModule,
  DRIZZLE,
  PG_POOL,
  type Database,
} from '../../database/database.module';
import { StorageModule, StorageService } from '../storage';
import { user, type User } from '../user';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { authSession } from '../auth/schema/session.schema';
import { dispatchOutboxEvent } from '../dispatch-outbox/schema';
import { driverOperationalProfile } from '../driver-presence/schema';
import { documentAudit } from './schema/document-audit.schema';
import { document as documentTable } from './schema/document.schema';
import { driverApplicationAudit } from './schema/driver-application-audit.schema';
import { driverApplication } from './schema/driver-application.schema';
import { driverComplianceEvent } from './schema/driver-compliance-event.schema';
import { driverLicenseApprovalAudit } from './schema/driver-license-approval-audit.schema';
import { driverLicenseApproval } from './schema/driver-license-approval.schema';
import { vehicleAudit } from './schema/vehicle-audit.schema';
import { vehicle } from './schema/vehicle.schema';
import { DriverService } from './driver.service';

describe('DriverService (integration)', () => {
  let moduleRef: TestingModule;
  let service: DriverService;
  let storage: StorageService;
  let db: Database;
  let testUser: User;
  const phone = '+251911000777';

  const reset = async () => {
    await db.delete(vehicleAudit).where(eq(vehicleAudit.userId, testUser.id));
    await db.delete(vehicle).where(eq(vehicle.userId, testUser.id));
  };

  const resetLicenseApprovals = async () => {
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.userId, testUser.id));
    await db
      .delete(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, testUser.id));
  };

  const resetDocuments = async () => {
    await db.delete(documentAudit).where(eq(documentAudit.userId, testUser.id));
    await db.delete(documentTable).where(eq(documentTable.userId, testUser.id));
  };

  const resetApplications = async () => {
    await db
      .delete(driverApplicationAudit)
      .where(eq(driverApplicationAudit.userId, testUser.id));
    await db
      .delete(driverComplianceEvent)
      .where(eq(driverComplianceEvent.userId, testUser.id));
    await db
      .delete(driverApplication)
      .where(eq(driverApplication.userId, testUser.id));
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, storageConfig],
        }),
        DatabaseModule,
        StorageModule,
      ],
      providers: [DriverService],
    }).compile();
    service = moduleRef.get(DriverService);
    storage = moduleRef.get(StorageService);
    db = moduleRef.get<Database>(DRIZZLE);

    const [existing] = await db
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(eq(authIdentity.identifier, phone));
    if (existing) {
      await db
        .delete(documentAudit)
        .where(eq(documentAudit.userId, existing.userId));
      await db
        .delete(documentTable)
        .where(eq(documentTable.userId, existing.userId));
      await db
        .delete(vehicleAudit)
        .where(eq(vehicleAudit.userId, existing.userId));
      await db.delete(vehicle).where(eq(vehicle.userId, existing.userId));
      await db
        .delete(driverApplicationAudit)
        .where(eq(driverApplicationAudit.userId, existing.userId));
      await db
        .delete(driverLicenseApprovalAudit)
        .where(eq(driverLicenseApprovalAudit.userId, existing.userId));
      await db
        .delete(driverLicenseApproval)
        .where(eq(driverLicenseApproval.userId, existing.userId));
      await db
        .delete(driverComplianceEvent)
        .where(eq(driverComplianceEvent.userId, existing.userId));
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, existing.userId));
      await db
        .delete(authIdentity)
        .where(eq(authIdentity.userId, existing.userId));
      await db.delete(user).where(eq(user.id, existing.userId));
    }

    const [row] = await db
      .insert(user)
      .values({
        firstName: 'V',
        lastName: 'Tester',
        deviceId: 'd-vehicle',
        roles: ['driver'],
      })
      .returning();
    assert(row, 'test setup: user insert returned no row');
    testUser = row;
    await db
      .insert(authIdentity)
      .values({ userId: testUser.id, identifier: phone, type: 'phone' });
  });

  beforeEach(async () => {
    await resetDocuments();
    await resetLicenseApprovals();
    await reset();
    await resetApplications();
  });

  afterAll(async () => {
    await resetDocuments();
    await resetLicenseApprovals();
    await reset();
    await resetApplications();
    await db.delete(user).where(eq(user.id, testUser.id));
    await moduleRef.get<Pool>(PG_POOL).end();
  });

  const validInput = {
    ownershipType: 'owner' as const,
    make: 'Toyota',
    model: 'Corolla',
    color: 'white',
    year: 2020,
    plateRegion: 'aa' as const,
    plateCode: '02' as const,
    plateNumber: 'A12345',
  };

  const noDocumentUrls = () => ({
    vehicle_ownership: null,
    representation_letter: null,
    driver_license_front: null,
    driver_license_back: null,
    vehicle_photo_front: null,
    vehicle_photo_side: null,
    vehicle_photo_back: null,
    bolo: null,
    third_party_insurance: null,
    trade_license: null,
  });

  it('persists a vehicle for a user and returns it with isApproved=false', async () => {
    const created = await service.registerVehicle(testUser.id, validInput);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.userId).toBe(testUser.id);
    expect(created.isApproved).toBe(false);
    expect(created.plateNumber).toBe('A12345');
    expect(created.year).toBe(2020);
  });

  it('normalizes plate numbers before persistence', async () => {
    const created = await service.registerVehicle(testUser.id, {
      ...validInput,
      plateNumber: ' a-12 345 ',
    });

    expect(created.plateNumber).toBe('A12345');
  });

  it('returns all document urls as null when no documents exist', async () => {
    await service.registerVehicle(testUser.id, validInput);
    const getDownloadUrl = jest.spyOn(storage, 'getDownloadUrl');

    try {
      const result = await service.getVehicle(testUser.id);

      assert(result, 'expected registered vehicle');
      expect(result.documentsUploaded).toEqual(noDocumentUrls());
      expect(getDownloadUrl).not.toHaveBeenCalled();
    } finally {
      getDownloadUrl.mockRestore();
    }
  });

  it('sets fresh document urls from existing document rows', async () => {
    await service.registerVehicle(testUser.id, validInput);
    const frontKey = `documents/${testUser.id}/driver_license_front/front.jpg`;
    const photoKey = `documents/${testUser.id}/vehicle_photo_front/photo.jpg`;
    const latestFrontKey = `documents/${testUser.id}/driver_license_front/front-2.jpg`;
    await db.insert(documentTable).values([
      {
        userId: testUser.id,
        documentType: 'driver_license_front',
        storageKey: frontKey,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: testUser.id,
        documentType: 'vehicle_photo_front',
        storageKey: photoKey,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        userId: testUser.id,
        documentType: 'driver_license_front',
        storageKey: latestFrontKey,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]);
    const getDownloadUrl = jest
      .spyOn(storage, 'getDownloadUrl')
      .mockImplementation((key) =>
        Promise.resolve(`https://fresh.ubel.test/${key.split('/').at(-1)}`),
      );

    try {
      const result = await service.getVehicle(testUser.id);

      assert(result, 'expected registered vehicle');
      expect(result.documentsUploaded).toEqual({
        ...noDocumentUrls(),
        driver_license_front: 'https://fresh.ubel.test/front-2.jpg',
        vehicle_photo_front: 'https://fresh.ubel.test/photo.jpg',
      });
      expect(getDownloadUrl).toHaveBeenCalledWith(latestFrontKey);
      expect(getDownloadUrl).toHaveBeenCalledWith(photoKey);
      expect(getDownloadUrl).not.toHaveBeenCalledWith(frontKey);
    } finally {
      getDownloadUrl.mockRestore();
    }
  });

  it('rejects a second vehicle for the same user with 409', async () => {
    await service.registerVehicle(testUser.id, validInput);
    await expect(
      service.registerVehicle(testUser.id, {
        ...validInput,
        plateNumber: 'A99999',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces one non-deleted vehicle per driver at the database level', async () => {
    const [existing] = await db
      .insert(vehicle)
      .values({ ...validInput, userId: testUser.id })
      .returning();
    assert(existing, 'test setup: vehicle insert returned no row');

    await expect(
      db.insert(vehicle).values({
        ...validInput,
        userId: testUser.id,
        plateNumber: 'A99999',
      }),
    ).rejects.toThrow();

    await db
      .update(vehicle)
      .set({ deletedAt: new Date() })
      .where(eq(vehicle.id, existing.id));

    await expect(
      db.insert(vehicle).values({
        ...validInput,
        userId: testUser.id,
        plateNumber: 'A99999',
      }),
    ).resolves.toBeDefined();
  });

  it('enforces plate subtype and conditional TIN rules at the database level', async () => {
    await expect(
      db.insert(vehicle).values({
        ...validInput,
        userId: testUser.id,
        plateCode: '03',
        plateNumber: 'B11111',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(vehicle).values({
        ...validInput,
        userId: testUser.id,
        plateCode: '02',
        plateCodeSubtype: 'other',
        plateNumber: 'B22222',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(vehicle).values({
        ...validInput,
        userId: testUser.id,
        plateCode: '01',
        plateNumber: 'B33333',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(vehicle).values({
        ...validInput,
        userId: testUser.id,
        plateCode: '03',
        plateCodeSubtype: 'transport_service',
        plateNumber: 'B44444',
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate plate number across users with 409', async () => {
    const [other] = await db
      .insert(user)
      .values({
        firstName: 'Other',
        lastName: 'Driver',
        deviceId: 'd-other',
        roles: ['driver'],
      })
      .returning();
    assert(other, 'test setup: other user insert returned no row');
    try {
      await service.registerVehicle(testUser.id, validInput);
      await expect(
        service.registerVehicle(other.id, validInput),
      ).rejects.toBeInstanceOf(ConflictException);
    } finally {
      await db.delete(vehicle).where(eq(vehicle.userId, other.id));
      await db.delete(user).where(eq(user.id, other.id));
    }
  });

  it('allows the same normalized plate number when the region or code differs', async () => {
    const [otherRegion, otherCode] = await db
      .insert(user)
      .values([
        {
          firstName: 'Other',
          lastName: 'Region',
          deviceId: 'd-other-region',
          roles: ['driver'],
        },
        {
          firstName: 'Other',
          lastName: 'Code',
          deviceId: 'd-other-code',
          roles: ['driver'],
        },
      ])
      .returning();
    assert(otherRegion, 'test setup: other region user insert failed');
    assert(otherCode, 'test setup: other code user insert failed');

    try {
      await service.registerVehicle(testUser.id, validInput);

      await expect(
        service.registerVehicle(otherRegion.id, {
          ...validInput,
          plateRegion: 'or',
          plateNumber: 'a-12345',
        }),
      ).resolves.toMatchObject({
        plateRegion: 'or',
        plateCode: '02',
        plateNumber: 'A12345',
      });

      await expect(
        service.registerVehicle(otherCode.id, {
          ...validInput,
          plateCode: '03',
          plateCodeSubtype: 'other',
          plateNumber: 'A 123-45',
        }),
      ).resolves.toMatchObject({
        plateRegion: 'aa',
        plateCode: '03',
        plateNumber: 'A12345',
      });
    } finally {
      await db.delete(vehicle).where(eq(vehicle.userId, otherRegion.id));
      await db.delete(vehicle).where(eq(vehicle.userId, otherCode.id));
      await db.delete(user).where(eq(user.id, otherRegion.id));
      await db.delete(user).where(eq(user.id, otherCode.id));
    }
  });

  describe('vehicle review', () => {
    it('approves vehicle documents with qualifications and records an audit row', async () => {
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Vehicle',
          lastName: 'Admin',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [pendingVehicle] = await db
        .insert(vehicle)
        .values({ ...validInput, userId: testUser.id })
        .returning();
      assert(pendingVehicle, 'test setup: vehicle insert returned no row');

      try {
        await expect(
          (
            service as unknown as {
              approveVehicleDocuments: (
                actorUserId: string,
                driverUserId: string,
                input: {
                  reason: string;
                  tinNumber: string;
                  qualifications: Array<
                    'standard' | 'comfort' | 'ev' | 'minibus'
                  >;
                },
              ) => Promise<{ reviewStatus: 'approved' }>;
            }
          ).approveVehicleDocuments(admin.id, testUser.id, {
            reason: 'vehicle meets qualification requirements',
            tinNumber: 'TIN-0001',
            qualifications: ['standard', 'comfort'],
          }),
        ).resolves.toEqual({ reviewStatus: 'approved' });

        const [approved] = await db
          .select()
          .from(vehicle)
          .where(eq(vehicle.id, pendingVehicle.id));
        expect(approved).toMatchObject({
          reviewStatus: 'approved',
          tinNumber: 'TIN-0001',
          qualifications: ['standard', 'comfort'],
        });

        const [audit] = await db
          .select()
          .from(vehicleAudit)
          .where(eq(vehicleAudit.vehicleId, pendingVehicle.id));
        expect(audit).toMatchObject({
          vehicleId: pendingVehicle.id,
          userId: testUser.id,
          actorId: admin.id,
          action: 'approved',
          reason: 'vehicle meets qualification requirements',
          tinNumber: 'TIN-0001',
          qualifications: ['standard', 'comfort'],
          occurredAt: expect.any(Date) as Date,
        });
      } finally {
        await reset();
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('rejects a vehicle and records an audit row', async () => {
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Vehicle',
          lastName: 'Rejector',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [pendingVehicle] = await db
        .insert(vehicle)
        .values({ ...validInput, userId: testUser.id })
        .returning();
      assert(pendingVehicle, 'test setup: vehicle insert returned no row');

      try {
        await expect(
          service.rejectVehicle(admin.id, pendingVehicle.id, {
            reason: 'vehicle photo does not match registration',
          }),
        ).resolves.toEqual({ isApproved: false });

        const [rejected] = await db
          .select()
          .from(vehicle)
          .where(eq(vehicle.id, pendingVehicle.id));
        expect(rejected).toMatchObject({ isApproved: false });

        const [audit] = await db
          .select()
          .from(vehicleAudit)
          .where(eq(vehicleAudit.vehicleId, pendingVehicle.id));
        expect(audit).toMatchObject({
          vehicleId: pendingVehicle.id,
          userId: testUser.id,
          actorId: admin.id,
          action: 'rejected',
          reason: 'vehicle photo does not match registration',
          occurredAt: expect.any(Date) as Date,
        });
      } finally {
        await reset();
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('revokes an approved vehicle and records an audit row', async () => {
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Vehicle',
          lastName: 'Revoker',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [approvedVehicle] = await db
        .insert(vehicle)
        .values({ ...validInput, userId: testUser.id, isApproved: true })
        .returning();
      assert(approvedVehicle, 'test setup: vehicle insert returned no row');

      try {
        await expect(
          service.revokeVehicle(admin.id, approvedVehicle.id, {
            reason: 'vehicle qualification revoked',
          }),
        ).resolves.toEqual({ isApproved: false });

        const [revoked] = await db
          .select()
          .from(vehicle)
          .where(eq(vehicle.id, approvedVehicle.id));
        expect(revoked).toMatchObject({ isApproved: false });

        const [audit] = await db
          .select()
          .from(vehicleAudit)
          .where(eq(vehicleAudit.vehicleId, approvedVehicle.id));
        expect(audit).toMatchObject({
          vehicleId: approvedVehicle.id,
          userId: testUser.id,
          actorId: admin.id,
          action: 'revoked',
          reason: 'vehicle qualification revoked',
          occurredAt: expect.any(Date) as Date,
        });
      } finally {
        await reset();
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('rejects vehicle review from a non-admin actor', async () => {
      const [actor] = await db
        .insert(user)
        .values({
          firstName: 'Vehicle',
          lastName: 'Reviewer',
          roles: ['driver'],
        })
        .returning();
      assert(actor, 'test setup: actor insert returned no row');
      const [pendingVehicle] = await db
        .insert(vehicle)
        .values({ ...validInput, userId: testUser.id })
        .returning();
      assert(pendingVehicle, 'test setup: vehicle insert returned no row');

      try {
        await expect(
          service.approveVehicle(actor.id, pendingVehicle.id, {
            reason: 'not allowed',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      } finally {
        await reset();
        await db.delete(user).where(eq(user.id, actor.id));
      }
    });

    it('rejects revoking a vehicle that is not approved', async () => {
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Vehicle',
          lastName: 'Transition',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [pendingVehicle] = await db
        .insert(vehicle)
        .values({ ...validInput, userId: testUser.id })
        .returning();
      assert(pendingVehicle, 'test setup: vehicle insert returned no row');

      try {
        await expect(
          service.revokeVehicle(admin.id, pendingVehicle.id, {
            reason: 'cannot revoke before approval',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
      } finally {
        await reset();
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('records only one audit row for concurrent vehicle approvals', async () => {
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Vehicle',
          lastName: 'Concurrent',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [pendingVehicle] = await db
        .insert(vehicle)
        .values({ ...validInput, userId: testUser.id })
        .returning();
      assert(pendingVehicle, 'test setup: vehicle insert returned no row');

      try {
        await expect(
          Promise.all([
            service.approveVehicle(admin.id, pendingVehicle.id, {
              reason: 'first approval',
            }),
            service.approveVehicle(admin.id, pendingVehicle.id, {
              reason: 'second approval',
            }),
          ]),
        ).resolves.toEqual([{ isApproved: true }, { isApproved: true }]);

        const history = await db
          .select()
          .from(vehicleAudit)
          .where(eq(vehicleAudit.vehicleId, pendingVehicle.id));
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
          action: 'approved',
          vehicleId: pendingVehicle.id,
          userId: testUser.id,
          actorId: admin.id,
        });
      } finally {
        await reset();
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });
  });

  describe('getDocumentUploadUrl', () => {
    it('returns a pre-signed PUT url and key scoped to the user', async () => {
      const result = await service.getDocumentUploadUrl(testUser.id, {
        documentType: 'driver_license_front',
        mimeType: 'image/jpeg',
        originalName: 'license.jpg',
        sizeBytes: 1024,
      });
      expect(result.url).toMatch(/^https?:\/\//);
      expect(result.key).toContain(testUser.id);
      expect(result.key).toContain('driver_license_front');
      expect(result.key).toMatch(/\.jpg$/);
    });
  });

  describe('registerDocument', () => {
    const uploadCompleteApplicationPacket = async () => {
      await service.registerVehicle(testUser.id, validInput);

      for (const documentType of [
        'driver_license_front',
        'driver_license_back',
        'vehicle_ownership',
        'vehicle_photo_front',
        'vehicle_photo_side',
        'vehicle_photo_back',
        'bolo',
        'third_party_insurance',
        'trade_license',
      ] as const) {
        await service.registerDocument(testUser.id, {
          documentType,
          storageKey: `documents/${testUser.id}/${documentType}/${documentType}.jpg`,
        });
      }
    };

    it('persists the document record and returns it with a download url', async () => {
      const storageKey = `documents/${testUser.id}/driver_license_front/test.jpg`;
      const result = await service.registerDocument(testUser.id, {
        documentType: 'driver_license_front',
        storageKey,
      });
      expect(result.id).toBeDefined();
      expect(result.userId).toBe(testUser.id);
      expect(result.documentType).toBe('driver_license_front');
      expect(result.storageKey).toBe(storageKey);
      expect(result.url).toMatch(/^https?:\/\//);
    });

    it('persists long pre-signed download urls', async () => {
      const longUrl = `https://download.ubel.test/${'a'.repeat(700)}`;
      const storageKey = `documents/${testUser.id}/driver_license_back/long-url.jpg`;
      const getDownloadUrl = jest
        .spyOn(storage, 'getDownloadUrl')
        .mockResolvedValue(longUrl);

      try {
        const result = await service.registerDocument(testUser.id, {
          documentType: 'driver_license_back',
          storageKey,
        });

        expect(result.storageKey).toBe(storageKey);
        expect(result.url).toBe(longUrl);
      } finally {
        getDownloadUrl.mockRestore();
      }
    });

    it('allows multiple document types for the same user', async () => {
      const key1 = `documents/${testUser.id}/driver_license_front/a.jpg`;
      const key2 = `documents/${testUser.id}/driver_license_back/b.jpg`;
      await service.registerDocument(testUser.id, {
        documentType: 'driver_license_front',
        storageKey: key1,
      });
      const result = await service.registerDocument(testUser.id, {
        documentType: 'driver_license_back',
        storageKey: key2,
      });
      const docs = await db
        .select()
        .from(documentTable)
        .where(eq(documentTable.userId, testUser.id));
      expect(docs).toHaveLength(2);
      expect(result.documentType).toBe('driver_license_back');
    });

    it('creates an incomplete application without a submitted audit row on first upload', async () => {
      const storageKey = `documents/${testUser.id}/driver_license_front/submit.jpg`;

      await service.registerDocument(testUser.id, {
        documentType: 'driver_license_front',
        storageKey,
      });

      const [application] = await db
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.userId, testUser.id))
        .limit(1);
      assert(application, 'expected submitted application');
      expect(application.status).toBe('incomplete');

      const audits = await db
        .select()
        .from(driverApplicationAudit)
        .where(eq(driverApplicationAudit.applicationId, application.id));
      expect(audits).toHaveLength(0);

      const [document] = await db
        .select()
        .from(documentTable)
        .where(eq(documentTable.storageKey, storageKey))
        .limit(1);
      expect(document?.driverApplicationId).toBe(application.id);
    });

    it('keeps partial uploads incomplete without creating submitted audits', async () => {
      const firstKey = `documents/${testUser.id}/driver_license_front/first.jpg`;
      const secondKey = `documents/${testUser.id}/driver_license_back/second.jpg`;

      await service.registerDocument(testUser.id, {
        documentType: 'driver_license_front',
        storageKey: firstKey,
      });
      await service.registerDocument(testUser.id, {
        documentType: 'driver_license_back',
        storageKey: secondKey,
      });

      const applications = await db
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.userId, testUser.id));
      expect(applications).toHaveLength(1);
      expect(applications[0]?.status).toBe('incomplete');

      const audits = await db
        .select()
        .from(driverApplicationAudit)
        .where(eq(driverApplicationAudit.userId, testUser.id));
      expect(audits).toHaveLength(0);
    });

    it('transitions to pending only after the full required packet is uploaded', async () => {
      await uploadCompleteApplicationPacket();

      const [application] = await db
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.userId, testUser.id))
        .limit(1);
      assert(application, 'expected submitted application');
      expect(application.status).toBe('pending');

      const audits = await db
        .select()
        .from(driverApplicationAudit)
        .where(eq(driverApplicationAudit.applicationId, application.id));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        applicationId: application.id,
        userId: testUser.id,
        actorId: testUser.id,
        action: 'submitted',
        reason: 'submitted via document upload',
      });
    });

    it('reopens a rejected application to incomplete on partial upload', async () => {
      const now = new Date('2026-06-20T00:00:00.000Z');
      const [application] = await db
        .insert(driverApplication)
        .values({
          userId: testUser.id,
          status: 'rejected',
          submittedAt: now,
          reviewedAt: now,
          notes: 'missing requirements',
        })
        .returning();
      assert(application, 'test setup: application insert returned no row');

      await service.registerDocument(testUser.id, {
        documentType: 'driver_license_front',
        storageKey: `documents/${testUser.id}/driver_license_front/reopen.jpg`,
      });

      const [updated] = await db
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.id, application.id))
        .limit(1);
      expect(updated).toMatchObject({
        status: 'incomplete',
        reviewerId: null,
        reviewedAt: null,
      });

      const audits = await db
        .select()
        .from(driverApplicationAudit)
        .where(eq(driverApplicationAudit.applicationId, application.id));
      expect(audits).toHaveLength(0);
    });

    it('reopens an approved application to incomplete on partial upload', async () => {
      const now = new Date('2026-06-20T00:00:00.000Z');
      const [application] = await db
        .insert(driverApplication)
        .values({
          userId: testUser.id,
          status: 'approved',
          submittedAt: now,
          reviewedAt: now,
          notes: 'approved already',
        })
        .returning();
      assert(application, 'test setup: application insert returned no row');

      await service.registerDocument(testUser.id, {
        documentType: 'driver_license_front',
        storageKey: `documents/${testUser.id}/driver_license_front/approved.jpg`,
      });

      const [updated] = await db
        .select()
        .from(driverApplication)
        .where(eq(driverApplication.id, application.id))
        .limit(1);
      expect(updated?.status).toBe('incomplete');

      const audits = await db
        .select()
        .from(driverApplicationAudit)
        .where(eq(driverApplicationAudit.applicationId, application.id));
      expect(audits).toHaveLength(0);
    });
  });

  describe('vehicle registration relinking', () => {
    it('relinks pending vehicle-scoped documents after vehicle registration', async () => {
      const [document] = await db
        .insert(documentTable)
        .values({
          userId: testUser.id,
          documentType: 'vehicle_photo_front',
          storageKey: `documents/${testUser.id}/vehicle_photo_front/orphan.jpg`,
          reviewStatus: 'pending',
        })
        .returning();
      assert(document, 'test setup: document insert returned no row');

      const created = await service.registerVehicle(testUser.id, validInput);

      const [relinked] = await db
        .select()
        .from(documentTable)
        .where(eq(documentTable.id, document.id))
        .limit(1);
      expect(relinked?.vehicleId).toBe(created.id);
    });
  });

  describe('document review', () => {
    it('approves the driver license with issuer, type, and optional expiry and grants driver capability after vehicle approval', async () => {
      const [reviewer] = await db
        .insert(user)
        .values({
          firstName: 'Review',
          lastName: 'LicenseAdmin',
          roles: ['admin'],
        })
        .returning();
      assert(reviewer, 'test setup: reviewer insert returned no row');
      const [application] = await db
        .insert(driverApplication)
        .values({
          userId: testUser.id,
          status: 'pending',
        })
        .returning();
      assert(application, 'test setup: application insert returned no row');
      const [pendingVehicle] = await db
        .insert(vehicle)
        .values({ ...validInput, userId: testUser.id })
        .returning();
      assert(pendingVehicle, 'test setup: vehicle insert returned no row');

      try {
        await db.insert(documentTable).values([
          {
            userId: testUser.id,
            vehicleId: pendingVehicle.id,
            documentType: 'vehicle_ownership',
            storageKey: `documents/${testUser.id}/vehicle_ownership/ownership.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
          },
          {
            userId: testUser.id,
            driverApplicationId: application.id,
            documentType: 'driver_license_front',
            storageKey: `documents/${testUser.id}/driver_license_front/front.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
            expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          },
          {
            userId: testUser.id,
            driverApplicationId: application.id,
            documentType: 'driver_license_back',
            storageKey: `documents/${testUser.id}/driver_license_back/back.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
            expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          },
          {
            userId: testUser.id,
            vehicleId: pendingVehicle.id,
            documentType: 'vehicle_photo_front',
            storageKey: `documents/${testUser.id}/vehicle_photo_front/front.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
          },
          {
            userId: testUser.id,
            vehicleId: pendingVehicle.id,
            documentType: 'vehicle_photo_side',
            storageKey: `documents/${testUser.id}/vehicle_photo_side/side.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
          },
          {
            userId: testUser.id,
            vehicleId: pendingVehicle.id,
            documentType: 'vehicle_photo_back',
            storageKey: `documents/${testUser.id}/vehicle_photo_back/back.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
          },
          {
            userId: testUser.id,
            vehicleId: pendingVehicle.id,
            documentType: 'bolo',
            storageKey: `documents/${testUser.id}/bolo/bolo.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
            expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          },
          {
            userId: testUser.id,
            vehicleId: pendingVehicle.id,
            documentType: 'third_party_insurance',
            storageKey: `documents/${testUser.id}/third_party_insurance/insurance.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
            expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          },
          {
            userId: testUser.id,
            driverApplicationId: application.id,
            documentType: 'trade_license',
            storageKey: `documents/${testUser.id}/trade_license/trade.jpg`,
            reviewStatus: 'approved',
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewerId: reviewer.id,
            expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          },
        ]);

        await (
          service as unknown as {
            approveVehicleDocuments: (
              actorUserId: string,
              driverUserId: string,
              input: {
                reason: string;
                tinNumber: string;
                qualifications: Array<
                  'standard' | 'comfort' | 'ev' | 'minibus'
                >;
              },
            ) => Promise<{ reviewStatus: 'approved' }>;
          }
        ).approveVehicleDocuments(reviewer.id, testUser.id, {
          reason: 'vehicle documents reviewed',
          tinNumber: 'TIN-0002',
          qualifications: ['standard'],
        });

        await expect(
          (
            service as unknown as {
              approveLicense: (
                actorUserId: string,
                driverUserId: string,
                input: {
                  reason: string;
                  licenseNumber: string;
                  issuedBy: 'oromia';
                  licenseType: 'T1';
                  expiresAt: Date | null;
                },
              ) => Promise<{ reviewStatus: 'approved' }>;
            }
          ).approveLicense(reviewer.id, testUser.id, {
            reason: 'license verified',
            licenseNumber: 'ETH-123456',
            issuedBy: 'oromia',
            licenseType: 'T1',
            expiresAt: null,
          }),
        ).resolves.toEqual({ reviewStatus: 'approved' });

        const [licenseApproval] = await db
          .select()
          .from(driverLicenseApproval)
          .where(eq(driverLicenseApproval.userId, testUser.id));
        expect(licenseApproval).toMatchObject({
          userId: testUser.id,
          driverApplicationId: application.id,
          reviewStatus: 'approved',
          licenseNumber: 'ETH-123456',
          issuedBy: 'oromia',
          licenseType: 'T1',
          reviewerId: reviewer.id,
          reviewReason: 'license verified',
          expiresAt: null,
        });

        const [audit] = await db
          .select()
          .from(driverLicenseApprovalAudit)
          .where(eq(driverLicenseApprovalAudit.userId, testUser.id));
        expect(audit).toMatchObject({
          userId: testUser.id,
          actorId: reviewer.id,
          action: 'approved',
          reason: 'license verified',
          licenseNumber: 'ETH-123456',
          issuedBy: 'oromia',
          licenseType: 'T1',
          expiresAt: null,
        });

        const [updatedUser] = await db
          .select()
          .from(user)
          .where(eq(user.id, testUser.id));
        expect(updatedUser?.roles).toContain('driver');

        const [updatedApplication] = await db
          .select()
          .from(driverApplication)
          .where(eq(driverApplication.id, application.id));
        expect(updatedApplication?.status).toBe('approved');
      } finally {
        await resetDocuments();
        await resetLicenseApprovals();
        await reset();
        await resetApplications();
        await db.delete(user).where(eq(user.id, reviewer.id));
      }
    });

    it('approves a document with reviewer metadata and expiry', async () => {
      const [reviewer] = await db
        .insert(user)
        .values({
          firstName: 'Review',
          lastName: 'Admin',
          roles: ['admin'],
        })
        .returning();
      assert(reviewer, 'test setup: reviewer insert returned no row');
      try {
        const [pending] = await db
          .insert(documentTable)
          .values({
            userId: testUser.id,
            documentType: 'driver_license_front',
            storageKey: `documents/${testUser.id}/driver_license_front/pending.jpg`,
            reviewStatus: 'pending',
          })
          .returning();
        assert(pending, 'test setup: pending document insert returned no row');

        await expect(
          service.approveDocument(reviewer.id, pending.id, {
            reason: 'meets qualification requirements',
            expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          }),
        ).resolves.toEqual({ reviewStatus: 'approved' });

        const [approved] = await db
          .select()
          .from(documentTable)
          .where(eq(documentTable.id, pending.id))
          .limit(1);
        expect(approved).toMatchObject({
          reviewStatus: 'approved',
          reviewerId: reviewer.id,
          reviewReason: 'meets qualification requirements',
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          revokedAt: null,
        });

        const history = await db
          .select()
          .from(documentAudit)
          .where(eq(documentAudit.documentId, pending.id));
        expect(history).toMatchObject([
          {
            documentId: pending.id,
            userId: testUser.id,
            actorId: reviewer.id,
            action: 'approved',
            reason: 'meets qualification requirements',
            expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          },
        ]);
      } finally {
        await resetDocuments();
        await db.delete(user).where(eq(user.id, reviewer.id));
      }
    });

    it('rejects a pending document with reviewer metadata', async () => {
      const [reviewer] = await db
        .insert(user)
        .values({
          firstName: 'Review',
          lastName: 'Rejector',
          roles: ['admin'],
        })
        .returning();
      assert(reviewer, 'test setup: reviewer insert returned no row');
      try {
        const [pending] = await db
          .insert(documentTable)
          .values({
            userId: testUser.id,
            documentType: 'driver_license_back',
            storageKey: `documents/${testUser.id}/driver_license_back/pending.jpg`,
            reviewStatus: 'pending',
          })
          .returning();
        assert(pending, 'test setup: pending document insert returned no row');

        await expect(
          service.rejectDocument(reviewer.id, pending.id, {
            reason: 'image is not readable',
          }),
        ).resolves.toEqual({ reviewStatus: 'rejected' });

        const [rejected] = await db
          .select()
          .from(documentTable)
          .where(eq(documentTable.id, pending.id))
          .limit(1);
        expect(rejected).toMatchObject({
          reviewStatus: 'rejected',
          reviewerId: reviewer.id,
          reviewedAt: expect.any(Date) as Date,
          reviewReason: 'image is not readable',
          expiresAt: null,
          revokedAt: null,
        });

        const history = await db
          .select()
          .from(documentAudit)
          .where(eq(documentAudit.documentId, pending.id));
        expect(history).toMatchObject([
          {
            documentId: pending.id,
            userId: testUser.id,
            actorId: reviewer.id,
            action: 'rejected',
            reason: 'image is not readable',
            expiresAt: null,
          },
        ]);
      } finally {
        await resetDocuments();
        await db.delete(user).where(eq(user.id, reviewer.id));
      }
    });

    it('requires expiry when approving documents with tracked expiry', async () => {
      const [reviewer] = await db
        .insert(user)
        .values({
          firstName: 'Review',
          lastName: 'Expiry',
          roles: ['admin'],
        })
        .returning();
      assert(reviewer, 'test setup: reviewer insert returned no row');
      try {
        const [pending] = await db
          .insert(documentTable)
          .values({
            userId: testUser.id,
            documentType: 'bolo',
            storageKey: `documents/${testUser.id}/bolo/pending.jpg`,
            reviewStatus: 'pending',
          })
          .returning();
        assert(pending, 'test setup: pending document insert returned no row');

        await expect(
          service.approveDocument(reviewer.id, pending.id, {
            reason: 'expiry must be tracked',
            expiresAt: null,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);

        const [unchanged] = await db
          .select()
          .from(documentTable)
          .where(eq(documentTable.id, pending.id))
          .limit(1);
        expect(unchanged).toMatchObject({
          reviewStatus: 'pending',
          reviewerId: null,
          reviewedAt: null,
          reviewReason: null,
          expiresAt: null,
        });
      } finally {
        await resetDocuments();
        await db.delete(user).where(eq(user.id, reviewer.id));
      }
    });

    it('revokes an approved document while preserving its expiry', async () => {
      const [reviewer] = await db
        .insert(user)
        .values({
          firstName: 'Review',
          lastName: 'Revoker',
          roles: ['admin'],
        })
        .returning();
      assert(reviewer, 'test setup: reviewer insert returned no row');
      const expiresAt = new Date('2026-12-31T00:00:00.000Z');
      try {
        const [approved] = await db
          .insert(documentTable)
          .values({
            userId: testUser.id,
            documentType: 'driver_license_front',
            storageKey: `documents/${testUser.id}/driver_license_front/approved.jpg`,
            reviewStatus: 'approved',
            reviewerId: reviewer.id,
            reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
            reviewReason: 'previously approved',
            expiresAt,
          })
          .returning();
        assert(
          approved,
          'test setup: approved document insert returned no row',
        );

        await expect(
          service.revokeDocument(reviewer.id, approved.id, {
            reason: 'document was withdrawn',
          }),
        ).resolves.toEqual({ reviewStatus: 'revoked' });

        const [revoked] = await db
          .select()
          .from(documentTable)
          .where(eq(documentTable.id, approved.id))
          .limit(1);
        expect(revoked).toMatchObject({
          reviewStatus: 'revoked',
          reviewerId: reviewer.id,
          reviewedAt: expect.any(Date) as Date,
          reviewReason: 'document was withdrawn',
          expiresAt,
          revokedAt: expect.any(Date) as Date,
        });

        const history = await db
          .select()
          .from(documentAudit)
          .where(eq(documentAudit.documentId, approved.id));
        expect(history).toMatchObject([
          {
            documentId: approved.id,
            userId: testUser.id,
            actorId: reviewer.id,
            action: 'revoked',
            reason: 'document was withdrawn',
            expiresAt,
          },
        ]);
      } finally {
        await resetDocuments();
        await db.delete(user).where(eq(user.id, reviewer.id));
      }
    });
  });

  describe('driver qualification', () => {
    it('keeps an incomplete application until the required packet exists', async () => {
      const [applicant] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Applicant',
          roles: ['rider'],
        })
        .returning();
      assert(applicant, 'test setup: applicant insert returned no row');

      try {
        await expect(
          (
            service as unknown as {
              submitDriverApplication: (
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'incomplete' | 'pending' }>;
            }
          ).submitDriverApplication(applicant.id, {
            reason: 'wants to drive',
          }),
        ).resolves.toEqual({ status: 'incomplete' });

        const [application] = await db
          .select()
          .from(driverApplication)
          .where(eq(driverApplication.userId, applicant.id));
        assert(application, 'expected submitted application');
        expect(application).toMatchObject({
          userId: applicant.id,
          status: 'incomplete',
        });

        const [audit] = await db
          .select()
          .from(driverApplicationAudit)
          .where(eq(driverApplicationAudit.applicationId, application.id));
        expect(audit).toBeUndefined();
      } finally {
        await db
          .delete(driverApplicationAudit)
          .where(eq(driverApplicationAudit.userId, applicant.id));
        await db
          .delete(driverApplication)
          .where(eq(driverApplication.userId, applicant.id));
        await db.delete(user).where(eq(user.id, applicant.id));
      }
    });

    it('approves a pending application and grants driver capability', async () => {
      const [applicant] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Applicant',
          roles: ['rider'],
        })
        .returning();
      assert(applicant, 'test setup: applicant insert returned no row');
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Admin',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [application] = await db
        .insert(driverApplication)
        .values({ userId: applicant.id })
        .returning();
      assert(application, 'test setup: application insert returned no row');

      try {
        await expect(
          (
            service as unknown as {
              approveDriverApplication: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: string }>;
            }
          ).approveDriverApplication(admin.id, applicant.id, {
            reason: 'approved after review',
          }),
        ).resolves.toEqual({ status: 'approved' });

        const [updatedApplicant] = await db
          .select()
          .from(user)
          .where(eq(user.id, applicant.id));
        expect(updatedApplicant?.roles).toEqual(['rider', 'driver']);

        const [audit] = await db
          .select()
          .from(driverApplicationAudit)
          .where(eq(driverApplicationAudit.applicationId, application.id));
        expect(audit).toMatchObject({
          applicationId: application.id,
          userId: applicant.id,
          actorId: admin.id,
          action: 'approved',
          reason: 'approved after review',
          occurredAt: expect.any(Date) as Date,
        });
      } finally {
        await db
          .delete(driverApplicationAudit)
          .where(eq(driverApplicationAudit.userId, applicant.id));
        await db
          .delete(driverApplication)
          .where(eq(driverApplication.userId, applicant.id));
        await db.delete(user).where(eq(user.id, applicant.id));
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('rejects a pending application without granting driver capability', async () => {
      const [applicant] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Rejected',
          roles: ['rider'],
        })
        .returning();
      assert(applicant, 'test setup: applicant insert returned no row');
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Admin',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [application] = await db
        .insert(driverApplication)
        .values({ userId: applicant.id })
        .returning();
      assert(application, 'test setup: application insert returned no row');

      try {
        await expect(
          (
            service as unknown as {
              rejectDriverApplication: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'rejected' }>;
            }
          ).rejectDriverApplication(admin.id, applicant.id, {
            reason: 'not qualified yet',
          }),
        ).resolves.toEqual({ status: 'rejected' });

        const [updatedApplicant] = await db
          .select()
          .from(user)
          .where(eq(user.id, applicant.id));
        expect(updatedApplicant?.roles).toEqual(['rider']);

        const [updatedApplication] = await db
          .select()
          .from(driverApplication)
          .where(eq(driverApplication.id, application.id));
        expect(updatedApplication).toMatchObject({
          status: 'rejected',
        });

        const [audit] = await db
          .select()
          .from(driverApplicationAudit)
          .where(eq(driverApplicationAudit.applicationId, application.id));
        expect(audit).toMatchObject({
          applicationId: application.id,
          userId: applicant.id,
          actorId: admin.id,
          action: 'rejected',
          reason: 'not qualified yet',
        });
      } finally {
        await db
          .delete(driverApplicationAudit)
          .where(eq(driverApplicationAudit.userId, applicant.id));
        await db
          .delete(driverApplication)
          .where(eq(driverApplication.userId, applicant.id));
        await db.delete(user).where(eq(user.id, applicant.id));
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('rejects revoking an application that was never approved', async () => {
      const [applicant] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Pending',
          roles: ['rider'],
        })
        .returning();
      assert(applicant, 'test setup: applicant insert returned no row');
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Admin',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [application] = await db
        .insert(driverApplication)
        .values({ userId: applicant.id, status: 'pending' })
        .returning();
      assert(application, 'test setup: application insert returned no row');

      try {
        await expect(
          (
            service as unknown as {
              revokeDriverApplication: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'revoked' }>;
            }
          ).revokeDriverApplication(admin.id, applicant.id, {
            reason: 'cannot revoke before approval',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
      } finally {
        await db
          .delete(driverApplication)
          .where(eq(driverApplication.userId, applicant.id));
        await db.delete(user).where(eq(user.id, applicant.id));
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('revokes an approved application and removes driver capability', async () => {
      const [applicant] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Revocation',
          roles: ['rider'],
        })
        .returning();
      assert(applicant, 'test setup: applicant insert returned no row');
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Admin',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [application] = await db
        .insert(driverApplication)
        .values({ userId: applicant.id, status: 'approved' })
        .returning();
      assert(application, 'test setup: application insert returned no row');
      await db
        .update(user)
        .set({ roles: ['rider', 'driver'] })
        .where(eq(user.id, applicant.id));

      try {
        await expect(
          (
            service as unknown as {
              revokeDriverApplication: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'revoked' }>;
            }
          ).revokeDriverApplication(admin.id, applicant.id, {
            reason: 'qualification revoked',
          }),
        ).resolves.toEqual({ status: 'revoked' });

        const [updatedApplicant] = await db
          .select()
          .from(user)
          .where(eq(user.id, applicant.id));
        expect(updatedApplicant?.roles).toEqual(['rider']);

        const [updatedApplication] = await db
          .select()
          .from(driverApplication)
          .where(eq(driverApplication.id, application.id));
        expect(updatedApplication).toMatchObject({
          status: 'revoked',
        });

        const [audit] = await db
          .select()
          .from(driverApplicationAudit)
          .where(eq(driverApplicationAudit.applicationId, application.id));
        expect(audit).toMatchObject({
          applicationId: application.id,
          userId: applicant.id,
          actorId: admin.id,
          action: 'revoked',
          reason: 'qualification revoked',
        });
      } finally {
        await db
          .delete(driverApplicationAudit)
          .where(eq(driverApplicationAudit.userId, applicant.id));
        await db
          .delete(driverApplication)
          .where(eq(driverApplication.userId, applicant.id));
        await db.delete(user).where(eq(user.id, applicant.id));
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });

    it('records compliance suspension separately from account activity', async () => {
      const [applicant] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Suspended',
          roles: ['rider', 'driver'],
        })
        .returning();
      assert(applicant, 'test setup: applicant insert returned no row');
      const [admin] = await db
        .insert(user)
        .values({
          firstName: 'Qualification',
          lastName: 'Admin',
          roles: ['admin'],
        })
        .returning();
      assert(admin, 'test setup: admin insert returned no row');
      const [application] = await db
        .insert(driverApplication)
        .values({ userId: applicant.id, status: 'approved' })
        .returning();
      assert(application, 'test setup: application insert returned no row');
      const [session] = await db
        .insert(authSession)
        .values({
          userId: applicant.id,
          tokenHash: `qualification-suspend-${applicant.id}`,
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning({ id: authSession.id });
      assert(session, 'test setup: auth session insert returned no row');
      await db.insert(driverOperationalProfile).values({
        userId: applicant.id,
        operationalState: 'online',
        ownerSessionId: session.id,
        presenceSessionId: `presence-${applicant.id}`,
        presenceGeneration: 1,
      });

      try {
        await expect(
          (
            service as unknown as {
              suspendDriverQualification: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'suspended' }>;
              reinstateDriverQualification: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'reinstated' }>;
            }
          ).suspendDriverQualification(admin.id, applicant.id, {
            reason: 'manual compliance review',
          }),
        ).resolves.toEqual({ status: 'suspended' });

        await expect(
          (
            service as unknown as {
              suspendDriverQualification: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'suspended' }>;
              reinstateDriverQualification: (
                actorUserId: string,
                driverUserId: string,
                input: { reason: string },
              ) => Promise<{ status: 'reinstated' }>;
            }
          ).reinstateDriverQualification(admin.id, applicant.id, {
            reason: 'compliance cleared',
          }),
        ).resolves.toEqual({ status: 'reinstated' });

        const [updatedApplicant] = await db
          .select()
          .from(user)
          .where(eq(user.id, applicant.id));
        expect(updatedApplicant).toMatchObject({
          isActive: true,
          roles: ['rider', 'driver'],
        });

        const events = await db
          .select()
          .from(driverComplianceEvent)
          .where(eq(driverComplianceEvent.userId, applicant.id));
        expect(events).toHaveLength(2);
        expect(events.map((event) => event.action)).toEqual([
          'suspended',
          'reinstated',
        ]);
        const [profile] = await db
          .select()
          .from(driverOperationalProfile)
          .where(eq(driverOperationalProfile.userId, applicant.id));
        expect(profile).toMatchObject({
          operationalState: 'offline',
          ownerSessionId: null,
          presenceSessionId: null,
          presenceGeneration: 2,
        });
        const [presenceEvent] = await db
          .select()
          .from(dispatchOutboxEvent)
          .where(eq(dispatchOutboxEvent.aggregateId, applicant.id));
        expect(presenceEvent).toMatchObject({
          eventType: 'driver_presence.offline.v1',
          aggregateType: 'driver_presence',
          aggregateId: applicant.id,
          actorUserId: admin.id,
        });
      } finally {
        await db
          .delete(dispatchOutboxEvent)
          .where(eq(dispatchOutboxEvent.aggregateId, applicant.id));
        await db
          .delete(driverOperationalProfile)
          .where(eq(driverOperationalProfile.userId, applicant.id));
        await db
          .delete(authSession)
          .where(eq(authSession.userId, applicant.id));
        await db
          .delete(driverComplianceEvent)
          .where(eq(driverComplianceEvent.userId, applicant.id));
        await db
          .delete(driverApplication)
          .where(eq(driverApplication.userId, applicant.id));
        await db.delete(user).where(eq(user.id, applicant.id));
        await db.delete(user).where(eq(user.id, admin.id));
      }
    });
  });
});
