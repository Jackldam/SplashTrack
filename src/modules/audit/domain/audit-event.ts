/**
 * Audit-trail domain (D-149). Pure types and the hash-chain primitives; no I/O.
 *
 * The audit trail is the tamper-EVIDENT, append-only record of sensitive
 * actions, DISTINCT from the operational logger (`@/lib/logging`) — different
 * required fields, different retention, different tamper-resistance.
 *
 * CONTENT RULE, enforced by TYPING here rather than by discipline: an event
 * carries actor and target IDENTIFIERS, an event type, an outcome, and the
 * NAMES of what changed — NEVER passwords, secrets, tokens, or raw
 * personal-data VALUES. In this product that rule has teeth: an audit trail
 * that recorded a child's name, a medical remark or an address alongside every
 * read would itself become the largest personal-data store in the system, and
 * an append-only one that cannot be corrected. `changedFields` is a small
 * structured record of machine tokens; do not put values in it.
 */

import { createHash } from "node:crypto";

/** Outcome of an audited action (mirrors the Prisma `AuditOutcome` enum). A
 * value withheld by a consent/authorization gate is still a SUCCESS with a
 * reason — DENIED is reserved for an authorization refusal. */
export type AuditOutcome = "SUCCESS" | "DENIED" | "FAILURE";

/**
 * What a caller supplies to record ONE audit event. Deliberately minimal and
 * id-only: there is no field through which a personal-data value could be
 * passed. `changedFields` values must be machine tokens / field NAMES, never
 * the underlying data.
 */
export interface AuditEventInput {
  /** Dotted event type, e.g. `profile_fields.member_value_revealed`. */
  eventType: string;
  outcome: AuditOutcome;
  /** Acting person's id; null/omitted for a system/scheduled action. */
  actorPersonId?: string | null;
  /** Acting API credential's id; null/omitted unless the action was
   * authenticated by an API credential. Mutually exclusive with `actorPersonId`:
   * a credential-authenticated event sets this + `actorAuthMethod = "api_key"`
   * and leaves `actorPersonId` null. */
  actorCredentialId?: string | null;
  /** Authentication method where known (`session` / `api_key`). */
  actorAuthMethod?: string | null;
  /** Resource kind acted on, e.g. `person` / `profile_field_value`. */
  targetType?: string | null;
  targetId?: string | null;
  /** Request correlation id (`@/lib/api/request-id`), when in a request. */
  requestId?: string | null;
  /** Small structured context — field NAMES / non-sensitive tokens only. */
  changedFields?: Record<string, string | number | boolean | null> | null;
  /** Minimal free-text reason where required — never personal content. */
  reason?: string | null;
}

/**
 * The row content the hash commits to. Deliberately EXCLUDES the DB-assigned
 * `sequence`, `id`, and `hash` itself (assigned at/after insert) — the chain's
 * integrity comes from `previousHash` linkage, and the walk order comes from
 * `sequence`. Included fields are normalized to stable strings so the digest is
 * reproducible across a read-back (see `verifyAuditChain`).
 *
 * `contentVersion` selects WHICH fixed field array {@link canonicalizeAuditContent}
 * digests, so the hashed shape can grow without invalidating history.
 */
export interface AuditHashContent {
  /** Canonicalization version of this content (see `canonicalizeAuditContent`):
   * 1 = the original field array; 2 = that array with `actorCredentialId`. */
  contentVersion: number;
  eventType: string;
  occurredAt: Date;
  outcome: AuditOutcome;
  actorPersonId: string | null;
  /** The acting API credential's id — only committed to the hash at
   * `contentVersion` ≥ 2; ignored by the v1 canonicalization. */
  actorCredentialId: string | null;
  actorAuthMethod: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  changedFields: unknown;
  reason: string | null;
}

/**
 * The canonicalization version every NEW row is written at. Bump this (and add a
 * new branch in {@link canonicalizeAuditContent}) whenever a field is added to
 * the hashed content; existing rows keep their own stored `contentVersion` and
 * verify against the branch they were written with.
 */
export const CURRENT_AUDIT_CONTENT_VERSION = 2;

/**
 * The chain's starting link — a fixed, well-known constant for the first row.
 *
 * PHASE 0.4 (D-168): the genesis constant, `AuditCheckpoint` and the
 * checkpointing retention path are specified together, because the first
 * legitimate retention run breaks the chain permanently without them. This
 * value is SplashTrack's own rather than the template's, so no verification
 * ever accidentally succeeds against a foreign chain — but the checkpointing
 * work may still revise it, and it must be settled before rows accumulate.
 */
