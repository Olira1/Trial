import { z } from 'zod';
import { notificationCategoryValues } from '../notifications.types';

export const DeviceTokenResponseSchema = z.object({
  message: z.string(),
});

export const NotificationResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  category: z.enum(notificationCategoryValues).nullable(),
  source: z.enum(['admin', 'system']),
  seenAt: z.date().nullable(),
  createdAt: z.date(),
});

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationResponseSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});

export const NotificationMessageResponseSchema = z.object({
  message: z.string(),
});
