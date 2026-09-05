/**
 * Browser MFA enrolment (D-185): the artefact, the secrecy, and the moment
 * setup completes.
 *
 * `mfa-pending-gate.test.ts` proves what an unenrolled account may and may not
 * do. This file proves the enrolment itself is a real, usable one:
 *
 *   • the QR code decodes back to the exact `otpauth://` URI Better Auth
 *     minted — with an INDEPENDENT decoder, so the encoder is not marking its
 *     own homework;
 *   • the typeable key is the same secret, so somebody who cannot scan enrols
 *     the same factor;
 *   • the secret reaches the logs zero times, which is the requirement that
 *     made the CLI flow the shape it was;
 *   • setup completes exactly when D-141's invariant first holds, and not
 *     before.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import jsQR from "jsqr";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountProvisioningMarker, auth } from "@/lib/auth";
import { renderTotpEnrolment } from "@/lib/auth/totp-qr";
import { countLocalOrganizationAdmins } from "@/lib/auth/local-admin-invariant";
import {
  completeSetupIfInvariantHolds,
  INSTALLATION_BOOTSTRAP_ID,
  isSetupIncomplete,
  resetSetupModeLatch,
  resolveSetupStage,
} from "@/lib/boot";
import { prisma } from "@/lib/database";

import { disconnectRoleClients, ownerClient } from "../support/database-roles";
import { SECRET_MARKER } from "../support/mfa-enrolment-log-marker";

const owner = ownerClient();

const EMAIL = "mfa-enrolment@example.invalid";
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await disconnectRoleClients();
});

/** Everything this file writes outside a throwaway account, prefixed so it goes. */
const PREFIX = "d185fx";

async function deleteProbeAccounts(): Promise<void> {
  for (const email of [EMAIL, "mfa-log-probe@example.invalid"]) {
    const account = await prisma.userAccount.findUnique({
      where: { email },
      select: { id: true, personId: true },
    });
    if (!account) continue;
    await prisma.roleAssignment.deleteMany({
      where: { personId: account.personId },
    });
    await prisma.userAccount.delete({ where: { id: account.id } });
    await prisma.person.delete({ where: { id: account.personId } });
  }

  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: PREFIX } },
  });
  await prisma.role.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.permission.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await deleteProbeAccounts();
  await prisma.installationBootstrap.deleteMany({});
  resetSetupModeLatch();
});

afterEach(async () => {
  await deleteProbeAccounts();
  await prisma.installationBootstrap.deleteMany({});
  resetSetupModeLatch();
  await owner.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent"');
});

// ── the artefact ─────────────────────────────────────────────────────────────

/**
 * Rasterises the SVG path into the grayscale-ish RGBA buffer `jsQR` expects.
 *
 * The path is one 1×1 sub-path per dark module (see `@/lib/auth/totp-qr`), so
 * the module grid is recoverable exactly, with no image library involved: parse
 * the `M<x>,<y>` pairs back into coordinates and paint them. That keeps the
 * decode honest — it reads the geometry the browser would draw, not a matrix
 * handed to it.
 */
function rasterise(
  qrPath: string,
  qrSize: number,
  scale = 4,
): { data: Uint8ClampedArray; width: number; height: number } {
  const width = qrSize * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);

  for (const match of qrPath.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    const moduleX = Number(match[1]);
    const moduleY = Number(match[2]);
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const offset =
          ((moduleY * scale + dy) * width + (moduleX * scale + dx)) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }

  return { data, width, height: width };
}

describe("the enrolment artefact", () => {
  const URI =
    "otpauth://totp/SplashTrack:beheerder%40example.org" +
    "?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DP&issuer=SplashTrack" +
    "&digits=6&period=30";

  it("renders a QR code an independent decoder reads back exactly", () => {
    const { qrPath, qrSize } = renderTotpEnrolment(URI);
    const image = rasterise(qrPath, qrSize);

    const decoded = jsQR(image.data, image.width, image.height);
    expect(decoded).not.toBeNull();
    expect(decoded!.data).toBe(URI);
  });

  it("offers the same secret as a key somebody can type", () => {
    const { manualKey } = renderTotpEnrolment(URI);
    // Grouped for transcription; the groups are presentation, so they come out
    // again before the comparison.
    expect(manualKey.replace(/ /g, "")).toBe(
      new URL(URI).searchParams.get("secret"),
    );
    expect(manualKey).toMatch(/^(\w{4} )*\w{1,4}$/);
  });

  it("refuses a URI carrying no secret rather than rendering a useless code", () => {
    expect(() => renderTotpEnrolment("otpauth://totp/SplashTrack:x")).toThrow(
      /secret/,
    );
  });
});

