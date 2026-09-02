/**
 * Audit-trail application service (Audit module — Section 16). The public entry
 * point for RECORDING sensitive actions and for VERIFYING the trail's integrity.
 *
 * Recording is a deliberate side effect of an already-authorized action (like
 * the operational logger) — `recordAuditEvent` makes no authorization decision
 * of its own; the calling service owns that. It THROWS on failure so a caller
 * can choose its own posture: for a "no access without a record" action (e.g. a
 * sensitive-value reveal) await it BEFORE returning; for an already-committed,
 * separately-logged action (e.g. a completed deletion sweep) a caller may treat
 * a failure as best-effort. Never pass personal-data VALUES — only identifiers
 * and field NAMES (Section 16).
 *
 * SERVER-ONLY.
 */

import { logger } from "@/lib/logging";

import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  type AuditEventInput,
} from "../domain/audit-event";
import {
  appendAuditEvent,
  readAuditChain,
} from "../infrastructure/audit-repository";

const auditLogger = logger.child({ component: "audit" });

/** Bounds so one event can never bloat the trail (defense in depth; the typed
 * input already prevents value-carrying fields). */
const REASON_MAX = 500;
const CHANGED_FIELDS_MAX = 32;

/**
 * Records ONE audit event (append-only, hash-chained). Returns the new row's
 * id/sequence/hash. Throws if the append fails — the caller decides whether that
 * should fail the surrounding action. Lightly bounds `reason`/`changedFields`
 * size; it does NOT and cannot detect personal-data values placed there by a
 * mis-using caller — that is a Section 16 discipline the typed input encourages.
 */
export async function recordAuditEvent(
  input: AuditEventInput,
): Promise<{ id: string; sequence: number; hash: string }> {
  const reason =
    input.reason != null ? input.reason.slice(0, REASON_MAX) : input.reason;
  const changedFields =
    input.changedFields != null
      ? Object.fromEntries(
          Object.entries(input.changedFields).slice(0, CHANGED_FIELDS_MAX),
        )
      : input.changedFields;

  const result = await appendAuditEvent({ ...input, reason, changedFields });
  // A low-volume confirmation on the operational logger (ids only) so an audit
  // append is itself observable in ops tooling — never the changedFields/reason.
  auditLogger.debug(
    { event: "audit.recorded", eventType: input.eventType, auditId: result.id },
    "audit event recorded",
  );
  return result;
}

/**
 * Records an audit event BEST-EFFORT: like {@link recordAuditEvent} but never
 * throws — a failed append is logged to the operational logger instead. For
 * events audited AFTER their change has already committed (member created, role
 * updated, deletion swept), where failing the response would misrepresent an
 * applied change. For a "no access without a record" event (a sensitive-value
 * reveal), use the throwing `recordAuditEvent` and await it before disclosing.
 */
export async function recordAuditEventSafe(
  input: AuditEventInput,
): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch (error) {
    auditLogger.error(
      { event: "audit.record_failed", eventType: input.eventType, err: error },
      "failed to record audit event (the audited action had already been applied)",
    );
  }
}

/** The result of verifying the whole trail's hash chain. */
export interface AuditChainVerification {
  valid: boolean;
  count: number;
  /** The `sequence` of the FIRST row that fails verification, when invalid. */
  brokenAtSequence?: number;
}

/**
 * Recomputes the hash chain end to end and reports whether it is intact. A
 * mismatch means an INTERIOR row was edited, deleted, reordered, or inserted out
 * of band — Section 16 tamper-EVIDENCE. Walks in `sequence` order from the
 * genesis link, checking both `previousHash` linkage and each row's recomputed
 * `hash`. Read-only; safe to run on demand or on a schedule.
 *
 * Accepted limitations (see the module README): the chain is unkeyed, so this
 * detects tampering but does not PREVENT an attacker with DB write access from
 * recomputing it forward; and TAIL TRUNCATION (deleting the newest rows) leaves
 * a chain that still verifies. A keyed HMAC + an external anchor of
 * `(count, latest hash)` are the follow-on hardening.
 */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  const rows = await readAuditChain();
  let previousHash = AUDIT_GENESIS_HASH;
  for (const row of rows) {
    // Canonicalize each row by its OWN contentVersion (ADR-020): a v1 row digests
    // to the original field array and a v2 row to that array plus its credential
    // actor, so v1 and v2 rows verify side by side in one chain.
    const expected = computeAuditHash(previousHash, {
      contentVersion: row.contentVersion,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      outcome: row.outcome,
      actorPersonId: row.actorPersonId,
      actorCredentialId: row.actorCredentialId,
      actorAuthMethod: row.actorAuthMethod,
      organizationId: row.organizationId,
      targetType: row.targetType,
      targetId: row.targetId,
      requestId: row.requestId,
      changedFields: row.changedFields,
      reason: row.reason,
    });
    if (row.previousHash !== previousHash || row.hash !== expected) {
      return {
        valid: false,
        count: rows.length,
        brokenAtSequence: row.sequence,
      };
    }
    previousHash = row.hash;
  }
  return { valid: true, count: rows.length };
}
