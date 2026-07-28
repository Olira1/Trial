import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Wraps `createZodDto` so the resulting DTO always rejects unknown keys
 * (whitelist-only input). Use this for every request DTO in the project —
 * never call `createZodDto` directly.
 *
 * Note: only the outer object is auto-strict. Nested objects inside the
 * schema must apply `.strict()` themselves.
 */
export const createStrictDto = <T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
) => createZodDto(schema.strict());
