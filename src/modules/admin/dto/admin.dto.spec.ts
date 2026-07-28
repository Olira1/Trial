import {
  ApproveDocumentDto,
  ApproveLicenseDto,
  ApproveVehicleDto,
  ListAdminDriversDto,
  ListAdminNotificationsDto,
  ListAdminRidersDto,
  RejectDocumentDto,
  RejectLicenseDto,
  RejectVehicleDto,
  RevokeDocumentDto,
  RevokeLicenseDto,
  RevokeVehicleDto,
  SendCategoryNotificationDto,
  SendUserNotificationDto,
} from './admin.dto';

describe('admin request DTOs', () => {
  it('accepts user notification input', () => {
    expect(
      SendUserNotificationDto.schema.parse({
        title: ' Ubel update ',
        body: ' You have a new update. ',
      }),
    ).toEqual({
      title: 'Ubel update',
      body: 'You have a new update.',
    });
  });

  it('rejects empty notification copy', () => {
    expect(() =>
      SendUserNotificationDto.schema.parse({
        title: '',
        body: '',
      }),
    ).toThrow();
  });

  it('accepts category notification input', () => {
    expect(
      SendCategoryNotificationDto.schema.parse({
        category: 'all_users',
        title: ' Ubel update ',
        body: ' You have a new update. ',
      }),
    ).toEqual({
      category: 'all_users',
      title: 'Ubel update',
      body: 'You have a new update.',
    });
  });

  it('accepts every notification category', () => {
    for (const category of [
      'all_users',
      'drivers',
      'riders',
      'verified_users_only',
    ]) {
      expect(
        SendCategoryNotificationDto.schema.parse({
          category,
          title: 'Ubel update',
          body: 'You have a new update.',
        }),
      ).toEqual({
        category,
        title: 'Ubel update',
        body: 'You have a new update.',
      });
    }
  });

  it('rejects invalid notification category input', () => {
    expect(() =>
      SendCategoryNotificationDto.schema.parse({
        category: 'admins',
        title: 'Ubel update',
        body: 'You have a new update.',
      }),
    ).toThrow();
  });

  it('accepts admin driver list query input with defaults', () => {
    expect(ListAdminDriversDto.schema.parse({})).toEqual({
      status: 'all',
      limit: 50,
      offset: 0,
    });
  });

  it('accepts admin rider list query input with defaults', () => {
    expect(ListAdminRidersDto.schema.parse({})).toEqual({
      status: 'all',
      limit: 50,
      offset: 0,
    });
  });

  it('accepts admin notification list query input with defaults', () => {
    expect(ListAdminNotificationsDto.schema.parse({})).toEqual({
      limit: 50,
      offset: 0,
    });

    expect(
      ListAdminNotificationsDto.schema.parse({
        limit: '25',
        offset: '50',
      }),
    ).toEqual({
      limit: 25,
      offset: 50,
    });
  });

  it('rejects invalid admin notification pagination input', () => {
    expect(() =>
      ListAdminNotificationsDto.schema.parse({ limit: '101' }),
    ).toThrow();
    expect(() =>
      ListAdminNotificationsDto.schema.parse({ offset: '-1' }),
    ).toThrow();
  });

  it('coerces admin driver list pagination query strings', () => {
    expect(
      ListAdminDriversDto.schema.parse({
        status: 'inactive',
        limit: '25',
        offset: '50',
      }),
    ).toEqual({
      status: 'inactive',
      limit: 25,
      offset: 50,
    });
  });

  it('coerces admin rider list pagination query strings', () => {
    expect(
      ListAdminRidersDto.schema.parse({
        status: 'inactive',
        limit: '25',
        offset: '50',
      }),
    ).toEqual({
      status: 'inactive',
      limit: 25,
      offset: 50,
    });
  });

  it('rejects invalid admin driver list query input', () => {
    expect(() =>
      ListAdminDriversDto.schema.parse({
        status: 'deleted',
      }),
    ).toThrow();

    expect(() =>
      ListAdminDriversDto.schema.parse({
        limit: '101',
      }),
    ).toThrow();

    expect(() =>
      ListAdminDriversDto.schema.parse({
        offset: '-1',
      }),
    ).toThrow();
  });

  it('rejects invalid admin rider list query input', () => {
    expect(() =>
      ListAdminRidersDto.schema.parse({
        status: 'deleted',
      }),
    ).toThrow();

    expect(() =>
      ListAdminRidersDto.schema.parse({
        limit: '101',
      }),
    ).toThrow();

    expect(() =>
      ListAdminRidersDto.schema.parse({
        offset: '-1',
      }),
    ).toThrow();
  });

  it('accepts document approval input with an optional expiry', () => {
    expect(
      ApproveDocumentDto.schema.parse({
        reason: ' Meets requirements ',
        expiresAt: '2026-12-31T00:00:00.000Z',
      }),
    ).toEqual({
      reason: 'Meets requirements',
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });

    expect(
      ApproveDocumentDto.schema.parse({
        reason: ' Meets requirements ',
      }),
    ).toEqual({
      reason: 'Meets requirements',
      expiresAt: null,
    });
  });

  it('accepts document rejection and revocation reasons', () => {
    expect(
      RejectDocumentDto.schema.parse({
        reason: ' Image is not readable ',
      }),
    ).toEqual({ reason: 'Image is not readable' });

    expect(
      RevokeDocumentDto.schema.parse({
        reason: ' Document was withdrawn ',
      }),
    ).toEqual({ reason: 'Document was withdrawn' });
  });

  it('rejects empty document review reasons', () => {
    expect(() => ApproveDocumentDto.schema.parse({ reason: '' })).toThrow();
    expect(() => RejectDocumentDto.schema.parse({ reason: '' })).toThrow();
    expect(() => RevokeDocumentDto.schema.parse({ reason: '' })).toThrow();
  });

  it('accepts license approval metadata', () => {
    expect(
      ApproveLicenseDto.schema.parse({
        reason: ' License verified ',
        licenseNumber: '  ETH-123456 ',
        issuedBy: 'oromia',
        licenseType: 'T1',
        expiresAt: '2026-12-31T00:00:00.000Z',
      }),
    ).toEqual({
      reason: 'License verified',
      licenseNumber: 'ETH-123456',
      issuedBy: 'oromia',
      licenseType: 'T1',
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });

    expect(() =>
      ApproveLicenseDto.schema.parse({
        reason: 'License verified',
        licenseNumber: ' ',
        issuedBy: 'oromia',
        licenseType: 'T1',
        expiresAt: '2026-12-31T00:00:00.000Z',
      }),
    ).toThrow();

    expect(
      RejectLicenseDto.schema.parse({
        reason: ' unreadable document ',
      }),
    ).toEqual({ reason: 'unreadable document' });

    expect(
      RevokeLicenseDto.schema.parse({
        reason: ' license expired ',
      }),
    ).toEqual({ reason: 'license expired' });
  });

  it('accepts vehicle review reasons with qualifications', () => {
    expect(
      ApproveVehicleDto.schema.parse({
        reason: ' Vehicle meets requirements ',
        tinNumber: ' TIN-001 ',
        qualifications: ['standard', 'comfort'],
      }),
    ).toEqual({
      reason: 'Vehicle meets requirements',
      tinNumber: 'TIN-001',
      qualifications: ['standard', 'comfort'],
    });

    expect(
      RejectVehicleDto.schema.parse({
        reason: ' Registration mismatch ',
      }),
    ).toEqual({ reason: 'Registration mismatch' });

    expect(
      RevokeVehicleDto.schema.parse({
        reason: ' Vehicle qualification revoked ',
      }),
    ).toEqual({ reason: 'Vehicle qualification revoked' });
  });

  it('rejects empty vehicle review reasons', () => {
    expect(() => ApproveVehicleDto.schema.parse({ reason: '' })).toThrow();
    expect(() => RejectVehicleDto.schema.parse({ reason: '' })).toThrow();
    expect(() => RevokeVehicleDto.schema.parse({ reason: '' })).toThrow();
  });

  it('rejects duplicate or oversized vehicle qualification selections', () => {
    expect(() =>
      ApproveVehicleDto.schema.parse({
        reason: 'Vehicle meets requirements',
        tinNumber: 'TIN-001',
        qualifications: ['standard', 'standard'],
      }),
    ).toThrow();

    expect(() =>
      ApproveVehicleDto.schema.parse({
        reason: 'Vehicle meets requirements',
        tinNumber: 'TIN-001',
        qualifications: ['standard', 'comfort', 'ev', 'minibus', 'standard'],
      }),
    ).toThrow();
  });
});
