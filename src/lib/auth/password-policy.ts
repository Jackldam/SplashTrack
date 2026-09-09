/**
 * Password length policy (Architecture.md Section 3.1; FD-AUTHN-06f).
 *
 * The single source of truth for password min/max length. Split out of
 * `./auth` — which pulls in Better Auth, Prisma, and other server-only
 * dependencies — specifically so it can be imported from a `"use client"`
 * component (the live requirements feedback, `@/components/forms/PasswordRequirements`)
 * without dragging the entire server module graph into the client bundle.
 *
 * `./auth` re-exports this same constant for its server-side uses (Better
 * Auth config, Server Action validation), so the UI and the server can never
 * read different numbers. Only the two bounds below are real rules — per the
 * frozen functional design (documentation/functional-design.md, "Password
 * Requirements"), the WebApp favours strong and usable passwords over
 * complexity-theatre rules (no mandated symbol/uppercase/digit classes), and
 * FD-AUTHN-06a–e (configurable minimum, common-password blocking, reuse
 * prevention, temporary-password expiry, lockout) are explicitly out of scope
 * for this slice (FD-AUTHN-06f only) — this stays hardcoded.
 */
export const PASSWORD_POLICY = { minLength: 12, maxLength: 128 } as const;
