import type { Database } from '../../database/database.module';
import type { StorageService } from '../storage';
import { DriverService } from './driver.service';

describe('DriverService - transactions', () => {
  it('registers vehicles inside a database transaction', async () => {
    const row = {
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
    const selectLimit = jest.fn().mockResolvedValue([]);
    const selectWhere = jest.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = jest.fn().mockReturnValue({ where: selectWhere });
    const select = jest.fn().mockReturnValue({ from: selectFrom });
    const updateWhere = jest.fn().mockResolvedValue([]);
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });
    const returning = jest.fn().mockResolvedValue([row]);
    const values = jest.fn().mockReturnValue({ returning });
    const insert = jest.fn().mockReturnValue({ values });
    const transaction = jest.fn(
      (callback: (tx: Database) => Promise<unknown>) =>
        callback({ select, insert, update } as unknown as Database),
    );
    const service = new DriverService(
      { transaction } as unknown as Database,
      {} as StorageService,
    );

    await expect(
      service.registerVehicle('user-1', {
        ownershipType: 'owner',
        make: 'Toyota',
        model: 'Vitz',
        color: 'silver',
        year: 2020,
        plateRegion: 'aa',
        plateCode: '02',
        plateNumber: 'B22222',
      }),
    ).resolves.toEqual(row);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
      ownershipType: 'owner',
      make: 'Toyota',
      model: 'Vitz',
      color: 'silver',
      year: 2020,
      plateRegion: 'aa',
      plateCode: '02',
      plateNumber: 'B22222',
      userId: 'user-1',
    });
  });

  it('reads vehicle document state inside a database transaction', async () => {
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
        documentType: 'vehicle_photo_front' as const,
        storageKey: 'documents/user-1/vehicle_photo_front/front.jpg',
      },
    ];
    const vehicleLimit = jest.fn().mockResolvedValue([vehicleRow]);
    const vehicleWhere = jest.fn().mockReturnValue({ limit: vehicleLimit });
    const vehicleFrom = jest.fn().mockReturnValue({ where: vehicleWhere });
    const documentOrderBy = jest.fn().mockResolvedValue(documents);
    const documentWhere = jest
      .fn()
      .mockReturnValue({ orderBy: documentOrderBy });
    const documentFrom = jest.fn().mockReturnValue({ where: documentWhere });
    const select = jest
      .fn()
      .mockReturnValueOnce({ from: vehicleFrom })
      .mockReturnValueOnce({ from: documentFrom });
    const transaction = jest.fn(
      (callback: (tx: Database) => Promise<unknown>) =>
        callback({ select } as unknown as Database),
    );
    const getDownloadUrl = jest
      .fn()
      .mockResolvedValue('https://fresh.ubel.test/front.jpg');
    const service = new DriverService(
      { transaction } as unknown as Database,
      { getDownloadUrl } as unknown as StorageService,
    );

    await expect(service.getVehicle('user-1')).resolves.toMatchObject({
      id: 'vehicle-1',
      documentsUploaded: {
        vehicle_photo_front: 'https://fresh.ubel.test/front.jpg',
      },
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(2);
  });
});
