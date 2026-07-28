import z from 'zod';

export const UserRoleSchema = z.enum([
  'rider',
  'driver',
  'admin',
  'super_admin',
]);
export const UserSignupIntentSchema = z.enum(['rider', 'driver']).nullable();

export const SignUpStartResponseSchema = z.object({
  signUpChallengeId: z.uuid(),
  expiresIn: z.number(),
});

export const SignUpVerifyResponseSchema = z.object({
  accessToken: z.string(),
  accessExpiresIn: z.number(),
  refreshToken: z.uuid(),
  refreshExpiresIn: z.number(),
  signupIntent: UserSignupIntentSchema,
});

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
});

export const MessageResponseSchema = z.object({
  message: z.string(),
});

export const OtpResendResponseSchema = z.object({
  challengeId: z.uuid(),
  expiresIn: z.number(),
});

export const ConnectEmailStartResponseSchema = z.object({
  challengeId: z.uuid(),
  expiresIn: z.number(),
});

export const ConnectEmailVerifyResponseSchema = z.object({
  message: z.string(),
});

export const LoginStartResponseSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('otp'),
    challengeId: z.uuid(),
    expiresIn: z.number(),
  }),
  z.object({ method: z.literal('email_password') }),
]);

export const AuthUserResponseSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  roles: z.array(UserRoleSchema),
  signupIntent: UserSignupIntentSchema,
  image: z.string().nullable(),
  phoneVerified: z.boolean(),
  emailVerified: z.boolean(),
});

export const LoginVerifyResponseSchema = z.object({
  accessToken: z.string(),
  accessExpiresIn: z.number(),
  refreshToken: z.uuid(),
  refreshExpiresIn: z.number(),
  roles: z.array(UserRoleSchema),
  user: AuthUserResponseSchema,
});

export const AdminLoginStartResponseSchema = z.object({
  challengeId: z.uuid(),
  expiresIn: z.number(),
});

export const AdminLoginVerifyResponseSchema = z.object({
  message: z.string(),
});

export const PasswordResetStartResponseSchema = z.object({
  challengeId: z.uuid(),
  expiresIn: z.number(),
});

export const ProfileImageUploadUrlResponseSchema = z.object({
  url: z.url(),
  key: z.string(),
});

export const MeResponseSchema = AuthUserResponseSchema.extend({
  phone: z.string().nullable(),
  email: z.email().nullable(),
  phoneNumber: z.string().nullable(),
  gender: z.enum(['male', 'female']).nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  miles: z.number(),
  rating: z.number(),
  trips: z.number(),
  isIdVerified: z.boolean(),
  isFaydaVerified: z.boolean(),
  isLicenseVerified: z.boolean(),
  isDocumentVerified: z.boolean(),
  avatar: z.string().nullable(),
  profilePicture: z.string().nullable(),
});
