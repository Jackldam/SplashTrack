/**
 * "Run migrations, then put the ADR-0002 role model back in force" — the step
 * D-055's NEW INSTALLATION branch takes before anything is seeded, in the one
 * place both callers reach it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT MOVED OUT OF THE CLI
 *
 * It used to live in `src/cli/commands/setup.ts`, because the CLI was the only
 * thing that migrated a fresh database. Since D-187 the `/setup` wizard does it
 * too — that is what the wizard's "this is a new installation" answer MEANS —
 * and a Server Action reaching into `src/cli` would be the wrong direction for
 * the dependency as well as a second copy of a sequence that must never come
 * apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO HALVES ARE WELDED, AND THE REASON IS MEASURED
 *
 * The migration runs as `splashtrack_owner` (`prisma.config.ts` derives that
 * connection), so every table it creates is owned by the owner role and carries
 * NO privileges for the runtime role at all. The seed that follows runs as the
 * RUNTIME role, which is what `@/lib/database` connects as. Without the grants
 * in between, the seed dies on its first statement with
 *
 *     permission denied for table Organization
 *
 * — observed on a genuinely empty database, and the operator's only way forward
 * was to know that `db:apply-grants` belongs between two steps of something that
 * presents itself as one step. `tests/integration/setup-init-from-empty.test.ts`
 * pins both directions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASYNC `execFile`, NOT `execFileSync`
 *
 * The CLI could block; the Next server cannot. `migrate deploy` on a fresh
 * database takes seconds, and a synchronous spawn inside a Server Action holds
 * the event loop for all of them — every other request on the instance,
 * including the health check the orchestrator uses to decide the container is
 * alive. One implementation, and it is the non-blocking one.
 *
 * `migrate deploy` and NOT `migrate dev`: it applies pending migrations and
 * never generates, resets or prompts, which are all things that must not happen
 * on a machine holding real data.
 *
 * SERVER-ONLY.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { applyRoleModel } from "@/lib/database/apply-role-model";
import {
  REFERENCE_OWNER_ROLE,
  roleNameFrom,
  type RoleModelNames,
} from "@/lib/database/role-model";

const execFileAsync = promisify(execFile);

/** Where a caller's narration goes. The CLI prints it; the wizard logs it. */
export type MigrationLog = (line: string) => void;

/**
 * Resolves the three ADR-0002 role names from the environment.
 *
 * The two LOGIN roles are read from the connection strings rather than assumed,
 * because on a managed database they are the provider's names and not ours. The
 * owner cannot be read the same way — it is the one role that never appears in
 * a connection string, which is the whole point of it — so it defaults to the
 * name the reference provisioning creates, and a caller may override it.
 */
export function resolveRoleModelNames(ownerOverride?: string): {
  names: RoleModelNames;
  maintenanceUrl: string;
} {
  const runtimeUrl = process.env.DATABASE_URL;
  const maintenanceUrl = process.env.DATABASE_MAINTENANCE_URL;

  if (!runtimeUrl) throw new Error("DATABASE_URL is not set.");
  if (!maintenanceUrl) {
    throw new Error(
      "DATABASE_MAINTENANCE_URL is not set.\n\n" +
        "  It is the second of the two credentials ADR-0002 requires: the\n" +
        "  retention role, which holds the only DELETE on AuditEvent and is a\n" +
        "  member of the owner role that runs migrations. Without it this\n" +
        "  installation cannot migrate, cannot prune, and cannot put D-149\n" +
        "  part 2 in force.\n\n" +
        "  See .env.example and docs/adr/0002-database-roles-and-least-privilege.md.",
    );
  }

  return {
    maintenanceUrl,
    names: {
      owner: ownerOverride ?? REFERENCE_OWNER_ROLE,
      app: roleNameFrom(runtimeUrl),
      retention: roleNameFrom(maintenanceUrl),
    },
  };
}

