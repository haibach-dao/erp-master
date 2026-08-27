import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { PermissionsService } from '../authorization/permissions.service';
import type { PermissionGrant } from '../authorization/policy.types';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const SITE = 'nt-1';

/* Hai đường ĐỌC mang mã quyền riêng, vì phạm vi tính theo TỪNG mã. */
const download = (userId: string): Caller => ({ userId, permission: 'file.object.download' });
const view = (userId: string): Caller => ({ userId, permission: 'file.object.view' });

function fileRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'file-1',
    storageKey: 'file-1/cccd.pdf',
    originalName: 'cccd.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    sensitivity: 'restricted',
    scanStatus: 'clean',
    status: 'uploaded',
    uploadedBy: OWNER,
    ...over,
  };
}

function build(opts: {
  file?: unknown;
  grants?: PermissionGrant[];
  env?: Record<string, string>;
  wildcardExempt?: boolean;
  /* Ai đang TRỎ TỚI file. Mặc định: một hợp đồng — để nhóm test độ nhạy ở dưới kiểm đúng
   * trục độ nhạy, không bị phép kiểm phạm vi chặn trước và báo sai chỗ hỏng. */
  contract?: { companyId: string; gravePlotId: string } | null;
  burial?: { gravePlotId: string } | null;
  deceased?: { personId: string } | null;
  deceasedBurial?: { gravePlotId: string } | null;
  plot?: { companyId: string; cemeteryId: string } | null;
}) {
  const findUnique = vi.fn().mockResolvedValue(opts.file ?? null);
  const update = vi.fn().mockImplementation((args: unknown) => Promise.resolve(args));
  const record = vi.fn().mockResolvedValue(undefined);
  const getGrants = vi.fn().mockResolvedValue(opts.grants ?? []);
  const getPermissionMeta = vi.fn().mockResolvedValue({
    code: 'file.object.download_sensitive',
    sensitivity: 'S3',
    wildcardExempt: opts.wildcardExempt ?? true,
  });
  const env: Record<string, string> = { APP_ENV: 'development', ...(opts.env ?? {}) };

  const contractFindFirst = vi
    .fn()
    .mockResolvedValue(
      opts.contract === undefined ? { companyId: 'co-1', gravePlotId: 'plot-1' } : opts.contract,
    );
  /* `burialRecord.findFirst` bị gọi ở HAI chỗ khác nhau: tìm theo `legalDocFileId`, và tìm
   * hồ sơ an táng của người đã mất. Phân biệt bằng chính mệnh đề `where` — dùng một giá trị
   * chung cho cả hai là để test xanh vì lý do sai. */
  const burialFindFirst = vi
    .fn()
    .mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'legalDocFileId' in args.where ? (opts.burial ?? null) : (opts.deceasedBurial ?? null),
      ),
    );
  const deceasedFindFirst = vi.fn().mockResolvedValue(opts.deceased ?? null);
  const plotFindUnique = vi
    .fn()
    .mockResolvedValue(
      opts.plot === undefined ? { companyId: 'co-1', cemeteryId: SITE } : opts.plot,
    );

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertSiteFor = vi.fn().mockResolvedValue(undefined);

  const svc = new FilesService(
    {
      fileObject: { findUnique, update, create: vi.fn() },
      externalContract: { findFirst: contractFindFirst },
      burialRecord: { findFirst: burialFindFirst },
      deceasedPerson: { findFirst: deceasedFindFirst },
      gravePlot: { findUnique: plotFindUnique },
    } as unknown as PrismaService,
    { get: (key: string) => env[key] } as never,
    { record } as unknown as AuditService,
    { getGrants, getPermissionMeta } as unknown as PermissionsService,
    { assertCompanyFor, assertSiteFor } as unknown as ScopeService,
  );
  return {
    svc,
    findUnique,
    update,
    record,
    getGrants,
    assertCompanyFor,
    assertSiteFor,
    plotFindUnique,
  };
}

