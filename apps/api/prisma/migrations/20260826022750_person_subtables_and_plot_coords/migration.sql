-- AlterTable
ALTER TABLE "cemetery"."grave_plots" ADD COLUMN     "map_x" DOUBLE PRECISION,
ADD COLUMN     "map_y" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "cemetery"."person_phones" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "kind" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."person_addresses" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."person_education" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "school" TEXT,
    "major" TEXT,
    "degree" TEXT,
    "graduation_year" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."person_bank_accounts" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_holder" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_phones_person_id_idx" ON "cemetery"."person_phones"("person_id");

-- CreateIndex
CREATE INDEX "person_addresses_person_id_idx" ON "cemetery"."person_addresses"("person_id");

-- CreateIndex
CREATE INDEX "person_education_person_id_idx" ON "cemetery"."person_education"("person_id");

-- CreateIndex
CREATE INDEX "person_bank_accounts_person_id_idx" ON "cemetery"."person_bank_accounts"("person_id");

-- AddForeignKey
ALTER TABLE "cemetery"."person_phones" ADD CONSTRAINT "person_phones_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cemetery"."persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."person_addresses" ADD CONSTRAINT "person_addresses_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cemetery"."persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."person_education" ADD CONSTRAINT "person_education_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cemetery"."persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."person_bank_accounts" ADD CONSTRAINT "person_bank_accounts_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cemetery"."persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
