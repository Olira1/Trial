import { z } from 'zod';
import { applicationStatusEnum } from '../../driver/schema/driver-application.schema';
import { approvalReviewStatusEnum } from '../../driver/schema/driver-license-approval.schema';
import {
  documentReviewStatusEnum,
  documentTypeEnum,
} from '../../driver/schema/document.schema';
import { notificationCategoryValues } from '../../notifications/notifications.types';
import { genderEnum } from '../../user/schema/user.schema';

export const AdminNotificationResponseSchema = z.object({
  message: z.string(),
  storedCount: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
});

export const AdminMessageResponseSchema = z.object({
  message: z.string(),
});

export const AdminDocumentReviewResponseSchema = z.object({
  reviewStatus: z.enum(documentReviewStatusEnum.enumValues),
});

export const AdminVehicleReviewResponseSchema = z.object({
  reviewStatus: z.enum(approvalReviewStatusEnum.enumValues),
});

export const AdminLicenseReviewResponseSchema = z.object({
  reviewStatus: z.enum(approvalReviewStatusEnum.enumValues),
});

export const AdminNotificationHistoryItemResponseSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  category: z.enum(notificationCategoryValues).nullable(),
  source: z.enum(['admin', 'system']),
  createdByUserId: z.uuid().nullable(),
  createdAt: z.date(),
});

export const AdminNotificationHistoryListResponseSchema = z.object({
  items: z.array(AdminNotificationHistoryItemResponseSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

const AdminDriverApplicationStatusSchema = z.enum([
  'not_submitted',
  ...applicationStatusEnum.enumValues,
]);

const AdminDocumentAggregateStatusSchema = z.enum([
  'missing',
  'partial',
  ...approvalReviewStatusEnum.enumValues,
  ...documentReviewStatusEnum.enumValues,
  'mixed',
]);

const AdminDriverDocumentResponseSchema = z.object({
  id: z.uuid(),
  documentType: z.enum(documentTypeEnum.enumValues),
  url: z.string(),
  reviewStatus: z.enum(documentReviewStatusEnum.enumValues),
  reviewedAt: z.date().nullable(),
  reviewReason: z.string().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const AdminDriverListItemResponseSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  gender: z.enum(genderEnum.enumValues).nullable(),
  profilePicture: z.url().nullable(),
  vehicle: z
    .object({
      make: z.string(),
      model: z.string(),
      color: z.string(),
      year: z.number().int(),
      plateNumber: z.string(),
      isApproved: z.boolean(),
    })
    .nullable(),
  rating: z.number(),
  trips: z.number().int().nonnegative(),
  wallet: z.number(),
  driverApplicationStatus: AdminDriverApplicationStatusSchema,
  submittedAt: z.date().nullable(),
  licenseStatus: AdminDocumentAggregateStatusSchema,
  vehicleDocumentsStatus: AdminDocumentAggregateStatusSchema,
  documents: z.array(AdminDriverDocumentResponseSchema),
  status: z.enum(['active', 'inactive']),
});

export const AdminDriverListResponseSchema = z.object({
  items: z.array(AdminDriverListItemResponseSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const AdminRiderListItemResponseSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  profilePicture: z.url().nullable(),
  rating: z.number(),
  trips: z.number().int().nonnegative(),
  miles: z.number(),
  isIdVerified: z.boolean(),
  isFaydaVerified: z.boolean(),
  status: z.enum(['active', 'inactive']),
});

export const AdminRiderListResponseSchema = z.object({
  items: z.array(AdminRiderListItemResponseSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const AdminDispatchQueueStatusSchema = z.object({
  queueName: z.string(),
  counts: z.object({
    waiting: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    paused: z.number().int().nonnegative(),
  }),
});

export const AdminDispatchQueueStatusListResponseSchema = z.array(
  AdminDispatchQueueStatusSchema,
);

const AdminDispatchAttemptSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  attemptNumber: z.number().int().positive(),
  state: z.enum(['in_progress', 'completed', 'failed', 'exhausted']),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const AdminDispatchOfferSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  attemptId: z.uuid(),
  driverId: z.uuid(),
  state: z.enum(['pending', 'accepted', 'rejected', 'expired', 'cancelled']),
  offeredAt: z.date(),
  expiresAt: z.date(),
  respondedAt: z.date().nullable(),
  etaSeconds: z.number().int().positive().nullable(),
  distanceMeters: z.number().int().positive().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const AdminDriverOperationalProfileSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  operationalState: z.enum([
    'offline',
    'online',
    'offered',
    'assigned',
    'suspended',
  ]),
  presenceGeneration: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const AdminRideRequestSchema = z.object({
  id: z.uuid(),
  riderId: z.uuid(),
  state: z.enum([
    'searching',
    'offered',
    'assigned',
    'cancelled',
    'expired',
    'no_driver_found',
    'system_failed',
  ]),
  offerTtlSeconds: z.number().int().positive(),
  matchingDeadlineSeconds: z.number().int().positive(),
  matchingDeadlineAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const AdminDispatchRequestInspectionResponseSchema = z.object({
  request: AdminRideRequestSchema,
  attempts: z.array(AdminDispatchAttemptSchema),
  offers: z.array(AdminDispatchOfferSchema),
  driverProfiles: z.array(AdminDriverOperationalProfileSchema),
});

export const AdminDispatchOfferInspectionResponseSchema = z.object({
  offer: AdminDispatchOfferSchema,
  request: AdminRideRequestSchema.nullable(),
  attempt: AdminDispatchAttemptSchema.nullable(),
  driverProfile: AdminDriverOperationalProfileSchema.nullable(),
});

export const AdminDispatchDriverInspectionResponseSchema = z.object({
  driverProfile: AdminDriverOperationalProfileSchema.nullable(),
  offers: z.array(AdminDispatchOfferSchema),
  requests: z.array(AdminRideRequestSchema),
});

export const AdminDispatchJobOperationResponseSchema = z.object({
  success: z.boolean(),
  jobId: z.string(),
  queueName: z.string(),
  message: z.string(),
});
