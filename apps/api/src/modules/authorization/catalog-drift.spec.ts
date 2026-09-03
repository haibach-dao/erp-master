import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG } from './permission-catalog';
import {
  diffCatalogAgainstDatabase,
  totalDrift,
  type CatalogPermission,
  type StoredPermission,
} from './catalog-drift';

/* Test cho HÀM THUẦN. Không có Postgres ở đây và cũng không cần: CI không dựng CSDL, nên
 * phần duy nhất canh được trên CI là phép so — dữ liệu thật do
 * `scripts/authz-catalog-check.ts` mang tới. */

const CARD_SIGNER_VIEW: CatalogPermission = {
  code: 'cemetery.card_signer.view',
  sensitivity: 'S1',
  wildcardExempt: false,
};
const CARD_SIGNER_UPDATE: CatalogPermission = {
  code: 'config.card_signer.update',
  sensitivity: 'S3',
  wildcardExempt: true,
};
const PLOT_VIEW: CatalogPermission = {
  code: 'cemetery.plot.view',
  sensitivity: 'S1',
  wildcardExempt: false,
};

const stored = (
  def: CatalogPermission,
  over: Partial<StoredPermission> = {},
): StoredPermission => ({
  code: def.code,
  sensitivity: def.sensitivity,
  wildcardExempt: def.wildcardExempt,
  ...over,
});

describe('diffCatalogAgainstDatabase — khớp hoàn toàn', () => {
  it('không báo gì khi CSDL chụp đúng danh mục', () => {
    const catalog = [PLOT_VIEW, CARD_SIGNER_VIEW, CARD_SIGNER_UPDATE];
    const drift = diffCatalogAgainstDatabase(
      catalog,
      catalog.map((d) => stored(d)),
    );

    expect(drift.missingInDatabase).toEqual([]);
    expect(drift.orphanedInDatabase).toEqual([]);
    expect(drift.metadataMismatches).toEqual([]);
    expect(totalDrift(drift)).toBe(0);
  });

  it('thứ tự khác nhau không phải là lệch — CSDL trả về theo thứ tự của nó', () => {
    const catalog = [PLOT_VIEW, CARD_SIGNER_VIEW, CARD_SIGNER_UPDATE];
    const shuffled = [stored(CARD_SIGNER_UPDATE), stored(PLOT_VIEW), stored(CARD_SIGNER_VIEW)];

    expect(totalDrift(diffCatalogAgainstDatabase(catalog, shuffled))).toBe(0);
  });

  it('hai danh sách rỗng cũng là khớp, không phải lỗi', () => {
    expect(totalDrift(diffCatalogAgainstDatabase([], []))).toBe(0);
  });
});

describe('diffCatalogAgainstDatabase — nhóm 1: THIẾU MÃ (lỗi 03/09/2026)', () => {
  it('bắt đúng hai mã mới chưa seed, và không nhận nhầm sang nhóm khác', () => {
    /* Dựng lại chính xác sự cố: hai mã người ký được thêm vào danh mục, triển khai chạy
     * `prisma migrate deploy` (không seed), nên CSDL vẫn là ảnh cũ. */
    const catalog = [PLOT_VIEW, CARD_SIGNER_VIEW, CARD_SIGNER_UPDATE];
    const database = [stored(PLOT_VIEW)];

    const drift = diffCatalogAgainstDatabase(catalog, database);

    expect(drift.missingInDatabase.map((d) => d.code)).toEqual([
      'cemetery.card_signer.view',
      'config.card_signer.update',
    ]);
    expect(drift.orphanedInDatabase).toEqual([]);
    expect(drift.metadataMismatches).toEqual([]);
    expect(totalDrift(drift)).toBe(2);
  });

  it('CSDL rỗng: mọi mã đều thiếu, không có mã nào bị coi là thừa', () => {
    const drift = diffCatalogAgainstDatabase([PLOT_VIEW, CARD_SIGNER_VIEW], []);

    expect(drift.missingInDatabase).toHaveLength(2);
    expect(drift.orphanedInDatabase).toEqual([]);
  });
});

