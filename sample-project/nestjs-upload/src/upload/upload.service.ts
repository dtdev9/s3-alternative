import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MinioService } from '../minio/minio.service';
import { unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';

export interface UploadResult {
  objectName: string;
  originalName: string;
  size: number;
  mimetype: string;
  etag: string;
  url: string;
  uploadedAt: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly minio: MinioService) {}

  /**
   * Upload a file that was saved to disk by Multer.
   * Streams it directly to MinIO (no extra memory allocation).
   * Ideal for large files (2–4 GB).
   */
  async uploadFromDisk(file: Express.Multer.File): Promise<UploadResult> {
    const objectName = `${uuidv4()}${extname(file.originalname)}`;

    this.logger.log(
      `Uploading ${file.originalname} → ${objectName} (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
    );

    let etag = '';
    try {
      const result = await this.minio.uploadFile(
        objectName,
        file.path,
        file.mimetype,
      );
      etag = result.etag;
    } finally {
      // Always clean up the temp file from disk
      await unlink(file.path).catch(() => null);
    }

    const url = await this.minio.getPresignedUrl(objectName);

    return {
      objectName,
      originalName: file.originalname,
      size:         file.size,
      mimetype:     file.mimetype,
      etag,
      url,
      uploadedAt:   new Date().toISOString(),
    };
  }

  async getFileUrl(objectName: string): Promise<string> {
    try {
      await this.minio.getObjectInfo(objectName);
    } catch {
      throw new NotFoundException(`Object '${objectName}' not found`);
    }
    return this.minio.getPresignedUrl(objectName);
  }

  async deleteFile(objectName: string): Promise<void> {
    try {
      await this.minio.getObjectInfo(objectName);
    } catch {
      throw new NotFoundException(`Object '${objectName}' not found`);
    }
    await this.minio.deleteObject(objectName);
    this.logger.log(`Deleted ${objectName}`);
  }

  async listFiles(prefix?: string) {
    return this.minio.listObjects(prefix);
  }
}
