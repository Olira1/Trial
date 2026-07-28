import { FareEstimateResponseSchema } from './fare-estimates.response';

describe('FareEstimateResponseSchema', () => {
  it('serializes public fare estimate fields only', () => {
    const parsed = FareEstimateResponseSchema.parse({
      id: '019ee375-7bd7-70d8-9bb4-3dc3ed66c004',
      riderId: '019ee375-4377-7cd6-8adc-c721849a520f',
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      vehicleType: 'standard',
      currency: 'ETB',
      distanceMeters: 1_250,
      durationSeconds: 180,
      rateMinorPerKm: 900,
      estimatedFareMinor: 1_100,
      expiresAt: new Date('2026-06-21T12:05:00.000Z'),
      createdAt: new Date('2026-06-21T12:00:00.000Z'),
    });

    expect(parsed).not.toHaveProperty('riderId');
    expect(parsed.expiresAt).toBe('2026-06-21T12:05:00.000Z');
    expect(parsed.createdAt).toBe('2026-06-21T12:00:00.000Z');
  });
});
