/**
 * Drops and recreates a database, then applies every migration with
 * `prisma migrate deploy` — the fresh-install path, exactly as R-20 runs it at
 * container start.
 *
 *     npx tsx scripts/recreate-database.ts splashtrack_freshcheck
 *
 * WHY THIS EXISTS AS A SCRIPT. `prisma migrate dev` replays history against a
 * SHADOW database and would have caught the ordering defect this script was
 * written to reproduce — but only when someone happens to run it. The
 * definition of done for phase 0.4 requires a dropped-and-recreated database to
 * migrate cleanly, and that is a check somebody must be able to run in one
 * command rather than assemble by hand each time.
 *
 * It REFUSES any target whose name is not clearly a scratch database, so it can
 * never be pointed at the dev or production database by a slip of the shell.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

import { applyRoleModel } from "../src/lib/database/apply-role-model";
import {
  REFERENCE_OWNER_ROLE,
  roleNameFrom,
} from "../src/lib/database/role-model";

/** Only names that announce themselves as throwaway. */
const ALLOWED_NAME =
  /^splashtrack_(freshcheck|scratch|migrationcheck)[a-z0-9_]*$/;

async function main(): Promise<void> {
  loadEnv({ path: path.resolve(process.cwd(), ".env") });

  const name = process.argv[2] ?? "splashtrack_freshcheck";
  if (!ALLOWED_NAME.test(name)) {
    throw new Error(
      `Refusing to drop "${name}". This script only ever recreates a scratch ` +
        `database matching ${ALLOWED_NAME}.`,
    );
  }

  // THE MAINTENANCE CREDENTIAL. Dropping and creating a database needs
  // CREATEDB, and migrating needs the owner — neither is something the runtime
  // role holds, deliberately (ADR-0002 §6, D-116). The runtime URL is still
  // read, but only to learn which role the grants must name.
  const runtime = process.env.DATABASE_URL;
  if (!runtime) throw new Error("DATABASE_URL is not set.");
  const base = process.env.DATABASE_MAINTENANCE_URL;
  if (!base) {
    throw new Error(
      "DATABASE_MAINTENANCE_URL is not set. The fresh-install check drops and " +
        "recreates a database and then migrates it, and the runtime role can " +
        "do neither — see ADR-0002.",
    );
  }

  const target = new URL(base);
  target.pathname = `/${name}`;
  const maintenance = new URL(base);
  maintenance.pathname = "/postgres";

  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    // OWNER, so this scratch database is shaped like a real one from the first
    // statement. R-20's fresh-install path is what this script reproduces, and
    // a fresh install now ends with the role model in force.
    await client.query(
      `CREATE DATABASE "${name}" OWNER "${REFERENCE_OWNER_ROLE}"`,
    );
  } finally {
    await client.end();
  }
  console.log(`[recreate-database] Dropped and recreated "${name}".`);

  const require = createRequire(import.meta.url);
  const prismaBin = path.join(
    path.dirname(require.resolve("prisma/package.json")),
    "build",
    "index.js",
  );
  execFileSync(process.execPath, [prismaBin, "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_MAINTENANCE_URL: target.toString() },
  });

  // The whole point of this script is that the fresh-install path works end to
  // end. Since ADR-0002 that path does not end at `migrate deploy`: the
  // entrypoint re-applies the role model over the new schema and refuses to
  // serve if it cannot, so a check that stopped before this step would be
  // checking something the container no longer does.
  const runtimeTarget = new URL(runtime);
  runtimeTarget.pathname = `/${name}`;
  const outcome = await applyRoleModel(target.toString(), {
    owner: REFERENCE_OWNER_ROLE,
    app: roleNameFrom(runtimeTarget.toString()),
    retention: roleNameFrom(target.toString()),
  });
  if (outcome.failures.length > 0) {
    throw new Error(
      "Migrations applied, but the ADR-0002 role model is not in force:\n" +
        outcome.failures.map((failure) => `  - ${failure}`).join("\n"),
    );
  }
  console.log(
    `[recreate-database] Role model in force on "${name}" ` +
      `(applied as ${outcome.acting}).`,
  );
}

main().catch((error) => {
  console.error("[recreate-database] Failed:");
  console.error(error);
  process.exit(1);
});
