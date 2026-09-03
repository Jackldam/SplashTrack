/**
 * Better Auth server instance.
 *
 * Better Auth owns interactive user IDENTITY and SESSION lifecycle only: sign
 * in, sign out, secure cookies, session rotation and revocation, password
 * reset, and MFA availability. It is deliberately NOT the authorization layer.
 * Every protected operation must still go through `requirePermission` +
 * `resolveReach` (D-147, `CLAUDE.md` rule 3) — which does not exist yet and is
 * phase 0.4. Do not add a permission check to this file when it arrives; the
 * separation is the point.
 *
 * Identity-model integration: Better Auth's "user" concept is mapped onto the
 * EXISTING `UserAccount` table rather than introducing a parallel user table.
 * `Person` — the human, the personal-data anchor — stays separate: every new
 * `UserAccount` is linked to a `Person` by the `user.create.before` hook below,
 * so "a Person may exist without an account, and an account always belongs to
 * exactly one Person" holds. Credentials and password hashes live in the
 * Better-Auth-owned `Account` table, never on `UserAccount` or `Person`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT HERE, AND WHY
 *
 * NO EXTERNAL IDENTITY PROVIDER. The template registered a Microsoft/Entra
 * social provider resolved from a database-stored configuration document, with
 * account linking, `amr`-claim capture and an email-claim fallback. The IdP
 * registry is out of v1, so none of it is extracted: no `socialProviders`, no
 * `account.accountLinking`, no `/callback/*` audit branch, no `IDP_PROVEN`
 * session evidence.
 *
 * NO NATIVE-SIGN-IN TOGGLE. The template's `enforceNativeSignInEnabled` plugin
 * let an administrator disable password sign-in — which only makes sense when a
 * second sign-in method exists. Here it would be a switch whose only effect is
 * locking everyone out, so it is not extracted.
 *
 * NO EMAIL DELIVERY YET. `sendResetPassword` below logs that a reset was
 * requested and sends nothing; the notifications and email-template modules are
 * not part of the foundation. The token IS still minted and stored by Better
 * Auth, so this is a missing delivery channel, not a broken flow.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";

import { deriveAuthSigningSecret } from "@/lib/crypto/secret-key";
import {
  prisma,
  UserAccountStatus,
  type SessionMfaEvidence,
} from "@/lib/database";
import { logger } from "@/lib/logging";
import {
  consumeRateLimit,
  hashRateLimitId,
  resolveClientIp,
} from "@/lib/rate-limit";
import { SESSION_TIMEOUT_MINUTES } from "@/lib/settings";
import { recordAuditEventSafe } from "@/modules/audit";
import { PASSWORD_POLICY } from "./password-policy";

/** The application name shown in TOTP authenticator apps and passkey prompts. */
const APP_NAME = "SplashTrack";

// Secure cookies REQUIRE HTTPS: a browser will not store or send a `Secure`
// cookie over plain HTTP (localhost excepted). Derive this from the app's
// PUBLIC URL scheme rather than NODE_ENV, so cookies work over HTTP on
// localhost AND on a trusted LAN host — which is a real deployment shape here,
// not a hypothetical: `04-ux.md` §4.0 and FM-15 both assume starting on
// something like `http://nas.local:3000` and moving to a real domain later.
// Tying this to NODE_ENV would set `Secure` on a production-mode container
// served over plain HTTP and silently break sign-in there.
const servedOverHttps = (process.env.BETTER_AUTH_URL ?? "").startsWith(
  "https://",
);

// --- Passkey / WebAuthn config (D-132) --------------------------------------
// WebAuthn binds every credential to a Relying Party: the `origin` the ceremony
// runs at and the `rpID` (a registrable domain) the credential is scoped to. A
// passkey created under one rpID CANNOT be used under another, so these must be
// correct per deployment and are therefore environment-driven, never hardcoded.
//
// D-132 and FM-15 are explicit about the consequence: changing the host
// INVALIDATES EVERY PASSKEY AT ONCE, and moving from a LAN name to a real
// domain is the EXPECTED path for this deployment, not an edge case. That is
// why every account retains a password + TOTP fallback — total lockout is worse
// than re-enrolling a passkey.
//
// `origin` is the app's public origin — exactly what `BETTER_AUTH_URL` already
// is. `rpID` is the bare host, DERIVED from that origin by default so a single
// correct `BETTER_AUTH_URL` makes both right, with an explicit `PASSKEY_RP_ID`
// override for the case where the registrable parent domain is wanted (set
// `example.com` while serving from `www.example.com`, so one passkey works on
// both). A mismatched rpID makes every ceremony fail, which is why this is
// resolved carefully rather than guessed.
const PASSKEY_ORIGIN = (
  process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

function resolvePasskeyRpID(): string {
  const explicit = process.env.PASSKEY_RP_ID?.trim();
  if (explicit) return explicit;
  try {
    // The host only — never the port; rpID is a domain, not an origin.
    return new URL(PASSKEY_ORIGIN).hostname;
  } catch {
    return "localhost";
  }
}

/**
 * The attributes Better Auth applies to every cookie it sets (below,
 * `advanced.defaultCookieAttributes`). Exported so any caller that has to
 * restore a cookie does so with the SAME attributes it actually carries — a
 * bare `cookies().set(name, value)` with no options drops `httpOnly`, `secure`
 * and `sameSite` entirely (Next.js does not default them), which would downgrade
 * a live session cookie to script-readable.
 */
export const BETTER_AUTH_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: servedOverHttps,
};

