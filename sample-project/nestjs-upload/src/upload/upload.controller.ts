import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  /**
   * POST /upload
   *
   * Upload a single file (multipart/form-data, field name: "file").
   * Multer streams it to a temp dir then we push it to MinIO via multipart upload.
   *
   * Example:
   *   curl -X POST http://localhost:3000/upload \
   *        -F "file=@/path/to/large-file.mp4"
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided. Use field name "file".');
    }

    this.logger.log(`Received: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    const result = await this.uploadService.uploadFromDisk(file);

    return {
      success:    true,
      message:    'File uploaded successfully',
      data:       result,
    };
  }

  /**
   * GET /upload
   *
   * List all uploaded files.
   * Optional ?prefix= query to filter by path prefix.
   *
   * Example:
   *   curl http://localhost:3000/upload
   *   curl http://localhost:3000/upload?prefix=videos/
   */
  @Get()
  async listFiles(@Query('prefix') prefix?: string) {
    const files = await this.uploadService.listFiles(prefix);
    return {
      success: true,
      count:   files.length,
      data:    files,
    };
  }

  /**
   * GET /upload/:objectName/url
   *
   * Get a fresh presigned download URL for an existing object.
   *
   * Example:
   *   curl http://localhost:3000/upload/abc123.mp4/url
   */
  @Get(':objectName/url')
  async getUrl(@Param('objectName') objectName: string) {
    const url = await this.uploadService.getFileUrl(objectName);
    return {
      success: true,
      data:    { objectName, url },
    };
  }

  /**
   * DELETE /upload/:objectName
   *
   * Delete an uploaded file from MinIO.
   *
   * Example:
   *   curl -X DELETE http://localhost:3000/upload/abc123.mp4
   */
  @Delete(':objectName')
  @HttpCode(HttpStatus.OK)
  async deleteFile(@Param('objectName') objectName: string) {
    await this.uploadService.deleteFile(objectName);
    return {
      success: true,
      message: `File '${objectName}' deleted`,
    };
  }
}
