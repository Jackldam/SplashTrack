/**
 * The break-glass administrator commands (D-141, `13-…` §7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE MFA IS ENROLLED, AND WHY IT IS NO LONGER HERE (D-185)
 *
 * The constraint has not changed: F-20 states as a design assumption that
 * self-hosters debugging a problem paste logs and terminal output into public
 * issues, and a TOTP secret is strictly worse than the setup token D-101
 * already moved off the terminal for that reason — it does not expire, and it
 * is the second factor for the highest-privilege account in the product. THE
 * SECRET STILL NEVER REACHES STDOUT, STDERR OR THE LOGGER.
 *
 * What changed is the PLACE. `admin:create` used to enrol: it wrote the secret
 * to a 0600 file, printed only that path, and then blocked on a prompt
 * demanding a six-digit code. The operator could not open the file without
 * abandoning the prompt, so the command could not be completed by the person it
 * exists for. That is not a rough edge; it is the command not working.
 *
 * A terminal is simply the wrong surface for enrolling an authenticator. A
 * browser can draw a QR code, is where every other product does this, and is
 * not something anybody pastes into a chat. So:
 *
 *   `admin:create`   creates the account with a password and STOPS. The account
 *                    is `mfa_pending` (`@/lib/auth/mfa-enrolment`): it may sign
 *                    in and enrol, and every other route, page, API and Server
 *                    Action refuses it. Setup is NOT complete while it is in
 *                    that state, and the command prints the URL to visit.
 *
 *   the browser      `/mfa-enrolment` shows the QR, takes a code, verifies the
 *                    factor and writes the bootstrap record — the instant
 *                    D-141's invariant first holds.
 *
 * `admin:reset-mfa` BELOW STILL ENROLS FROM THE TERMINAL, and therefore still
 * writes the 0600 artefact. That is deliberate and it is not an oversight: it
 * exists for an administrator whose authenticator is gone, and D-141 requires a
 * verified factor on a local ORGANIZATION account AT ALL TIMES. Deleting the
 * factor and telling a single-administrator installation to go and enrol in a
 * browser would leave the invariant false for as long as that took, on exactly
 * the shape of installation this command exists for. Re-enrolling inside the
 * same command keeps it false for one transaction and true again before the
 * command returns. So the file-writing path stays, used by one caller, and the
 * usability defect it carries is bounded to a recovery command run by somebody
 * who already knows they are recovering.
 *
 * The password is read as before (`../prompt`): from a file the operator holds,
 * or from a TTY with echo disabled. No command here takes a password as a flag
 * value — a flag value is in the shell history and in `ps` for every user on
 * the host.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  accountProvisioningMarker,
  auth,
  personCreationTracker,
} from "@/lib/auth";
import {
  assertLocalAdminInvariantHolds,
  countLocalOrganizationAdmins,
} from "@/lib/auth/local-admin-invariant";
import {
  INSTANCE_ADMINISTRATOR_ROLE_KEY,
  SELF_ROLE_KEY,
  seedInstallation,
} from "@/lib/boot/seed";
import { detectBootState } from "@/lib/boot/state";
import { prisma } from "@/lib/database";

import { recordBreakGlassInvocation } from "../break-glass";
import { resolveSecret, readSecretLine } from "../prompt";
import type { CommandContext } from "../context";
import { migrateAndApplyRoleModel } from "./setup";

/** `admin:grant-admin` is a RECOVERY grant, not provisioning (`13-…` §7). */
const GRANT_ADMIN_HOURS = 24;

/**
 * Where the one-time enrolment artefact is written when `--out` is not given.
 * Relative to the process working directory, which in the image is `/app`, and
 * `/app/data` is the persistent volume the reference compose mounts.
 *
 * NOT `$DATA_DIR`. D-101 names `$DATA_DIR/setup-token` for the setup token, and
 * `DATA_DIR` is a variable §3.1 permits — but it arrives with the wizard that
 * needs it, and reading it here would grow the environment surface for a path
 * the operator can simply pass. When the wizard lands, this default becomes
 * `$DATA_DIR` and the flag stays.
 */
