import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_CATALOG } from './permission-catalog';
import {
  diffCatalogAgainstDatabase,
  totalDrift,
  type CatalogDrift,
  type StoredPermission,
} from './catalog-drift';

/* NGƯỜI GÁC LỆCH DANH MỤC QUYỀN — chạy một lần lúc API khởi động.
 *
 * Ratchet `permission-catalog-invariants` ép mã mới phải kèm migration, nên chuyện lệch không
 * nên xảy ra nữa. Nhưng nó chỉ canh được MÃ NGUỒN. Một CSDL đang chạy vẫn có thể lệch vì những
 * lý do nằm ngoài mã nguồn: migrate chạy dở, khôi phục từ một bản sao lưu cũ, hoặc — đúng như
 * ngày 03/09/2026 — một nhánh có mã mới được bật lên trên một CSDL chưa ai seed. Ratchet chặn
 * lệch MỚI; người gác này thấy được lệch ĐANG CÓ.
 *
 *
 * BA ĐIỀU KHÔNG LÀM, mỗi điều một lý do đo được:
 *
 * 1. KHÔNG CHẶN BOOT, ở mọi môi trường, không ngoại lệ.
 *    Vì thiếu mã KHÔNG BAO GIỜ cấp thừa cho ai: `permission.guard.ts` gọi `getPermissionMeta`,
 *    không có dòng thì trả `null` và guard ném `ForbiddenException` ngay trước khi hỏi ma trận
 *    vai — fail-closed, ADMIN cũng bị chặn. Nên lệch chiều này chỉ làm CHẾT TÍNH NĂNG. Chặn boot
 *    là đổi một sự cố ngừng dịch vụ CHẮC CHẮN lấy việc phòng một rủi ro KHÔNG TỒN TẠI. Tệ hơn:
 *    API chết thì không ai đăng nhập được, kể cả người cầm quyền đi sửa nó.
 *    Chỗ chặn cứng đặt TRƯỚC đó một bước — `pnpm --filter @erp/api check:permissions` thoát 1 và
 *    làm hỏng BƯỚC TRIỂN KHAI, khi chưa ai mất dịch vụ.
 *
 * 2. KHÔNG TỰ VÁ. Không chèn dòng thiếu, không sửa siêu dữ liệu, không đụng `authz.permissions`.
 *    Thiếu mã nghĩa là ĐƯỜNG MIGRATION ĐÃ HỎNG, và đó là tín hiệu phải to lên chứ không phải
 *    được vá êm. Vá êm thì người bỏ bước không bao giờ học được là mình đã bỏ bước.
 *
 * 3. KHÔNG PHÂN BIỆT MÔI TRƯỜNG. Kiểm ở mọi môi trường, báo ở mọi môi trường, ghi ở không môi
 *    trường nào. Một cái cổng do biến môi trường quyết định là một cái cổng sẽ mở sai ở đúng cái
 *    máy quên đặt biến.
 *
 * Và chính nó được bọc `try/catch`: người gác không được phép làm chết cái nó đi gác.
 */
