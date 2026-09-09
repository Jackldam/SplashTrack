/**
 * Who may see `/setup` — D-099's rule, asserted over EVERY boot state rather
 * than over the ones somebody thought to write a case for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE EXHAUSTIVE LOOP IS THE POINT
 *
 * The rule is *"the unauthenticated setup surface must never open on a
 * populated database"* (F-98). A suite that checks `CURRENT` is closed and
 * `EMPTY` is open proves nothing about the state added next quarter. So the
 * table below names every member of `BootState` explicitly, and a separate case
 * asserts the table is COMPLETE — a new state with no entry fails here rather
 * than inheriting whatever the `switch` happens to do.
 *
 * The negative direction is asserted twice over, because it is the direction
 * that matters:
 *
 *   • `TAMPERED` — F-98's exact scenario, a populated database with the
 *     bootstrap record removed — is CLOSED with a valid wizard cookie, with a
 *     signed-in pending session, and with both.
 *   • `CURRENT` — a live installation — is CLOSED under the same three.
 *
 * The companion integration case, in `tests/integration/setup-wizard.test.ts`,
 * drives the same predicate against REAL databases in each of those states, so
 * this file is about totality and that one is about the states being reachable
 * at all.
 */

import { describe, expect, it } from "vitest";

import type { BootState } from "@/lib/boot";
import { ACTION_BY_STATE } from "@/lib/boot/state";
import { decideWizardAccess, type WizardStage } from "@/lib/setup/gate";

/**
 * Every boot state, and what a caller gets at `/setup` in it. Written out
 * rather than derived, because a table derived from the implementation asserts
 * that the implementation equals itself.
 */
const EXPECTED: Record<
  BootState,
  { anonymous: WizardStage; withCookie: WizardStage; pending: WizardStage }
> = {
  // The two states in which an unauthenticated administrative surface may
  // exist at all: no account, no person, no role assignment (D-099/D-186).
  EMPTY: {
    anonymous: "TOKEN",
    withCookie: "ADMINISTRATOR",
    pending: "TOKEN",
  },
  PARTIAL: {
    anonymous: "TOKEN",
    withCookie: "ADMINISTRATOR",
    pending: "TOKEN",
  },
  // D-186's window. The account exists, so the token is spent and the
  // authorization is the SESSION — a cookie is not enough and never was.
  PENDING_ENROLMENT: {
    anonymous: "SIGN_IN_REQUIRED",
    withCookie: "SIGN_IN_REQUIRED",
    pending: "ENROLMENT",
  },
  // Setup completed. The wizard self-destructed (D-039) and nothing reopens it.
  CURRENT: { anonymous: "CLOSED", withCookie: "CLOSED", pending: "CLOSED" },
  // F-98's scenario: data present, bootstrap record gone. THE CASE D-099 EXISTS
  // FOR, and it must be as closed as a healthy live installation.
  TAMPERED: { anonymous: "CLOSED", withCookie: "CLOSED", pending: "CLOSED" },
  // The container is migrating or refusing to start. A first-run wizard has
  // nothing to say about any of them.
  EXISTING: { anonymous: "CLOSED", withCookie: "CLOSED", pending: "CLOSED" },
  AHEAD: { anonymous: "CLOSED", withCookie: "CLOSED", pending: "CLOSED" },
  FAILED: { anonymous: "CLOSED", withCookie: "CLOSED", pending: "CLOSED" },
};

describe("decideWizardAccess", () => {
  for (const [state, expected] of Object.entries(EXPECTED) as [
    BootState,
    (typeof EXPECTED)[BootState],
  ][]) {
    it(`in ${state}: an anonymous caller gets ${expected.anonymous}`, () => {
      expect(
        decideWizardAccess({
          state,
          hasWizardCookie: false,
          signedInPending: false,
        }),
      ).toBe(expected.anonymous);
    });

    it(`in ${state}: a wizard cookie gets ${expected.withCookie}`, () => {
      expect(
        decideWizardAccess({
          state,
          hasWizardCookie: true,
          signedInPending: false,
        }),
      ).toBe(expected.withCookie);
    });

    it(`in ${state}: a signed-in pending account gets ${expected.pending}`, () => {
      expect(
        decideWizardAccess({
          state,
          hasWizardCookie: false,
          signedInPending: true,
        }),
      ).toBe(expected.pending);
    });
  }

  it("covers every boot state, so a new one cannot slip through untested", () => {
    // `ACTION_BY_STATE` is the boot layer's own exhaustive record of the states
    // that exist. Comparing against it means adding a state to `BootState`
    // breaks THIS test until somebody decides what the wizard does in it.
    expect(Object.keys(EXPECTED).sort()).toEqual(
      Object.keys(ACTION_BY_STATE).sort(),
    );
  });
});

describe("the two gates are independent", () => {
  it("a valid wizard cookie does not reopen a completed installation", () => {
    // THE PROPERTY THAT MAKES D-039's "self-destructs" TRUE OF THE SURFACE.
    // Somebody who set up an instance, kept the cookie and came back a year
    // later gets a 404, because the gate is the installation's state and not
    // anything they hold.
    for (const state of ["CURRENT", "TAMPERED"] as const) {
      expect(
        decideWizardAccess({
          state,
          hasWizardCookie: true,
          signedInPending: true,
        }),
      ).toBe("CLOSED");
    }
  });

  it("no cookie is enough on its own in the states that DO serve", () => {
    // The other direction, and it is what makes the first non-vacuous: in
    // EMPTY the cookie genuinely is what advances the wizard, so the CLOSED
    // results above are the boot state overriding it rather than the cookie
    // never mattering.
    expect(
      decideWizardAccess({
        state: "EMPTY",
        hasWizardCookie: true,
        signedInPending: false,
      }),
    ).toBe("ADMINISTRATOR");
    expect(
      decideWizardAccess({
        state: "EMPTY",
        hasWizardCookie: false,
        signedInPending: false,
      }),
    ).toBe("TOKEN");
  });

  it("the enrolment step needs a session, never a token or a cookie", () => {
    // D-099 is not weakened by serving PENDING_ENROLMENT: in that state the
    // database HOLDS DATA, and what opens the step is an authenticated session
    // belonging to the pending administrator — never the unauthenticated
    // credential that got them there.
    expect(
      decideWizardAccess({
        state: "PENDING_ENROLMENT",
        hasWizardCookie: true,
        signedInPending: false,
      }),
    ).toBe("SIGN_IN_REQUIRED");
  });
});
