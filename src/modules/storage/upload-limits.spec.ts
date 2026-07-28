import { MAX_UPLOAD_SIZE_BYTES, uploadSizeBytesSchema } from './upload-limits';

describe('uploadSizeBytesSchema', () => {
  it('accepts sizes from 1 byte through 10 MiB', () => {
    expect(uploadSizeBytesSchema.parse(1)).toBe(1);
    expect(uploadSizeBytesSchema.parse(MAX_UPLOAD_SIZE_BYTES)).toBe(
      MAX_UPLOAD_SIZE_BYTES,
    );
  });

  it.each([undefined, 0, -1, 1.5, MAX_UPLOAD_SIZE_BYTES + 1])(
    'rejects invalid upload size %p',
    (sizeBytes) => {
      expect(() => uploadSizeBytesSchema.parse(sizeBytes)).toThrow();
    },
  );
});
