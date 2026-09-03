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

  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set.");

  const target = new URL(base);
  target.pathname = `/${name}`;
  const maintenance = new URL(base);
  maintenance.pathname = "/postgres";

  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
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
    env: { ...process.env, DATABASE_URL: target.toString() },
  });
}

main().catch((error) => {
  console.error("[recreate-database] Failed:");
  console.error(error);
  process.exit(1);
});
