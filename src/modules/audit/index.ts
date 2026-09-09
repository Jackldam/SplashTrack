/**
 * Audit module public API (D-149). The tamper-evident, append-only audit trail.
 *
 * Other modules RECORD events through `recordAuditEvent` / `recordAuditEventSafe`
 * and never touch `prisma.auditEvent` themselves. The `AuditEvent` table is
 * owned here — no other module writes it (D-057, applied to this table).
 *
 * The audit VIEWER — the filtered, paginated read surface and the subject-scoped
 * export — is not part of the foundation: it is gated on an `audit.read`
 * permission, and the permission guard is phase 0.4 (D-147).
 */

export {
  pruneAuditTrail,
  recordAuditEvent,
  recordAuditEventSafe,
  verifyAuditChain,
  type AuditChainVerification,
} from "./application/audit-service";

export type { AuditEventInput, AuditOutcome } from "./domain/audit-event";
export type { AuditPruneOutcome } from "./infrastructure/audit-repository";
