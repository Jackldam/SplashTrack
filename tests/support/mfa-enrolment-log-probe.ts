/**
 * Runs one complete MFA enrolment in a CHILD PROCESS, so its logs can be read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE PROCESS
 *
 * The claim under test is *the TOTP secret appears zero times in application
 * logs*. Pino writes through `sonic-boom` straight to file descriptor 1, which
 * a `process.stdout.write` spy never sees — measured, not assumed. The only way
 * to read what the application actually emitted is to be its parent and read
 * the pipe, which is also exactly what `docker compose logs` does.
 *
 * THE OUTPUT CONTRACT. Everything before {@link SECRET_MARKER} is the
 * APPLICATION talking: pino lines, Prisma, anything at all. The one line after
 * it is this harness handing the parent the secret to search for, and it is
 * written last, deliberately — the parent splits there and asserts the secret
 * is absent from everything above.
 *
 * Nothing here logs the secret itself. It is obtained from the `otpauth://`
 * URI, used to generate one code, and printed once on the marked line.
 */

import path from "node:path";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { config as loadEnv } from "dotenv";

import { SECRET_MARKER } from "./mfa-enrolment-log-marker";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

const EMAIL = "mfa-log-probe@example.invalid";
const PASSWORD = "correct-horse-battery-staple";

async function main(): Promise<void> {
  // Imported AFTER `.env` and the pinned DATABASE_URL are in place: both
  // modules resolve their connection at import time.
  const { accountProvisioningMarker, auth } = await import("@/lib/auth");
  const { renderTotpEnrolment } = await import("@/lib/auth/totp-qr");
  const { prisma } = await import("@/lib/database");

  const existing = await prisma.userAccount.findUnique({
    where: { email: EMAIL },
    select: { id: true, personId: true },
  });
  if (existing) {
    await prisma.userAccount.delete({ where: { id: existing.id } });
    await prisma.person.delete({ where: { id: existing.personId } });
  }

  await accountProvisioningMarker.run(true, () =>
    auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: "Log Probe" },
      asResponse: true,
    }),
  );

  const signIn = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const headers = new Headers({ cookie });

  const enrolment = (await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers,
  })) as { totpURI: string; backupCodes: string[] };

  // The renderer runs too: it is the one piece of application code that HOLDS
  // the secret in order to draw it, so a stray log line there is exactly the
  // regression this probe exists to catch.
  renderTotpEnrolment(enrolment.totpURI);

  const encoded = new URL(enrolment.totpURI).searchParams.get("secret") ?? "";
  const key = new TextDecoder().decode(base32.decode(encoded));

  await auth.api.verifyTOTP({
    body: { code: await createOTP(key).totp() },
    headers,
    asResponse: true,
  });

  const account = await prisma.userAccount.findUnique({
    where: { email: EMAIL },
    select: { id: true, personId: true },
  });
  if (account) {
    await prisma.userAccount.delete({ where: { id: account.id } });
    await prisma.person.delete({ where: { id: account.personId } });
  }
  await prisma.$disconnect();

  // Flush every pino line before the marker is written, so the split is
  // honest: an unflushed buffer emptying after the marker would put
  // application output on the wrong side of it.
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.stdout.write(
    `\n${SECRET_MARKER}\n${JSON.stringify({ key, encoded, backupCodes: enrolment.backupCodes })}\n`,
  );
}

void main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`probe failed: ${(error as Error).message}\n`);
    process.exit(1);
  },
);