describe('diffCatalogAgainstDatabase — nhóm 2: MÃ THỪA', () => {
  it('bắt dòng CSDL không còn trong mã nguồn', () => {
    /* `config.tag.update` là mã thừa THẬT, đo được trên CSDL dev 03/09/2026: còn dòng
     * trong `authz.permissions` và còn được cấp cho ADMIN|GROUP và QT_NGHIEP_VU|GROUP,
     * trong khi `git log -S` không tìm thấy nó ở bất kỳ commit nào. */
    const catalog = [PLOT_VIEW];
    const database = [
      stored(PLOT_VIEW),
      { code: 'config.tag.update', sensitivity: 'S3', wildcardExempt: true },
    ];

    const drift = diffCatalogAgainstDatabase(catalog, database);

    expect(drift.orphanedInDatabase.map((d) => d.code)).toEqual(['config.tag.update']);
    expect(drift.missingInDatabase).toEqual([]);
    expect(drift.metadataMismatches).toEqual([]);
  });

  it('thiếu và thừa cùng lúc không triệt tiêu nhau — hai nhóm, hai cách sửa', () => {
    /* Đổi tên một mã cho ra đúng hình này. Tổng số dòng hai bên bằng nhau (1 và 1), nên
     * phép đếm sẽ báo "khớp" trong khi thực tế có một tính năng chết VÀ một quyền mồ côi
     * còn mở. Đây là lý do không được dùng số đếm làm gác. */
    const drift = diffCatalogAgainstDatabase(
      [CARD_SIGNER_UPDATE],
      [{ code: 'config.tag.update', sensitivity: 'S3', wildcardExempt: true }],
    );

    expect(drift.missingInDatabase.map((d) => d.code)).toEqual(['config.card_signer.update']);
    expect(drift.orphanedInDatabase.map((d) => d.code)).toEqual(['config.tag.update']);
    expect(totalDrift(drift)).toBe(2);
  });
});

describe('diffCatalogAgainstDatabase — nhóm 3: LỆCH SIÊU DỮ LIỆU', () => {
  it('bắt `wildcardExempt` tụt về false — đường leo thang tới leaf S3', () => {
    const drift = diffCatalogAgainstDatabase(
      [CARD_SIGNER_UPDATE],
      [stored(CARD_SIGNER_UPDATE, { wildcardExempt: false })],
    );

    expect(drift.metadataMismatches).toEqual([
      {
        code: 'config.card_signer.update',
        field: 'wildcardExempt',
        inSource: 'true',
        inDatabase: 'false',
      },
    ]);
    expect(drift.missingInDatabase).toEqual([]);
    expect(drift.orphanedInDatabase).toEqual([]);
  });

  it('bắt `sensitivity` lệch — màn hình ma trận đọc cột này từ CSDL', () => {
    const drift = diffCatalogAgainstDatabase(
      [CARD_SIGNER_UPDATE],
      [stored(CARD_SIGNER_UPDATE, { sensitivity: 'S1' })],
    );

    expect(drift.metadataMismatches).toEqual([
      {
        code: 'config.card_signer.update',
        field: 'sensitivity',
        inSource: 'S3',
        inDatabase: 'S1',
      },
    ]);
  });

  it('một mã lệch cả hai trường thì ra HAI dòng, không gộp', () => {
    const drift = diffCatalogAgainstDatabase(
      [CARD_SIGNER_UPDATE],
      [stored(CARD_SIGNER_UPDATE, { sensitivity: 'S1', wildcardExempt: false })],
    );

    expect(drift.metadataMismatches.map((m) => m.field)).toEqual(['sensitivity', 'wildcardExempt']);
    expect(totalDrift(drift)).toBe(2);
  });

  it('giá trị rác trong cột `sensitivity` vẫn bị bắt, không làm hàm ném', () => {
    /* Cột là `String` không có CHECK, nên nó giữ được bất cứ chuỗi nào. */
    const drift = diffCatalogAgainstDatabase(
      [PLOT_VIEW],
      [stored(PLOT_VIEW, { sensitivity: 'S9' })],
    );

    expect(drift.metadataMismatches[0]?.inDatabase).toBe('S9');
  });
});

describe('diffCatalogAgainstDatabase — trên danh mục thật', () => {
  it('so danh mục thật với chính nó là 0 lệch — và đó chính là phép so vô dụng', () => {
    /* Ca này KHÔNG canh được gì về CSDL, và cố ý viết ra để nói điều đó: `prisma/seed.ts`
     * import thẳng `PERMISSION_CATALOG`, nên "catalog vs CSDL vừa seed" là so một danh
     * sách với chính nó. Nó chỉ canh một việc nhỏ: hàm không tự sinh lệch giả trên 150
     * dòng thật. */
    const snapshot = PERMISSION_CATALOG.map((def) => stored(def));

    expect(totalDrift(diffCatalogAgainstDatabase(PERMISSION_CATALOG, snapshot))).toBe(0);
  });

  it('xoá một dòng khỏi ảnh CSDL thì đúng dòng đó hiện ra ở nhóm THIẾU MÃ', () => {
    const snapshot = PERMISSION_CATALOG.filter(
      (def) => def.code !== 'cemetery.card_signer.view',
    ).map((def) => stored(def));

    const drift = diffCatalogAgainstDatabase(PERMISSION_CATALOG, snapshot);

    expect(drift.missingInDatabase.map((d) => d.code)).toEqual(['cemetery.card_signer.view']);
    expect(drift.orphanedInDatabase).toEqual([]);
    expect(drift.metadataMismatches).toEqual([]);
  });
});
