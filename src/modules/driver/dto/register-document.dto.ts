import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { documentTypeEnum } from '../schema/document.schema';

const schema = z.object({
  documentType: z.enum(documentTypeEnum.enumValues),
  storageKey: z.string().min(1).max(255),
});

export class RegisterDocumentDto extends createStrictDto(schema) {}
