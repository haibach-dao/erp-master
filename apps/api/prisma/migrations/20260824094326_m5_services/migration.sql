-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "services";

-- CreateTable
CREATE TABLE "services"."service_catalog" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(14,0) NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "reminder_days" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services"."service_subscriptions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "service_catalog_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "agreed_price" DECIMAL(14,0) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "previous_subscription_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services"."service_transactions" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "service_catalog_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_catalog_company_id_code_key" ON "services"."service_catalog"("company_id", "code");

-- CreateIndex
CREATE INDEX "service_subscriptions_grave_plot_id_idx" ON "services"."service_subscriptions"("grave_plot_id");

-- CreateIndex
CREATE INDEX "service_subscriptions_status_effective_to_idx" ON "services"."service_subscriptions"("status", "effective_to");

-- CreateIndex
CREATE INDEX "service_transactions_company_id_paid_at_idx" ON "services"."service_transactions"("company_id", "paid_at");

-- CreateIndex
CREATE INDEX "service_transactions_service_catalog_id_idx" ON "services"."service_transactions"("service_catalog_id");

-- AddForeignKey
ALTER TABLE "services"."service_subscriptions" ADD CONSTRAINT "service_subscriptions_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "services"."service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services"."service_transactions" ADD CONSTRAINT "service_transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "services"."service_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
