import type { User } from '../user';
import { FareEstimatesController } from './fare-estimates.controller';
import type { FareEstimatesService } from './fare-estimates.service';

describe('FareEstimatesController', () => {
  it('creates a fare estimate for the authenticated rider', async () => {
    const rider = {
      id: '019ee375-4377-7cd6-8adc-c721849a520f',
    } as User;
    const input = {
      pickup: { latitude: 9.0192, longitude: 38.7525 },
      destination: { latitude: 9.0301, longitude: 38.7612 },
      vehicleType: 'standard' as const,
    };
    const estimate = { id: '019ee375-7bd7-70d8-9bb4-3dc3ed66c004' };
    const create = jest.fn().mockResolvedValue(estimate);
    const controller = new FareEstimatesController({
      create,
    } as unknown as FareEstimatesService);

    await expect(controller.create(rider, input)).resolves.toBe(estimate);
    expect(create).toHaveBeenCalledWith(rider.id, input);
  });
});
