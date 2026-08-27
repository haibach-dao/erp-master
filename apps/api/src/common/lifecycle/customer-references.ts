import {
  activeBurial,
  activeUsageRight,
  BINDING_CONTRACT_STATUSES,
  holdStillHolding,
  LIVE_SUBSCRIPTION_STATUSES,
} from './active';

/* SỔ ĐĂNG KÝ: mọi thứ trong hệ trỏ tới một khách hàng.
 *
 * VÌ SAO CÓ FILE NÀY — bài học trả giá ba lần trong một ngày (26/08/2026):
 *
 * Rào chắn xoá khách hàng viết tay sáu lời gọi `count`. Lần 1 nó đếm cả quyền sử dụng đã
 * thu hồi. Vá. Lần 2 nó đếm cả phiếu giữ chỗ đã hết hạn. Vá. Lần 3 nó vẫn đếm cả hợp đồng
 * đã huỷ và dịch vụ đã ngừng — vì tôi vá TỪNG lời gọi mà không hỏi "còn lời gọi nào nữa
 * không".
 *
 * Bộ quét bất biến trước đó bắt được chuyện CHÉP ĐỊNH NGHĨA ra nhiều bản. Nó không bắt
 * được chuyện BỎ SÓT — một truy vấn thiếu bộ lọc trông y hệt một truy vấn cố ý không lọc.
 *
 * Nên đảo cách làm: liệt kê tham chiếu ở ĐÂY, rào chắn SINH RA từ danh sách này, và một
 * test đối chiếu danh sách với `schema.prisma`. Thêm một bảng trỏ tới khách hàng mà quên
 * khai ở đây thì GÃY BUILD — không còn im lặng lọt qua được nữa.
 */

/** Thứ chặn xoá: nghĩa vụ còn sống, hoặc giấy tờ đang nằm trong tay khách. */
export interface BlockingReference {
  /** Tên model Prisma — dùng cho test đối chiếu với schema. */
  model: string;
  /** Cột trỏ tới khách hàng. Nhiều bảng không đặt tên `customerId`. */
  column: string;
  /** Mệnh đề `where` bổ sung: CHỈ đếm dòng còn hiệu lực. */
  activeWhere: (now: Date) => Record<string, unknown>;
  /** Câu tiếng Việt điền vào lời từ chối, nhận số lượng. */
  message: (n: number) => string;
  /* Lấy NHÃN của vài dòng đang chặn, để lời từ chối chỉ đích danh thay vì chỉ đếm.
   *
   * "còn 2 hợp đồng đang hiệu lực" bảo người dùng có việc phải làm; "còn 2 hợp đồng đang
   * hiệu lực (HD1, HD2)" bảo họ làm ở ĐÂU. Không có nhãn thì họ phải đi dò từng hợp đồng
   * để tìm hai cái đang chặn.
   *
   * Tuỳ chọn: bảng nào không có gì đáng gọi tên thì bỏ qua, đếm suông vẫn đúng. */
  identify?: (
    client: Record<string, { findMany: (a: unknown) => Promise<unknown[]> }>,
    customerId: string,
    now: Date,
  ) => Promise<string[]>;
}

/* Tham chiếu CHẶN xoá.
 *
 * Mỗi dòng phải trả lời được: "vì sao thứ này khiến việc xoá là SAI, chứ không chỉ bất
 * tiện". Không trả lời được thì nó thuộc nhóm dưới, không thuộc nhóm này.
 */
