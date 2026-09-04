import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "@/lib/auth/session";
import { isSetupIncomplete } from "@/lib/boot";

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
 * other privileged operation — and it means there is no unauthenticated
 * administrative surface open on this instance at all, not even a bounded one.
 *
 * Phase 1.1 gives it its first domain link: the `people` register. There is
 * still deliberately little else — a landing page that lists modules nobody
 * has built is a promise, not a product.
 */
export default async function LandingPage() {
  const [t, setupIncomplete, session] = await Promise.all([
    getTranslations(),
    isSetupIncomplete(),
    getCurrentSession(),
  ]);

  if (setupIncomplete) {
    return (
      <main className="container py-5">
        <h1>{t("landing.title")}</h1>
        <div className="alert alert-info mt-4" role="status">
          <h2 className="h5">{t("setup.title")}</h2>
          <p>{t("setup.explanation")}</p>
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

  return (
    <main className="container py-5">
      <BreakGlassBanner />
      <h1>{t("landing.title")}</h1>
      <p className="lead">{t("landing.tagline")}</p>
      <p className="text-muted">{t("landing.foundationNotice")}</p>
      {session ? (
        <>
          <p>{t("landing.signedInAs", { email: session.userAccount.email })}</p>
          {/* The first domain surface. Shown to anyone signed in and NOT gated
              here on a permission: §1.1 rule 1 keeps UI gating and
              authorization on separate code paths, and the screen itself
              refuses — with a denial that says which permission is missing —
              rather than pretending it does not exist. Hiding it would also be
              the wrong lesson: a volunteer who cannot see the link cannot ask
              for the grant. */}
          <Link className="btn btn-primary" href="/people">
            {t("landing.toPeople")}
          </Link>
        </>
      ) : (
        <Link className="btn btn-primary" href="/sign-in">
          {t("signIn.title")}
        </Link>
      )}
    </main>
  );
}
