-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "iam";

-- CreateTable
CREATE TABLE "iam"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_events" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chain_partition_date_utc" DATE NOT NULL,
    "company_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "changed_fields" TEXT[],
    "correlation_id" TEXT,
    "ip_address" TEXT,
    "source" TEXT NOT NULL DEFAULT 'API',
    "previous_event_hash" TEXT,
    "event_hash" TEXT NOT NULL,
    "hash_algorithm_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "iam"."users"("email");

-- CreateIndex
CREATE INDEX "audit_events_company_id_occurred_at_idx" ON "audit"."audit_events"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit"."audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit"."audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit"."audit_events"("action");

-- Append-only guard: block UPDATE/DELETE on audit_events for ALL roles (incl. superuser).
CREATE OR REPLACE FUNCTION "audit"."prevent_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit"."audit_events"
FOR EACH ROW EXECUTE FUNCTION "audit"."prevent_mutation"();
