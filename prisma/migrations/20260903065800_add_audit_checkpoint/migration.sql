-- CreateTable
CREATE TABLE "AuditCheckpoint" (
    "id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "chainHash" TEXT NOT NULL,
    "prunedFromSequence" INTEGER NOT NULL,
    "prunedToSequence" INTEGER NOT NULL,
    "prunedCount" INTEGER NOT NULL,
    "prunedFrom" TIMESTAMP(3) NOT NULL,
    "prunedTo" TIMESTAMP(3) NOT NULL,
    "previousCheckpointHash" TEXT NOT NULL,
    "macVersion" INTEGER NOT NULL DEFAULT 1,
    "mac" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditCheckpoint_sequence_key" ON "AuditCheckpoint"("sequence");
