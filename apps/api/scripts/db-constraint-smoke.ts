/* Thử xem các ràng buộc CSDL có THẬT SỰ CHẶN không.
 *
 *   pnpm --filter @erp/api exec tsx scripts/db-constraint-smoke.ts
 *
 * VÌ SAO CẦN. `CHECK` và partial unique index chỉ tồn tại trong SQL thuần của migration —
 * `schema.prisma` không diễn tả được chúng, `prisma migrate diff` không nhìn thấy chúng, và
 * mock Prisma trong vitest không dựng lại được chúng. Nghĩa là hôm nay chúng KHÔNG có một
 * phép kiểm tự động nào: một migration gõ sai điều kiện `WHERE` sẽ áp trót lọt, mọi test xanh,
 * và ràng buộc lặng lẽ không chặn gì cả.
 *
 * Đó không phải lo xa. Chính repo này đã ghi lại một lần `CHECK` bị vô hiệu vì chạm cột NULL
 * (biểu thức ra NULL thì `CHECK` cho qua) — nếp `IS TRUE` ra đời từ đó. Một cái bọc `IS TRUE`
 * viết sai chỗ trông y hệt một cái viết đúng.
 *
 * MỌI PHÉP THỬ NẰM TRONG GIAO DỊCH VÀ ROLLBACK — script này không để lại một dòng nào.
 *
 * Có ca `nhận` chứ không chỉ ca `chặn`, và đó là phần quan trọng nhất: một index chặn được thứ
 * phải chặn nhưng cũng chặn luôn thứ phải cho qua là một index đã hỏng theo chiều khó thấy hơn.
 * Ca `card_signers`: MỘT người được làm mặc định ở HAI nghĩa trang cùng lúc — đó chính là ca
 * thật của anh Bách (một người đang quản lý cả hai nghĩa trang), và nếu ai đó "sửa cho gọn"
 * index mặc định về lại toàn hệ thì ca này đỏ, còn không gì khác trong repo thấy được.
 */
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from './_env';

loadDotEnv();

const prisma = new PrismaClient();

/* Ném ra để buộc Prisma cuộn giao dịch lại, kể cả khi mọi lệnh đều chạy trót lọt. */
const ROLLBACK = Symbol('rollback');

interface Case {
  /** Câu mô tả đọc lên là hiểu luật nghiệp vụ, không phải tên ràng buộc. */
  readonly name: string;
  readonly statements: readonly string[];
  /** `reject` = CSDL phải từ chối; `accept` = CSDL phải cho qua. */
  readonly expect: 'reject' | 'accept';
  /** Chuỗi phải có trong câu lỗi. Bắt ĐÚNG ràng buộc, chứ không phải "có lỗi nào đó" — một
   * lỗi cú pháp cũng là lỗi, và nó sẽ làm phép thử xanh giả. Chỉ dùng khi `expect: 'reject'`.
   *
   * ĐO ĐƯỢC 03/09/2026, và đây là chỗ dễ viết sai nhất: qua đường RAW, Prisma gói mọi lỗi
   * Postgres thành `P2010` và `meta` chỉ còn `{ code, message }` — TÊN INDEX BỊ BỎ MẤT.
   * Nên ca UNIQUE không đối chiếu được theo tên; thứ còn lại và ổn định là DANH SÁCH CỘT trong
   * câu của Postgres: `Key (is_default)=(t) already exists.`
   * Ca `CHECK` thì ngược lại — Postgres nêu thẳng tên ràng buộc và Prisma giữ nguyên, nên đối
   * chiếu theo tên được. Hai loại ràng buộc, hai cách nhận dạng; gộp làm một là sai. */
  readonly expectError?: string;
}

/* `user_id` và `cemetery_id` thêm 05/09/2026 — người ký nay gắn vào tài khoản và nghĩa trang.
 * Cả hai là cột TRẦN, không khoá ngoại (cùng nếp `role_assignments`), nên chuỗi bịa dùng được
 * ở đây; đó cũng đúng là điều kiện để bộ thử này chạy được mà không phải seed gì. */
const SIGNER = (o: {
  id: string;
  user?: string | null;
  cem?: string | null;
  name?: string;
  title?: string;
  isDefault?: boolean;
  status?: string;
}) => {
  const sql = (v: string | null | undefined) => (v === null || v === undefined ? 'NULL' : `'${v}'`);
  return `INSERT INTO cemetery.card_signers
            (id, user_id, cemetery_id, full_name, title, is_default, status, updated_at)
          VALUES ('${o.id}', ${sql(o.user)}, ${sql(o.cem)}, '${o.name ?? 'Nguoi A'}',
                  '${o.title ?? 'GIAM DOC'}', ${String(o.isDefault ?? false)},
                  '${o.status ?? 'Active'}', now())`;
};

