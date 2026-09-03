-- NGƯỜI KÝ THẺ MỘ — danh mục toàn hệ, không chia theo công ty (anh Bách chốt 03/09/2026).
--
-- Người của INDEVCO ký ở ô BÊN PHẢI tờ thẻ. Ô bên trái là chủ mộ, tên lấy thẳng từ hồ sơ
-- khách nên không có chỗ nào ở đây.

CREATE TABLE "cemetery"."card_signers" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "card_signers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "card_signers_status_idx" ON "cemetery"."card_signers"("status");

-- KHÔNG cho hai dòng ĐANG DÙNG trùng cả họ tên lẫn chức danh.
-- Trên tờ thẻ chỉ in ra hai thứ đó, nên hai dòng như vậy là hai lựa chọn mà người ở quầy
-- không tài nào phân biệt. Đã ngừng dùng thì cho trùng — tên cũ phải ở lại để tra nhật ký.
CREATE UNIQUE INDEX "card_signers_active_name_title"
    ON "cemetery"."card_signers"("full_name", "title")
    WHERE "status" = 'Active';

-- NHIỀU NHẤT MỘT người mặc định trên toàn hệ.
-- Mọi dòng lọt vào index này đều có `is_default = true`, nên ràng buộc duy nhất trên chính
-- cột đó chỉ cho phép ĐÚNG một dòng tồn tại. Ép ở CSDL chứ không ở service: "nhớ bỏ cờ của
-- người cũ trước khi đặt người mới" là một quy ước, và quy ước thì có ngày ai đó quên.
CREATE UNIQUE INDEX "card_signers_one_default"
    ON "cemetery"."card_signers"("is_default")
    WHERE "is_default" = true;

-- Người đã NGỪNG DÙNG không được là mặc định.
-- Thiếu ràng buộc này thì ngừng dùng người mặc định sẽ để lại một màn hình cấp thẻ tự chọn
-- sẵn một cái tên không còn hiệu lực — và không có gì báo.
--
-- Bọc `IS TRUE` là nếp nhà: `CHECK` cho qua khi biểu thức ra NULL, nên mọi ràng buộc chạm
-- cột có thể NULL đều phải bọc. Hai cột dưới đây hiện đều NOT NULL, nhưng bọc sẵn thì một
-- lần ALTER nới NULL về sau không âm thầm vô hiệu hoá ràng buộc này.
ALTER TABLE "cemetery"."card_signers"
    ADD CONSTRAINT "card_signers_default_active_check"
    CHECK ((NOT "is_default" OR "status" = 'Active') IS TRUE);

-- Trạng thái là TẬP ĐÓNG. Gõ 'active' thường sẽ lọt qua mọi bộ lọc `status = 'Active'` và
-- biến một dòng thành vô hình thay vì báo lỗi.
ALTER TABLE "cemetery"."card_signers"
    ADD CONSTRAINT "card_signers_status_check"
    CHECK (("status" IN ('Active', 'Retired')) IS TRUE);
