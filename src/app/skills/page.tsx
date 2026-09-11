import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { listAwardTypesForPrincipal } from "@/modules/skills";

import { guarded, requireSignedIn } from "./access";
import { createAwardTypeAction } from "./actions";
import { CatalogueJsonPanel } from "./catalogue-json-panel";

/**
 * The award-type catalogue — *Diploma's en certificaten*.
 *
 * `{ organization: true }`-GATED, AND THAT IS THE ORDINARY CASE. D-164 puts
 * this screen on the critical path: nothing can be assessed before at least
 * one `AwardType` with a published `CriterionSet` exists. But `skills.read`
 * has no scope narrower than `ORGANIZATION` to hold it at (the catalogue has
 * no `ResourceRef` kind of its own — see `award-type-service.ts`), so this
 * list is visible only to an `ORGANIZATION`-scoped principal, typically the
 * Instance Administrator. An ordinary instructor is refused here by design,
 * the same way `/courses` refuses everyone but a `COURSE`- or
 * `ORGANIZATION`-scoped principal.
 */
export default async function SkillsListPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [t, params, session] = await Promise.all([
    getTranslations(),
    searchParams,
    requireSignedIn(),
  ]);

  const result = await guarded(() =>
    listAwardTypesForPrincipal({ principal: { personId: session.person.id } }),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <h1>{t("skills.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("skills.denied.title")}</h2>
          <p className="mb-0">
            {t("skills.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const awardTypes = result.value;

  return (
    <main className="container py-5">
      <h1>{t("skills.title")}</h1>
      <p className="text-muted">{t("skills.subtitle")}</p>

      {params.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`skills.errors.${params.error}` as "skills.errors.validation")}
        </div>
      ) : null}

      {awardTypes.length === 0 ? (
        <p className="text-muted">{t("skills.empty")}</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th scope="col">{t("skills.columns.code")}</th>
              <th scope="col">{t("skills.columns.name")}</th>
              <th scope="col">{t("skills.columns.kind")}</th>
              <th scope="col">{t("skills.columns.issuingBody")}</th>
              <th scope="col">{t("skills.columns.criterionSets")}</th>
              <th scope="col">{t("skills.columns.status")}</th>
            </tr>
          </thead>
          <tbody>
            {awardTypes.map((awardType) => (
              <tr key={awardType.id}>
                <td>
                  <Link href={`/skills/${awardType.id}`}>{awardType.code}</Link>
                </td>
                <td>{awardType.name}</td>
                <td>
                  {t(`skills.kind.${awardType.kind}` as "skills.kind.DIPLOMA")}
                </td>
                <td>
                  {t(
                    `skills.issuingBody.${awardType.issuingBody}` as "skills.issuingBody.NRZ",
                  )}
                </td>
                <td>{awardType.criterionSetCount}</td>
                <td>
                  {awardType.hasActiveCriterionSet ? (
                    <span className="badge text-bg-success">
                      {t("skills.hasActiveSet")}
                    </span>
                  ) : (
                    <span className="badge text-bg-secondary">
                      {t("skills.noActiveSet")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="mt-5">
        <summary className="h5">{t("skills.create.title")}</summary>
        <form action={createAwardTypeAction} className="row g-3 mt-2">
          <div className="col-md-3">
            <label className="form-label" htmlFor="code">
              {t("skills.fields.code")}
            </label>
            <input
              className="form-control"
              id="code"
              name="code"
              required
              maxLength={40}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="name">
              {t("skills.fields.name")}
            </label>
            <input
              className="form-control"
              id="name"
              name="name"
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="kind">
              {t("skills.fields.kind")}
            </label>
            <select className="form-select" id="kind" name="kind" required>
              <option value="DIPLOMA">{t("skills.kind.DIPLOMA")}</option>
              <option value="CERTIFICATE">
                {t("skills.kind.CERTIFICATE")}
              </option>
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="issuingBody">
              {t("skills.fields.issuingBody")}
            </label>
            <select
              className="form-select"
              id="issuingBody"
              name="issuingBody"
              required
            >
              <option value="NRZ">{t("skills.issuingBody.NRZ")}</option>
              <option value="ORG">{t("skills.issuingBody.ORG")}</option>
            </select>
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("skills.create.submit")}
            </button>
          </div>
        </form>
      </details>

      <CatalogueJsonPanel />
    </main>
  );
}
