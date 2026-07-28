import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';

export const pushPlatformSchema = z.enum(['android', 'ios', 'web']);
export const pushTokenSchema = z.string().trim().min(1).max(4096);

const deviceIdSchema = z.string().trim().min(1).max(255);

export class ListNotificationsDto extends createStrictDto(
  z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
) {}

export class RegisterDeviceTokenDto extends createStrictDto(
  z.object({
    deviceId: deviceIdSchema,
    pushToken: pushTokenSchema,
    platform: pushPlatformSchema,
  }),
) {}
