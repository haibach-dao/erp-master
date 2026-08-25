-- Hạn hiệu lực cho việc cấp quyền + bảng cấm tường minh.
--
-- Mọi dòng ĐANG CÓ nhận valid_to = NULL (vô thời hạn). Nếu không, migration này sẽ
-- lấy mất quyền của toàn bộ người đang dùng hệ ngay khi chạy.
ALTER TABLE "authz"."role_assignments" ADD COLUMN "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "authz"."role_assignments" ADD COLUMN "valid_to" TIMESTAMPTZ(6);
ALTER TABLE "authz"."role_assignments" ADD COLUMN "granted_by" TEXT;
ALTER TABLE "authz"."role_assignments" ADD COLUMN "grant_reason" TEXT;

ALTER TABLE "authz"."scope_assignments" ADD COLUMN "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "authz"."scope_assignments" ADD COLUMN "valid_to" TIMESTAMPTZ(6);

-- Luật truy cập có THỨ TỰ (mô hình tường lửa): duyệt priority tăng dần, luật khớp
-- trước thì quyết và dừng. Không luật nào khớp thì rơi xuống ma trận vai; không grant
-- nào phủ thì 403 — "deny all" ngầm ở cuối, do guard mặc-định-từ-chối đảm nhiệm.
CREATE TABLE "authz"."access_rules" (
    "id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "effect" TEXT NOT NULL,
    "subject_user_id" TEXT,
    "role_code" TEXT,
    "permission_code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_rules_effect_check" CHECK ("effect" IN ('ALLOW', 'DENY'))
);

CREATE INDEX "access_rules_priority_idx" ON "authz"."access_rules"("priority");
CREATE INDEX "access_rules_subject_user_id_idx" ON "authz"."access_rules"("subject_user_id");
CREATE INDEX "access_rules_permission_code_idx" ON "authz"."access_rules"("permission_code");
