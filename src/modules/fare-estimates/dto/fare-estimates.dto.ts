import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';

const pointSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export class CreateFareEstimateDto extends createStrictDto(
  z.object({
    pickup: pointSchema,
    destination: pointSchema,
    vehicleType: z.literal('standard').default('standard'),
  }),
) {}
