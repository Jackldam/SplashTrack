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
 * `PersonQualification` grants no longer go through this script — the
 * person page's "Bevoegdheden" section (`grantQualificationAction`) is a
 * real, browser-reachable screen now, and the specs that used to call a
 * `grant-qualification` command here drive that screen instead
 * (`grantQualificationViaUI`, `e2e-common.ts`).
 *
 * Usage (run from the repo root, with `.env.e2e` already sourced into the
 * shell — see `tests/e2e/group-course-level.spec.ts`'s own header):
 *
 *   npx tsx tests/e2e/support/provision-persona.ts create-account \
 *     --email a@example.invalid --name "A B" --password '...' \
 *     --permissions assessment.read,assessment.record
 *
 * Prints one JSON line on stdout and nothing else, so a caller can
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

/** Like {@link flag}, but returns `undefined` when the flag is absent. */
function optionalFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || !process.argv[idx + 1]) return undefined;
  return process.argv[idx + 1];
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
  // ORGANIZATION scope, no `scopeId`, is the DEFAULT — the broadest grant,
  // deliberately: what most specs' refusal cases depend on is the ABSENCE of
  // a specific permission (e.g. `assessment.independence.override`) or the
  // presence of a domain relation (an `InstructorAssignment`), never a
  // narrower scope type. `skills-progress.spec.ts`'s D-145 rule 2 case is the
  // first spec that genuinely needs a real `GROUP`-scoped grant (not merely a
  // restricted ORGANIZATION one) — that reach only resolves, per
  // `resolveReach`, when this RoleAssignment's `scopeId` names a group the
  // account ALSO holds an active `InstructorAssignment` for, so callers pass
  // `--scope-type GROUP --scope-id <groupId>` and still assign the
  // instructor through the real "Lesgever toewijzen" screen themselves.
  const scopeType = optionalFlag("scope-type") ?? "ORGANIZATION";
  const scopeId = optionalFlag("scope-id") ?? null;
  await prisma.roleAssignment.create({
    data: {
      personId: account.personId,
      roleId,
      scopeType: scopeType as
        "ORGANIZATION" | "UNIT" | "GROUP" | "COURSE" | "SESSION",
      scopeId,
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

/**
 * Adds a SECOND `RoleAssignment` — with its own scope type — to an ACCOUNT
 * `create-account` already provisioned. Needed by
 * `skills-progress.spec.ts`'s D-145 rule 2 scenario: `getPersonForPrincipal`
 * (`/people/[personId]`'s own top-level guard) checks `{ person: personId }`,
 * which a `GROUP`-scoped reach never covers at all (`coversResource`'s
 * `GROUPS` case returns `false` for a `person` ref, deliberately — "never
 * upward", `covers-resource.ts`'s own comment). So a persona that needs to
 * open the page AND be genuinely `GROUP`-scoped for the read this test
 * narrows (`skills.read`, `getSkillProgressForStudent`) needs two grants: an
 * `ORGANIZATION`-scoped one for `people.read` (to reach the page), and a
 * `GROUP`-scoped one for `skills.read` (so `getSkillProgressForStudent`'s own
 * `requirePermission` resolves a `GROUP` reach specifically, the one variant
 * `skillProgressFilterForReach` narrows). One role, one more
 * `RoleAssignment` — the account itself and its first role are untouched.
 *
 *   npx tsx tests/e2e/support/provision-persona.ts grant-role \
 *     --person-id <id> --permissions people.read \
 *     --scope-type ORGANIZATION
 */
async function grantRole(): Promise<void> {
  const personId = flag("person-id");
  const permissions = flag("permissions")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const scopeType = optionalFlag("scope-type") ?? "ORGANIZATION";
  const scopeId = optionalFlag("scope-id") ?? null;

  const roleId = `e2ewt_role2_${personId}`;
  await prisma.role.create({
    data: {
      id: roleId,
      key: roleId,
      name: `e2e persona extra role: ${personId}`,
    },
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
  await prisma.roleAssignment.create({
    data: {
      personId,
      roleId,
      scopeType: scopeType as
        "ORGANIZATION" | "UNIT" | "GROUP" | "COURSE" | "SESSION",
      scopeId,
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validUntil: null,
    },
  });

  process.stdout.write(JSON.stringify({ personId, roleId }) + "\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "create-account") {
    await createAccount();
  } else if (command === "grant-role") {
    await grantRole();
  } else {
    throw new Error(
      `Unknown command "${command}". Use "create-account" or "grant-role".`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
