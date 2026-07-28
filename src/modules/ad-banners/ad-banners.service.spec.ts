import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '../../database/database.module';
import type { StorageService } from '../storage';
import { AdBannersService } from './ad-banners.service';
import type { AdBanner } from './schema';

const bannerRow = {
  id: 'banner-1',
  title: 'Promo',
  imageKey: 'ad-banners/banner.png',
  linkUrl: 'https://ubel.test/promo',
  audience: 'all_users',
  sortOrder: 2,
  isActive: true,
  startsAt: new Date('2026-01-01T00:00:00.000Z'),
  endsAt: new Date('2026-01-31T23:59:59.000Z'),
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
} satisfies AdBanner;

const createTransactionalDb = <T extends object>(tx: T) => {
  const transaction = jest.fn((callback: (tx: T) => unknown) => callback(tx));
  return {
    db: { transaction } as unknown as Database,
    transaction,
  };
};

const createStorage = () => {
  const getUploadUrl = jest.fn().mockResolvedValue({
    url: 'https://upload.ubel.test/banner',
    key: 'ad-banners/banner.png',
  });
  const getDownloadUrl = jest
    .fn()
    .mockResolvedValue('https://download.ubel.test/banner.png');

  return {
    storage: { getUploadUrl, getDownloadUrl } as unknown as StorageService,
    calls: { getUploadUrl, getDownloadUrl },
  };
};

