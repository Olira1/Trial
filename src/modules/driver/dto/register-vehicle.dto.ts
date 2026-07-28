import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';

const baseSchema = z.object({
  ownershipType: z.enum(['owner', 'representative']),
  make: z.string().min(1).max(50),
  model: z.string().min(1).max(50),
  color: z.string().min(1).max(30),
  year: z
    .number()
    .int()
    .min(1886)
    .max(new Date().getFullYear() + 1),
  plateRegion: z.enum(['aa', 'or', 'ah', 'dr', 'tg']),
  plateCode: z.enum(['01', '02', '03']),
  plateCodeSubtype: z.enum(['transport_service', 'other']).optional(),
  plateNumber: z.string().min(1).max(20),
  tinNumber: z.string().trim().min(1).max(50).optional(),
});

const schema = baseSchema.strict().superRefine((val, ctx) => {
  if (val.plateCode === '03' && !val.plateCodeSubtype) {
    ctx.addIssue({
      code: 'custom',
      path: ['plateCodeSubtype'],
      message: 'plateCodeSubtype is required when plateCode is 03',
    });
  }

  if (val.plateCode !== '03' && val.plateCodeSubtype !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['plateCodeSubtype'],
      message: 'plateCodeSubtype is only allowed when plateCode is 03',
    });
  }

  if (
    (val.plateCode === '01' ||
      (val.plateCode === '03' &&
        val.plateCodeSubtype === 'transport_service')) &&
    !val.tinNumber
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['tinNumber'],
      message: 'tinNumber is required for this plate qualification',
    });
  }
});

export class RegisterVehicleDto extends createStrictDto(baseSchema) {
  static readonly schema = schema;
}
