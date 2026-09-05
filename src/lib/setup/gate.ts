/**
 * Who may see `/setup`, and which step they see — the whole of D-099 for this
 * surface, in one pure function and one thin wrapper.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THAT MAY NOT BEND (D-099, F-98)
 *
 * *"The unauthenticated setup surface must never open on a populated
 * database."* D-039 adds the other half: the wizard *"self-destructs"*, and
 * D-186 fixes the predicate that decides when.
 *
 * Those are two independent gates and this file is where both are applied:
 *
 *   THE FRONT is the one-time setup token (D-101). Reaching `/setup` in a state
 *   that serves it still gets you nothing but a box asking for a credential
 *   that only somebody with host access can read.
 *
 *   THE BACK is the boot state. The wizard is reachable in `SETUP_MODE` states
 *   and nowhere else, and `SETUP_MODE` is a property of the INSTALLATION —
 *   four counts and a lookup (D-099 as corrected by D-186), not one deletable
 *   row. On `CURRENT` the wizard does not exist: `notFound()`, not a redirect,
 *   because a redirect says the route is there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `PENDING_ENROLMENT` IS SERVED, AND IT IS NOT AN UNAUTHENTICATED SURFACE
 *
 * §6.3 says the wizard is reachable *"only in SETUP MODE (states EMPTY and
 * PARTIAL as redefined by D-099)"*. D-186 later made `SETUP_MODE` a THREE-state
 * action by adding `PENDING_ENROLMENT` — the window in which the administrator
 * exists and has not yet proved a second factor. The wizard has to serve that
 * window, because the wizard is what walks the operator THROUGH it: the account
 * is created in step 2 and the authenticator is enrolled in step 3, and the
 * boot state changes between them.
 *
 * D-099 is not weakened by that, and the reason is precise. In
 * `PENDING_ENROLMENT` this file requires a SIGNED-IN pending session, never the
 * token — the token has been consumed by then. So the surface is
 * unauthenticated in `EMPTY` and `PARTIAL`, which D-099/D-186 prove hold no
 * data beyond what setup itself created, and AUTHENTICATED from the moment an
 * account exists. There is no state in which an anonymous caller reaches an
 * administrative step on a database holding rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DECISION IS A PURE FUNCTION
 *
 * The same shape `decideRouteAccess` uses, for the same reason: a security
 * decision spread across an async page body can only be tested by standing up
 * the state it reacts to. {@link decideWizardAccess} is total over
 * {@link BootState}, so the test enumerates EVERY state and asserts what each
 * one gets — including the states nobody thought to write a case for.
 *
 * SERVER-ONLY.
 */

import { detectBootState, type BootState } from "@/lib/boot";
import { logger } from "@/lib/logging";

import { hasWizardSession } from "./wizard-session";

/**
 * Which step `/setup` renders, or that it does not exist.
 *
 * `SIGN_IN_REQUIRED` is not a step of the wizard: it is what an anonymous
 * caller gets in `PENDING_ENROLMENT`, and it discloses nothing an anonymous
 * caller could not already learn from `/sign-in`.
 */
export type WizardStage =
  "TOKEN" | "ADMINISTRATOR" | "ENROLMENT" | "SIGN_IN_REQUIRED" | "CLOSED";

export interface WizardAccessInput {
  state: BootState;
  /** Does THIS request carry a valid, unexpired wizard cookie? */
  hasWizardCookie: boolean;
  /** Is there a signed-in account with NO verified second factor? */
  signedInPending: boolean;
}

/**
 * The whole decision. Total over `BootState`: every state that is not
 * explicitly listed as serving is `CLOSED`, and the `switch` is exhaustive so a
 * state added later fails to compile rather than falling into a default that
 * happens to be safe today.
 */
export function decideWizardAccess(input: WizardAccessInput): WizardStage {
  switch (input.state) {
    // D-098 predicate 1 and predicate 4's un-populated branch. No account, no
    // person, no role assignment — the only two states in which an
    // unauthenticated administrative surface may exist at all (D-099).
    case "EMPTY":
    case "PARTIAL":
      return input.hasWizardCookie ? "ADMINISTRATOR" : "TOKEN";

    // D-186's window. The account exists, so the token is spent and the
    // authorization is the session: an anonymous caller is sent to sign in and
    // sees no administrative step at all.
    case "PENDING_ENROLMENT":
      return input.signedInPending ? "ENROLMENT" : "SIGN_IN_REQUIRED";

    // CURRENT — setup completed; the wizard is gone forever (D-039).
    // TAMPERED — data present with no record that setup started. This is F-98's
    //   exact scenario and it is why D-099 exists: the wizard must be as closed
    //   here as on a healthy live installation, and it is.
    // EXISTING / AHEAD / FAILED — the container is migrating or refusing, and a
    //   first-run wizard has nothing to say about any of them.
    case "CURRENT":
    case "TAMPERED":
    case "EXISTING":
    case "AHEAD":
    case "FAILED":
      return "CLOSED";
  }
}

/**
 * The same decision against the live installation. One boot-state detection and
 * one cookie read; the session is passed in by the caller, which already has it.
 *
 * NOT CACHED AND NOT LATCHED, deliberately. `isSetupIncomplete()` latches its
 * COMPLETED answer because completion is monotonic; this must not latch its
 * OPEN answer, because that one stops being true — the wizard's own last step
 * is what closes it, inside the same process that is serving it.
 */
export async function resolveWizardAccess(options: {
  signedInPending: boolean;
}): Promise<{ stage: WizardStage; state: BootState | "UNKNOWN" }> {
  let decision;
  try {
    decision = await detectBootState();
  } catch (error) {
    // DENY BY DEFAULT, and note which direction that is. `isSetupIncomplete()`
    // fails toward "not set up" because the safe thing there is to serve a
    // notice instead of an application whose authorization tables may not
    // exist. Here the safe thing is the opposite: an unreadable database must
    // never be an argument for opening an unauthenticated administrative
    // surface, so a detection failure closes the wizard. The cost is a 404 on a
    // database blip mid-install, and the remedy is a reload.
    logger.warn(
      { event: "setup.wizard.state_unreadable", err: error },
      "the boot state could not be read; the setup wizard is closed for this " +
        "request",
    );
    return { stage: "CLOSED", state: "UNKNOWN" };
  }

  const hasWizardCookie = await hasWizardSession();

  return {
    state: decision.state,
    stage: decideWizardAccess({
      state: decision.state,
      hasWizardCookie,
      signedInPending: options.signedInPending,
    }),
  };
}
