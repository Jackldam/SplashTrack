import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { requirePermission, PermissionDeniedError } from "@/lib/authorization";

/**
 * `Admin → Maintenance → Backup` — §3.1's on-demand backup screen.
 *
 * ONE BUTTON, NO FORM FIELDS — deliberately, matching §3.1's "one click".
 * The button POSTs to `/api/admin/backup` (`../../api/admin/backup/route.ts`),
 * which does the real work: `backup.run`, then `backup.download`, then streams
 * the `.stbak` bytes as a file download. This page's own guard
 * (`requirePermission` below) is UI gating only (§1.1 rule 1) — it decides
 * whether to SHOW the button, and is not what authorizes the click; the route
 * handler authorizes the click.
 *
 * NOT BUILT HERE, FLAGGED: "Admin → Maintenance" as a navigable section does
 * not exist yet — this page has no parent menu, no sibling "Updates" screen
 * (§6), and no settings form for `backup.premigrationEnabled` (§7). It is
 * reachable only by its URL. Building the admin shell is out of this phase's
 * scope; see the phase report.
 *
 * ALSO NOT BUILT HERE: a "Set up the Recovery Kit" action (`backup:init-token`
 * has no UI equivalent — an operator runs it from the host). Token
 * re-display, the diagnostics "recovery token acknowledged" check, and §3.2's
 * scheduled-backup settings are all out of scope for the same reason.
 */
export default async function BackupPage() {
  const [t, session] = await Promise.all([
    getTranslations(),
    requireEnrolledSession(),
  ]);

  let denied: string | null = null;
  try {
    await requirePermission(
      { personId: session.person.id },
      "backup.run",
      { organization: true },
    );
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      denied = error.permission;
    } else {
      throw error;
    }
  }

  if (denied) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/">{t("backup.backToHome")}</Link>
        </nav>
        <h1>{t("backup.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("backup.denied.title")}</h2>
          <p className="mb-0">
            {t("backup.denied.explanation", { permission: denied })}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/">{t("backup.backToHome")}</Link>
      </nav>
      <h1>{t("backup.title")}</h1>
      <p className="lead">{t("backup.subtitle")}</p>
      <form action="/api/admin/backup" method="POST">
        <button type="submit" className="btn btn-primary">
          {t("backup.createButton")}
        </button>
      </form>
      <p className="text-muted mt-4">{t("backup.note")}</p>
    </main>
  );
}
