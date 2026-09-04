/**
 * The Prisma client for `DATABASE_MAINTENANCE_URL` — the retention role.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS A SECOND CLIENT AT ALL
 *
 * D-168 makes the checkpointed prefix prune the only legitimate way an audit
 * row is ever deleted, and ADR-0002 §7.4 puts that `DELETE` on a role the web
 * process does not connect as. So from the moment the role model is in force,
 * `pruneAuditEventPrefix` running on the runtime client fails with
 * `permission denied for table AuditEvent` — correctly. The retention path
 * needs the retention role, and this is it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS LAZY, AND THAT IS LOAD-BEARING
 *
 * `src/lib/database/client.ts` throws at module scope when `DATABASE_URL` is
 * missing, which is right for a connection every request needs. This one must
 * NOT: it is reached only by `audit:verify --prune-before`, and a web process
 * that has never pruned anything should not open a second pool — nor fail to
 * start — because of a variable only the retention job uses. So the client is
 * built on first use and the error, when it comes, names the retention path
 * rather than the boot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS COSTS, STATED PLAINLY
 *
 * The web container holds `DATABASE_MAINTENANCE_URL` in its environment,
 * because D-181 makes upgrades apply migrations unattended and the entrypoint
 * therefore needs a credential that can migrate. ADR-0002 §5 says "the web
 * application never holds it", and with unattended migration that sentence is
 * too strong — §8.1 of the ADR now corrects it.
 *
 * What survives, and is the property the control was written for: an SQL
 * primitive — an injection, a stolen `DATABASE_URL` — yields the RUNTIME role
 * and cannot reach this one. Reading the container's environment is host
 * access, which FM-7 and D-168 already concede is outside what any of this
 * defends against.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

let cached: PrismaClient | undefined;

/**
 * The retention client, built on first use.
 *
 * Callers get the SAME instance back, so the pool is opened once per process
 * even though a retention run may prune and then append.
 */
export function maintenanceClient(): PrismaClient {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_MAINTENANCE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_MAINTENANCE_URL is not set, so audit retention cannot run.\n\n" +
        "  Deleting an audit row is the one database operation the runtime " +
        "role deliberately cannot perform (D-149 part 2, D-168): it holds " +
        "INSERT and SELECT on AuditEvent and nothing more. Retention runs as " +
        "a separate role, and this variable is that connection.\n\n" +
        "  See docs/adr/0002-database-roles-and-least-privilege.md and " +
        ".env.example.",
    );
  }

  cached = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return cached;
}

/**
 * Closes the retention pool if one was ever opened.
 *
 * The CLI disconnects the runtime client on its way out; a retention run opens
 * a second pool that would otherwise keep the process alive after the command
 * has printed its result.
 */
export async function disconnectMaintenanceClient(): Promise<void> {
  if (!cached) return;
  const client = cached;
  cached = undefined;
  await client.$disconnect().catch(() => undefined);
}
