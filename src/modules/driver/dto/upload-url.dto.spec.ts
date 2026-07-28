import { UploadUrlDto } from './upload-url.dto';

describe('UploadUrlDto', () => {
  it('accepts a valid document upload request', () => {
    expect(
      UploadUrlDto.schema.parse({
        documentType: 'driver_license_front',
        mimeType: 'image/jpeg',
        originalName: 'license.jpg',
        sizeBytes: 1024,
      }),
    ).toEqual({
      documentType: 'driver_license_front',
      mimeType: 'image/jpeg',
      originalName: 'license.jpg',
      sizeBytes: 1024,
    });
  });

  it('requires sizeBytes', () => {
    expect(() =>
      UploadUrlDto.schema.parse({
        documentType: 'driver_license_front',
        mimeType: 'image/jpeg',
        originalName: 'license.jpg',
      }),
    ).toThrow();
  });
});
