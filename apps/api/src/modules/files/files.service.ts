import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ConfirmUploadDto, PresignUploadDto } from './files.dto';

const UPLOAD_URL_TTL = 300;
const DOWNLOAD_URL_TTL = 120;

@Injectable()
export class FilesService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.bucket = this.config.get<string>('S3_BUCKET') ?? 'erp-files';
    this.s3 = new S3Client({
      endpoint: this.config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000',
      region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true, // required for MinIO
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY') ?? 'minioadmin',
        secretAccessKey: this.config.get<string>('S3_SECRET_KEY') ?? 'minioadmin',
      },
    });
  }

  async presignUpload(dto: PresignUploadDto, uploadedBy: string | null) {
    const id = ulid();
    const storageKey = `${id}/${dto.fileName}`;
    await this.prisma.fileObject.create({
      data: {
        id,
        storageKey,
        originalName: dto.fileName,
        mimeType: dto.mimeType,
        sensitivity: dto.sensitivity ?? 'normal',
        uploadedBy,
      },
    });
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, ContentType: dto.mimeType }),
      { expiresIn: UPLOAD_URL_TTL },
    );
    return { fileId: id, storageKey, uploadUrl, expiresIn: UPLOAD_URL_TTL };
  }

  async confirmUpload(id: string, dto: ConfirmUploadDto) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (file === null) {
      throw new NotFoundException('Không tìm thấy file');
    }
    // Virus scan is out of scope in dev (VIRUS_SCAN_ENABLED=false) → mark clean.
    const scanEnabled = this.config.get<string>('VIRUS_SCAN_ENABLED') === 'true';
    return this.prisma.fileObject.update({
      where: { id },
      data: {
        status: 'uploaded',
        scanStatus: scanEnabled ? 'pending' : 'clean',
        sizeBytes: dto.sizeBytes ?? null,
      },
    });
  }

  async getDownloadUrl(id: string, actor: string | null) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (file === null) {
      throw new NotFoundException('Không tìm thấy file');
    }
    if (file.scanStatus !== 'clean') {
      throw new ConflictException(`File chưa sẵn sàng tải (scan=${file.scanStatus})`);
    }
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: file.storageKey }),
      { expiresIn: DOWNLOAD_URL_TTL },
    );
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'DOCUMENT.DOWNLOADED',
      entityType: 'file',
      entityId: id,
      result: 'SUCCESS',
    });
    return { url, expiresIn: DOWNLOAD_URL_TTL };
  }

  async getMeta(id: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (file === null) {
      throw new NotFoundException('Không tìm thấy file');
    }
    return file;
  }
}