// ── the secret never reaches a log ───────────────────────────────────────────

describe("the TOTP secret and application logs", () => {
  it(
    "appears zero times in everything the application emits",
    { timeout: 120_000 },
    () => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
          path.resolve(
            process.cwd(),
            "tests/support/mfa-enrolment-log-probe.ts",
          ),
        ],
        {
          env: { ...process.env },
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        },
      );

      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(result.status, output).toBe(0);

      const [applicationOutput, harnessLine] = output.split(SECRET_MARKER);
      expect(
        harnessLine,
        "the probe did not reach its final line",
      ).toBeTruthy();

      const { key, encoded, backupCodes } = JSON.parse(
        harnessLine.trim().split("\n")[0],
      ) as { key: string; encoded: string; backupCodes: string[] };

      // The probe really did enrol — otherwise "the secret is absent" would be
      // true of a run that never minted one.
      expect(key.length).toBeGreaterThan(16);
      expect(applicationOutput.length).toBeGreaterThan(0);
      expect(applicationOutput).toContain("audit.recorded");

      // Both spellings: the raw key, and the base32 form the URI carries.
      expect(applicationOutput).not.toContain(key);
      expect(applicationOutput).not.toContain(encoded);
      expect(applicationOutput).not.toContain("otpauth://");
      for (const backupCode of backupCodes) {
        expect(applicationOutput).not.toContain(backupCode);
      }
    },
  );
});

// ── setup completes when the invariant first holds ───────────────────────────

/**
 * The account `admin:create` now leaves behind: password, grants, no factor.
 *
 * IT DOES NOT CALL `seedInstallation()`, and that is not a shortcut. The seed
 * writes the WHOLE permission catalogue keyed by `Permission.key`, while
 * `tests/support/authorization-fixtures.ts` upserts permissions by ID — so a
 * seeded `roles.assign` row surviving this file makes every other integration
 * file fail on the unique key. `local-admin-invariant.test.ts` records the same
 * trap. So this builds only what `countLocalOrganizationAdmins` actually reads:
 * one role carrying `roles.assign`, at ORGANIZATION scope.
 */
async function createPendingAdministrator(): Promise<{ cookie: string }> {
  await accountProvisioningMarker.run(true, () =>
    auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: "Eerste Beheerder" },
      asResponse: true,
    }),
  );

  const account = await prisma.userAccount.findUniqueOrThrow({
    where: { email: EMAIL },
    select: { personId: true },
  });
  const role = await prisma.role.create({
    data: { id: `${PREFIX}_role`, key: `${PREFIX}_admin`, name: "Admin" },
    select: { id: true },
  });
  // Reuse an existing `roles.assign` row when one is there; create it under
  // THIS file's prefix otherwise, so `cleanUp` takes it away again.
  const existingPermission = await prisma.permission.findUnique({
    where: { key: "roles.assign" },
    select: { id: true },
  });
  const permissionId =
    existingPermission?.id ??
    (
      await prisma.permission.create({
        data: { id: `${PREFIX}_roles_assign`, key: "roles.assign" },
        select: { id: true },
      })
    ).id;
  await prisma.rolePermission.create({
    data: { roleId: role.id, permissionId },
  });

  await prisma.roleAssignment.create({
    data: {
      personId: account.personId,
      roleId: role.id,
      scopeType: "ORGANIZATION",
      scopeId: null,
      validUntil: null,
      grantedByPersonId: null,
    },
  });

  const signIn = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  return {
    cookie: signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}

