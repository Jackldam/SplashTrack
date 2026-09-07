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
 * A DENIAL HERE IS THE ORDINARY CASE. Every screen in this area guards
 * `{ organization: true }` (`award-type-service.ts`'s file comment explains
 * why the catalogue has no narrower scope), so only an `ORGANIZATION`-scoped
 * principal — typically the Instance Administrator — ever sees past the
 * panel. An ordinary instructor reaching this area by URL gets a true,
 * actionable "geen toegang", never an empty catalogue.
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
