"use client";

/**
 * The enrolment screen's two steps, in one client component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A CLIENT COMPONENT AT ALL, WHEN SIGN-IN IS PLAIN FORMS
 *
 * `sign-in/page.tsx` decides which of its two forms to show from a cookie, so
 * it needs no client JavaScript. This step cannot: the QR code exists only in
 * the RESPONSE to the "start enrolment" POST, and it must not exist anywhere
 * else. Putting it in a URL would write the secret into browser history and
 * every proxy log between here and the operator; putting it in a cookie or a
 * session row would store it a second time beside the copy Better Auth already
 * encrypts. `useActionState` keeps it in the POST response and in memory, which
 * is the shortest life this value can have while still being scannable.
 *
 * TWO INDEPENDENT `useActionState` HOOKS, and that is load-bearing rather than
 * stylistic: a wrong six-digit code must re-render the SAME QR code, not clear
 * it. One shared state would replace the artefact with the verify step's error
 * and send the operator back to the password form for a typo.
 *
 * A RELOAD LOSES THE QR, deliberately, and the page says so. The way back is to
 * enter the password again — `enableTwoFactor` replaces the unverified factor
 * rather than adding a second one, so the old code simply stops working.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";

import { startEnrolment, verifyEnrolment } from "./actions";
import type { StartEnrolmentState, VerifyEnrolmentState } from "./state";

const START_IDLE: StartEnrolmentState = { status: "idle" };
const VERIFY_IDLE: VerifyEnrolmentState = { status: "idle" };

export function EnrolmentFlow({ email }: { email: string }) {
  const t = useTranslations();
  const [start, startAction, starting] = useActionState(
    startEnrolment,
    START_IDLE,
  );
  const [verify, verifyAction, verifying] = useActionState(
    verifyEnrolment,
    VERIFY_IDLE,
  );

  if (start.status !== "ready") {
    return (
      <>
        <p>{t("mfaEnrolment.intro", { email })}</p>
        <p className="text-muted">{t("mfaEnrolment.whyPassword")}</p>

        {start.status === "error" ? (
          <div className="alert alert-danger" role="alert">
            {start.reason === "password"
              ? t("mfaEnrolment.badPassword")
              : t("mfaEnrolment.unavailable")}
          </div>
        ) : null}

        <form action={startAction}>
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
              autoFocus
              required
            />
          </div>
          <button
            className="btn btn-primary w-100"
            type="submit"
            disabled={starting}
          >
            {t("mfaEnrolment.start")}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <p>{t("mfaEnrolment.scan")}</p>

      <div className="text-center my-4">
        {/* Built from the QR matrix in `@/lib/auth/totp-qr`, one sub-path per
            dark module. `d` is digits and path commands only — there is no
            HTML injection point here, and the otpauth URI itself (which
            carries the secret) never reaches the markup. */}
        <svg
          role="img"
          aria-label={t("mfaEnrolment.qrAlt")}
          viewBox={`0 0 ${start.qrSize} ${start.qrSize}`}
          width="240"
          height="240"
          style={{ background: "#fff" }}
        >
          <path d={start.qrPath} fill="#000" />
        </svg>
      </div>

      <div className="mb-4">
        <p className="mb-1">{t("mfaEnrolment.manualKeyLabel")}</p>
        <code className="user-select-all d-block p-2 bg-light">
          {start.manualKey}
        </code>
        <p className="form-text mb-0">{t("mfaEnrolment.manualKeyHelp")}</p>
      </div>

      <details className="mb-4">
        <summary>{t("mfaEnrolment.backupCodesTitle")}</summary>
        <p className="form-text">{t("mfaEnrolment.backupCodesHelp")}</p>
        <ul className="list-unstyled mb-0">
          {start.backupCodes.map((backupCode) => (
            <li key={backupCode}>
              <code className="user-select-all">{backupCode}</code>
            </li>
          ))}
        </ul>
      </details>

      {verify.status === "error" ? (
        <div className="alert alert-danger" role="alert">
          {t("signIn.badCode")}
        </div>
      ) : null}

      <form action={verifyAction}>
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
          <div className="form-text">{t("mfaEnrolment.codeHelp")}</div>
        </div>
        <button
          className="btn btn-primary w-100"
          type="submit"
          disabled={verifying}
        >
          {t("mfaEnrolment.verify")}
        </button>
      </form>

      <p className="form-text mt-3">{t("mfaEnrolment.reloadWarning")}</p>
    </>
  );
}
