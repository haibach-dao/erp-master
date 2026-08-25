-- Permission catalog metadata (blueprint doc 16 §D.4).
-- Adds admin-facing columns only; no rows are inserted, no grant is changed.
ALTER TABLE "authz"."permissions" ADD COLUMN "sensitivity" TEXT NOT NULL DEFAULT 'S1';
ALTER TABLE "authz"."permissions" ADD COLUMN "wildcard_exempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "authz"."permissions" ADD COLUMN "introduced_in" TEXT;
ALTER TABLE "authz"."permissions" ADD COLUMN "reviewed_at" TIMESTAMPTZ(6);
