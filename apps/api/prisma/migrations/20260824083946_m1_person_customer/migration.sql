-- CreateTable
CREATE TABLE "cemetery"."persons" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" TEXT,
    "date_of_birth" DATE,
    "national_id_hash" TEXT,
    "national_id_masked" TEXT,
    "national_id_cipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."customers" (
    "id" TEXT NOT NULL,
    "person_id" TEXT,
    "customer_code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "org_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "company_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cemetery"."family_relationships" (
    "id" TEXT NOT NULL,
    "source_person_id" TEXT NOT NULL,
    "target_person_id" TEXT NOT NULL,
    "relationship_type" TEXT NOT NULL,
    "reciprocal_relationship_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Confirmed',
    "effective_from" DATE,
    "effective_to" DATE,
    "verification_source" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "family_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persons_national_id_hash_idx" ON "cemetery"."persons"("national_id_hash");

-- CreateIndex
CREATE INDEX "persons_full_name_idx" ON "cemetery"."persons"("full_name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_person_id_key" ON "cemetery"."customers"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customer_code_key" ON "cemetery"."customers"("customer_code");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "cemetery"."customers"("phone");

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "cemetery"."customers"("email");

-- CreateIndex
CREATE INDEX "customers_company_id_idx" ON "cemetery"."customers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_relationships_reciprocal_relationship_id_key" ON "cemetery"."family_relationships"("reciprocal_relationship_id");

-- CreateIndex
CREATE INDEX "family_relationships_source_person_id_idx" ON "cemetery"."family_relationships"("source_person_id");

-- CreateIndex
CREATE INDEX "family_relationships_target_person_id_idx" ON "cemetery"."family_relationships"("target_person_id");

-- AddForeignKey
ALTER TABLE "cemetery"."customers" ADD CONSTRAINT "customers_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "cemetery"."persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."family_relationships" ADD CONSTRAINT "family_relationships_source_person_id_fkey" FOREIGN KEY ("source_person_id") REFERENCES "cemetery"."persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cemetery"."family_relationships" ADD CONSTRAINT "family_relationships_target_person_id_fkey" FOREIGN KEY ("target_person_id") REFERENCES "cemetery"."persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
