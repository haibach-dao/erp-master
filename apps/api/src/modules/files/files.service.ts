import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../authorization/permissions.service';
import { permissionMatches } from '../authorization/policy-evaluator';
import { AuditService } from '../audit/audit.service';
import type { ConfirmUploadDto, PresignUploadDto } from './files.dto';

const UPLOAD_URL_TTL = 300;
const DOWNLOAD_URL_TTL = 120;

/* Reading a `confidential`/`restricted` file is a separate decision from being logged in.
 * This is a FIELD/BEHAVIOUR gate, checked here rather than on the route: a route carries
 * exactly one @RequirePermission code, and that slot belongs to "may call this endpoint".
 *
 * `file.object.download` (the route gate) says the caller may use the endpoint at all;
 * `file.object.download_sensitive` says they may carry a confidential/restricted file
 * out. Two different risks, so two codes — doc 16 §D.7 split the old shared code for
 * exactly this reason.
 */
const SENSITIVE_FILE_PERMISSION = 'file.object.download_sensitive';
const PUBLIC_SENSITIVITY = 'normal';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
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
        sensitivity: dto.sensitivity ?? PUBLIC_SENSITIVITY,
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

  // Only the uploader may close their own upload. Without this, knowing any fileId is
  // enough to flip another user's record to `uploaded` and release it for download.
  async confirmUpload(id: string, dto: ConfirmUploadDto, actor: string | null) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (file === null) {
      throw new NotFoundException('Không tìm thấy file');
    }
    if (actor === null || file.uploadedBy !== actor) {
      await this.denied(actor, 'FILE.CONFIRM_DENIED', id, 'Không phải người tải lên');
      throw new ForbiddenException('Chỉ người tải lên mới xác nhận được file này');
    }
    return this.prisma.fileObject.update({
      where: { id },
      data: {
        status: 'uploaded',
        scanStatus: this.scanStatusAfterUpload(id),
        sizeBytes: dto.sizeBytes ?? null,
      },
    });
  }

  async getDownloadUrl(id: string, actor: string | null) {
    const file = await this.requireReadable(id, actor, 'FILE.DOWNLOAD_DENIED');
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
      reason: `sensitivity=${file.sensitivity}`,
    });
    return { url, expiresIn: DOWNLOAD_URL_TTL };
  }

  // Metadata carries `storageKey` and `sensitivity`, so it is gated exactly like the
  // download. Returning it freely would leak the object key of every restricted file.
  async getMeta(id: string, actor: string | null) {
    return this.requireReadable(id, actor, 'FILE.META_DENIED');
  }

  private async requireReadable(id: string, actor: string | null, deniedAction: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (file === null) {
      throw new NotFoundException('Không tìm thấy file');
    }
    if (file.sensitivity === PUBLIC_SENSITIVITY) {
      return file;
    }
    if (actor !== null && (await this.holds(actor, SENSITIVE_FILE_PERMISSION))) {
      return file;
    }
    await this.denied(actor, deniedAction, id, `sensitivity=${file.sensitivity}`);
    throw new ForbiddenException(`Thiếu quyền: ${SENSITIVE_FILE_PERMISSION}`);
  }

  private async holds(userId: string, permission: string): Promise<boolean> {
    const grants = await this.permissions.getGrants(userId);
    return grants.some((g) => permissionMatches(g.permission, permission));
  }

  /* A file nobody scanned must not become downloadable just because scanning happens to
   * be switched off. The bypass is a DEV convenience and is refused outside development:
   * in any other APP_ENV the file stays `pending` until a real scanner clears it.
   * (Blueprint doc 16 §D.11: an env flag must not be the thing that decides security.)
   */
  private scanStatusAfterUpload(fileId: string): string {
    if (this.config.get<string>('VIRUS_SCAN_ENABLED') === 'true') {
      return 'pending';
    }
    const appEnv = this.config.get<string>('APP_ENV') ?? 'development';
    if (appEnv !== 'development' && appEnv !== 'test') {
      return 'pending';
    }
    this.logger.warn(
      `[dev] VIRUS_SCAN_ENABLED=false: file ${fileId} được đánh dấu clean mà KHÔNG quét virus`,
    );
    return 'clean';
  }

  private async denied(
    actor: string | null,
    action: string,
    fileId: string,
    reason: string,
  ): Promise<void> {
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action,
      entityType: 'file',
      entityId: fileId,
      result: 'DENIED',
      reason,
    });
  }
}
