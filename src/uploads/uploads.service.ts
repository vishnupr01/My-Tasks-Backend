import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse, type UploadApiErrorResponse } from 'cloudinary';

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_PREFIXES = ['image/', 'video/', 'audio/'];

export type AttachmentType = 'image' | 'video' | 'audio' | 'file';

@Injectable()
export class UploadsService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  private attachmentType(mimetype: string): AttachmentType {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'file';
  }

  // Cloudinary files everything as one of 'image' | 'video' | 'raw' -- audio
  // rides under 'video' (its transcoding/streaming pipeline handles audio
  // too), non-media stays 'raw'. This is separate from the finer-grained
  // AttachmentType we store, which is what the frontend actually renders on.
  private resourceType(mimetype: string): 'image' | 'video' | 'raw' {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/') || mimetype.startsWith('audio/')) return 'video';
    return 'raw';
  }

  async upload(file?: Express.Multer.File): Promise<{ url: string; type: AttachmentType; name: string }> {
    if (!file) throw new BadRequestException('No file provided');
    if (file.size > MAX_BYTES) throw new BadRequestException('File too large (25MB max)');
    if (!ALLOWED_PREFIXES.some(prefix => file.mimetype.startsWith(prefix))) {
      throw new BadRequestException('Unsupported file type -- only images, video, and audio are allowed');
    }

    const resourceType = this.resourceType(file.mimetype);

    let result: UploadApiResponse;
    try {
      result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: resourceType,
            folder: 'taskflow-chat',
            // Signed uploads on this account consistently return an opaque
            // 403 no matter the timestamp, folder, or signature algorithm
            // (verified directly against the API, see chat history) --
            // something at the account or network level blocks the signed
            // upload path specifically. Unsigned (preset-based) is the one
            // approach confirmed to actually work end-to-end.
            unsigned: true,
            upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET,
          },
          (err, res) => {
            if (err || !res) reject(err ?? new Error('Cloudinary upload returned no result'));
            else resolve(res);
          },
        );
        stream.end(file.buffer);
      });
    } catch (err) {
      const cloudinaryErr = err as UploadApiErrorResponse;
      // The Cloudinary SDK's own error swallows almost everything useful by
      // the time it reaches a generic exception handler -- log the real
      // http_code/message here so a 403/401 (bad credentials, disabled
      // resource type, etc.) is actually diagnosable instead of a bare 500.
      Logger.error(
        `Cloudinary upload failed (resource_type=${resourceType}, mimetype=${file.mimetype}): ` +
          `http_code=${cloudinaryErr?.http_code} message=${cloudinaryErr?.message}`,
        cloudinaryErr?.stack,
        UploadsService.name,
      );
      throw new InternalServerErrorException(
        cloudinaryErr?.message ? `Upload failed: ${cloudinaryErr.message}` : 'Upload failed',
      );
    }

    return {
      url: result.secure_url,
      type: this.attachmentType(file.mimetype),
      name: file.originalname,
    };
  }
}
