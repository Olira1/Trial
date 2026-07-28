import {
  LoginVerifyDto,
  LoginVerifyPasswordDto,
  ProfileImageUploadUrlDto,
  SignUpStartDto,
  SignUpVerifyDto,
  UpdateMeDto,
} from './auth.dto';

describe('auth request DTOs', () => {
  it('accepts structured signup names without a middle name', () => {
    expect(
      SignUpStartDto.schema.parse({
        phoneNumber: '+251911000096',
        firstName: 'Signup',
        lastName: 'User',
        gender: 'female',
        deviceId: 'signup-device',
        signupIntent: 'rider',
      }),
    ).toMatchObject({
      firstName: 'Signup',
      lastName: 'User',
    });
  });

  it('rejects legacy fullName signup input', () => {
    expect(() =>
      SignUpStartDto.schema.parse({
        phoneNumber: '+251911000096',
        fullName: 'Signup Test User',
        gender: 'female',
        deviceId: 'signup-device',
        signupIntent: 'rider',
      }),
    ).toThrow();
  });

  it('accepts device and push token data on signup verification', () => {
    expect(
      SignUpVerifyDto.schema.parse({
        challengeId: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        code: '000000',
        deviceId: 'signup-verify-device',
        pushToken: ' signup-push-token ',
        platform: 'ios',
      }),
    ).toMatchObject({
      deviceId: 'signup-verify-device',
      pushToken: 'signup-push-token',
      platform: 'ios',
    });
  });

  it('rejects unsupported push platforms on signup verification', () => {
    expect(() =>
      SignUpVerifyDto.schema.parse({
        challengeId: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        code: '000000',
        deviceId: 'signup-verify-device',
        pushToken: 'signup-push-token',
        platform: 'desktop',
      }),
    ).toThrow();
  });

  it('accepts device ids on OTP login verification', () => {
    expect(
      LoginVerifyDto.schema.parse({
        challengeId: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        code: '000000',
        deviceId: 'otp-login-device',
        pushToken: ' otp-push-token ',
        platform: 'android',
      }),
    ).toMatchObject({
      deviceId: 'otp-login-device',
      pushToken: 'otp-push-token',
      platform: 'android',
    });
  });

  it('accepts device ids on password login verification', () => {
    expect(
      LoginVerifyPasswordDto.schema.parse({
        phoneNumber: '+251911000097',
        password: 'EmailPass123!',
        deviceId: 'password-login-device',
        pushToken: 'password-push-token',
        platform: 'ios',
      }),
    ).toMatchObject({
      deviceId: 'password-login-device',
      pushToken: 'password-push-token',
      platform: 'ios',
    });
  });

  it('accepts web push platforms and rejects unsupported platforms on login verification', () => {
    expect(() =>
      LoginVerifyDto.schema.parse({
        challengeId: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        code: '000000',
        deviceId: 'otp-login-device',
        pushToken: 'otp-push-token',
        platform: 'web',
      }),
    ).not.toThrow();

    expect(() =>
      LoginVerifyDto.schema.parse({
        challengeId: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        code: '000000',
        deviceId: 'otp-login-device',
        pushToken: 'otp-push-token',
        platform: 'desktop',
      }),
    ).toThrow();
  });

  it('accepts editable profile fields', () => {
    expect(
      UpdateMeDto.schema.parse({
        firstName: ' Updated ',
        middleName: null,
        lastName: 'User',
        imageKey:
          'profile-images/019b2bd6-e678-7a6f-9054-456d6d6d2168/avatar.jpg',
      }),
    ).toEqual({
      firstName: 'Updated',
      middleName: null,
      lastName: 'User',
      imageKey:
        'profile-images/019b2bd6-e678-7a6f-9054-456d6d6d2168/avatar.jpg',
    });
  });

  it('accepts clearing the profile image', () => {
    expect(UpdateMeDto.schema.parse({ imageKey: null })).toEqual({
      imageKey: null,
    });
  });

  it('rejects non-editable profile fields', () => {
    expect(() =>
      UpdateMeDto.schema.parse({
        firstName: 'Updated',
        role: 'driver',
        phone: '+251911000096',
        email: 'updated@example.com',
        gender: 'female',
        isActive: false,
      }),
    ).toThrow();
  });

  it('accepts image upload-url input only for image mime types', () => {
    expect(
      ProfileImageUploadUrlDto.schema.parse({
        mimeType: ' image/jpeg ',
        originalName: ' avatar.jpg ',
        sizeBytes: 1024,
      }),
    ).toEqual({
      mimeType: 'image/jpeg',
      originalName: 'avatar.jpg',
      sizeBytes: 1024,
    });

    expect(() =>
      ProfileImageUploadUrlDto.schema.parse({
        mimeType: 'application/pdf',
        originalName: 'avatar.pdf',
        sizeBytes: 1024,
      }),
    ).toThrow();
  });
});