@Injectable()
export class CatalogSentryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogSentryService.name);

  /* `null` = chưa đo được (chưa boot xong, hoặc lần đo vừa rồi hỏng). Cố ý phân biệt với "đo
   * rồi, không lệch" — `/health` phải nói được là mình KHÔNG BIẾT, thay vì báo an toàn. */
  private drift: CatalogDrift | null = null;
  private checkedAt: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows: StoredPermission[] = await this.prisma.permission.findMany({
        select: { code: true, sensitivity: true, wildcardExempt: true },
      });
      const drift = diffCatalogAgainstDatabase(PERMISSION_CATALOG, rows);
      this.drift = drift;
      this.checkedAt = new Date().toISOString();
      this.report(drift);
    } catch (err) {
      /* Nuốt có chủ ý, và nói ra là mình đã nuốt. CSDL chưa lên lúc boot là chuyện bình thường ở
       * local; để lỗi này thoát ra là người gác tự làm chết API — đúng thứ điều 1 cấm. */
      this.drift = null;
      this.checkedAt = null;
      this.logger.warn(
        `Chưa đối chiếu được danh mục quyền với CSDL (${err instanceof Error ? err.message : String(err)}). ` +
          'API vẫn chạy. Chạy `pnpm --filter @erp/api check:permissions` để đối chiếu tay.',
      );
    }
  }

  /* Ba nhóm báo RIÊNG, vì cách sửa của chúng khác hẳn nhau và một dòng "lệch N mã" không nói
   * được phải làm gì. Mức ERROR chứ không WARN: WARN ở đây là thứ đã trôi qua một lần rồi. */
  private report(drift: CatalogDrift): void {
    if (totalDrift(drift) === 0) return;

    if (drift.missingInDatabase.length > 0) {
      this.logger.error(
        `LỆCH DANH MỤC QUYỀN — ${drift.missingInDatabase.length} mã có trong mã nguồn nhưng THIẾU trong CSDL: ` +
          `${drift.missingInDatabase.map((d) => d.code).join(', ')}. ` +
          'Mọi người dùng, kể cả ADMIN, sẽ bị chặn ở các mã này và màn hình dùng chúng sẽ rỗng ' +
          'mà không có lý do. Sửa: `pnpm --filter @erp/api db:seed` (chỉ thêm dòng danh mục, ' +
          'không cấp cho ai), rồi kiểm lại bằng `check:permissions`.',
      );
    }

    if (drift.orphanedInDatabase.length > 0) {
      this.logger.error(
        `LỆCH DANH MỤC QUYỀN — ${drift.orphanedInDatabase.length} mã còn trong CSDL nhưng KHÔNG còn trong mã nguồn: ` +
          `${drift.orphanedInDatabase.map((d) => d.code).join(', ')}. ` +
          'Nhóm này nguy hiểm hơn nhóm thiếu: mã vẫn cấp được từ màn hình quản trị và vẫn mở cửa ' +
          'được, trong khi đọc mã nguồn không thấy nó ở đâu. Seed KHÔNG xoá gì — phải viết ' +
          'migration xoá cả dòng danh mục lẫn `role_permissions` trỏ vào nó.',
      );
    }

    if (drift.metadataMismatches.length > 0) {
      this.logger.error(
        `LỆCH DANH MỤC QUYỀN — ${drift.metadataMismatches.length} mã khác siêu dữ liệu giữa mã nguồn và CSDL: ` +
          `${drift.metadataMismatches.map((m) => `${m.code}.${m.field} (nguồn ${m.inSource} / CSDL ${m.inDatabase})`).join(', ')}. ` +
          '`wildcardExempt` lệch là LEO THANG quyền — một grant `*` với tới được leaf S3. Sửa: ' +
          '`pnpm --filter @erp/api db:seed`.',
      );
    }
  }

  /* Bản tóm tắt cho `GET /health`.
   *
   * CHỈ SỐ ĐẾM, KHÔNG TÊN MÃ — cố ý, và đây là chỗ dễ làm sai nhất. `/health` là route `@Public`,
   * ai gõ được địa chỉ cũng đọc được. Trả ra danh sách mã quyền ở đó là phát cho người lạ bản đồ
   * bề mặt quyền của hệ thống, đổi lấy một tiện lợi mà log và `check:permissions` đã cho rồi.
   * Số đếm đủ để trả lời câu hỏi duy nhất cần trả lời từ xa: "máy này có lệch không".
   *
   * `null` nghĩa là CHƯA ĐO ĐƯỢC, không phải "không lệch". Hai thứ đó không được lẫn. */
  summary(): {
    checkedAt: string | null;
    missing: number | null;
    orphan: number | null;
    meta: number | null;
  } {
    const drift = this.drift;
    if (drift === null) {
      return { checkedAt: null, missing: null, orphan: null, meta: null };
    }
    return {
      checkedAt: this.checkedAt,
      missing: drift.missingInDatabase.length,
      orphan: drift.orphanedInDatabase.length,
      meta: drift.metadataMismatches.length,
    };
  }
}
