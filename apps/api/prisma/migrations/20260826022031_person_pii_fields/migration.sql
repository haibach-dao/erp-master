-- AlterTable
ALTER TABLE "cemetery"."persons" ADD COLUMN     "contact_address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "ethnicity" TEXT,
ADD COLUMN     "national_id_issued_on" DATE,
ADD COLUMN     "national_id_issued_place" TEXT,
ADD COLUMN     "permanent_address" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "religion" TEXT;
