import assert from 'node:assert';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  authConfig,
  databaseConfig,
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
import type { Redis } from 'ioredis';
import { REDIS_CLIENT, RedisModule } from '../redis';
import { StorageService } from '../storage';
import { user, type User } from '../user';
import { AuthModule } from '../auth';
import { authIdentity } from '../auth/schema/auth-identity.schema';
import { DriverController } from './driver.controller';
import { DriverModule } from './driver.module';
import { document as documentTable } from './schema/document.schema';
import { driverApplicationAudit } from './schema/driver-application-audit.schema';
import { driverApplication } from './schema/driver-application.schema';
import { driverLicenseApprovalAudit } from './schema/driver-license-approval-audit.schema';
import { driverLicenseApproval } from './schema/driver-license-approval.schema';
import { vehicle } from './schema/vehicle.schema';

describe('DriverController (integration)', () => {
  let moduleRef: TestingModule;
  let controller: DriverController;
  let storage: StorageService;
  let db: Database;
  let testUser: User;
  const phone = '+251911000123';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            authConfig,
            redisConfig,
            databaseConfig,
            storageConfig,
            notificationsConfig,
          ],
        }),
        RedisModule,
        DatabaseModule,
        AuthModule,
        DriverModule,
      ],
    }).compile();
    controller = moduleRef.get(DriverController);
    storage = moduleRef.get(StorageService);
    db = moduleRef.get<Database>(DRIZZLE);

    const [existing] = await db
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(eq(authIdentity.identifier, phone));
    if (existing) {
      await db
        .delete(driverLicenseApprovalAudit)
        .where(eq(driverLicenseApprovalAudit.userId, existing.userId));
      await db
        .delete(driverLicenseApprovalAudit)
        .where(eq(driverLicenseApprovalAudit.actorId, existing.userId));
      await db
        .delete(driverLicenseApproval)
        .where(eq(driverLicenseApproval.userId, existing.userId));
      await db
        .update(driverLicenseApproval)
        .set({ reviewerId: null })
        .where(eq(driverLicenseApproval.reviewerId, existing.userId));
      await db
        .delete(documentTable)
        .where(eq(documentTable.userId, existing.userId));
      await db
        .delete(driverApplicationAudit)
        .where(eq(driverApplicationAudit.userId, existing.userId));
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, existing.userId));
      await db.delete(vehicle).where(eq(vehicle.userId, existing.userId));
      await db
        .delete(authIdentity)
        .where(eq(authIdentity.userId, existing.userId));
      await db.delete(user).where(eq(user.id, existing.userId));
    }

    const [row] = await db
      .insert(user)
      .values({
        firstName: 'Driver',
        lastName: 'Test',
        deviceId: 'd-ctrl',
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
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.userId, testUser.id));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.actorId, testUser.id));
    await db
      .delete(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, testUser.id));
    await db
      .update(driverLicenseApproval)
      .set({ reviewerId: null })
      .where(eq(driverLicenseApproval.reviewerId, testUser.id));
    await db.delete(documentTable).where(eq(documentTable.userId, testUser.id));
    await db
      .delete(driverApplicationAudit)
      .where(eq(driverApplicationAudit.userId, testUser.id));
    await db
      .delete(driverApplication)
      .where(eq(driverApplication.userId, testUser.id));
    await db.delete(vehicle).where(eq(vehicle.userId, testUser.id));
  });

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

  afterAll(async () => {
    if (!testUser) return;
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.userId, testUser.id));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.actorId, testUser.id));
    await db
      .delete(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, testUser.id));
    await db
      .update(driverLicenseApproval)
      .set({ reviewerId: null })
      .where(eq(driverLicenseApproval.reviewerId, testUser.id));
    await db.delete(documentTable).where(eq(documentTable.userId, testUser.id));
    await db
      .delete(driverApplicationAudit)
      .where(eq(driverApplicationAudit.userId, testUser.id));
    await db
      .delete(driverApplication)
      .where(eq(driverApplication.userId, testUser.id));
    await db.delete(vehicle).where(eq(vehicle.userId, testUser.id));
    await db.delete(authIdentity).where(eq(authIdentity.userId, testUser.id));
    await db.delete(user).where(eq(user.id, testUser.id));
    await moduleRef
      .get<Redis>(REDIS_CLIENT)
      .quit()
      .catch(() => undefined);
    await moduleRef.get<Pool>(PG_POOL).end();
  });

  it('registers a vehicle and returns the serialized payload', async () => {
    const res = await controller.registerVehicle(testUser, {
      ownershipType: 'owner',
      make: 'Toyota',
      model: 'Vitz',
      color: 'silver',
      year: 2020,
      plateRegion: 'aa',
      plateCode: '02',
      plateNumber: 'B22222',
    });
    expect(res).toMatchObject({
      userId: testUser.id,
      plateNumber: 'B22222',
      year: 2020,
      isApproved: false,
      tinNumber: null,
      plateCodeSubtype: null,
    });
    expect(res).not.toHaveProperty('documentsUploaded');
  });

  it('returns the registered vehicle for the authenticated user', async () => {
    await controller.registerVehicle(testUser, {
      ownershipType: 'owner',
      make: 'Toyota',
      model: 'Vitz',
      color: 'silver',
      year: 2020,
      plateRegion: 'aa',
      plateCode: '02',
      plateNumber: 'B22222',
    });
    const result = await controller.getVehicle(testUser);
    expect(result.userId).toBe(testUser.id);
    expect(result.isApproved).toBe(false);
    expect(result.plateNumber).toBe('B22222');
    expect(result.year).toBe(2020);
    expect(result.documentsUploaded).toEqual(noDocumentUrls());
  });

  it('returns uploaded document urls for the registered vehicle', async () => {
    await controller.registerVehicle(testUser, {
      ownershipType: 'owner',
      make: 'Toyota',
      model: 'Vitz',
      color: 'silver',
      year: 2020,
      plateRegion: 'aa',
      plateCode: '02',
      plateNumber: 'B22222',
    });
    const backKey = `documents/${testUser.id}/driver_license_back/back.jpg`;
    const insuranceKey = `documents/${testUser.id}/third_party_insurance/doc.jpg`;
    await db.insert(documentTable).values([
      {
        userId: testUser.id,
        documentType: 'driver_license_back',
        storageKey: backKey,
      },
      {
        userId: testUser.id,
        documentType: 'third_party_insurance',
        storageKey: insuranceKey,
      },
    ]);
    const getDownloadUrl = jest
      .spyOn(storage, 'getDownloadUrl')
      .mockImplementation((key) =>
        Promise.resolve(`https://fresh.ubel.test/${key.split('/').at(-1)}`),
      );

    try {
      const result = await controller.getVehicle(testUser);

      expect(result.documentsUploaded).toEqual({
        ...noDocumentUrls(),
        driver_license_back: 'https://fresh.ubel.test/back.jpg',
        third_party_insurance: 'https://fresh.ubel.test/doc.jpg',
      });
      expect(getDownloadUrl).toHaveBeenCalledWith(backKey);
      expect(getDownloadUrl).toHaveBeenCalledWith(insuranceKey);
    } finally {
      getDownloadUrl.mockRestore();
    }
  });

  it('throws 404 when the user has no registered vehicle', async () => {
    await expect(controller.getVehicle(testUser)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a pre-signed upload url for a document type', async () => {
    const result = await controller.getDocumentUploadUrl(testUser, {
      documentType: 'driver_license_front',
      mimeType: 'image/jpeg',
      originalName: 'license.jpg',
      sizeBytes: 1024,
    });
    expect(result.url).toMatch(/^https?:\/\//);
    expect(result.key).toContain('driver_license_front');
  });

  it('registers a document and returns it', async () => {
    const storageKey = `documents/${testUser.id}/driver_license_front/test.jpg`;
    const result = await controller.registerDocument(testUser, {
      documentType: 'driver_license_front',
      storageKey,
    });
    expect(result.documentType).toBe('driver_license_front');
    expect(result.storageKey).toBe(storageKey);
    expect(result.url).toMatch(/^https?:\/\//);
  });

  it('throws 409 when the user already has a vehicle', async () => {
    await controller.registerVehicle(testUser, {
      ownershipType: 'owner',
      make: 'Toyota',
      model: 'Vitz',
      color: 'silver',
      year: 2020,
      plateRegion: 'aa',
      plateCode: '02',
      plateNumber: 'B33333',
    });
    await expect(
      controller.registerVehicle(testUser, {
        ownershipType: 'owner',
        make: 'Toyota',
        model: 'Yaris',
        color: 'red',
        year: 2021,
        plateRegion: 'aa',
        plateCode: '02',
        plateNumber: 'B44444',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
