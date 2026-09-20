import { Controller, Post, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private uploadsService: UploadsService) {}

  // No storage/dest configured -> multer's default MemoryStorage, so the
  // file lands in file.buffer and is streamed straight to Cloudinary
  // without ever touching this server's disk.
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.uploadsService.upload(file);
  }
}
