import {
  ListNotificationsDto,
  RegisterDeviceTokenDto,
} from './notifications.dto';

describe('notification request DTOs', () => {
  it('accepts device token registration input', () => {
    expect(
      RegisterDeviceTokenDto.schema.parse({
        deviceId: ' device-1 ',
        pushToken: ' fcm-token ',
        platform: 'web',
      }),
    ).toEqual({
      deviceId: 'device-1',
      pushToken: 'fcm-token',
      platform: 'web',
    });
  });

  it('rejects unsupported push platforms', () => {
    expect(() =>
      RegisterDeviceTokenDto.schema.parse({
        deviceId: 'device-1',
        pushToken: 'fcm-token',
        platform: 'desktop',
      }),
    ).toThrow();
  });

  it('accepts notification list query input with defaults', () => {
    expect(ListNotificationsDto.schema.parse({})).toEqual({
      limit: 50,
      offset: 0,
    });
  });

  it('coerces notification list pagination query strings', () => {
    expect(
      ListNotificationsDto.schema.parse({
        limit: '25',
        offset: '50',
      }),
    ).toEqual({
      limit: 25,
      offset: 50,
    });
  });

  it('rejects invalid notification list pagination input', () => {
    expect(() =>
      ListNotificationsDto.schema.parse({
        limit: '101',
      }),
    ).toThrow();

    expect(() =>
      ListNotificationsDto.schema.parse({
        offset: '-1',
      }),
    ).toThrow();
  });
});
