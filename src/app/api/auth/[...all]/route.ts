/**
 * Better Auth route handler.
 *
 * Mounts Better Auth's full endpoint surface under `/api/auth/*` — sign in,
 * sign out, password reset, two-factor, passkey, session. The root
 * `middleware.ts` matcher already covers this path, so every auth request also
 * gets an `x-request-id` for log correlation.
 *
 * Business AUTHORIZATION is NOT performed here and must never be: it stays in
 * application services on top of the session helper in `@/lib/auth`
 * (`CLAUDE.md` rule 3).
 *
 * A consequence worth stating where someone will read it: this mounts the FULL
 * endpoint surface, so a caller can POST directly to `/api/auth/sign-in/email`
 * without going through any application-level throttle. See `middleware.ts` and
 * the advisory-lock comment in the audit repository — the throttle belongs in
 * middleware, keyed the same way, and it is not written yet.
 */

import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
