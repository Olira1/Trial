import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { notificationCategoryValues } from '../../notifications/notifications.types';
import {
  driverLicenseIssuerEnum,
  driverLicenseTypeEnum,
} from '../../driver/schema/driver-license-approval.schema';
import { vehicleQualificationEnum } from '../../driver/schema/vehicle.schema';

export const notificationCategorySchema = z.enum(notificationCategoryValues);
export const adminListStatusSchema = z
  .enum(['all', 'active', 'inactive'])
  .default('all');

const notificationCopySchema = {
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
};

const documentReviewReasonSchema = z.string().trim().min(1).max(500);

const optionalExpirySchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullish()
  .transform((value) => value ?? null);

export class SendUserNotificationDto extends createStrictDto(
  z.object(notificationCopySchema),
) {}

export class SendCategoryNotificationDto extends createStrictDto(
  z.object({
    category: notificationCategorySchema,
    ...notificationCopySchema,
  }),
) {}

export class ListAdminDriversDto extends createStrictDto(
  z.object({
    status: adminListStatusSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
) {}

export class ListAdminRidersDto extends createStrictDto(
  z.object({
    status: adminListStatusSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
) {}

export class ListAdminNotificationsDto extends createStrictDto(
  z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
) {}

export class ApproveDocumentDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
    expiresAt: optionalExpirySchema,
  }),
) {}

export class RejectDocumentDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
  }),
) {}

export class RevokeDocumentDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
  }),
) {}

export class ApproveLicenseDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
    licenseNumber: z.string().trim().min(1).max(64),
    issuedBy: z.enum(driverLicenseIssuerEnum.enumValues),
    licenseType: z.enum(driverLicenseTypeEnum.enumValues),
    expiresAt: optionalExpirySchema,
  }),
) {}

export class RejectLicenseDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
  }),
) {}

export class RevokeLicenseDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
  }),
) {}

export class ApproveVehicleDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
    tinNumber: z.string().trim().min(1).max(50),
    qualifications: z
      .array(z.enum(vehicleQualificationEnum.enumValues))
      .min(1)
      .max(4)
      .refine(
        (values) => new Set(values).size === values.length,
        'qualifications must be unique',
      ),
  }),
) {}

export class RejectVehicleDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
  }),
) {}

export class RevokeVehicleDto extends createStrictDto(
  z.object({
    reason: documentReviewReasonSchema,
  }),
) {}

export class TriggerDispatchReconciliationDto extends createStrictDto(
  z.object({
    reason: z.string().trim().min(1).max(500),
  }),
) {}