/**
 * Correlates a `Person` created by the `user.create.before` hook below back to
 * whoever called `auth.api.signUpEmail`, even if sign-up throws AFTER the hook
 * has already created the Person (e.g. a transient database error while
 * inserting the `UserAccount` row). Without this, a caller that needs to roll
 * back a failed sign-up has no way to learn the id of a Person the hook created
 * moments before the failure — `signUpEmail`'s thrown error carries no such id.
 *
 * Callers that need rollback-on-failure wrap their `signUpEmail` call in
 * `personCreationTracker.run({}, ...)` and inspect the store object afterwards;
 * the hook fills in `personId` if — and only if — it ran.
 *
 * There is no such caller yet: account provisioning arrives with the `users`
 * module. The tracker ships with the hook because the two are a matched pair,
 * and an orphaned `Person` row is a personal-data leak, not a tidiness issue.
 *
 * That is not hypothetical. Probing this extraction produced exactly one: a
 * sign-up whose `Account` insert failed left a `Person` and a `UserAccount`
 * behind, because the hook had already run.
 */
export const personCreationTracker = new AsyncLocalStorage<{
  personId?: string;
}>();

/**
 * Marks an in-flight `auth.api.signInEmail` / `verifyTOTP` / `verifyBackupCode`
 * / `verifyPasskeyAuthentication` call as a RE-AUTHENTICATION step-up rather
 * than a genuine interactive sign-in.
 *
 * This exists because the re-auth helpers call the SAME Better Auth endpoints
 * the audit hooks below record as `security.password_login` /
 * `security.two_factor_login` / `security.passkey_login`. With nothing to tell
 * them apart, confirming a sensitive action (a data export, an erasure) wrote a
 * PHANTOM sign-in row — polluting "was this account signed into" forensics.
 * Every re-auth helper wraps its `auth.api.*` call in
 * `reauthenticationMarker.run(true, ...)`; every hook below that would
 * otherwise write a login event checks the marker and, when set, redirects the
 * event to the DISTINCT `security.reauthentication` type instead of skipping it
 * — a failed re-auth right before an erasure is still security-relevant, it
 * just must never masquerade as a sign-in.
 *
 * KEPT DESPITE HAVING NO WRITER YET. The re-auth helpers (the template's
 * `login.ts`) are not extracted in phase 0.2, so nothing sets this marker and
 * every branch below takes the ordinary path. It is extracted anyway because
 * the marker and the hooks are one mechanism: an engineer adding step-up
 * re-authentication later, against hooks that had been simplified to assume it
 * away, would reproduce exactly the phantom-sign-in bug this closes — and would
 * have no reason to suspect it.
 */
export const reauthenticationMarker = new AsyncLocalStorage<true>();

/**
 * Marks an in-flight `auth.api.signUpEmail` call as SERVER-SIDE ACCOUNT
 * PROVISIONING — an administrator creating an instructor's account — rather
 * than a stranger creating one for themselves.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT IN THE TEMPLATE. `/api/auth/[...all]`
 * mounts Better Auth's FULL endpoint surface, which includes
 * `/sign-up/email`. With `emailAndPassword.enabled: true` and nothing in front
 * of it, an unauthenticated POST to that path creates a Person, a UserAccount
 * with status ACTIVE, and a credential — and is immediately able to sign in.
 * Measured during the phase-0.2 extraction, not reasoned about: the probe
 * returned HTTP 200 and a session token.
 *
 * The template documented this and left it open on the reasoning that
 * `/sign-up/email` is "the server-side primitive behind bootstrap and admin
 * provisioning" — true of the FUNCTION, not of the ROUTE. It was survivable
 * there because the template had a deliberate public-registration feature
 * behind its own toggle. Here public self-registration is OUT OF v1 (R-12
 * reduces the public surface to a catalogue and an inquiry form), so an open
 * sign-up endpoint is not a feature with a missing gate — it is a stranger
 * creating an account on a system holding children's records.
 *
 * Deny by default: `enforceServerSideSignUpOnly` below rejects `/sign-up/email`
 * unless this marker is set, and it can only be set by server-side code that
 * chose to. This is the same AsyncLocalStorage-plus-`hooks.before` shape the
 * template already uses for its own gates, not a new mechanism — and it fails
 * CLOSED, unlike the sign-in toggle, because refusing to create an account can
 * never lock anybody out of one they already have.
 *
 * The `users` module's provisioning service is what will wrap its
 * `signUpEmail` call in `accountProvisioningMarker.run(true, ...)`, alongside
 * `personCreationTracker`. Until then NOTHING can create an account through
 * HTTP, which for a phase with no account-management UI is the correct state.
 */
