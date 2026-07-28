import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { uploadSizeBytesSchema } from '../../storage/upload-limits';
import {
  supportBugAreaEnum,
  supportBugImpactEnum,
  supportBugSeverityEnum,
  supportFeedbackTopicEnum,
} from '../schema';

const ethiopianPhoneSchema = z
  .string()
  .regex(/^\+251\d{9}$/, 'phone must be E.164 with +251 prefix');

const screenshotUploadUrlSchema = z.object({
  mimeType: z.string().min(1).max(100),
  originalName: z.string().min(1).max(255),
  sizeBytes: uploadSizeBytesSchema,
});

export class BugReportScreenshotUploadUrlDto extends createStrictDto(
  screenshotUploadUrlSchema,
) {}

const bugReportSchema = z.object({
  severity: z.enum(supportBugSeverityEnum.enumValues),
  impact: z.enum(supportBugImpactEnum.enumValues),
  area: z.enum(supportBugAreaEnum.enumValues),
  details: z.string().min(1).max(5000),
  stepsToReproduce: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(1).max(3000).nullish(),
  ),
  screenshotKeys: z.array(z.string().min(1).max(255)).max(4).optional(),
});

export class CreateBugReportDto extends createStrictDto(bugReportSchema) {}

const feedbackSchema = z.object({
  rating: z.int().min(1).max(5),
  topic: z.enum(supportFeedbackTopicEnum.enumValues),
  wouldRecommend: z.boolean(),
  title: z.string().min(1).max(120).nullish(),
  feedback: z.string().min(1).max(5000).nullish(),
});

export class CreateFeedbackDto extends createStrictDto(feedbackSchema) {}

const createContactSchema = z.object({
  name: z.string().min(1).max(100),
  phone: ethiopianPhoneSchema,
});

export class CreateSupportContactDto extends createStrictDto(
  createContactSchema,
) {}

const updateContactBaseSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: ethiopianPhoneSchema.optional(),
});

const updateContactSchema = updateContactBaseSchema
  .strict()
  .refine(
    (value) => value.name !== undefined || value.phone !== undefined,
    'at least one contact field must be provided',
  );

export class UpdateSupportContactDto extends createStrictDto(
  updateContactBaseSchema,
) {
  static readonly schema = updateContactSchema;
}
