import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "@/lib/auth";

import { EnrolmentFlow } from "./enrolment-flow";

/**
 * Where an account finishes setting up its second factor (D-185).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE PAGE AN `mfa_pending` ACCOUNT MAY RENDER
 *
 * Every other page calls `requireEnrolledSession()`, which sends such an
 * account HERE. So this page must not call it: the guard would bounce the
 * caller to the page they are already on. It uses `getCurrentSession()`
 * directly and applies the two refusals itself, in the opposite direction from
 * everywhere else:
 *
 *   no session            → `/sign-in`. There is nobody to enrol.
 *   already has a factor  → `/`. Re-enrolment from here is deliberately not a
 *                           feature — swapping a verified factor is a
 *                           re-authenticated profile operation, and until that
 *                           surface exists the path is
 *                           `splashtrack admin:reset-mfa` on the host.
 *
 * `tests/unit/route-guard-coverage.test.ts` allowlists this file by name, with
 * that reasoning, so a future page cannot quietly acquire the same exemption.
 *
 * THE REFUSALS ARE REPEATED IN THE ACTIONS, not delegated to this page. A
 * Server Action is reachable by POST without the page that renders it, so a
 * page-level check is a convenience for the browser and never the control.
 */
export default async function MfaEnrolmentPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  if (!session.mfaPending) redirect("/");

  const t = await getTranslations();

  return (
    <main className="container py-5" style={{ maxWidth: "30rem" }}>
      <h1 className="h3 mb-4">{t("mfaEnrolment.title")}</h1>
      <EnrolmentFlow email={session.userAccount.email} />
    </main>
  );
}