describe("setup is not complete while the only administrator is mfa_pending", () => {
  it("reports the pending stage, and refuses to write the bootstrap record", async () => {
    await createPendingAdministrator();

    // D-141's invariant does NOT hold: the account is local and
    // ORGANIZATION-scoped, but no factor has been verified.
    expect(await countLocalOrganizationAdmins()).toBe(0);

    expect(await resolveSetupStage()).toBe("ADMINISTRATOR_PENDING_MFA");
    expect(await completeSetupIfInvariantHolds("test")).toBe(false);
    await expect(
      prisma.installationBootstrap.findUnique({
        where: { id: INSTALLATION_BOOTSTRAP_ID },
      }),
    ).resolves.toBeNull();
  });

  it("completes the instant a real code verifies the factor", async () => {
    // ALSO THE "NO RESTART REQUIRED" PROOF (D-186). Every stage below is read
    // in ONE process, and `resetSetupModeLatch()` is never called after the
    // `beforeEach` hook — so the answers change because this module re-reads
    // the database, not because anything restarted. That is exactly what
    // `setup:init` and `admin:create` now promise the operator in their closing
    // message, and it is the half of 2026-09-04's incident that turned out to
    // be working: what went stale was the container's boot decision and its
    // start-up log, never the page it served.
    const { cookie } = await createPendingAdministrator();
    const headers = new Headers({ cookie });

    // The UNFINISHED answer is deliberately never cached — it is the one that
    // changes — so it reads `true` here and `false` after verification below.
    expect(await isSetupIncomplete()).toBe(true);

    const enrolment = (await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers,
    })) as { totpURI: string; backupCodes: string[] };

    // Still pending: enrolled is not verified.
    expect(await completeSetupIfInvariantHolds("test")).toBe(false);
    expect(await resolveSetupStage()).toBe("ADMINISTRATOR_PENDING_MFA");

    const key = new TextDecoder().decode(
      base32.decode(new URL(enrolment.totpURI).searchParams.get("secret")!),
    );
    await auth.api.verifyTOTP({
      body: { code: await createOTP(key).totp() },
      headers,
      asResponse: true,
    });

    expect(await countLocalOrganizationAdmins()).toBe(1);
    expect(await completeSetupIfInvariantHolds("test")).toBe(true);
    expect(await resolveSetupStage()).toBe("COMPLETE");
    // Same process, no latch reset: the served answer moved on its own.
    expect(await isSetupIncomplete()).toBe(false);

    const record = await prisma.installationBootstrap.findUniqueOrThrow({
      where: { id: INSTALLATION_BOOTSTRAP_ID },
    });
    expect(record.completedAt).not.toBeNull();
    expect(record.completedVia).toBe("browser");

    // Idempotent: a second call does not rewrite a record already written.
    expect(await completeSetupIfInvariantHolds("test")).toBe(false);
  });

  it("repairs a factor verified without the record ever being written", async () => {
    // THE GAP THIS CLOSES, found by walking the path on UAT rather than by
    // reading the code. `verifyEnrolment` flips the factor and THEN writes the
    // record, and those two cannot be one transaction — the flip belongs to
    // Better Auth. Anything landing between them leaves an installation that is
    // enrolled with no completed record, and the boot state machine reads that
    // as TAMPERED on the next restart, correctly: it cannot tell it apart from
    // somebody deleting the record on a live installation.
    //
    // Inside a request the ambiguity does not exist, so the serving path
    // repairs it. Simulated exactly as it happens: verify the factor, then
    // remove the record, which is the same observable state as never having
    // written it.
    const { cookie } = await createPendingAdministrator();
    const headers = new Headers({ cookie });

    const enrolment = (await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers,
    })) as { totpURI: string };
    const key = new TextDecoder().decode(
      base32.decode(new URL(enrolment.totpURI).searchParams.get("secret")!),
    );
    await auth.api.verifyTOTP({
      body: { code: await createOTP(key).totp() },
      headers,
      asResponse: true,
    });
    expect(await completeSetupIfInvariantHolds("test")).toBe(true);

    // The state the walkthrough produced: enrolled, and no record.
    await prisma.installationBootstrap.deleteMany({});
    resetSetupModeLatch();
    expect(await isSetupIncomplete()).toBe(true);

    // One page load is the whole repair.
    expect(await resolveSetupStage()).toBe("COMPLETE");
    const record = await prisma.installationBootstrap.findUniqueOrThrow({
      where: { id: INSTALLATION_BOOTSTRAP_ID },
    });
    expect(record.completedAt).not.toBeNull();

    // And it does NOT fire for an account that has not enrolled — the repair
    // is D-141's invariant, not "an account exists".
    await prisma.installationBootstrap.deleteMany({});
    await prisma.twoFactor.deleteMany({});
    await prisma.userAccount.updateMany({ data: { twoFactorEnabled: false } });
    resetSetupModeLatch();
    expect(await resolveSetupStage()).toBe("ADMINISTRATOR_PENDING_MFA");
    await expect(
      prisma.installationBootstrap.findUnique({
        where: { id: INSTALLATION_BOOTSTRAP_ID },
      }),
    ).resolves.toBeNull();
  });
});
