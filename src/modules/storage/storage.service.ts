import { Inject, Injectable } from '@nestjs/common';
import { type StorageProvider, type UploadUrlInput } from './storage.types';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
  ) {}

  getUploadUrl(input: UploadUrlInput): Promise<{ url: string; key: string }> {
    return this.provider.getUploadUrl(input);
  }

  getDownloadUrl(key: string): Promise<string> {
    return this.provider.getDownloadUrl(key);
  }

  delete(key: string): Promise<void> {
    return this.provider.delete(key);
  }
}
