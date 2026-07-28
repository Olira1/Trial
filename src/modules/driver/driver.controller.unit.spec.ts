import type { User } from '../user';
import { DriverController } from './driver.controller';
import type { DriverService } from './driver.service';

describe('DriverController - document replacement', () => {
  it('replaces a document using the path document type and body storage key', async () => {
    const row = {
      id: 'document-1',
      userId: 'user-1',
      documentType: 'driver_license_front' as const,
      storageKey: 'documents/user-1/driver_license_front/new.jpg',
      url: 'https://download.ubel.test/new.jpg',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const replaceDocument = jest.fn().mockResolvedValue(row);
    const service = {
      replaceDocument,
    } as unknown as DriverService;
    const controller = new DriverController(service);

    await expect(
      controller.replaceDocument(
        { id: 'user-1' } as User,
        { documentType: 'driver_license_front' },
        { storageKey: 'documents/user-1/driver_license_front/new.jpg' },
      ),
    ).resolves.toBe(row);

    expect(replaceDocument).toHaveBeenCalledWith('user-1', {
      documentType: 'driver_license_front',
      storageKey: 'documents/user-1/driver_license_front/new.jpg',
    });
  });
});
