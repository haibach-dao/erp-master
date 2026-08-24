-- CreateTable
CREATE TABLE "cemetery"."grave_holds" (
    "id" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "created_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "grave_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grave_holds_grave_plot_id_idx" ON "cemetery"."grave_holds"("grave_plot_id");

-- CreateIndex
CREATE INDEX "grave_holds_status_expires_at_idx" ON "cemetery"."grave_holds"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "cemetery"."grave_holds" ADD CONSTRAINT "grave_holds_grave_plot_id_fkey" FOREIGN KEY ("grave_plot_id") REFERENCES "cemetery"."grave_plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."grave_holds" ADD CONSTRAINT "grave_holds_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "cemetery"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One Active hold per grave plot (chống double-hold), enforced at DB level.
CREATE UNIQUE INDEX "grave_holds_active_unique" ON "cemetery"."grave_holds"("grave_plot_id") WHERE "status" = 'Active';