export const CUSTOMER_BLOCKING_REFERENCES: readonly BlockingReference[] = [
  {
    model: 'GraveUsageRight',
    column: 'holderCustomerId',
    activeWhere: () => ({ ...activeUsageRight }),
    message: (n) => `đang đứng tên ${n} phần mộ`,
    identify: async (client, customerId) => {
      const rows = (await client.graveUsageRight!.findMany({
        where: { holderCustomerId: customerId, ...activeUsageRight },
        select: { gravePlot: { select: { plotCode: true } } },
        take: 3,
      })) as { gravePlot: { plotCode: string } | null }[];
      return rows.map((r) => r.gravePlot?.plotCode ?? '?');
    },
  },
  {
    model: 'GraveHold',
    column: 'customerId',
    // Hai điều kiện: còn Active VÀ chưa quá hạn. Phiếu hết hạn không giữ gì nữa.
    activeWhere: (now) => ({ ...holdStillHolding(now) }),
    message: (n) => `${n} phiếu giữ chỗ còn hiệu lực`,
  },
  {
    model: 'BurialRecord',
    column: 'ownerCustomerId',
    activeWhere: () => ({ ...activeBurial() }),
    message: (n) => `là chủ mộ trong ${n} hồ sơ an táng`,
  },
  {
    model: 'ContractParty',
    column: 'customerId',
    /* Chỉ hợp đồng ĐANG RÀNG BUỘC. `Draft` chưa ràng buộc ai, `Cancelled` thì hết —
     * chặn vì một bản nháp bỏ đi là bắt người dùng đi dọn thứ vốn đã không còn nghĩa. */
    activeWhere: () => ({ contract: { status: { in: [...BINDING_CONTRACT_STATUSES] } } }),
    message: (n) => `là bên trong ${n} hợp đồng đang hiệu lực`,
    identify: async (client, customerId) => {
      const rows = (await client.contractParty!.findMany({
        where: {
          customerId,
          contract: { status: { in: [...BINDING_CONTRACT_STATUSES] } },
        },
        select: { contract: { select: { contractNo: true } } },
        take: 3,
      })) as { contract: { contractNo: string } | null }[];
      return rows.map((r) => r.contract?.contractNo ?? '?');
    },
  },
  {
    model: 'ServiceSubscription',
    column: 'customerId',
    activeWhere: () => ({ status: { in: [...LIVE_SUBSCRIPTION_STATUSES] } }),
    message: (n) => `${n} dịch vụ đang dùng`,
  },
  {
    model: 'ServiceTransaction',
    column: 'customerId',
    /* KHÔNG lọc trạng thái — bảng này không có trạng thái, chỉ có `amount` và `paidAt`.
     * Mỗi dòng là TIỀN ĐÃ THU. Xoá khách hàng mà để lại giao dịch là để lại một khoản thu
     * không truy được đã thu của ai; xoá cả giao dịch là sửa sổ doanh thu.
     *
     * Chính test đối chiếu schema tìm ra mục này — tôi đã bỏ sót nó ở lần "vá toàn diện"
     * trước đó, và đó đúng là lý do sổ đăng ký này tồn tại. */
    activeWhere: () => ({}),
    message: (n) => `có ${n} giao dịch thu tiền dịch vụ`,
  },
  {
    model: 'CardPrintLog',
    column: 'customerId',
    /* KHÔNG lọc trạng thái — bảng này không có trạng thái, và đó là chủ đích: mỗi dòng là
     * một tờ giấy đã trao tay khách. Tờ giấy đó vẫn tồn tại ngoài đời dù hồ sơ trong máy
     * có bị xoá, nên xoá khách mà để lại thẻ đã cấp là tạo ra một giấy tờ không tra được. */
    activeWhere: () => ({}),
    message: (n) => `đã được cấp ${n} thẻ quản lý mộ`,
  },
];

/* Tham chiếu KHÔNG chặn, nhưng phải XOÁ THEO.
 *
 * Các bảng ở trên trỏ tới khách hàng bằng id LỎNG — chỉ `grave_holds` có khoá ngoại. Nên
 * dòng lịch sử (quyền đã thu hồi, phiếu đã hết hạn) không chặn được xoá nhưng nếu để lại
 * thì thành con trỏ treo, và màn hình lịch sử sẽ hiện một cái tên trống.
 */
export const CUSTOMER_CASCADE_REFERENCES = [
  { model: 'GraveUsageRight', column: 'holderCustomerId', label: 'quyền sử dụng (lịch sử)' },
  { model: 'GraveHold', column: 'customerId', label: 'phiếu giữ chỗ (lịch sử)' },
] as const;

/* Tham chiếu phải GỠ RA (đặt về NULL), không chặn và cũng không xoá theo.
 *
 * Nhóm thứ ba này sinh ra ngày 27/08/2026 cùng lúc với trạng thái `Cancelled` của hồ sơ an
 * táng, và nó tồn tại vì hai nhóm kia đều trả lời SAI cho một trường hợp thật:
 *
 *   Hồ sơ an táng mang `ownerCustomerId` = chủ mộ. Khi hồ sơ đã HUỶ, nó rơi khỏi
 *   `activeBurial()` nên không còn chặn xoá chủ mộ nữa. Nhưng dòng đó KHÔNG PHẢI hồ sơ của
 *   chủ mộ — nó là hồ sơ của NGƯỜI MẤT. Xoá theo là xoá lịch sử của người khác; để nguyên
 *   là để lại con trỏ treo (cột này không có khoá ngoại).
 *
 * Nên: giữ dòng, gỡ con trỏ. Cột vốn đã cho phép NULL, và NULL ở đây mang đúng nghĩa "không
 * còn biết chủ mộ là ai" — hồ sơ khách hàng đó đã bị xoá khỏi hệ. Ai từng là chủ mộ vẫn
 * đọc được ở nhật ký kiểm toán.
 *
 * Trước 27/08/2026 trường hợp này KHÔNG tồn tại: mọi hồ sơ an táng luôn nằm trong bốn trạng
 * thái còn hiệu lực, nên rào chắn `BurialRecord.ownerCustomerId` giữ lại tất. Thêm một
 * trạng thái rơi ra ngoài bộ lọc là mở ra một lớp con trỏ treo mới — ghi ra đây để lần sau
 * ai thêm trạng thái "đã huỷ"/"đã đóng" cho bảng khác thì hỏi luôn câu này.
 */
export const CUSTOMER_DETACH_REFERENCES = [
  {
    model: 'BurialRecord',
    column: 'ownerCustomerId',
    label: 'chủ mộ trong hồ sơ an táng đã huỷ',
  },
] as const;

/** Mọi model được khai ở một trong BA nhóm — dùng cho test đối chiếu schema. */
export function declaredCustomerReferences(): { model: string; column: string }[] {
  return [
    ...CUSTOMER_BLOCKING_REFERENCES.map((r) => ({ model: r.model, column: r.column })),
    ...CUSTOMER_CASCADE_REFERENCES.map((r) => ({ model: r.model, column: r.column })),
    ...CUSTOMER_DETACH_REFERENCES.map((r) => ({ model: r.model, column: r.column })),
  ];
}
