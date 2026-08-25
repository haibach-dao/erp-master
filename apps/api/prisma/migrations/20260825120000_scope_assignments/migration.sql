-- Hub axis: which cemeteries a person covers, independent of which role they hold.
-- Many-to-many by decision (doc 16 Q15): a cemetery has several people, and a person
-- may cover several cemeteries. No rows are inserted; nobody gains access from this.
CREATE TABLE "authz"."scope_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "cemetery_id" TEXT NOT NULL,
    "granted_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scope_assignments_user_id_cemetery_id_key" ON "authz"."scope_assignments"("user_id", "cemetery_id");
CREATE INDEX "scope_assignments_user_id_idx" ON "authz"."scope_assignments"("user_id");
CREATE INDEX "scope_assignments_cemetery_id_idx" ON "authz"."scope_assignments"("cemetery_id");
