import {
  requireEnrolledSession,
  type CurrentSession,
} from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";

/**
 * The two things every screen in this area does before it renders anything —
 * the `src/app/courses/access.tsx` shape, repeated per area for the same
 * reason: the denial copy and the permission it names belong beside the
 * screens that raise them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DENIAL HERE IS THE ORDINARY CASE FOR MOST SIGNED-IN PEOPLE, BY DESIGN
 *
 * D-093: arrears never appear on the poolside surface. `fees.read`/
 * `fees.manage`/`fees.export` are administration permissions, not something a
 * volunteer instructor holds — so most signed-in people will see the "no
 * access" panel here rather than a balance, and that is the intended outcome,
 * not a bug to route around.
 */

/** The signed-in, fully-enrolled session, or a redirect. Never returns null. */
export async function requireSignedIn(): Promise<CurrentSession> {
  return requireEnrolledSession();
}

/**
 * Runs a guarded read and reports a denial as a value rather than a throw, so
 * the page can render the panel instead of a 500.
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
