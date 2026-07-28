import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { DISPATCH_CANCELLATION_REASON_CODES } from '../dispatch-cancellation.types';

export class DispatchCancellationDto extends createStrictDto(
  z
    .object({
      reasonCode: z.enum(DISPATCH_CANCELLATION_REASON_CODES).optional(),
      notes: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
) {}
