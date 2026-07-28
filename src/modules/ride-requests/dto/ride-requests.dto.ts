import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { DISPATCH_CANCELLATION_REASON_CODES } from '../../dispatch-offer/dispatch-cancellation.types';

export const pointSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export class CreateRideRequestDto extends createStrictDto(
  z.object({
    pickup: pointSchema,
    destination: pointSchema,
    fareEstimateId: z.uuid(),
    idempotencyKey: z.string().min(1).max(255),
  }),
) {}

export class CancelRideRequestDto extends createStrictDto(
  z
    .object({
      reasonCode: z.enum(DISPATCH_CANCELLATION_REASON_CODES).optional(),
      notes: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
) {}
