"use server";

/**
 * The first-run wizard's two write steps (D-039, D-187).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES, AND WHY IT HAD TO
 *
 * The first administrator used to be created only by `splashtrack admin:create`
 * on the host, which prompts for a password on a TTY. The owner's terminal
 * mangles that input, so he typed a password he could not reproduce and locked
 * himself out of his own instance. The offered workaround was
 * `--password-file`, and it was rejected in the strongest terms — correctly,
 * because a password on disk is exactly what this product refuses everywhere
 * else. So the design's own answer is built instead: `13-…` §6.3's wizard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ACTION RE-DERIVES ITS OWN AUTHORITY. NOTHING TRUSTS THE PAGE.
 *
 * A Server Action is an HTTP endpoint reachable by POST without the page that
 * renders it, so `page.tsx` deciding a caller may see a form is a convenience
 * for the browser and never the control. Both actions below call
 * `resolveWizardAccess()` themselves and refuse anything but the exact stage
 * they belong to — which is what makes D-099 true of the WRITE and not merely
 * of the render.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT NEVER HAPPENS HERE
 *
 * The password is read from the POST body, handed to Better Auth, and dropped.
 * It is never written to disk, never logged, never put in a redirect, never in
 * an argument vector and never in shell history — the four places
 * `--password-file` and a CLI prompt could put it. The TOTP secret is not this
 * file's business at all: enrolment is `mfa-enrolment/actions.ts` (D-185), and
 * it renders the secret into one POST response and nowhere else.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  accountProvisioningMarker,
  auth,
  PASSWORD_POLICY,
  personCreationTracker,
} from "@/lib/auth";
import {
  INSTANCE_ADMINISTRATOR_ROLE_KEY,
  SELF_ROLE_KEY,
  seedInstallation,
} from "@/lib/boot/seed";
import { recordSetupStarted } from "@/lib/boot/setup-mode";
import { migrateAndApplyRoleModel } from "@/lib/boot/migrate";
import { detectBootState } from "@/lib/boot/state";
import { prisma } from "@/lib/database";
import { logger } from "@/lib/logging";
import { getClientIp } from "@/lib/rate-limit";
import {
  ORGANIZATION_ID,
  isValidOrganizationName,
  ORGANIZATION_NAME_MAX,
} from "@/lib/settings";
import {
  checkSetupAttempt,
  clearSetupAttempts,
  consumeSetupToken,
  recordSetupAttemptFailure,
  resolveWizardAccess,
  startWizardSession,
} from "@/lib/setup";
import { recordAuditEvent } from "@/modules/audit";

import type { AdministratorStepState, TokenStepState } from "./state";

const setupLogger = logger.child({ component: "setup.wizard" });

/**
 * A conservative address check. Deliberately not an RFC 5322 parser: this
 * bounds what a first administrator may type, and Better Auth applies its own
 * check afterwards. The bound that matters is the LENGTH — RFC 5321 caps an
 * address at 254 octets and an unbounded one is a row nobody meant to store.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const EMAIL_MAX = 254;

// ── step 1 — the one-time token ─────────────────────────────────────────────

/**
 * Exchanges D-101's token for the wizard's own cookie.
 *
 * ORDER MATTERS AND IT IS NOT THE OBVIOUS ONE. The lockout is checked BEFORE
 * the token is compared, so a locked-out caller never reaches the constant-time
 * compare — otherwise the lockout would itself be a timing signal about whether
 * a token exists at all.
 */
export async function submitSetupToken(
  _previous: TokenStepState,
  formData: FormData,
): Promise<TokenStepState> {
  const { stage } = await resolveWizardAccess({ signedInPending: false });
  // Not "redirect them to the right step": if the wizard is not asking for a
  // token, then submitting one is not an operation that exists.
  if (stage !== "TOKEN") return { status: "error", reason: "CLOSED" };

  const clientIp = await getClientIp();
  const allowed = checkSetupAttempt(clientIp);
  if (!allowed.allowed) return { status: "error", reason: "LOCKED_OUT" };

  const verdict = consumeSetupToken(String(formData.get("token") ?? ""));
  if (!verdict.ok) {
    const after = await recordSetupAttemptFailure(clientIp, verdict.refusal);
    return {
      status: "error",
      reason: after.allowed ? verdict.refusal : "LOCKED_OUT",
    };
  }

  clearSetupAttempts(clientIp);
  await startWizardSession();
  setupLogger.info(
    { event: "setup.token.accepted" },
    "the one-time setup token was accepted; the wizard is open for this browser",
  );

  redirect("/setup");
}

