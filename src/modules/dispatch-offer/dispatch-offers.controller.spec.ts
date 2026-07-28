import type { User } from '../user';
import { DispatchOffersController } from './dispatch-offers.controller';
import type { DispatchOffersService } from './dispatch-offers.service';
import type { OfferAcceptanceService } from './offer-acceptance.service';
import type { OfferRejectionService } from './offer-rejection.service';

describe('DispatchOffersController', () => {
  const driver = { id: '01976f6f-a9f8-7ad2-bf4b-e95429910c1e' } as User;
  const offerId = '01976f70-185f-7ef3-a558-074223fe6064';

  const createController = () => {
    const findCurrentForDriver = jest.fn();
    const findOfferByIdForDriver = jest.fn();
    const accept = jest.fn();
    const reject = jest.fn();
    const controller = new DispatchOffersController(
      {
        findCurrentForDriver,
        findOfferByIdForDriver,
      } as unknown as DispatchOffersService,
      { accept } as unknown as OfferAcceptanceService,
      { reject } as unknown as OfferRejectionService,
    );

    return {
      controller,
      findCurrentForDriver,
      findOfferByIdForDriver,
      accept,
      reject,
    };
  };

  it('gets the authenticated driver current offer', async () => {
    const { controller, findCurrentForDriver } = createController();
    findCurrentForDriver.mockResolvedValue(null);

    await expect(controller.findCurrent(driver)).resolves.toBeNull();
    expect(findCurrentForDriver).toHaveBeenCalledWith(driver.id);
  });

  it('gets an authenticated driver owned offer by id', async () => {
    const { controller, findOfferByIdForDriver } = createController();
    const offer = { id: offerId, state: 'rejected' };
    findOfferByIdForDriver.mockResolvedValue(offer);

    await expect(controller.findById(driver, offerId)).resolves.toBe(offer);
    expect(findOfferByIdForDriver).toHaveBeenCalledWith(driver.id, offerId);
  });

  it('accepts the authenticated driver offer', async () => {
    const { controller, accept } = createController();
    const offer = { id: offerId, state: 'accepted' };
    accept.mockResolvedValue(offer);

    await expect(controller.accept(driver, offerId)).resolves.toBe(offer);
    expect(accept).toHaveBeenCalledWith(driver.id, offerId);
  });

  it('rejects the authenticated driver offer', async () => {
    const { controller, reject } = createController();
    const offer = { id: offerId, state: 'rejected' };
    reject.mockResolvedValue(offer);

    await expect(controller.reject(driver, offerId)).resolves.toBe(offer);
    expect(reject).toHaveBeenCalledWith(driver.id, offerId);
  });
});
