"use client";

/**
 * Step 1 — the one-time setup token (D-101).
 *
 * A CLIENT COMPONENT, for the same reason the enrolment step is one: the
 * failure has to come back without a redirect. A `redirect("/setup?error=…")`
 * would work, but a token typed into a form that then round-trips through a URL
 * is one careless refactor away from the token itself being in that URL — and a
 * URL is in browser history, in the Referer header and in every proxy log
 * between here and the operator. `useActionState` keeps both the submission and
 * its verdict in the POST exchange.
 *
 * The input is `type="text"` and not `type="password"`. The operator is
 * transcribing 32 characters from another window; masking them would make a
 * mistyped token the most likely outcome, and the value is on their own screen
 * for the length of one paste either way. It carries `autoComplete="off"` so no
 * password manager offers to keep it.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { submitSetupToken } from "./actions";
import type { TokenStepState } from "./state";

const IDLE: TokenStepState = { status: "idle" };

export function TokenStep({ tokenPath }: { tokenPath: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(submitSetupToken, IDLE);

  return (
    <>
      <h2 className="h5">{t("setupWizard.token.heading")}</h2>
      <p>{t("setupWizard.token.explanation")}</p>

      <pre className="bg-light p-3">
        <code>docker compose exec app cat {tokenPath}</code>
      </pre>

      <p className="form-text">{t("setupWizard.token.whyNotInTheLog")}</p>

      {state.status === "error" ? (
        <div className="alert alert-danger" role="alert">
          {/* One message per genuinely different remedy. "Expired" and "already
              used" both mean `setup:token --new`; "mismatch" means check your
              typing; the lockout means wait. Collapsing them would send the
              operator to the wrong fix. */}
          {t(`setupWizard.token.errors.${state.reason}` as never)}
        </div>
      ) : null}

      <form action={action}>
        <div className="mb-3">
          <label className="form-label" htmlFor="token">
            {t("setupWizard.token.label")}
          </label>
          <input
            className="form-control font-monospace"
            id="token"
            name="token"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            required
          />
          <div className="form-text">{t("setupWizard.token.help")}</div>
        </div>
        <button
          className="btn btn-primary w-100"
          type="submit"
          disabled={pending}
        >
          {t("setupWizard.token.submit")}
        </button>
      </form>
    </>
  );
}
