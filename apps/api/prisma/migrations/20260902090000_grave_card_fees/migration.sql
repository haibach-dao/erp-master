-- Biểu phí cấp thẻ mộ — anh Bách chốt 02/09/2026.
--   cấp giấy LẦN ĐẦU 200.000đ phẳng (không nhân với gì)
--   mỗi lần IN LẠI  50.000đ × SỐ CỐT CỦA PHẦN MỘ
--   miễn phí: lỗi thuộc về công ty · khách nộp lại thẻ cũ (mất thẻ thì vẫn thu)
--
-- CỐ Ý KHÔNG đụng tới `card_print_logs`: thêm `grave_plot_id` vào đó sẽ đụng thẳng ràng
-- buộc `(customer_id, card_type, print_number)` và đổi nghĩa của dòng "Lần cấp: 02" đang
-- in trên tờ giấy khách cầm. Chiều phần mộ nằm ở `grave_card_fee_charges` dưới đây.
--
-- CỐ Ý KHÔNG dùng lại `audit.prevent_mutation()`: câu thông báo trong hàm đó hard-code
-- chuỗi "audit_events is append-only", nên gắn vào bảng khác là để người dùng nhận một lỗi
-- nói SAI tên bảng — loại lỗi mất cả buổi mới truy ra. Hàm mới dưới đây đọc tên bảng thật
-- từ TG_TABLE_SCHEMA/TG_TABLE_NAME.

-- CreateTable
CREATE TABLE "cemetery"."grave_card_fee_schedules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "card_type" TEXT NOT NULL DEFAULT 'GRAVE',
    "first_issue_fee" DECIMAL(14,0) NOT NULL,
    "reprint_fee_per_remains" DECIMAL(14,0) NOT NULL,
    "effective_from" DATE NOT NULL,
    "decision_ref" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grave_card_fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."grave_card_fee_charges" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "card_print_log_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "fee_kind" TEXT NOT NULL,
    "fee_schedule_id" TEXT NOT NULL,
    "unit_price" DECIMAL(14,0) NOT NULL,
    "remains_count" INTEGER NOT NULL,
    "fee_amount" DECIMAL(14,0) NOT NULL,
    "waived" BOOLEAN NOT NULL DEFAULT false,
    "waive_reason" TEXT,
    "charged_by" TEXT,
    "charged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grave_card_fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Tên rút ngắn theo đúng cách Prisma tự đặt: Postgres cắt định danh ở 63 ký tự,
-- nên tên đầy đủ ("..._effective_from_key") bị cắt thành một tên KHÁC và migrate diff báo lệch.
CREATE UNIQUE INDEX "grave_card_fee_schedules_company_id_card_type_effective_fro_key"
  ON "cemetery"."grave_card_fee_schedules"("company_id", "card_type", "effective_from");

-- CreateIndex
CREATE INDEX "grave_card_fee_schedules_company_id_effective_from_idx"
  ON "cemetery"."grave_card_fee_schedules"("company_id", "effective_from");

-- CreateIndex
CREATE INDEX "grave_card_fee_charges_card_print_log_id_idx"
  ON "cemetery"."grave_card_fee_charges"("card_print_log_id");

-- CreateIndex
CREATE INDEX "grave_card_fee_charges_customer_id_grave_plot_id_idx"
  ON "cemetery"."grave_card_fee_charges"("customer_id", "grave_plot_id");

-- CreateIndex
CREATE INDEX "grave_card_fee_charges_company_id_charged_at_idx"
  ON "cemetery"."grave_card_fee_charges"("company_id", "charged_at");

-- Một cặp (khách hàng, phần mộ) chỉ có ĐÚNG MỘT lần cấp giấy đầu tiên.
--
-- Đây là chỗ DUY NHẤT ép được luật đó. Suy từ `print_number = 1` là sai ở đúng ca thường
-- gặp nhất: khách đã có thẻ cho mộ A rồi mua thêm mộ B — lần cấp ấy là lần thứ hai của
-- KHÁCH nhưng là lần đầu của MỘ B, và ngược lại mộ A không được thu giá lần đầu lần nữa.
--
-- Partial index chứ không unique thường: REPRINT thì có bao nhiêu dòng cũng được, mỗi lần
-- in lại là một dòng. Ép ở tầng CSDL chứ không chỉ ở service vì hai quầy bấm cấp thẻ cùng
-- lúc thì kiểm-rồi-ghi ở tầng ứng dụng vẫn lọt cả hai (TOCTOU) — và cái lọt ra là thu tiền
-- lần đầu hai lần trên cùng một phần mộ.
CREATE UNIQUE INDEX "grave_card_fee_charges_first_issue"
  ON "cemetery"."grave_card_fee_charges"("customer_id", "grave_plot_id")
  WHERE "fee_kind" = 'FIRST_ISSUE';

