import { getTranslations } from "next-intl/server";

import { requirePermission } from "@/lib/authorization";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/database";

import { dismissBreakGlassAlert } from "./break-glass-actions";

/**
 * The warning every break-glass CLI invocation raises (`13-…` §7: *"every
 * invocation notifies all `ORGANIZATION`-scoped administrators"*).
 *
 * IT IS DISMISSED HERE AND NOWHERE ELSE. There is no CLI command that clears
 * one, deliberately: host access is what let the command run, so host access
 * must not also be what makes the warning about it disappear. Somebody has to
 * sign in, prove a second factor, hold `organization.settings.manage` at
 * `ORGANIZATION` scope, and say they have seen it.
 *
 * It renders NOTHING for a caller who cannot dismiss it — not a disabled
 * control, not a greyed row. A banner an instructor cannot act on is noise on
 * the one screen that must stay fast at the poolside.
 */
export async function BreakGlassBanner() {
  const session = await getCurrentSession();
  if (!session) return null;
  // An account still inside the D-185 enrolment window cannot dismiss (the
  // action refuses), so rendering the banner for it would offer a control that
  // cannot work. This is a UI decision layered on top of the server-side
  // refusal in `./break-glass-actions.ts`, never a substitute for it.
  if (session.mfaPending) return null;

  try {
    await requirePermission(
      { personId: session.person.id },
      "organization.settings.manage",
      { organization: true },
    );
  } catch {
    return null;
  }

  const alerts = await prisma.breakGlassAlert.findMany({
    where: { dismissedAt: null },
    orderBy: { occurredAt: "desc" },
    take: 20,
  });
  if (alerts.length === 0) return null;

  const t = await getTranslations();

  return (
    <div className="alert alert-warning" role="alert">
      <h2 className="h6">{t("breakGlass.title")}</h2>
      <p className="mb-2">{t("breakGlass.explanation")}</p>
      <ul className="list-unstyled mb-0">
        {alerts.map((alert) => (
          <li key={alert.id} className="d-flex align-items-center gap-2 py-1">
            <code>{alert.command}</code>
            <span className="text-muted small">
              {alert.occurredAt.toISOString()}
            </span>
            <form action={dismissBreakGlassAlert} className="ms-auto">
              <input type="hidden" name="alertId" value={alert.id} />
              <button className="btn btn-sm btn-outline-dark" type="submit">
                {t("breakGlass.dismiss")}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
