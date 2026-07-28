import { z } from 'zod';

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString() : v));

const pointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

const assignmentSchema = z.object({
  id: z.string().uuid(),
  offerId: z.string().uuid(),
  requestId: z.string().uuid(),
  riderId: z.string().uuid(),
  driverId: z.string().uuid(),
  state: z.literal('assigned'),
  assignedAt: timestampSchema,
  driver: z.object({
    id: z.string().uuid(),
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
  trip: z
    .object({
      id: z.string().uuid(),
      state: z.enum(['started', 'completed']),
      startedAt: timestampSchema,
      completedAt: timestampSchema.nullable(),
    })
    .nullable(),
  pickup: z
    .object({
      id: z.string().uuid(),
      state: z.enum(['arrived', 'warning_sent', 'rider_no_show_cancelled']),
      arrivedAt: timestampSchema,
      warningDueAt: timestampSchema,
      warningSentAt: timestampSchema.nullable(),
      noShowCancellableAt: timestampSchema,
      noShowCancelledAt: timestampSchema.nullable(),
    })
    .nullable(),
});

const cancellationSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  offerId: z.string().uuid().nullable(),
  assignmentId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid(),
  actorRole: z.enum(['rider', 'driver', 'system']),
  reasonCode: z.enum([
    'generic',
    'wrong_pickup',
    'rider_changed_mind',
    'driver_delay',
    'driver_requested',
    'driver_emergency',
    'driver_no_show',
    'rider_no_show',
    'other',
  ]),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
});

export const RideRequestResponseSchema = z.object({
  id: z.string().uuid(),
  riderId: z.string().uuid(),
  state: z.enum([
    'searching',
    'offered',
    'assigned',
    'completed',
    'cancelled',
    'expired',
    'no_driver_found',
    'system_failed',
  ]),
  pickup: pointSchema,
  destination: pointSchema,
  fareEstimateId: z.string().uuid().nullable(),
  vehicleType: z.literal('standard').nullable(),
  rideType: z.literal('instant').nullable(),
  currency: z.literal('ETB').nullable(),
  distanceMeters: z.number().int().positive().nullable(),
  durationSeconds: z.number().int().positive().nullable(),
  rateMinorPerKm: z.number().int().positive().nullable(),
  estimatedFareMinor: z.number().int().nonnegative().nullable(),
  assignment: assignmentSchema.nullable(),
  cancellation: cancellationSchema.nullable(),
  idempotencyKey: z.string(),
  offerTtlSeconds: z.number(),
  matchingDeadlineSeconds: z.number(),
  matchingDeadlineAt: timestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type RideRequestResponse = z.infer<typeof RideRequestResponseSchema>;
