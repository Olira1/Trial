import { z } from 'zod';

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

const pointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const DispatchOfferResponseSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  driverId: z.uuid(),
  state: z.enum(['pending', 'accepted', 'rejected', 'expired', 'cancelled']),
  etaSeconds: z.number().int().positive().nullable(),
  distanceMeters: z.number().int().positive().nullable(),
  expiresAt: timestampSchema,
  offeredAt: timestampSchema,
  respondedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const CurrentDispatchOfferResponseSchema =
  DispatchOfferResponseSchema.extend({
    assignmentId: z.string().uuid().nullable(),
    pickup: pointSchema,
    destination: pointSchema,
    fareEstimateId: z.string().uuid().nullable(),
    vehicleType: z.literal('standard').nullable(),
    rideType: z.literal('instant').nullable(),
    currency: z.literal('ETB').nullable(),
    tripDistanceMeters: z.number().int().positive().nullable(),
    tripDurationSeconds: z.number().int().positive().nullable(),
    rateMinorPerKm: z.number().int().positive().nullable(),
    estimatedFareMinor: z.number().int().nonnegative().nullable(),
  });

export type DispatchOfferResponse = z.infer<typeof DispatchOfferResponseSchema>;
export type CurrentDispatchOfferResponse = z.infer<
  typeof CurrentDispatchOfferResponseSchema
>;
