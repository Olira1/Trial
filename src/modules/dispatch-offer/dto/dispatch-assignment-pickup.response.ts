import { z } from 'zod';

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

export const DispatchAssignmentPickupResponseSchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  requestId: z.uuid(),
  offerId: z.uuid(),
  riderId: z.uuid(),
  driverId: z.uuid(),
  state: z.enum(['arrived', 'warning_sent', 'rider_no_show_cancelled']),
  arrivedAt: timestampSchema,
  warningDueAt: timestampSchema,
  warningSentAt: timestampSchema.nullable(),
  noShowCancellableAt: timestampSchema,
  noShowCancelledAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export type DispatchAssignmentPickupResponse = z.infer<
  typeof DispatchAssignmentPickupResponseSchema
>;
