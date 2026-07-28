import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Provider } from './s3.provider';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

const mockGetSignedUrl = jest.mocked(getSignedUrl);
const mockSend = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(S3Client)
    .mockImplementation(() => ({ send: mockSend }) as unknown as S3Client);
});

const config = {
  bucket: 'test-bucket',
  region: 'us-east-1',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  forcePathStyle: false,
};

describe('S3Provider', () => {
  let provider: S3Provider;

  beforeEach(() => {
    provider = new S3Provider(config);
  });

  describe('getUploadUrl', () => {
    it('returns a pre-signed PUT URL and a key of the form folder/uuid.ext', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://presigned.example.com/put',
      );

      const result = await provider.getUploadUrl({
        originalName: 'photo.jpg',
        mimeType: 'image/jpeg',
        folder: 'documents',
        sizeBytes: 1024,
      });

      expect(result.url).toBe('https://presigned.example.com/put');
      expect(result.key).toMatch(/^documents\/[0-9a-f-]{36}\.jpg$/);
      expect(jest.mocked(PutObjectCommand)).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: result.key,
        ContentType: 'image/jpeg',
        ContentLength: 1024,
      });
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('generates a key with no extension when the file has none', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://presigned.example.com/put',
      );

      const result = await provider.getUploadUrl({
        originalName: 'README',
        mimeType: 'text/plain',
        folder: 'docs',
        sizeBytes: 42,
      });

      expect(result.key).toMatch(/^docs\/[0-9a-f-]{36}$/);
    });

    it('passes expiresIn: 300 to getSignedUrl for PUT', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://presigned.example.com/put',
      );

      await provider.getUploadUrl({
        originalName: 'a.jpg',
        mimeType: 'image/jpeg',
        folder: 'documents',
        sizeBytes: 1024,
      });

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 300 },
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a pre-signed GET URL', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://presigned.example.com/get',
      );

      const url = await provider.getDownloadUrl('documents/abc.jpg');

      expect(url).toBe('https://presigned.example.com/get');
    });

    it('constructs GetObjectCommand with the correct bucket and key', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://presigned.example.com/get',
      );

      await provider.getDownloadUrl('documents/abc.jpg');

      expect(jest.mocked(GetObjectCommand)).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'documents/abc.jpg',
      });
    });

    it('passes expiresIn: 3600 to getSignedUrl', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://presigned.example.com/get',
      );

      await provider.getDownloadUrl('documents/abc.jpg');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 },
      );
    });
  });

  describe('delete', () => {
    it('sends a DeleteObjectCommand with the correct bucket and key', async () => {
      mockSend.mockResolvedValueOnce({});

      await provider.delete('documents/abc.jpg');

      expect(jest.mocked(DeleteObjectCommand)).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'documents/abc.jpg',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
