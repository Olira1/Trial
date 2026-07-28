import { DocumentResponseSchema } from './driver.response';

describe('driver response DTOs', () => {
  it('serializes document review state for uploaded documents', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    expect(
      DocumentResponseSchema.parse({
        id: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        documentType: 'driver_license_front',
        storageKey: 'documents/user-1/driver_license_front/license.jpg',
        url: 'https://download.ubel.test/license.jpg',
        reviewStatus: 'pending',
        reviewedAt: null,
        reviewReason: null,
        expiresAt: null,
        revokedAt: null,
        createdAt,
      }),
    ).toEqual({
      id: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
      documentType: 'driver_license_front',
      storageKey: 'documents/user-1/driver_license_front/license.jpg',
      url: 'https://download.ubel.test/license.jpg',
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewReason: null,
      expiresAt: null,
      revokedAt: null,
      createdAt,
    });
  });
});
