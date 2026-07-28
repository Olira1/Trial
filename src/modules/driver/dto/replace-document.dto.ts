import { z } from 'zod';
import { createStrictDto } from '../../../common/dto';
import { documentTypeEnum } from '../schema/document.schema';

export class ReplaceDocumentParamsDto extends createStrictDto(
  z.object({
    documentType: z.enum(documentTypeEnum.enumValues),
  }),
) {}

export class ReplaceDocumentDto extends createStrictDto(
  z.object({
    storageKey: z.string().min(1).max(255),
  }),
) {}
