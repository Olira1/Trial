export type UploadUrlInput = {
  originalName: string;
  mimeType: string;
  folder: string;
  sizeBytes: number;
};

export type StorageProvider = {
  getUploadUrl(input: UploadUrlInput): Promise<{ url: string; key: string }>;
  getDownloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
};