describe('FilesService — sensitive files are gated, not merely authenticated', () => {
  it('refuses a restricted file to a caller without the permission, and audits the refusal', async () => {
    const { svc, record } = build({ file: fileRow(), grants: [] });
    await expect(svc.getDownloadUrl('file-1', download(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FILE.DOWNLOAD_DENIED',
        result: 'DENIED',
        actorId: OTHER,
      }),
    );
  });

  it('refuses restricted METADATA too — storageKey would otherwise leak', async () => {
    const { svc } = build({ file: fileRow(), grants: [] });
    await expect(svc.getMeta('file-1', view(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a wildcard grant on a wildcard-exempt leaf — carrying data out must be named', async () => {
    const { svc } = build({
      file: fileRow(),
      grants: [{ permission: '*.*.*', scope: 'GROUP' }],
    });
    await expect(svc.getMeta('file-1', view(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a caller who holds the leaf by name', async () => {
    const { svc } = build({
      file: fileRow(),
      grants: [{ permission: 'file.object.download_sensitive', scope: 'GROUP' }],
    });
    await expect(svc.getMeta('file-1', view(OTHER))).resolves.toMatchObject({ id: 'file-1' });
  });

  it('leaves normal files readable by any authenticated caller', async () => {
    const { svc } = build({ file: fileRow({ sensitivity: 'normal' }), grants: [] });
    await expect(svc.getMeta('file-1', view(OTHER))).resolves.toMatchObject({ sensitivity: 'normal' });
  });

  it('still 404s an unknown file before any permission talk', async () => {
    const { svc } = build({ file: null });
    await expect(svc.getMeta('nope', view(OTHER))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps refusing a file that has not been scanned clean', async () => {
    const { svc } = build({
      file: fileRow({ sensitivity: 'normal', scanStatus: 'pending' }),
    });
    await expect(svc.getDownloadUrl('file-1', download(OTHER))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FilesService.confirmUpload — only the uploader closes their own upload', () => {
  it('refuses a confirm from someone who did not upload the file', async () => {
    const { svc, update, record } = build({ file: fileRow({ status: 'pending_upload' }) });
    await expect(svc.confirmUpload('file-1', {}, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FILE.CONFIRM_DENIED', result: 'DENIED' }),
    );
  });

  it('refuses an unauthenticated confirm', async () => {
    const { svc, update } = build({ file: fileRow({ status: 'pending_upload' }) });
    await expect(svc.confirmUpload('file-1', {}, null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts the uploader', async () => {
    const { svc, update } = build({ file: fileRow({ status: 'pending_upload' }) });
    await svc.confirmUpload('file-1', { sizeBytes: 42 }, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'uploaded' }) }),
    );
  });
});

describe('FilesService — an env flag must not be what decides security', () => {
  it('outside development, an unscanned file stays pending even with scanning switched off', async () => {
    const { svc, update } = build({
      file: fileRow({ status: 'pending_upload' }),
      env: { APP_ENV: 'production', VIRUS_SCAN_ENABLED: 'false' },
    });
    await svc.confirmUpload('file-1', {}, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'pending' }) }),
    );
  });

  it('in development the bypass still works, so the local upload flow is not broken', async () => {
    const { svc, update } = build({
      file: fileRow({ status: 'pending_upload' }),
      env: { APP_ENV: 'development', VIRUS_SCAN_ENABLED: 'false' },
    });
    await svc.confirmUpload('file-1', {}, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'clean' }) }),
    );
  });

  it('with scanning enabled the file waits for a real scanner in every environment', async () => {
    const { svc, update } = build({
      file: fileRow({ status: 'pending_upload' }),
      env: { APP_ENV: 'development', VIRUS_SCAN_ENABLED: 'true' },
    });
    await svc.confirmUpload('file-1', {}, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'pending' }) }),
    );
  });
});

/* TRỤC PHẠM VI. `FileObject` không có `companyId`, không có `cemeteryId` — không có neo nào
 * ngoài `uploadedBy`. Nên tới 27/08/2026 module này có ZERO lời gọi `scope.`: ai cầm
 * `file.object.download` tải được mọi file `normal` của mọi công ty, và ai cầm
 * `download_sensitive` tải được mọi file `restricted` — chỉ cần biết id.
 *
 * Phạm vi phải quy NGƯỢC qua bản ghi đang trỏ tới file.
 */
