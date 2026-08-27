import type { BadgeProps } from '@/components/ui/badge';

type Variant = NonNullable<BadgeProps['variant']>;

/* Trạng thái nghiệp vụ hiện ra màn hình.
 *
 * Server trả về mã tiếng Anh (`Available`, `PendingVerification`…). Trước đây
 * trang in thẳng mã đó ra bảng, nên người dùng đọc "Occupied" giữa một trang
 * tiếng Việt. Bảng dưới đây chỉ đổi CÁCH HIỆN, không đổi mã — mọi so sánh
 * trong code vẫn dùng mã gốc.
 *
 * Nhãn mộ lấy đúng từ vựng Dashboard đang dùng, để hai chỗ không gọi khác nhau.
 */
const STATUS: Record<string, { label: string; variant: Variant }> = {
  // Vị trí mộ
  Available: { label: 'Còn trống', variant: 'success' },
  Held: { label: 'Đang giữ chỗ', variant: 'warning' },
  Allocated: { label: 'Đã phân bổ', variant: 'info' },
  Occupied: { label: 'Đã an táng', variant: 'neutral' },
  /* Ba mã dưới đây có trong GRAVE_PLOT_STATUSES của server nhưng trước đây
   * thiếu nhãn ở đây, nên chúng rơi xuống nhánh "hiện nguyên mã" và người dùng
   * đọc chữ tiếng Anh giữa trang tiếng Việt. Chưa nghiệp vụ nào đặt ba trạng
   * thái này, nhưng thiếu nhãn thì lúc có sẽ hiện sai chứ không báo lỗi. */
  Reserved: { label: 'Đã đặt chỗ', variant: 'warning' },
  Maintenance: { label: 'Đang bảo trì', variant: 'warning' },
  Locked: { label: 'Đang khoá', variant: 'destructive' },

  // Hồ sơ hợp đồng / an táng
  Draft: { label: 'Nháp', variant: 'neutral' },
  Uploaded: { label: 'Đã tải lên', variant: 'neutral' },
  PendingVerification: { label: 'Chờ thẩm định', variant: 'warning' },
  Verified: { label: 'Đã thẩm định', variant: 'info' },
  Scheduled: { label: 'Đã lên lịch', variant: 'info' },
  Completed: { label: 'Hoàn tất', variant: 'success' },

  // Thuê bao dịch vụ / giữ chỗ
  Active: { label: 'Đang hiệu lực', variant: 'success' },
  Cancelled: { label: 'Đã hủy', variant: 'destructive' },
};

/* Mã lạ thì hiện nguyên mã, đừng nuốt mất — thà người dùng thấy chữ tiếng Anh
 * còn hơn thấy ô trống hoặc một nhãn đoán sai. */
export function statusOf(code: string): { label: string; variant: Variant } {
  return STATUS[code] ?? { label: code, variant: 'neutral' };
}

/** Loại khách hàng — cũng là mã tiếng Anh từ server. */
const CUSTOMER_TYPE: Record<string, string> = {
  INDIVIDUAL: 'Cá nhân',
  ORGANIZATION: 'Tổ chức',
  AGENT: 'Đại lý',
  PROSPECT: 'Tiềm năng',
};

export function customerType(code: string): string {
  return CUSTOMER_TYPE[code] ?? code;
}

/* Mức nhạy cảm của mã quyền (doc 16 §D.4). S3 = dữ liệu cá nhân, hành vi bất
 * khả hồi, bỏ mặt nạ — người rà phải thấy ngay mình đang cấp thứ gì, nên nó
 * đỏ chứ không nằm lẫn trong một cột chữ đơn sắc. */
const SENSITIVITY: Record<string, { label: string; variant: Variant }> = {
  S0: { label: 'S0', variant: 'neutral' },
  S1: { label: 'S1', variant: 'neutral' },
  S2: { label: 'S2', variant: 'warning' },
  S3: { label: 'S3', variant: 'destructive' },
};

export function sensitivityOf(code: string): { label: string; variant: Variant } {
  return SENSITIVITY[code] ?? { label: code, variant: 'neutral' };
}

/* BƯỚC CÒN LẠI của một hồ sơ an táng.
 *
 * VÌ SAO CÓ HÀM NÀY (chủ doanh nghiệp nêu 27/08/2026): an táng xong, màn hình ghi trạng thái
 * "Nháp" — một từ không nói gì. Nó không cho biết còn hai bước nữa, cũng không cho biết làm ở
 * đâu. Luồng là `Draft -> verify -> Verified -> complete -> Completed`, và phần mộ CHỈ chuyển
 * sang `Occupied` ở bước cuối.
 *
 * Ba bước là CÓ CHỦ ĐÍCH — an táng không đảo ngược được, nên hệ tách "ghi nhận" khỏi "xác
 * minh" khỏi "đã xong". Nhưng chủ đích đó phải ĐỌC ĐƯỢC trên màn hình, không nằm trong đầu
 * người viết mã.
 *
 * Khai một lần ở đây vì BA màn hình cần nó (tab Nơi an nghỉ, bảng Phần mộ, trang An táng).
 * Ba bản sao là ba câu chữ sẽ lệch nhau.
 */
export type BurialNextStep = { action: 'verify' | 'complete'; label: string; hint: string } | null;

export function burialNextStep(status: string): BurialNextStep {
  if (status === 'Draft') {
    return {
      action: 'verify',
      label: 'Xác minh',
      hint: 'cần xác minh',
    };
  }
  if (status === 'Verified' || status === 'Scheduled') {
    return {
      action: 'complete',
      label: 'Hoàn tất',
      hint: 'cần hoàn tất — phần mộ chỉ chuyển sang “Đã có người” ở bước này',
    };
  }
  // `Completed` và `Cancelled` là điểm cuối: không còn bước nào, và không nút nào.
  return null;
}
