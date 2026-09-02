/**
 * Persistence for the audit trail (Audit module — Section 16). The ONLY writer
 * of `AuditEvent`, and it is APPEND-ONLY: it exposes `appendAuditEvent` and
 * read helpers, and deliberately NO update or delete. Appends are serialized by
 * a Postgres advisory lock so the tamper-evidence hash chain never forks.
 *
 * SERVER-ONLY.
 */

import { Prisma, prisma } from "@/lib/database";

import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  CURRENT_AUDIT_CONTENT_VERSION,
  SIGN_IN_EVENT_TYPES,
  type AuditEventInput,
  type AuditHashContent,
  type AuditOutcome,
} from "../domain/audit-event";

/**
 * A fixed key for the transaction-scoped advisory lock that serializes appends.
 * Every append takes `pg_advisory_xact_lock(AUDIT_APPEND_LOCK_KEY)` first, so at
 * most one append computes-then-inserts at a time and the `previousHash` it
 * reads is always the true latest row — the chain cannot fork. The lock is
 * released automatically at transaction end. Audit writes are infrequent
 * (sensitive actions only), so global serialization is acceptable.
 *
 * QUALIFIED since FD-GEN-46/47 (auth-event auditing): failed sign-in attempts
 * and denied admin/org section visits are now on the trail too, and unlike
 * most audited actions their VOLUME is attacker-influenced, not just
 * operator-influenced. The bound differs by PATH, and is weaker than a
 * previous version of this comment claimed (corrected 2026-08-02 security
 * review — see below):
 *   - `/sign-in/email` FAILURE is bounded ONLY when reached through the
 *     `/login` Server Action's own throttle (`LOGIN_IP_RULE`/`LOGIN_EMAIL_RULE`
 *     in `src/lib/auth/actions.ts` — 30/15min per IP, 10/15min per email).
 *     That throttle lives in APPLICATION code, not in Better Auth or in
 *     middleware — a caller that hits `/api/auth/sign-in/email` directly
 *     (`src/app/api/auth/[...all]/route.ts` mounts Better Auth's full endpoint
 *     surface with no throttle in front of it) bypasses it entirely. Better
 *     Auth ships its OWN rate-limit middleware, but it defaults to disabled
 *     outside `NODE_ENV=production` (verified against
 *     node_modules/better-auth/dist/context/create-context.mjs —
 *     `enabled: options.rateLimit?.enabled ?? isProduction`) and this app's
 *     `betterAuth({...})` config (`src/lib/auth/auth.ts`) does not set
 *     `rateLimit` to turn it on either way — so a direct-endpoint attacker can
 *     generate unthrottled `security.password_login` FAILURE writes today.
 *     KNOWN, ACCEPTED LIMITATION, not a regression this slice introduces:
 *     hardening it means moving a throttle in FRONT of the Better Auth route
 *     itself (e.g. in `middleware.ts`, keyed the same way), tracked as
 *     follow-on work, not fixed here.
 *   - `/two-factor/verify-totp`, `/two-factor/verify-otp` and
 *     `/two-factor/verify-backup-code` FAILURE writes stay bounded regardless
 *     of entry point: the two-factor plugin's own account lockout
 *     (`assertTwoFactorNotLocked`/`recordTwoFactorFailure`) runs INSIDE the
 *     endpoint handler itself, so it applies identically whether the caller
 *     goes through the app's UI or hits the endpoint directly.
 *   - `/passkey/verify-authentication` FAILURE has no in-endpoint lockout to
 *     inherit (there is no account to lock — the ceremony can fail before any
 *     user is resolved), so it is dedup/rate-limited directly in the audit
 *     hook itself, per hashed source IP (`PASSKEY_FAILURE_IP_RULE` in
 *     `src/lib/auth/auth.ts`), reusing this same `consumeRateLimit` primitive.
 *   - Section-denial writes are deduped to at most one per (actor, area,
 *     segment) per 15-minute window (see
 *     `src/app/(portal)/section-access-denied-audit.ts`) — actor-scoped, so
 *     unaffected by the above.
 * The residual case this does NOT cover — a low-and-slow DISTRIBUTED attack
 * spreading guesses across many IPs/emails, each individually under its own
 * throttle — is an accepted limitation of a single-database advisory lock,
 * not a regression this slice introduces; a queue/batched-append design is
 * the follow-on hardening if write throughput ever becomes the bottleneck.
 */
const AUDIT_APPEND_LOCK_KEY = 748_921_163;

/** One row projected for chain verification / read-back. */
export interface StoredAuditEvent extends AuditHashContent {
  id: string;
  sequence: number;
  previousHash: string;
  hash: string;
}

/**
 * Appends one event to the trail and returns its id/sequence/hash. Runs inside
 * a transaction that first serializes on the advisory lock, then links the new
 * row to the current tail via `previousHash` and stores its computed `hash`.
 */
