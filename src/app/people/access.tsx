import { redirect } from "next/navigation";

import { getCurrentSession, type CurrentSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";

/**
 * The two things every screen in this area does before it renders anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SCREEN THAT RENDERS WITHOUT A PERMISSION CHECK IS A DEFECT
 *
 * Not a to-do, and not something the service layer can be trusted to catch on
 * its own: a page that fetches nothing but renders a heading, a form and a
 * layout has disclosed that this installation has a people register and what
 * can be done to it, before any service was called. So authentication is
 * resolved here and the guarded read happens before the first element is
 * returned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A DENIAL IS A RENDERED PANEL AND NOT A REDIRECT
 *
 * §1.1 rule 1 keeps UI gating and authorization on separate code paths, and the
 * authorization answer here is "no" — telling the truth about that is the whole
 * reason `personFilterForReach` distinguishes DENIED from an empty result. A
 * redirect to the landing page would reproduce, one layer up, exactly the
 * "looks broken" failure the repository refuses to produce.
 *
 * The panel names the permission and nothing else. It never names the grants
 * the caller DOES hold — `PermissionDeniedError` withholds those deliberately,
 * because a denial that enumerates a principal's reach is an enumeration
 * primitive.
 */

/** The signed-in session, or a redirect to sign in. Never returns null. */
export async function requireSignedIn(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  return session;
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
