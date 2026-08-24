-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "contracts";

-- CreateTable
CREATE TABLE "contracts"."external_contracts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "contract_no" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "contract_file_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Uploaded',
    "source_type" TEXT,
    "signed_at" DATE,
    "valid_to" DATE,
    "total_amount" DECIMAL(14,0),
    "verified_by" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "activated_by" TEXT,
    "activated_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "external_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts"."contract_parties" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."grave_usage_rights" (
    "id" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "holder_customer_id" TEXT NOT NULL,
    "source_contract_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grave_usage_rights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_contracts_grave_plot_id_idx" ON "contracts"."external_contracts"("grave_plot_id");

-- CreateIndex
CREATE INDEX "external_contracts_company_id_status_idx" ON "contracts"."external_contracts"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_contracts_company_id_contract_no_key" ON "contracts"."external_contracts"("company_id", "contract_no");

-- CreateIndex
CREATE INDEX "contract_parties_contract_id_idx" ON "contracts"."contract_parties"("contract_id");

-- CreateIndex
CREATE INDEX "grave_usage_rights_grave_plot_id_idx" ON "cemetery"."grave_usage_rights"("grave_plot_id");

-- CreateIndex
CREATE INDEX "grave_usage_rights_holder_customer_id_idx" ON "cemetery"."grave_usage_rights"("holder_customer_id");

-- AddForeignKey
ALTER TABLE "contracts"."contract_parties" ADD CONSTRAINT "contract_parties_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"."external_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One Active contract per grave plot; one Active usage right per grave plot.
CREATE UNIQUE INDEX "external_contracts_active_plot" ON "contracts"."external_contracts"("grave_plot_id") WHERE "status" = 'Active';
CREATE UNIQUE INDEX "grave_usage_rights_active_plot" ON "cemetery"."grave_usage_rights"("grave_plot_id") WHERE "status" = 'Active';
