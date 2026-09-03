/**
 * `boot:state` and `bootstrap:clear-tampered` — the two commands that speak
 * about the state machine rather than about accounts.
 *
 * `boot:state` is what `docker-entrypoint.sh` calls before it decides anything.
 * It prints ONE line on stdout, `<STATE> <ACTION>`, and the human explanation on
 * stderr, so the shell can branch on the first without losing the second.
 */

import {
  detectBootState,
  type BootDecision,
} from "@/lib/boot/state";
import { INSTALLATION_BOOTSTRAP_ID } from "@/lib/boot/setup-mode";
import { prisma } from "@/lib/database";

import { recordBreakGlassInvocation } from "../break-glass";
import { readLine } from "../prompt";
import { APP_VERSION, type CommandContext } from "../context";

export async function bootState(ctx: CommandContext): Promise<number> {
  const decision: BootDecision = await detectBootState();

  ctx.emit(`${decision.state} ${decision.action}`);
  ctx.log(`SplashTrack ${APP_VERSION} — boot state ${decision.state}`);
  ctx.log(`  ${decision.detail}`);

  // A REFUSE state is an exit code as well as a token, so a caller that
  // forgets to branch still fails rather than starting anyway.
  return decision.action === "REFUSE" ? 1 : 0;
}

/**
 * Clears `TAMPERED` (D-099) by writing the bootstrap record the installation is
 * missing, after the operator has said out loud that they know why it was gone.
 *
 * IT DOES NOT DELETE ANYTHING. `TAMPERED` means "there is data here and no
 * record that setup ever completed" — the dangerous reading is that somebody
 * removed the record to reopen the unauthenticated setup surface. The safe
 * repair is therefore to CLOSE setup mode, never to wipe the data that made the
 * state fire.
 */
export async function bootstrapClearTampered(
  ctx: CommandContext,
): Promise<number> {
  const decision = await detectBootState();
  if (decision.state !== "TAMPERED") {
    ctx.error(
      `This installation is ${decision.state}, not TAMPERED. Nothing to clear.`,
    );
    return 1;
  }

  ctx.log("");
  ctx.log(
    "This installation holds data but has no completed InstallationBootstrap " +
      "record. Clearing this state writes the record and closes setup mode. " +
      "It does not delete anything, and it does not explain how the record " +
      "went missing — a deleted row here is also what an attacker would " +
      "produce to reopen the unauthenticated setup surface (D-099, F-98). " +
      "Check the audit trail before continuing.",
  );
  ctx.log("");

  if (ctx.flags.yes !== "true") {
    const answer = (await readLine("Type CLEAR to continue: ")).trim();
    if (answer !== "CLEAR") {
      ctx.error("Aborted.");
      return 1;
    }
  }

  const { auditEventId } = await recordBreakGlassInvocation(
    "bootstrap:clear-tampered",
  );

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

  ctx.log(`TAMPERED cleared. Audit ${auditEventId}.`);
  return 0;
}
