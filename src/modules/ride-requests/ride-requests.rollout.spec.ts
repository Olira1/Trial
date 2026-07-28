import { ConflictException } from '@nestjs/common';
import { RideRequestsService } from './ride-requests.service';

describe('RideRequestsService rollout controls', () => {
  it('rejects new request creation when the rollout flag is disabled', async () => {
    const service = new RideRequestsService(
      {
        transaction: jest.fn(),
      } as never,
      {
        enableNewRequests: false,
        internalRiderAllowlist: [],
        rolloutPickupBounds: null,
        rolloutHours: null,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create({
        riderId: 'rider-1',
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: '019eeb34-c66b-7790-b90e-f0f3d8e6201e',
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow(
      new ConflictException('instant ride request creation is disabled'),
    );
  });

  it('rejects new request creation when the rider is outside the internal rollout allowlist', async () => {
    const service = new RideRequestsService(
      {
        transaction: jest.fn(),
      } as never,
      {
        enableNewRequests: true,
        internalRiderAllowlist: ['rider-allowed'],
        rolloutPickupBounds: null,
        rolloutHours: null,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create({
        riderId: 'rider-blocked',
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: '019eeb34-c66b-7790-b90e-f0f3d8e6201e',
        idempotencyKey: 'idem-2',
      }),
    ).rejects.toThrow(
      new ConflictException(
        'instant ride request creation is not enabled for this rider',
      ),
    );
  });

  it('rejects new request creation when the pickup is outside the rollout area', async () => {
    const service = new RideRequestsService(
      {
        transaction: jest.fn(),
      } as never,
      {
        enableNewRequests: true,
        internalRiderAllowlist: [],
        rolloutPickupBounds: {
          minLatitude: 8.9,
          maxLatitude: 9.1,
          minLongitude: 38.7,
          maxLongitude: 38.9,
        },
        rolloutHours: null,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create({
        riderId: 'rider-1',
        pickup: { latitude: 9.5, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: '019eeb34-c66b-7790-b90e-f0f3d8e6201e',
        idempotencyKey: 'idem-3',
      }),
    ).rejects.toThrow(
      new ConflictException(
        'instant ride request creation is not enabled for this pickup area',
      ),
    );
  });

  it('rejects new request creation when the current time is outside rollout hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-19T03:30:00.000Z'));

    const service = new RideRequestsService(
      {
        transaction: jest.fn(),
      } as never,
      {
        enableNewRequests: true,
        internalRiderAllowlist: [],
        rolloutPickupBounds: null,
        rolloutHours: {
          startHourLocal: 9,
          endHourLocal: 18,
          timezone: 'Africa/Addis_Ababa',
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create({
        riderId: 'rider-1',
        pickup: { latitude: 9.0192, longitude: 38.7525 },
        destination: { latitude: 9.0301, longitude: 38.7612 },
        fareEstimateId: '019eeb34-c66b-7790-b90e-f0f3d8e6201e',
        idempotencyKey: 'idem-4',
      }),
    ).rejects.toThrow(
      new ConflictException(
        'instant ride request creation is not enabled at this time',
      ),
    );

    jest.useRealTimers();
  });
});
