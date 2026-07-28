import { z } from 'zod';

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString() : v));

export const DispatchCancellationResponseSchema = z.object({
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
  updatedAt: timestampSchema,
});

export type DispatchCancellationResponse = z.infer<
  typeof DispatchCancellationResponseSchema
>;
