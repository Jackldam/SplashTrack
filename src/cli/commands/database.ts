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

import { applyRoleModelOrThrow as applyRoleModel } from "@/lib/boot/migrate";

import type { CommandContext } from "../context";

/**
 * Applies the role model and THROWS on any failure.
 *
 * THE RESOLUTION AND THE GRANTS THEMSELVES LIVE IN `@/lib/boot/migrate.ts`.
 * They moved there when the `/setup` wizard became a second caller (D-187):
 * migrating and re-granting is one sequence that must never come apart, and it
 * cannot live under `src/cli` if a Server Action has to run it.
 *
 * This wrapper is what keeps the CLI's narration: the shared function takes a
 * log callback, and `ctx.log` is it.
 */
export async function applyRoleModelOrThrow(
  ctx: CommandContext,
): Promise<void> {
  await applyRoleModel((line) => ctx.log(line), ctx.flags.owner);
}

export async function databaseApplyGrants(
  ctx: CommandContext,
): Promise<number> {
  try {
    await applyRoleModelOrThrow(ctx);
  } catch (error) {
    ctx.error((error as Error).message);
    return 1;
  }
  return 0;
}
