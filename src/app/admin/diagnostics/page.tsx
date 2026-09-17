import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError, requirePermission } from "@/lib/authorization";
import { buildDiagnosticsReport } from "@/modules/settings";

/**
 * `Admin → Diagnostics` (R-21, `13-…` §8) — "borrowed directly from
 * Vaultwarden": one screen, safe to paste into a public GitHub issue. Gated
 * on `diagnostics.read` at `ORGANIZATION` scope (D-156), never served
 * unauthenticated.
 *
 * RENDERS NO SECRETS AND NO PERSONAL DATA (F-20). `sensitive` settings show
 * only `secretSet`; every other value is instance-wide configuration, never a
 * person's data.
 *
 * NOT BUILT HERE, FLAGGED: no parent "Admin" menu — reachable by URL, same as
 * `/admin/settings` and `/admin/backup`. See `buildDiagnosticsReport`'s own
 * header for the §8 items this phase does not build (email test-send, the
 * update-advisory check, key-custody fingerprint match) and reports as
 * "not implemented" / "not tracked" rather than fabricating an answer.
 */
export default async function DiagnosticsPage() {
  const [t, session] = await Promise.all([
    getTranslations(),
    requireEnrolledSession(),
  ]);

  let denied: string | null = null;
  try {
    await requirePermission(
      { personId: session.person.id },
      "diagnostics.read",
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
          <Link href="/">{t("diagnostics.backToHome")}</Link>
        </nav>
        <h1>{t("diagnostics.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("diagnostics.denied.title")}</h2>
          <p className="mb-0">
            {t("diagnostics.denied.explanation", { permission: denied })}
          </p>
        </div>
      </main>
    );
  }

  const report = await buildDiagnosticsReport();

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/">{t("diagnostics.backToHome")}</Link>
      </nav>
      <h1>{t("diagnostics.title")}</h1>
      <p className="lead">{t("diagnostics.subtitle")}</p>
      <div className="alert alert-info" role="status">
        {report.setupTokenWarning}
      </div>

      <section className="mb-4">
        <h2 className="h5">Versie</h2>
        <p>{report.version}</p>
        <p className="text-muted small">
          Advisory-status: {report.advisoryStatus}
        </p>
      </section>

      <section className="mb-4">
        <h2 className="h5">Database</h2>
        <p data-testid="diag-db-status">
          {report.database.connected ? "Verbonden" : "NIET verbonden"}
        </p>
      </section>

      <section className="mb-4">
        <h2 className="h5">Migratiestatus</h2>
        <p data-testid="diag-migration-state">{report.migrations.state}</p>
        {report.migrations.pendingMigrations.length > 0 && (
          <p className="text-muted small">
            Nog toe te passen: {report.migrations.pendingMigrations.join(", ")}
          </p>
        )}
      </section>

      <section className="mb-4">
        <h2 className="h5">Audit-keten</h2>
        <p data-testid="diag-audit-chain">
          {report.auditChain.valid ? "Intact" : "NIET intact"} —{" "}
          {report.auditChain.count} events, {report.auditChain.prunedSegments}{" "}
          verwijderde segmenten
        </p>
      </section>

      <section className="mb-4">
        <h2 className="h5">D-141 — lokaal MFA-beheerdersaccount</h2>
        <p data-testid="diag-lockout-invariant">
          {report.lockoutInvariant.holds
            ? `In orde (${report.lockoutInvariant.qualifyingAccounts} account(s))`
            : "NIET in orde — geen enkel lokaal ORGANIZATION-gescoped account met geverifieerde MFA"}
        </p>
      </section>

      <section className="mb-4">
        <h2 className="h5">Recovery Kit / backups</h2>
        <p>
          Recovery Kit geïnitialiseerd:{" "}
          {report.recoveryKit.initialized ? "ja" : "nee"}
        </p>
        <p className="text-muted small">
          Leeftijd laatste backup: {report.recoveryKit.lastBackupAge}
        </p>
        <p className="text-muted small">
          Onder oudere keyId versleuteld: {report.supersededKeyColumns}
        </p>
      </section>

      <section className="mb-4">
        <h2 className="h5">Sleutelbeheer</h2>
        <p>Bron van SECRET_KEY: {report.secretKey.source}</p>
        {report.secretKey.deprecatedEnvironmentWarning && (
          <div className="alert alert-warning" role="alert">
            SECRET_KEY is ingesteld als platte omgevingsvariabele, niet via
            SECRET_KEY_FILE. Dit is verouderd — zie de documentatie.
          </div>
        )}
      </section>

      <section className="mb-4">
        <h2 className="h5">Effectieve configuratie</h2>
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Instelling</th>
              <th>Categorie</th>
              <th>Waarde</th>
              <th>Herkomst</th>
              <th>Live?</th>
            </tr>
          </thead>
          <tbody>
            {report.effectiveSettings.map((setting) => (
              <tr key={setting.definition.key}>
                <td>{setting.definition.key}</td>
                <td>{setting.definition.category}</td>
                <td data-testid={`diag-value-${setting.definition.key}`}>
                  {setting.definition.sensitive
                    ? setting.secretSet
                      ? "ingesteld"
                      : "niet ingesteld"
                    : String(setting.value)}
                </td>
                <td>{setting.source}</td>
                <td>{setting.definition.appliesLive ? "ja" : "nee"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
