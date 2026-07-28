import { DispatchAssignmentTripResponseSchema } from './dispatch-assignment-trip.response';

describe('DispatchAssignmentTripResponseSchema', () => {
  it('serializes enriched started trip responses', () => {
    const parsed = DispatchAssignmentTripResponseSchema.parse({
      id: '019f1565-3de5-76cc-bf2d-32690bd9cd6d',
      assignmentId: '019f1565-3ddf-7e7c-8f71-c04ec67f500e',
      requestId: '019f1565-3dda-7b96-aed1-45fba56a0a68',
      offerId: '019f1565-3ddd-760f-b7b8-1af86d35334b',
      riderId: '019f1565-3dd4-769f-9a89-a39b9fc7a933',
      driverId: '019f1565-3dd8-7ff6-8e18-58824b42283f',
      state: 'started',
      startedAt: new Date('2026-06-21T12:04:00.000Z'),
      completedAt: null,
      createdAt: new Date('2026-06-21T12:04:00.000Z'),
      updatedAt: new Date('2026-06-21T12:04:00.000Z'),
      rider: {
        id: '019f1565-3dd4-769f-9a89-a39b9fc7a933',
        fullName: 'Ride Rider',
        phone: '+251911000555',
        rating: 5,
      },
      pickup: {
        latitude: 9.0192,
        longitude: 38.7525,
      },
      destination: {
        latitude: 9.0301,
        longitude: 38.7612,
      },
      completion: null,
    });

    expect(parsed).toMatchObject({
      state: 'started',
      startedAt: '2026-06-21T12:04:00.000Z',
      rider: {
        fullName: 'Ride Rider',
        phone: '+251911000555',
        rating: 5,
      },
      completion: null,
    });
  });

  it('serializes completion totals for completed trip responses', () => {
    const parsed = DispatchAssignmentTripResponseSchema.parse({
      id: '019f1565-3de5-76cc-bf2d-32690bd9cd6d',
      assignmentId: '019f1565-3ddf-7e7c-8f71-c04ec67f500e',
      requestId: '019f1565-3dda-7b96-aed1-45fba56a0a68',
      offerId: '019f1565-3ddd-760f-b7b8-1af86d35334b',
      riderId: '019f1565-3dd4-769f-9a89-a39b9fc7a933',
      driverId: '019f1565-3dd8-7ff6-8e18-58824b42283f',
      state: 'completed',
      startedAt: new Date('2026-06-21T12:04:00.000Z'),
      completedAt: new Date('2026-06-21T12:18:30.000Z'),
      createdAt: new Date('2026-06-21T12:04:00.000Z'),
      updatedAt: new Date('2026-06-21T12:18:30.000Z'),
      rider: {
        id: '019f1565-3dd4-769f-9a89-a39b9fc7a933',
        fullName: 'Ride Rider',
        phone: '+251911000555',
        rating: 5,
      },
      pickup: {
        latitude: 9.0192,
        longitude: 38.7525,
      },
      destination: {
        latitude: 9.0301,
        longitude: 38.7612,
      },
      completion: {
        totalPriceMinor: 3_889,
        currency: 'ETB',
        totalDistanceMeters: 4_321,
        totalTimeTakenSeconds: 870,
      },
    });

    expect(parsed).toMatchObject({
      state: 'completed',
      completedAt: '2026-06-21T12:18:30.000Z',
      completion: {
        totalPriceMinor: 3_889,
        currency: 'ETB',
        totalDistanceMeters: 4_321,
        totalTimeTakenSeconds: 870,
      },
    });
  });
});
