import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "@/lib/auth/session";
import { MFA_ENROLMENT_PATH } from "@/lib/auth/mfa-enrolment";
import { resolveSetupStage } from "@/lib/boot";

import {
  abandonChallenge,
  signInWithPassword,
  verifyTotpCode,
} from "./actions";
import { hasTwoFactorChallenge } from "./challenge";

/**
 * Sign in: password, then the second factor. Two forms, one page, no client
 * JavaScript — which step is shown is decided server-side by whether the
 * two-factor challenge cookie is present.
 *
 * MFA IS NOT OFFERED HERE, IT IS THE ONLY PATH for an account that has one:
 * the code step is shown whenever Better Auth left a challenge cookie, which it
 * does for every account with a verified factor.
 *
 * The account that has NOT got one yet — D-185's `mfa_pending` window between
 * `admin:create` and browser enrolment — signs in with the password ALONE,
 * because there is no second factor to ask for. It does not land anywhere
 * useful: every protected surface sends it to `/mfa-enrolment`, and this page
 * takes it there directly rather than to a landing page it would bounce off.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // An instance with NO ACCOUNT AT ALL has nothing to sign in to, and the
  // notice that says how to create one lives on the landing page. An instance
  // whose administrator has not enrolled yet is a different case and must NOT
  // be redirected: signing in is exactly how that administrator reaches
  // enrolment (D-185).
  if ((await resolveSetupStage()) === "NO_ADMINISTRATOR") redirect("/");

  const existing = await getCurrentSession();
  if (existing) redirect(existing.mfaPending ? MFA_ENROLMENT_PATH : "/");

  const [t, { error }, challenge] = await Promise.all([
    getTranslations(),
    searchParams,
    hasTwoFactorChallenge(),
  ]);

  return (
    <main className="container py-5" style={{ maxWidth: "26rem" }}>
      <h1 className="h3 mb-4">{t("signIn.title")}</h1>

      {error ? (
        <div className="alert alert-danger" role="alert">
          {/* One message for every failure — see `./actions.ts`. */}
          {error === "code" ? t("signIn.badCode") : t("signIn.badCredentials")}
        </div>
      ) : null}

      {challenge ? (
        <form action={verifyTotpCode}>
          <p className="text-muted">{t("signIn.codePrompt")}</p>
          <div className="mb-3">
            <label className="form-label" htmlFor="code">
              {t("signIn.code")}
            </label>
            <input
              className="form-control"
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          </div>
          <button className="btn btn-primary w-100" type="submit">
            {t("signIn.verify")}
          </button>
        </form>
      ) : (
        <form action={signInWithPassword}>
          <div className="mb-3">
            <label className="form-label" htmlFor="email">
              {t("signIn.email")}
            </label>
            <input
              className="form-control"
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="password">
              {t("signIn.password")}
            </label>
            <input
              className="form-control"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn btn-primary w-100" type="submit">
            {t("signIn.submit")}
          </button>
        </form>
      )}

      {challenge ? (
        <form action={abandonChallenge} className="mt-3">
          <button className="btn btn-link p-0" type="submit">
            {t("signIn.startOver")}
          </button>
        </form>
      ) : null}
    </main>
  );
}
