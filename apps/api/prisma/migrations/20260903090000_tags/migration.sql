-- THẺ NHÃN cho phần mộ và cho khách hàng — anh Bách chốt 03/09/2026.
--
--   HAI danh mục TÁCH RIÊNG (thẻ mộ, thẻ khách), và CẢ HAI đều TOÀN HỆ — không chia theo
--   công ty. "Cần sửa bia" là cùng một ý ở mọi nghĩa trang, khai lại cho từng công ty là
--   việc thừa; còn thẻ dán lên VẬT và thẻ dán lên NGƯỜI thì phải ở hai chỗ.
--
-- VÌ SAO TÁCH HAI BẢNG, chứ không một bảng có cột "dùng cho mộ hay cho khách":
-- tách làm ranh giới đạo đức thành ranh giới CẤU TRÚC. Một thẻ nói về con người không thể
-- lỡ tay gắn lên mộ, và ngược lại — không phải vì có một cột kiểm đúng hay một câu `if`
-- trong service, mà vì KHOÁ NGOẠI không nối tới được. Đo được: gắn một thẻ khách lên bảng
-- thẻ mộ bị `grave_plot_tags_tag_type_id_fkey` từ chối.
--
-- Rào thứ hai nằm trên `customer_tag_types.subject`: mỗi thẻ khách phải khai nó nói về HỒ SƠ
-- hay GIAO DỊCH. Thẻ nói về tính cách, sức khoẻ, tôn giáo, khả năng chi trả KHÔNG CÓ GIÁ TRỊ
-- NÀO ĐỂ KHAI — nó chết ở đây, không chết ở chỗ người ta nhắc nhau.
-- Bảng thẻ MỘ cố ý KHÔNG có cột đó: "bia nứt" không thể trở thành một nhận định về ai.
--
-- ĐỢT 1 thẻ KHÔNG chặn nghiệp vụ nào, chỉ để xem và lọc. Ngày nào thẻ chặn được một việc,
-- phải rà lại toàn bộ file này và chuỗi phê duyệt đi kèm.

