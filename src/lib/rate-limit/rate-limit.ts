/**
 * A small database-backed FIXED-WINDOW rate limiter for abuse-prone,
 * unauthenticated actions (public-registration.md, Phase 7b — the first
 * consumer; also fills the previously-flagged gap of no throttling on the
 * direct `auth.api.*` Server Actions).
 *
 * Design notes:
 * - **No raw personal data is stored.** Callers compose a bucket `key` from a
 *   HASHED identifier (`hashRateLimitId`), e.g. `register:ip:<sha256>` — a
 *   rate-limit row must never become a plaintext log of who acted from where.
 * - **Fixed window** (not a sliding window / token bucket): simple, one row per
 *   bucket, cheap. A burst right at a window boundary can briefly exceed the
 *   nominal rate; acceptable for abuse mitigation, not billing.
 * - **Single-database limiter.** Correct for one app instance and the shared-DB
 *   UAT baseline; a very-high-scale multi-app-server deployment may prefer a
 *   dedicated store (Redis). Documented, not silently assumed.
 * - Fail-OPEN is deliberate: if the counter store itself errors, the caller
 *   should still let the request through rather than hard-fail a whole feature
 *   on an infra hiccup (the caller decides — see `consumeRateLimit`).
 *
 * SERVER-ONLY.
 */

import { createHash } from "node:crypto";

import { prisma } from "@/lib/database";
import { logger } from "@/lib/logging";

const rateLimitLogger = logger.child({ component: "rate-limit" });

/** One rate-limit rule: at most `limit` actions per `windowMs` window. */
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

/**
 * Hashes a raw identifier (an IP address, an email) into an opaque, non-
 * reversible component for a bucket key. Lower-cased + trimmed first so
 * `Foo@x.com` and `foo@x.com ` share a bucket.
 */
export function hashRateLimitId(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Records one attempt against `key` and reports whether it is ALLOWED (still
 * within `rule`) or should be blocked.
 *
 * ATOMIC by construction: this is a SINGLE `INSERT ... ON CONFLICT ... WHERE
 * ... RETURNING` statement, not a read-then-write. Two truly concurrent
 * callers for the same key (the exact scenario every consumer here exists
 * for — a login-throttle brute-force script firing requests in parallel, a
 * `<Link>` prefetch racing the real navigation) are serialized by Postgres's
 * own row-level conflict handling: whichever transaction's INSERT/UPDATE
 * commits first "wins" the row, and the second necessarily observes the
 * first's effect rather than a stale pre-write read. `RETURNING` reports a
 * row only when THIS call's attempt was the one that changed the row (fresh
 * key, fresh window, or still under `limit`); no row back means blocked.
 *
 * (Earlier versions of this function did SELECT-then-INSERT/UPDATE inside a
 * `$transaction` at the default READ COMMITTED isolation level, which let two
 * concurrent callers both read "no row yet" and both get `allowed: true` —
 * confirmed to let a 3-per-window limit pass 10/10 concurrent callers. Do not
 * reintroduce a read-then-write here; see the caller list below for why it
 * matters beyond this dedup helper.)
 *
 * Still a FIXED window (not sliding): a burst that straddles the window
 * boundary can legitimately reset and allow again slightly early — accepted,
 * documented, and unrelated to the atomicity fixed above.
 *
 * Fails OPEN: any store error is logged and treated as allowed, so a transient
 * DB problem never takes the whole action offline.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<{ allowed: boolean }> {
  const now = Date.now();
  // Align the window so all callers in the same slice share one row/window.
  const windowStart = new Date(now - (now % rule.windowMs));

  try {
    // One atomic upsert:
    //  - no existing row            → plain INSERT proceeds, count = 1.
    //  - existing row, STALE window → ON CONFLICT WHERE matches (windowStart
    //    differs) → reset to count = 1, new windowStart.
    //  - existing row, SAME window,
    //    count < limit              → ON CONFLICT WHERE matches (count <
    //    limit) → count + 1.
    //  - existing row, SAME window,
    //    count >= limit             → ON CONFLICT WHERE is false for THIS
    //    row → no update, no RETURNING row → blocked.
    // The WHERE on the DO UPDATE is evaluated against the row Postgres already
    // holds a lock on for this key, so no other transaction can interleave a
    // read between "check" and "write" the way the old two-step version could.
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitCounter" AS rlc (key, "windowStart", count, "updatedAt")
      VALUES (${key}, ${windowStart}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        "windowStart" = ${windowStart},
        count = CASE
          WHEN rlc."windowStart" <> ${windowStart} THEN 1
          ELSE rlc.count + 1
        END,
        "updatedAt" = now()
      WHERE rlc."windowStart" <> ${windowStart} OR rlc.count < ${rule.limit}
      RETURNING count
    `;
    return { allowed: rows.length > 0 };
  } catch (error) {
    rateLimitLogger.error(
      { err: error },
      "rate-limit store error — failing open",
    );
    return { allowed: true };
  }
}

/**
 * Deletes rate-limit rows whose window ended before `olderThan`. Called
 * opportunistically / by a cleanup job so the table does not grow unbounded —
 * the counters are ephemeral by design.
 */
export async function sweepStaleRateLimitCounters(
  olderThan: Date,
): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { windowStart: { lt: olderThan } },
  });
  return count;
}
