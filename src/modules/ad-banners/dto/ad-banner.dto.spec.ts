import {
  AdBannerUploadUrlDto,
  CreateAdBannerDto,
  SetAdBannerStatusDto,
} from './ad-banner.dto';

describe('ad banner DTOs', () => {
  it('accepts image upload-url input', () => {
    expect(
      AdBannerUploadUrlDto.schema.parse({
        mimeType: 'image/png',
        originalName: 'banner.png',
        sizeBytes: 1024,
      }),
    ).toEqual({
      mimeType: 'image/png',
      originalName: 'banner.png',
      sizeBytes: 1024,
    });
  });

  it('rejects non-image upload-url input', () => {
    expect(() =>
      AdBannerUploadUrlDto.schema.parse({
        mimeType: 'application/pdf',
        originalName: 'banner.pdf',
        sizeBytes: 1024,
      }),
    ).toThrow();
  });

  it('accepts banner creation input with defaults', () => {
    expect(
      CreateAdBannerDto.schema.parse({
        imageKey: 'ad-banners/banner.png',
      }),
    ).toEqual({
      imageKey: 'ad-banners/banner.png',
      audience: 'all_users',
      sortOrder: 0,
    });
  });

  it('accepts rider and driver banner audiences', () => {
    for (const audience of ['riders', 'drivers']) {
      expect(
        CreateAdBannerDto.schema.parse({
          imageKey: 'ad-banners/banner.png',
          audience,
        }),
      ).toMatchObject({ audience });
    }
  });

  it('accepts nullable banner scheduling bounds', () => {
    expect(
      CreateAdBannerDto.schema.parse({
        imageKey: 'ad-banners/banner.png',
        startsAt: null,
        endsAt: null,
      }),
    ).toEqual({
      imageKey: 'ad-banners/banner.png',
      audience: 'all_users',
      startsAt: null,
      endsAt: null,
      sortOrder: 0,
    });
  });

  it('accepts valid ISO banner scheduling bounds', () => {
    expect(
      CreateAdBannerDto.schema.parse({
        imageKey: 'ad-banners/banner.png',
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-31T23:59:59.000Z',
      }),
    ).toEqual({
      imageKey: 'ad-banners/banner.png',
      audience: 'all_users',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-01-31T23:59:59.000Z'),
      sortOrder: 0,
    });
  });

  it('rejects invalid banner creation input', () => {
    expect(() =>
      CreateAdBannerDto.schema.parse({
        imageKey: '',
      }),
    ).toThrow();

    expect(() =>
      CreateAdBannerDto.schema.parse({
        imageKey: 'ad-banners/banner.png',
        linkUrl: 'not-a-url',
      }),
    ).toThrow();

    expect(() =>
      CreateAdBannerDto.schema.parse({
        imageKey: 'ad-banners/banner.png',
        startsAt: 'not-a-date',
      }),
    ).toThrow();

    expect(() =>
      CreateAdBannerDto.schema.parse({
        imageKey: 'ad-banners/banner.png',
        startsAt: '2026-01-31T23:59:59.000Z',
        endsAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts explicit banner status updates', () => {
    expect(SetAdBannerStatusDto.schema.parse({ isActive: false })).toEqual({
      isActive: false,
    });

    expect(() => SetAdBannerStatusDto.schema.parse({})).toThrow();
  });
});
