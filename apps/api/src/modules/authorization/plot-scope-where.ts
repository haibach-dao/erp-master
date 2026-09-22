/* Dựng mệnh đề `where` từ bộ lọc phạm vi theo phần mộ — khai đúng MỘT lần.
 *
 * `ScopeService.plotScopeFilterFor` trả phạm vi THEO TỪNG CÔNG TY, vì hai danh sách phẳng
 * (công ty + nghĩa trang) không biểu diễn nổi "công ty A: cả công ty, công ty B: chỉ nghĩa
 * trang được giao". Chỗ nào cũng phải dịch cấu trúc đó thành `where` — và bảy nơi tự dịch là
 * bảy bản sẽ lệch nhau, đúng lớp lỗi mà `common/lifecycle/active.ts` sinh ra để dẹp.
 *
 * Tên cột nhận qua tham số vì mỗi bảng gọi một kiểu: `GravePlot` có `companyId`/`cemeteryId`,
 * còn `Cemetery` thì CHÍNH NÓ là nghĩa trang nên cột là `id`.
 */

export interface PlotScopeEntry {
  companyId: string;
  /** `null` = cả công ty. Mảng = chỉ những nghĩa trang đó; RỖNG = không với tới gì. */
  cemeteryIds: string[] | null;
}

export interface PlotScopeColumns {
  company: string;
  cemetery: string;
}

const MAC_DINH: PlotScopeColumns = { company: 'companyId', cemetery: 'cemeteryId' };

/* `null` vào → `null` ra, nghĩa là KHÔNG bó gì (chỉ mức GROUP nhận được).
 *
 * Danh sách RỖNG ra `{ OR: [] }`? KHÔNG — Prisma coi `OR: []` là "không dòng nào thoả", đúng
 * ý ta, nhưng dựa vào một quy ước ngầm của thư viện cho một quyết định phân quyền là mỏng.
 * Trả một mệnh đề không bao giờ đúng, tường minh, để đọc mã là thấy ngay.
 */
export function plotScopeWhere(
  filter: PlotScopeEntry[] | null,
  cols: PlotScopeColumns = MAC_DINH,
): Record<string, unknown> | null {
  if (filter === null) {
    return null;
  }
  if (filter.length === 0) {
    // Không công ty nào: với tới KHÔNG bản ghi nào. Không phải "không lọc".
    return { [cols.company]: { in: [] } };
  }
  return {
    OR: filter.map((e) =>
      e.cemeteryIds === null
        ? { [cols.company]: e.companyId }
        : { [cols.company]: e.companyId, [cols.cemetery]: { in: e.cemeteryIds } },
    ),
  };
}
