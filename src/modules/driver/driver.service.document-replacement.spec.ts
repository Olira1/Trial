import { BadRequestException } from '@nestjs/common';
import type { Database } from '../../database/database.module';
import type { StorageService } from '../storage';
import { DriverService } from './driver.service';

const createReplaceDocumentService = (input?: {
  documentType?: 'driver_license_front' | 'vehicle_photo_front';
  vehicleId?: string | null;
  driverApplicationId?: string | null;
}) => {
  const documentType = input?.documentType ?? 'driver_license_front';
  const driverApplicationId = input?.driverApplicationId ?? 'application-1';
  const row = {
    id: 'document-1',
    userId: 'user-1',
    driverApplicationId:
      documentType === 'vehicle_photo_front' ? null : driverApplicationId,
    vehicleId: input?.vehicleId ?? null,
    documentType,
    storageKey: `documents/user-1/${documentType}/new.jpg`,
    url: 'https://download.ubel.test/new.jpg',
    reviewStatus: 'pending' as const,
    reviewerId: null,
    reviewedAt: null,
    reviewReason: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const returning = jest.fn().mockResolvedValue([row]);
  const values = jest.fn().mockReturnValue({ returning });
  const insert = jest.fn().mockReturnValue({ values });
  const applicationOwnerLimit = jest
    .fn()
    .mockResolvedValue([{ id: driverApplicationId }]);
  const applicationOwnerOrderBy = jest
    .fn()
    .mockReturnValue({ limit: applicationOwnerLimit });
  const applicationOwnerWhere = jest
    .fn()
    .mockReturnValue({ orderBy: applicationOwnerOrderBy });
  const applicationOwnerFrom = jest
    .fn()
    .mockReturnValue({ where: applicationOwnerWhere });
  const applicationEnsureLimit = jest.fn().mockResolvedValue([
    {
      id: driverApplicationId,
      userId: 'user-1',
      status: 'pending',
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      reviewedAt: null,
      reviewerId: null,
      notes: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ]);
  const applicationEnsureFor = jest
    .fn()
    .mockReturnValue({ limit: applicationEnsureLimit });
  const applicationEnsureWhere = jest.fn().mockReturnValue({
    for: applicationEnsureFor,
    limit: applicationEnsureLimit,
  });
  const applicationEnsureFrom = jest
    .fn()
    .mockReturnValue({ where: applicationEnsureWhere });
  const vehicleLimit = jest
    .fn()
    .mockResolvedValue(input?.vehicleId ? [{ id: input.vehicleId }] : []);
  const vehicleOrderBy = jest.fn().mockReturnValue({ limit: vehicleLimit });
  const vehicleWhere = jest.fn().mockReturnValue({ orderBy: vehicleOrderBy });
  const vehicleFrom = jest.fn().mockReturnValue({ where: vehicleWhere });
  const emptyLicenseLimit = jest.fn().mockResolvedValue([]);
  const emptyLicenseFor = jest
    .fn()
    .mockReturnValue({ limit: emptyLicenseLimit });
  const emptyLicenseWhere = jest
    .fn()
    .mockReturnValue({ for: emptyLicenseFor, limit: emptyLicenseLimit });
  const emptyLicenseFrom = jest
    .fn()
    .mockReturnValue({ where: emptyLicenseWhere });
  const userLimit = jest.fn().mockResolvedValue([
    {
      roles: ['driver'],
    },
  ]);
  const userFor = jest.fn().mockReturnValue({ limit: userLimit });
  const userWhere = jest
    .fn()
    .mockReturnValue({ for: userFor, limit: userLimit });
  const userFrom = jest.fn().mockReturnValue({ where: userWhere });
  const reconcileApplicationLimit = jest.fn().mockResolvedValue([
    {
      id: driverApplicationId,
      userId: 'user-1',
      status: 'pending',
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      reviewedAt: null,
      reviewerId: null,
      notes: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ]);
  const reconcileApplicationFor = jest
    .fn()
    .mockReturnValue({ limit: reconcileApplicationLimit });
  const reconcileApplicationWhere = jest.fn().mockReturnValue({
    for: reconcileApplicationFor,
    limit: reconcileApplicationLimit,
  });
  const reconcileApplicationFrom = jest
    .fn()
    .mockReturnValue({ where: reconcileApplicationWhere });
  const reconcileVehicleLimit = jest.fn().mockResolvedValue(
    input?.vehicleId
      ? [
          {
            id: input.vehicleId,
            userId: 'user-1',
            reviewStatus: 'pending',
            deletedAt: null,
            isApproved: false,
          },
        ]
      : [],
  );
  const reconcileVehicleWhere = jest
    .fn()
    .mockReturnValue({ limit: reconcileVehicleLimit });
  const reconcileVehicleFrom = jest
    .fn()
    .mockReturnValue({ where: reconcileVehicleWhere });
  let selectCall = 0;
  const select = jest.fn().mockImplementation(() => {
    selectCall += 1;
    if (documentType === 'vehicle_photo_front') {
      switch (selectCall) {
        case 1:
          return { from: applicationEnsureFrom };
        case 2:
          return { from: vehicleFrom };
        case 3:
          return { from: userFrom };
        case 4:
          return { from: reconcileApplicationFrom };
        case 5:
          return { from: emptyLicenseFrom };
        default:
          return { from: reconcileVehicleFrom };
      }
    }

    switch (selectCall) {
      case 1:
        return { from: applicationEnsureFrom };
      case 2:
        return { from: applicationOwnerFrom };
      case 3:
        return { from: emptyLicenseFrom };
      case 4:
        return { from: userFrom };
      case 5:
        return { from: reconcileApplicationFrom };
      case 6:
        return { from: emptyLicenseFrom };
      default:
        return { from: reconcileVehicleFrom };
    }
  });
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });
  const transaction = jest.fn((callback: (tx: Database) => Promise<unknown>) =>
    callback({ insert, select, update } as unknown as Database),
  );
  const db = { transaction } as unknown as Database;
  const getDownloadUrl = jest.fn().mockResolvedValue(row.url);
  const storage = {
    getDownloadUrl,
  } as unknown as StorageService;

  return {
    service: new DriverService(db, storage),
    row,
    calls: {
      insert,
      values,
      returning,
      getDownloadUrl,
      select,
      applicationWhere: applicationOwnerWhere,
      applicationOrderBy: applicationOwnerOrderBy,
      vehicleWhere,
      vehicleOrderBy,
      transaction,
      update,
    },
  };
};

const createGetVehicleService = () => {
  const vehicleRow = {
    id: 'vehicle-1',
    userId: 'user-1',
    ownershipType: 'owner' as const,
    make: 'Toyota',
    model: 'Vitz',
    color: 'silver',
    year: 2020,
    plateRegion: 'aa' as const,
    plateCode: '02' as const,
    plateCodeSubtype: null,
    plateNumber: 'B22222',
    tinNumber: null,
    isApproved: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const documents = [
    {
      documentType: 'driver_license_front' as const,
      storageKey: 'documents/user-1/driver_license_front/new.jpg',
    },
    {
      documentType: 'driver_license_front' as const,
      storageKey: 'documents/user-1/driver_license_front/old.jpg',
    },
    {
      documentType: 'vehicle_photo_front' as const,
      storageKey: 'documents/user-1/vehicle_photo_front/photo.jpg',
    },
  ];
  const vehicleLimit = jest.fn().mockResolvedValue([vehicleRow]);
  const vehicleWhere = jest.fn().mockReturnValue({ limit: vehicleLimit });
  const vehicleFrom = jest.fn().mockReturnValue({ where: vehicleWhere });
  const documentOrderBy = jest.fn().mockResolvedValue(documents);
  const documentWhere = jest.fn().mockReturnValue({ orderBy: documentOrderBy });
  const documentFrom = jest.fn().mockReturnValue({ where: documentWhere });
  const select = jest
    .fn()
    .mockReturnValueOnce({ from: vehicleFrom })
    .mockReturnValueOnce({ from: documentFrom });
  const transaction = jest.fn((callback: (tx: Database) => Promise<unknown>) =>
    callback({ select } as unknown as Database),
  );
  const db = { transaction } as unknown as Database;
  const getDownloadUrl = jest
    .fn()
    .mockImplementation((key: string) =>
      Promise.resolve(`https://fresh.ubel.test/${key.split('/').at(-1)}`),
    );
  const storage = {
    getDownloadUrl,
  } as unknown as StorageService;

  return {
    service: new DriverService(db, storage),
    calls: {
      getDownloadUrl,
      select,
      documentWhere,
      documentOrderBy,
      transaction,
    },
  };
};

describe('DriverService - document replacement', () => {
  it('rejects first-time document keys outside the authenticated user document folder', async () => {
    const { service, calls } = createReplaceDocumentService();

    await expect(
      service.registerDocument('user-1', {
        documentType: 'driver_license_front',
        storageKey: 'documents/user-2/driver_license_front/new.jpg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(calls.getDownloadUrl).not.toHaveBeenCalled();
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it('starts replacement documents in a fresh pending review state', async () => {
    const { service, row } = createReplaceDocumentService();

    await expect(
      service.replaceDocument('user-1', {
        documentType: 'driver_license_front',
        storageKey: 'documents/user-1/driver_license_front/new.jpg',
      }),
    ).resolves.toMatchObject({
      ...row,
      reviewStatus: 'pending',
      reviewerId: null,
      reviewedAt: null,
      reviewReason: null,
      expiresAt: null,
      revokedAt: null,
      vehicleId: null,
      driverApplicationId: 'application-1',
    });
  });

  it('inserts a new document row for the same document type', async () => {
    const { service, row, calls } = createReplaceDocumentService();

    await expect(
      service.replaceDocument('user-1', {
        documentType: 'driver_license_front',
        storageKey: 'documents/user-1/driver_license_front/new.jpg',
      }),
    ).resolves.toEqual(row);

    expect(calls.getDownloadUrl).toHaveBeenCalledWith(
      'documents/user-1/driver_license_front/new.jpg',
    );
    expect(calls.values).toHaveBeenCalledWith({
      userId: 'user-1',
      driverApplicationId: 'application-1',
      vehicleId: null,
      documentType: 'driver_license_front',
      storageKey: 'documents/user-1/driver_license_front/new.jpg',
      reviewStatus: 'pending',
      reviewerId: null,
      reviewedAt: null,
      reviewReason: null,
      expiresAt: null,
      revokedAt: null,
    });
  });

  it('associates vehicle documents with the current vehicle', async () => {
    const { service, calls } = createReplaceDocumentService({
      documentType: 'vehicle_photo_front',
      vehicleId: 'vehicle-1',
    });

    await expect(
      service.replaceDocument('user-1', {
        documentType: 'vehicle_photo_front',
        storageKey: 'documents/user-1/vehicle_photo_front/new.jpg',
      }),
    ).resolves.toMatchObject({
      vehicleId: 'vehicle-1',
      driverApplicationId: null,
      reviewStatus: 'pending',
    });

    expect(calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: 'vehicle-1',
        driverApplicationId: null,
      }),
    );
  });

  it('associates driver documents with the current application', async () => {
    const { service, calls } = createReplaceDocumentService({
      documentType: 'driver_license_front',
      driverApplicationId: 'application-1',
    });

    await expect(
      service.replaceDocument('user-1', {
        documentType: 'driver_license_front',
        storageKey: 'documents/user-1/driver_license_front/new.jpg',
      }),
    ).resolves.toMatchObject({
      vehicleId: null,
      driverApplicationId: 'application-1',
      reviewStatus: 'pending',
    });

    expect(calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: null,
        driverApplicationId: 'application-1',
      }),
    );
  });

  it('rejects storage keys outside the authenticated user document folder', async () => {
    const { service, calls } = createReplaceDocumentService();

    await expect(
      service.replaceDocument('user-1', {
        documentType: 'driver_license_front',
        storageKey: 'documents/user-2/driver_license_front/new.jpg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(calls.getDownloadUrl).not.toHaveBeenCalled();
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it('uses the replacement document as the current vehicle document url', async () => {
    const { service, calls } = createGetVehicleService();

    const result = await service.getVehicle('user-1');

    expect(result?.documentsUploaded).toMatchObject({
      driver_license_front: 'https://fresh.ubel.test/new.jpg',
      vehicle_photo_front: 'https://fresh.ubel.test/photo.jpg',
    });
    expect(calls.getDownloadUrl).toHaveBeenCalledWith(
      'documents/user-1/driver_license_front/new.jpg',
    );
    expect(calls.getDownloadUrl).not.toHaveBeenCalledWith(
      'documents/user-1/driver_license_front/old.jpg',
    );
    expect(calls.documentWhere).toHaveBeenCalled();
    expect(calls.documentOrderBy).toHaveBeenCalled();
  });
});
