-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "common";

-- CreateTable
CREATE TABLE "common"."outbox_events" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedup_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 10,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedup_key_key" ON "common"."outbox_events"("dedup_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "common"."outbox_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_company_id_chain_partition_date_utc_idx" ON "audit"."audit_events"("company_id", "chain_partition_date_utc");
