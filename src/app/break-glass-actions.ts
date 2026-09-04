"use server";

/**
 * Dismissing a break-glass warning — an authorized, audited act.
 *
 * The dismissal is audited rather than stored on the row, and that is where WHO
 * acknowledged it is recorded. `BreakGlassAlert` carries no person column on
 * purpose: the accountability belongs on the append-only trail, and a person
 * pointer here would be a second, mutable copy of it.
 */

import { revalidatePath } from "next/cache";

import { requireEnrolledSession } from "@/lib/auth/session";
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { recordAuditEvent } from "@/modules/audit";

export async function dismissBreakGlassAlert(
  formData: FormData,
): Promise<void> {
  const alertId = String(formData.get("alertId") ?? "");
  // Refuses an unauthenticated caller AND one still inside the D-185 enrolment
  // window: acknowledging the break-glass warning is precisely the act an
  // account created by that break-glass command must not be able to perform for
  // itself before its second factor exists.
  const session = await requireEnrolledSession();

  // Resource-referenced, never a bare permission check (D-030).
  await requirePermission(
    { personId: session.person.id },
    "organization.settings.manage",
    { organization: true },
  );

  const alert = await prisma.breakGlassAlert.findUnique({
    where: { id: alertId },
    select: { id: true, command: true, dismissedAt: true },
  });
  if (!alert || alert.dismissedAt) return;

  // The record BEFORE the change, and the throwing variant: an acknowledgement
  // nobody can prove happened is not an acknowledgement.
  await recordAuditEvent({
    eventType: "security.break_glass.acknowledged",
    outcome: "SUCCESS",
    actorPersonId: session.person.id,
    actorAuthMethod: "session",
    targetType: "break_glass_alert",
    targetId: alert.id,
    changedFields: { command: alert.command },
  });

  await prisma.breakGlassAlert.update({
    where: { id: alert.id },
    data: { dismissedAt: new Date() },
  });

  revalidatePath("/");
}
