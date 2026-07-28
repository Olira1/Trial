import { z } from 'zod';
import {
  supportBugAreaEnum,
  supportBugImpactEnum,
  supportBugSeverityEnum,
  supportContactTypeEnum,
  supportFeedbackTopicEnum,
} from '../schema';

export const SupportUploadUrlResponseSchema = z.object({
  url: z.url(),
  key: z.string(),
});

export const SupportBugReportScreenshotResponseSchema = z.object({
  id: z.uuid(),
  storageKey: z.string(),
  url: z.string(),
  createdAt: z.date(),
});

export const SupportBugReportResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  severity: z.enum(supportBugSeverityEnum.enumValues),
  impact: z.enum(supportBugImpactEnum.enumValues),
  area: z.enum(supportBugAreaEnum.enumValues),
  details: z.string(),
  stepsToReproduce: z.string().nullable(),
  screenshots: z.array(SupportBugReportScreenshotResponseSchema),
  createdAt: z.date(),
});

export const SupportFeedbackResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  rating: z.number().int(),
  topic: z.enum(supportFeedbackTopicEnum.enumValues),
  wouldRecommend: z.boolean(),
  title: z.string().nullable(),
  feedback: z.string().nullable(),
  createdAt: z.date(),
});

export const SupportContactResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  type: z.enum(supportContactTypeEnum.enumValues),
  name: z.string(),
  phone: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SupportContactListResponseSchema = z.array(
  SupportContactResponseSchema,
);

export const SupportMessageResponseSchema = z.object({
  message: z.string(),
});
