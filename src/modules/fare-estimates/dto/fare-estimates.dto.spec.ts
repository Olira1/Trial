import { CreateFareEstimateDto } from './fare-estimates.dto';

const validInput = {
  pickup: { latitude: 9.0192, longitude: 38.7525 },
  destination: { latitude: 9.0301, longitude: 38.7612 },
};

describe('CreateFareEstimateDto', () => {
  it('defaults the temporary vehicle type to standard', () => {
    expect(CreateFareEstimateDto.schema.parse(validInput)).toEqual({
      ...validInput,
      vehicleType: 'standard',
    });
  });

  it('rejects an unsupported vehicle type', () => {
    expect(() =>
      CreateFareEstimateDto.schema.parse({
        ...validInput,
        vehicleType: 'premium',
      }),
    ).toThrow();
  });
});