// ── step 2 — the organisation and the first administrator ───────────────────

/**
 * Migrates, seeds, names the organisation, creates the administrator, and signs
 * that administrator in so the very next screen can enrol their authenticator.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ONE ACTION AND NOT FIVE
 *
 * D-055's "New installation" branch is one answer to one question — *what is
 * this database for?* — and the steps after it are consequences of that answer,
 * not further questions. Splitting them across screens would put the operator
 * in `PARTIAL` with a migrated schema and no account, which is a state they
 * would then have to be talked out of.
 *
 * IT SIGNS THE ADMINISTRATOR IN, and that is the whole point of the wizard
 * existing. `admin:create` deliberately deletes the session it creates, because
 * the operator is at a terminal and a session token in a container's memory
 * belongs to nobody. Here the operator IS in the browser, and the account is
 * `mfa_pending` — so the session it gets can do exactly two things, sign in and
 * enrol (D-185). Handing it over is what stops the account existing in a state
 * its owner cannot enter.
 *
 * NOTHING IS WRITTEN UNTIL THE INPUT IS VALID. Every check below runs before
 * the first migration, so a mistyped password confirmation leaves an untouched
 * database rather than a half-built installation the operator has to reason
 * about.
 */
export async function createFirstAdministrator(
  _previous: AdministratorStepState,
  formData: FormData,
): Promise<AdministratorStepState> {
  const { stage } = await resolveWizardAccess({ signedInPending: false });
  if (stage !== "ADMINISTRATOR") return { status: "error", reason: "closed" };

  const organizationName = String(
    formData.get("organizationName") ?? "",
  ).trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || email.split("@")[0];
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");

  if (!isValidOrganizationName(organizationName)) {
    return { status: "error", reason: "organisation" };
  }
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    return { status: "error", reason: "email" };
  }
  if (
    password.length < PASSWORD_POLICY.minLength ||
    password.length > PASSWORD_POLICY.maxLength
  ) {
    return { status: "error", reason: "password" };
  }
  // THE WHOLE REASON THIS SCREEN EXISTS. The owner locked himself out because a
  // terminal prompt took a password he could not reproduce; a second field the
  // browser can echo back to him is the fix, and it is checked server-side
  // because a client-side check is a convenience.
  if (password !== confirmation) {
    return { status: "error", reason: "passwordMismatch" };
  }

  try {
    await buildInstallation({ organizationName, email, name, password });
  } catch (error) {
    // The DETAIL goes to the server log and never to an unauthenticated
    // browser: a migration failure names schemas, roles and connection targets.
    setupLogger.error(
      { event: "setup.wizard.failed", err: error },
      "the setup wizard could not build the installation",
    );
    return { status: "error", reason: "failed" };
  }

  // The session for the browser that is about to enrol. A SEPARATE sign-in
  // rather than the one `signUpEmail` establishes, so this goes through the
  // ordinary sign-in path — including the audit hook that records
  // `security.password_login` — instead of inheriting a session created by a
  // provisioning call.
  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch (error) {
    // The account EXISTS at this point and the installation is sound. Failing
    // to sign in is recoverable by signing in, so this is reported and not
    // rolled back — rolling back would delete a working administrator because
    // a cookie could not be set.
    setupLogger.error(
      { event: "setup.wizard.sign_in_failed", err: error },
      "the administrator was created but could not be signed in; they can " +
        "sign in at /sign-in with the password they just chose",
    );
  }

  redirect("/setup");
}

/**
 * D-055's NEW INSTALLATION branch, in its stated order: migrate → seed → name →
 * administrator → grants. The bootstrap record is written BEFORE the first
 * `Person` row, and setup is NOT completed here — the enrolment flow does that,
 * at the instant D-141's invariant first holds (D-185/D-186).
 */
