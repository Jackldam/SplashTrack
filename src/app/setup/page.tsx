import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "@/lib/auth";
import { resolveWizardAccess, setupTokenPath } from "@/lib/setup";

import { EnrolmentFlow } from "../mfa-enrolment/enrolment-flow";
import { AdministratorStep } from "./administrator-step";
import { TokenStep } from "./token-step";

/**
 * `/setup` — the first-run wizard (`13-configuration-and-setup.md` §6.3,
 * D-039, D-187).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS THE FRONT DOOR, AND IT CLOSES BEHIND ITSELF
 *
 * Three steps, in the order the design lists them:
 *
 *   1. the one-time setup token (D-101) — host access as proof of ownership
 *   2. the organisation's name, and the first administrator: email, name, and
 *      a password TYPED TWICE
 *   3. MFA enrolment, with the QR code, in the same flow
 *
 * Setup completes when — and only when — that administrator has a VERIFIED
 * second factor (D-185). Step 3 is not a formality at the end of the wizard; it
 * is the step that writes the `InstallationBootstrap` record, and until it
 * happens this installation is not set up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT HERE, AND WHY
 *
 * §6.3 lists three more steps this page does not render, and each is absent
 * because the thing behind it does not exist rather than because it was
 * forgotten:
 *
 *   step 0, "new installation or restore from backup?" — there is no restore.
 *     D-095/D-169 make a SplashTrack backup a structured export the application
 *     writes and reads itself, `pg_dump` is out of v1 scope, and the export
 *     engine is unbuilt (`docker-entrypoint.sh` refuses to migrate without a
 *     backup for the same reason). A question with one answer is not a question,
 *     and offering "restore" as a dead branch would be worse than omitting it.
 *   step 4, the recovery token — it is a passphrase over the archive's key
 *     record (D-114/D-166). Same missing engine.
 *   step 5, email settings with a test send — there is no mail transport yet.
 *
 * They belong here when those engines land. Naming them is how that stays a
 * decision rather than an oversight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GATE
 *
 * `resolveWizardAccess` is the whole of it, and the reasoning lives in
 * `@/lib/setup/gate.ts`. `CLOSED` is `notFound()` and not a redirect on purpose:
 * a redirect tells a stranger the route is there and merely not for them, while
 * a 404 is the honest description of a surface that self-destructed (D-039).
 */
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // `getCurrentSession()` and NOT `requireEnrolledSession()`. Every other page
  // uses the guard; this one cannot, because the caller it exists for in step 3
  // is precisely an account with no verified factor — the guard would bounce it
  // to `/mfa-enrolment`, which is the step this page is rendering. The refusals
  // are applied here instead, and in the actions independently.
  const session = await getCurrentSession();
  const { stage } = await resolveWizardAccess({
    signedInPending: session?.mfaPending === true,
  });

  if (stage === "CLOSED") notFound();
  // `PENDING_ENROLMENT` with nobody signed in. The administrator exists, so the
  // token is spent and the remaining step is authenticated: this is a sign-in,
  // not a wizard step, and it discloses nothing `/sign-in` does not.
  if (stage === "SIGN_IN_REQUIRED") redirect("/sign-in");

  const t = await getTranslations();
  const step = stage === "TOKEN" ? 1 : stage === "ADMINISTRATOR" ? 2 : 3;

  return (
    <main className="container py-5" style={{ maxWidth: "34rem" }}>
      <h1 className="h3">{t("setupWizard.title")}</h1>
      <p className="text-muted">{t("setupWizard.subtitle")}</p>

      <ol className="list-unstyled d-flex gap-3 my-4 small">
        {[1, 2, 3].map((index) => (
          <li
            key={index}
            className={index === step ? "fw-bold" : "text-muted"}
            aria-current={index === step ? "step" : undefined}
          >
            {index}. {t(`setupWizard.steps.${index}` as "setupWizard.steps.1")}
          </li>
        ))}
      </ol>

      {stage === "TOKEN" ? (
        // The PATH, never the value (D-101). It is a constant, not a secret —
        // and telling the operator where to look is the whole usability of a
        // credential that deliberately does not appear in the log.
        <TokenStep tokenPath={setupTokenPath()} />
      ) : null}

      {stage === "ADMINISTRATOR" ? <AdministratorStep /> : null}

      {stage === "ENROLMENT" && session ? (
        <>
          <p>{t("setupWizard.enrolment.intro")}</p>
          {/* THE SAME COMPONENT `/mfa-enrolment` RENDERS, and the same Server
              Actions behind it (D-185). A second enrolment implementation would
              be a second place for the TOTP secret to reach — the one thing
              that flow exists to prevent. On success it redirects to `/`, by
              which time setup is complete and this page is a 404. */}
          <EnrolmentFlow email={session.userAccount.email} />
        </>
      ) : null}
    </main>
  );
}