/* HỒ SƠ TRÌNH DUYỆT CẤP THẺ — lát 1, 07/09/2026.
 *
 * `quote_snapshot` và `content_hash` không có ràng buộc nào nên đổ giá trị bù nhìn; mọi thứ
 * khác đều là cột bị một CHECK soi, nên để mở cho từng ca đặt. */
const APPROVAL = (o: {
  id: string;
  state?: string;
  plots?: string[];
  customer?: string;
  submittedBy?: string;
  decidedBy?: string | null;
  decidedAt?: boolean;
  note?: string | null;
  expires?: boolean;
  consumed?: string | null;
  consumedAt?: boolean;
  waive?: boolean;
  waiveReason?: string | null;
}) => {
  const q = (v: string | null | undefined) => (v === null || v === undefined ? 'NULL' : `'${v}'`);
  const plots = (o.plots ?? ['plot-1']).map((x) => `'${x}'`).join(',');
  return `INSERT INTO cemetery.card_issue_approvals
            (id, state, company_id, cemetery_id, customer_id,
             plot_ids_snapshot, quote_snapshot, quote_total, content_hash,
             waive_requested, waive_reason,
             approver_user_id, approver_signer_id, submitted_by,
             decided_by, decided_at, decision_note, expires_at,
             consumed_card_print_log_id, consumed_at)
          VALUES ('${o.id}', '${o.state ?? 'SUBMITTED'}', 'cty-A', 'cemA',
                  '${o.customer ?? 'kh-1'}',
                  ARRAY[${plots}]::text[], '{}'::jsonb, 200000, 'hash-x',
                  ${String(o.waive ?? false)}, ${q(o.waiveReason)},
                  'u-approver', 'signer-1', '${o.submittedBy ?? 'u-sender'}',
                  ${q(o.decidedBy)}, ${o.decidedAt === true ? 'now()' : 'NULL'},
                  ${q(o.note)}, ${o.expires === true ? "now() + interval '72 hours'" : 'NULL'},
                  ${q(o.consumed)}, ${o.consumedAt === true ? 'now()' : 'NULL'})`;
};

/* PHÍ CẤP THẺ MỘ — 02/09/2026. Bảng KHÔNG có một khoá ngoại nào (đo bằng `pg_constraint`
 * ngày 09/09/2026), nên chuỗi bịa dùng được và bộ thử này chạy mà không phải seed gì —
 * cùng điều kiện đã cho `card_signers` chạy được.
 *
 * `card_print_log_id`, `fee_schedule_id`, `charged_by` là cột TRẦN, không ràng buộc nào soi,
 * nên đổ giá trị bù nhìn. Mọi cột còn lại đều bị một CHECK hoặc index soi nên để mở.
 *
 * MẶC ĐỊNH là `REPRINT` chứ không phải `FIRST_ISSUE`, và đó là chủ ý: `FIRST_ISSUE` nằm dưới
 * một partial unique index, nên lấy nó làm mặc định thì các ca soi CHECK sẽ có lúc đỏ vì cái
 * index — đỏ đúng chỗ nhưng SAI LÝ DO, và loại đỏ đó dạy người đọc sai. */
const CHARGE = (o: {
  id: string;
  kind?: string;
  customer?: string;
  plot?: string;
  unit?: number;
  remains?: number;
  /** Bỏ trống thì tự tính đúng bằng đơn giá × số cốt, tức là hợp lệ. */
  amount?: number;
  waived?: boolean;
  waiveReason?: string | null;
}) => {
  const q = (v: string | null | undefined) => (v === null || v === undefined ? 'NULL' : `'${v}'`);
  const unit = o.unit ?? 50000;
  const remains = o.remains ?? 1;
  return `INSERT INTO cemetery.grave_card_fee_charges
            (id, company_id, card_print_log_id, customer_id, grave_plot_id,
             fee_kind, fee_schedule_id, unit_price, remains_count, fee_amount,
             waived, waive_reason, charged_by)
          VALUES ('${o.id}', 'cty-A', 'log-${o.id}',
                  '${o.customer ?? 'kh-1'}', '${o.plot ?? 'mo-1'}',
                  '${o.kind ?? 'REPRINT'}', 'bieuphi-1',
                  ${unit}, ${remains}, ${o.amount ?? unit * remains},
                  ${String(o.waived ?? false)}, ${q(o.waiveReason)}, 'u-thu-ngan')`;
};

