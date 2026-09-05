/**
 * `setup:init` — the "New installation" branch of D-055's diagram, driven from
 * the host.
 *
 * The diagram's EMPTY branch reads: *run migrations → seed catalogue + starter
 * roles → create first administrator, force MFA → write bootstrap record →
 * serving*, and it puts the operator's answer to "new installation, or restore
 * from backup?" in a browser wizard (D-039). THAT WIZARD NOW EXISTS, at
 * `/setup`, and it is the front door (D-187). It runs the same two steps below,
 * in the same order, from a browser.
 *
 * These commands remain, as the host path for an operator who cannot use the
 * wizard — the same host-access-is-proof-of-ownership pattern §7 uses for every
 * other break-glass operation. They are not the documented first run any more,
 * and `admin:create` says so itself.
 *
 * `setup:token` at the bottom of this file is what ISSUES the wizard's
 * credential (D-101). It is the only command here that a normal first-run
 * install touches, and the entrypoint runs it automatically.
 *
 * The branch is split across two commands rather than guessed at:
 *
 *   `setup:init`    migrations + seed. Answers "new installation".
 *   `admin:create`  the administrator, forced MFA, and the bootstrap record
 *                   that closes setup mode.
 *
 * `admin:create` runs `setup:init`'s work itself if it has not been run, so the
 * two-step is a convenience for looking at a migrated database before creating
 * an account, not a sequence anybody can get wrong.
 *
 * IT REFUSES ON ANY STATE BUT `EMPTY` OR `PARTIAL`. Migrating is exactly what
 * D-055 forbids doing to a database whose purpose is not yet known, and
 * `setup:init` is the command that says "the purpose is: this is a new
 * installation". On `EXISTING` that answer is already known and the entrypoint
 * owns the migration; on `AHEAD`, `FAILED` or `TAMPERED` nothing may be written
 * at all.
 */

import { migrateAndApplyRoleModel as migrateSchemaAndGrants } from "@/lib/boot/migrate";
import { seedInstallation } from "@/lib/boot/seed";
import { recordSetupStarted } from "@/lib/boot/setup-mode";
import { detectBootState } from "@/lib/boot/state";
// The FILE and not the `@/lib/setup` barrel. The barrel re-exports
// `./wizard-session`, which imports `next/headers` — a module that has no
// meaning in a CLI process and no business being dragged into the esbuild
// bundle that `npm run build:cli` produces. `./token` imports `node:fs`,
// `node:crypto` and `./data-dir`, which is exactly what a command that must run
// on a database-less host can afford.
import {
  SETUP_TOKEN_TTL_MINUTES,
  ensureSetupToken,
  issueSetupToken,
  setupTokenStatus,
} from "@/lib/setup/token";

import type { CommandContext } from "../context";

export async function setupInit(ctx: CommandContext): Promise<number> {
  const decision = await detectBootState();

  if (decision.state !== "EMPTY" && decision.state !== "PARTIAL") {
    ctx.error(
      `This installation is ${decision.state}, not EMPTY or PARTIAL. ` +
        "`setup:init` declares a database to be a NEW installation and " +
        "migrates it; declaring that about a database which already has a " +
        "purpose is the thing D-055 exists to prevent.",
    );
    ctx.error(`  ${decision.detail}`);
    return 1;
  }

  ctx.log(`Boot state ${decision.state}: applying migrations…`);
  await migrateAndApplyRoleModel(ctx);

  // BEFORE the seed, and before anything else can write a row: the record that
  // says first-run setup is under way (D-186). Without it, the next command to
  // create a Person would leave an installation that holds data and has no
  // record setup ever started — which is what TAMPERED means.
  await recordSetupStarted();
  ctx.log("First-run setup recorded as started.");

  ctx.log("Seeding the permission catalogue and the system roles…");
  const seeded = await seedInstallation();
  ctx.log(
    `  ${seeded.permissions} permission(s), roles: ${seeded.roles.join(", ")}` +
      (seeded.organizationCreated ? ", organisation singleton created" : ""),
  );

  ctx.log("");
  ctx.log(
    "Setup is NOT complete: there is no administrator yet, so the " +
      "installation is still in setup mode. Finish with:",
  );
  ctx.log("");
  ctx.log("    splashtrack admin:create --email you@example.org");
  ctx.log("");
  await reportResultingBootState(ctx);
  return 0;
}

/**
 * What the running container will see now — printed by every command that
 * changes the database out from under it.
 *
 * THE DEFECT THIS CLOSES. `13-…` §7 tells the operator to run these commands as
 * `docker compose exec app splashtrack …`, which by definition runs BESIDE a
 * container that has already taken its boot decision. That decision is taken
 * once, at start, and after this command it is out of date: the log the
 * operator is looking at says `EMPTY — no migrations have been run`, and the
 * database it describes no longer exists. Nothing told them, so the natural
 * next move was to restart and find out — and finding out used to mean an
 * instance that refused to serve at all.
 *
 * Re-detecting and printing costs one short-lived connection and replaces a
 * guess with a fact. The serving side genuinely does re-read per request
 * (`resolveSetupStage` in `@/lib/boot/setup-mode.ts` — the completed answer is
 * latched, the unfinished one never is), so the honest message is that no
 * restart is needed AND that restarting is safe. Both halves matter: the first
 * stops a pointless restart, the second stops the fear of one.
 */
