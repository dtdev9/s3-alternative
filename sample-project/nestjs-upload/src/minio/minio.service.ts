import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client;
  private bucket: string;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'uploads');

    this.client = new Minio.Client({
      endPoint:  this.config.get<string>('MINIO_ENDPOINT', 'localhost'),
      port:      parseInt(this.config.get<string>('MINIO_PORT', '9001')),
      useSSL:    this.config.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: this.config.get<string>('MINIO_SECRET_KEY', 'minioadmin'),
    });

    await this.ensureBucket();
  }

  // ── Bucket ────────────────────────────────────────────────────────────────

  private async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Bucket '${this.bucket}' created`);
    } else {
      this.logger.log(`Bucket '${this.bucket}' ready`);
    }
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  /**
   * Upload a file buffer to MinIO.
   * The SDK automatically uses multipart upload for large files.
   */
  async uploadBuffer(
    objectName: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<Minio.UploadedObjectInfo> {
    return this.client.putObject(
      this.bucket,
      objectName,
      buffer,
      buffer.length,
      { 'Content-Type': mimetype },
    );
  }

  /**
   * Upload a file from disk path to MinIO using multipart upload.
   * Best for large files (2–4 GB) — streams directly from disk.
   */
  async uploadFile(
    objectName: string,
    filePath: string,
    mimetype: string,
    partSize = 100 * 1024 * 1024, // 100 MB per part
  ): Promise<Minio.UploadedObjectInfo> {
    return this.client.fPutObject(
      this.bucket,
      objectName,
      filePath,
      { 'Content-Type': mimetype, partSize },
    );
  }

  /**
   * Upload a readable stream to MinIO.
   * Use when you want to stream directly without buffering to disk.
   */
  async uploadStream(
    objectName: string,
    stream: NodeJS.ReadableStream,
    size: number,
    mimetype: string,
  ): Promise<Minio.UploadedObjectInfo> {
    return this.client.putObject(
      this.bucket,
      objectName,
      stream,
      size,
      { 'Content-Type': mimetype },
    );
  }

  // ── Presigned URL ─────────────────────────────────────────────────────────

  /**
   * Generate a presigned GET URL (default expiry: 7 days).
   */
  async getPresignedUrl(objectName: string, expiry = 7 * 24 * 60 * 60): Promise<string> {
    return this.client.presignedGetObject(this.bucket, objectName, expiry);
  }

  // ── Object info ───────────────────────────────────────────────────────────

  async getObjectInfo(objectName: string): Promise<Minio.BucketItemStat> {
    return this.client.statObject(this.bucket, objectName);
  }

  async deleteObject(objectName: string): Promise<void> {
    return this.client.removeObject(this.bucket, objectName);
  }

  async listObjects(prefix = ''): Promise<Minio.BucketItem[]> {
    return new Promise((resolve, reject) => {
      const items: Minio.BucketItem[] = [];
      const stream = this.client.listObjectsV2(this.bucket, prefix, true);
      stream.on('data', (item) => items.push(item));
      stream.on('end',  () => resolve(items));
      stream.on('error', reject);
    });
  }
}
