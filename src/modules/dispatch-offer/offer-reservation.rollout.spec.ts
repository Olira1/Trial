import { OfferReservationService } from './offer-reservation.service';

describe('OfferReservationService rollout controls', () => {
  it('skips reservation before lease lookup when the driver is outside the internal rollout allowlist', async () => {
    const leaseService = {
      findCurrentLeaseByUserId: jest.fn(),
    };
    const service = new OfferReservationService(
      {
        transaction: jest.fn(),
      } as never,
      {
        internalDriverAllowlist: ['driver-allowed'],
      } as never,
      {} as never,
      {} as never,
      leaseService as never,
      {} as never,
    );

    await expect(
      service.tryReserve('request-1', 'attempt-1', {
        driverId: 'driver-blocked',
        etaSeconds: 90,
        distanceMeters: 1_000,
      }),
    ).resolves.toEqual({ status: 'lost_race' });
    expect(leaseService.findCurrentLeaseByUserId).not.toHaveBeenCalled();
  });
});
