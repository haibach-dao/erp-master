import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* NẠP `.env` CHO SCRIPT CHẠY BẰNG `tsx`.
 *
 * VÌ SAO PHẢI CÓ (đo được 27/08/2026): API nạp `.env` qua `ConfigModule.forRoot()`, còn
 * `npx tsx scripts/x.ts` thì KHÔNG nạp gì cả. Hai bên vì thế đọc ra hai `process.env` khác
 * nhau, và chỗ đau nhất là `ENCRYPTION_KEY`:
 *
 *   `PiiService.key()` không ném khi thiếu khoá — nó CẢNH BÁO rồi lặng lẽ dùng
 *   `'dev-encryption-key'`. Nên script seed ghi CCCD bằng một khoá, API đọc bằng khoá khác,
 *   và `decrypt` ném `Unsupported state or unable to authenticate data` ở tận màn hình —
 *   một câu lỗi không hề nhắc tới `.env`. Dữ liệu trông vẫn đủ, chỉ là không ai mở được.
 *
 * Đã kiểm bằng chạy: khoá dẫn xuất khi KHÔNG nạp `.env` là `3abcc0b6…` (từ chuỗi dev), khác
 * hoàn toàn khoá API đang dùng. `reset-cemetery-data.ts` đã seed CCCD kiểu đó từ đầu.
 *
 * Tự đọc thay vì dùng `dotenv`: gói đó là phụ thuộc GIÁN TIẾP của `@nestjs/config`, không
 * `require.resolve` được từ `apps/api` (pnpm không nâng nó lên). Thêm một phụ thuộc trực
 * tiếp chỉ để đọc mười dòng `KEY=value` là cái giá đắt hơn mười dòng này.
 */
export function loadDotEnv(envPath = join(__dirname, '..', '.env')): void {
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    /* Không có `.env` là chuyện BÌNH THƯỜNG trên CI, nơi biến môi trường đến từ chỗ khác.
     * Ném ở đây là làm mọi script chết trên CI vì một file cố ý không tồn tại. */
    return;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    /* KHÔNG ghi đè biến đã có sẵn trong môi trường. Người chạy đặt `ENCRYPTION_KEY=...`
     * ngay trên dòng lệnh là CỐ Ý muốn nó thắng file — đảo lại thì không còn cách nào
     * chạy script với một khoá khác. Cùng quy ước với `dotenv`. */
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/* Nạp `.env` RỒI mới cho phép dựng `PiiService`, và ném nếu vẫn không thấy khoá.
 *
 * Ném chứ không cảnh báo: với script GHI dữ liệu, mã hoá bằng nhầm khoá là hỏng câm — dữ
 * liệu vào được CSDL, không có gì đỏ, và chỉ vỡ ra khi có người bấm "xem CCCD" nhiều ngày
 * sau. Thà dừng ngay ở dòng đầu.
 */
export function requireEncryptionKey(): void {
  loadDotEnv();
  const raw = process.env.ENCRYPTION_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      'Thiếu ENCRYPTION_KEY. Script này GHI dữ liệu đã mã hoá; chạy mà không có khoá thật ' +
        'thì PiiService lặng lẽ dùng khoá dev, và API sẽ không giải mã được. ' +
        'Đặt ENCRYPTION_KEY trong apps/api/.env hoặc trên dòng lệnh.',
    );
  }
}
