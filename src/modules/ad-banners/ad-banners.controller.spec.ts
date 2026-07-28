import { AdBannersController } from './ad-banners.controller';
import type { AdBannersService } from './ad-banners.service';
import { AdminAdBannersController } from './admin-ad-banners.controller';

describe('ad banner controllers', () => {
  it('exposes active banners for the mobile app', async () => {
    const items = [
      {
        id: 'banner-1',
        title: null,
        imageUrl: 'https://download.ubel.test/banner.png',
        linkUrl: null,
        audience: 'all_users' as const,
        sortOrder: 0,
        isActive: true,
        startsAt: null,
        endsAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    const listActiveBanners = jest.fn().mockResolvedValue(items);
    const controller = new AdBannersController({
      listActiveBanners,
    } as unknown as AdBannersService);

    await expect(
      controller.listActiveBanners({ roles: ['driver'] } as never),
    ).resolves.toBe(items);
    expect(listActiveBanners).toHaveBeenCalledWith(['driver']);
  });

  it('creates and deletes banners through the admin controller', async () => {
    const created = {
      id: 'banner-1',
      title: 'Promo',
      imageUrl: 'https://download.ubel.test/banner.png',
      linkUrl: null,
      audience: 'drivers' as const,
      sortOrder: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const createBanner = jest.fn().mockResolvedValue(created);
    const setBannerStatus = jest.fn().mockResolvedValue({
      ...created,
      isActive: false,
    });
    const deleteBanner = jest.fn().mockResolvedValue({
      message: 'ad banner deleted',
    });
    const controller = new AdminAdBannersController({
      createBanner,
      setBannerStatus,
      deleteBanner,
    } as unknown as AdBannersService);

    await expect(
      controller.createBanner({
        imageKey: 'ad-banners/banner.png',
        audience: 'drivers',
        title: 'Promo',
        sortOrder: 0,
      }),
    ).resolves.toBe(created);
    await expect(
      controller.setBannerStatus('banner-1', { isActive: false }),
    ).resolves.toEqual({
      ...created,
      isActive: false,
    });
    await expect(controller.deleteBanner('banner-1')).resolves.toEqual({
      message: 'ad banner deleted',
    });

    expect(createBanner).toHaveBeenCalledWith({
      imageKey: 'ad-banners/banner.png',
      audience: 'drivers',
      title: 'Promo',
      sortOrder: 0,
    });
    expect(setBannerStatus).toHaveBeenCalledWith('banner-1', {
      isActive: false,
    });
    expect(deleteBanner).toHaveBeenCalledWith('banner-1');
  });

  it('exposes all non-deleted banners through the admin controller', async () => {
    const items = [
      {
        id: 'banner-1',
        title: 'Promo',
        imageUrl: 'https://download.ubel.test/banner.png',
        linkUrl: null,
        audience: 'riders' as const,
        sortOrder: 0,
        isActive: false,
        startsAt: null,
        endsAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    const listBannersForAdmin = jest.fn().mockResolvedValue(items);
    const controller = new AdminAdBannersController({
      listBannersForAdmin,
    } as unknown as AdBannersService);

    await expect(controller.listBanners()).resolves.toBe(items);
    expect(listBannersForAdmin).toHaveBeenCalled();
  });
});
