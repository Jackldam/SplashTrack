/**
 * Provisions the ONE thing the two e2e specs in this directory need that
 * neither the CLI (`splashtrack admin:create` — always the full
 * `instance_administrator` role) nor any screen in the product can do: a
 * second, RESTRICTED account, holding exactly the permissions a test needs
 * and none of the ones it exists to prove are refused.
 *
 * WHY THIS IS A SCRIPT, NOT A UI FLOW. There is no `/roles` or `/users`
 * screen anywhere in this build (`src/app` has no such route) — provisioning
 * a non-administrator account with a hand-picked permission set is simply not
 * a browser-reachable act yet. The assessment and exams phase reports both
 * describe doing exactly this from a throwaway script for their own
 * mandatory browser verification (`docs/build/phase-2.3-assessment-report.md`
 * §1.10, `docs/build/phase-2.4-exams-report.md` §1.8) — this file is the
 * same pattern, kept around because these specs need it every run rather
 * than once.
 *
 * `grant-qualification` exists for the identical reason at a smaller scale:
 * `grantQualificationAction` (`src/app/exams/actions.ts`) is wired to no form
 * anywhere in `src/app` — a genuine gap, flagged in the e2e report this
 * script's specs belong to, not silently worked around here. `PersonQualification`
 * rows are written directly, the same shape `tests/support/exams-fixtures.ts`
 * writes them for the vitest suite.
 *
 * Usage (run from the repo root, with `.env.e2e` already sourced into the
 * shell — see `tests/e2e/group-course-level.spec.ts`'s own header):
 *
 *   npx tsx tests/e2e/support/provision-persona.ts create-account \
 *     --email a@example.invalid --name "A B" --password '...' \
 *     --permissions assessment.read,assessment.record
 *
 *   npx tsx tests/e2e/support/provision-persona.ts grant-qualification \
 *     --personId <id> --type INSTRUCTEUR_ZWEMMEN
 *
 * Both print one JSON line on stdout and nothing else, so a caller can
 * `JSON.parse` it directly — the `execFileSync` convention the existing specs
 * already use for `admin:create`'s own stdout-is-a-contract commands.
 */
import {
  accountProvisioningMarker,
  auth,
  personCreationTracker,
} from "@/lib/auth";
import { prisma } from "@/lib/database";
import type { PermissionKey } from "@/lib/authorization";

function flag(name: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || !process.argv[idx + 1]) {
    throw new Error(`Missing required --${name}`);
  }
  return process.argv[idx + 1]!;
}

async function createAccount(): Promise<void> {
  const email = flag("email");
  const name = flag("name");
  const password = flag("password");
  const permissions = flag("permissions")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

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

  // `--permissions ADMIN` is a sentinel: assign the ALREADY-SEEDED
  // `instance_administrator` role instead of a fresh one. This is what a
  // SECOND organisation administrator needs — `admin:create` itself refuses
  // once boot state has left EMPTY/PARTIAL (i.e. the moment the FIRST
  // administrator exists and is `mfa_pending`, `PENDING_ENROLMENT` is not
  // one of the states it tolerates), so a spec needing two full admins (one
  // per test, since MFA enrolment is one-time per account, D-185) provisions
  // the second one through this same mechanism rather than the CLI.
  let roleId: string;
  if (permissions.length === 1 && permissions[0] === "ADMIN") {
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { key: "instance_administrator" },
      select: { id: true },
    });
    roleId = adminRole.id;
  } else {
    // A dedicated role, one per account, named after the account itself so
    // cleanup (by personId prefix on the account's own email domain) is exact
    // and no two personas' permission sets can leak into each other by
    // sharing a role row.
    roleId = `e2ewt_role_${account.personId}`;
    await prisma.role.create({
      data: { id: roleId, key: roleId, name: `e2e persona: ${name}` },
    });
    for (const key of permissions as PermissionKey[]) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { key },
        select: { id: true },
      });
      await prisma.rolePermission.create({
        data: { roleId, permissionId: permission.id },
      });
    }
  }
  // ORGANIZATION scope, no `scopeId` — the broadest grant, deliberately: what
  // each spec's refusal case depends on is the ABSENCE of a specific
  // permission (e.g. `assessment.independence.override`) or the presence of
  // a domain relation (an `InstructorAssignment`), never a narrower scope
  // type. A `SESSION`/`GROUP`-scoped variant of this same mechanism is real,
  // useful follow-up test coverage (matching the phase reports' own
  // scope-escape suites) but is not what either spec here is proving.
  await prisma.roleAssignment.create({
    data: {
      personId: account.personId,
      roleId,
      scopeType: "ORGANIZATION",
      scopeId: null,
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validUntil: null,
    },
  });

  // `signUpEmail` mints a session for the caller of THIS script, not for the
  // browser that will sign in and enrol MFA next — the same reasoning
  // `admin:create` states for doing the identical cleanup.
  await prisma.session.deleteMany({ where: { userId: account.id } });

  process.stdout.write(
    JSON.stringify({ personId: account.personId, email, roleId }) + "\n",
  );
}

async function grantQualification(): Promise<void> {
  const personId = flag("personId");
  const type = flag("type");
  const row = await prisma.personQualification.create({
    data: {
      personId,
      type,
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validTo: null,
    },
    select: { id: true },
  });
  process.stdout.write(JSON.stringify({ qualificationId: row.id }) + "\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "create-account") {
    await createAccount();
  } else if (command === "grant-qualification") {
    await grantQualification();
  } else {
    throw new Error(
      `Unknown command "${command}". Use "create-account" or "grant-qualification".`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
