import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { uploadSizeBytesSchema } from '../../storage/upload-limits';
import { documentTypeEnum } from '../schema/document.schema';

const schema = z.object({
  documentType: z.enum(documentTypeEnum.enumValues),
  mimeType: z.string().min(1).max(100),
  originalName: z.string().min(1).max(255),
  sizeBytes: uploadSizeBytesSchema,
});

export class UploadUrlDto extends createStrictDto(schema) {}