export const accountProvisioningMarker = new AsyncLocalStorage<true>();

/**
 * Password length policy. Exported because callers that must reject a bad
 * password BEFORE taking an irreversible step need the same numbers Better Auth
 * enforces.
 *
 * Defined in `./password-policy` (a dependency-free module) and re-exported
 * here, so a client component can import the same constant without pulling in
 * this file's server-only dependencies.
 */
export { PASSWORD_POLICY };

/**
 * SHA-256 hash of an opaque token, hex-encoded — the hash-only-storage
 * primitive. A token is stored as its hash and never in raw form.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * How long a password-reset token stays valid.
 *
 * Deliberately SHORT. A forgot-password token is exactly the kind of credential
 * that should be short-lived, and there is nothing here forcing it to be long.
 *
 * Configurable by ENVIRONMENT rather than as a database-backed setting, and
 * that is a genuine D-037 exception rather than laziness: Better Auth reads
 * this ONCE when the instance is constructed at module scope, so it cannot
 * consult a per-request database value. It is left UNSET by default (2 hours)
 * and is not listed in `.env.example` — an instance that never sets it behaves
 * correctly, so it is a tuning knob, not configuration an operator must supply.
 */
const PASSWORD_RESET_TTL_HOURS = { min: 1, max: 72, default: 2 } as const;

function resolvePasswordResetTtlSeconds(): number {
  const raw = Number(process.env.PASSWORD_RESET_TOKEN_TTL_HOURS);
  const hours =
    Number.isInteger(raw) &&
    raw >= PASSWORD_RESET_TTL_HOURS.min &&
    raw <= PASSWORD_RESET_TTL_HOURS.max
      ? raw
      : PASSWORD_RESET_TTL_HOURS.default;
  return hours * 60 * 60;
}

// --- Session timeouts (D-173) -----------------------------------------------
// Better Auth uses a SLIDING window: `expiresIn` is how long a session survives
// WITHOUT activity, extended on activity at most every `updateAge`. It has no
// built-in ABSOLUTE cap, so one is enforced from `session.createdAt` in
// ./session.ts.
//
// The IDLE timeout is administrator-configurable and enforced LIVE in
// `./session.ts` (`getCurrentSession`) as a SECOND, independent app-level check
// alongside the absolute one. `expiresIn` below could NOT itself become that
// configurable value: verified against Better Auth's context construction, it
// is read exactly ONCE when the instance is built at module scope, so it can
// never consult a per-request database value the way
// `getConfiguredSecurityPolicy()` does. That is the same singleton problem the
// design identifies for identity providers, and it is why the live check lives
// in the session helper rather than here.
//
// CORRECTNESS NOTE, carried across from the template's history because an
// engineer starting fresh would not know to reproduce it: the live check in
// ./session.ts originally compared against `session.updatedAt`, which
// `auth.api.getSession()` itself refreshes to "now" before returning it
// whenever more than `updateAge` has elapsed — making the idle check
// unenforceable for exactly the idle gaps it exists to catch, and a net
// REGRESSION versus a fixed `expiresIn` that Better Auth had enforced natively.
// Fixed by tracking activity in an app-owned `Session.lastSeenAt` column Better
// Auth's own refresh cannot touch. That fix is the live control; `expiresIn` is
// a backstop, not the enforcement point.
//
// So `expiresIn` is set to the CEILING of the configurable absolute timeout, so
// it can never fire BEFORE the live checks do for any value an administrator
// could configure. It still matters as the ultimate backstop for a session
// nobody ever calls `getCurrentSession()` for again — an abandoned token —
// which Better Auth eventually deletes on its own rather than keeping forever.
//
// It cannot usefully be tightened below that ceiling: an administrator MAY
// configure the live idle or absolute timeout up to it, and Better Auth's own
// expiry would otherwise force-delete a genuinely active session's row before
// that legitimate, longer window ever mattered. Nor is it needed as
// defence-in-depth against the live check failing open: that check never fails
// open — a read error on `Session.lastSeenAt` denies the session, and
// `getConfiguredSecurityPolicy()` degrades to its STRICT floor, never to "no
// limit".
//
// `updateAge` is NOT tied to `expiresIn`: Better Auth's "should this session
// refresh now" decision reduces to `now - lastRefresh >= updateAge`,
// independent of how large `expiresIn` is.
const SESSION_IDLE_TIMEOUT_SECONDS = SESSION_TIMEOUT_MINUTES.max * 60;

