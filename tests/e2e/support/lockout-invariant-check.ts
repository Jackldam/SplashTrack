/**
 * D-141 verification helper for `settings-diagnostics.spec.ts`.
 *
 * WHY A SCRIPT, NOT A BROWSER ACTION. There is no role-revocation or
 * account-disable screen anywhere in this build (`src/app` has no such
 * route — People & roles is a different, unbuilt feature) and, more
 * fundamentally, a genuine "D-141 refuses a settings write" browser scenario
 * cannot be constructed for ANY actor who can reach `/admin/settings` at
 * all: reaching that screen already requires holding
 * `organization.settings.manage` at `ORGANIZATION` scope AND a verified MFA
 * factor (`requireEnrolledSession`) — which are exactly the two facts D-141's
 * invariant checks for. The acting admin's own valid session is therefore
 * always itself a qualifying account, so the database-wide check can never
 * read zero while they are the one submitting the request. This is a
 * SAFETY property, not a gap — see the phase report for the full argument.
 *
 * What this script verifies instead, directly against the same scratch
 * database the browser-driven scenarios in the spec use: that
 * `updateSetting` genuinely refuses an Authentication/Security write once the
 * database's qualifying-account count is actually zero, and genuinely allows
 * one once it is not — the two settings-write scenarios D-141 names,
 * exercised against the real database rather than mocked.
 *
 * Usage: `npx tsx tests/e2e/support/lockout-invariant-check.ts <email>` — the
 * account email of an ORGANIZATION-scoped `organization.settings.manage`
 * holder whose account currently has NO verified MFA factor (a role the
 * script itself does not create; the spec sets that up first). Prints
 * `REFUSED` or `ALLOWED` on stdout.
 */
import { prisma } from "@/lib/database";
import {
  updateSetting,
  LockoutInvariantViolationError,
} from "@/modules/settings";

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: lockout-invariant-check.ts <email>");

  const account = await prisma.userAccount.findUniqueOrThrow({
    where: { email },
    select: { personId: true },
  });
  const personId = account.personId;

  try {
    await updateSetting({
      principal: { personId },
      key: "authentication.passwordMinLength",
      value: 14,
    });
    console.log("ALLOWED");
  } catch (error) {
    if (error instanceof LockoutInvariantViolationError) {
      console.log("REFUSED");
      return;
    }
    throw error;
  }
}

main();
