import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import {
  pushPlatformSchema,
  pushTokenSchema,
} from '../../notifications/dto/notifications.dto';
import { uploadSizeBytesSchema } from '../../storage/upload-limits';

const phoneSchema = z
  .string()
  .regex(/^\+251\d{9}$/, 'phone must be E.164 with +251 prefix');
const nameSchema = z.string().trim().min(1).max(100);
const deviceIdSchema = z.string().trim().min(1).max(255);
const imageStorageKeySchema = z.string().trim().min(1).max(1024);
const imageMimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((mimeType) => mimeType.startsWith('image/'), {
    message: 'mimeType must be an image type',
  });

export class SignUpStartDto extends createStrictDto(
  z.object({
    phoneNumber: phoneSchema,
    firstName: nameSchema,
    middleName: nameSchema.optional(),
    lastName: nameSchema,
    gender: z.enum(['male', 'female']),
    deviceId: deviceIdSchema,
    signupIntent: z.enum(['rider', 'driver']),
  }),
) {}
export class VerifyOtpDto extends createStrictDto(
  z.object({
    challengeId: z.uuid(),
    code: z.string().length(6),
  }),
) {}

export class SignUpVerifyDto extends createStrictDto(
  z.object({
    challengeId: z.uuid(),
    code: z.string().length(6),
    deviceId: deviceIdSchema,
    pushToken: pushTokenSchema.optional(),
    platform: pushPlatformSchema.optional(),
  }),
) {}

export class RefreshDto extends createStrictDto(
  z.object({ refreshToken: z.uuid() }),
) {}

export class LogoutDto extends createStrictDto(
  z.object({ refreshToken: z.uuid() }),
) {}

export class ResendOtpDto extends createStrictDto(
  z.object({ challengeId: z.uuid() }),
) {}

export class ConnectEmailStartDto extends createStrictDto(
  z.object({
    email: z.email(),
    password: z.string().min(8),
  }),
) {}

export class ConnectEmailVerifyDto extends createStrictDto(
  z.object({
    challengeId: z.uuid(),
    code: z.string().length(6),
  }),
) {}

export class LoginStartDto extends createStrictDto(
  z.object({
    phoneNumber: phoneSchema,
  }),
) {}

export class LoginVerifyDto extends createStrictDto(
  z.object({
    challengeId: z.uuid(),
    code: z.string().length(6),
    deviceId: deviceIdSchema,
    pushToken: pushTokenSchema.optional(),
    platform: pushPlatformSchema.optional(),
  }),
) {}

export class LoginVerifyPasswordDto extends createStrictDto(
  z.object({
    phoneNumber: phoneSchema,
    password: z.string().min(8),
    deviceId: deviceIdSchema,
    pushToken: pushTokenSchema.optional(),
    platform: pushPlatformSchema.optional(),
  }),
) {}

export class AdminLoginStartDto extends createStrictDto(
  z.object({
    email: z.email(),
    password: z.string().min(8),
  }),
) {}

export class PasswordResetStartDto extends createStrictDto(
  z.object({ email: z.email() }),
) {}

export class PasswordResetVerifyDto extends createStrictDto(
  z.object({
    challengeId: z.uuid(),
    code: z.string().length(6),
    newPassword: z.string().min(8),
  }),
) {}

export class ChangePasswordDto extends createStrictDto(
  z.object({
    oldPassword: z.string().min(8),
    newPassword: z.string().min(8),
  }),
) {}

export class ProfileImageUploadUrlDto extends createStrictDto(
  z.object({
    mimeType: imageMimeTypeSchema,
    originalName: z.string().trim().min(1).max(255),
    sizeBytes: uploadSizeBytesSchema,
  }),
) {}

export class UpdateMeDto extends createStrictDto(
  z.object({
    firstName: nameSchema.optional(),
    middleName: nameSchema.nullable().optional(),
    lastName: nameSchema.optional(),
    imageKey: imageStorageKeySchema.nullable().optional(),
  }),
) {}
