-- CreateTable
CREATE TABLE "cemetery"."card_print_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "print_number" INTEGER NOT NULL,
    "card_type" TEXT NOT NULL DEFAULT 'GRAVE',
    "print_reason" TEXT,
    "approved_by" TEXT,
    "approved_title" TEXT,
    "issued_by" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_print_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_print_logs_customer_id_issued_at_idx" ON "cemetery"."card_print_logs"("customer_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "card_print_logs_customer_id_card_type_print_number_key" ON "cemetery"."card_print_logs"("customer_id", "card_type", "print_number");
