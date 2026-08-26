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
 * Sáu bảng ở trên trỏ tới khách hàng bằng id LỎNG — chỉ `grave_holds` có khoá ngoại. Nên
 * dòng lịch sử (quyền đã thu hồi, phiếu đã hết hạn) không chặn được xoá nhưng nếu để lại
 * thì thành con trỏ treo, và màn hình lịch sử sẽ hiện một cái tên trống.
 */
export const CUSTOMER_CASCADE_REFERENCES = [
  { model: 'GraveUsageRight', column: 'holderCustomerId', label: 'quyền sử dụng (lịch sử)' },
  { model: 'GraveHold', column: 'customerId', label: 'phiếu giữ chỗ (lịch sử)' },
] as const;

/** Mọi model được khai ở một trong hai nhóm — dùng cho test đối chiếu schema. */
export function declaredCustomerReferences(): { model: string; column: string }[] {
  return [
    ...CUSTOMER_BLOCKING_REFERENCES.map((r) => ({ model: r.model, column: r.column })),
    ...CUSTOMER_CASCADE_REFERENCES.map((r) => ({ model: r.model, column: r.column })),
  ];
}
