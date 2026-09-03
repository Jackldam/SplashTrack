import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "@/lib/auth/session";
import { isSetupIncomplete } from "@/lib/boot";

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
 * MFA is not offered here, it is the only path: every account on this
 * installation is created with a verified TOTP factor (D-141's invariant), so
 * there is no branch for an account without one.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // An instance that is not set up has no account to sign in to, and the notice
  // that says how to create one lives on the landing page.
  if (await isSetupIncomplete()) redirect("/");
  if (await getCurrentSession()) redirect("/");

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
