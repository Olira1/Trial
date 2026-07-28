import { z } from 'zod';

const timestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));

const pointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export const FareEstimateResponseSchema = z.object({
  id: z.uuid(),
  pickup: pointSchema,
  destination: pointSchema,
  vehicleType: z.literal('standard'),
  currency: z.literal('ETB'),
  distanceMeters: z.number().int().positive(),
  durationSeconds: z.number().int().positive(),
  rateMinorPerKm: z.number().int().positive(),
  estimatedFareMinor: z.number().int().nonnegative(),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});

export type FareEstimateResponse = z.infer<typeof FareEstimateResponseSchema>;