-- Danh sách đóng, ép ở tầng CSDL. `waive_reason` chỉ được có khi thật sự miễn, và ngược
-- lại: miễn mà không nêu lý do thì không phải một quyết định, chỉ là một lần bấm.
ALTER TABLE "cemetery"."grave_card_fee_charges"
  ADD CONSTRAINT "grave_card_fee_charges_fee_kind_check"
  CHECK ("fee_kind" IN ('FIRST_ISSUE', 'REPRINT'));

-- `IS TRUE` bọc ngoài KHÔNG phải cho đẹp — không có nó thì ràng buộc này VÔ HIỆU ở đúng
-- ca cần chặn nhất, và đã lọt thật khi kiểm ngày 02/09/2026.
--
-- Với `waived = true, waive_reason = NULL`: vế một ra FALSE, vế hai ra `true AND (NULL IN
-- (...))` = NULL, nên cả biểu thức ra NULL. Và CHECK của Postgres CHO QUA khi biểu thức là
-- NULL — chỉ FALSE mới bị từ chối. Nghĩa là "miễn phí mà không nêu lý do" ghi được.
-- `(...) IS TRUE` quy NULL về FALSE, nên chỉ ĐÚNG mới lọt.
ALTER TABLE "cemetery"."grave_card_fee_charges"
  ADD CONSTRAINT "grave_card_fee_charges_waive_check"
  CHECK (
    (
      ("waived" = false AND "waive_reason" IS NULL)
      OR ("waived" = true AND "waive_reason" IN ('COMPANY_FAULT', 'OLD_CARD_RETURNED'))
    ) IS TRUE
  );

-- Số tiền phải là đơn giá × số cốt. Ép ở đây vì đó là bất biến của DỮ LIỆU, không phải
-- một phép tính của một phiên bản mã nào: bảng append-only nên một dòng sai nằm đó mãi.
ALTER TABLE "cemetery"."grave_card_fee_charges"
  ADD CONSTRAINT "grave_card_fee_charges_amount_check"
  CHECK ("remains_count" >= 1 AND "fee_amount" = "unit_price" * "remains_count");

-- Append-only cho CẢ HAI bảng: đơn giá đã ban hành và khoản đã thu không sửa được, kể cả
-- bằng tay trên CSDL. Đổi giá = ban hành dòng mới; sửa khoản sai = ghi dòng mới.
--
-- Hàm riêng, không dùng lại `audit.prevent_mutation()` — xem lý do ở đầu file.
CREATE OR REPLACE FUNCTION "cemetery"."prevent_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '%.% is append-only: % is not allowed',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "grave_card_fee_schedules_append_only"
BEFORE UPDATE OR DELETE ON "cemetery"."grave_card_fee_schedules"
FOR EACH ROW EXECUTE FUNCTION "cemetery"."prevent_mutation"();

CREATE TRIGGER "grave_card_fee_charges_append_only"
BEFORE UPDATE OR DELETE ON "cemetery"."grave_card_fee_charges"
FOR EACH ROW EXECUTE FUNCTION "cemetery"."prevent_mutation"();

-- TRUNCATE đi vòng qua trigger FOR EACH ROW — nó không xoá theo hàng nên không có hàng nào
-- để trigger bắt. Đo được: bảng `audit.audit_events` cũng đang hở đúng chỗ này. Ở đây bịt,
-- vì hai bảng này là đơn giá đã ban hành và khoản tiền đã thu của khách: mất sạch bằng một
-- câu lệnh là mất luôn khả năng đối chứng với người đã trả tiền.
CREATE TRIGGER "grave_card_fee_schedules_no_truncate"
BEFORE TRUNCATE ON "cemetery"."grave_card_fee_schedules"
FOR EACH STATEMENT EXECUTE FUNCTION "cemetery"."prevent_mutation"();

CREATE TRIGGER "grave_card_fee_charges_no_truncate"
BEFORE TRUNCATE ON "cemetery"."grave_card_fee_charges"
FOR EACH STATEMENT EXECUTE FUNCTION "cemetery"."prevent_mutation"();
