import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { storageConfig } from '../../config';
import { S3Provider } from './s3.provider';
import { STORAGE_PROVIDER, StorageService } from './storage.service';
import { type StorageProvider } from './storage.types';

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>): StorageProvider =>
        new S3Provider(config),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
