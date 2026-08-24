-- CreateTable
CREATE TABLE "authz"."role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "company_id" TEXT,
    "scope" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_assignments_user_id_idx" ON "authz"."role_assignments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_user_id_role_id_company_id_key" ON "authz"."role_assignments"("user_id", "role_id", "company_id");

-- AddForeignKey
ALTER TABLE "authz"."role_assignments" ADD CONSTRAINT "role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "authz"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