export async function reportResultingBootState(
  ctx: CommandContext,
): Promise<void> {
  const after = await detectBootState();
  ctx.log(`Boot state is now ${after.state} (${after.action}).`);
  ctx.log(`  ${after.detail}`);
  ctx.log("");
  ctx.log(
    "The running container does NOT need restarting: it re-reads how far " +
      "setup has got on every request, so the page it serves is already the " +
      "one above. Its START-UP LOG is now out of date — that is expected, and " +
      "it is not evidence of a problem. Restarting is safe and lands in the " +
      "same state.",
  );
  ctx.log("");
}

/**
 * Migrates and re-applies the ADR-0002 role model, with the CLI's narration
 * attached.
 *
 * THE SEQUENCE ITSELF LIVES IN `@/lib/boot/migrate.ts` and no longer here. It
 * gained a second caller with D-187 — the `/setup` wizard runs exactly these
 * two steps when the operator answers "this is a new installation" in a browser
 * — and a Server Action reaching into `src/cli` would be the wrong direction
 * for the dependency as well as a second copy of a sequence that must never
 * come apart.
 */
export async function migrateAndApplyRoleModel(
  ctx: CommandContext,
): Promise<void> {
  await migrateSchemaAndGrants((line) => ctx.log(line), ctx.flags.owner);
}

// ── setup:token ─────────────────────────────────────────────────────────────

/**
 * Issues, re-issues or reports the one-time setup token (D-101).
 *
 *     splashtrack setup:token            # status; never the value
 *     splashtrack setup:token --ensure   # issue only if there is no usable one
 *     splashtrack setup:token --new      # replace whatever is there
 *
 * WHAT THIS COMMAND WILL NEVER DO IS PRINT THE TOKEN. D-101 exists because F-20
 * states as a design assumption that self-hosters paste terminal output and
 * container logs into public issues, and this token makes its holder the
 * administrator of an installation about to hold children's records. So the
 * command prints a PATH, and the operator reads the file.
 *
 * `--ensure` is what `docker-entrypoint.sh` runs on every start in setup mode.
 * It is not `--new`, and the difference matters twice: an operator who restarts
 * the container mid-install must not find the token they wrote down silently
 * replaced, and one who comes back after the hour has run out must not find an
 * expired token with no instruction attached.
 *
 * IT DOES NOT TOUCH THE DATABASE. That is the property that lets it run in
 * state `EMPTY`, where there are no tables to touch, and it is why nothing here
 * calls `detectBootState` — the entrypoint has already decided, and this
 * command is one `writeFileSync`.
 */
export async function setupToken(ctx: CommandContext): Promise<number> {
  const ensure = ctx.flags.ensure === "true";
  const replace = ctx.flags.new === "true";

  if (ensure && replace) {
    ctx.error("Use either --ensure or --new, not both.");
    return 2;
  }

  if (!ensure && !replace) {
    const status = setupTokenStatus();
    ctx.log(`Setup token file: ${status.path}`);
    switch (status.state) {
      case "NONE":
        ctx.log("  state      none issued");
        break;
      case "VALID":
        ctx.log(`  state      usable, expires ${status.expiresAt}`);
        break;
      case "EXPIRED":
        ctx.log(`  state      EXPIRED at ${status.expiresAt}`);
        break;
      case "USED":
        ctx.log(`  state      already used at ${status.usedAt}`);
        break;
    }
    ctx.log("");
    ctx.log("Issue a new one with `splashtrack setup:token --new`.");
    ctx.log("The token itself is never printed here — read the file.");
    return 0;
  }

  const result = replace
    ? { ...issueSetupToken(), issued: true }
    : ensureSetupToken();

  if (!result.issued) {
    ctx.log(
      `A usable setup token already exists and expires ${result.expiresAt.toISOString()}.`,
    );
    ctx.log(`Read it from ${result.path}.`);
    return 0;
  }

  ctx.log("");
  ctx.log(`A one-time setup token has been written to ${result.path}`);
  ctx.log(
    `It is valid for ${SETUP_TOKEN_TTL_MINUTES} minutes, until ${result.expiresAt.toISOString()},`,
  );
  ctx.log("and it can be used exactly once.");
  ctx.log("");
  ctx.log("Read it:");
  ctx.log("");
  ctx.log(`    docker compose exec app cat ${result.path}`);
  ctx.log("");
  ctx.log(
    "THAT FILE IS A CREDENTIAL. Whoever holds this token becomes the " +
      "administrator of this installation. It is not printed here and it is " +
      "never written to the container log, because logs get pasted into " +
      "public issues (D-101, F-99). Do not paste it either.",
  );
  ctx.log("");
  return 0;
}
