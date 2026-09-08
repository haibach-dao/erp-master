-- CỬA PHÊ DUYỆT IN THẺ MỘ — lát 1. Anh Bách chốt 05/09/2026.
--
-- Nhân viên kinh doanh muốn cấp thẻ thì phải được NGƯỜI KÝ (quản lý nghĩa trang) duyệt trước.
-- Hồ sơ CHỤP NGƯỜI lúc gửi (điều 8): đổi người ký mặc định KHÔNG kéo hồ sơ đang chờ sang người
-- mới — ai gửi phải gửi lại. Đúng 03-APPROVAL-ENGINE.md:38.
--
-- BA THỨ CỐ Ý KHÔNG LÀM:
--
-- 1. KHÔNG append-only. cemetery.prevent_mutation() chặn UPDATE tuyệt đối, mà đây là MÁY TRẠNG
--    THÁI — duyệt là UPDATE dòng đang chờ để ghi decided_by. Gắn trigger đó vào đây là khoá
--    chết chính tính năng. Dấu vết không mất: mọi lần chuyển trạng thái ghi một dòng
--    audit.audit_events, và bảng ĐÓ mới là bảng append-only.
--
-- 2. KHÔNG có trạng thái CONSUMED. Bộ trạng thái dùng ĐÚNG 8 tên của blueprint để ngày lên
--    engine chung không phải dịch lại. "Đã tiêu" biểu diễn bằng CỘT consumed_card_print_log_id,
--    và luật "một phê duyệt tiêu đúng MỘT lần cấp" ép bằng partial unique index trên cột đó —
--    không phải bằng quy ước ở service.
--
-- 3. KHÔNG bật cửa cho ai cả. card_approval_settings.required mặc định FALSE, và bảng này rỗng
--    lúc migration chạy. Nghĩa là sau khi triển khai, KHÔNG công ty nào bị chặn — cửa dựng xong
--    nằm im cho tới khi có màn hình gửi/duyệt (lát 2) và có người bật từng công ty. Ship một
--    cửa chặn mà chưa ai gửi duyệt được chính là lỗi "tính năng không ai dùng được" của lát 0.

-- ---------------------------------------------------------------------------
-- 1. Cờ bật theo CÔNG TY (anh Bách chốt điều 7)
-- ---------------------------------------------------------------------------
CREATE TABLE "cemetery"."card_approval_settings" (
    "company_id" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "card_approval_settings_pkey" PRIMARY KEY ("company_id")
);

