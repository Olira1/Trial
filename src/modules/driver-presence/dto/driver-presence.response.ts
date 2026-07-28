import { z } from 'zod';

export const DriverPresenceCommandResponseSchema = z.object({
  operationalState: z.enum(['online', 'offline']),
  presenceSessionId: z.string().uuid().nullable(),
  leaseId: z.string().uuid().nullable(),
  leaseSequence: z.number().int().nonnegative().nullable(),
  resumeRequired: z.boolean(),
});

export const DriverPresenceUnavailableReasonSchema = z.enum([
  'offline',
  'not_eligible',
  'not_owner',
  'stale_presence',
  'redis_unavailable',
  'offered',
  'assigned',
  'suspended',
]);

export const DriverPresenceSnapshotResponseSchema = z.object({
  operationalState: z.enum([
    'offline',
    'online',
    'offered',
    'assigned',
    'suspended',
  ]),
  isCurrentSessionOwner: z.boolean(),
  presenceSessionId: z.string().uuid().nullable(),
  dispatchAvailable: z.boolean(),
  unavailableReasons: z.array(DriverPresenceUnavailableReasonSchema),
});
