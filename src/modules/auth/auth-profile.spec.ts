import assert from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { document as documentTable } from '../driver/schema/document.schema';
import { driverApplication } from '../driver/schema/driver-application.schema';
import { driverLicenseApprovalAudit } from '../driver/schema/driver-license-approval-audit.schema';
import { driverLicenseApproval } from '../driver/schema/driver-license-approval.schema';
import { userRewardLedger } from '../rewards/schema';
import type { StorageService } from '../storage';
import { user, type User } from '../user';
import { AuthService } from './auth.service';
import { createAuthTestContext } from '../../../test/auth-test.utils';
import { authIdentity } from './schema/auth-identity.schema';

const RIDER_PHONE = '+251911000088';
const RIDER_EMAIL = 'profile+rider@ubel.test';
const DRIVER_PHONE = '+251911000089';

describe('AuthService - profile response (integration)', () => {
  let service: AuthService;
  let db: Database;
  let closeTestContext: () => Promise<void>;
  let rider: User;
  let driver: User;
  let storageMock: jest.Mocked<
    Pick<StorageService, 'getUploadUrl' | 'getDownloadUrl' | 'delete'>
  >;

  const deleteUserForIdentifier = async (identifier: string) => {
    const [identity] = await db
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(eq(authIdentity.identifier, identifier))
      .limit(1);

    if (!identity) return;
    await db
      .delete(documentTable)
      .where(eq(documentTable.userId, identity.userId));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.userId, identity.userId));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.actorId, identity.userId));
    await db
      .delete(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, identity.userId));
    await db
      .update(driverLicenseApproval)
      .set({ reviewerId: null })
      .where(eq(driverLicenseApproval.reviewerId, identity.userId));
    await db
      .delete(driverApplication)
      .where(eq(driverApplication.userId, identity.userId));
    await db
      .delete(authIdentity)
      .where(eq(authIdentity.userId, identity.userId));
    await db.delete(user).where(eq(user.id, identity.userId));
  };

  beforeAll(async () => {
    storageMock = {
      getUploadUrl: jest.fn(),
      getDownloadUrl: jest.fn(),
      delete: jest.fn(),
    };
    ({
      service,
      db,
      close: closeTestContext,
    } = await createAuthTestContext({
      storage: storageMock,
    }));

    for (const identifier of [RIDER_PHONE, RIDER_EMAIL, DRIVER_PHONE]) {
      await deleteUserForIdentifier(identifier);
    }

    const [createdRider] = await db
      .insert(user)
      .values({
        firstName: 'Profile',
        middleName: 'Rider',
        lastName: 'User',
        roles: ['rider'],
        signupIntent: 'driver',
        phoneVerified: true,
        emailVerified: true,
      })
      .returning();
    assert(createdRider, 'test setup: rider insert returned no row');
    const riderImageKey = `profile-images/${createdRider.id}/avatar.jpg`;
    await db
      .update(user)
      .set({ imageKey: riderImageKey })
      .where(eq(user.id, createdRider.id));
    rider = { ...createdRider, imageKey: riderImageKey };
    await db.insert(authIdentity).values([
      {
        userId: rider.id,
        type: 'phone',
        identifier: RIDER_PHONE,
        verifiedAt: new Date(),
      },
      {
        userId: rider.id,
        type: 'email',
        identifier: RIDER_EMAIL,
        verifiedAt: new Date(),
      },
    ]);

    const [createdDriver] = await db
      .insert(user)
      .values({
        firstName: 'Profile',
        lastName: 'Driver',
        roles: ['driver'],
        signupIntent: 'driver',
      })
      .returning();
    assert(createdDriver, 'test setup: driver insert returned no row');
    driver = createdDriver;
    await db.insert(authIdentity).values({
      userId: driver.id,
      type: 'phone',
      identifier: DRIVER_PHONE,
      verifiedAt: new Date(),
    });
  });

  beforeEach(async () => {
    assert(rider, 'test setup: rider missing');
    assert(driver, 'test setup: driver missing');
    jest.clearAllMocks();
    storageMock.getDownloadUrl.mockImplementation((key: string) =>
      Promise.resolve(`https://download.ubel.test/${key}`),
    );
    const riderImageKey = `profile-images/${rider.id}/avatar.jpg`;
    await db
      .update(user)
      .set({
        firstName: 'Profile',
        middleName: 'Rider',
        lastName: 'User',
        roles: ['rider'],
        signupIntent: 'driver',
        imageKey: riderImageKey,
        phoneVerified: true,
        emailVerified: true,
      })
      .where(eq(user.id, rider.id));
    rider = { ...rider, imageKey: riderImageKey };
    await db
      .update(user)
      .set({
        firstName: 'Profile',
        middleName: null,
        lastName: 'Driver',
        roles: ['driver'],
        signupIntent: 'driver',
        imageKey: null,
        phoneVerified: false,
        emailVerified: false,
      })
      .where(eq(user.id, driver.id));
    driver = { ...driver, imageKey: null };
    await db.delete(documentTable).where(eq(documentTable.userId, rider.id));
    await db.delete(documentTable).where(eq(documentTable.userId, driver.id));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.userId, rider.id));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.actorId, rider.id));
    await db
      .delete(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, rider.id));
    await db
      .update(driverLicenseApproval)
      .set({ reviewerId: null })
      .where(eq(driverLicenseApproval.reviewerId, rider.id));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.userId, driver.id));
    await db
      .delete(driverLicenseApprovalAudit)
      .where(eq(driverLicenseApprovalAudit.actorId, driver.id));
    await db
      .delete(driverLicenseApproval)
      .where(eq(driverLicenseApproval.userId, driver.id));
    await db
      .update(driverLicenseApproval)
      .set({ reviewerId: null })
      .where(eq(driverLicenseApproval.reviewerId, driver.id));
    await db
      .delete(driverApplication)
      .where(eq(driverApplication.userId, rider.id));
    await db
      .delete(driverApplication)
      .where(eq(driverApplication.userId, driver.id));
    await db
      .delete(userRewardLedger)
      .where(eq(userRewardLedger.userId, rider.id));
    await db
      .delete(userRewardLedger)
      .where(eq(userRewardLedger.userId, driver.id));
  });

  afterAll(async () => {
    if (db && rider) {
      await db.delete(documentTable).where(eq(documentTable.userId, rider.id));
      await db
        .delete(driverLicenseApprovalAudit)
        .where(eq(driverLicenseApprovalAudit.userId, rider.id));
      await db
        .delete(driverLicenseApprovalAudit)
        .where(eq(driverLicenseApprovalAudit.actorId, rider.id));
      await db
        .delete(driverLicenseApproval)
        .where(eq(driverLicenseApproval.userId, rider.id));
      await db
        .update(driverLicenseApproval)
        .set({ reviewerId: null })
        .where(eq(driverLicenseApproval.reviewerId, rider.id));
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, rider.id));
      await db.delete(authIdentity).where(eq(authIdentity.userId, rider.id));
      await db.delete(user).where(eq(user.id, rider.id));
    }
    if (db && driver) {
      await db.delete(documentTable).where(eq(documentTable.userId, driver.id));
      await db
        .delete(driverLicenseApprovalAudit)
        .where(eq(driverLicenseApprovalAudit.userId, driver.id));
      await db
        .delete(driverLicenseApprovalAudit)
        .where(eq(driverLicenseApprovalAudit.actorId, driver.id));
      await db
        .delete(driverLicenseApproval)
        .where(eq(driverLicenseApproval.userId, driver.id));
      await db
        .update(driverLicenseApproval)
        .set({ reviewerId: null })
        .where(eq(driverLicenseApproval.reviewerId, driver.id));
      await db
        .delete(driverApplication)
        .where(eq(driverApplication.userId, driver.id));
      await db.delete(authIdentity).where(eq(authIdentity.userId, driver.id));
      await db.delete(user).where(eq(user.id, driver.id));
    }
    if (closeTestContext) await closeTestContext();
  });

  it('returns profile aliases and earned miles for a rider', async () => {
    await db.insert(userRewardLedger).values([
      {
        userId: rider.id,
        rewardDate: '2026-05-31',
        miles: 3.3,
        source: 'early_joiner_daily',
      },
      {
        userId: rider.id,
        rewardDate: '2026-06-01',
        miles: 3.3,
        source: 'early_joiner_daily',
      },
    ]);

    const result = await service.getCurrentUser(rider);
    const profileImageUrl = `https://download.ubel.test/${rider.imageKey}`;

    expect(result).toMatchObject({
      id: rider.id,
      phone: RIDER_PHONE,
      phoneNumber: RIDER_PHONE,
      email: RIDER_EMAIL,
      signupIntent: 'driver',
      miles: 6.6,
      rating: 5,
      trips: 0,
      isIdVerified: false,
      isFaydaVerified: false,
      isLicenseVerified: false,
      isDocumentVerified: false,
      image: profileImageUrl,
      avatar: profileImageUrl,
      profilePicture: profileImageUrl,
    });
    expect(storageMock.getDownloadUrl).toHaveBeenCalledWith(rider.imageKey);
  });

  it('returns a profile image upload url scoped to the current user', async () => {
    storageMock.getUploadUrl.mockResolvedValueOnce({
      url: 'https://upload.ubel.test/profile-avatar',
      key: `profile-images/${rider.id}/avatar.jpg`,
    });

    await expect(
      service.getProfileImageUploadUrl(rider.id, {
        mimeType: 'image/jpeg',
        originalName: 'avatar.jpg',
        sizeBytes: 1024,
      }),
    ).resolves.toEqual({
      url: 'https://upload.ubel.test/profile-avatar',
      key: `profile-images/${rider.id}/avatar.jpg`,
    });

    expect(storageMock.getUploadUrl).toHaveBeenCalledWith({
      folder: `profile-images/${rider.id}`,
      mimeType: 'image/jpeg',
      originalName: 'avatar.jpg',
      sizeBytes: 1024,
    });
  });

  it('does not count pending document uploads as verification', async () => {
    await db.insert(documentTable).values({
      userId: driver.id,
      documentType: 'vehicle_photo_front',
      storageKey: `documents/${driver.id}/vehicle_photo_front/test.jpg`,
      reviewStatus: 'pending',
    });

    await expect(service.getCurrentUser(driver)).resolves.toMatchObject({
      isDocumentVerified: false,
      isLicenseVerified: false,
    });
  });

  it('does not count expired or revoked approved documents as verification', async () => {
    await db.insert(documentTable).values([
      {
        userId: driver.id,
        documentType: 'vehicle_photo_front',
        storageKey: `documents/${driver.id}/vehicle_photo_front/expired.jpg`,
        reviewStatus: 'approved',
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        userId: driver.id,
        documentType: 'driver_license_front',
        storageKey: `documents/${driver.id}/driver_license_front/revoked.jpg`,
        reviewStatus: 'approved',
        revokedAt: new Date(),
      },
      {
        userId: driver.id,
        documentType: 'driver_license_back',
        storageKey: `documents/${driver.id}/driver_license_back/expired.jpg`,
        reviewStatus: 'approved',
        expiresAt: new Date(Date.now() - 1000),
      },
    ]);

    await expect(service.getCurrentUser(driver)).resolves.toMatchObject({
      isDocumentVerified: false,
      isLicenseVerified: false,
    });
  });

  it('updates editable names and profile image without changing identity fields', async () => {
    const imageKey = `profile-images/${rider.id}/avatar.jpg`;
    storageMock.getDownloadUrl.mockResolvedValueOnce(
      'https://download.ubel.test/profile-avatar',
    );

    const result = await service.updateCurrentUser(rider.id, {
      firstName: 'Updated',
      middleName: null,
      lastName: 'Profile',
      imageKey,
    });

    expect(storageMock.getDownloadUrl).toHaveBeenCalledWith(imageKey);
    expect(result).toMatchObject({
      id: rider.id,
      firstName: 'Updated',
      middleName: null,
      lastName: 'Profile',
      roles: ['rider'],
      image: 'https://download.ubel.test/profile-avatar',
      avatar: 'https://download.ubel.test/profile-avatar',
      profilePicture: 'https://download.ubel.test/profile-avatar',
      phone: RIDER_PHONE,
      phoneNumber: RIDER_PHONE,
      email: RIDER_EMAIL,
      phoneVerified: true,
      emailVerified: true,
    });

    const [updated] = await db
      .select()
      .from(user)
      .where(eq(user.id, rider.id))
      .limit(1);

    expect(updated).toMatchObject({
      firstName: 'Updated',
      middleName: null,
      lastName: 'Profile',
      roles: ['rider'],
      imageKey,
      phoneVerified: true,
      emailVerified: true,
    });
  });

  it('clears the profile image without deleting stored objects', async () => {
    const result = await service.updateCurrentUser(rider.id, {
      imageKey: null,
    });

    expect(result).toMatchObject({
      image: null,
      avatar: null,
      profilePicture: null,
    });
    expect(storageMock.getDownloadUrl).not.toHaveBeenCalled();
    expect(storageMock.delete).not.toHaveBeenCalled();
  });

  it('rejects profile image keys outside the user profile folder', async () => {
    await expect(
      service.updateCurrentUser(rider.id, {
        imageKey: `documents/${rider.id}/avatar.jpg`,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storageMock.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('derives document and license flags from approved documents plus license approval state', async () => {
    const [application] = await db
      .insert(driverApplication)
      .values({
        userId: driver.id,
        status: 'pending',
      })
      .returning();
    assert(application, 'test setup: application insert returned no row');

    await db.insert(documentTable).values({
      userId: driver.id,
      driverApplicationId: application.id,
      documentType: 'vehicle_photo_front',
      storageKey: `documents/${driver.id}/vehicle_photo_front/test.jpg`,
      reviewStatus: 'approved',
    });

    await expect(service.getCurrentUser(driver)).resolves.toMatchObject({
      isDocumentVerified: true,
      isLicenseVerified: false,
    });

    await db.insert(documentTable).values([
      {
        userId: driver.id,
        driverApplicationId: application.id,
        documentType: 'driver_license_front',
        storageKey: `documents/${driver.id}/driver_license_front/test.jpg`,
        reviewStatus: 'approved',
      },
      {
        userId: driver.id,
        driverApplicationId: application.id,
        documentType: 'driver_license_back',
        storageKey: `documents/${driver.id}/driver_license_back/test.jpg`,
        reviewStatus: 'approved',
      },
    ]);
    await db.insert(driverLicenseApproval).values({
      userId: driver.id,
      driverApplicationId: application.id,
      reviewStatus: 'approved',
      issuedBy: 'oromia',
      licenseType: 'T1',
      reviewerId: rider.id,
      reviewedAt: new Date(),
      reviewReason: 'verified',
    });

    await expect(service.getCurrentUser(driver)).resolves.toMatchObject({
      isDocumentVerified: true,
      isLicenseVerified: true,
    });
  });
});
