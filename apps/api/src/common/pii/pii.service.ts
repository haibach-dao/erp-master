import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { maskNationalId } from './mask-national-id';

// Handles sensitive identifiers (e.g. CCCD): AES-256-GCM encryption (viewable with
// permission), sha256 hash for duplicate detection, and masking for display (G0-E5.2/A6).
@Injectable()
export class PiiService {
  private readonly logger = new Logger(PiiService.name);

  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    const raw = this.config.get<string>('ENCRYPTION_KEY');
    if (raw === undefined || raw.length === 0) {
      this.logger.warn(
        'ENCRYPTION_KEY not set — using an insecure dev key. Set it before production.',
      );
    }
    // Derive a fixed 32-byte key regardless of input length.
    return createHash('sha256')
      .update(raw !== undefined && raw.length > 0 ? raw : 'dev-encryption-key')
      .digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, encB64] = payload.split(':');
    if (ivB64 === undefined || tagB64 === undefined || encB64 === undefined) {
      throw new Error('Invalid cipher payload');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  hash(value: string): string {
    return createHash('sha256').update(this.normalize(value)).digest('hex');
  }

  /* Uỷ cho hàm thuần dùng chung với `MaskingInterceptor`. Xem `mask-national-id.ts` về
   * lý do hai nơi phải che GIỐNG HỆT nhau. */
  mask(value: string): string {
    return maskNationalId(value);
  }

  private normalize(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
  }
}
