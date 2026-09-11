"use client";

/**
 * D-188's JSON surface, as a screen: an export link (plain navigation — a
 * download is not a state a client component needs to manage) and an upload
 * form (a client component, because reporting "importing…", a per-field
 * result and a refusal that names exactly where in the document it happened
 * all need JavaScript state — a plain `<form action={...}>` server action can
 * only ever redirect to a fixed query-string outcome, which cannot carry a
 * document path like `awardTypes[2].criteria[5]`).
 *
 * Talks to `/api/skills/catalogue` directly (`fetch`, not a Server Action) —
 * see that route's own file comment for why a file download needs a route
 * handler; the upload uses the same route for symmetry rather than a second
 * one.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

interface ImportOutcome {
  readonly kind: "success" | "error";
  readonly message: string;
}

export function CatalogueJsonPanel() {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("file");
    const file =
      input instanceof HTMLInputElement ? input.files?.item(0) : null;
    if (!file) {
      setOutcome({ kind: "error", message: t("skills.json.errorNoFile") });
      return;
    }

    setBusy(true);
    setOutcome(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/skills/catalogue", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as
        | {
            ok: true;
            result: {
              awardTypesProcessed: number;
              criterionSetsProcessed: number;
              criteriaProcessed: number;
            };
          }
        | { error: { message: string } };

      if (!response.ok || "error" in payload) {
        const message =
          "error" in payload ? payload.error.message : response.statusText;
        setOutcome({
          kind: "error",
          message: `${t("skills.json.errorPrefix")} ${message}`,
        });
        return;
      }

      setOutcome({
        kind: "success",
        message: t("skills.json.success", {
          awardTypes: payload.result.awardTypesProcessed,
          criterionSets: payload.result.criterionSetsProcessed,
          criteria: payload.result.criteriaProcessed,
        }),
      });
      form.reset();
    } catch {
      // The `fetch` call itself failed (offline, a network error) — never a
      // shape the server had a chance to report on, so this is the smallest
      // possible fallback rather than a made-up document path.
      setOutcome({
        kind: "error",
        message: `${t("skills.json.errorPrefix")} ${t("skills.errors.validation")}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-5">
      <summary className="h5">{t("skills.json.title")}</summary>
      <p className="text-muted mt-2">{t("skills.json.explanation")}</p>

      <a
        className="btn btn-outline-secondary mb-3"
        href="/api/skills/catalogue"
      >
        {t("skills.json.export")}
      </a>

      <form onSubmit={handleSubmit} className="row g-2 align-items-end">
        <div className="col-md-6">
          <label className="form-label" htmlFor="catalogueJsonFile">
            {t("skills.json.uploadLabel")}
          </label>
          <input
            className="form-control"
            id="catalogueJsonFile"
            name="file"
            type="file"
            accept="application/json,.json"
            required
          />
        </div>
        <div className="col-auto">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? t("skills.json.working") : t("skills.json.upload")}
          </button>
        </div>
      </form>

      {outcome ? (
        <div
          className={`alert ${outcome.kind === "success" ? "alert-success" : "alert-danger"} mt-3`}
          role={outcome.kind === "success" ? "status" : "alert"}
        >
          {outcome.message}
        </div>
      ) : null}
    </details>
  );
}
