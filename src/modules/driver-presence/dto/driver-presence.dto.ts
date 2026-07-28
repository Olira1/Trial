import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';

export const driverLocationCommandSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().max(10_000),
    capturedAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
  })
  .strict();

export class GoOnlineDto extends createStrictDto(
  z.object({
    initialLocation: driverLocationCommandSchema,
    takeoverConfirmed: z.boolean().default(false),
  }),
) {}

export class ResumePresenceDto extends createStrictDto(
  z.object({
    presenceSessionId: z.string().uuid(),
    currentLocation: driverLocationCommandSchema,
  }),
) {}

export const driverLocationUpdateEventSchema = z
  .object({
    presenceSessionId: z.string().uuid(),
    leaseId: z.string().uuid(),
    sequence: z.number().int().positive(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().max(10_000),
    capturedAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    headingDegrees: z.number().min(0).max(360).optional(),
    speedMetersPerSecond: z.number().nonnegative().optional(),
  })
  .strict();

export type DriverLocationCommand = z.infer<typeof driverLocationCommandSchema>;
export type DriverLocationUpdateEvent = z.infer<
  typeof driverLocationUpdateEventSchema
>;
