import { of, lastValueFrom } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { DriverPresencePrivacyInterceptor } from './driver-presence-privacy.interceptor';

const mockContext = {
  getHandler: () => ({}),
  getClass: () => ({}),
} as unknown as ExecutionContext;

describe('DriverPresencePrivacyInterceptor', () => {
  let interceptor: DriverPresencePrivacyInterceptor;

  beforeEach(() => {
    interceptor = new DriverPresencePrivacyInterceptor();
  });

  it('strips latitude and longitude from flat response objects', async () => {
    const callHandler = {
      handle: () => of({ latitude: 9.01, longitude: 38.76, ok: true }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(mockContext, callHandler),
    );
    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('longitude');
    expect(result).toEqual({ ok: true });
  });

  it('strips nested latitude and longitude', async () => {
    const callHandler = {
      handle: () =>
        of({
          location: { latitude: 9.01, longitude: 38.76, accuracy: 10 },
          userId: 'abc',
        }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(mockContext, callHandler),
    );
    expect(result).toEqual({
      location: { accuracy: 10 },
      userId: 'abc',
    });
  });

  it('strips latitude and longitude from array elements', async () => {
    const callHandler = {
      handle: () =>
        of([
          { latitude: 9.01, longitude: 38.76, name: 'a' },
          { latitude: 9.02, longitude: 38.77, name: 'b' },
        ]),
    };
    const result = await lastValueFrom(
      interceptor.intercept(mockContext, callHandler),
    );
    expect(result).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('passes through objects without coordinate fields unchanged', async () => {
    const callHandler = {
      handle: () => of({ operationalState: 'online', dispatchAvailable: true }),
    };
    const result = await lastValueFrom(
      interceptor.intercept(mockContext, callHandler),
    );
    expect(result).toEqual({
      operationalState: 'online',
      dispatchAvailable: true,
    });
  });

  it('passes through null and undefined values', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(mockContext, { handle: () => of(null) }),
      ),
    ).resolves.toBeNull();

    await expect(
      lastValueFrom(
        interceptor.intercept(mockContext, { handle: () => of(undefined) }),
      ),
    ).resolves.toBeUndefined();
  });

  it('passes through primitive values unchanged', async () => {
    const callHandler = { handle: () => of('hello') };
    const result = await lastValueFrom(
      interceptor.intercept(mockContext, callHandler),
    );
    expect(result).toBe('hello');
  });
});