export async function appendAuditEvent(
  input: AuditEventInput,
): Promise<{ id: string; sequence: number; hash: string }> {
  const occurredAt = new Date();
  const content: AuditHashContent = {
    // New rows are written at the current canonicalization version (ADR-020); the
    // column is stored so verification later re-canonicalizes each row by its own.
    contentVersion: CURRENT_AUDIT_CONTENT_VERSION,
    eventType: input.eventType,
    occurredAt,
    outcome: input.outcome,
    actorPersonId: input.actorPersonId ?? null,
    actorCredentialId: input.actorCredentialId ?? null,
    actorAuthMethod: input.actorAuthMethod ?? null,
    organizationId: input.organizationId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    requestId: input.requestId ?? null,
    changedFields: input.changedFields ?? null,
    reason: input.reason ?? null,
  };

  return prisma.$transaction(async (tx) => {
    // Serialize appends so the chain never forks (see the lock-key comment).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_APPEND_LOCK_KEY})`;

    const tail = await tx.auditEvent.findFirst({
      orderBy: { sequence: "desc" },
      select: { hash: true },
    });
    const previousHash = tail?.hash ?? AUDIT_GENESIS_HASH;
    const hash = computeAuditHash(previousHash, content);

    const row = await tx.auditEvent.create({
      data: {
        contentVersion: content.contentVersion,
        eventType: content.eventType,
        occurredAt,
        outcome: content.outcome as AuditOutcome,
        actorPersonId: content.actorPersonId,
        actorCredentialId: content.actorCredentialId,
        actorAuthMethod: content.actorAuthMethod,
        organizationId: content.organizationId,
        targetType: content.targetType,
        targetId: content.targetId,
        requestId: content.requestId,
        changedFields:
          input.changedFields == null
            ? Prisma.JsonNull
            : (input.changedFields as Prisma.InputJsonValue),
        reason: content.reason,
        previousHash,
        hash,
      },
      select: { id: true, sequence: true, hash: true },
    });
    return row;
  });
}

/** One subject-scoped audit row for the export — display fields only; the
 * hash-chain columns and internal ids are NOT selected from the DB. */
export interface SubjectAuditRow {
  eventType: string;
  occurredAt: Date;
  outcome: AuditOutcome;
  actorPersonId: string | null;
  organizationId: string | null;
  targetType: string | null;
  targetId: string | null;
  changedFields: unknown;
  reason: string | null;
}

/**
 * Audit events where `personId` is the SUBJECT — the actor, the target of a
 * `person`-type event, OR (when `accountId` is given) the target of a
 * `user_account`-type event about their own account (e.g. account activation,
 * which has no actor). Newest first, capped at `limit`. For the person's own
 * GDPR data export (Art. 15). The `select` OMITS the hash-chain columns and
 * internal ids at the DB layer (defense in depth: the export exclusion does not
 * rely on a downstream mapping step). Authorization is the caller's responsibility.
 */
export async function listAuditEventsForSubject(
  personId: string,
  limit: number,
  accountId?: string | null,
): Promise<SubjectAuditRow[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { actorPersonId: personId },
        { targetType: "person", targetId: personId },
        ...(accountId
          ? [{ targetType: "user_account", targetId: accountId }]
          : []),
      ],
    },
    orderBy: { sequence: "desc" },
    take: limit,
    select: {
      eventType: true,
      occurredAt: true,
      outcome: true,
      actorPersonId: true,
      organizationId: true,
      targetType: true,
      targetId: true,
      changedFields: true,
      reason: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    outcome: row.outcome as AuditOutcome,
    changedFields: row.changedFields ?? null,
  }));
}

/** One sign-in-classified row for the `/profile` self-service history panel
 * (FD-USER-04) — display fields only. Deliberately narrower than
 * {@link SubjectAuditRow}: no actor/target/organization ids, `requestId` or
 * `reason` — the panel shows only when/method/outcome (see the PR body for
 * why each omitted field is omitted). */
export interface SignInHistoryRow {
  eventType: string;
  occurredAt: Date;
  outcome: AuditOutcome;
  changedFields: unknown;
}

/**
 * The subject's own sign-in-classified events (FD-USER-04): {@link
 * SIGN_IN_EVENT_TYPES} only, where `personId` is the ACTOR or `accountId` is
 * the TARGET of a `user_account`-type event. The target-OR is what surfaces a
 * FAILED attempt against the person's own account — those rows carry
 * `actorPersonId: null` (nothing was authenticated) but DO carry
 * `targetId: accountId`. Newest first, capped at `limit`. A NEW, dedicated
 * function rather than a param on {@link listAuditEventsForSubject} — that
 * one backs the GDPR Art. 15 export and must keep returning EVERY row about
 * the person; a drifting optional default there would be a real bug, not a
 * convenience. Authorization is the caller's responsibility.
 */