/**
 * Sliding-refresh cadence: expiry and `session.updatedAt` are bumped at most
 * this often on activity. This is also, in effect, the resolution of the coarse
 * "last activity" signal read from `session.updatedAt` in ./sessions.ts — a
 * "seen within the last ~5 minutes" proxy, not a per-request timestamp. The
 * precise signal is `Session.lastSeenAt`, written by ./session.ts.
 */
const SESSION_REFRESH_AGE_SECONDS = 60 * 5;

/**
 * Splits a Better Auth "name" into given/family parts for the linked `Person`.
 * Better Auth requires a single `name`; `Person` stores structured given and
 * family names. Best-effort: richer name capture belongs to the `people`
 * module, which owns how a Dutch tussenvoegsel is recorded.
 */
function splitName(name: string): { givenName: string; familyName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "Unknown", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0], familyName: "" };
  return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
}

/**
 * Shape shared by every `ctx.context.newSession` read below. `session.id` is
 * additionally read by the MFA-evidence write — present whenever Better Auth
 * actually created or rotated a session, which is exactly the "genuine sign-in"
 * case that write needs.
 */
type LoginNewSession =
  | {
      user?: { id?: string; personId?: string | null };
      session?: { id?: string };
    }
  | null
  | undefined;

/**
 * Bounds `/passkey/verify-authentication` FAILURE audit-write volume.
 *
 * Unlike every other audited path, a failed passkey ceremony has NO
 * authenticated actor and no safely-resolvable target either — a discoverable-
 * credential ceremony can fail before any user is resolved — so the source IP
 * (hashed, never stored raw) is the only signal available to key a bucket on.
 *
 * A PER-SOURCE bucket rather than one shared global bucket is deliberate: it
 * bounds volume from any ONE source while still writing several rows for a
 * sustained attack (forensically more useful than collapsing to a single row),
 * and — the failure mode to avoid — it means a flood from attacker A can only
 * suppress further rows from A's own source, never rows a different caller
 * would otherwise write. The usual NAT/shared-proxy trade-off applies.
 */
const PASSKEY_FAILURE_IP_RULE = { limit: 20, windowMs: 15 * 60 * 1000 };

/**
 * A minimal Better Auth plugin whose ONLY purpose is to run an after-hook for
 * `/sign-in/email` positioned AFTER the `twoFactor` plugin's own after-hook —
 * i.e. placed in the `plugins` array below AFTER `twoFactor(...)`.
 *
 * This is not stylistic. A trust-device sign-in completes at `/sign-in/email`
 * itself (the two-factor plugin's after-hook returns EARLY, before deleting the
 * session, when a valid signed `trust_device` cookie is present), but the main
 * `hooks.after` below runs BEFORE any plugin's after-hook — `options.hooks.after`
 * is always hook index 0, and plugin hooks are appended after it in `plugins`
 * array order. So by the time the main hook inspects `newSession`, the
 * two-factor plugin has not yet decided whether to keep or delete the session,
 * and the only available proxy (`!twoFactorEnabled`) is wrong for exactly the
 * trust-device case — silently dropping that SUCCESS from the audit trail.
 *
 * Positioned here, this hook observes `ctx.context.newSession` in its FINAL,
 * already-decided state:
 *   - no MFA on the account: unchanged from the credential handler — SUCCESS.
 *   - MFA enabled, NO valid trust-device cookie: the plugin has already nulled
 *     `newSession` and swapped the response for `{ twoFactorRedirect: true }` —
 *     genuinely NOT terminal; the outcome lands at the TOTP step instead.
 *   - MFA enabled WITH a valid trust-device cookie: the plugin returns early
 *     without touching `newSession`. This is the case a `!twoFactorEnabled`
 *     check misses. Even where the app's own sign-in form never sends
 *     `trustDevice`, the Better Auth route forwards any client-supplied body
 *     field, so a raw caller CAN set it.
 *
 * Keying success off `databaseHooks.session.create` instead was considered and
 * rejected: that hook fires the instant the credential handler creates the
 * session, strictly BEFORE the two-factor plugin's after-hook runs at all, so
 * it is even less able to distinguish "kept for trust-device" from "about to be
 * deleted for a challenge", and would write a phantom SUCCESS for every
 * ordinary MFA password step.
 */
