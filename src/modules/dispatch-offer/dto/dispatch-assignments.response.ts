import { z } from 'zod';

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

const pickupSchema = z.object({
  id: z.uuid(),
  state: z.enum(['arrived', 'warning_sent', 'rider_no_show_cancelled']),
  arrivedAt: timestampSchema,
  warningDueAt: timestampSchema,
  warningSentAt: timestampSchema.nullable(),
  noShowCancellableAt: timestampSchema,
  noShowCancelledAt: timestampSchema.nullable(),
});

const tripSchema = z.object({
  id: z.uuid(),
  state: z.enum(['started', 'completed']),
  startedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});

export const ActiveDispatchAssignmentResponseSchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  offerId: z.uuid(),
  requestId: z.uuid(),
  riderId: z.uuid(),
  driverId: z.uuid(),
  state: z.literal('assigned'),
  status: z.literal('assigned'),
  assignedAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  driver: z.object({
    id: z.uuid(),
    fullName: z.string(),
    phone: z.string(),
    rating: z.number(),
  }),
  vehicle: z.object({
    make: z.string(),
    model: z.string(),
    color: z.string(),
    plateRegion: z.enum(['aa', 'or', 'ah', 'dr', 'tg']),
    plateCode: z.enum(['01', '02', '03']),
    plateCodeSubtype: z.enum(['transport_service', 'other']).nullable(),
    plateNumber: z.string(),
  }),
  trip: tripSchema.nullable(),
  pickup: pickupSchema.nullable(),
});

export type ActiveDispatchAssignmentResponse = z.infer<
  typeof ActiveDispatchAssignmentResponseSchema
>;
