/**
 * Rate limiting and lockout for setup-token submission (D-101).
 *
 * *"Token submission is **rate-limited with lockout**, and failed attempts are
 * audited — the existing rate-limiting specification covers login, password
 * reset, export and public forms, and did not cover this."*
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `@/lib/rate-limit`, AND WHY THAT IS NOT A SHORTCUT
 *
 * The existing limiter is DATABASE-BACKED — `consumeRateLimit` writes a
 * `RateLimitCounter` row. The surface being protected here opens in boot state
 * `EMPTY`, which D-098 predicate 1 defines as *no tables at all*. There is no
 * row to write and no table to write it to; the migrations have deliberately
 * not been run, because D-055 forbids migrating a database whose purpose is not
 * yet known and the wizard is what asks. A limiter that needs the schema cannot
 * protect the surface that exists to create the schema.
 *
 * So this one is IN-MEMORY, and the honest consequences are stated rather than
 * glossed:
 *
 *   • It is per-PROCESS. `next start` runs one Node process, so today that is
 *     the whole instance; an operator who puts two app containers behind a load
 *     balancer during first-run setup would get one bucket each.
 *   • It does not survive a restart. Someone with `docker compose restart` can
 *     clear a lockout — and someone with `docker compose restart` already holds
 *     host access, which is total authority over this installation anyway. The
 *     lockout is not a control against the host; it is a control against the
 *     network.
 *
 * NEITHER WEAKENS THE ACTUAL GATE. The token is 160 bits of entropy with a
 * sixty-minute life (`./token.ts`); guessing it is not a threat this lockout is
 * load-bearing against. What the lockout buys is that a stranger probing
 * `/setup` on a public origin stops getting answers quickly, and that the
 * attempts are recorded. Both are worth having and neither is the reason the
 * surface is safe.
 *
 * SERVER-ONLY.
 */

import { logger } from "@/lib/logging";
import { hashRateLimitId } from "@/lib/rate-limit";
import { recordAuditEventSafe } from "@/modules/audit";

const setupLogger = logger.child({ component: "setup.token" });

/** Failures allowed inside {@link WINDOW_MS} before the lockout applies. */
export const MAX_ATTEMPTS = 5;

/** The window failures are counted over. */
export const WINDOW_MS = 15 * 60 * 1000;

/** How long a locked-out bucket stays locked. */
export const LOCKOUT_MS = 15 * 60 * 1000;

interface Bucket {
  failures: number;
  /** When the current counting window started. */
  windowStartedAt: number;
  /** When the lockout ends, or 0 when not locked out. */
  lockedUntil: number;
}

const buckets = new Map<string, Bucket>();

export interface AttemptDecision {
  allowed: boolean;
  /** Seconds until the caller may try again. Only when `allowed` is false. */
  retryAfterSeconds?: number;
}

/**
 * May this caller submit a token right now?
 *
 * Called BEFORE the token is compared, so a locked-out caller never reaches the
 * constant-time compare at all — the lockout must not itself be a timing
 * oracle for whether a token exists.
 */
export function checkSetupAttempt(
  clientIp: string,
  now: number = Date.now(),
): AttemptDecision {
  const bucket = buckets.get(key(clientIp));
  if (!bucket) return { allowed: true };

  if (bucket.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000),
    };
  }
  return { allowed: true };
}

/**
 * Records one failed submission, applies the lockout when the count is reached,
 * and audits it.
 *
 * THE AUDIT IS BEST-EFFORT ON PURPOSE. `recordAuditEventSafe` never throws, and
 * on an `EMPTY` database the append fails because `AuditEvent` does not exist —
 * which is exactly the state this surface serves in. Failing the request
 * because the trail cannot be written would mean the wizard refuses every
 * submission on a fresh install, including the correct one. The structured log
 * line below is therefore the record that always exists, and the audit event is
 * the record that exists from the moment the schema does.
 */
export async function recordSetupAttemptFailure(
  clientIp: string,
  refusal: string,
  now: number = Date.now(),
): Promise<AttemptDecision> {
  const id = key(clientIp);
  const bucket = buckets.get(id);

  const fresh: Bucket =
    !bucket || now - bucket.windowStartedAt > WINDOW_MS
      ? { failures: 0, windowStartedAt: now, lockedUntil: 0 }
      : bucket;

  fresh.failures += 1;
  if (fresh.failures >= MAX_ATTEMPTS) {
    fresh.lockedUntil = now + LOCKOUT_MS;
    fresh.failures = 0;
    fresh.windowStartedAt = now;
  }
  buckets.set(id, fresh);

  const lockedOut = fresh.lockedUntil > now;
  // The IP is HASHED here for the same reason `@/lib/rate-limit` hashes its
  // bucket ids: a security log must not become a plaintext record of who tried
  // what from where.
  setupLogger.warn(
    { event: "setup.token.rejected", refusal, clientIpHash: id, lockedOut },
    "a setup-token submission was refused",
  );

  await recordAuditEventSafe({
    eventType: "security.setup_token.rejected",
    outcome: "FAILURE",
    actorPersonId: null,
    actorAuthMethod: "anonymous",
    targetType: null,
    targetId: null,
    changedFields: { refusal, clientIpHash: id, lockedOut },
    reason: "setup_token_submission",
  });

  return lockedOut
    ? {
        allowed: false,
        retryAfterSeconds: Math.ceil((fresh.lockedUntil - now) / 1000),
      }
    : { allowed: true };
}

/**
 * Clears a caller's failures after a SUCCESSFUL submission. The token is
 * single-use, so this matters only for the operator who mistyped it twice
 * before getting it right and should not carry those failures into a lockout on
 * their next install.
 */
export function clearSetupAttempts(clientIp: string): void {
  buckets.delete(key(clientIp));
}

/** TEST SEAM ONLY — drops every bucket. */
export function resetSetupAttempts(): void {
  buckets.clear();
}

function key(clientIp: string): string {
  return hashRateLimitId(clientIp);
}
