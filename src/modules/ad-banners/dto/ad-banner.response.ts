import { z } from 'zod';
import { adBannerAudienceEnum } from '../schema';

export const AdBannerUploadUrlResponseSchema = z.object({
  url: z.url(),
  key: z.string(),
});

export const AdBannerResponseSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  imageUrl: z.url(),
  linkUrl: z.url().nullable(),
  audience: z.enum(adBannerAudienceEnum.enumValues),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const AdBannerListResponseSchema = z.array(AdBannerResponseSchema);

export const AdBannerMessageResponseSchema = z.object({
  message: z.string(),
});
