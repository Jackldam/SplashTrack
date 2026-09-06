import {
  requireEnrolledSession,
  type CurrentSession,
} from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";

/**
 * The two things every screen in this area does before it renders anything.
 * The same shape as `src/app/people/access.tsx`, and for the same reasons —
 * repeated per area rather than shared, because the denial copy and the
 * permission it names belong beside the screens that raise them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SCREEN THAT RENDERS WITHOUT A PERMISSION CHECK IS A DEFECT
 *
 * Not a to-do, and not something the service layer can be trusted to catch on
 * its own: a page that fetches nothing but renders a heading, a form and a
 * layout has already disclosed that this installation has teaching groups and
 * what can be done to them. So authentication is resolved here and the guarded
 * read happens before the first element is returned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A DENIAL IS A RENDERED PANEL AND NOT A REDIRECT — AND WHY IT MATTERS MORE
 * IN THIS AREA THAN ANYWHERE ELSE SO FAR
 *
 * D-145 rule 1 makes an instructor's reach over a group end the moment their
 * `InstructorAssignment` closes. That is a REAL, ordinary, weekly event: a term
 * ends, somebody swaps groups, a volunteer stops. The instructor opens the app
 * on Tuesday and the group they taught last week is not theirs any more.
 *
 * An empty list would tell them the application is broken. A redirect to the
 * landing page would tell them the same thing one layer up. Only a panel that
 * says *"je hebt geen toegang tot deze groep"* tells them the truth, which is
 * that this is a permissions question with an answer somebody can give them.
 * That is why the repository raises `ReachCoversNoGroupError` rather than
 * returning `[]`, and this is where that distinction becomes something a person
 * reads.
 *
 * The panel names the permission and nothing else. It never names the grants the
 * caller DOES hold — `PermissionDeniedError` withholds those deliberately,
 * because a denial that enumerates a principal's reach is an enumeration
 * primitive.
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