/* BIỂU PHÍ ĐÃ BAN HÀNH — cũng không khoá ngoại. `company_id` cố ý là chuỗi bịa `cty-A` để
 * không đụng ba dòng biểu phí thật đang nằm trong CSDL dev (đo 09/09/2026): mọi phép thử
 * đều rollback, nhưng một ca đỏ vì trùng với dữ liệu thật thì đọc lên hiểu sai hoàn toàn. */
const SCHEDULE = (o: { id: string; company?: string; cardType?: string; from?: string }) =>
  `INSERT INTO cemetery.grave_card_fee_schedules
     (id, company_id, card_type, first_issue_fee, reprint_fee_per_remains,
      effective_from, decision_ref, created_by)
   VALUES ('${o.id}', '${o.company ?? 'cty-A'}', '${o.cardType ?? 'GRAVE'}',
           200000, 50000, DATE '${o.from ?? '2026-01-01'}', 'QD-01', 'u-tgd')`;

const CASES: readonly Case[] = [
  {
    /* Bản 03/09 là "toàn hệ nhiều nhất MỘT người mặc định". Anh Bách chốt 05/09 người ký gắn
     * theo nghĩa trang, nên câu hỏi đổi thành MỖI NGHĨA TRANG một người. Hai dòng dưới cố ý
     * khác `user_id` để index `(cemetery_id, user_id)` không thể là thủ phạm — nếu không thì
     * ca này vẫn xanh trong khi index mặc định đã hỏng. */
    name: 'card_signers · MỖI NGHĨA TRANG nhiều nhất MỘT người ký mặc định',
    statements: [
      SIGNER({ id: 'smoke1', user: 'u1', cem: 'cemA', isDefault: true }),
      SIGNER({ id: 'smoke2', user: 'u2', cem: 'cemA', isDefault: true, title: 'PHO GIAM DOC' }),
    ],
    expect: 'reject',
    expectError: 'Key (cemetery_id)',
  },
  {
    /* Ca NHẬN quan trọng nhất của lát này, và là CA THẬT: anh Bách nói bên anh đang có một
     * người đứng vị trí quản lý CẢ HAI nghĩa trang. Người đó phải làm mặc định được ở cả hai.
     * Ai đó đổi index về `(is_default)` như bản cũ thì đúng ca này đỏ — và chỉ ca này. */
    name: 'card_signers · MỘT người làm mặc định ở HAI nghĩa trang thì PHẢI cho qua',
    statements: [
      SIGNER({ id: 'smoke1', user: 'u1', cem: 'cemA', isDefault: true }),
      SIGNER({ id: 'smoke2', user: 'u1', cem: 'cemB', isDefault: true }),
    ],
    expect: 'accept',
  },
  {
    name: 'card_signers · người đã NGỪNG DÙNG không được là mặc định',
    statements: [
      SIGNER({ id: 'smoke1', user: 'u1', cem: 'cemA', isDefault: true, status: 'Retired' }),
    ],
    expect: 'reject',
    expectError: 'card_signers_default_active_check',
  },
  {
    name: 'card_signers · trạng thái là TẬP ĐÓNG (gõ thường không lọt)',
    statements: [SIGNER({ id: 'smoke1', user: 'u1', cem: 'cemA', status: 'active' })],
    expect: 'reject',
    expectError: 'card_signers_status_check',
  },
  {
    /* Bản 03/09 chống hai dòng TRÙNG TÊN, vì tờ thẻ chỉ in tên + chức danh nên hai dòng như
     * thế không phân biệt được. Nay danh tính là TÀI KHOẢN, trùng tên không còn là câu hỏi —
     * thứ phải chống là MỘT NGƯỜI hai dòng ở CÙNG một nghĩa trang. */
    name: 'card_signers · một người không được có hai dòng ĐANG DÙNG ở cùng nghĩa trang',
    statements: [
      SIGNER({ id: 'smoke1', user: 'u1', cem: 'cemA' }),
      SIGNER({ id: 'smoke2', user: 'u1', cem: 'cemA', title: 'PHO GIAM DOC' }),
    ],
    expect: 'reject',
    expectError: 'Key (cemetery_id, user_id)',
  },
  {
    /* Ca NHẬN — chứng minh index kia là index MỘT PHẦN chứ không phải index toàn phần. Bỏ mệnh
     * đề `WHERE status = 'Active'` đi thì ca này đỏ, và không gì khác trong repo thấy được:
     * dòng đã ngừng dùng phải ở lại để tra tên đã in trên những tờ thẻ đã cấp. */
    name: 'card_signers · thêm lại một người ĐÃ NGHỈ ở cùng nghĩa trang thì PHẢI cho qua',
    statements: [
      SIGNER({ id: 'smoke1', user: 'u1', cem: 'cemA', status: 'Retired' }),
      SIGNER({ id: 'smoke2', user: 'u1', cem: 'cemA' }),
    ],
    expect: 'accept',
  },
  {
    /* Ràng buộc mới 05/09: người ký ĐANG DÙNG phải đủ cả tài khoản lẫn nghĩa trang. Không có
     * nó thì một dòng `Active` trống hai cột vẫn vào được danh mục, và màn cấp thẻ sẽ mời
     * người ta chọn một người ký không thuộc nghĩa trang nào. */
    name: 'card_signers · dòng ĐANG DÙNG thiếu tài khoản hoặc nghĩa trang thì bị chặn',
    statements: [SIGNER({ id: 'smoke1', user: 'u1', cem: null })],
    expect: 'reject',
    expectError: 'card_signers_active_needs_user_site',
  },
  {
    /* Ca NHẬN, và là ca giữ cho MIGRATION 05/09 chạy được: dòng người ký có từ trước khi danh
     * mục gắn vào tài khoản không có hai cột đó, và migration chuyển nó sang `Retired` chứ
     * không xoá — thẻ đã cấp vẫn phải đọc ra tên người đã ký. Viết CHECK thành vô điều kiện
     * thì migration chết giữa chừng trên CSDL đã có dữ liệu, mà local sạch thì không ai thấy. */
    name: 'card_signers · dòng ĐÃ NGHỈ được phép thiếu tài khoản và nghĩa trang',
    statements: [SIGNER({ id: 'smoke1', user: null, cem: null, status: 'Retired' })],
    expect: 'accept',
  },
  /* ---------- CỬA PHÊ DUYỆT IN THẺ MỘ (lát 1, 07/09/2026) ---------- */

  {
    /* CA NHẬN QUAN TRỌNG NHẤT CỦA LÁT NÀY.
     *
     * Ràng buộc "không tự duyệt" chạm cột `decided_by` NULLABLE. Viết theo nếp nhà một cách
     * máy móc — CHECK (("decided_by" <> "submitted_by") IS TRUE) — sẽ CHẶN SẠCH mọi hồ sơ đang
     * chờ, vì lúc chưa ai duyệt thì `decided_by` là NULL và (NULL <> x) IS TRUE ra FALSE. Tức
     * là cả tính năng chết ngay dòng đầu tiên, mà không test nào khác thấy.
     *
     * Migration lát 0 đã để sẵn cảnh báo này. Ca này là thứ giữ nó không tái diễn: ai "sửa cho
     * nhất quán" thành dạng bọc thẳng thì ĐÚNG ca này đỏ, và chỉ ca này. */
    name: 'card_issue_approvals · hồ sơ ĐANG CHỜ (chưa ai duyệt) thì PHẢI cho qua',
    statements: [APPROVAL({ id: 'ap1' })],
    expect: 'accept',
  },
  {
    name: 'card_issue_approvals · KHÔNG duyệt hồ sơ do chính mình gửi',
    statements: [
      APPROVAL({
        id: 'ap1',
        state: 'APPROVED',
        submittedBy: 'u-x',
        decidedBy: 'u-x',
        decidedAt: true,
        expires: true,
      }),
    ],
    expect: 'reject',
    expectError: 'card_issue_approvals_no_self_approve_check',
  },
  {
    /* array_length(ARRAY[]::text[], 1) trả NULL và Postgres CHO QUA khi CHECK ra NULL — nên
     * ràng buộc này phải dùng cardinality. Đo bằng psql 05/09/2026. */
    name: 'card_issue_approvals · hồ sơ KHÔNG có phần mộ nào thì bị chặn',
    statements: [APPROVAL({ id: 'ap1', plots: [] })],
    expect: 'reject',
    expectError: 'card_issue_approvals_plots_check',
  },
  {
    name: 'card_issue_approvals · trạng thái là TẬP ĐÓNG (tên thứ chín không lọt)',
    statements: [APPROVAL({ id: 'ap1', state: 'DA_DUYET' })],
    expect: 'reject',
    expectError: 'card_issue_approvals_state_check',
  },
  {
    name: 'card_issue_approvals · đã QUYẾT thì phải có đủ người quyết và thời điểm quyết',
    statements: [APPROVAL({ id: 'ap1', state: 'APPROVED', decidedBy: 'u-a', expires: true })],
    expect: 'reject',
    expectError: 'card_issue_approvals_decided_check',
  },
  {
    /* Người gửi cần biết phải sửa gì. Một dòng REJECTED trống lý do buộc họ đi hỏi miệng, và
     * không ai tra lại được vì sao. */
    name: 'card_issue_approvals · TỪ CHỐI mà không nêu lý do thì bị chặn',
    statements: [
      APPROVAL({ id: 'ap1', state: 'REJECTED', decidedBy: 'u-a', decidedAt: true, note: 'ok' }),
    ],
    expect: 'reject',
    expectError: 'card_issue_approvals_reason_check',
  },
  {
    name: 'card_issue_approvals · chưa duyệt thì không được có hạn dùng',
    statements: [APPROVAL({ id: 'ap1', state: 'SUBMITTED', expires: true })],
    expect: 'reject',
    expectError: 'card_issue_approvals_approved_only_check',
  },
  {
    name: 'card_issue_approvals · đã tiêu thì phải có đủ cả lần cấp lẫn thời điểm',
    statements: [
      APPROVAL({
        id: 'ap1',
        state: 'APPROVED',
        decidedBy: 'u-a',
        decidedAt: true,
        expires: true,
        consumed: 'log-1',
      }),
    ],
    expect: 'reject',
    expectError: 'card_issue_approvals_consumed_pair_check',
  },
  {
    name: 'card_issue_approvals · xin miễn phí mà không nêu lý do thì bị chặn',
    statements: [APPROVAL({ id: 'ap1', waive: true })],
    expect: 'reject',
    expectError: 'card_issue_approvals_waive_check',
  },
  {
    name: 'card_issue_approvals · MỘT khách chỉ có MỘT hồ sơ đang chờ',
    statements: [
      APPROVAL({ id: 'ap1', customer: 'kh-9' }),
      APPROVAL({ id: 'ap2', customer: 'kh-9' }),
    ],
    expect: 'reject',
    expectError: 'Key (customer_id)',
  },
  {
    /* Ca NHẬN chứng minh index kia là index MỘT PHẦN chỉ trên SUBMITTED.
     *
     * Gộp APPROVED vào điều kiện index sẽ KHOÁ CỨNG khách: hồ sơ duyệt rồi mà hết hạn thì
     * không gửi lại được nữa, và không có gì báo vì sao. Đây đúng ca một lượt chấm độc lập đã
     * cảnh báo ở vòng thiết kế. */
    name: 'card_issue_approvals · một hồ sơ ĐÃ DUYỆT + một hồ sơ MỚI CHỜ của cùng khách thì cho qua',
    statements: [
      APPROVAL({
        id: 'ap1',
        customer: 'kh-9',
        state: 'APPROVED',
        decidedBy: 'u-a',
        decidedAt: true,
        expires: true,
      }),
      APPROVAL({ id: 'ap2', customer: 'kh-9' }),
    ],
    expect: 'accept',
  },
  {
    /* MỘT phê duyệt tiêu ĐÚNG MỘT lần cấp. Mỗi lần cấp là một lần THU TIỀN, nên hai phê duyệt
     * cùng trỏ một lần cấp nghĩa là hệ đang kể hai câu chuyện về cùng một tờ giấy. */
    name: 'card_issue_approvals · hai phê duyệt không được cùng tiêu một lần cấp thẻ',
    statements: [
      APPROVAL({
        id: 'ap1',
        customer: 'kh-1',
        state: 'APPROVED',
        decidedBy: 'u-a',
        decidedAt: true,
        expires: true,
        consumed: 'log-9',
        consumedAt: true,
      }),
      APPROVAL({
        id: 'ap2',
        customer: 'kh-2',
        state: 'APPROVED',
        decidedBy: 'u-a',
        decidedAt: true,
        expires: true,
        consumed: 'log-9',
        consumedAt: true,
      }),
    ],
    expect: 'reject',
    expectError: 'Key (consumed_card_print_log_id)',
  },

  /* ---------- PHÍ CẤP THẺ MỘ (02/09/2026) ---------- */

  {
    /* Luật tiền: cấp giấy LẦN ĐẦU 200.000đ phẳng, mỗi phần mộ đúng MỘT lần. Suy từ
     * `print_number = 1` là sai ở ca thường gặp nhất — khách đã có thẻ cho mộ A rồi mua thêm
     * mộ B — nên partial index này là chỗ DUY NHẤT ép được luật. Nó cũng là thứ chặn hai quầy
     * bấm cấp thẻ cùng lúc (TOCTOU), thứ mà kiểm-rồi-ghi ở tầng service không chặn nổi. */
    name: 'grave_card_fee_charges · MỘT phần mộ của MỘT khách chỉ thu giá LẦN ĐẦU đúng một lần',
    statements: [
      CHARGE({ id: 'fc1', kind: 'FIRST_ISSUE', customer: 'kh-9', plot: 'mo-9', unit: 200000 }),
      CHARGE({ id: 'fc2', kind: 'FIRST_ISSUE', customer: 'kh-9', plot: 'mo-9', unit: 200000 }),
    ],
    expect: 'reject',
    expectError: 'Key (customer_id, grave_plot_id)',
  },
  {
    /* Ca NHẬN bắt buộc của partial index trên. Ai "sửa cho gọn" nó thành unique toàn phần
     * `(customer_id, grave_plot_id)` thì mọi ca CHẶN ở trên vẫn xanh y nguyên, và cái vỡ là
     * cả nghiệp vụ IN LẠI: khách in lại thẻ lần thứ hai cho cùng phần mộ sẽ bị CSDL từ chối,
     * mà không có gì trong repo nói vì sao. Đúng ca này là thứ duy nhất thấy được. */
    name: 'grave_card_fee_charges · IN LẠI nhiều lần trên cùng một phần mộ thì PHẢI cho qua',
    statements: [
      CHARGE({ id: 'fc1', kind: 'REPRINT', customer: 'kh-9', plot: 'mo-9' }),
      CHARGE({ id: 'fc2', kind: 'REPRINT', customer: 'kh-9', plot: 'mo-9' }),
    ],
    expect: 'accept',
  },
  {
    name: 'grave_card_fee_charges · loại phí là TẬP ĐÓNG (tên thứ ba không lọt)',
    statements: [CHARGE({ id: 'fc1', kind: 'FIRST_PRINT' })],
    expect: 'reject',
    expectError: 'grave_card_fee_charges_fee_kind_check',
  },
  {
    /* CA ĐÃ TỪNG LỌT THẬT, 02/09/2026 — và là lý do nếp `IS TRUE` ra đời trong repo này.
     *
     * Với `waived = true, waive_reason = NULL`: vế một ra FALSE, vế hai ra NULL, cả biểu thức
     * ra NULL, và CHECK của Postgres CHO QUA khi biểu thức là NULL. Bỏ cái bọc `IS TRUE` đi
     * thì ràng buộc trông y hệt mà vô hiệu, và thứ lọt ra là những lần miễn tiền không ai
     * chịu trách nhiệm. Không có ca này thì lần vô hiệu tiếp theo cũng lặng lẽ như lần đầu. */
    name: 'grave_card_fee_charges · MIỄN PHÍ mà không nêu lý do thì bị chặn',
    statements: [CHARGE({ id: 'fc1', waived: true, waiveReason: null })],
    expect: 'reject',
    expectError: 'grave_card_fee_charges_waive_check',
  },
  {
    /* Chiều ngược lại của cùng ràng buộc, và cũng là một câu chuyện sai: một dòng có nêu lý do
     * miễn nhưng `waived = false` đọc lên là "đã miễn" khi tra sổ, còn tiền thì vẫn thu. */
    name: 'grave_card_fee_charges · nêu lý do miễn mà KHÔNG miễn thì bị chặn',
    statements: [CHARGE({ id: 'fc1', waived: false, waiveReason: 'COMPANY_FAULT' })],
    expect: 'reject',
    expectError: 'grave_card_fee_charges_waive_check',
  },
  {
    /* Ca NHẬN của `waive_check`. Bọc `IS TRUE` sai chỗ — ví dụ bọc riêng từng vế thay vì bọc
     * cả biểu thức — vẫn chặn đúng hai ca trên nhưng chặn luôn ca này, tức là không ai miễn
     * được phí nữa. Miễn phí là quyết định có thật của nghiệp vụ (lỗi thuộc về công ty, khách
     * nộp lại thẻ cũ), nên nó phải ghi được. */
    name: 'grave_card_fee_charges · MIỄN PHÍ có nêu lý do đúng thì PHẢI cho qua',
    statements: [CHARGE({ id: 'fc1', waived: true, waiveReason: 'COMPANY_FAULT' })],
    expect: 'accept',
  },
  {
    name: 'grave_card_fee_charges · số cốt phải từ MỘT trở lên',
    statements: [CHARGE({ id: 'fc1', unit: 50000, remains: 0, amount: 0 })],
    expect: 'reject',
    expectError: 'grave_card_fee_charges_amount_check',
  },
  {
    /* Bất biến của DỮ LIỆU, không phải phép tính của một phiên bản mã: bảng append-only nên
     * một dòng thu sai tiền nằm đó mãi, không sửa được, chỉ ghi bù được. */
    name: 'grave_card_fee_charges · số tiền phải đúng bằng đơn giá × số cốt',
    statements: [CHARGE({ id: 'fc1', unit: 50000, remains: 3, amount: 50000 })],
    expect: 'reject',
    expectError: 'grave_card_fee_charges_amount_check',
  },
  {
    name: 'grave_card_fee_schedules · MỘT công ty chỉ có MỘT biểu phí cho mỗi loại thẻ mỗi ngày hiệu lực',
    statements: [SCHEDULE({ id: 'fs1' }), SCHEDULE({ id: 'fs2' })],
    expect: 'reject',
    expectError: 'Key (company_id, card_type, effective_from)',
  },
  {
    /* Ca NHẬN. Ai rút khoá xuống còn `(company_id, card_type)` thì ca CHẶN ở trên vẫn xanh,
     * còn thứ vỡ là khả năng ĐỔI GIÁ: bảng append-only nên đổi giá = ban hành một dòng mới có
     * ngày hiệu lực mới, và rút khoá đi tức là công ty này vĩnh viễn không đổi được biểu phí. */
    name: 'grave_card_fee_schedules · biểu phí mới cho NGÀY HIỆU LỰC khác thì PHẢI cho qua',
    statements: [
      SCHEDULE({ id: 'fs1', from: '2026-01-01' }),
      SCHEDULE({ id: 'fs2', from: '2027-01-01' }),
    ],
    expect: 'accept',
  },

  /* ---------- APPEND-ONLY: BỐN TRIGGER CỦA HAI BẢNG TIỀN PHÍ ----------
   *
   * Đơn giá đã ban hành và khoản tiền đã thu của khách không sửa được, kể cả bằng tay trên
   * CSDL. Đối chiếu bằng NGUYÊN CÂU thông báo, kể cả TÊN BẢNG, chứ không phải mỗi chữ
   * "append-only" — vì cái bẫy ở đây không phải trigger biến mất mà là trigger gắn nhầm hàm.
   * Migration 02/09 cố ý viết `cemetery.prevent_mutation()` riêng thay vì dùng lại
   * `audit.prevent_mutation()`, bởi hàm audit hard-code chuỗi "audit_events is append-only":
   * gắn nhầm nó vào đây thì vẫn chặn, vẫn xanh nếu chỉ soi chữ "append-only", và người dùng
   * nhận một câu lỗi nói SAI tên bảng. Đối chiếu cả tên bảng là thứ bắt được đúng lần đó. */

  {
    name: 'grave_card_fee_schedules · SỬA một dòng biểu phí đã ban hành thì bị chặn',
    statements: [
      SCHEDULE({ id: 'fs1' }),
      "UPDATE cemetery.grave_card_fee_schedules SET first_issue_fee = 1 WHERE id = 'fs1'",
    ],
    expect: 'reject',
    expectError: 'cemetery.grave_card_fee_schedules is append-only: UPDATE is not allowed',
  },
  {
    name: 'grave_card_fee_schedules · XOÁ một dòng biểu phí đã ban hành thì bị chặn',
    statements: [
      SCHEDULE({ id: 'fs1' }),
      "DELETE FROM cemetery.grave_card_fee_schedules WHERE id = 'fs1'",
    ],
    expect: 'reject',
    expectError: 'cemetery.grave_card_fee_schedules is append-only: DELETE is not allowed',
  },
  {
    /* TRUNCATE đi vòng qua trigger FOR EACH ROW — nó không xoá theo hàng nên không có hàng nào
     * để trigger bắt. Phải là trigger FOR EACH STATEMENT riêng mới bịt được, và bảng
     * `audit.audit_events` đang hở đúng chỗ này (đo 02/09/2026). Mất sạch bảng này bằng một
     * câu lệnh là mất luôn khả năng đối chứng với người đã trả tiền. */
    name: 'grave_card_fee_schedules · XOÁ TRẮNG cả bảng biểu phí thì bị chặn',
    statements: ['TRUNCATE cemetery.grave_card_fee_schedules'],
    expect: 'reject',
    expectError: 'cemetery.grave_card_fee_schedules is append-only: TRUNCATE is not allowed',
  },
  {
    name: 'grave_card_fee_charges · SỬA một khoản phí đã thu thì bị chặn',
    statements: [
      CHARGE({ id: 'fc1' }),
      "UPDATE cemetery.grave_card_fee_charges SET fee_amount = 0 WHERE id = 'fc1'",
    ],
    expect: 'reject',
    expectError: 'cemetery.grave_card_fee_charges is append-only: UPDATE is not allowed',
  },
  {
    /* Sửa khoản thu sai = ghi một dòng mới, không xoá dòng cũ. Xoá được nghĩa là một lần thu
     * tiền của khách biến mất khỏi sổ mà không để lại dấu. */
    name: 'grave_card_fee_charges · XOÁ một khoản phí đã thu thì bị chặn',
    statements: [
      CHARGE({ id: 'fc1' }),
      "DELETE FROM cemetery.grave_card_fee_charges WHERE id = 'fc1'",
    ],
    expect: 'reject',
    expectError: 'cemetery.grave_card_fee_charges is append-only: DELETE is not allowed',
  },
  {
    name: 'grave_card_fee_charges · XOÁ TRẮNG cả bảng khoản đã thu thì bị chặn',
    statements: ['TRUNCATE cemetery.grave_card_fee_charges'],
    expect: 'reject',
    expectError: 'cemetery.grave_card_fee_charges is append-only: TRUNCATE is not allowed',
  },
];