describe('FilesService — phạm vi quy ngược từ bản ghi đang trỏ tới file', () => {
  it('file của HỢP ĐỒNG: quy về công ty của hợp đồng và nghĩa trang của phần mộ', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: { companyId: 'co-1', gravePlotId: 'plot-1' },
    });

    await svc.getMeta('file-1', view(OTHER));

    expect(assertCompanyFor).toHaveBeenCalledWith(OTHER, 'file.object.view', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith(OTHER, 'file.object.view', SITE);
  });

  it('file GIẤY TỜ PHÁP LÝ của hồ sơ an táng: quy về nghĩa trang của phần mộ', async () => {
    const { svc, assertSiteFor } = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: null,
      burial: { gravePlotId: 'plot-1' },
    });

    await svc.getMeta('file-1', view(OTHER));

    expect(assertSiteFor).toHaveBeenCalledWith(OTHER, 'file.object.view', SITE);
  });

  it('GIẤY CHỨNG TỬ: quy qua hồ sơ an táng của người đã mất', async () => {
    const { svc, assertSiteFor } = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: null,
      burial: null,
      deceased: { personId: 'per-1' },
      deceasedBurial: { gravePlotId: 'plot-1' },
    });

    await svc.getMeta('file-1', view(OTHER));

    expect(assertSiteFor).toHaveBeenCalledWith(OTHER, 'file.object.view', SITE);
  });

  it('giấy chứng tử của người CHƯA có hồ sơ an táng thì TỪ CHỐI, không cho qua', async () => {
    const { svc } = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: null,
      burial: null,
      deceased: { personId: 'per-1' },
      deceasedBurial: null,
    });

    await expect(svc.getMeta('file-1', view(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  /* `presign` -> `confirm` xảy ra TRƯỚC khi file được gắn vào bản ghi nào, nên "chưa ai trỏ
   * tới" là trạng thái BÌNH THƯỜNG của file vừa tải lên, không phải ngoại lệ hiếm. */
  it('file CHƯA ai trỏ tới: chính người tải lên đọc được', async () => {
    const { svc } = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: null,
      burial: null,
      deceased: null,
    });

    await expect(svc.getMeta('file-1', view(OWNER))).resolves.toMatchObject({ id: 'file-1' });
  });

  it('file CHƯA ai trỏ tới: người KHÁC thì không', async () => {
    const { svc } = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: null,
      burial: null,
      deceased: null,
    });

    await expect(svc.getMeta('file-1', view(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('con trỏ TREO tới phần mộ đã biến mất thì TỪ CHỐI — không có khoá ngoại nối', async () => {
    const { svc } = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: { companyId: 'co-1', gravePlotId: 'plot-1' },
      plot: null,
    });

    await expect(svc.getMeta('file-1', view(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  /* Phạm vi áp cho CẢ HAI nhánh độ nhạy. File `normal` không có nghĩa là "của ai cũng được". */
  it('file NORMAL ngoài phạm vi vẫn bị chặn — normal không phải công khai', async () => {
    const { svc, assertCompanyFor } = build({ file: fileRow({ sensitivity: 'normal' }) });
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.getMeta('file-1', view(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ngoài phạm vi thì KHÔNG phát URL tải, dù file đã scan sạch', async () => {
    const { svc, assertSiteFor } = build({
      file: fileRow({ sensitivity: 'normal', scanStatus: 'clean' }),
    });
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(svc.getDownloadUrl('file-1', download(OTHER))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /* Ba nhánh không quy được đều trả CÙNG một câu. Ba câu khác nhau là kể cho người gọi biết
   * file đó được trỏ tới từ đâu — thứ họ không được biết. */
  it('mọi nhánh không quy được phạm vi đều nói CÙNG một câu', async () => {
    const orphan = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: null,
      burial: null,
      deceased: null,
    });
    const dangling = build({
      file: fileRow({ sensitivity: 'normal' }),
      contract: { companyId: 'co-1', gravePlotId: 'plot-1' },
      plot: null,
    });

    const a = await orphan.svc.getMeta('file-1', view(OTHER)).catch((e: Error) => e.message);
    const b = await dangling.svc.getMeta('file-1', view(OTHER)).catch((e: Error) => e.message);
    expect(a).toBe(b);
  });
});
