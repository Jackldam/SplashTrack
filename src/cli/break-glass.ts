/**
 * What every break-glass invocation owes, per `13-configuration-and-setup.md`
 * §7: *"Every one of these writes an audit event, with a `system:cli` actor
 * carrying host user, container id, timestamp and the exact subcommand, and
 * every invocation notifies all `ORGANIZATION`-scoped administrators."*
 *
 * THE ACTOR. `system:cli` is written to `actorAuthMethod`, not to
 * `actorPersonId`. That column is a foreign key to a real `Person` and the whole
 * point of the CLI is that it runs WITHOUT one — its authority is host access,
 * not an identity the application can name. Recording a person id here would be
 * a guess dressed as attribution. What is knowable — the host user, the
 * container id, the subcommand — goes into `changedFields`, which is exactly the
 * "machine tokens, never values" shape that column is typed for.
 *
 * THE NOTIFICATION. A `BreakGlassAlert` row, dismissed by a signed-in
 * administrator and never by this CLI. Host access is what let the command run;
 * it must not also be what makes the warning about it go away.
 *
 * ORDER MATTERS, AND IT IS THE THROWING `recordAuditEvent`. The audit event is
 * written BEFORE the privileged change, and a failure to write it aborts the
 * command. These are the operations `02-security-privacy.md` calls "no access
 * without a record": an MFA reset or an administrator grant that happened with
 * no trail is worse than one that did not happen.
 */

import { hostname, userInfo } from "node:os";

import { prisma } from "@/lib/database";
import { recordAuditEvent } from "@/modules/audit";

/** The break-glass surface, as `13-…` §7 names it. A closed vocabulary. */
export type BreakGlassCommand =
  | "setup:init"
  | "admin:create"
  | "admin:reset-mfa"
  | "admin:grant-admin"
  | "bootstrap:clear-tampered";

export interface BreakGlassContext {
  /** The account acted on, when there is one. An id, never an email. */
  targetUserAccountId?: string | null;
  /** Extra machine tokens for the trail. Never a value, never personal data. */
  detail?: Record<string, string | number | boolean | null>;
}

/**
 * Records the invocation and raises the administrator banner. Returns the audit
 * event's id so a caller can report it.
 *
 * Throws if the audit append fails — see the file header.
 */
export async function recordBreakGlassInvocation(
  command: BreakGlassCommand,
  context: BreakGlassContext = {},
): Promise<{ auditEventId: string }> {
  const invoker = describeInvoker();

  const event = await recordAuditEvent({
    eventType: `security.break_glass.${command.replace(/[:-]/g, "_")}`,
    outcome: "SUCCESS",
    // No person: the CLI's authority is host access. See the file header.
    actorPersonId: null,
    actorAuthMethod: "system:cli",
    targetType: context.targetUserAccountId ? "user_account" : null,
    targetId: context.targetUserAccountId ?? null,
    changedFields: {
      command,
      hostUser: invoker.hostUser,
      containerId: invoker.containerId,
      ...(context.detail ?? {}),
    },
    reason: "break_glass_cli",
  });

  await prisma.breakGlassAlert.create({
    data: {
      command,
      auditEventId: event.id,
      context: {
        hostUser: invoker.hostUser,
        containerId: invoker.containerId,
        ...(context.targetUserAccountId
          ? { targetUserAccountId: context.targetUserAccountId }
          : {}),
        ...(context.detail ?? {}),
      },
    },
  });

  return { auditEventId: event.id };
}

/**
 * Who ran this and where. The container id is the container's hostname, which
 * Docker sets to the short container id unless the operator overrode it — the
 * cheapest honest answer, and it degrades to a hostname rather than to a lie.
 */
export function describeInvoker(): { hostUser: string; containerId: string } {
  let hostUser = "unknown";
  try {
    hostUser = userInfo().username;
  } catch {
    // A container without a matching passwd entry for its uid. Not an error:
    // running as a numeric uid with no /etc/passwd row is a normal hardened
    // deployment, and `unknown` is the honest value.
  }
  return { hostUser, containerId: hostname() };
}
