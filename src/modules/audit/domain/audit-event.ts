/**
 * Audit-trail domain (Audit module — Architecture.md Section 16). Pure types +
 * the hash-chain primitives; no I/O. The audit trail is the tamper-EVIDENT,
 * append-only record of sensitive actions, DISTINCT from the operational logger
 * (Section 17) — different required fields, retention, and tamper-resistance.
 *
 * Section 16 content rule (enforced by TYPING here, not just discipline): an
 * event carries actor/target/org IDENTIFIERS, an event type, an outcome, and
 * the NAMES of what changed — NEVER passwords, secrets, tokens, or raw
 * personal-data VALUES. `changedFields` is a small structured record of
 * machine tokens; do not put values in it.
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
  /** Acting API credential's id (ADR-020); null/omitted unless the action was
   * authenticated by an API credential. Mutually exclusive with `actorPersonId`:
   * a credential-authenticated event sets this + `actorAuthMethod = "api_key"`
   * and leaves `actorPersonId` null. */
  actorCredentialId?: string | null;
  /** Authentication method where known (`session` / `api_key`). */
  actorAuthMethod?: string | null;
  /** Org scope for an org-scoped action; omit for platform/system actions. */
  organizationId?: string | null;
  /** Resource kind acted on, e.g. `person` / `profile_field_value`. */
  targetType?: string | null;
  targetId?: string | null;
  /** Section 14.7 request correlation id, when in a request. */
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
 * digests, so the hashed shape can grow without invalidating history (ADR-018
 * Correction C / ADR-020).
 */
export interface AuditHashContent {
  /** Canonicalization version of this content (see `canonicalizeAuditContent`):
   * 1 = the original field array; 2 = that array with `actorCredentialId`. */
  contentVersion: number;
  eventType: string;
  occurredAt: Date;
  outcome: AuditOutcome;
  actorPersonId: string | null;
  /** The acting API credential's id (ADR-020) — only committed to the hash at
   * `contentVersion` ≥ 2; ignored by the v1 canonicalization. */
  actorCredentialId: string | null;
  actorAuthMethod: string | null;
  organizationId: string | null;
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

/** The chain's starting link — a fixed, well-known constant for the first row. */
export const AUDIT_GENESIS_HASH = "genesis:webapp-template:audit:v1";

/**
 * Canonical, stable serialization of one event's audited content, VERSIONED by
 * `content.contentVersion` (ADR-018 Correction C / ADR-020). Fields are emitted
 * as a FIXED-ORDER array (not object-insertion order) and `changedFields` is
 * canonicalized with sorted keys, so the same logical event always digests
 * identically — a read-back from the DB reproduces the byte-for-byte input.
 *
 * Versioning is what lets the hashed shape grow without rewriting history:
 *   - **v1** — the ORIGINAL 11-field array. This ordering and membership are
 *     FROZEN: every historical row's stored hash committed to exactly it, so it
 *     must never change. A row with `contentVersion` ≤ 1 digests to this.
 *   - **v2** — v1 with `actorCredentialId` APPENDED (never inserted), so the v1
 *     prefix is byte-for-byte identical and only new rows (which carry the
 *     credential actor) opt into the longer array.
 *
 * `verifyAuditChain` passes each row's OWN `contentVersion`, so v1 and v2 rows
 * coexist in one chain and every row verifies against the shape it was written
 * with.
 */
export function canonicalizeAuditContent(content: AuditHashContent): string {
  // FROZEN v1 field array — do not reorder or remove entries (see above).
  const v1Fields = [
    content.eventType,
    content.occurredAt.toISOString(),
    content.outcome,
    content.actorPersonId,
    content.actorAuthMethod,
    content.organizationId,
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

  // v2 (ADR-020): the v1 array with the credential actor appended at the END.
  return JSON.stringify([...v1Fields, content.actorCredentialId]);
}

/**
 * Event types that represent a person's own interactive SIGN-IN attempt — the
 * allowlist behind the `/profile` "sign-in history" panel (FD-USER-04). Each
 * entry is written by an audit hook in `src/lib/auth/auth.ts` (PR #165) with a
 * `changedFields.method` token identifying which credential was used.
 *
 * Deliberately EXCLUDES `security.reauthentication` — PR #165 split that event
 * type out of the ordinary login types PRECISELY so a step-up re-auth (e.g.
 * before a data export or erasure) never poses as a login in a future
 * recent-logins view. This allowlist IS that view; honouring the split is not
 * optional. Also excludes `security.section_access_denied` — an authorization
 * refusal on an already-authenticated session, not sign-in activity.
 */
export const SIGN_IN_EVENT_TYPES = [
  "security.password_login",
  "security.two_factor_login",
  "security.passkey_login",
  "identity.microsoft_login",
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
