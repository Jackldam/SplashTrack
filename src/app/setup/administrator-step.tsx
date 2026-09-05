"use client";

/**
 * Step 2 — the organisation, and the first administrator.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PASSWORD IS TYPED TWICE, AND THAT IS THE POINT OF THIS SCREEN
 *
 * The first administrator used to be created by a CLI prompt. The owner's
 * terminal mangled the input, so he typed a password he could not reproduce and
 * was locked out of his own instance — with no confirmation field to catch it
 * and no echo to check it against. A browser can do both, and it does: two
 * fields, compared SERVER-SIDE in `./actions.ts` (the check here is a
 * convenience for the operator, never the control).
 *
 * A CLIENT COMPONENT so a rejected submission comes back without a redirect. An
 * error carried in a URL would put the operator's email address into browser
 * history and into every proxy log on the way — and re-typing an organisation
 * name and an address because a password was eight characters short is exactly
 * the friction this whole screen exists to remove.
 *
 * NOTHING HERE VALIDATES THE PASSWORD BEYOND ITS LENGTH, and that is the
 * product's rule rather than an omission: `PASSWORD_POLICY` is two bounds, and
 * the design chose strong-and-usable over complexity theatre.
 */

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";

import { PASSWORD_POLICY } from "@/lib/auth/password-policy";

import { createFirstAdministrator } from "./actions";
import type { AdministratorStepState } from "./state";

const IDLE: AdministratorStepState = { status: "idle" };

export function AdministratorStep() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(
    createFirstAdministrator,
    IDLE,
  );

  // Local mirror of the two password fields, for the live "these do not match"
  // hint. It never gates submission — the server decides — and it is what turns
  // a typo into something the operator sees before they lose the tab.
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatchId = useId();
  const mismatch = confirmation.length > 0 && password !== confirmation;

  return (
    <>
      <h2 className="h5">{t("setupWizard.administrator.heading")}</h2>
      <p>{t("setupWizard.administrator.explanation")}</p>

      {state.status === "error" ? (
        <div className="alert alert-danger" role="alert">
          {t(`setupWizard.administrator.errors.${state.reason}` as never)}
        </div>
      ) : null}

      <form action={action}>
        <div className="mb-3">
          <label className="form-label" htmlFor="organizationName">
            {t("setupWizard.administrator.organizationName")}
          </label>
          <input
            className="form-control"
            id="organizationName"
            name="organizationName"
            type="text"
            maxLength={120}
            autoComplete="organization"
            autoFocus
            required
          />
          <div className="form-text">
            {t("setupWizard.administrator.organizationNameHelp")}
          </div>
        </div>

        <hr className="my-4" />

        <div className="mb-3">
          <label className="form-label" htmlFor="name">
            {t("setupWizard.administrator.name")}
          </label>
          <input
            className="form-control"
            id="name"
            name="name"
            type="text"
            maxLength={200}
            autoComplete="name"
            required
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="email">
            {t("setupWizard.administrator.email")}
          </label>
          <input
            className="form-control"
            id="email"
            name="email"
            type="email"
            maxLength={254}
            autoComplete="username"
            required
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="password">
            {t("setupWizard.administrator.password")}
          </label>
          <input
            className="form-control"
            id="password"
            name="password"
            type="password"
            minLength={PASSWORD_POLICY.minLength}
            maxLength={PASSWORD_POLICY.maxLength}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <div className="form-text">
            {t("setupWizard.administrator.passwordHelp", {
              min: PASSWORD_POLICY.minLength,
            })}
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="passwordConfirmation">
            {t("setupWizard.administrator.passwordConfirmation")}
          </label>
          <input
            className="form-control"
            id="passwordConfirmation"
            name="passwordConfirmation"
            type="password"
            minLength={PASSWORD_POLICY.minLength}
            maxLength={PASSWORD_POLICY.maxLength}
            autoComplete="new-password"
            aria-describedby={mismatch ? mismatchId : undefined}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
          {mismatch ? (
            <div className="form-text text-danger" id={mismatchId} role="alert">
              {t("setupWizard.administrator.errors.passwordMismatch")}
            </div>
          ) : null}
        </div>

        <p className="form-text">{t("setupWizard.administrator.thenMfa")}</p>

        <button
          className="btn btn-primary w-100"
          type="submit"
          disabled={pending}
        >
          {pending
            ? t("setupWizard.administrator.working")
            : t("setupWizard.administrator.submit")}
        </button>
      </form>
    </>
  );
}
