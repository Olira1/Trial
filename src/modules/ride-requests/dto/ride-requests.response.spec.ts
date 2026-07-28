import { RideRequestResponseSchema } from './ride-requests.response';

describe('RideRequestResponseSchema', () => {
  it('serializes fare and ride fields on bound ride requests', () => {
    const parsed = RideRequestResponseSchema.parse({
      id: '019eeb33-6aeb-7c85-8884-9debe93dd854',
      riderId: '019eeb33-4b86-78ad-ac4a-608356923108',
      state: 'searching',
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      fareEstimateId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      vehicleType: 'standard',
      rideType: 'instant',
      currency: 'ETB',
      distanceMeters: 1_250,
      durationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
      assignment: null,
      cancellation: null,
      idempotencyKey: 'request-key',
      offerTtlSeconds: 15,
      matchingDeadlineSeconds: 90,
      matchingDeadlineAt: new Date('2026-06-21T12:01:30.000Z'),
      createdAt: new Date('2026-06-21T12:00:00.000Z'),
      updatedAt: new Date('2026-06-21T12:00:00.000Z'),
    });

    expect(parsed).toMatchObject({
      fareEstimateId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      vehicleType: 'standard',
      rideType: 'instant',
      currency: 'ETB',
      estimatedFareMinor: 1_100,
      assignment: null,
    });
    expect(parsed.createdAt).toBe('2026-06-21T12:00:00.000Z');
  });

  it('serializes rider assignment details for assigned ride requests', () => {
    const parsed = RideRequestResponseSchema.parse({
      id: '019eeb33-6aeb-7c85-8884-9debe93dd854',
      riderId: '019eeb33-4b86-78ad-ac4a-608356923108',
      state: 'assigned',
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      fareEstimateId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      vehicleType: 'standard',
      rideType: 'instant',
      currency: 'ETB',
      distanceMeters: 1_250,
      durationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
      assignment: {
        id: '019eeb33-ffff-7aaa-8c97-5164e250ed54',
        offerId: '019eeb33-9c2a-7984-8c97-5164e250ed54',
        requestId: '019eeb33-6aeb-7c85-8884-9debe93dd854',
        riderId: '019eeb33-4b86-78ad-ac4a-608356923108',
        driverId: '019eeb33-f7ed-76aa-9963-ef36f5338ce8',
        state: 'assigned',
        assignedAt: new Date('2026-06-21T12:02:00.000Z'),
        driver: {
          id: '019eeb33-f7ed-76aa-9963-ef36f5338ce8',
          fullName: 'Aster Bekele',
          phone: '+251911111111',
          rating: 5,
        },
        vehicle: {
          make: 'Toyota',
          model: 'Vitz',
          color: 'Blue',
          plateRegion: 'aa',
          plateCode: '03',
          plateCodeSubtype: 'transport_service',
          plateNumber: '12345',
        },
        trip: {
          id: '019eeb34-4a0c-7ac9-8f73-d81b6854f4b7',
          state: 'started',
          startedAt: new Date('2026-06-21T12:05:00.000Z'),
          completedAt: null,
        },
        pickup: null,
      },
      cancellation: null,
      idempotencyKey: 'request-key',
      offerTtlSeconds: 15,
      matchingDeadlineSeconds: 90,
      matchingDeadlineAt: new Date('2026-06-21T12:01:30.000Z'),
      createdAt: new Date('2026-06-21T12:00:00.000Z'),
      updatedAt: new Date('2026-06-21T12:02:00.000Z'),
    });

    expect(parsed.assignment).toMatchObject({
      id: '019eeb33-ffff-7aaa-8c97-5164e250ed54',
      driver: {
        fullName: 'Aster Bekele',
        phone: '+251911111111',
        rating: 5,
      },
      vehicle: {
        make: 'Toyota',
        model: 'Vitz',
        color: 'Blue',
        plateRegion: 'aa',
        plateCode: '03',
        plateCodeSubtype: 'transport_service',
        plateNumber: '12345',
      },
      trip: {
        id: '019eeb34-4a0c-7ac9-8f73-d81b6854f4b7',
        state: 'started',
        startedAt: '2026-06-21T12:05:00.000Z',
        completedAt: null,
      },
    });
    expect(parsed.assignment?.assignedAt).toBe('2026-06-21T12:02:00.000Z');
  });
});
