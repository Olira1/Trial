import {
  ReplaceDocumentDto,
  ReplaceDocumentParamsDto,
} from './replace-document.dto';

describe('replace document DTOs', () => {
  it('accepts a valid document type path param', () => {
    expect(
      ReplaceDocumentParamsDto.schema.parse({
        documentType: 'driver_license_front',
      }),
    ).toEqual({ documentType: 'driver_license_front' });
  });

  it('rejects an invalid document type path param', () => {
    expect(() =>
      ReplaceDocumentParamsDto.schema.parse({
        documentType: 'passport',
      }),
    ).toThrow();
  });

  it('accepts a replacement storage key body', () => {
    expect(
      ReplaceDocumentDto.schema.parse({
        storageKey: 'documents/user-1/driver_license_front/new.jpg',
      }),
    ).toEqual({
      storageKey: 'documents/user-1/driver_license_front/new.jpg',
    });
  });

  it('rejects extra replacement body fields', () => {
    expect(() =>
      ReplaceDocumentDto.schema.parse({
        storageKey: 'documents/user-1/driver_license_front/new.jpg',
        documentType: 'driver_license_front',
      }),
    ).toThrow();
  });
});
