import { z } from 'zod';

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

const pointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

const completionSchema = z.object({
  totalPriceMinor: z.int().nonnegative().nullable(),
  currency: z.literal('ETB').nullable(),
  totalDistanceMeters: z.int().positive().nullable(),
  totalTimeTakenSeconds: z.int().nonnegative(),
});

export const DispatchAssignmentTripResponseSchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  requestId: z.uuid(),
  offerId: z.uuid(),
  riderId: z.uuid(),
  driverId: z.uuid(),
  state: z.enum(['started', 'completed']),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  rider: z.object({
    id: z.uuid(),
    fullName: z.string(),
    phone: z.string(),
    rating: z.number(),
  }),
  pickup: pointSchema,
  destination: pointSchema,
  completion: completionSchema.nullable(),
});

export type DispatchAssignmentTripResponse = z.infer<
  typeof DispatchAssignmentTripResponseSchema
>;
