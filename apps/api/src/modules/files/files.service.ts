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
import { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';
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

/* Một câu, dùng cho MỌI nhánh không quy được phạm vi. Ba câu khác nhau cho ba nhánh là
 * kể cho người gọi biết file đó được trỏ tới từ đâu — thứ họ không được biết. */
const SCOPE_UNRESOLVED =
  'Không quy được file này về công ty hay nghĩa trang nào — không kiểm được phạm vi';

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
    private readonly scope: ScopeService,
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

  /* PHẠM VI CỦA MỘT FILE — quy NGƯỢC, vì bản thân file không có neo.
   *
   * `FileObject` KHÔNG có `companyId`, không có `cemeteryId`, không có gì ngoài
   * `uploadedBy`. Nên không hỏi trực tiếp được "file này thuộc công ty nào"; phải đi tìm
   * AI ĐANG TRỎ TỚI NÓ. Ba chỗ, tất cả đều là id LỎNG — hai schema, không khoá ngoại nối,
   * và không cột nào có index (nợ đã ghi ở bản giao):
   *
   *   1. `ExternalContract.contractFileId`  -> công ty + nghĩa trang qua phần mộ
   *   2. `BurialRecord.legalDocFileId`      -> nghĩa trang qua phần mộ
   *   3. `DeceasedPerson.deathCertFileId`   -> qua hồ sơ an táng của người đó
   *
   * File CHƯA ai trỏ tới thì neo duy nhất còn lại là NGƯỜI TẢI LÊN. Đây không phải trường
   * hợp hiếm: `presign` -> `confirm` diễn ra TRƯỚC khi file được gắn vào bản ghi nào, nên
   * mọi file vừa tải lên đều nằm ở trạng thái này. Cho chính người tải lên đọc file của họ
   * là đủ để hoàn tất luồng, và không mở cho ai khác.
   *
   * Không quy được, cũng không phải người tải lên, thì TỪ CHỐI. Giấy chứng tử và hợp đồng
   * là thứ rò ra thì không thu lại được, nên mặc định phải là chặn.
   */
  private async assertFileInScope(
    file: { id: string; uploadedBy: string | null },
    caller: Caller,
  ): Promise<void> {
    const contract = await this.prisma.externalContract.findFirst({
      where: { contractFileId: file.id },
      select: { companyId: true, gravePlotId: true },
    });
    if (contract !== null) {
      await this.scope.assertCompanyFor(caller.userId, caller.permission, contract.companyId);
      await this.assertPlotSite(contract.gravePlotId, caller);
      return;
    }

    const burial = await this.prisma.burialRecord.findFirst({
      where: { legalDocFileId: file.id },
      select: { gravePlotId: true },
    });
    if (burial !== null) {
      await this.assertPlotSite(burial.gravePlotId, caller);
      return;
    }

    const deceased = await this.prisma.deceasedPerson.findFirst({
      where: { deathCertFileId: file.id },
      select: { personId: true },
    });
    if (deceased !== null) {
      const rec = await this.prisma.burialRecord.findFirst({
        where: { deceasedPersonId: deceased.personId },
        select: { gravePlotId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (rec === null) {
        /* Giấy chứng tử của người CHƯA có hồ sơ an táng: không quy được về nghĩa trang nào.
         * Lược đồ đánh dấu tài liệu này `restricted`, nên chặn chứ không cho qua. */
        throw new ForbiddenException(SCOPE_UNRESOLVED);
      }
      await this.assertPlotSite(rec.gravePlotId, caller);
      return;
    }

    if (caller.userId !== null && file.uploadedBy === caller.userId) {
      return;
    }
    throw new ForbiddenException(SCOPE_UNRESOLVED);
  }

  /* Quy phần mộ về công ty + nghĩa trang. Không tìm thấy phần mộ thì TỪ CHỐI: không có khoá
   * ngoại nối nên con trỏ treo là chuyện xảy ra được, và lúc đó không kiểm được gì. */
  private async assertPlotSite(gravePlotId: string, caller: Caller): Promise<void> {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: gravePlotId },
      select: { companyId: true, cemeteryId: true },
    });
    if (plot === null) {
      throw new ForbiddenException(SCOPE_UNRESOLVED);
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, plot.companyId);
    await this.scope.assertSiteFor(caller.userId, caller.permission, plot.cemeteryId);
  }

  async getDownloadUrl(id: string, caller: Caller) {
    const file = await this.requireReadable(id, caller, 'FILE.DOWNLOAD_DENIED');
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
      actorId: caller.userId,
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
  async getMeta(id: string, caller: Caller) {
    return this.requireReadable(id, caller, 'FILE.META_DENIED');
  }

  private async requireReadable(id: string, caller: Caller, deniedAction: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (file === null) {
      throw new NotFoundException('Không tìm thấy file');
    }
    /* PHẠM VI trước, ĐỘ NHẠY sau — và phạm vi áp cho CẢ HAI nhánh độ nhạy.
     *
     * Tới 27/08/2026 hàm này chỉ hỏi độ nhạy: file `normal` thì ai cầm
     * `file.object.download` cũng tải được, còn file `restricted` thì ai cầm
     * `download_sensitive` cũng tải được — của MỌI công ty, chỉ cần biết id. Đây là hai
     * câu hỏi khác nhau: "tài liệu này nhạy tới đâu" và "tài liệu này của ai". Trả lời
     * một câu rồi bỏ câu kia là hở đúng một nửa. */
    await this.assertFileInScope(file, caller);
    if (file.sensitivity === PUBLIC_SENSITIVITY) {
      return file;
    }
    if (caller.userId !== null && (await this.holds(caller.userId, SENSITIVE_FILE_PERMISSION))) {
      return file;
    }
    await this.denied(caller.userId, deniedAction, id, `sensitivity=${file.sensitivity}`);
    throw new ForbiddenException(`Thiếu quyền: ${SENSITIVE_FILE_PERMISSION}`);
  }

  // Same rule as the route guard: a wildcard grant must not reach a wildcard-exempt
  // leaf, and an unknown code fails closed rather than matching nothing quietly.
  private async holds(userId: string, permission: string): Promise<boolean> {
    const meta = await this.permissions.getPermissionMeta(permission);
    if (meta === null) {
      return false;
    }
    const grants = await this.permissions.getGrants(userId);
    return grants.some((g) =>
      permissionMatches(g.permission, permission, { wildcardExempt: meta.wildcardExempt }),
    );
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
