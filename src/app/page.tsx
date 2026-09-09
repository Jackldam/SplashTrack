import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "@/lib/auth/session";
import { MFA_ENROLMENT_PATH } from "@/lib/auth/mfa-enrolment";
import { resolveSetupStage } from "@/lib/boot";
import { resolveWizardAccess } from "@/lib/setup";

import { BreakGlassBanner } from "./break-glass-banner";

/**
 * The landing page.
 *
 * SETUP MODE IS NO LONGER ITS JOB (D-187). `13-…` §6 says every request in
 * setup mode goes to `/setup`, and now that the wizard exists this page sends
 * them there rather than reproducing a shorter version of it. What survives
 * below is the FALLBACK: the two notices for the cases in which the wizard is
 * not open and the installation is still not set up.
 *
 * There are genuinely two of those, and they have different remedies, so they
 * are different screens (D-185/D-186):
 *
 *   NO_ADMINISTRATOR            the wizard is unreachable — most likely a
 *                               database that could not be read this request —
 *                               so the notice names the host command that
 *                               reopens the path.
 *   ADMINISTRATOR_PENDING_MFA   an account exists and has not enrolled. This is
 *                               reached when the wizard sent an anonymous
 *                               caller to sign in and they came here instead.
 *
 * Phase 1.1 gives it its first domain link: the `people` register. There is
 * still deliberately little else — a landing page that lists modules nobody
 * has built is a promise, not a product.
 */
export default async function LandingPage() {
  const [t, stage, session] = await Promise.all([
    getTranslations(),
    resolveSetupStage(),
    getCurrentSession(),
  ]);

  // ── SETUP MODE BELONGS TO THE WIZARD NOW (D-187) ─────────────────────────
  //
  // `13-…` §6 says every request in setup mode goes to `/setup`, and since the
  // wizard exists that is one redirect rather than a page of instructions.
  //
  // IT IS CONDITIONAL ON THE WIZARD ACTUALLY BEING OPEN, and that is not
  // defensive padding: `resolveSetupStage()` fails toward `NO_ADMINISTRATOR` on
  // an unreadable database, and `resolveWizardAccess()` fails toward `CLOSED`
  // on the same. Redirecting unconditionally would bounce a blip into a 404
  // with no explanation, so an un-open wizard falls through to the notices
  // below — which are the honest description of every remaining case.
  if (stage !== "COMPLETE") {
    const { stage: wizard } = await resolveWizardAccess({
      signedInPending: session?.mfaPending === true,
    });
    if (
      wizard === "TOKEN" ||
      wizard === "ADMINISTRATOR" ||
      wizard === "ENROLMENT"
    ) {
      redirect("/setup");
    }
  }

  if (stage === "NO_ADMINISTRATOR") {
    return (
      <main className="container py-5">
        <h1>{t("landing.title")}</h1>
        <div className="alert alert-info mt-4" role="status">
          <h2 className="h5">{t("setup.title")}</h2>
          <p>{t("setup.noAdministrator")}</p>
          <pre className="mb-0">
            <code>
              docker compose exec app splashtrack setup:token --new{"\n"}
              {"    "}# then open /setup and enter the token it writes
            </code>
          </pre>
        </div>
        <p className="text-muted">{t("setup.noRegistration")}</p>
      </main>
    );
  }

  if (stage === "ADMINISTRATOR_PENDING_MFA") {
    return (
      <main className="container py-5">
        <h1>{t("landing.title")}</h1>
        <div className="alert alert-warning mt-4" role="status">
          <h2 className="h5">{t("setup.pendingTitle")}</h2>
          <p>{t("setup.pendingExplanation")}</p>
          <p className="mb-0">{t("setup.pendingAction")}</p>
        </div>
        {/* The administrator may already be signed in and simply have wandered
            back here — in which case the enrolment page is one click away
            rather than a sign-in away. */}
        <Link
          className="btn btn-primary"
          href={session ? MFA_ENROLMENT_PATH : "/sign-in"}
        >
          {session ? t("landing.toEnrolment") : t("setup.pendingSignIn")}
        </Link>
      </main>
    );
  }

  return (
    <main className="container py-5">
      <BreakGlassBanner />
      <h1>{t("landing.title")}</h1>
      <p className="lead">{t("landing.tagline")}</p>
      <p className="text-muted">{t("landing.foundationNotice")}</p>
      {session ? (
        <>
          <p>{t("landing.signedInAs", { email: session.userAccount.email })}</p>
          {session.mfaPending ? (
            // A pending account on a COMPLETE installation: a second
            // administrator created after setup, or one whose factor was
            // reset. It reaches this branch rather than the notice above,
            // because the installation is not the thing that is unfinished.
            <>
              <p>{t("landing.enrolNotice")}</p>
              <Link className="btn btn-primary" href={MFA_ENROLMENT_PATH}>
                {t("landing.toEnrolment")}
              </Link>
            </>
          ) : (
            /* The first domain surface. Shown to anyone signed in and NOT gated
               here on a permission: §1.1 rule 1 keeps UI gating and
               authorization on separate code paths, and the screen itself
               refuses — with a denial that says which permission is missing —
               rather than pretending it does not exist. Hiding it would also be
               the wrong lesson: a volunteer who cannot see the link cannot ask
               for the grant. */
            <Link className="btn btn-primary" href="/people">
              {t("landing.toPeople")}
            </Link>
          )}
        </>
      ) : (
        <Link className="btn btn-primary" href="/sign-in">
          {t("signIn.title")}
        </Link>
      )}
    </main>
  );
}
