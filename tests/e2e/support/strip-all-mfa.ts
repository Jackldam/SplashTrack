/**
 * Marks EVERY `TwoFactor` factor in the database as unverified — the
 * "genuinely zero qualifying accounts anywhere" precondition
 * `settings-diagnostics.spec.ts`'s D-141 REFUSED scenario needs. Earlier
 * tests in the same spec file each enrol their own admin (D-185: one
 * enrolment per account, so each test needs a fresh one), and those earlier
 * admins' factors are still verified when the D-141 test runs — this script
 * is what makes the whole-database count actually zero, rather than the
 * D-141 test having to track and individually strip every account every
 * earlier test in the file happened to create.
 *
 * Usage: `npx tsx tests/e2e/support/strip-all-mfa.ts`
 */
import { prisma } from "@/lib/database";

async function main(): Promise<void> {
  await prisma.twoFactor.updateMany({ data: { verified: false } });
  console.log("STRIPPED_ALL");
}

main();