export async function listSignInHistoryForSubject(
  personId: string,
  accountId: string,
  limit: number,
): Promise<SignInHistoryRow[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      eventType: { in: [...SIGN_IN_EVENT_TYPES] },
      OR: [
        { actorPersonId: personId },
        { targetType: "user_account", targetId: accountId },
      ],
    },
    orderBy: { sequence: "desc" },
    take: limit,
    select: {
      eventType: true,
      occurredAt: true,
      outcome: true,
      changedFields: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    outcome: row.outcome as AuditOutcome,
    changedFields: row.changedFields ?? null,
  }));
}

/** AND-combined filters for the paginated/filtered query surface (Section 16 —
 * NO free-text search over `reason` or `changedFields`). */
export interface AuditEventFilter {
  eventType?: string;
  outcome?: AuditOutcome;
  actorPersonId?: string;
  targetType?: string;
  targetId?: string;
  occurredFrom?: Date;
  occurredTo?: Date;
}

/** Builds the Prisma `where` clause for {@link AuditEventFilter}, optionally
 * scoped to one organization. `organizationId` undefined = platform-wide (every
 * row, including org-less ones); a string = scoped to EXACTLY that org — a
 * direct-column equality filter, the same tenant-boundary convention every
 * org-scoped read in this codebase uses (Section 13 / Critical Rule 4; never
 * the platform-scoped `organizationId = null` rows). */
function buildAuditWhere(
  filter: AuditEventFilter,
  organizationId?: string,
): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = {};
  if (organizationId !== undefined) {
    where.organizationId = organizationId;
  }
  if (filter.eventType !== undefined) {
    where.eventType = filter.eventType;
  }
  if (filter.outcome !== undefined) {
    where.outcome = filter.outcome;
  }
  if (filter.actorPersonId !== undefined) {
    where.actorPersonId = filter.actorPersonId;
  }
  if (filter.targetType !== undefined) {
    where.targetType = filter.targetType;
  }
  if (filter.targetId !== undefined) {
    where.targetId = filter.targetId;
  }
  if (filter.occurredFrom !== undefined || filter.occurredTo !== undefined) {
    where.occurredAt = {
      ...(filter.occurredFrom !== undefined
        ? { gte: filter.occurredFrom }
        : {}),
      ...(filter.occurredTo !== undefined ? { lte: filter.occurredTo } : {}),
    };
  }
  return where;
}

/** A requested page window + sort direction for {@link listAuditEventsPage}. */
export interface AuditEventPage {
  take: number;
  skip: number;
  sortDirection?: "asc" | "desc";
}

/**
 * Filtered + paginated read of the audit trail, for the query/viewer surface
 * (FD-GEN-42/43). `organizationId` undefined reads platform-wide (every row,
 * including org-less ones); a string scopes to EXACTLY that org — the same
 * tenant-boundary convention every org-scoped read in this codebase uses.
 * Filters are AND-combined; ordered by `sequence` (default descending — newest
 * first). Authorization is the caller's responsibility (the read service).
 */
export async function listAuditEventsPage(
  filter: AuditEventFilter,
  page: AuditEventPage,
  organizationId?: string,
): Promise<StoredAuditEvent[]> {
  const rows = await prisma.auditEvent.findMany({
    where: buildAuditWhere(filter, organizationId),
    orderBy: { sequence: page.sortDirection ?? "desc" },
    take: page.take,
    skip: page.skip,
    select: {
      id: true,
      sequence: true,
      contentVersion: true,
      eventType: true,
      occurredAt: true,
      outcome: true,
      actorPersonId: true,
      actorCredentialId: true,
      actorAuthMethod: true,
      organizationId: true,
      targetType: true,
      targetId: true,
      requestId: true,
      changedFields: true,
      reason: true,
      previousHash: true,
      hash: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    outcome: row.outcome as AuditOutcome,
    changedFields: row.changedFields ?? null,
  }));
}

/** Total events matching {@link AuditEventFilter}, optionally scoped to one
 * organization — the FULL filtered count, independent of the page window (for
 * the query surface's "showing N of M"). */
export async function countAuditEventsFiltered(
  filter: AuditEventFilter,
  organizationId?: string,
): Promise<number> {
  return prisma.auditEvent.count({
    where: buildAuditWhere(filter, organizationId),
  });
}

/**
 * Reads every event in chain order (by `sequence`) with the fields needed to
 * recompute the hash chain. Used by `verifyAuditChain`; also the basis for the
 * future `audit.read`-gated viewer. Ordered ascending so the walk starts at the
 * genesis link.
 */
export async function readAuditChain(): Promise<StoredAuditEvent[]> {
  const rows = await prisma.auditEvent.findMany({
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      contentVersion: true,
      eventType: true,
      occurredAt: true,
      outcome: true,
      actorPersonId: true,
      actorCredentialId: true,
      actorAuthMethod: true,
      organizationId: true,
      targetType: true,
      targetId: true,
      requestId: true,
      changedFields: true,
      reason: true,
      previousHash: true,
      hash: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    outcome: row.outcome as AuditOutcome,
    changedFields: row.changedFields ?? null,
  }));
}
