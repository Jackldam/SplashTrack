-- The first-run record the boot state machine reads on every start (D-100,
-- D-098 predicate 4).
--
-- HAND-EDITED for the singleton CHECK: the Prisma DSL cannot express a CHECK
-- constraint, so pinning the id to the constant `installation` has to be
-- written here or it does not exist at all — the same reason the
-- `Organization` singleton's CHECK is hand-written one migration earlier.
--
-- Safe on a populated database: a new table, nothing altered, nothing dropped
-- (tests/unit/migration-safety.test.ts).

CREATE TABLE "InstallationBootstrap" (
    "id" TEXT NOT NULL DEFAULT 'installation',
    "completedAt" TIMESTAMP(3),
    "completedVia" TEXT,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationBootstrap_pkey" PRIMARY KEY ("id")
);

-- The singleton, enforced by the DATABASE and not by a constant in the code.
-- Two bootstrap records would make "has setup completed" a question with two
-- answers, and it is the question that gates the only unauthenticated
-- administrative surface in the product (D-099).
ALTER TABLE "InstallationBootstrap"
  ADD CONSTRAINT "InstallationBootstrap_singleton"
  CHECK ("id" = 'installation');

-- The break-glass notification (`13-configuration-and-setup.md` §7): every CLI
-- invocation warns all administrators, and the warning has to carry a dismissal
-- state that `AuditEvent` cannot hold — it is append-only with no update path
-- (D-149, D-168). No foreign key to `AuditEvent`: rows leave it legitimately
-- through `pruneAuditEventPrefix`, and a Restrict FK here would make a
-- retention run fail on an old alert.

CREATE TABLE "BreakGlassAlert" (
    "id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "context" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "BreakGlassAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BreakGlassAlert_dismissedAt_idx" ON "BreakGlassAlert"("dismissedAt");
