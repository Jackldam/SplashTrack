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