/** Applies the ADR-0002 role model and THROWS if it did not come into force. */
export async function applyRoleModelOrThrow(
  log: MigrationLog = () => {},
  ownerOverride?: string,
): Promise<void> {
  const { names, maintenanceUrl } = resolveRoleModelNames(ownerOverride);

  log("Applying the ADR-0002 role model:");
  log(`  owner     ${names.owner}   (non-connecting)`);
  log(`  runtime   ${names.app}`);
  log(`  retention ${names.retention}`);

  const outcome = await applyRoleModel(maintenanceUrl, names);
  if (outcome.failures.length > 0) {
    throw new Error(
      "The ADR-0002 role model did NOT come into force:\n" +
        outcome.failures.map((failure) => `  ✗ ${failure}`).join("\n"),
    );
  }

  log(`Applied as ${outcome.acting} (session ${outcome.session}).`);
  log(
    `D-149 part 2 is in force: ${names.app} holds SELECT and INSERT on ` +
      "AuditEvent, owns nothing, and cannot grant itself more.",
  );
}

/**
 * Migrates, then re-applies the role model over what the migration just
 * created. NEVER one without the other — see the header.
 *
 * Prisma's own stdout and stderr are captured and forwarded line by line rather
 * than inherited, because the second caller has no terminal to inherit. A
 * migration failure throws with Prisma's message attached, which names the
 * migration and the failing statement.
 */
export async function migrateAndApplyRoleModel(
  log: MigrationLog = () => {},
  ownerOverride?: string,
): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [prismaCliPath(), "migrate", "deploy"],
      { env: process.env, maxBuffer: 16 * 1024 * 1024 },
    );
    for (const line of `${stdout}${stderr}`.split("\n")) {
      if (line.trim()) log(line);
    }
  } catch (error) {
    // `execFile`'s rejection carries the child's output on the error object,
    // and that output is the only thing that says WHICH migration failed. It
    // can also be empty — a spawn failure never reached Prisma at all — so the
    // fallback is the error's own message rather than a bare heading.
    const failure = error as { stdout?: string; stderr?: string };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim();
    throw new Error(
      `\`prisma migrate deploy\` failed:\n${output || (error as Error).message}`,
    );
  }
  log("Migrations applied.");

  log("Re-applying the ADR-0002 role model over the new schema…");
  await applyRoleModelOrThrow(log, ownerOverride);
}

/**
 * Where the Prisma CLI lives. `prisma` is a RUNTIME dependency of this
 * application, not a build tool: `migrate deploy` is what the boot state
 * machine runs on an `EXISTING` database, so an image without it could not
 * upgrade itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS FOUND BY WALKING THE FILESYSTEM, NOT BY `require.resolve`, AND THAT IS
 * NOT A STYLE CHOICE
 *
 * `createRequire(import.meta.url).resolve("prisma/build/index.js")` is the
 * obvious spelling and it BREAKS THE BUILD. Measured, not predicted: Next's
 * bundler reads that literal specifier as a module graph edge, follows it into
 * `prisma/build/index.js` → `@prisma/dev/dist/state.cjs`, and reaches the
 * `.tar.gz` runtime assets that package ships —
 *
 *     ./node_modules/@prisma/dev/dist/runtime-assets/vector.tar.gz
 *     Error: Unknown module type
 *
 * — with an import trace ending at this file. The CLI never had the problem
 * because esbuild was not asked to trace it; this module gained a Server Action
 * caller, and with it a bundler.
 *
 * So the path is COMPUTED at runtime and no bundler can see a specifier. The
 * search starts at the working directory — `/app` in the image, the checkout
 * root in development, and `node_modules/prisma` is directly under both — and
 * then walks up, which covers a workspace layout that hoists dependencies.
 */
function prismaCliPath(): string {
  const relative = path.join("node_modules", "prisma", "build", "index.js");

  let directory = process.cwd();
  for (;;) {
    const candidate = path.join(directory, relative);
    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `The Prisma CLI could not be found (looked for ${relative} from ` +
      `${process.cwd()} upwards). It is a RUNTIME dependency of this image — ` +
      "`migrate deploy` is what a new or upgrading installation runs — so an " +
      "image without it cannot set itself up or migrate itself.",
  );
}
