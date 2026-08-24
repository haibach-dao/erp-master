-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cemetery";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "org";

-- CreateTable
CREATE TABLE "org"."companies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."cemeteries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cemeteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."grave_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_capacity" INTEGER NOT NULL DEFAULT 1,
    "reference_price" DECIMAL(14,0),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."grave_plots" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "cemetery_id" TEXT NOT NULL,
    "grave_type_id" TEXT NOT NULL,
    "plot_code" TEXT NOT NULL,
    "zone" TEXT,
    "subzone" TEXT,
    "block" TEXT,
    "row" TEXT,
    "capacity_override" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Available',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grave_plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."grave_plot_status_history" (
    "id" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "reason" TEXT,
    "changed_by" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grave_plot_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."relationship_types" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reciprocal_code" TEXT NOT NULL,
    "gender_specific" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "relationship_types_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_code_key" ON "org"."companies"("code");

-- CreateIndex
CREATE INDEX "cemeteries_company_id_idx" ON "cemetery"."cemeteries"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "cemeteries_company_id_code_key" ON "cemetery"."cemeteries"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "grave_types_company_id_code_key" ON "cemetery"."grave_types"("company_id", "code");

-- CreateIndex
CREATE INDEX "grave_plots_company_id_status_idx" ON "cemetery"."grave_plots"("company_id", "status");

-- CreateIndex
CREATE INDEX "grave_plots_cemetery_id_idx" ON "cemetery"."grave_plots"("cemetery_id");

-- CreateIndex
CREATE UNIQUE INDEX "grave_plots_company_id_plot_code_key" ON "cemetery"."grave_plots"("company_id", "plot_code");

-- CreateIndex
CREATE INDEX "grave_plot_status_history_grave_plot_id_changed_at_idx" ON "cemetery"."grave_plot_status_history"("grave_plot_id", "changed_at");

-- AddForeignKey
ALTER TABLE "cemetery"."grave_plots" ADD CONSTRAINT "grave_plots_cemetery_id_fkey" FOREIGN KEY ("cemetery_id") REFERENCES "cemetery"."cemeteries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."grave_plots" ADD CONSTRAINT "grave_plots_grave_type_id_fkey" FOREIGN KEY ("grave_type_id") REFERENCES "cemetery"."grave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."grave_plot_status_history" ADD CONSTRAINT "grave_plot_status_history_grave_plot_id_fkey" FOREIGN KEY ("grave_plot_id") REFERENCES "cemetery"."grave_plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
