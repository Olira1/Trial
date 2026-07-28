import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';

export class ListDispatchAssignmentsHistoryDto extends createStrictDto(
  z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
) {}
