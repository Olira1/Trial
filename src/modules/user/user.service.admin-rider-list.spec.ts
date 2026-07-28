import type { Database } from '../../database/database.module';
import type { StorageService } from '../storage';
import { UserService } from './user.service';

type RiderRow = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
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

type MilesRow = {
  userId: string;
  miles: string;
};

const createAdminRiderListDb = ({
  rows,
  total,
  identities = [],
  miles = [],
}: {
  rows: RiderRow[];
  total: number;
  identities?: IdentityRow[];
  miles?: MilesRow[];
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

  const milesGroupBy = jest.fn().mockResolvedValue(miles);
  const milesWhere = jest.fn().mockReturnValue({ groupBy: milesGroupBy });
  const milesFrom = jest.fn().mockReturnValue({ where: milesWhere });

  const select = jest
    .fn()
    .mockReturnValueOnce({ from: pageFrom })
    .mockReturnValueOnce({ from: countFrom })
    .mockReturnValueOnce({ from: identityFrom })
    .mockReturnValueOnce({ from: milesFrom });
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
      milesWhere,
      milesGroupBy,
    },
  };
};

const storage = {
  getDownloadUrl: jest.fn((key: string) =>
    Promise.resolve(`https://fresh.ubel.test/${key}`),
  ),
} as unknown as StorageService;

describe('UserService - admin rider list', () => {
  it('returns a paginated rider list with email, miles, defaults, and status', async () => {
    const newer = new Date('2026-01-02T00:00:00.000Z');
    const older = new Date('2026-01-01T00:00:00.000Z');
    const { db, calls } = createAdminRiderListDb({
      rows: [
        {
          id: 'rider-1',
          firstName: 'Rider',
          middleName: 'Middle',
          lastName: 'One',
          imageKey: 'profile-images/rider-1/avatar.png',
          isActive: true,
        },
      ],
      total: 3,
      identities: [
        {
          userId: 'rider-1',
          type: 'email',
          identifier: 'old@ubel.test',
          verifiedAt: null,
          updatedAt: newer,
        },
        {
          userId: 'rider-1',
          type: 'email',
          identifier: 'rider@ubel.test',
          verifiedAt: older,
          updatedAt: older,
        },
        {
          userId: 'rider-1',
          type: 'phone',
          identifier: '+251911000002',
          verifiedAt: null,
          updatedAt: newer,
        },
      ],
      miles: [{ userId: 'rider-1', miles: '6.6' }],
    });
    const service = new UserService(db, storage);

    await expect(
      service.listRidersForAdmin({
        status: 'active',
        limit: 25,
        offset: 50,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'rider-1',
          fullName: 'Rider Middle One',
          email: 'rider@ubel.test',
          phone: '+251911000002',
          profilePicture:
            'https://fresh.ubel.test/profile-images/rider-1/avatar.png',
          rating: 5,
          trips: 0,
          miles: 6.6,
          isIdVerified: false,
          isFaydaVerified: false,
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
    expect(calls.milesWhere).toHaveBeenCalled();
    expect(calls.milesGroupBy).toHaveBeenCalled();
    expect(calls.transaction).toHaveBeenCalled();
  });

  it('returns default email and miles values for inactive riders without rows', async () => {
    const { db } = createAdminRiderListDb({
      rows: [
        {
          id: 'rider-2',
          firstName: 'Rider',
          middleName: null,
          lastName: 'Two',
          imageKey: null,
          isActive: false,
        },
      ],
      total: 1,
    });
    const service = new UserService(db, storage);

    await expect(
      service.listRidersForAdmin({
        status: 'inactive',
        limit: 50,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: 'rider-2',
          fullName: 'Rider Two',
          email: null,
          phone: null,
          profilePicture: null,
          rating: 5,
          trips: 0,
          miles: 0,
          isIdVerified: false,
          isFaydaVerified: false,
          status: 'inactive',
        },
      ],
    });
  });

  it('skips follow-up lookups when the requested page is empty', async () => {
    const { db, calls } = createAdminRiderListDb({
      rows: [],
      total: 0,
    });
    const service = new UserService(db, storage);

    await expect(
      service.listRidersForAdmin({
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
    expect(calls.milesWhere).not.toHaveBeenCalled();
  });
});