const auditSignInEmailTerminalOutcome = {
  id: "audit-sign-in-email-terminal-outcome",
  hooks: {
    after: [
      {
        matcher: (context: { path?: string }) =>
          context.path === "/sign-in/email",
        handler: createAuthMiddleware(async (ctx) => {
          try {
            const newSession = ctx.context.newSession as LoginNewSession;
            // Absent here means either the credential check failed (handled by
            // the FAILURE branch in the main hook below, which runs first
            // regardless of this hook's position) or an MFA challenge is
            // genuinely still pending — neither is a terminal SUCCESS.
            if (!newSession?.user?.id) return;

            const isReauth = reauthenticationMarker.getStore() === true;
            await recordAuditEventSafe({
              eventType: isReauth
                ? "security.reauthentication"
                : "security.password_login",
              outcome: "SUCCESS",
              actorPersonId: newSession.user.personId ?? null,
              actorAuthMethod: "session",
              targetType: "user_account",
              targetId: newSession.user.id,
              changedFields: { method: "password" },
            });
          } catch {
            // An audit failure must never break sign-in.
          }
        }),
      },
    ],
  },
};

/**
 * Refuses `/sign-up/email` unless it comes from server-side account
 * provisioning — see `accountProvisioningMarker` above for the full reasoning
 * and for what the open endpoint actually did when probed.
 *
 * Placed FIRST in `plugins` so this gate runs before any other plugin's
 * before-hook touches state for this path.
 *
 * FAILS CLOSED, deliberately, and this is the opposite direction from a
 * sign-IN gate. Refusing to create a new account cannot lock anyone out of an
 * account they already hold, so there is no lockout argument for failing open
 * here — whereas a fail-closed gate on sign-in could leave an administrator
 * unable to reach the page that would fix it. Do not "harmonise" the two.
 */
const enforceServerSideSignUpOnly = {
  id: "enforce-server-side-sign-up-only",
  hooks: {
    before: [
      {
        matcher: (context: { path?: string }) =>
          context.path === "/sign-up/email",
        handler: createAuthMiddleware(async () => {
          if (accountProvisioningMarker.getStore() === true) return;
          throw new APIError("FORBIDDEN", {
            message: "Accounts are created by an administrator.",
          });
        }),
      },
    ],
  },
};

