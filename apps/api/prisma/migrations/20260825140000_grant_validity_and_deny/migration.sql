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

-- Deny thắng allow. Với quy tắc hợp, đây là cơ chế duy nhất còn lại chặn được một
-- quyền đã cấp — nó tồn tại cho LÀN CẤM.
CREATE TABLE "authz"."permission_denies" (
    "id" TEXT NOT NULL,
    "subject_user_id" TEXT,
    "role_id" TEXT,
    "permission_code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_denies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "permission_denies_subject_user_id_idx" ON "authz"."permission_denies"("subject_user_id");
CREATE INDEX "permission_denies_permission_code_idx" ON "authz"."permission_denies"("permission_code");
