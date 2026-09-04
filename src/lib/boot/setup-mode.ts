/**
 * "Has first-run setup completed?" — the serving-time half of the boot state
 * machine.
 *
 * WHY THIS IS SEPARATE FROM `detectBootState`. The state machine decides ONCE,
 * in the entrypoint, what the container may do to the database — migrate, serve,
 * or refuse. This question is asked PER REQUEST, because setup completes while
 * the process is already running: `splashtrack admin:create` writes the
 * `InstallationBootstrap` record from the host into the same database the live
 * server is reading, and the server must notice without a restart.
 *
 * The latch is what makes that cheap. Setup completion is MONOTONIC — the record
 * is written once and never unwritten by any code path in this repository — so
 * the completed answer is cached forever and the query stops. The incomplete
 * answer is never cached: that is the state that changes.
 *
 * THE WIZARD IS NOT HERE. D-039's in-app setup wizard is phase 1; what setup
 * mode serves today is a page naming the two host commands that complete setup
 * (`13-…` §6.3 step 0's "new installation" branch, driven from the host rather
 * than from a browser, on the same host-access-is-proof-of-ownership pattern
 * D-101 and §7 already rest on). When the wizard arrives it replaces that page
 * and this module is what gates it.
 *
 * SERVER-ONLY, Node runtime — it reads the database, so it can never be called
 * from `middleware.ts`, which runs on the Edge runtime.
 */

import { APP_VERSION } from "@/lib/app-version";
import { countLocalOrganizationAdmins } from "@/lib/auth/local-admin-invariant";
import { prisma } from "@/lib/database";
import { logger } from "@/lib/logging";

/** The enforced-singleton id, pinned by a CHECK constraint in the migration. */
export const INSTALLATION_BOOTSTRAP_ID = "installation";

/**
 * Latched once setup has completed. Never reset by application code: unsetting
 * it would mean an installation that has been set up can go back to serving an
 * unauthenticated administrative surface, which is exactly what D-099 forbids.
 */
let completedLatch = false;

/**
 * True while first-run setup has not completed. Deny-by-default on error: if the
 * database cannot be read we report "not set up", which serves the setup notice
 * rather than the portal. That is the safe direction — the alternative is
 * serving an application whose authorization tables may not exist.
 */
export async function isSetupIncomplete(): Promise<boolean> {
  if (completedLatch) return false;
  try {
    const record = await prisma.installationBootstrap.findFirst({
      where: { completedAt: { not: null } },
      select: { completedAt: true },
    });
    if (record) {
      completedLatch = true;
      return false;
    }
    return true;
  } catch (error) {
    logger.warn(
      { event: "boot.setup_state_unreadable", err: error },
      "could not read the installation bootstrap record; treating the " +
        "installation as not yet set up",
    );
    return true;
  }
}

/** TEST SEAM ONLY — drops the latch so a test can observe both answers. */
export function resetSetupModeLatch(): void {
  completedLatch = false;
}

/**
 * WHERE setup has got to — three answers, not two (D-185).
 *
 * `isSetupIncomplete()` above collapses this to a boolean for the callers that
 * only need "portal, or notice". This is what the NOTICE itself needs, because
 * since D-185 there are two different unfinished states with two different
 * remedies, and telling an operator to run `admin:create` when they have
 * already run it is worse than saying nothing.
 *
 *   `NO_ADMINISTRATOR`            nothing has been created. Run `admin:create`.
 *   `ADMINISTRATOR_PENDING_MFA`   an account exists and has not enrolled its
 *                                 second factor. Sign in and finish; setup is
 *                                 NOT complete until then, and D-141's
 *                                 invariant does not yet bind (see
 *                                 `../auth/local-admin-invariant.ts`).
 *   `COMPLETE`                    the bootstrap record is written.
 *
 * The middle state is decided by "does any account exist at all" rather than by
 * inspecting grants and factors, and that is exact in v1 rather than
 * approximate: `enforceServerSideSignUpOnly` means `admin:create` is the ONLY
 * way an account comes into existence, and setup is not complete, so the only
 * account that can exist is the first administrator, unenrolled. When the
 * `users` module can provision accounts, that will be after setup completed —
 * this function's answer is latched by then.
 */
export type SetupStage =
  "COMPLETE" | "NO_ADMINISTRATOR" | "ADMINISTRATOR_PENDING_MFA";

