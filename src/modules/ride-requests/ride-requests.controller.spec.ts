import type { User } from '../user';
import { RideRequestsController } from './ride-requests.controller';
import type { RideRequestsService } from './ride-requests.service';

describe('RideRequestsController', () => {
  it('creates a fare-bound ride request for the authenticated rider', async () => {
    const rider = {
      id: '01976f71-96bf-7da0-ae7d-12fd094a563c',
    } as User;
    const dto = {
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      fareEstimateId: '019eeb33-103a-773a-b475-32acf07fb3d4',
      idempotencyKey: 'request-key',
    };
    const created = { id: '019eeb33-6aeb-7c85-8884-9debe93dd854' };
    const create = jest.fn().mockResolvedValue(created);
    const controller = new RideRequestsController({
      create,
    } as unknown as RideRequestsService);

    await expect(controller.create(rider, {} as never, dto)).resolves.toBe(
      created,
    );
    expect(create).toHaveBeenCalledWith({
      riderId: rider.id,
      ...dto,
    });
  });

  it('gets the authenticated rider current request', async () => {
    const rider = {
      id: '01976f71-96bf-7da0-ae7d-12fd094a563c',
    } as User;
    const findCurrentForRider = jest.fn().mockResolvedValue(null);
    const controller = new RideRequestsController({
      findCurrentForRider,
    } as unknown as RideRequestsService);

    await expect(controller.findCurrent(rider)).resolves.toBeNull();
    expect(findCurrentForRider).toHaveBeenCalledWith(rider.id);
  });

  it('lists bounded history for the authenticated rider', async () => {
    const rider = {
      id: '01976f71-96bf-7da0-ae7d-12fd094a563c',
    } as User;
    const history = {
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    };
    const findHistoryForRider = jest.fn().mockResolvedValue(history);
    const controller = new RideRequestsController({
      findHistoryForRider,
    } as unknown as RideRequestsService);

    await expect(controller.findHistory(rider, {} as never)).resolves.toBe(
      history,
    );
    expect(findHistoryForRider).toHaveBeenCalledWith(rider.id, {});
  });

  it('passes structured cancellation details to rider cancellation', async () => {
    const rider = {
      id: '01976f71-96bf-7da0-ae7d-12fd094a563c',
    } as User;
    const requestId = '019eeb33-6aeb-7c85-8884-9debe93dd854';
    const dto = {
      reasonCode: 'rider_changed_mind' as const,
      notes: 'Plans changed',
    };
    const cancelled = { id: requestId, state: 'cancelled' };
    const cancel = jest.fn().mockResolvedValue(cancelled);
    const controller = new RideRequestsController({
      cancel,
    } as unknown as RideRequestsService);

    await expect(controller.cancel(rider, requestId, dto)).resolves.toBe(
      cancelled,
    );
    expect(cancel).toHaveBeenCalledWith(rider.id, requestId, dto);
  });
});