/* Gộp `message` VÀ `meta` thành MỘT chuỗi để đối chiếu.
 *
 * Phải có `meta`, vì qua đường raw thì `message` gần như không mang thông tin: nó mở đầu bằng
 * một dòng trống rồi tới "Invalid `prisma.$executeRawUnsafe()` invocation:". Thứ nói được
 * chuyện gì đã xảy ra nằm ở `meta` — đo thật 03/09/2026:
 *   { "code": "23505", "message": "Key (is_default)=(t) already exists." }
 * `23505` là unique_violation, `23514` là check_violation của Postgres. */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const meta = (err as { meta?: unknown }).meta;
  return meta === undefined ? err.message : `${err.message} ${JSON.stringify(meta)}`;
}

/** Ép về MỘT dòng để bảng kết quả không vỡ. Không cắt lấy dòng đầu — dòng đầu của Prisma là
 * dòng vô nghĩa nhất, còn phần `meta` mới là phần cần đọc, và nó nằm ở cuối. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat;
}

/** Chạy các lệnh trong một giao dịch rồi CUỘN LẠI. Trả câu lỗi nếu CSDL từ chối, `null` nếu qua. */
async function attempt(statements: readonly string[]): Promise<string | null> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const sql of statements) {
        await tx.$executeRawUnsafe(sql);
      }
      throw ROLLBACK;
    });
  } catch (err) {
    if (err === ROLLBACK) return null;
    return errorText(err);
  }
  /* Không tới được: callback luôn ném. Có nhánh này để kiểu trả về không phải `string | null | undefined`. */
  return null;
}

