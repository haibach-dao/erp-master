-- LÁT 0 — "Người ký thẻ mộ là NGƯỜI QUẢN LÝ NGHĨA TRANG" (anh Bách chốt 05/09/2026).
--
-- Đây là ĐẢO CÓ Ý THỨC quyết định 03/09/2026 của chính anh Bách, lúc đó chốt `card_signers`
-- là danh mục TOÀN HỆ và cố ý không có cột nghĩa trang. Lý do đảo: người ký phải bấm được
-- nút Duyệt trong luồng phê duyệt in thẻ, tức phải có tài khoản; và vai `QL_NGHIA_TRANG` là
-- vai phạm vi SITE, người giữ nó bị buộc vào những nghĩa trang cụ thể qua `scope_assignments`.
-- Ràng buộc "phải giữ vai" KHÔNG viết được thành CHECK (khác schema, và vai đổi theo thời
-- gian) nên nó nằm ở service; ở đây chỉ ép được phần CẤU TRÚC.

-- ---------------------------------------------------------------------------
-- 1. `iam.users` có HỌ TÊN và CHỨC DANH
-- ---------------------------------------------------------------------------
-- Toàn hệ KHÔNG có bảng nhân sự nào (schema `org` mới chỉ có `Company` 5 cột). Đây là
-- "danh sách nhân viên" nhỏ nhất chạy được — hai cột, không phải một module nhân sự.
--
-- Cả hai NULLABLE: 6 tài khoản đang có đều chưa có tên, và bắt NOT NULL là phải bịa dữ liệu
-- cho chúng. Ràng buộc "người ký phải đủ tên và chức danh" ép ở chỗ TẠO NGƯỜI KÝ, không ép
-- lên mọi tài khoản của hệ — ghế máy `system-worker@erp.local` không có chức danh nào cả.
--
-- `title` là CHỨC DANH HÀNH CHÍNH in lên tờ thẻ ("PHÓ GIÁM ĐỐC"), KHÔNG phải mã vai kỹ thuật
-- ("QL_NGHIA_TRANG"). Hai thứ khác nhau và không suy được cái này từ cái kia.
ALTER TABLE "iam"."users" ADD COLUMN "full_name" TEXT;
ALTER TABLE "iam"."users" ADD COLUMN "title" TEXT;

-- ---------------------------------------------------------------------------
-- 2. `card_signers` gắn vào TÀI KHOẢN và NGHĨA TRANG
-- ---------------------------------------------------------------------------
-- Cột trần, KHÔNG khoá ngoại sang `iam.users` — cùng nếp `authz.role_assignments`, vốn ghi
-- rõ "No FK to iam.users; userId is the iam.users id". Nối chéo schema ở đây sẽ là chỗ đầu
-- tiên trong hệ làm thế.
ALTER TABLE "cemetery"."card_signers" ADD COLUMN "user_id" TEXT;
ALTER TABLE "cemetery"."card_signers" ADD COLUMN "cemetery_id" TEXT;

-- Dòng người ký đang có được nhập tay ngày 05/09 và KHÔNG nối tài khoản nào, nên theo luật
-- mới nó không còn hợp lệ. NGỪNG DÙNG chứ KHÔNG xoá: nếp copy-based, và thẻ cấp về sau vẫn
-- phải đọc ra được tên người đã ký.
--
-- Bỏ cờ mặc định TRONG CÙNG một lệnh UPDATE. Tách làm hai lệnh thì lệnh đầu để lại một dòng
-- `is_default = true, status = 'Retired'` và `card_signers_default_active_check` từ chối
-- ngay — migration chết giữa chừng. Một UPDATE đặt cả hai cột thì hàng chỉ bị soi một lần,
-- lúc đã ở trạng thái hợp lệ.
UPDATE "cemetery"."card_signers"
   SET "status" = 'Retired', "is_default" = false
 WHERE "user_id" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Dựng lại HAI unique index — cả hai đều sai với mô hình mới
-- ---------------------------------------------------------------------------
-- `card_signers_active_name_title` chống hai dòng in ra giống hệt nhau. Nay danh tính người
-- ký là TÀI KHOẢN, nên trùng tên không còn là câu hỏi: hai người trùng tên là hai tài khoản
-- khác nhau và phân biệt được. Thứ phải chống bây giờ là MỘT NGƯỜI hai dòng ở CÙNG một
-- nghĩa trang.
DROP INDEX "cemetery"."card_signers_active_name_title";
CREATE UNIQUE INDEX "card_signers_active_user_site"
    ON "cemetery"."card_signers"("cemetery_id", "user_id")
    WHERE "status" = 'Active';

-- `card_signers_one_default` cho ĐÚNG MỘT người mặc định trên TOÀN HỆ. Nay là một người
-- mặc định MỖI NGHĨA TRANG.
--
-- Đây cũng chính là chỗ đỡ được ca thật của anh Bách: một người đang quản lý CẢ HAI nghĩa
-- trang thì người đó có hai dòng, mỗi nghĩa trang một dòng, và CẢ HAI đều là mặc định —
-- hợp lệ, vì tính duy nhất đo theo `cemetery_id` chứ không theo người.
DROP INDEX "cemetery"."card_signers_one_default";
CREATE UNIQUE INDEX "card_signers_one_default_per_site"
    ON "cemetery"."card_signers"("cemetery_id")
    WHERE "is_default" = true AND "status" = 'Active';

CREATE INDEX "card_signers_cemetery_id_idx" ON "cemetery"."card_signers"("cemetery_id");

-- ---------------------------------------------------------------------------
-- 4. Dòng ĐANG DÙNG phải đủ cả tài khoản lẫn nghĩa trang
-- ---------------------------------------------------------------------------
-- Hai cột mới phải NULLABLE để dòng cũ ở lại được, nên tính bắt buộc chuyển sang CHECK có
-- điều kiện: chỉ đòi ở dòng `Active`.
--
-- Bọc `IS TRUE` là nếp nhà. Ở ĐÂY biểu thức không bao giờ ra NULL (`status` là NOT NULL, và
-- `IS NOT NULL` luôn trả boolean) nên lớp bọc thừa — giữ vì một lần ALTER nới NULL về sau sẽ
-- làm nó cần thiết, và vì bỏ đi thì người đọc phải tự chứng minh lại điều đó.
--
-- LƯU Ý cho ràng buộc tự-duyệt ở lát 1: KHÔNG được bê nguyên lối bọc này sang cột `decided_by`.
-- `CHECK (("decided_by" <> "submitted_by") IS TRUE)` sẽ CHẶN SẠCH mọi hồ sơ đang chờ, vì lúc
-- chưa ai duyệt thì `decided_by` là NULL và `(NULL <> x) IS TRUE` ra FALSE. Dạng đúng ở đó là
-- `"decided_by" IS NULL OR (...) IS TRUE`. Đã đo bằng psql 05/09/2026.
ALTER TABLE "cemetery"."card_signers"
    ADD CONSTRAINT "card_signers_active_needs_user_site"
    CHECK ((
        "status" <> 'Active'
        OR ("user_id" IS NOT NULL AND "cemetery_id" IS NOT NULL)
    ) IS TRUE);
