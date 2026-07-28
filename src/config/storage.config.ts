import { registerAs } from '@nestjs/config';
import { env } from './env.schema';

export type StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
};

export const storageConfig = registerAs('storage', (): StorageConfig => {
  const e = env();
  return {
    bucket: e.S3_BUCKET,
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
  };
});