-- ---------------------------------------------------------------------------
-- 2. Hồ sơ trình duyệt cấp thẻ
-- ---------------------------------------------------------------------------
CREATE TABLE "cemetery"."card_issue_approvals" (
    "id" TEXT NOT NULL,

    -- Vỏ theo TỪ VỰNG của approval engine (blueprint 03) để ngày nâng lên engine chung thì phần
    -- vỏ đi thẳng sang workflow.approval_instances bằng một câu INSERT ... SELECT.
    "request_type" TEXT NOT NULL DEFAULT 'CEMETERY_CARD_ISSUE',
    "state" TEXT NOT NULL DEFAULT 'SUBMITTED',

    -- Ruột riêng của thẻ mộ.
    "company_id" TEXT NOT NULL,
    "cemetery_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,

    -- ẢNH CHỤP bộ phần mộ và bản báo giá tại thời điểm GỬI. Chụp chứ không tra lại: biểu phí
    -- hiệu lực theo NGÀY và bậc giá đọc trạng thái bảng phí, nên tính lại lúc cấp có thể ra số
    -- khác số người ký đã gật.
    "plot_ids_snapshot" TEXT[] NOT NULL,
    "quote_snapshot" JSONB NOT NULL,
    "quote_total" DECIMAL(14,0) NOT NULL, -- VND, TRƯỚC khi xét miễn
    -- Băm của (bộ mộ đã sắp xếp + bậc giá từng dòng + đơn giá + số cốt + biểu phí + tổng tiền +
    -- cờ miễn). Đây mới là thứ giữ tiền đúng; đồng hồ chỉ giữ hộp thư sạch.
    "content_hash" TEXT NOT NULL,

    "waive_requested" BOOLEAN NOT NULL DEFAULT false,
    "waive_reason" TEXT,

    -- CHỤP NGƯỜI, không chụp ghế (điều 8). approver_signer_id giữ dòng danh mục đã chọn để tra
    -- lại được tên đã hiện ra lúc gửi, kể cả khi dòng đó về sau bị ngừng dùng.
    "approver_user_id" TEXT NOT NULL,
    "approver_signer_id" TEXT NOT NULL,

    "submitted_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    -- Đặt lúc DUYỆT, không phải lúc gửi: thứ hết hạn là BẢN BÁO GIÁ đã được gật.
    "expires_at" TIMESTAMPTZ(6),

    "consumed_card_print_log_id" TEXT,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "card_issue_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "card_issue_approvals_approver_user_id_state_idx"
    ON "cemetery"."card_issue_approvals"("approver_user_id", "state");
CREATE INDEX "card_issue_approvals_customer_id_submitted_at_idx"
    ON "cemetery"."card_issue_approvals"("customer_id", "submitted_at");
CREATE INDEX "card_issue_approvals_company_id_submitted_at_idx"
    ON "cemetery"."card_issue_approvals"("company_id", "submitted_at");

-- MỘT hồ sơ ĐANG CHỜ cho mỗi khách. Chỉ đặt trên SUBMITTED, KHÔNG gồm APPROVED:
--   · now() không IMMUTABLE nên không đưa expires_at vào điều kiện index được;
--   · nhiều dòng APPROVED cùng tồn tại là HỢP LỆ (một cái cũ đã hết hạn, một cái mới), lúc tiêu
--     thì chọn cái mới nhất còn hiệu lực.
-- Gộp APPROVED vào đây sẽ khoá cứng khách: hồ sơ duyệt rồi mà hết hạn thì không gửi lại được.
CREATE UNIQUE INDEX "card_issue_approvals_one_open"
    ON "cemetery"."card_issue_approvals"("customer_id")
    WHERE "state" = 'SUBMITTED';

-- MỘT phê duyệt tiêu ĐÚNG MỘT lần cấp thẻ. Ép ở CSDL chứ không ở service: "nhớ đánh dấu đã
-- tiêu" là một quy ước, và quy ước thì có ngày ai đó quên. Mỗi lần cấp là một lần THU TIỀN, nên
-- một phê duyệt cho hai lần cấp là thu tiền hai lần trên một quyết định.
CREATE UNIQUE INDEX "card_issue_approvals_one_consumer"
    ON "cemetery"."card_issue_approvals"("consumed_card_print_log_id")
    WHERE "consumed_card_print_log_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Ràng buộc
-- ---------------------------------------------------------------------------

-- Trạng thái là TẬP ĐÓNG, và dùng ĐÚNG 8 tên của 03-APPROVAL-ENGINE.md:32. Lát 1 chỉ CÀI 5
-- (SUBMITTED · APPROVED · REJECTED · RETURNED · CANCELLED); ba tên còn lại khai sẵn để engine
-- sau này không phải đổi ràng buộc — và để không ai tự chế một tên thứ chín.
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_state_check"
    CHECK (("state" IN (
        'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED',
        'REJECTED', 'RETURNED', 'CANCELLED', 'EXPIRED'
    )) IS TRUE);

-- KHÔNG duyệt hồ sơ do CHÍNH MÌNH gửi. 03-APPROVAL-ENGINE.md:26.
--
-- DẠNG VIẾT LÀ CHỖ CHẾT NGƯỜI, và migration lát 0 đã để sẵn cảnh báo này:
--   CHECK (("decided_by" <> "submitted_by") IS TRUE)   ← SAI, chặn sạch mọi hồ sơ đang chờ,
--   vì lúc chưa ai duyệt thì decided_by là NULL và (NULL <> x) IS TRUE ra FALSE.
-- Đo bằng psql 05/09/2026: SELECT (NULL::text <> 'a') IS TRUE  →  f
-- Luật "bọc IS TRUE" là để NGHĨ, không phải để dán.
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_no_self_approve_check"
    CHECK ("decided_by" IS NULL OR ("decided_by" <> "submitted_by") IS TRUE);

-- Hồ sơ RỖNG MỘ không có nghĩa gì — duyệt một tờ thẻ không có phần mộ nào.
--
-- cardinality, KHÔNG PHẢI array_length: array_length(ARRAY[]::text[], 1) trả NULL, và Postgres
-- CHO QUA khi biểu thức CHECK ra NULL. Đo bằng psql 05/09/2026.
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_plots_check"
    CHECK ((cardinality("plot_ids_snapshot") >= 1) IS TRUE);

-- Đã có QUYẾT ĐỊNH thì phải có ĐỦ người quyết và thời điểm quyết. 03-APPROVAL-ENGINE.md:27 đòi
-- lưu người duyệt THỰC TẾ, lý do và thời điểm; thiếu một trong ba thì dòng đó không trả lời được
-- câu "ai gật, lúc nào".
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_decided_check"
    CHECK ((
        "state" NOT IN ('APPROVED', 'REJECTED', 'RETURNED')
        OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
    ) IS TRUE);

-- TỪ CHỐI và TRẢ LẠI phải nêu lý do. Người gửi cần biết phải sửa gì; một dòng REJECTED trống lý
-- do buộc họ đi hỏi miệng, và không ai tra lại được vì sao.
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_reason_check"
    CHECK ((
        "state" NOT IN ('REJECTED', 'RETURNED')
        OR ("decision_note" IS NOT NULL AND length(btrim("decision_note")) >= 5)
    ) IS TRUE);

-- Chỉ hồ sơ ĐÃ DUYỆT mới có hạn và mới tiêu được.
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_approved_only_check"
    CHECK ((
        ("expires_at" IS NULL AND "consumed_card_print_log_id" IS NULL)
        OR "state" = 'APPROVED'
    ) IS TRUE);

-- Đã tiêu thì phải có ĐỦ cả lần cấp lẫn thời điểm — hai cột đi cùng nhau hoặc cùng rỗng.
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_consumed_pair_check"
    CHECK ((
        ("consumed_card_print_log_id" IS NULL) = ("consumed_at" IS NULL)
    ) IS TRUE);

-- Miễn phí phải nêu lý do. Cùng luật đã dựng cho grave_card_fee_charges 02/09 — và cùng chỗ đã
-- từng lọt vì quên bọc IS TRUE: (true AND (NULL IN (...))) ra NULL, và NULL thì CHECK cho qua.
ALTER TABLE "cemetery"."card_issue_approvals"
    ADD CONSTRAINT "card_issue_approvals_waive_check"
    CHECK ((
        ("waive_requested" = false AND "waive_reason" IS NULL)
        OR ("waive_requested" = true AND "waive_reason" IS NOT NULL)
    ) IS TRUE);