async function buildInstallation(input: {
  organizationName: string;
  email: string;
  name: string;
  password: string;
}): Promise<void> {
  const decision = await detectBootState();
  if (decision.state === "EMPTY" || decision.pendingMigrations.length > 0) {
    setupLogger.info(
      { event: "setup.wizard.migrating", state: decision.state },
      "the operator answered 'new installation'; applying migrations",
    );
    await migrateAndApplyRoleModel((line) =>
      setupLogger.info({ event: "setup.wizard.migrate" }, line),
    );
  }

  // BEFORE anything else can write a row (D-186). Without it, the first Person
  // would leave an installation holding data with no record that setup ever
  // started — which is exactly what `TAMPERED` means, and it would refuse to
  // serve on the next restart.
  await recordSetupStarted();

  const seeded = await seedInstallation();
  setupLogger.info(
    {
      event: "setup.wizard.seeded",
      permissions: seeded.permissions,
      roles: seeded.roles,
    },
    "permission catalogue and system roles seeded",
  );

  await prisma.organization.update({
    where: { id: ORGANIZATION_ID },
    data: { name: input.organizationName },
  });

  if (await prisma.userAccount.findUnique({ where: { email: input.email } })) {
    // Reachable only by two operators racing the same token, which
    // `consumeSetupToken` already makes impossible, or by a retry after a
    // partial failure. Either way the honest answer is that this address is
    // taken.
    throw new Error("An account already exists for that address.");
  }

  // `signUpEmail` is deny-by-default at the HTTP route
  // (`enforceServerSideSignUpOnly`); the marker is what identifies this as
  // server-side provisioning rather than a stranger creating an account. The
  // tracker records the `Person` the create hook makes, so a failure after that
  // hook does not leave an orphaned personal-data row behind.
  const tracked: { personId?: string } = {};
  try {
    await personCreationTracker.run(tracked, () =>
      accountProvisioningMarker.run(true, () =>
        auth.api.signUpEmail({
          body: {
            email: input.email,
            password: input.password,
            name: input.name,
          },
        }),
      ),
    );
  } catch (error) {
    if (tracked.personId) {
      await prisma.person
        .delete({ where: { id: tracked.personId } })
        .catch(() => undefined);
    }
    throw error;
  }

  const account = await prisma.userAccount.findUniqueOrThrow({
    where: { email: input.email },
    select: { id: true, personId: true },
  });

  await assignRole(account.personId, INSTANCE_ADMINISTRATOR_ROLE_KEY);
  // D-146: SELF is an explicit seeded assignment, never an implicit match.
  await assignRole(account.personId, SELF_ROLE_KEY, "SELF");

  // The session `signUpEmail` established belongs to nobody: it was created
  // without the browser's headers. The caller signs in properly afterwards.
  await prisma.session.deleteMany({ where: { userId: account.id } });

  // AUDITED, AND NOT AS BREAK-GLASS. `admin:create` writes a
  // `security.break_glass.*` event and raises a banner every administrator must
  // dismiss, because host access bypassing the application is exactly what an
  // administrator should be told about. This is the ordinary first-run path, so
  // it gets an ordinary event — a banner on every future login saying "somebody
  // set this instance up" would be noise that trains people to dismiss the one
  // that matters.
  //
  // The throwing `recordAuditEvent`, not the safe one: an administrator account
  // that came into existence with no trail is not a state to serve past.
  await recordAuditEvent({
    eventType: "security.setup.administrator_created",
    outcome: "SUCCESS",
    actorPersonId: null,
    // The authority was the one-time token plus host access to read it, not a
    // person this application can name. Recording a person id would be a guess
    // dressed as attribution — the same reasoning as `system:cli`.
    actorAuthMethod: "setup:wizard",
    targetType: "user_account",
    targetId: account.id,
    changedFields: {
      role: INSTANCE_ADMINISTRATOR_ROLE_KEY,
      scope: "ORGANIZATION",
      organizationNameLength: input.organizationName.length,
    },
    reason: "first_run_setup_wizard",
  });

  setupLogger.info(
    {
      event: "setup.wizard.administrator_created",
      userAccountId: account.id,
      nameMax: ORGANIZATION_NAME_MAX,
    },
    "the first administrator was created; setup completes when a second " +
      "factor is verified",
  );
}

/** Creates a standing grant of a seeded role, idempotently. */
async function assignRole(
  personId: string,
  roleKey: string,
  scopeType: "ORGANIZATION" | "SELF" = "ORGANIZATION",
): Promise<void> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: roleKey },
    select: { id: true },
  });
  const existing = await prisma.roleAssignment.findFirst({
    where: { personId, roleId: role.id, scopeType, validUntil: null },
    select: { id: true },
  });
  if (existing) return;
  await prisma.roleAssignment.create({
    data: {
      personId,
      roleId: role.id,
      scopeType,
      scopeId: null,
      // Seeding, the setup wizard and the CLI are host-access-proven rather
      // than issued by a person the application can name — which is what a NULL
      // `grantedByPersonId` means on this table.
      grantedByPersonId: null,
      validUntil: null,
    },
  });
}
