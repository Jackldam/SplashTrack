/**
 * `setup:init` — the "New installation" branch of D-055's diagram, driven from
 * the host.
 *
 * The diagram's EMPTY branch reads: *run migrations → seed catalogue + starter
 * roles → create first administrator, force MFA → write bootstrap record →
 * serving*, and it puts the operator's answer to "new installation, or restore
 * from backup?" in a browser wizard (D-039). That wizard is phase 1. Until it
 * exists the same question is answered on the host, which is the pattern
 * everything else privileged in this chapter already uses — D-101 moved the
 * setup token to the filesystem for exactly this reason, and §7 makes host
 * access the proof of ownership for every break-glass operation.
 *
 * So the branch is split across two commands rather than guessed at:
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

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { seedInstallation } from "@/lib/boot/seed";
import { detectBootState } from "@/lib/boot/state";

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
  applyMigrations(ctx);

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
  return 0;
}

/**
 * Runs `prisma migrate deploy` in this process's environment.
 *
 * `migrate deploy` and not `migrate dev`: it applies pending migrations and
 * never generates, resets or prompts, which are all things that must not happen
 * on a machine holding real data.
 *
 * Inherits stdio so Prisma's own output reaches the operator unfiltered — a
 * migration failure is the moment to see everything, and Prisma's messages name
 * the migration and the SQL statement that failed.
 */
export function applyMigrations(ctx: CommandContext): void {
  execFileSync(process.execPath, [prismaCliPath(), "migrate", "deploy"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });
  ctx.log("Migrations applied.");
}

/**
 * Where the Prisma CLI lives. `prisma` is a RUNTIME dependency of this
 * application, not a build tool: `migrate deploy` is what the boot state
 * machine runs on an `EXISTING` database, so an image without it could not
 * upgrade itself. Resolved rather than hardcoded so it works from the bundled
 * CLI in the image and from `tsx` in a checkout.
 */
function prismaCliPath(): string {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("prisma/build/index.js");
  } catch {
    return path.resolve(process.cwd(), "node_modules/prisma/build/index.js");
  }
}
