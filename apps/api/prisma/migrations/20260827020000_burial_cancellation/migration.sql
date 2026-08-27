-- Huỷ hồ sơ an táng: ghi LÝ DO và THỜI ĐIỂM ngay trên bản ghi.
--
-- Vì sao không để mỗi nhật ký kiểm toán giữ: màn hình khách hàng 360 phải trả lời được
-- "vì sao mộ này từng có hồ sơ rồi lại không" mà không phải đi tra nhật ký — và nhật ký
-- đọc được bằng một mã quyền KHÁC, nên với người dùng thường nó là chỗ không tồn tại.
--
-- Cùng nếp với `grave_usage_rights.ended_reason`: dòng đã kết thúc phải TỰ KỂ được vì sao
-- nó kết thúc. Không thêm cột `cancelled_by` — ai làm là việc của nhật ký kiểm toán, chép
-- ra đây là tạo bản thứ hai cho một sự thật đã có chỗ ở.

ALTER TABLE "cemetery"."burial_records"
  ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
  ADD COLUMN     "cancel_reason" TEXT;

-- KHÔNG đụng tới partial unique index `burial_records_active_slot`.
--
-- Ghi rõ ở đây vì đây đúng là chỗ người đọc sau sẽ tưởng là bỏ sót: index đó đã liệt kê
-- đích danh bốn trạng thái CÒN HIỆU LỰC ('Draft','Verified','Scheduled','Completed'), nên
-- một hồ sơ chuyển sang 'Cancelled' TỰ RƠI ra khỏi index và cốt được nhả cho người khác.
-- Đó chính là hành vi mà chú thích của migration 20260826064901 đã hứa trước:
-- "hồ sơ đã huỷ phải NHẢ cốt ra cho người khác".
--
-- Kiểm lại bằng câu này sau khi chạy — phải thấy đủ bốn trạng thái, không có 'Cancelled':
--   SELECT pg_get_expr(indpred, indrelid) FROM pg_index
--   WHERE indexrelid = 'cemetery.burial_records_active_slot'::regclass;
