import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError, requirePermission } from "@/lib/authorization";
import {
  categoriesInUse,
  getEffectiveSettings,
  type EffectiveSetting,
} from "@/modules/settings";

import { updateSettingAction } from "./actions";

/**
 * `Admin → Settings` (R-17, `13-…` §3.2) — one plain page, grouped by
 * category, ~15 settings. `invariant` settings render as STATED FACTS, never
 * a disabled control (§3.2: "a disabled control invites a support question
 * whose answer is 'no'").
 *
 * NOT BUILT HERE, FLAGGED, on the `backup/page.tsx` precedent: there is no
 * parent "Admin" menu yet and this page is reachable only by its URL (plus
 * the landing page's link, added in this same phase). Building the admin
 * shell is out of scope.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string; field?: string }>;
}) {
  const [t, params, session] = await Promise.all([
    getTranslations(),
    searchParams,
    requireEnrolledSession(),
  ]);

  let denied: string | null = null;
  try {
    await requirePermission(
      { personId: session.person.id },
      "organization.settings.manage",
      { organization: true },
    );
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      denied = error.permission;
    } else {
      throw error;
    }
  }

  if (denied) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/">{t("settings.backToHome")}</Link>
        </nav>
        <h1>{t("settings.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("settings.denied.title")}</h2>
          <p className="mb-0">
            {t("settings.denied.explanation", { permission: denied })}
          </p>
        </div>
      </main>
    );
  }

  const settings = await getEffectiveSettings();
  const categories = categoriesInUse();
  const byCategory = new Map<string, EffectiveSetting[]>();
  for (const category of categories) byCategory.set(category, []);
  for (const setting of settings) {
    byCategory.get(setting.definition.category)?.push(setting);
  }

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/">{t("settings.backToHome")}</Link>
      </nav>
      <h1>{t("settings.title")}</h1>
      <p className="lead">{t("settings.subtitle")}</p>

      {params.updated && (
        <div className="alert alert-success" role="status">
          {t("settings.updated", { key: params.updated })}
        </div>
      )}
      {params.error === "denied" && (
        <div className="alert alert-danger" role="alert">
          {t("settings.denied.explanation", {
            permission: "organization.settings.manage",
          })}
        </div>
      )}
      {params.error === "lockout_invariant" && (
        <div className="alert alert-danger" role="alert">
          {t("settings.lockoutInvariantRefused")}
        </div>
      )}
      {params.error === "validation" && (
        <div className="alert alert-danger" role="alert">
          {t("settings.validationFailed", { field: params.field ?? "" })}
        </div>
      )}
      {params.error === "unknown_setting" && (
        <div className="alert alert-danger" role="alert">
          {t("settings.unknownSetting")}
        </div>
      )}

      {categories.map((category) => {
        const entries = byCategory.get(category) ?? [];
        if (entries.length === 0) return null;
        return (
          <section key={category} className="mb-5">
            <h2 className="h4">{category}</h2>
            <div className="list-group">
              {entries.map((setting) => (
                <SettingRow key={setting.definition.key} setting={setting} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function SettingRow({ setting }: { setting: EffectiveSetting }) {
  const { definition } = setting;

  if (definition.class === "invariant") {
    return (
      <div className="list-group-item">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <div className="fw-semibold">{definition.key}</div>
            <div className="text-muted small">{definition.description}</div>
          </div>
          <span
            className="badge text-bg-secondary"
            data-testid="invariant-badge"
          >
            Vastgelegd — niet aanpasbaar
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="list-group-item">
      <form action={updateSettingAction} className="row g-2 align-items-center">
        <input type="hidden" name="key" value={definition.key} />
        <div className="col-md-5">
          <div className="fw-semibold">{definition.key}</div>
          <div className="text-muted small">{definition.description}</div>
          {definition.class === "bounded" && definition.bounds && (
            <div className="text-muted small">
              Grenzen: {definition.bounds.min ?? "—"}–
              {definition.bounds.max ?? "—"}
            </div>
          )}
          <div className="text-muted small">
            Bron:{" "}
            {setting.source === "database" ? "database" : "standaardwaarde"}
          </div>
        </div>
        <div className="col-md-5">
          <ValueField setting={setting} />
        </div>
        <div className="col-md-2">
          <button type="submit" className="btn btn-outline-primary btn-sm">
            Opslaan
          </button>
        </div>
      </form>
    </div>
  );
}

function ValueField({ setting }: { setting: EffectiveSetting }) {
  const { definition, value, secretSet } = setting;

  if (definition.type === "boolean") {
    return (
      <select
        name="value"
        defaultValue={value === true ? "true" : "false"}
        className="form-select form-select-sm"
        aria-label={definition.key}
      >
        <option value="true">Aan</option>
        <option value="false">Uit</option>
      </select>
    );
  }

  if (definition.type === "secret") {
    return (
      <input
        type="password"
        name="value"
        placeholder={
          secretSet
            ? "•••••••• (ingesteld — laat leeg om te behouden)"
            : "niet ingesteld"
        }
        className="form-control form-control-sm"
        aria-label={definition.key}
        autoComplete="new-password"
      />
    );
  }

  if (definition.type === "number") {
    return (
      <input
        type="number"
        name="value"
        defaultValue={typeof value === "number" ? value : ""}
        className="form-control form-control-sm"
        aria-label={definition.key}
      />
    );
  }

  if (definition.key === "appearance.dateFormat") {
    return (
      <select
        name="value"
        defaultValue={typeof value === "string" ? value : ""}
        className="form-select form-select-sm"
        aria-label={definition.key}
      >
        <option value="short">short</option>
        <option value="medium">medium</option>
        <option value="long">long</option>
      </select>
    );
  }

  return (
    <input
      type="text"
      name="value"
      defaultValue={typeof value === "string" ? value : ""}
      className="form-control form-control-sm"
      aria-label={definition.key}
    />
  );
}