-- CreateTable
CREATE TABLE "cemetery"."grave_plot_tag_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grave_plot_tag_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."customer_tag_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_tag_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."grave_plot_tags" (
    "id" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "tag_type_id" TEXT NOT NULL,
    "assigned_by" TEXT,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by" TEXT,
    "removed_at" TIMESTAMPTZ(6),
    "remove_reason" TEXT,

    CONSTRAINT "grave_plot_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."customer_tags" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "tag_type_id" TEXT NOT NULL,
    "assigned_by" TEXT,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by" TEXT,
    "removed_at" TIMESTAMPTZ(6),
    "remove_reason" TEXT,

    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Mã DUY NHẤT TOÀN HỆ, không phải duy nhất trong một công ty: đây là thứ giữ cho
-- "VIP" / "vip" / "V.I.P" không cùng tồn tại. Hai danh mục có hai không gian mã riêng —
-- thẻ mộ và thẻ khách trùng mã nhau là chuyện bình thường và không gây nhầm.
CREATE UNIQUE INDEX "grave_plot_tag_types_code_key" ON "cemetery"."grave_plot_tag_types"("code");
CREATE INDEX "grave_plot_tag_types_status_idx" ON "cemetery"."grave_plot_tag_types"("status");

CREATE UNIQUE INDEX "customer_tag_types_code_key" ON "cemetery"."customer_tag_types"("code");
CREATE INDEX "customer_tag_types_status_subject_idx"
  ON "cemetery"."customer_tag_types"("status", "subject");

CREATE INDEX "grave_plot_tags_grave_plot_id_removed_at_idx"
  ON "cemetery"."grave_plot_tags"("grave_plot_id", "removed_at");
CREATE INDEX "grave_plot_tags_tag_type_id_idx" ON "cemetery"."grave_plot_tags"("tag_type_id");

CREATE INDEX "customer_tags_customer_id_removed_at_idx"
  ON "cemetery"."customer_tags"("customer_id", "removed_at");
CREATE INDEX "customer_tags_tag_type_id_idx" ON "cemetery"."customer_tags"("tag_type_id");

-- Một mộ (một khách) không mang HAI lần CÙNG một thẻ cùng lúc.
--
-- Partial index chứ không unique thường: gắn lại một thẻ đã từng gỡ là việc bình thường
-- ("bia nứt lần nữa"), còn unique thường sẽ cấm nó VĨNH VIỄN sau lần gỡ đầu tiên.
--
-- Ép ở tầng CSDL vì kiểm-rồi-ghi ở tầng ứng dụng vẫn lọt khi hai người bấm cùng lúc (TOCTOU).
CREATE UNIQUE INDEX "grave_plot_tags_active"
  ON "cemetery"."grave_plot_tags"("grave_plot_id", "tag_type_id")
  WHERE "removed_at" IS NULL;

CREATE UNIQUE INDEX "customer_tags_active"
  ON "cemetery"."customer_tags"("customer_id", "tag_type_id")
  WHERE "removed_at" IS NULL;

-- AddForeignKey
--
-- Bốn khoá ngoại này LÀ cái rào. `grave_plot_tags.tag_type_id` chỉ trỏ được vào
-- `grave_plot_tag_types`, nên không có đường nào — kể cả một service viết sai — đưa một thẻ
-- khách lên một phần mộ.
ALTER TABLE "cemetery"."grave_plot_tags"
  ADD CONSTRAINT "grave_plot_tags_grave_plot_id_fkey"
  FOREIGN KEY ("grave_plot_id") REFERENCES "cemetery"."grave_plots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cemetery"."grave_plot_tags"
  ADD CONSTRAINT "grave_plot_tags_tag_type_id_fkey"
  FOREIGN KEY ("tag_type_id") REFERENCES "cemetery"."grave_plot_tag_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cemetery"."customer_tags"
  ADD CONSTRAINT "customer_tags_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "cemetery"."customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cemetery"."customer_tags"
  ADD CONSTRAINT "customer_tags_tag_type_id_fkey"
  FOREIGN KEY ("tag_type_id") REFERENCES "cemetery"."customer_tag_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- RANH GIỚI ĐẠO ĐỨC, nửa thứ hai — chỉ có ở bảng thẻ KHÁCH.
--
-- HO_SO     : một THIẾU SÓT CỦA BẢN GHI (thiếu CCCD, thiếu giấy chứng tử). Sửa xong thì gỡ.
-- GIAO_DICH : một SỰ KIỆN ĐÃ XẢY RA (mua trước chưa an táng, đứng tên 3 mộ).
--
-- Cả hai đều kiểm chứng được bằng dữ liệu trong hệ, và cả hai đều có thể thôi đúng. Một thẻ
-- nói về tính cách thì không — nó không có ô nào để khai ở đây.
--
-- Thước đo: mọi thẻ khách phải chịu được việc ĐỌC TO TRƯỚC MẶT CHÍNH KHÁCH.
ALTER TABLE "cemetery"."customer_tag_types"
  ADD CONSTRAINT "customer_tag_types_subject_check"
  CHECK ("subject" IN ('HO_SO', 'GIAO_DICH'));

ALTER TABLE "cemetery"."grave_plot_tag_types"
  ADD CONSTRAINT "grave_plot_tag_types_status_check"
  CHECK ("status" IN ('Active', 'Retired'));

ALTER TABLE "cemetery"."customer_tag_types"
  ADD CONSTRAINT "customer_tag_types_status_check"
  CHECK ("status" IN ('Active', 'Retired'));

-- Người gỡ / lý do gỡ chỉ được ghi khi ĐÃ gỡ. Không có ràng buộc này thì tồn tại được dòng
-- "ai đó đã gỡ" trong khi thẻ vẫn đang gắn — và bảng lưu vết nói dối.
--
-- Bọc IS TRUE, KHÔNG bỏ được: các cột đều NULLABLE, mà CHECK của Postgres CHO QUA khi biểu
-- thức ra NULL — chỉ FALSE mới bị từ chối. Đã tự cắn đúng bẫy này ngày 02/09/2026 ở ràng
-- buộc miễn phí cấp thẻ, và ràng buộc khi đó VÔ HIỆU ở đúng ca cần chặn.
ALTER TABLE "cemetery"."grave_plot_tags"
  ADD CONSTRAINT "grave_plot_tags_removal_check"
  CHECK ((("removed_by" IS NULL AND "remove_reason" IS NULL) OR "removed_at" IS NOT NULL) IS TRUE);

ALTER TABLE "cemetery"."customer_tags"
  ADD CONSTRAINT "customer_tags_removal_check"
  CHECK ((("removed_by" IS NULL AND "remove_reason" IS NULL) OR "removed_at" IS NOT NULL) IS TRUE);
