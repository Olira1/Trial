import {
  AdminDriverListResponseSchema,
  AdminDispatchDriverInspectionResponseSchema,
  AdminDispatchOfferInspectionResponseSchema,
  AdminDispatchRequestInspectionResponseSchema,
} from './admin.response';

describe('admin response schemas', () => {
  it('accepts driver management list items with qualification statuses', () => {
    const parsed = AdminDriverListResponseSchema.parse({
      items: [
        {
          id: '019eddfd-0000-7000-8000-000000000000',
          fullName: 'Driver Applicant',
          email: 'driver@ubel.test',
          phone: '+251911000010',
          gender: 'female',
          profilePicture: 'https://cdn.ubel.test/driver.png',
          vehicle: {
            make: 'Toyota',
            model: 'Vitz',
            color: 'white',
            year: 2022,
            plateNumber: 'AA-01-1234',
            isApproved: false,
          },
          rating: 5,
          trips: 0,
          wallet: 0,
          driverApplicationStatus: 'incomplete',
          submittedAt: new Date('2026-01-01T00:00:00.000Z'),
          licenseStatus: 'partial',
          vehicleDocumentsStatus: 'pending',
          documents: [
            {
              id: '019eddfd-1000-7000-8000-000000000000',
              documentType: 'driver_license_front',
              url: 'https://cdn.ubel.test/license-front.jpg',
              reviewStatus: 'pending',
              reviewedAt: null,
              reviewReason: null,
              expiresAt: null,
              revokedAt: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
          status: 'active',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    expect(parsed.items[0]).toMatchObject({
      driverApplicationStatus: 'incomplete',
      gender: 'female',
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      licenseStatus: 'partial',
      vehicleDocumentsStatus: 'pending',
      vehicle: {
        make: 'Toyota',
        model: 'Vitz',
        color: 'white',
        year: 2022,
        plateNumber: 'AA-01-1234',
        isApproved: false,
      },
      documents: [
        expect.objectContaining({
          documentType: 'driver_license_front',
          url: 'https://cdn.ubel.test/license-front.jpg',
        }),
      ],
    });
  });

  it('strips idempotency keys and presence session authority from dispatch request inspection responses', () => {
    const now = new Date('2026-06-19T00:00:00.000Z');

    const parsed = AdminDispatchRequestInspectionResponseSchema.parse({
      request: {
        id: '019eddfd-1111-7111-8111-111111111111',
        riderId: '019eddfd-2222-7222-8222-222222222222',
        state: 'offered',
        idempotencyKey: 'sensitive-idempotency-key',
        offerTtlSeconds: 15,
        matchingDeadlineSeconds: 90,
        matchingDeadlineAt: now,
        createdAt: now,
        updatedAt: now,
        pickup: 'hidden',
        destination: 'hidden',
      },
      attempts: [
        {
          id: '019eddfd-3333-7333-8333-333333333333',
          requestId: '019eddfd-1111-7111-8111-111111111111',
          attemptNumber: 1,
          state: 'in_progress',
          startedAt: now,
          finishedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      offers: [
        {
          id: '019eddfd-4444-7444-8444-444444444444',
          requestId: '019eddfd-1111-7111-8111-111111111111',
          attemptId: '019eddfd-3333-7333-8333-333333333333',
          driverId: '019eddfd-5555-7555-8555-555555555555',
          state: 'pending',
          offeredAt: now,
          expiresAt: now,
          respondedAt: null,
          etaSeconds: 120,
          distanceMeters: 1500,
          createdAt: now,
          updatedAt: now,
        },
      ],
      driverProfiles: [
        {
          id: '019eddfd-6666-7666-8666-666666666666',
          userId: '019eddfd-5555-7555-8555-555555555555',
          operationalState: 'offered',
          ownerSessionId: '019eddfd-7777-7777-8777-777777777777',
          presenceSessionId: 'sensitive-presence-session',
          presenceGeneration: 4,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    expect(parsed.request).not.toHaveProperty('idempotencyKey');
    expect(parsed.request).not.toHaveProperty('pickup');
    expect(parsed.request).not.toHaveProperty('destination');
    expect(parsed.driverProfiles[0]).not.toHaveProperty('ownerSessionId');
    expect(parsed.driverProfiles[0]).not.toHaveProperty('presenceSessionId');
  });

  it('strips session authority from dispatch offer inspection responses', () => {
    const now = new Date('2026-06-19T00:00:00.000Z');

    const parsed = AdminDispatchOfferInspectionResponseSchema.parse({
      offer: {
        id: '019eddfd-4444-7444-8444-444444444444',
        requestId: '019eddfd-1111-7111-8111-111111111111',
        attemptId: '019eddfd-3333-7333-8333-333333333333',
        driverId: '019eddfd-5555-7555-8555-555555555555',
        state: 'pending',
        offeredAt: now,
        expiresAt: now,
        respondedAt: null,
        etaSeconds: 120,
        distanceMeters: 1500,
        createdAt: now,
        updatedAt: now,
      },
      request: null,
      attempt: null,
      driverProfile: {
        id: '019eddfd-6666-7666-8666-666666666666',
        userId: '019eddfd-5555-7555-8555-555555555555',
        operationalState: 'offered',
        ownerSessionId: '019eddfd-7777-7777-8777-777777777777',
        presenceSessionId: 'sensitive-presence-session',
        presenceGeneration: 4,
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(parsed.driverProfile).not.toHaveProperty('ownerSessionId');
    expect(parsed.driverProfile).not.toHaveProperty('presenceSessionId');
  });

  it('strips session authority from dispatch driver inspection responses', () => {
    const now = new Date('2026-06-19T00:00:00.000Z');

    const parsed = AdminDispatchDriverInspectionResponseSchema.parse({
      driverProfile: {
        id: '019eddfd-6666-7666-8666-666666666666',
        userId: '019eddfd-5555-7555-8555-555555555555',
        operationalState: 'online',
        ownerSessionId: '019eddfd-7777-7777-8777-777777777777',
        presenceSessionId: 'sensitive-presence-session',
        presenceGeneration: 4,
        createdAt: now,
        updatedAt: now,
      },
      offers: [],
      requests: [],
    });

    expect(parsed.driverProfile).not.toHaveProperty('ownerSessionId');
    expect(parsed.driverProfile).not.toHaveProperty('presenceSessionId');
  });
});
