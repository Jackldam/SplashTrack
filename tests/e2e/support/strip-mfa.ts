/**
 * Marks every `TwoFactor` factor on an account as unverified — simulating an
 * out-of-band factor loss (a reset TOTP, an uninstalled authenticator app)
 * for `settings-diagnostics.spec.ts`'s D-141 scenarios. No UI performs this;
 * see `lockout-invariant-check.ts`'s header for why a script is the honest
 * way to reach this state at all.
 *
 * Usage: `npx tsx tests/e2e/support/strip-mfa.ts <email>`
 */
import { prisma } from "@/lib/database";

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: strip-mfa.ts <email>");

  const account = await prisma.userAccount.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  await prisma.twoFactor.updateMany({
    where: { userId: account.id },
    data: { verified: false },
  });
  console.log("STRIPPED");
}

main();
