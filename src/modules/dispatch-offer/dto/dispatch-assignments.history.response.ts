import { z } from 'zod';
import { RideRequestResponseSchema } from '../../ride-requests/dto/ride-requests.response';

export const DispatchAssignmentsHistoryResponseSchema = z.object({
  items: z.array(RideRequestResponseSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
