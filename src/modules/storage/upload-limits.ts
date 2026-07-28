import { z } from 'zod';

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export const uploadSizeBytesSchema = z.int().min(1).max(MAX_UPLOAD_SIZE_BYTES);
