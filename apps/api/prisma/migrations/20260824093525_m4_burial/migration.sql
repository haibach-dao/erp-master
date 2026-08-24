-- CreateTable
CREATE TABLE "cemetery"."deceased_persons" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "date_of_death" DATE,
    "death_cert_file_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deceased_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."burial_records" (
    "id" TEXT NOT NULL,
    "grave_plot_id" TEXT NOT NULL,
    "deceased_person_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "burial_date" DATE,
    "legal_doc_file_id" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "burial_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deceased_persons_person_id_key" ON "cemetery"."deceased_persons"("person_id");

-- CreateIndex
CREATE INDEX "burial_records_grave_plot_id_status_idx" ON "cemetery"."burial_records"("grave_plot_id", "status");

-- CreateIndex
CREATE INDEX "burial_records_deceased_person_id_idx" ON "cemetery"."burial_records"("deceased_person_id");

-- AddForeignKey
ALTER TABLE "cemetery"."deceased_persons" ADD CONSTRAINT "deceased_persons_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cemetery"."persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."burial_records" ADD CONSTRAINT "burial_records_deceased_person_id_fkey" FOREIGN KEY ("deceased_person_id") REFERENCES "cemetery"."deceased_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
