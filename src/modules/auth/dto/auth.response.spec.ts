import {
  SignUpVerifyResponseSchema,
  LoginVerifyResponseSchema,
  MeResponseSchema,
  ProfileImageUploadUrlResponseSchema,
  UserRoleSchema,
} from './auth.response';

describe('auth response DTOs', () => {
  it('keeps a compact user object on login verification responses', () => {
    const parsed = LoginVerifyResponseSchema.parse({
      accessToken: 'access-token',
      accessExpiresIn: 900,
      refreshToken: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
      refreshExpiresIn: 2592000,
      roles: ['driver'],
      user: {
        id: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        firstName: 'Login',
        middleName: null,
        lastName: 'User',
        roles: ['driver'],
        signupIntent: 'driver',
        image: null,
        phoneVerified: true,
        emailVerified: false,
      },
    });

    expect(parsed.roles).toEqual(['driver']);
    expect(parsed.user).toMatchObject({
      firstName: 'Login',
      lastName: 'User',
      roles: ['driver'],
      signupIntent: 'driver',
    });
  });

  it('includes signup intent on signup verification responses', () => {
    expect(
      SignUpVerifyResponseSchema.parse({
        accessToken: 'access-token',
        accessExpiresIn: 900,
        refreshToken: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        refreshExpiresIn: 2592000,
        signupIntent: 'driver',
      }),
    ).toMatchObject({
      accessToken: 'access-token',
      signupIntent: 'driver',
    });
  });

  it('accepts every persisted user role value', () => {
    expect(UserRoleSchema.parse('super_admin')).toBe('super_admin');
  });

  it('includes the shared auth user fields on /auth/me', () => {
    const createdAt = new Date();
    const parsed = MeResponseSchema.parse({
      id: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
      firstName: 'Login',
      middleName: 'Test',
      lastName: 'User',
      roles: ['rider'],
      signupIntent: 'driver',
      image: null,
      phoneVerified: true,
      emailVerified: false,
      phone: '+251911000099',
      email: 'login@example.com',
      phoneNumber: '+251911000099',
      gender: 'female',
      isActive: true,
      deviceId: 'internal-device-id',
      createdAt,
      miles: 0,
      rating: 5,
      trips: 0,
      isIdVerified: false,
      isFaydaVerified: false,
      isLicenseVerified: false,
      isDocumentVerified: false,
      avatar: null,
      profilePicture: null,
    });

    expect(parsed).toEqual({
      id: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
      firstName: 'Login',
      middleName: 'Test',
      lastName: 'User',
      roles: ['rider'],
      signupIntent: 'driver',
      image: null,
      phoneVerified: true,
      emailVerified: false,
      phone: '+251911000099',
      email: 'login@example.com',
      phoneNumber: '+251911000099',
      gender: 'female',
      isActive: true,
      createdAt,
      miles: 0,
      rating: 5,
      trips: 0,
      isIdVerified: false,
      isFaydaVerified: false,
      isLicenseVerified: false,
      isDocumentVerified: false,
      avatar: null,
      profilePicture: null,
    });
  });

  it('serializes profile image upload-url responses', () => {
    expect(
      ProfileImageUploadUrlResponseSchema.parse({
        url: 'https://upload.ubel.test/profile-avatar',
        key: 'profile-images/user-id/avatar.jpg',
      }),
    ).toEqual({
      url: 'https://upload.ubel.test/profile-avatar',
      key: 'profile-images/user-id/avatar.jpg',
    });
  });
});
