-- AlterTable
ALTER TABLE "cemetery"."burial_records" ADD COLUMN     "slot_number" INTEGER;

-- Không hai hồ sơ CÒN HIỆU LỰC nào cùng chiếm một cốt trong một phần mộ.
--
-- Partial index chứ không phải unique thường: hồ sơ đã huỷ phải NHẢ cốt ra cho người
-- khác, nếu không thì một lần nhập sai là khoá vĩnh viễn một chỗ trong mộ.
--
-- Ép ở tầng CSDL chứ không chỉ ở service: hai người bấm "an táng vào cốt 2" cùng lúc thì
-- kiểm-rồi-ghi ở tầng ứng dụng vẫn lọt cả hai (TOCTOU). Ở đây một người thua ở ràng buộc.
CREATE UNIQUE INDEX "burial_records_active_slot"
  ON "cemetery"."burial_records"("grave_plot_id", "slot_number")
  WHERE "slot_number" IS NOT NULL
    AND "status" IN ('Draft', 'Verified', 'Scheduled', 'Completed');