export async function resolveSetupStage(): Promise<SetupStage> {
  if (!(await isSetupIncomplete())) return "COMPLETE";
  try {
    const accounts = await prisma.userAccount.count();
    if (accounts === 0) return "NO_ADMINISTRATOR";

    // ── THE REPAIR, and why it belongs on a read path (D-186) ───────────────
    //
    // `verifyEnrolment` flips the factor and THEN writes the record, in two
    // steps that are not one transaction — they cannot be, because the flip
    // belongs to Better Auth. If anything comes between them, the installation
    // is left enrolled with no completed record: a state the boot state machine
    // reads as TAMPERED, because on a restart it genuinely cannot tell that
    // apart from somebody deleting the record on a live installation. So the
    // administrator finishes enrolling, and the next restart refuses to serve.
    //
    // Measured, not imagined: reached during the phase 1.4 walkthrough by
    // verifying a factor through the same endpoint the Server Action calls and
    // not reaching the line after it.
    //
    // Here — inside a request, before any restart — the ambiguity does not
    // exist. `countLocalOrganizationAdmins()` is D-141's invariant, and an
    // installation where it holds IS set up, whatever the record says. So the
    // record is written and the answer is COMPLETE.
    //
    // A WRITE ON A READ PATH, DELIBERATELY AND ONCE. It is reachable only while
    // setup is incomplete — the completed answer is latched and never re-reads —
    // and `completeSetupIfInvariantHolds` is idempotent, so this costs one
    // additional query per request during setup and nothing at all afterwards.
    if (await completeSetupIfInvariantHolds(APP_VERSION)) {
      logger.warn(
        { event: "boot.setup_completion_repaired" },
        "a verified MFA factor existed with no completed bootstrap record; " +
          "setup has been recorded as complete",
      );
      return "COMPLETE";
    }

    return "ADMINISTRATOR_PENDING_MFA";
  } catch (error) {
    // Same deny-by-default direction as `isSetupIncomplete`: an unreadable
    // database serves the notice that asks for the FIRST administrator, which
    // is the state that reveals nothing about whether an account exists.
    logger.warn(
      { event: "boot.setup_stage_unreadable", err: error },
      "could not count accounts; reporting the earliest setup stage",
    );
    return "NO_ADMINISTRATOR";
  }
}

/**
 * Records that first-run setup has STARTED (D-186). Idempotent, and it never
 * touches `completedAt` — starting and finishing are different events and this
 * one must not be able to close setup mode.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN EMPTY ROW IS WORTH WRITING
 *
 * Before this, `InstallationBootstrap` held exactly one kind of row: a
 * completed one. So "setup is under way" and "somebody deleted the record to
 * reopen the unauthenticated setup surface" were the same observation — no row,
 * and data present — and D-099's predicate could only pick one reading. It
 * picked the safe one, and that is what refused to serve the enrolment page to
 * an administrator who had just been created.
 *
 * The row's EXISTENCE is the marker; `createdAt` is when. There is deliberately
 * no `startedAt` column: it would be a second copy of `createdAt`, free to
 * drift, on the one table the boot state machine reads on every start.
 *
 * WRITTEN BEFORE THE FIRST PERSON ROW, always. Both callers do it before they
 * create anything, so there is no window in which an installation holds data
 * without the record — which is the window that would look like tampering.
 */
export async function recordSetupStarted(): Promise<void> {
  await prisma.installationBootstrap.upsert({
    where: { id: INSTALLATION_BOOTSTRAP_ID },
    // An installation that already has a record — started or completed — is
    // left exactly as it is. Re-running `setup:init` must not restate anything.
    update: {},
    create: { id: INSTALLATION_BOOTSTRAP_ID },
  });
}

/**
 * Writes the bootstrap record — but only once the installation really is set
 * up, which since D-185 means D-141's invariant is satisfiable and satisfied.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `admin:create` NO LONGER DOES THIS
 *
 * It used to, because it also enrolled MFA, so by the time it returned there
 * was a local ORGANIZATION-scoped account with a verified factor and the
 * invariant held. It does not enrol any more (D-185), so an `admin:create` that
 * closed setup mode would latch "set up" over an installation whose only
 * administrator cannot yet prove a second factor — and the latch never reopens.
 *
 * So the record is written HERE, by the enrolment flow, at the instant the
 * invariant first holds. That is also what makes requirement 5 true rather than
 * merely displayed: setup is not complete while the only administrator is
 * `mfa_pending`, because nothing has written the record.
 *
 * Returns whether this call wrote it. Idempotent: an installation that is
 * already complete is left alone, and a caller that has not yet made the
 * invariant true writes nothing.
 */
export async function completeSetupIfInvariantHolds(
  appVersion: string,
): Promise<boolean> {
  const existing = await prisma.installationBootstrap.findFirst({
    where: { completedAt: { not: null } },
    select: { id: true },
  });
  if (existing) return false;

  if ((await countLocalOrganizationAdmins()) === 0) return false;

  await prisma.installationBootstrap.upsert({
    where: { id: INSTALLATION_BOOTSTRAP_ID },
    update: {
      completedAt: new Date(),
      completedVia: "browser",
      appVersion,
    },
    create: {
      id: INSTALLATION_BOOTSTRAP_ID,
      completedAt: new Date(),
      completedVia: "browser",
      appVersion,
    },
  });
  completedLatch = true;
  return true;
}
