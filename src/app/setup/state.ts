/**
 * The two Server Action results the wizard's own steps render from.
 *
 * SEPARATE FROM `./actions.ts` because that file carries `"use server"`, and a
 * `"use server"` module may only export async functions — the same split
 * `mfa-enrolment/state.ts` makes, for the same reason.
 *
 * BOTH SHAPES CARRY A REASON CODE AND NEVER A MESSAGE. The message is chosen in
 * the component from `messages/*.json`, so the Dutch and English catalogues stay
 * the one home for what an operator reads (D-159 governs identifiers, not the
 * UI), and so nothing an action knows can be rendered by accident.
 */

import type { SetupTokenRefusal } from "@/lib/setup";

/**
 * Why a token submission was refused.
 *
 * `LOCKED_OUT` is D-101's lockout. `CLOSED` is the wizard having shut between
 * the page rendering and the form posting — a real race on an instance where
 * somebody else is finishing setup at the same moment, and the honest answer is
 * "this is over", not a validation error.
 */
export type TokenStepState =
  | { status: "idle" }
  | { status: "error"; reason: SetupTokenRefusal | "LOCKED_OUT" | "CLOSED" };

/**
 * Why the administrator step was refused. Every one of these is a field the
 * operator can fix; `failed` is the honest catch-all for a migration or a
 * database error, and the detail for that one goes to the server log rather
 * than to an unauthenticated browser.
 */
export type AdministratorStepError =
  | "organisation"
  | "email"
  | "emailTaken"
  | "password"
  | "passwordMismatch"
  | "closed"
  | "failed";

export type AdministratorStepState =
  { status: "idle" } | { status: "error"; reason: AdministratorStepError };
