import { RegisterVehicleDto } from './register-vehicle.dto';

const base = {
  ownershipType: 'owner' as const,
  make: 'Toyota',
  model: 'Corolla',
  color: 'white',
  year: 2020,
  plateRegion: 'aa' as const,
  plateNumber: 'A12345',
};

describe('RegisterVehicleDto', () => {
  it('accepts code 01 with tinNumber', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '01',
        tinNumber: '0001234567',
      }),
    ).not.toThrow();
  });

  it('rejects code 01 without tinNumber', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({ ...base, plateCode: '01' }),
    ).toThrow(/tinNumber/);
  });

  it('accepts code 02 with neither subtype nor tin', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({ ...base, plateCode: '02' }),
    ).not.toThrow();
  });

  it('accepts code 02 with tinNumber provided', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '02',
        tinNumber: '0001234567',
      }),
    ).not.toThrow();
  });

  it('rejects code 02 if plateCodeSubtype is provided', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '02',
        plateCodeSubtype: 'other',
      }),
    ).toThrow();
  });

  it('rejects code 03 without plateCodeSubtype', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({ ...base, plateCode: '03' }),
    ).toThrow(/plateCodeSubtype/);
  });

  it('accepts code 03 transport_service with tinNumber', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '03',
        plateCodeSubtype: 'transport_service',
        tinNumber: '0001234567',
      }),
    ).not.toThrow();
  });

  it('rejects code 03 transport_service without tinNumber', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '03',
        plateCodeSubtype: 'transport_service',
      }),
    ).toThrow(/tinNumber/);
  });

  it('accepts code 03 other without tinNumber', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '03',
        plateCodeSubtype: 'other',
      }),
    ).not.toThrow();
  });

  it('accepts code 03 other with tinNumber', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '03',
        plateCodeSubtype: 'other',
        tinNumber: '0001234567',
      }),
    ).not.toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        plateCode: '02',
        extra: 'x',
      }),
    ).toThrow();
  });

  it('rejects empty make', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        make: '',
        plateCode: '02',
      }),
    ).toThrow();
  });

  it('rejects vehicle years before production cars existed', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        year: 1885,
        plateCode: '02',
      }),
    ).toThrow();
  });

  it('rejects non-integer vehicle years', () => {
    expect(() =>
      RegisterVehicleDto.schema.parse({
        ...base,
        year: 2020.5,
        plateCode: '02',
      }),
    ).toThrow();
  });
});