async function main(): Promise<void> {
  console.log('# Thử ràng buộc CSDL (mọi phép thử đều rollback)\n');

  let failed = 0;
  for (const c of CASES) {
    const error = await attempt(c.statements);

    if (c.expect === 'accept') {
      if (error === null) {
        console.log(`  OK    NHẬN   ${c.name}`);
      } else {
        failed += 1;
        console.log(`  HỎNG  NHẬN   ${c.name}`);
        console.log(`        CSDL từ chối một thứ lẽ ra phải cho qua: ${oneLine(error)}`);
      }
      continue;
    }

    if (error === null) {
      failed += 1;
      console.log(`  HỎNG  CHẶN   ${c.name}`);
      console.log('        CSDL CHO QUA — ràng buộc không còn tác dụng.');
    } else if (c.expectError !== undefined && !error.includes(c.expectError)) {
      /* Có lỗi nhưng SAI LOẠI. Không tính là qua: một lỗi cú pháp trong chính phép thử cũng ném
       * ra lỗi, và đếm nó là "chặn được" là cách phép thử tự nói dối. */
      failed += 1;
      console.log(`  HỎNG  CHẶN   ${c.name}`);
      console.log(`        Có lỗi nhưng KHÔNG phải \`${c.expectError}\`: ${oneLine(error)}`);
    } else {
      console.log(`  OK    CHẶN   ${c.name}`);
    }
  }

  await prisma.$disconnect();

  console.log('');
  if (failed === 0) {
    console.log(`${CASES.length}/${CASES.length} ràng buộc còn nguyên tác dụng.`);
    return;
  }
  console.log(`!! ${failed}/${CASES.length} phép thử HỎNG. Ràng buộc trong migration không còn`);
  console.log('   chặn đúng thứ nó sinh ra để chặn — đọc từng dòng HỎNG ở trên.');
  process.exitCode = 1;
}

/* Không nối được CSDL cũng là THOÁT 1: đây là bước gác trong CI, và "chưa biết" phải chặn giống
 * "có hỏng". Cùng lý lẽ đã ghi ở `authz-catalog-check.ts`. */
main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
