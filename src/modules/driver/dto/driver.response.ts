import { z } from 'zod';
import {
  documentReviewStatusEnum,
  documentTypeEnum,
} from '../schema/document.schema';
import {
  ownershipTypeEnum,
  plateCodeEnum,
  plateCodeSubtypeEnum,
  plateRegionEnum,
} from '../schema/vehicle.schema';

export const VehicleResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  ownershipType: z.enum(ownershipTypeEnum.enumValues),
  make: z.string(),
  model: z.string(),
  color: z.string(),
  year: z.number().int(),
  plateRegion: z.enum(plateRegionEnum.enumValues),
  plateCode: z.enum(plateCodeEnum.enumValues),
  plateCodeSubtype: z.enum(plateCodeSubtypeEnum.enumValues).nullable(),
  plateNumber: z.string(),
  tinNumber: z.string().nullable(),
  isApproved: z.boolean(),
  createdAt: z.date(),
});

const documentUrlSchema = z.url().nullable();

export const DocumentUrlsResponseSchema = z.object({
  vehicle_ownership: documentUrlSchema,
  representation_letter: documentUrlSchema,
  driver_license_front: documentUrlSchema,
  driver_license_back: documentUrlSchema,
  vehicle_photo_front: documentUrlSchema,
  vehicle_photo_side: documentUrlSchema,
  vehicle_photo_back: documentUrlSchema,
  bolo: documentUrlSchema,
  third_party_insurance: documentUrlSchema,
  trade_license: documentUrlSchema,
});

export const VehicleWithDocumentUrlsResponseSchema =
  VehicleResponseSchema.extend({
    documentsUploaded: DocumentUrlsResponseSchema,
  });

export const UploadUrlResponseSchema = z.object({
  url: z.url(),
  key: z.string(),
});

export const DocumentResponseSchema = z.object({
  id: z.string().uuid(),
  documentType: z.enum(documentTypeEnum.enumValues),
  storageKey: z.string(),
  url: z.string(),
  reviewStatus: z.enum(documentReviewStatusEnum.enumValues),
  reviewedAt: z.date().nullable(),
  reviewReason: z.string().nullable(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});