const DEFAULT_ARTEFACT_DIR = "data";

// ── admin:create ────────────────────────────────────────────────────────────

export async function adminCreate(ctx: CommandContext): Promise<number> {
  const email = requireFlag(ctx, "email");
  const name = ctx.flags.name ?? email.split("@")[0];

  // `admin:create` is the terminal step of D-055's "New installation" branch,
  // so it completes the earlier steps if the operator has not run `setup:init`
  // separately. On any state but EMPTY/PARTIAL this refuses for the same reason
  // `setup:init` does — see that file.
  const state = await detectBootState();
  if (state.state === "EMPTY" || state.state === "PARTIAL") {
    if (state.state === "EMPTY" || state.pendingMigrations.length > 0) {
      ctx.log(`Boot state ${state.state}: applying migrations…`);
      await migrateAndApplyRoleModel(ctx);
    }
  } else if (state.state !== "CURRENT" && state.state !== "EXISTING") {
    ctx.error(`This installation is ${state.state}; refusing.`);
    ctx.error(`  ${state.detail}`);
    return 1;
  }

  const bootstrap = await prisma.installationBootstrap.findFirst({
    where: { completedAt: { not: null } },
    select: { completedAt: true },
  });
  if (bootstrap) {
    ctx.error(
      "This installation has already completed first-run setup " +
        `(${bootstrap.completedAt?.toISOString()}). \`admin:create\` creates ` +
        "the FIRST administrator and is refused afterwards — an unaudited " +
        "second path to an ORGANIZATION-scoped account is the thing D-141's " +
        "invariant exists to make unnecessary. To recover access to an " +
        "existing account use `admin:grant-admin` or `admin:reset-mfa`.",
    );
    return 1;
  }

  if (await prisma.userAccount.findUnique({ where: { email } })) {
    ctx.error(`An account already exists for ${email}.`);
    return 1;
  }

  // Since D-185 this command no longer closes setup mode, so it is no longer
  // self-limiting: a second run with a different address creates a second
  // administrator. That is REPORTED rather than refused, because refusing would
  // strand an operator who mistyped the address on the first run — the account
  // they cannot use would also be the one blocking the account they need.
  // Nothing is widened by allowing it: every one of these accounts is
  // `mfa_pending` until somebody proves a factor, host access is already total
  // authority here, and each invocation writes its own break-glass audit event
  // and raises its own banner.
  const existingAccounts = await prisma.userAccount.findMany({
    select: { email: true },
  });
  if (existingAccounts.length > 0) {
    ctx.error(
      `NOTE: ${existingAccounts.length} account(s) already exist and setup is ` +
        "not complete, so none of them has enrolled MFA yet: " +
        `${existingAccounts.map((row) => row.email).join(", ")}. Creating ` +
        "another is allowed and audited; whichever enrols first completes " +
        "setup. Remove the rest from the application afterwards.",
    );
  }

  // Read the password BEFORE anything is written, so a mistyped confirmation
  // aborts a command that has changed nothing.
  const password = await resolveSecret({
    file: ctx.flags["password-file"],
    prompt: "Password for the new administrator (not echoed): ",
    confirmPrompt: "Repeat the password: ",
  });

  ctx.log("Seeding the permission catalogue and the system roles…");
  const seeded = await seedInstallation();
  ctx.log(
    `  ${seeded.permissions} permission(s), roles: ${seeded.roles.join(", ")}` +
      (seeded.organizationCreated ? ", organisation singleton created" : ""),
  );

  // The record comes BEFORE the privileged change (see ../break-glass).
  const { auditEventId } = await recordBreakGlassInvocation("admin:create", {
    detail: { role: INSTANCE_ADMINISTRATOR_ROLE_KEY, scope: "ORGANIZATION" },
  });

  // --- the account ---------------------------------------------------------
  // `signUpEmail` is deny-by-default at the HTTP route (`enforceServerSideSignUpOnly`
  // in @/lib/auth); the marker is what identifies this as server-side account
  // provisioning rather than a stranger creating an account. The tracker records
  // the id of the `Person` the create hook makes, so a failure after that hook
  // does not leave an orphaned personal-data row behind.
  const tracked: { personId?: string } = {};
  try {
    await personCreationTracker.run(tracked, () =>
      accountProvisioningMarker.run(true, () =>
        auth.api.signUpEmail({ body: { email, password, name } }),
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
    where: { email },
    select: { id: true, personId: true },
  });

  // --- the grants ----------------------------------------------------------
  await assignRole(account.personId, INSTANCE_ADMINISTRATOR_ROLE_KEY);
  // D-146: SELF is an explicit seeded assignment, never an implicit match.
  await assignRole(account.personId, SELF_ROLE_KEY, "SELF");

  // `signUpEmail` establishes a session for the caller. This one belongs to
  // nobody: the operator is at a terminal, not in the browser that will finish
  // enrolment, and a session token left in a container's memory is not an
  // artefact anybody agreed to keep. The administrator signs in themselves.
  await prisma.session.deleteMany({ where: { userId: account.id } });

  // --- what has NOT happened, deliberately ---------------------------------
  // No MFA factor, so no bootstrap record either: setup is not complete while
  // the only administrator is `mfa_pending`, and `completeSetupIfInvariantHolds`
  // in `@/lib/boot` writes that record from the enrolment flow at the instant
  // D-141's invariant first holds. `assertLocalAdminInvariantHolds` is likewise
  // NOT called here — it cannot hold yet, by construction, and asserting it
  // would make this command fail on success.
  ctx.log("");
  ctx.log(`Administrator created: ${email}`);
  ctx.log(`  role       ${INSTANCE_ADMINISTRATOR_ROLE_KEY} @ ORGANIZATION`);
  ctx.log(`  MFA        NOT YET ENROLLED — the account can do nothing else`);
  ctx.log(`  audit      ${auditEventId}`);
  ctx.log(
    "  banner     raised for all administrators; it is dismissed in-app, " +
      "not from here",
  );
  ctx.log("");
  ctx.log("SETUP IS NOT COMPLETE. Finish it in a browser:");
  ctx.log("");
  ctx.log(`    ${signInUrl()}`);
  ctx.log("");
  ctx.log(
    "Sign in with the password you just chose. You will be taken straight to " +
      "the page that shows a QR code for your authenticator; scan it, enter " +
      "the six digits it shows, and this installation is set up.",
  );
  ctx.log(
    "Until then the account may do exactly two things — sign in, and enrol. " +
      "Every other page, route and action refuses it.",
  );
  ctx.log("");
  ctx.log(
    "The TOTP secret is shown in that browser page and nowhere else: not " +
      "here, not in a file, not in a log (D-185).",
  );
  return 0;
}

/**
 * Where to send the operator to finish. `BETTER_AUTH_URL` is this instance's
 * public origin and is required for the container to start at all, so in a real
 * deployment it is always right. A bare checkout running the CLI without it
 * gets the honest placeholder rather than a guessed `localhost` that might send
 * somebody to the wrong machine.
 */
function signInUrl(): string {
  const base = process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/sign-in` : "<this instance's address>/sign-in";
}

// ── admin:reset-mfa ─────────────────────────────────────────────────────────

/**
 * Replaces an account's MFA factor. The use case is an administrator whose
 * authenticator is gone.
 *
 * IT RE-ENROLS IN THE SAME COMMAND, and that is not a convenience. D-141 says a
 * verified factor on a local `ORGANIZATION` account must exist *at all times*;
 * a reset that merely deleted the factor would break the invariant on the only
 * administrator of a single-administrator installation — which is the exact
 * shape of installation this command exists for. Deleting and re-enrolling in
 * one command means the invariant is false for the duration of one transaction
 * and true again before the command returns, and if verification fails the old
 * factor is restored rather than left absent.
 */
export async function adminResetMfa(ctx: CommandContext): Promise<number> {
  const email = requireFlag(ctx, "email");

  const account = await prisma.userAccount.findUnique({
    where: { email },
    select: { id: true, personId: true, status: true },
  });
  if (!account) {
    ctx.error(`No account for ${email}.`);
    return 1;
  }

  const password = await resolveSecret({
    file: ctx.flags["password-file"],
    prompt: `Current password for ${email} (not echoed): `,
  });

  const { auditEventId } = await recordBreakGlassInvocation("admin:reset-mfa", {
    targetUserAccountId: account.id,
  });

  const previous = await prisma.twoFactor.findMany({
    where: { userId: account.id },
  });

  // Sign in to obtain a session for the enrolment endpoints. With the factor
  // still present this would stop at the MFA challenge, so the factor rows are
  // removed first — and restored below if anything after this fails.
  await prisma.twoFactor.deleteMany({ where: { userId: account.id } });
  await prisma.userAccount.update({
    where: { id: account.id },
    data: { twoFactorEnabled: false },
  });

  try {
    const signIn = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const cookie = sessionCookieOf(signIn);

    const enrolment = (await auth.api.enableTwoFactor({
      body: { password },
      headers: new Headers({ cookie }),
    })) as { totpURI: string; backupCodes: string[] };

    const artefactPath = writeEnrolmentArtefact(ctx, email, enrolment);
    ctx.log("");
    ctx.log(`New MFA enrolment written to:\n    ${artefactPath}`);
    ctx.log(
      "It is not printed here. Open it on this host, enrol, then delete it.",
    );
    ctx.log("");

    const code = (
      await readSecretLine("Six-digit code from your authenticator: ")
    ).trim();
    await auth.api.verifyTOTP({
      body: { code },
      headers: new Headers({ cookie }),
      asResponse: true,
    });

    await prisma.session.deleteMany({ where: { userId: account.id } });
    await assertLocalAdminInvariantHolds(`Resetting MFA for ${email}`);

    ctx.log(`MFA reset and re-enrolled for ${email}. Audit ${auditEventId}.`);
    ctx.log(`Delete ${artefactPath} once your authenticator is set up.`);
    return 0;
  } catch (error) {
    // Put the old factor back rather than leaving the account with none.
    await prisma.twoFactor.deleteMany({ where: { userId: account.id } });
    if (previous.length > 0) {
      await prisma.twoFactor.createMany({ data: previous });
      await prisma.userAccount.update({
        where: { id: account.id },
        data: { twoFactorEnabled: true },
      });
    }
    await prisma.session.deleteMany({ where: { userId: account.id } });
    ctx.error(
      "The reset did not complete; the previous MFA factor has been restored.",
    );
    throw error;
  }
}

// ── admin:grant-admin ───────────────────────────────────────────────────────

/**
 * A 24-hour `ORGANIZATION`-scoped grant. NEVER permanent — `13-…` §7 is
 * explicit: *"the use case is recovery, not provisioning. The recovered
 * administrator makes their own standing grant through the normal path, where
 * D-139's anti-amplification invariants apply."*
 *
 * `grantedByPersonId` is left NULL, which is what that column means for a grant
 * issued from outside the grant service: seeding, the setup wizard and this CLI
 * are host-access-proven rather than issued by a person the application can
 * name.
 */
export async function adminGrantAdmin(ctx: CommandContext): Promise<number> {
  const email = requireFlag(ctx, "email");

  const account = await prisma.userAccount.findUnique({
    where: { email },
    select: { id: true, personId: true },
  });
  if (!account) {
    ctx.error(`No account for ${email}.`);
    return 1;
  }

  const role = await prisma.role.findUnique({
    where: { key: INSTANCE_ADMINISTRATOR_ROLE_KEY },
    select: { id: true },
  });
  if (!role) {
    ctx.error(
      "The instance_administrator role has not been seeded — this " +
        "installation has not completed setup. Run `admin:create` first.",
    );
    return 1;
  }

  const { auditEventId } = await recordBreakGlassInvocation(
    "admin:grant-admin",
    {
      targetUserAccountId: account.id,
      detail: { hours: GRANT_ADMIN_HOURS, scope: "ORGANIZATION" },
    },
  );

  const validFrom = new Date();
  const validUntil = new Date(
    validFrom.getTime() + GRANT_ADMIN_HOURS * 60 * 60 * 1000,
  );

  await prisma.roleAssignment.create({
    data: {
      personId: account.personId,
      roleId: role.id,
      scopeType: "ORGANIZATION",
      scopeId: null,
      validFrom,
      validUntil,
      grantedByPersonId: null,
    },
  });

  ctx.log(
    `Granted ${INSTANCE_ADMINISTRATOR_ROLE_KEY} @ ORGANIZATION to ${email} ` +
      `until ${validUntil.toISOString()} (${GRANT_ADMIN_HOURS} hours). ` +
      `Audit ${auditEventId}.`,
  );
  ctx.log(
    "This grant EXPIRES. Make a standing one through the application, where " +
      "D-139's anti-amplification rules apply.",
  );

  const admins = await countLocalOrganizationAdmins();
  if (admins === 0) {
    ctx.error(
      "Note: no account on this installation holds a verified MFA factor, so " +
        "D-141's invariant does not hold. If this one has never enrolled, it " +
        `can sign in at ${signInUrl()} and will be taken straight to ` +
        "enrolment (D-185). If its authenticator is lost, run " +
        "`admin:reset-mfa` instead.",
    );
  }
  return 0;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function requireFlag(ctx: CommandContext, name: string): string {
  const value = ctx.flags[name];
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

/**
 * The `Set-Cookie` headers of a Better Auth response, folded into a `Cookie`
 * request header. Reusing the real cookie is what lets the CLI drive the same
 * endpoints a browser would, rather than reaching behind the auth library and
 * writing its tables directly — which would mean owning Better Auth's TOTP
 * secret encryption format by hand.
 */
function sessionCookieOf(response: Response): string {
  const cookies = response.headers.getSetCookie();
  if (cookies.length === 0) {
    throw new Error(
      "Better Auth returned no session cookie; cannot continue enrolment.",
    );
  }
  return cookies.map((value) => value.split(";")[0]).join("; ");
}

/**
 * Writes the one-time enrolment artefact, mode 0600, and returns its path.
 * Created with the mode rather than chmod'ed afterwards is not possible for the
 * directory, so the directory is created 0700 and the file is opened with 0600
 * — there is no instant at which the secret is on disk world-readable.
 */
function writeEnrolmentArtefact(
  ctx: CommandContext,
  email: string,
  enrolment: { totpURI: string; backupCodes: string[] },
): string {
  const directory = path.resolve(
    process.cwd(),
    ctx.flags.out ?? DEFAULT_ARTEFACT_DIR,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(
    directory,
    `mfa-enrolment-${Date.now()}-${email.replace(/[^a-zA-Z0-9]+/g, "_")}.txt`,
  );

  const body = [
    "SplashTrack — MFA enrolment. THIS FILE IS A CREDENTIAL.",
    "Do not paste it into an issue, a chat or a screenshot. Delete it once",
    "your authenticator holds the account.",
    "",
    `account:      ${email}`,
    "",
    "Add this URI to your authenticator (most apps accept it as a manual",
    "entry; the key is the `secret` parameter):",
    enrolment.totpURI,
    "",
    "Backup codes — each usable once, for when the authenticator is gone:",
    ...enrolment.backupCodes.map((backupCode) => `  ${backupCode}`),
    "",
  ].join("\n");

  writeFileSync(file, body, { mode: 0o600, flag: "wx" });
  // Belt and braces: `mode` is masked by the process umask on some platforms.
  chmodSync(file, 0o600);
  return file;
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
      validUntil: null,
      grantedByPersonId: null,
    },
  });
}
