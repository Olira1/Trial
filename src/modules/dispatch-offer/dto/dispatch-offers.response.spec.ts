import {
  CurrentDispatchOfferResponseSchema,
  DispatchOfferResponseSchema,
} from './dispatch-offers.response';

const offer = {
  id: '01976f70-185f-7ef3-a558-074223fe6064',
  requestId: '01976f71-96bf-7da0-ae7d-12fd094a563c',
  attemptId: '01976f72-6075-78d4-bbdc-e3923ed4245d',
  driverId: '01976f6f-a9f8-7ad2-bf4b-e95429910c1e',
  state: 'pending' as const,
  etaSeconds: 180,
  distanceMeters: 1_250,
  expiresAt: new Date('2026-06-19T12:00:15.000Z'),
  offeredAt: new Date('2026-06-19T12:00:00.000Z'),
  respondedAt: null,
  createdAt: new Date('2026-06-19T12:00:00.000Z'),
  updatedAt: new Date('2026-06-19T12:00:00.000Z'),
};

describe('dispatch offer response schemas', () => {
  it('strips internal attempt identity from command responses', () => {
    const result = DispatchOfferResponseSchema.parse(offer);

    expect(result).not.toHaveProperty('attemptId');
    expect(result.expiresAt).toBe('2026-06-19T12:00:15.000Z');
  });

  it('includes route endpoints in current-offer responses', () => {
    const result = CurrentDispatchOfferResponseSchema.parse({
      ...offer,
      assignmentId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      fareEstimateId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      vehicleType: 'standard',
      rideType: 'instant',
      currency: 'ETB',
      tripDistanceMeters: 1_250,
      tripDurationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
    });

    expect(result.pickup).toEqual({
      latitude: 9.0192,
      longitude: 38.7525,
    });
    expect(result.destination).toEqual({
      latitude: 9.0301,
      longitude: 38.7612,
    });
    expect(result).toMatchObject({
      assignmentId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      fareEstimateId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      vehicleType: 'standard',
      rideType: 'instant',
      currency: 'ETB',
      tripDistanceMeters: 1_250,
      tripDurationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
    });
  });
});
