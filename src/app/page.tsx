import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "@/lib/auth/session";
import { MFA_ENROLMENT_PATH } from "@/lib/auth/mfa-enrolment";
import { resolveSetupStage } from "@/lib/boot";

import { BreakGlassBanner } from "./break-glass-banner";

/**
 * The landing page, which is also — until D-039's wizard exists — where an
 * unconfigured installation says so.
 *
 * THE SETUP NOTICE IS NOT THE WIZARD. `13-…` §6 puts a browser wizard here that
 * asks the one question only the operator can answer ("new installation, or
 * restore from backup?") and then creates the first administrator. That is
 * phase 1. What this renders instead is the honest reduction: the question is
 * answered on the HOST, by `splashtrack admin:create`, which is the same
 * host-access-is-proof-of-ownership pattern D-101 and §7 already use for every
 * other privileged operation.
 *
 * SINCE D-185 THE NOTICE HAS TWO UNFINISHED STATES, not one, because
 * `admin:create` no longer completes setup — enrolling the administrator's
 * second factor does, in the browser. Telling somebody to run `admin:create`
 * when they have already run it, and are one sign-in away from finishing, is
 * worse than saying nothing, so the two remedies are separate screens:
 *
 *   NO_ADMINISTRATOR            the host command.
 *   ADMINISTRATOR_PENDING_MFA   a link to sign in, and what will happen next.
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

  if (stage === "NO_ADMINISTRATOR") {
    return (
      <main className="container py-5">
        <h1>{t("landing.title")}</h1>
        <div className="alert alert-info mt-4" role="status">
          <h2 className="h5">{t("setup.title")}</h2>
          <p>{t("setup.noAdministrator")}</p>
          <pre className="mb-0">
            <code>
              docker compose exec app splashtrack admin:create \{"\n"}
              {"    "}--email you@example.org --name &apos;Your Name&apos;
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
