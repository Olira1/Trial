import type { Database } from '../../database/database.module';
import type { StorageService } from '../storage';
import { UserService } from './user.service';

type DriverRow = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender?: 'male' | 'female' | null;
  imageKey: string | null;
  isActive: boolean;
};

type IdentityRow = {
  userId: string;
  type: 'email' | 'phone';
  identifier: string;
  verifiedAt: Date | null;
  updatedAt: Date;
};

type VehicleRow = {
  userId: string;
  make: string;
  model: string;
  color: string;
  year: number;
  plateNumber: string;
  isApproved: boolean;
  reviewStatus?: 'pending' | 'approved' | 'rejected' | 'revoked';
};

type ApplicationRow = {
  userId: string;
  status: 'incomplete' | 'pending' | 'approved' | 'rejected' | 'revoked';
  submittedAt?: Date | null;
};

type DocumentRow = {
  userId: string;
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'revoked';
};

type UploadedDocumentRow = {
  id: string;
  userId: string;
  documentType: 'driver_license_front' | 'driver_license_back';
  storageKey: string;
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'revoked';
  reviewedAt: Date | null;
  reviewReason: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

const createAdminDriverListDb = ({
  rows,
  total,
  identities = [],
  vehicles = [],
  applications = [],
  documents = [],
  uploadedDocuments = [],
}: {
  rows: DriverRow[];
  total: number;
  identities?: IdentityRow[];
  vehicles?: VehicleRow[];
  applications?: ApplicationRow[];
  documents?: DocumentRow[];
  uploadedDocuments?: UploadedDocumentRow[];
}) => {
  const offset = jest.fn().mockResolvedValue(rows);
  const limit = jest.fn().mockReturnValue({ offset });
  const pageOrderBy = jest.fn().mockReturnValue({ limit });
  const pageWhere = jest.fn().mockReturnValue({ orderBy: pageOrderBy });
  const pageFrom = jest.fn().mockReturnValue({ where: pageWhere });

  const countWhere = jest.fn().mockResolvedValue([{ total }]);
  const countFrom = jest.fn().mockReturnValue({ where: countWhere });

  const identityWhere = jest.fn().mockResolvedValue(identities);
  const identityFrom = jest.fn().mockReturnValue({ where: identityWhere });

  const vehicleOrderBy = jest.fn().mockResolvedValue(vehicles);
  const vehicleWhere = jest.fn().mockReturnValue({ orderBy: vehicleOrderBy });
  const vehicleFrom = jest.fn().mockReturnValue({ where: vehicleWhere });

  const applicationOrderBy = jest.fn().mockResolvedValue(applications);
  const applicationWhere = jest.fn().mockReturnValue({
    orderBy: applicationOrderBy,
  });
  const applicationFrom = jest
    .fn()
    .mockReturnValue({ where: applicationWhere });

  const documentWhere = jest.fn().mockResolvedValue(documents);
  const documentFrom = jest.fn().mockReturnValue({ where: documentWhere });

  const vehicleDocumentOrderBy = jest.fn().mockResolvedValue(
    vehicles.map((row) => ({
      userId: row.userId,
      reviewStatus:
        row.reviewStatus ?? (row.isApproved ? 'approved' : 'pending'),
    })),
  );
  const vehicleDocumentWhere = jest
    .fn()
    .mockReturnValue({ orderBy: vehicleDocumentOrderBy });
  const vehicleDocumentFrom = jest
    .fn()
    .mockReturnValue({ where: vehicleDocumentWhere });

  const uploadedDocumentOrderBy = jest.fn().mockResolvedValue(
    [...uploadedDocuments].sort((left, right) => {
      const createdAtDiff =
        right.createdAt.getTime() - left.createdAt.getTime();
      if (createdAtDiff !== 0) return createdAtDiff;
      return right.id.localeCompare(left.id);
    }),
  );
  const uploadedDocumentWhere = jest
    .fn()
    .mockReturnValue({ orderBy: uploadedDocumentOrderBy });
  const uploadedDocumentFrom = jest
    .fn()
    .mockReturnValue({ where: uploadedDocumentWhere });

  const select = jest
    .fn()
    .mockReturnValueOnce({ from: pageFrom })
    .mockReturnValueOnce({ from: countFrom })
    .mockReturnValueOnce({ from: identityFrom })
    .mockReturnValueOnce({ from: vehicleFrom })
    .mockReturnValueOnce({ from: applicationFrom })
    .mockReturnValueOnce({ from: documentFrom })
    .mockReturnValueOnce({ from: vehicleDocumentFrom })
    .mockReturnValueOnce({ from: uploadedDocumentFrom });
  const transaction = jest.fn(
    (callback: (tx: { select: typeof select }) => unknown) =>
      callback({ select }),
  );

  return {
    db: { select, transaction } as unknown as Database,
    calls: {
      select,
      transaction,
      pageWhere,
      pageOrderBy,
      limit,
      offset,
      countWhere,
      identityWhere,
      vehicleWhere,
      vehicleOrderBy,
      applicationWhere,
      applicationOrderBy,
      documentWhere,
      vehicleDocumentOrderBy,
      vehicleDocumentWhere,
      uploadedDocumentWhere,
      uploadedDocumentOrderBy,
    },
  };
};

const createStorage = () => {
  const getDownloadUrl = jest.fn((key: string) =>
    Promise.resolve(`https://fresh.ubel.test/${key}`),
  );

  return {
    storage: {
      getDownloadUrl,
    } as unknown as StorageService,
    getDownloadUrl,
  };
};

describe('UserService - admin driver list', () => {
  it('runs transaction queries sequentially', async () => {
    let activeQueries = 0;
    const runQuery = async <T>(result: T): Promise<T> => {
      if (activeQueries > 0) {
        throw new Error('transaction query overlap');
      }
      activeQueries += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeQueries -= 1;
      return result;
    };

    const offset = jest.fn(() =>
      runQuery<DriverRow[]>([
        {
          id: 'driver-1',
          firstName: 'Driver',
          middleName: null,
          lastName: 'One',
          imageKey: null,
          isActive: true,
        },
      ]),
    );
    const limit = jest.fn().mockReturnValue({ offset });
    const pageOrderBy = jest.fn().mockReturnValue({ limit });
    const pageWhere = jest.fn().mockReturnValue({ orderBy: pageOrderBy });
    const countWhere = jest.fn(() => runQuery([{ total: 1 }]));
    const identityWhere = jest.fn(() => runQuery<IdentityRow[]>([]));
    const vehicleOrderBy = jest.fn(() => runQuery<VehicleRow[]>([]));
    const vehicleWhere = jest.fn().mockReturnValue({ orderBy: vehicleOrderBy });
    const applicationOrderBy = jest.fn(() => runQuery<ApplicationRow[]>([]));
    const applicationWhere = jest.fn().mockReturnValue({
      orderBy: applicationOrderBy,
    });
    const documentWhere = jest.fn(() => runQuery<DocumentRow[]>([]));
    const vehicleDocumentOrderBy = jest.fn(() =>
      runQuery<Array<{ userId: string; reviewStatus: string }>>([]),
    );
    const vehicleDocumentWhere = jest
      .fn()
      .mockReturnValue({ orderBy: vehicleDocumentOrderBy });
    const uploadedDocumentOrderBy = jest.fn(() =>
      runQuery<UploadedDocumentRow[]>([]),
    );
    const uploadedDocumentWhere = jest
      .fn()
      .mockReturnValue({ orderBy: uploadedDocumentOrderBy });
    const select = jest
      .fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: pageWhere }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: countWhere }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: identityWhere }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: vehicleWhere }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: applicationWhere }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: documentWhere }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: vehicleDocumentWhere }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: uploadedDocumentWhere }),
      });
    const transaction = jest.fn(
      (callback: (tx: { select: typeof select }) => unknown) =>
        callback({ select }),
    );
    const { storage } = createStorage();
    const service = new UserService(
      {
        transaction,
      } as unknown as Database,
      storage,
    );

    await expect(
      service.listDriversForAdmin({
        status: 'all',
        limit: 50,
        offset: 0,
      }),
    ).resolves.toMatchObject({ total: 1 });
  });

  it('returns a paginated driver list with contact, vehicle, documents, and status', async () => {
    const newer = new Date('2026-01-02T00:00:00.000Z');
    const older = new Date('2026-01-01T00:00:00.000Z');
    const { db, calls } = createAdminDriverListDb({
      rows: [
        {
          id: 'driver-1',
          firstName: 'Driver',
          middleName: 'Middle',
          lastName: 'One',
          gender: 'male',
          imageKey: 'profile-images/driver-1/avatar.png',
          isActive: true,
        },
      ],
      total: 3,
      identities: [
        {
          userId: 'driver-1',
          type: 'email',
          identifier: 'old@ubel.test',
          verifiedAt: null,
          updatedAt: newer,
        },
        {
          userId: 'driver-1',
          type: 'email',
          identifier: 'driver@ubel.test',
          verifiedAt: older,
          updatedAt: older,
        },
        {
          userId: 'driver-1',
          type: 'phone',
          identifier: '+251911000001',
          verifiedAt: null,
          updatedAt: newer,
        },
      ],
      vehicles: [
        {
          userId: 'driver-1',
          make: 'Toyota',
          model: 'Vitz',
          color: 'white',
          year: 2022,
          plateNumber: 'AA-01-1234',
          isApproved: true,
        },
      ],
      applications: [
        {
          userId: 'driver-1',
          status: 'pending',
          submittedAt: older,
        },
      ],
      documents: [
        {
          userId: 'driver-1',
          reviewStatus: 'approved',
        },
      ],
      uploadedDocuments: [
        {
          id: 'document-older',
          userId: 'driver-1',
          documentType: 'driver_license_front',
          storageKey: 'documents/driver-1/driver_license_front/older.jpg',
          reviewStatus: 'approved',
          reviewedAt: older,
          reviewReason: 'old upload approved',
          expiresAt: new Date('2026-06-30T00:00:00.000Z'),
          revokedAt: null,
          createdAt: older,
        },
        {
          id: 'document-newer',
          userId: 'driver-1',
          documentType: 'driver_license_front',
          storageKey: 'documents/driver-1/driver_license_front/newer.jpg',
          reviewStatus: 'pending',
          reviewedAt: null,
          reviewReason: null,
          expiresAt: null,
          revokedAt: null,
          createdAt: newer,
        },
        {
          id: 'document-back',
          userId: 'driver-1',
          documentType: 'driver_license_back',
          storageKey: 'documents/driver-1/driver_license_back/back.jpg',
          reviewStatus: 'approved',
          reviewedAt: older,
          reviewReason: 'back approved',
          expiresAt: new Date('2026-12-31T00:00:00.000Z'),
          revokedAt: null,
          createdAt: older,
        },
      ],
    });
    const { storage, getDownloadUrl } = createStorage();
    const service = new UserService(db, storage);

    await expect(
      service.listDriversForAdmin({
        status: 'active',
        limit: 25,
        offset: 50,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'driver-1',
          fullName: 'Driver Middle One',
          email: 'driver@ubel.test',
          phone: '+251911000001',
          gender: 'male',
          profilePicture:
            'https://fresh.ubel.test/profile-images/driver-1/avatar.png',
          vehicle: {
            make: 'Toyota',
            model: 'Vitz',
            color: 'white',
            year: 2022,
            plateNumber: 'AA-01-1234',
            isApproved: true,
          },
          rating: 5,
          trips: 0,
          wallet: 0,
          driverApplicationStatus: 'pending',
          submittedAt: older,
          licenseStatus: 'approved',
          vehicleDocumentsStatus: 'approved',
          documents: [
            {
              id: 'document-newer',
              documentType: 'driver_license_front',
              url: 'https://fresh.ubel.test/documents/driver-1/driver_license_front/newer.jpg',
              reviewStatus: 'pending',
              reviewedAt: null,
              reviewReason: null,
              expiresAt: null,
              revokedAt: null,
              createdAt: newer,
            },
            {
              id: 'document-back',
              documentType: 'driver_license_back',
              url: 'https://fresh.ubel.test/documents/driver-1/driver_license_back/back.jpg',
              reviewStatus: 'approved',
              reviewedAt: older,
              reviewReason: 'back approved',
              expiresAt: new Date('2026-12-31T00:00:00.000Z'),
              revokedAt: null,
              createdAt: older,
            },
          ],
          status: 'active',
        },
      ],
      total: 3,
      limit: 25,
      offset: 50,
    });

    expect(calls.limit).toHaveBeenCalledWith(25);
    expect(calls.offset).toHaveBeenCalledWith(50);
    expect(calls.pageWhere).toHaveBeenCalled();
    expect(calls.countWhere).toHaveBeenCalled();
    expect(calls.identityWhere).toHaveBeenCalled();
    expect(calls.vehicleWhere).toHaveBeenCalled();
    expect(calls.vehicleOrderBy).toHaveBeenCalled();
    expect(calls.applicationWhere).toHaveBeenCalled();
    expect(calls.applicationOrderBy).toHaveBeenCalled();
    expect(calls.documentWhere).toHaveBeenCalled();
    expect(calls.vehicleDocumentOrderBy).toHaveBeenCalled();
    expect(calls.vehicleDocumentWhere).toHaveBeenCalled();
    expect(calls.uploadedDocumentWhere).toHaveBeenCalled();
    expect(calls.uploadedDocumentOrderBy).toHaveBeenCalled();
    expect(calls.transaction).toHaveBeenCalled();
    expect(getDownloadUrl).toHaveBeenCalledWith(
      'documents/driver-1/driver_license_front/newer.jpg',
    );
    expect(getDownloadUrl).toHaveBeenCalledWith(
      'documents/driver-1/driver_license_back/back.jpg',
    );
    expect(getDownloadUrl).not.toHaveBeenCalledWith(
      'documents/driver-1/driver_license_front/older.jpg',
    );
  });

  it('returns null vehicle and partial document flags for drivers without active vehicles', async () => {
    const { db } = createAdminDriverListDb({
      rows: [
        {
          id: 'driver-2',
          firstName: 'Driver',
          middleName: null,
          lastName: 'Two',
          gender: null,
          imageKey: null,
          isActive: false,
        },
      ],
      total: 1,
      documents: [
        {
          userId: 'driver-2',
          reviewStatus: 'pending',
        },
      ],
    });
    const { storage } = createStorage();
    const service = new UserService(db, storage);

    await expect(
      service.listDriversForAdmin({
        status: 'inactive',
        limit: 50,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: 'driver-2',
          fullName: 'Driver Two',
          email: null,
          phone: null,
          gender: null,
          profilePicture: null,
          vehicle: null,
          rating: 5,
          trips: 0,
          wallet: 0,
          driverApplicationStatus: 'not_submitted',
          submittedAt: null,
          licenseStatus: 'pending',
          vehicleDocumentsStatus: 'missing',
          documents: [],
          status: 'inactive',
        },
      ],
    });
  });

  it('marks non-license uploads as documents', async () => {
    const { db } = createAdminDriverListDb({
      rows: [
        {
          id: 'driver-3',
          firstName: 'Driver',
          middleName: null,
          lastName: 'Three',
          gender: 'female',
          imageKey: null,
          isActive: true,
        },
      ],
      total: 1,
      vehicles: [
        {
          userId: 'driver-3',
          make: 'Toyota',
          model: 'Vitz',
          color: 'white',
          year: 2022,
          plateNumber: 'AA-01-1234',
          isApproved: false,
          reviewStatus: 'pending',
        },
      ],
    });
    const { storage } = createStorage();
    const service = new UserService(db, storage);

    await expect(
      service.listDriversForAdmin({
        status: 'active',
        limit: 50,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          gender: 'female',
          submittedAt: null,
          licenseStatus: 'missing',
          vehicleDocumentsStatus: 'pending',
        },
      ],
    });
  });

  it('skips follow-up lookups when the requested page is empty', async () => {
    const { db, calls } = createAdminDriverListDb({
      rows: [],
      total: 0,
    });
    const { storage } = createStorage();
    const service = new UserService(db, storage);

    await expect(
      service.listDriversForAdmin({
        status: 'all',
        limit: 50,
        offset: 0,
      }),
    ).resolves.toEqual({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    expect(calls.select).toHaveBeenCalledTimes(2);
    expect(calls.identityWhere).not.toHaveBeenCalled();
    expect(calls.vehicleWhere).not.toHaveBeenCalled();
    expect(calls.documentWhere).not.toHaveBeenCalled();
    expect(calls.vehicleDocumentWhere).not.toHaveBeenCalled();
  });
});
