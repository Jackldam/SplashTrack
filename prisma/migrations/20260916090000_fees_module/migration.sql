-- ---------------------------------------------------------------------------
-- Phase 3.3 — the `fees` module: `FeeType`, `Charge`, `Payment`
-- (`01-domain-model.md` §2.2/§5, `15-assessment-and-fees.md` §6; R-32,
-- D-088, D-090, D-091, D-092).
--
-- Billing-LITE, and the line is the document (D-091): no invoice, no payment
-- provider, no SEPA/iDEAL, no VAT, no sequential numbering. Money is an
-- INTEGER in minor units (eurocent) everywhere below, never a float.
--
-- `Charge.status` stores three states (`OPEN`, `WAIVED`, `CANCELLED`), not
-- `15-…` §6.1's five — `PAID`/`PARTIAL` are computed at read time from
-- `sum(Payment.amount)` against `amount`, never stored, per the build
-- brief's "balance is derived from immutable financial facts, not a mutable
-- cached total". See `model Charge`'s own comment and the phase 3.3 report.
--
-- D-089's automatic exam-fee charge and §6.2's scheduled periodic-billing
-- job are DELIBERATELY NOT WIRED in this phase — see the phase 3.3 report
-- §1 for why. This migration only adds the tables and the manual
-- administrator-driven write path they need to exist for either to be added
-- later without a further migration.
--
-- THE APPEND-ONLY / COLUMN-RESTRICTED PROPERTY OF `Charge`/`Payment` IS NOT
-- IN THIS FILE. Privileges are applied AFTER every migration by
-- `db:apply-grants` (`feesGrantStatements` in `src/lib/database/role-model.ts`,
-- documented in `infra/fees-database-role.sql`): the runtime role gets
-- `SELECT, INSERT` on both tables, plus a column-restricted `UPDATE` on
-- `Charge` limited to exactly the waive/cancel pair — the `Award` precedent
-- (phase 2.4). `FeeType` is an ordinary mutable catalogue table (the
-- `AwardType`/`Course` shape) and carries no carve-out.
--
-- ENCRYPTED-COLUMN-IMPACT: none. `Charge.note`/`Payment.reference` are plain,
-- unprotected text — the `ExamResult.remarks` precedent, not the D-148
-- protected-free-text class. See the schema's own model comments and the
-- phase 3.3 report.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "FeeRecurrence" AS ENUM ('PERIODIC', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('OPEN', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK', 'CASH', 'OTHER');

-- CreateTable
CREATE TABLE "FeeType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "recurrence" "FeeRecurrence" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "payerPersonId" TEXT,
    "studentProfileId" TEXT,
    "feeTypeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "waivedByPersonId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "cancelledByPersonId" TEXT,
    "createdByPersonId" TEXT,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "recordedByPersonId" TEXT,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeType_code_key" ON "FeeType"("code");

-- CreateIndex
CREATE INDEX "FeeType_active_idx" ON "FeeType"("active");

-- CreateIndex — P-02's idempotency key.
CREATE UNIQUE INDEX "Charge_clientEventId_key" ON "Charge"("clientEventId");

-- CreateIndex
CREATE INDEX "Charge_payerPersonId_idx" ON "Charge"("payerPersonId");

-- CreateIndex
CREATE INDEX "Charge_studentProfileId_idx" ON "Charge"("studentProfileId");

-- CreateIndex
CREATE INDEX "Charge_feeTypeId_idx" ON "Charge"("feeTypeId");

-- CreateIndex
CREATE INDEX "Charge_status_idx" ON "Charge"("status");

-- CreateIndex
CREATE INDEX "Charge_dueDate_idx" ON "Charge"("dueDate");

-- CreateIndex
CREATE INDEX "Charge_waivedByPersonId_idx" ON "Charge"("waivedByPersonId");

-- CreateIndex
CREATE INDEX "Charge_cancelledByPersonId_idx" ON "Charge"("cancelledByPersonId");

-- CreateIndex
CREATE INDEX "Charge_createdByPersonId_idx" ON "Charge"("createdByPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_clientEventId_key" ON "Payment"("clientEventId");

-- CreateIndex
CREATE INDEX "Payment_chargeId_idx" ON "Payment"("chargeId");

-- CreateIndex
CREATE INDEX "Payment_recordedByPersonId_idx" ON "Payment"("recordedByPersonId");

-- CreateIndex
CREATE INDEX "Payment_receivedAt_idx" ON "Payment"("receivedAt");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_payerPersonId_fkey" FOREIGN KEY ("payerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_feeTypeId_fkey" FOREIGN KEY ("feeTypeId") REFERENCES "FeeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_waivedByPersonId_fkey" FOREIGN KEY ("waivedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_cancelledByPersonId_fkey" FOREIGN KEY ("cancelledByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_createdByPersonId_fkey" FOREIGN KEY ("createdByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedByPersonId_fkey" FOREIGN KEY ("recordedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written constraints ────────────────────────────────────────────────

-- Money is never zero or negative, anywhere in this module.
ALTER TABLE "FeeType"
  ADD CONSTRAINT "FeeType_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "Charge"
  ADD CONSTRAINT "Charge_amount_positive_check"
  CHECK ("amount" > 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive_check"
  CHECK ("amount" > 0);

-- A stated period, when both ends are given, runs the right way round — the
-- `Enrolment_window_order_check`/`GroupMembership` interval precedent.
ALTER TABLE "Charge"
  ADD CONSTRAINT "Charge_period_order_check"
  CHECK ("periodStart" IS NULL OR "periodEnd" IS NULL OR "periodEnd" >= "periodStart");

-- `status = WAIVED` if and only if the waive pair is set — never separately.
-- `waivedByPersonId` is deliberately NOT part of this constraint: it is
-- SEVER_AND_RETAIN (`onDelete: SetNull`), and an erasure must be able to null
-- it without leaving a waived charge in violation of a CHECK — the exact
-- `ExamCandidate_confirmed_fields_check` reasoning (phase 2.4 report §1.1).
ALTER TABLE "Charge"
  ADD CONSTRAINT "Charge_waived_fields_check"
  CHECK (("status" = 'WAIVED') = ("waivedAt" IS NOT NULL AND "waivedReason" IS NOT NULL));

-- `status = CANCELLED` if and only if the cancel pair is set — the same shape,
-- `cancelledByPersonId` excluded for the same reason.
ALTER TABLE "Charge"
  ADD CONSTRAINT "Charge_cancelled_fields_check"
  CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancelledReason" IS NOT NULL));
