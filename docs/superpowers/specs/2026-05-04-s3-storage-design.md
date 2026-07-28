# S3 Storage Migration Design

**Date:** 2026-05-04
**Status:** Approved

## Summary

Replace the local-disk storage provider with a single AWS S3 provider that issues pre-signed PUT URLs for uploads and pre-signed GET URLs for downloads. The server never buffers file content — clients upload directly to S3.

## Motivation

The existing `LocalDiskProvider` writes files to the server's local filesystem, which doesn't work in containerised or multi-instance deployments. S3 (or any S3-compatible service) gives durable, scalable blob storage with access control via pre-signed URLs.

## Architecture

One `S3Provider` class using `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. No driver enum or switching logic. The provider is instantiated directly in `StorageModule` using injected config.

### Upload flow

1. Client requests an upload URL from the backend (e.g. `POST /api/v1/documents/upload-url`).
2. Backend calls `storageService.getUploadUrl({ originalName, mimeType, folder })` → S3Provider generates a pre-signed `PutObjectCommand` URL and a deterministic key (`folder/uuid.ext`).
3. Backend returns `{ url, key }` to the client.
4. Client `PUT`s the file directly to the pre-signed URL.
5. Client submits the key to the backend as part of the resource creation request.

### Download flow

1. Client requests a resource that contains a `storageKey`.
2. Backend calls `storageService.getDownloadUrl(key)` → S3Provider generates a pre-signed `GetObjectCommand` URL with a 1-hour TTL.
3. Backend returns the pre-signed URL in the response.

## Interface

```ts
type UploadUrlInput = {
  originalName: string;
  mimeType: string;
  folder: string;
};

type StorageProvider = {
  getUploadUrl(input: UploadUrlInput): Promise<{ url: string; key: string }>;
  getDownloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
};
```

`StorageService` exposes the same three methods, delegating to the provider.

## Configuration

New env vars (all required except `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`):

| Variable               | Description                                      | Default     |
| ---------------------- | ------------------------------------------------ | ----------- |
| `S3_BUCKET`            | Bucket name                                      | —           |
| `S3_REGION`            | AWS region                                       | —           |
| `S3_ACCESS_KEY_ID`     | Access key                                       | —           |
| `S3_SECRET_ACCESS_KEY` | Secret key                                       | —           |
| `S3_ENDPOINT`          | Custom endpoint URL (for S3-compatible services) | `undefined` |
| `S3_FORCE_PATH_STYLE`  | Use path-style URLs (`true` for local endpoints) | `false`     |

`STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, and `STORAGE_PUBLIC_BASE_URL` are removed from `env.schema.ts` and `.env.example`.

`StorageConfig` type becomes:

```ts
type StorageConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle: boolean;
};
```

## Files

| Action | Path                                              |
| ------ | ------------------------------------------------- |
| Delete | `src/modules/storage/local-disk.provider.ts`      |
| Delete | `src/modules/storage/local-disk.provider.spec.ts` |
| Add    | `src/modules/storage/s3.provider.ts`              |
| Add    | `src/modules/storage/s3.provider.spec.ts`         |
| Modify | `src/modules/storage/storage.types.ts`            |
| Modify | `src/modules/storage/storage.service.ts`          |
| Modify | `src/modules/storage/storage.module.ts`           |
| Modify | `src/config/storage.config.ts`                    |
| Modify | `src/config/env.schema.ts`                        |
| Modify | `.env.example`                                    |

## Testing

`s3.provider.spec.ts` mocks `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Tests verify:

- `getUploadUrl` produces a key of the form `folder/uuid.ext`, calls `PutObjectCommand` with correct bucket, key, and content-type, and returns the pre-signed URL from the presigner.
- `getDownloadUrl` calls `GetObjectCommand` with correct bucket and key, passes `expiresIn: 3600`, and returns the pre-signed URL.
- `delete` calls `DeleteObjectCommand` with correct bucket and key.

No real AWS credentials are needed in CI.

## Out of scope

- Migrating existing `storageKey` values in the database (no live data yet).
- Multipart upload for large files.
- Removing `multer` from the project (still used elsewhere).