export const AUDIT_GENESIS_HASH = "genesis:splashtrack:audit:v1";

/**
 * Canonical, stable serialization of one event's audited content, VERSIONED by
 * `content.contentVersion` (inherited: the versioned canonicalization). Fields are emitted
 * as a FIXED-ORDER array (not object-insertion order) and `changedFields` is
 * canonicalized with sorted keys, so the same logical event always digests
 * identically — a read-back from the DB reproduces the byte-for-byte input.
 *
 * Versioning is what lets the hashed shape grow without rewriting history:
 *   - **v1** — the ORIGINAL field array. This ordering and membership are
 *     FROZEN: every historical row's stored hash committed to exactly it, so it
 *     must never change. A row with `contentVersion` ≤ 1 digests to this.
 *   - **v2** — v1 with `actorCredentialId` APPENDED (never inserted), so the v1
 *     prefix is byte-for-byte identical and only new rows (which carry the
 *     credential actor) opt into the longer array.
 *
 * `verifyAuditChain` passes each row's OWN `contentVersion`, so v1 and v2 rows
 * coexist in one chain and every row verifies against the shape it was written
 * with.
 *
 * THE V1 ARRAY WAS REDEFINED ONCE, IN PHASE 0.3, AND THAT IS THE ONLY TIME IT
 * MAY EVER HAPPEN. It carried `organizationId` in position 6 — the tenant scope
 * D-056 removes. A column that no longer exists cannot be re-read to verify an
 * old row, so "keep v1 frozen and add a v3" was not available: the choice was
 * redefine v1 or keep a hardcoded `null` fossil in the canonical array forever,
 * which is exactly the false signal D-056 exists to delete. Permissible ONLY
 * because there is no history to protect — zero releases, zero tags, no
 * deployed instance (OD-1, closed 2026-09-02), the same ground on which phase
 * 0.2 regenerated the initial migration. Consequence, stated rather than
 * discovered: any audit row written before this commit no longer verifies, so a
 * local development database must be recreated. The test database is truncated
 * by `scripts/setup-test-db.ts` on every run and is unaffected. Once the first
 * release exists, D-048 applies and this array is frozen for good.
 */
export function canonicalizeAuditContent(content: AuditHashContent): string {
  // FROZEN v1 field array — do not reorder or remove entries (see above).
  const v1Fields = [
    content.eventType,
    content.occurredAt.toISOString(),
    content.outcome,
    content.actorPersonId,
    content.actorAuthMethod,
    content.targetType,
    content.targetId,
    content.requestId,
    canonicalizeJson(content.changedFields),
    content.reason,
  ];

  // v1 (and any legacy row defaulting to version 1): the original array exactly.
  if (content.contentVersion <= 1) {
    return JSON.stringify(v1Fields);
  }

  // v2: the v1 array with the credential actor appended at the END.
  return JSON.stringify([...v1Fields, content.actorCredentialId]);
}

/**
 * Event types that represent a person's own interactive SIGN-IN attempt — the
 * allowlist behind a self-service "recent sign-ins" view. Each entry is written
 * by an audit hook in `@/lib/auth/auth.ts` with a `changedFields.method` token
 * identifying which credential was used.
 *
 * Deliberately EXCLUDES `security.reauthentication`. That event type was split
 * out of the ordinary sign-in types PRECISELY so a step-up re-authentication —
 * before a data export or an erasure — never poses as a sign-in in this view.
 * This allowlist IS that view; honouring the split is not optional.
 *
 * The template additionally listed `identity.microsoft_login`. There is no
 * external identity provider in v1, and no hook writes that type.
 */
export const SIGN_IN_EVENT_TYPES = [
  "security.password_login",
  "security.two_factor_login",
  "security.passkey_login",
] as const;

/** Recursively key-sorted JSON so object key order never changes the digest. */
function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = canonicalizeJson(record[key]);
  }
  return out;
}

/**
 * The chain hash for one row: SHA-256 of `previousHash` + the canonical
 * content. A hex digest. Deterministic and dependency-free.
 */
export function computeAuditHash(
  previousHash: string,
  content: AuditHashContent,
): string {
  return createHash("sha256")
    .update(previousHash)
    .update("\n")
    .update(canonicalizeAuditContent(content))
    .digest("hex");
}
