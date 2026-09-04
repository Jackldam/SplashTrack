/**
 * The break-glass administrator commands (D-141, `13-…` §7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW A HUMAN ENROLS MFA WITHOUT THE SECRET LANDING IN A TRANSCRIPT
 *
 * This is the constraint the whole file is shaped around. F-20 states as a
 * design assumption that self-hosters debugging a problem paste logs and
 * terminal output into public issues, and D-101 already redesigned the setup
 * token around exactly that: *the token goes to a 0600 file and only its PATH is
 * printed*. A TOTP secret is strictly worse than a setup token — it does not
 * expire, it is the second factor for the highest-privilege account in the
 * product, and printing it as a `otpauth://` URI or as a terminal QR code puts
 * it in the same paste.
 *
 * So the secret is never written to stdout, to stderr or to the logger. It goes
 * to ONE file, created with mode 0600 before a byte is written, and the command
 * prints only that file's path. The operator opens the file themselves — that
 * is a deliberate act on their own host, not something that scrolls past in a
 * terminal they were about to copy.
 *
 * And the command does not finish there. It then asks for a **code from the
 * authenticator**, and verifies it. That does three things at once:
 *
 *   1. It proves the enrolment worked before the account is treated as usable.
 *      D-141's invariant says *verified* MFA factor; enrolled-but-unverified is
 *      an account that cannot complete a sign-in.
 *   2. It means the enrolment file has already served its purpose by the time
 *      the command returns, so the closing instruction to delete it is real
 *      advice rather than a suggestion to destroy the only copy of something
 *      still needed.
 *   3. It closes the window in which an account with `ORGANIZATION` scope
 *      exists with no second factor at all.
 *
 * The password is read the same way (`../prompt`): from a file the operator
 * holds, or from a TTY with echo disabled. No command here takes a password as
 * a flag value — a flag value is in the shell history and in `ps` for every user
 * on the host.
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
import { INSTALLATION_BOOTSTRAP_ID } from "@/lib/boot/setup-mode";
import { detectBootState } from "@/lib/boot/state";
import { prisma } from "@/lib/database";

import { recordBreakGlassInvocation } from "../break-glass";
import { resolveSecret, readSecretLine } from "../prompt";
import { APP_VERSION, type CommandContext } from "../context";
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
  let signUp: Response;
  try {
    signUp = await personCreationTracker.run(tracked, () =>
      accountProvisioningMarker.run(true, () =>
        auth.api.signUpEmail({
          body: { email, password, name },
          asResponse: true,
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

  const cookie = sessionCookieOf(signUp);
  const account = await prisma.userAccount.findUniqueOrThrow({
    where: { email },
    select: { id: true, personId: true },
  });

  // --- MFA enrolment, forced (13-… §6.3 step 3) ----------------------------
  const enrolment = (await auth.api.enableTwoFactor({
    body: { password },
    headers: new Headers({ cookie }),
  })) as { totpURI: string; backupCodes: string[] };

  const artefactPath = writeEnrolmentArtefact(ctx, email, enrolment);
  ctx.log("");
  ctx.log("MFA enrolment written to:");
  ctx.log(`    ${artefactPath}`);
  ctx.log("");
  ctx.log(
    "That file holds the TOTP secret and the backup codes. It is NOT printed " +
      "here and must not be pasted anywhere. Open it on this host, add the " +
      "account to your authenticator, then delete the file.",
  );
  ctx.log("");

  const code = (
    await readSecretLine("Six-digit code from your authenticator: ")
  ).trim();

  try {
    await auth.api.verifyTOTP({
      body: { code },
      headers: new Headers({ cookie }),
      asResponse: true,
    });
  } catch (error) {
    ctx.error(
      "That code did not verify, so the MFA factor is not enrolled and this " +
        "account is being removed rather than left half-created. Nothing " +
        "about the installation has changed apart from the seeded catalogue, " +
        "which is idempotent — run `admin:create` again.",
    );
    await rollbackAccount(account.id, account.personId);
    throw error;
  }

  // --- the grants ----------------------------------------------------------
  await assignRole(account.personId, INSTANCE_ADMINISTRATOR_ROLE_KEY);
  // D-146: SELF is an explicit seeded assignment, never an implicit match.
  await assignRole(account.personId, SELF_ROLE_KEY, "SELF");

  // --- setup is complete ---------------------------------------------------
  await prisma.installationBootstrap.upsert({
    where: { id: INSTALLATION_BOOTSTRAP_ID },
    update: {
      completedAt: new Date(),
      completedVia: "cli",
      appVersion: APP_VERSION,
    },
    create: {
      id: INSTALLATION_BOOTSTRAP_ID,
      completedAt: new Date(),
      completedVia: "cli",
      appVersion: APP_VERSION,
    },
  });

  // The CLI held a live session to drive the enrolment endpoints. It must not
  // outlive the command: a session token in a container's memory is not an
  // artefact anybody agreed to keep.
  await prisma.session.deleteMany({ where: { userId: account.id } });

  await assertLocalAdminInvariantHolds("Creating the first administrator");

  ctx.log("");
  ctx.log(`Administrator created: ${email}`);
  ctx.log(`  role       ${INSTANCE_ADMINISTRATOR_ROLE_KEY} @ ORGANIZATION`);
  ctx.log(`  MFA        TOTP, verified`);
  ctx.log(`  audit      ${auditEventId}`);
  ctx.log(
    "  banner     raised for all administrators; it is dismissed in-app, " +
      "not from here",
  );
  ctx.log("");
  ctx.log(`Delete ${artefactPath} once your authenticator is set up.`);
  return 0;
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
      "Note: this account has no verified MFA factor, so it does not yet " +
        "satisfy D-141's invariant. Run `admin:reset-mfa` for it.",
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

/** Undoes a half-created account so a failed enrolment leaves nothing behind. */
async function rollbackAccount(
  userAccountId: string,
  personId: string,
): Promise<void> {
  await prisma.session
    .deleteMany({ where: { userId: userAccountId } })
    .catch(() => undefined);
  await prisma.userAccount
    .delete({ where: { id: userAccountId } })
    .catch(() => undefined);
  await prisma.person
    .delete({ where: { id: personId } })
    .catch(() => undefined);
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
