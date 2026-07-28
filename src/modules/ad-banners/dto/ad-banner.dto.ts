import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { uploadSizeBytesSchema } from '../../storage/upload-limits';
import { adBannerAudienceEnum } from '../schema';

const imageMimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((mimeType) => mimeType.startsWith('image/'), {
    message: 'mimeType must be an image type',
  });

const imageKeySchema = z.string().trim().min(1).max(1024);

const nullableIsoDateSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullish();

export class AdBannerUploadUrlDto extends createStrictDto(
  z.object({
    mimeType: imageMimeTypeSchema,
    originalName: z.string().trim().min(1).max(255),
    sizeBytes: uploadSizeBytesSchema,
  }),
) {}

const createAdBannerBaseSchema = z.object({
  imageKey: imageKeySchema,
  audience: z.enum(adBannerAudienceEnum.enumValues).default('all_users'),
  title: z.string().trim().min(1).max(120).nullish(),
  linkUrl: z.url().nullish(),
  sortOrder: z.int().default(0),
  startsAt: nullableIsoDateSchema,
  endsAt: nullableIsoDateSchema,
});

const createAdBannerSchema = createAdBannerBaseSchema
  .strict()
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || value.endsAt > value.startsAt,
    {
      message: 'endsAt must be after startsAt',
      path: ['endsAt'],
    },
  );

export class CreateAdBannerDto extends createStrictDto(
  createAdBannerBaseSchema,
) {
  static readonly schema = createAdBannerSchema;
}

export class SetAdBannerStatusDto extends createStrictDto(
  z.object({
    isActive: z.boolean(),
  }),
) {}
