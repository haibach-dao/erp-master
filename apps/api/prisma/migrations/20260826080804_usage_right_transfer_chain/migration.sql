-- AlterTable
ALTER TABLE "cemetery"."grave_usage_rights" ADD COLUMN     "ended_reason" TEXT,
ADD COLUMN     "previous_right_id" TEXT;

-- CreateIndex
CREATE INDEX "grave_usage_rights_previous_right_id_idx" ON "cemetery"."grave_usage_rights"("previous_right_id");
