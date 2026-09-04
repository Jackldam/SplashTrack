/**
 * `db:apply-grants` — puts the ADR-0002 role model in force on one database,
 * and refuses to claim it did when it did not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A COMMAND AND NOT A MIGRATION, AND NOT THE OPERATOR'S PROBLEM
 *
 * `infra/audit-database-role.sql` gave three reasons the grants cannot be a
 * Prisma migration, and all three still hold: role names belong to the operator,
 * a migration would run as the role it is revoking from, and granting needs
 * privileges the runtime role must not have. None of those makes it the
 * operator's job to remember, though — and OD-15 fixes the audience at
 * "comfortable with `docker compose`", explicitly NOT "comfortable with
 * PostgreSQL role grants".
 *
 * So the split is:
 *
 *   creating the three ROLES        superuser, once, per cluster
 *                                   → `infra/provision-roles.sql`, which the
 *                                     compose stack runs for the operator from
 *                                     the postgres image's initdb hook.
 *
 *   applying the role model to a    the maintenance credential, after EVERY
 *   DATABASE                        migration → this command, run by
 *                                   `docker-entrypoint.sh` and by the test
 *                                   harness.
 *
 * The second half has to run repeatedly rather than once, because
 * `ALTER DEFAULT PRIVILEGES` hands the runtime role `DELETE` on any table a
 * future migration creates — including a re-created `AuditEvent`. A control
 * applied once and never reasserted is a control with an expiry date nobody
 * wrote down.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT VERIFIES, AND EXITS NON-ZERO ON FAILURE — unlike `audit:grants`
 *
 * `audit:grants` is a REPORT and never refuses a start. This is an ACTION, and
 * an action that silently half-applied is how ADR-0002 §3's defect got there in
 * the first place. So it re-reads what it just wrote and fails if the runtime
 * role still holds a write on `AuditEvent`, or still owns it.
 */

import { applyRoleModel } from "@/lib/database/apply-role-model";
import {
  REFERENCE_OWNER_ROLE,
  roleNameFrom,
  type RoleModelNames,
} from "@/lib/database/role-model";

import type { CommandContext } from "../context";

/**
 * Resolves the three role names.
 *
 * The two LOGIN roles are read from the connection strings rather than assumed,
 * because on a managed database they are the provider's names and not ours. The
 * owner cannot be read the same way — it is the one role that never appears in
 * a connection string, which is the whole point of it — so it defaults to the
 * name the reference provisioning creates and `--owner` overrides it.
 */
function resolveNames(ctx: CommandContext): {
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
      owner: ctx.flags.owner ?? REFERENCE_OWNER_ROLE,
      app: roleNameFrom(runtimeUrl),
      retention: roleNameFrom(maintenanceUrl),
    },
  };
}

export async function databaseApplyGrants(
  ctx: CommandContext,
): Promise<number> {
  const { names, maintenanceUrl } = resolveNames(ctx);

  ctx.log("Applying the ADR-0002 role model:");
  ctx.log(`  owner     ${names.owner}   (non-connecting)`);
  ctx.log(`  runtime   ${names.app}`);
  ctx.log(`  retention ${names.retention}`);
  ctx.log("");

  let outcome;
  try {
    outcome = await applyRoleModel(maintenanceUrl, names);
  } catch (error) {
    ctx.error((error as Error).message);
    return 1;
  }

  if (outcome.failures.length > 0) {
    ctx.error("The role model did NOT come into force:");
    for (const failure of outcome.failures) ctx.error(`  \u2717 ${failure}`);
    return 1;
  }

  ctx.log(`Applied as ${outcome.acting} (session ${outcome.session}).`);
  ctx.log(
    `D-149 part 2 is in force: ${names.app} holds SELECT and INSERT on ` +
      "AuditEvent, owns nothing, and cannot grant itself more.",
  );
  return 0;
}
