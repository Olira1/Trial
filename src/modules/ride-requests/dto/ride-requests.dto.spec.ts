import { CreateRideRequestDto } from './ride-requests.dto';

const validInput = {
  pickup: { latitude: 9.0192, longitude: 38.7525 },
  destination: { latitude: 9.0301, longitude: 38.7612 },
  fareEstimateId: '019eeb33-103a-773a-b475-32acf07fb3d4',
  idempotencyKey: 'request-key',
};

describe('CreateRideRequestDto', () => {
  it('accepts request creation with a fare estimate id', () => {
    expect(CreateRideRequestDto.schema.parse(validInput)).toEqual(validInput);
  });

  it('rejects request creation without a fare estimate id', () => {
    const { fareEstimateId: _fareEstimateId, ...withoutFare } = validInput;

    expect(() => CreateRideRequestDto.schema.parse(withoutFare)).toThrow();
  });
});
