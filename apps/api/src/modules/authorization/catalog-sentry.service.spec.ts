import { describe, expect, it, vi } from 'vitest';
import { CatalogSentryService } from './catalog-sentry.service';
import { PERMISSION_CATALOG } from './permission-catalog';
import type { PrismaService } from '../../prisma/prisma.service';

/* NGƯỜI GÁC LỆCH DANH MỤC QUYỀN.
 *
 * Bộ này canh đúng ba lời hứa mà chú thích của service đưa ra, vì cả ba đều là loại hứa mà một
 * lần sửa vô ý là gãy: không chặn boot · không ghi gì · nói được là mình CHƯA BIẾT.
 *
 * Việc so sánh đã có `catalog-drift.spec.ts` canh riêng — ở đây không lặp lại nó.
 */

/* Ảnh chụp CSDL "đúng khớp": chép thẳng từ danh mục, vì đó là thứ seed tạo ra. */
function inSync() {
  return PERMISSION_CATALOG.map((d) => ({
    code: d.code,
    sensitivity: d.sensitivity,
    wildcardExempt: d.wildcardExempt,
  }));
}

function build(rows: unknown) {
  const findMany = vi.fn();
  if (rows instanceof Error) findMany.mockRejectedValue(rows);
  else findMany.mockResolvedValue(rows);

  /* CHỈ có `findMany`. Không phải vì lười dựng mock: bất kỳ lệnh ghi nào service gọi cũng sẽ nổ
   * "is not a function" ngay tại chỗ, nên chính hình dạng của mock này là phép kiểm "không ghi". */
  const prisma = { permission: { findMany } } as unknown as PrismaService;
  const svc = new CatalogSentryService(prisma);
  return { svc, prisma, findMany };
}

describe('người gác lệch danh mục quyền', () => {
  it('CSDL khớp thì không lệch, và nói rõ đã đo lúc nào', async () => {
    const { svc } = build(inSync());
    await svc.onApplicationBootstrap();

    const s = svc.summary();
    expect(s.missing).toBe(0);
    expect(s.orphan).toBe(0);
    expect(s.meta).toBe(0);
    expect(s.checkedAt).not.toBeNull();
  });

  it('CSDL thiếu mã thì đếm đúng — đây là lỗi 03/09/2026', async () => {
    const thieu = inSync().filter(
      (r) => r.code !== 'cemetery.card_signer.view' && r.code !== 'config.card_signer.update',
    );
    const { svc } = build(thieu);
    await svc.onApplicationBootstrap();

    expect(svc.summary().missing).toBe(2);
  });

  it('CSDL còn mã đã bỏ khỏi mã nguồn thì đếm vào nhóm THỪA, không phải nhóm thiếu', async () => {
    const { svc } = build([
      ...inSync(),
      { code: 'ma.da.bo', sensitivity: 'S1', wildcardExempt: false },
    ]);
    await svc.onApplicationBootstrap();

    expect(svc.summary().orphan).toBe(1);
    expect(svc.summary().missing).toBe(0);
  });

  /* Lời hứa số 1. Bộ gác không được phép làm chết cái nó đi gác — CSDL chưa lên lúc boot là
   * chuyện bình thường ở máy local, và một API không lên được vì thế là tệ hơn hẳn thứ nó tránh. */
  it('CSDL hỏng thì KHÔNG ném ra ngoài — boot vẫn đi tiếp', async () => {
    const { svc } = build(new Error('connect ECONNREFUSED'));
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  /* Lời hứa số 3. "Chưa đo được" và "đo rồi, không lệch" phải phân biệt được từ ngoài; lẫn hai
   * thứ đó là báo AN TOÀN cho một cái máy chưa ai nhìn vào. */
  it('chưa đo được thì trả null, KHÔNG trả 0', async () => {
    const { svc } = build(new Error('connect ECONNREFUSED'));
    expect(svc.summary()).toEqual({ checkedAt: null, missing: null, orphan: null, meta: null });

    await svc.onApplicationBootstrap();
    expect(svc.summary()).toEqual({ checkedAt: null, missing: null, orphan: null, meta: null });
  });

  /* Lời hứa số 2. `/health` là route @Public — bản tóm tắt không được mang tên mã quyền ra cho
   * người chưa đăng nhập, dù log và `check:permissions` có in đầy đủ. */
  it('bản tóm tắt chỉ có SỐ ĐẾM, không lộ tên mã quyền nào', async () => {
    const thieu = inSync().filter((r) => r.code !== 'config.card_signer.update');
    const { svc } = build(thieu);
    await svc.onApplicationBootstrap();

    const dump = JSON.stringify(svc.summary());
    expect(dump).not.toContain('card_signer');
    expect(dump).not.toContain('config.');
  });

  it('chỉ ĐỌC bảng quyền, không gọi một lệnh ghi nào', async () => {
    const { svc, findMany } = build(inSync());
    await svc.onApplicationBootstrap();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
