import {
  requireEnrolledSession,
  type CurrentSession,
} from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";

/**
 * The two things every screen in this area does before it renders anything.
 * The same shape as `src/app/groups/access.tsx` and `src/app/people/access.tsx`,
 * and repeated per area for the same reason — the denial copy and the
 * permission it names belong beside the screens that raise them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DENIAL HERE IS THE ORDINARY CASE, NOT THE EXCEPTION
 *
 * `COURSE` is the narrowest-reaching scope in the model in one specific way: it
 * is the only one that covers a course at all. A Location Manager (`UNIT`), an
 * instructor (`GROUP`) and an aftest assessor (`SESSION`) are all refused this
 * area by design — §2.1 places a course ACROSS units, §6.1 forbids reaching
 * upward from a group, and §2.2 says a session grant reaches "nothing else, not
 * the course".
 *
 * So most signed-in people will see the panel rather than the list, and the
 * panel has to be honest about that: it names the permission, says this is a
 * permissions question rather than a fault, and says nothing about which grants
 * the caller DOES hold — `PermissionDeniedError` withholds those deliberately,
 * because a denial that enumerates a principal's reach is an enumeration
 * primitive.
 *
 * An empty table would be the wrong answer twice over: it would tell an
 * instructor the club teaches nothing, and it would tell an attacker that the
 * screen exists and is empty rather than that they may not read it.
 */

/** The signed-in, fully-enrolled session, or a redirect. Never returns null. */
export async function requireSignedIn(): Promise<CurrentSession> {
  return requireEnrolledSession();
}

/**
 * Runs a guarded read and reports a denial as a value rather than a throw, so
 * the page can render the panel instead of a 500.
 *
 * Only `PermissionDeniedError` is caught. Anything else — a database failure, a
 * bug — propagates to the error boundary, because a screen that renders "no
 * access" for an unrelated fault teaches an administrator to distrust the one
 * message that must stay meaningful.
 */
export async function guarded<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; permission: string }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { ok: false, permission: error.permission };
    }
    throw error;
  }
}