export const auth = betterAuth({
  // Signs session tokens and encrypts TOTP secrets. Never logged.
  //
  // DERIVED, NOT CONFIGURED (D-112). This read `BETTER_AUTH_SECRET` — a second
  // independent secret beside `SECRET_KEY`. Two secrets is the failure mode
  // F-95 names, not the safe option: a restore that reproduces one but not the
  // other silently kills every TOTP enrolment while MFA is mandatory. One root,
  // one HKDF branch per purpose — see `@/lib/crypto/secret-key`.
  secret: deriveAuthSigningSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  appName: APP_NAME,

  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  // Map Better Auth's "user" concept onto the existing UserAccount table. Field
  // names (name, email, emailVerified, image, createdAt, updatedAt) match the
  // Prisma columns 1:1, so only the model name is mapped. `personId`, `status`
  // and `disabledAt` are application-owned columns Better Auth does not manage;
  // `personId` is injected by the create hook below.
  user: {
    modelName: "userAccount",
    // Self-service email change. Every account here has `emailVerified = false`
    // (there is no local verify-your-email-at-sign-in flow), so
    // `updateEmailWithoutVerification` selects Better Auth's "update
    // immediately" branch — no email round-trip, which is what lets this work
    // on an instance where transactional email is not configured at all. The
    // security a verification email would normally provide (a hijacked session
    // must not silently change the sign-in email) is instead enforced by
    // RE-AUTHENTICATING the caller before this endpoint is called — and that
    // re-authentication is part of the not-yet-extracted profile surface, so
    // NOTHING may expose this endpoint until it exists.
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: true,
    },
    additionalFields: {
      // `personId` is an application-owned column (the link to the Person).
      // Declaring it here — as a non-input field — is what lets the
      // `user.create.before` hook's injected value survive Better Auth's "drop
      // unknown fields" filtering and reach the Prisma adapter. It is never
      // accepted from client sign-up input (`input: false`).
      personId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },

  session: {
    expiresIn: SESSION_IDLE_TIMEOUT_SECONDS,
    updateAge: SESSION_REFRESH_AGE_SECONDS,
  },

  emailAndPassword: {
    enabled: true,
    // No transactional email provider is wired yet, so sign-in is not gated on
    // verification. The reset endpoint still issues and stores tokens;
    // delivery is stubbed below.
    requireEmailVerification: false,
    minPasswordLength: PASSWORD_POLICY.minLength,
    maxPasswordLength: PASSWORD_POLICY.maxLength,
    resetPasswordTokenExpiresIn: resolvePasswordResetTtlSeconds(),
    sendResetPassword: async ({ user }) => {
      // NOT YET IMPLEMENTED, and deliberately loud about it rather than
      // pretending. The notifications and email-template modules are not part
      // of the foundation, so there is nowhere to send this. Better Auth has
      // ALREADY minted and stored the token by the time this runs, so the reset
      // flow is intact apart from delivery.
      //
      // Never log the URL or the token — the recipient and the event only. This
      // must also never throw: a delivery failure must not turn the reset
      // endpoint into a 500 or leak whether an account exists.
      logger.warn(
        {
          event: "auth.password_reset.delivery_not_configured",
          email: user.email,
        },
        "A password reset was requested but no email provider is configured; " +
          "the token was minted and stored, and nothing was sent",
      );
    },
  },

  // Audit for interactive sign-in outcomes: the password step, the TOTP / OTP /
  // backup-code second-factor steps, and the passkey ceremony. Every branch is
  // wrapped so an audit failure can NEVER throw into the auth pipeline — a
  // broken audit must not break sign-in.
  //
  // ORDERING CAVEAT: this single `hooks.after` function is always the FIRST
  // after-hook to run for a request; plugin after-hooks are appended after it.
  // For `/sign-in/email` that means `newSession` here reflects ONLY the
  // credential handler's initial decision, not the two-factor plugin's eventual
  // one — which is why that path's SUCCESS is handled separately by
  // `auditSignInEmailTerminalOutcome` above. This hook still owns
  // `/sign-in/email`'s FAILURE branch: a thrown credential error never reaches
  // the two-factor plugin's hook at all, so there is no ordering hazard there.
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // Passkey SIGN-IN. Recorded here rather than in the plugin's own callback
      // because `newSession` is reliably populated by this point, and no other
      // hook touches this path, so SUCCESS is safe to decide here. Enrolment is
      // audited separately in the passkey plugin's `afterVerification`.
      if (ctx.path === "/passkey/verify-authentication") {
        try {
          const newSession = ctx.context.newSession as LoginNewSession;
          const isReauth = reauthenticationMarker.getStore() === true;
          if (newSession?.user?.id) {
            await recordAuditEventSafe({
              eventType: isReauth
                ? "security.reauthentication"
                : "security.passkey_login",
              outcome: "SUCCESS",
              actorPersonId: newSession.user.personId ?? null,
              actorAuthMethod: "session",
              targetType: "user_account",
              targetId: newSession.user.id,
              changedFields: isReauth ? { method: "passkey" } : undefined,
            });
          } else {
            // No session ⇒ the ceremony failed (unknown or removed credential,
            // origin/challenge mismatch, or a rejected assertion — the endpoint
            // always THROWS on failure, never silently no-ops). `targetId` is
            // null: a discoverable-credential ceremony can fail before any user
            // is resolved, so there is nothing honest to attribute it to.
            //
            // Unlike every other branch here this one has NO authenticated
            // actor to key volume control on, so it is the one write path a
            // garbage-POST flood could otherwise hit unbounded. Gate it behind
            // the same rate-limit primitive, per hashed source IP. Fails OPEN
            // on a rate-limit store hiccup — it is the AUDIT that gets skipped,
            // never the ceremony's own rejection.
            const ip = resolveClientIp(ctx.headers ?? new Headers());
            const { allowed } = await consumeRateLimit(
              `passkey-verify-failure:ip:${hashRateLimitId(ip)}`,
              PASSKEY_FAILURE_IP_RULE,
            );
            if (allowed) {
              await recordAuditEventSafe({
                eventType: isReauth
                  ? "security.reauthentication"
                  : "security.passkey_login",
                outcome: "FAILURE",
                actorPersonId: null,
                actorAuthMethod: "session",
                targetType: "user_account",
                targetId: null,
                changedFields: { method: "passkey" },
                reason: "invalid_credentials",
              });
            }
          }
        } catch {
          // An audit failure must never break sign-in.
        }
        return;
      }

      // The PASSWORD step of sign-in — FAILURE only; SUCCESS is decided by
      // `auditSignInEmailTerminalOutcome` (see its doc comment).
      if (ctx.path === "/sign-in/email") {
        try {
          const returned = ctx.context.returned;
          if (isAPIError(returned)) {
            // Unknown email, wrong password, or a disabled account — Better
            // Auth and the `session.create.before` hook below throw the SAME
            // generic error for all three, so this branch cannot and must not
            // distinguish them either.
            //
            // Resolve the submitted email against UserAccount UNCONDITIONALLY —
            // on every failure, known or not — so a known account costs exactly
            // the same as an unknown one. Skipping this lookup for unknown
            // emails would reopen a timing side-channel that the generic
            // client-facing error already closes. The email is discarded the
            // instant the lookup returns: it never reaches `changedFields` or
            // `reason`; only the resolved account id — an opaque identifier,
            // not personal data — does.
            const body = ctx.body as { email?: unknown } | undefined;
            const email = typeof body?.email === "string" ? body.email : "";
            const account = email
              ? await prisma.userAccount.findUnique({
                  where: { email },
                  select: { id: true },
                })
              : null;
            const isReauth = reauthenticationMarker.getStore() === true;
            await recordAuditEventSafe({
              eventType: isReauth
                ? "security.reauthentication"
                : "security.password_login",
              outcome: "FAILURE",
              actorPersonId: null,
              actorAuthMethod: "session",
              targetType: account ? "user_account" : null,
              targetId: account ? account.id : null,
              changedFields: { method: "password" },
              reason: "invalid_credentials",
            });
          }
        } catch {
          // An audit failure must never break sign-in.
        }
        return;
      }

      // The second-factor step — TOTP, OTP and backup-code share this shape.
      // Unlike `/sign-in/email`, no other plugin after-hook touches these three
      // paths, so `returned` and `newSession` here already reflect the FINAL
      // outcome and SUCCESS is decided directly in this hook.
      const SECOND_FACTOR_METHOD: Record<string, string> = {
        "/two-factor/verify-totp": "totp",
        "/two-factor/verify-otp": "otp",
        "/two-factor/verify-backup-code": "backup_code",
      };
      // The SESSION-evidence value each method writes on a genuine SUCCESS. All
      // three app-level second factors prove a session equally.
      const SECOND_FACTOR_EVIDENCE: Record<string, SessionMfaEvidence> = {
        totp: "TOTP_PROVEN",
        otp: "OTP_PROVEN",
        backup_code: "BACKUP_CODE_PROVEN",
      };
      const secondFactorMethod = SECOND_FACTOR_METHOD[ctx.path];
      if (secondFactorMethod) {
        try {
          const returned = ctx.context.returned;
          if (isAPIError(returned)) {
            // Covers a wrong or expired code AND the plugin's own lockout —
            // both throw from inside the endpoint before any hook runs, so this
            // branch cannot and must not distinguish them. `targetId: null` is
            // the honest fallback: the pending challenge is resolved inside the
            // endpoint from a signed cookie and nothing usable is left on
            // `ctx.context` for a hook to read back.
            const isReauth = reauthenticationMarker.getStore() === true;
            await recordAuditEventSafe({
              eventType: isReauth
                ? "security.reauthentication"
                : "security.two_factor_login",
              outcome: "FAILURE",
              actorPersonId: null,
              actorAuthMethod: "session",
              targetType: null,
              targetId: null,
              changedFields: { method: secondFactorMethod },
              reason: "invalid_credentials",
            });
          } else {
            const newSession = ctx.context.newSession as LoginNewSession;
            if (newSession?.user?.id) {
              const isReauth = reauthenticationMarker.getStore() === true;
              await recordAuditEventSafe({
                eventType: isReauth
                  ? "security.reauthentication"
                  : "security.two_factor_login",
                outcome: "SUCCESS",
                actorPersonId: newSession.user.personId ?? null,
                actorAuthMethod: "session",
                targetType: "user_account",
                targetId: newSession.user.id,
                changedFields: { method: secondFactorMethod },
              });

              // SESSION-evidence write: this is a GENUINE interactive sign-in
              // completing the app's second-factor challenge. `!isReauth` rules
              // out a step-up re-auth, which drives this SAME endpoint against a
              // transient challenge session that its caller immediately rolls
              // back — writing evidence there would target a session already
              // about to be discarded, never the caller's real one.
              //
              // ALL THREE methods write evidence, not just TOTP. Scoping this to
              // TOTP reintroduces a hard lockout for exactly the population
              // backup codes exist to rescue — see `Session.mfaEvidence` in
              // schema.prisma for the full note. Do not narrow it.
              //
              // Best-effort and defensive: a failure here must never break
              // sign-in, and must fail toward NOT proven. An unwritten
              // `mfaEvidence` just means a future step-up gate asks again.
              const evidenceValue = SECOND_FACTOR_EVIDENCE[secondFactorMethod];
              if (evidenceValue && !isReauth) {
                const sessionId = newSession.session?.id;
                if (sessionId) {
                  try {
                    await prisma.session.update({
                      where: { id: sessionId },
                      data: { mfaEvidence: evidenceValue },
                    });
                  } catch {
                    // Fail toward NOT proven — see above.
                  }
                }
              }
            }
          }
        } catch {
          // An audit failure must never break sign-in.
        }
      }
    }),
  },

  plugins: [
    // Deny-by-default gate on account creation — FIRST, so it runs before any
    // other plugin's before-hook. See its definition above: without it, an
    // unauthenticated POST to /api/auth/sign-up/email creates an ACTIVE account
    // and returns a session token, which it did when probed.
    enforceServerSideSignUpOnly,
    // Two-factor (TOTP). This makes MFA technically AVAILABLE per account
    // (enable/verify/disable endpoints and the `twoFactorEnabled` flag). It
    // intentionally does NOT enforce "this permission requires MFA": that is an
    // authorization decision and it is phase 0.4 (D-147), because the predicate
    // it needs is the high-risk permission set, which does not exist yet.
    //
    // `allowPasswordless: true`: Better Auth only skips the password prompt on
    // `/two-factor/enable|disable` when NO `credential` Account row for the
    // caller carries a non-null password, so this flag alone changes NOTHING
    // for an account that has one — every account with a real password still
    // must prove it. It matters for an account provisioned without a usable
    // password, and only in combination with the provisioning path DELETING the
    // placeholder credential row rather than storing an unusable value: the
    // check matches on the ROW'S PRESENCE, not on whether the password is one
    // anybody could ever supply. That provisioning path is not extracted yet;
    // the flag is set now so the two arrive consistent.
    twoFactor({
      issuer: APP_NAME,
      allowPasswordless: true,
    }),
    // MUST be positioned right after `twoFactor(...)` — see the long comment on
    // its definition above. It audits `/sign-in/email`'s terminal outcome and
    // can only do so correctly by running AFTER the two-factor plugin's hook.
    auditSignInEmailTerminalOutcome,
    // Passkeys / WebAuthn (D-132) — an ADDITIONAL sign-in method; password and
    // TOTP keep working unchanged, which is the fallback FM-15 depends on.
    // Registration requires an authenticated session by default, so a passkey
    // can only be added from the account's own profile page, and the
    // `session.create.before` ACTIVE-only hook below still governs the session
    // a passkey sign-in establishes exactly as it does for password sign-in.
    passkey({
      rpID: resolvePasskeyRpID(),
      rpName: APP_NAME,
      origin: PASSKEY_ORIGIN,
      registration: {
        // Record a successful passkey enrolment. Fires server-side right after
        // the credential is verified and stored, so it cannot be skipped by a
        // client that forgets to report back. An audit failure must never break
        // registration.
        afterVerification: async ({ user }) => {
          try {
            const account = await prisma.userAccount.findUnique({
              where: { id: user.id },
              select: { personId: true },
            });
            await recordAuditEventSafe({
              eventType: "security.passkey_registered",
              outcome: "SUCCESS",
              actorPersonId: account?.personId ?? null,
              actorAuthMethod: "session",
              targetType: "user_account",
              targetId: user.id,
            });
          } catch {
            // Never throw into the auth pipeline.
          }
        },
      },
    }),
    // MUST be last: lets Better Auth's server APIs set and clear cookies from
    // Next.js Server Actions and Route Handlers.
    nextCookies(),
  ],

  advanced: {
    // Better Auth already sets httpOnly and SameSite=Lax by default; being
    // explicit is for auditability. `secure` follows the public URL scheme (see
    // `servedOverHttps`): on over HTTPS, off over plain HTTP where a `Secure`
    // cookie could never be sent anyway.
    useSecureCookies: servedOverHttps,
    defaultCookieAttributes: BETTER_AUTH_COOKIE_ATTRIBUTES,
  },

  // By default Better Auth's shared verification table stores the raw token as
  // the row identifier (`reset-password:<token>`) — readable in full by anyone
  // with database read access. "hashed" stores a hash instead, matching the
  // hash-only-storage rule applied everywhere else. A pure hardening with no
  // behaviour change for callers.
  verification: {
    storeIdentifier: "hashed",
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // An account must belong to a Person. Better Auth does not know about
          // `Person`, so one is created here and the required `personId`
          // injected. (Better Auth performs its email-uniqueness check before
          // this hook runs, so the orphaned-Person window is minimal.)
          const { givenName, familyName } = splitName(user.name ?? "");
          const person = await prisma.person.create({
            data: { givenName, familyName },
          });
          // Record the created id for rollback-capable callers (see
          // `personCreationTracker`) — a no-op if nobody is tracking.
          const tracked = personCreationTracker.getStore();
          if (tracked) tracked.personId = person.id;
          return { data: { ...user, personId: person.id } };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          // Only an ACTIVE account may establish a session. This blocks sign-in
          // for a DISABLED account; ./session.ts additionally rejects
          // already-issued sessions whose account is no longer ACTIVE, so
          // disabling an account takes effect immediately rather than at its
          // next sign-in.
          const account = await prisma.userAccount.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          if (!account || account.status !== UserAccountStatus.ACTIVE) {
            throw new APIError("FORBIDDEN", {
              message: "This account cannot sign in.",
            });
          }
          return { data: session };
        },
      },
    },
  },
});

export type Auth = typeof auth;
