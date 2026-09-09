/**
 * The two Server Action results the enrolment page renders from.
 *
 * SEPARATE FROM `./actions.ts` because that file carries `"use server"`, and a
 * `"use server"` module may only export async functions — a type export there
 * is erased at compile time but rejected by the directive's own check. Keeping
 * them here also means the client component can import the shapes without
 * pulling the server module's graph into its own.
 *
 * `TotpEnrolmentArtefact` (the QR path and the typeable key) is spread into the
 * `ready` state rather than nested, so the component destructures one object.
 */

import type { TotpEnrolmentArtefact } from "@/lib/auth/totp-qr";

/** What "show me the QR code" returns. */
export type StartEnrolmentState =
  | { status: "idle" }
  | { status: "error"; reason: "password" | "unavailable" }
  | ({ status: "ready"; backupCodes: string[] } & TotpEnrolmentArtefact);

/** What "here is my code" returns. Success redirects and returns nothing. */
export type VerifyEnrolmentState =
  { status: "idle" } | { status: "error"; reason: "code" };
