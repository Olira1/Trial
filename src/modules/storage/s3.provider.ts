import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { type StorageConfig } from '../../config';
import { type StorageProvider, type UploadUrlInput } from './storage.types';

const DOWNLOAD_TTL_SECONDS = 3600;
const UPLOAD_TTL_SECONDS = 300;

export class S3Provider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: fromNodeProviderChain(),
      ...(config.endpoint && {
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
      }),
    });
  }

  async getUploadUrl({
    originalName,
    mimeType,
    folder,
    sizeBytes,
  }: UploadUrlInput): Promise<{ url: string; key: string }> {
    const ext = extname(originalName);
    const key = `${folder}/${randomUUID()}${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_TTL_SECONDS,
    });
    return { url, key };
  }

  async getDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, {
      expiresIn: DOWNLOAD_TTL_SECONDS,
    });
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: this.bucket, Key: key });
    await this.client.send(command);
  }
}
