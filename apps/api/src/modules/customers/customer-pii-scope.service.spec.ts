import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* ĐỌC CCCD ĐẦY ĐỦ — chỗ nhạy cảm nhất trong hệ, và tới 27/08/2026 nó không kiểm phạm vi
 * một dòng nào: gate `crm.person.view_sensitive` trả lời "có được xem CCCD hay không",
 * không trả lời "CCCD của AI". Ai cầm mã đó giải mã được CCCD của mọi nhân thân chỉ cần id.
 * Dữ liệu cá nhân theo NĐ 13/2023.
 *
 * `Person` không có `companyId` — nó là dữ liệu LIÊN CÔNG TY. Nên phạm vi phải QUY qua bản
 * ghi có neo: hồ sơ khách hàng trước, không có thì hồ sơ an táng. Không quy được thì chặn.
 */
const CALLER: Caller = { userId: 'u1', permission: 'crm.person.view_sensitive' };
const PERSON = 'per-1';

function build(
  over: {
    customer?: { companyId: string | null } | null;
    burial?: { gravePlotId: string } | null;
    plot?: { companyId: string; cemeteryId: string } | null;
    cipher?: string | null;
  } = {},
) {
  const {
    customer = { companyId: 'co-1' },
    burial = null,
    plot = { companyId: 'co-1', cemeteryId: 'nt-1' },
    cipher = 'cipher',
  } = over;

  const decrypt = vi.fn().mockReturnValue('079123456789');
  const record = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    person: { findUnique: vi.fn().mockResolvedValue({ id: PERSON, nationalIdCipher: cipher }) },
    customer: { findUnique: vi.fn().mockResolvedValue(customer) },
    burialRecord: { findFirst: vi.fn().mockResolvedValue(burial) },
    gravePlot: { findUnique: vi.fn().mockResolvedValue(plot) },
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertSiteFor = vi.fn().mockResolvedValue(undefined);
  const svc = new CustomersService(
    prisma,
    { decrypt } as unknown as PiiService,
    { record } as unknown as AuditService,
    { assertCompanyFor, assertSiteFor } as unknown as ScopeService,
  );
  return { svc, decrypt, record, assertCompanyFor, assertSiteFor };
}

describe('đọc CCCD đầy đủ — phạm vi quy qua bản ghi có neo', () => {
  it('quy qua HỒ SƠ KHÁCH HÀNG khi người đó là khách', async () => {
    const { svc, assertCompanyFor } = build({ customer: { companyId: 'co-1' } });

    await svc.revealNationalId(PERSON, CALLER);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'crm.person.view_sensitive', 'co-1');
  });

  /* `Customer.companyId` CHO PHÉP NULL. "Chỉ kiểm khi khác null" ở đây chính là fail-open:
   * mọi khách chưa gán công ty thành cửa mở. Null phải RƠI SANG neo sau, không phải cho qua. */
  it('khách chưa gán công ty thì RƠI SANG hồ sơ an táng, không phải cho qua', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build({
      customer: { companyId: null },
      burial: { gravePlotId: 'plot-1' },
    });

    await svc.revealNationalId(PERSON, CALLER);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'crm.person.view_sensitive', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'crm.person.view_sensitive', 'nt-1');
  });

  it('không phải khách nhưng CÓ hồ sơ an táng thì quy qua phần mộ — cả hai trục', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build({
      customer: null,
      burial: { gravePlotId: 'plot-1' },
    });

    await svc.revealNationalId(PERSON, CALLER);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'crm.person.view_sensitive', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'crm.person.view_sensitive', 'nt-1');
  });

  it('không quy được về đâu thì TỪ CHỐI — mặc định của đường đọc CCCD phải là chặn', async () => {
    const { svc, decrypt } = build({ customer: null, burial: null });

    await expect(svc.revealNationalId(PERSON, CALLER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('có hồ sơ an táng mà phần mộ đã biến mất thì cũng TỪ CHỐI', async () => {
    const { svc, decrypt } = build({
      customer: null,
      burial: { gravePlotId: 'plot-1' },
      plot: null,
    });

    await expect(svc.revealNationalId(PERSON, CALLER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(decrypt).not.toHaveBeenCalled();
  });

  /* Giải mã rồi mới chặn là đã đưa bản rõ vào bộ nhớ tiến trình cho người không được phép.
   * Chỉ cần một lần lỡ trả về là xong, nên thứ tự ở đây là bất biến, không phải thẩm mỹ. */
  it('NGOÀI phạm vi thì KHÔNG giải mã, và không ghi vết "đã xem"', async () => {
    const { svc, decrypt, record, assertCompanyFor } = build();
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.revealNationalId(PERSON, CALLER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(decrypt).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('không có dữ liệu CCCD thì 404 trước cả phép kiểm phạm vi', async () => {
    const { svc, assertCompanyFor } = build({ cipher: null });

    await expect(svc.revealNationalId(PERSON, CALLER)).rejects.toBeInstanceOf(NotFoundException);
    expect(assertCompanyFor).not.toHaveBeenCalled();
  });

  it('trong phạm vi thì trả CCCD và GHI VẾT đã xem — kiểm toán dữ liệu cá nhân', async () => {
    const { svc, record } = build();

    const out = await svc.revealNationalId(PERSON, CALLER);

    expect(out).toEqual({ personId: PERSON, nationalId: '079123456789' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PII.NATIONAL_ID_VIEWED', actorId: 'u1' }),
    );
  });
});