describe('AdBannersService', () => {
  it('returns upload urls scoped to ad banners', async () => {
    const { storage, calls } = createStorage();
    const service = new AdBannersService({} as Database, storage);

    await expect(
      service.getUploadUrl({
        mimeType: 'image/png',
        originalName: 'banner.png',
        sizeBytes: 1024,
      }),
    ).resolves.toEqual({
      url: 'https://upload.ubel.test/banner',
      key: 'ad-banners/banner.png',
    });

    expect(calls.getUploadUrl).toHaveBeenCalledWith({
      folder: 'ad-banners',
      mimeType: 'image/png',
      originalName: 'banner.png',
      sizeBytes: 1024,
    });
  });

  it('lists active banners with fresh image urls', async () => {
    const orderBy = jest.fn().mockResolvedValue([bannerRow]);
    let capturedCondition: SQL | undefined;
    const where = jest.fn((condition: SQL | undefined) => {
      capturedCondition = condition;
      return { orderBy };
    });
    const from = jest.fn().mockReturnValue({ where });
    const tx = {
      select: jest.fn().mockReturnValue({ from }),
    };
    const { db, transaction } = createTransactionalDb(tx);
    const { storage, calls } = createStorage();
    const service = new AdBannersService(db, storage);

    await expect(service.listActiveBanners(['driver'])).resolves.toEqual([
      {
        id: 'banner-1',
        title: 'Promo',
        imageUrl: 'https://download.ubel.test/banner.png',
        linkUrl: 'https://ubel.test/promo',
        audience: 'all_users',
        sortOrder: 2,
        isActive: true,
        startsAt: bannerRow.startsAt,
        endsAt: bannerRow.endsAt,
        createdAt: bannerRow.createdAt,
        updatedAt: bannerRow.updatedAt,
      },
    ]);

    expect(transaction).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalled();
    expect(calls.getDownloadUrl).toHaveBeenCalledWith('ad-banners/banner.png');

    if (!capturedCondition) {
      throw new Error('expected a banner query condition');
    }
    const query = new PgDialect().sqlToQuery(capturedCondition);
    expect(query.params).toEqual(
      expect.arrayContaining(['all_users', 'drivers']),
    );
    expect(query.params).not.toContain('riders');
  });

  it('lists all non-deleted banners for admins newest first', async () => {
    const inactiveBanner = {
      ...bannerRow,
      isActive: false,
      endsAt: new Date('2025-12-31T23:59:59.000Z'),
    } satisfies AdBanner;
    const orderBy = jest.fn().mockResolvedValue([inactiveBanner]);
    const where = jest.fn().mockReturnValue({ orderBy });
    const from = jest.fn().mockReturnValue({ where });
    const tx = {
      select: jest.fn().mockReturnValue({ from }),
    };
    const { db, transaction } = createTransactionalDb(tx);
    const { storage, calls } = createStorage();
    const service = new AdBannersService(db, storage);

    await expect(service.listBannersForAdmin()).resolves.toEqual([
      {
        id: 'banner-1',
        title: 'Promo',
        imageUrl: 'https://download.ubel.test/banner.png',
        linkUrl: 'https://ubel.test/promo',
        audience: 'all_users',
        sortOrder: 2,
        isActive: false,
        startsAt: inactiveBanner.startsAt,
        endsAt: inactiveBanner.endsAt,
        createdAt: inactiveBanner.createdAt,
        updatedAt: inactiveBanner.updatedAt,
      },
    ]);

    expect(transaction).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
    expect(orderBy).toHaveBeenCalled();
    expect(calls.getDownloadUrl).toHaveBeenCalledWith('ad-banners/banner.png');
  });

  it('creates a banner from a valid image key in a transaction', async () => {
    const startsAt = new Date('2026-01-01T00:00:00.000Z');
    const endsAt = new Date('2026-01-31T23:59:59.000Z');
    const returning = jest.fn().mockResolvedValue([bannerRow]);
    const values = jest.fn().mockReturnValue({ returning });
    const insert = jest.fn().mockReturnValue({ values });
    const { db, transaction } = createTransactionalDb({ insert });
    const { storage } = createStorage();
    const service = new AdBannersService(db, storage);

    await expect(
      service.createBanner({
        imageKey: 'ad-banners/banner.png',
        title: 'Promo',
        linkUrl: 'https://ubel.test/promo',
        audience: 'drivers',
        sortOrder: 2,
        startsAt,
        endsAt,
      }),
    ).resolves.toMatchObject({
      id: 'banner-1',
      imageUrl: 'https://download.ubel.test/banner.png',
      isActive: true,
      startsAt,
      endsAt,
    });

    expect(transaction).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith({
      imageKey: 'ad-banners/banner.png',
      audience: 'drivers',
      title: 'Promo',
      linkUrl: 'https://ubel.test/promo',
      sortOrder: 2,
      startsAt,
      endsAt,
    });
  });

  it('rejects banner image keys outside the ad banner folder', async () => {
    const { storage } = createStorage();
    const service = new AdBannersService({} as Database, storage);

    await expect(
      service.createBanner({
        imageKey: 'profile-images/user/banner.png',
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid banner scheduling windows', async () => {
    const { storage } = createStorage();
    const service = new AdBannersService({} as Database, storage);

    await expect(
      service.createBanner({
        imageKey: 'ad-banners/banner.png',
        sortOrder: 0,
        startsAt: new Date('2026-01-31T00:00:00.000Z'),
        endsAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets banner active status in a transaction', async () => {
    const inactiveBannerRow = {
      ...bannerRow,
      isActive: false,
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    } satisfies AdBanner;
    const returning = jest.fn().mockResolvedValue([inactiveBannerRow]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const { db, transaction } = createTransactionalDb({ update });
    const { storage } = createStorage();
    const service = new AdBannersService(db, storage);

    await expect(
      service.setBannerStatus('banner-1', { isActive: false }),
    ).resolves.toMatchObject({
      id: 'banner-1',
      isActive: false,
      imageUrl: 'https://download.ubel.test/banner.png',
    });

    expect(transaction).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        updatedAt: expect.any(Date) as Date,
      }),
    );
  });

  it('throws when setting status for a missing banner', async () => {
    const returning = jest.fn().mockResolvedValue([]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const { db } = createTransactionalDb({ update });
    const { storage } = createStorage();
    const service = new AdBannersService(db, storage);

    await expect(
      service.setBannerStatus('missing', { isActive: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft deletes an existing banner in a transaction', async () => {
    const returning = jest.fn().mockResolvedValue([{ id: 'banner-1' }]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const { db, transaction } = createTransactionalDb({ update });
    const { storage } = createStorage();
    const service = new AdBannersService(db, storage);

    await expect(service.deleteBanner('banner-1')).resolves.toEqual({
      message: 'ad banner deleted',
    });

    expect(transaction).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        deletedAt: expect.any(Date) as Date,
        updatedAt: expect.any(Date) as Date,
      }),
    );
  });

  it('throws when deleting a missing banner', async () => {
    const returning = jest.fn().mockResolvedValue([]);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const { db } = createTransactionalDb({ update });
    const { storage } = createStorage();
    const service = new AdBannersService(db, storage);

    await expect(service.deleteBanner('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
