import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getAwardTypeForPrincipal } from "@/modules/skills";

import { formatCalendarDate } from "../format";
import { guarded, requireSignedIn } from "../access";
import { createCriterionSetAction, updateAwardTypeAction } from "../actions";

/**
 * One award type — what it is, and the versions of what it takes.
 *
 * THE CRITERION SETS ARE THE POINT OF THIS SCREEN, on the
 * `src/app/courses/[courseId]/page.tsx` precedent: an award type on its own
 * is a name and a kind. What makes it useful is its `CriterionSet` history —
 * every version ever published, in what state, and how many requirements each
 * one carries.
 *
 * "ADD A VERSION" IS OFFERED ONLY WHEN NONE IS OPEN. D-081/the domain module's
 * `createCriterionSet`: one `DRAFT` at a time. The screen mirrors that rather
 * than letting the service's refusal be the first place it is discovered.
 */
export default async function AwardTypeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ awardTypeId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [t, { awardTypeId }, query, session] = await Promise.all([
    getTranslations(),
    params,
    searchParams,
    requireSignedIn(),
  ]);

  const actor = { principal: { personId: session.person.id } };
  const result = await guarded(() =>
    getAwardTypeForPrincipal(actor, awardTypeId),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/skills">{t("skills.backToList")}</Link>
        </nav>
        <h1>{t("skills.detail.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("skills.denied.title")}</h2>
          <p className="mb-0">
            {t("skills.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const awardType = result.value;
  if (!awardType) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/skills">{t("skills.backToList")}</Link>
        </nav>
        <h1>{t("skills.detail.title")}</h1>
        <p className="text-muted">{t("skills.detail.notFound")}</p>
      </main>
    );
  }

  const hasOpenDraft = awardType.criterionSets.some(
    (set) => set.status === "DRAFT",
  );

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/skills">{t("skills.backToList")}</Link>
      </nav>

      <h1>
        {awardType.name}{" "}
        <span className="text-muted fs-5">({awardType.code})</span>
      </h1>
      <p className="text-muted">
        {t(`skills.kind.${awardType.kind}` as "skills.kind.DIPLOMA")}
        {" · "}
        {t(
          `skills.issuingBody.${awardType.issuingBody}` as "skills.issuingBody.NRZ",
        )}
      </p>

      {query.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`skills.errors.${query.error}` as "skills.errors.validation")}
        </div>
      ) : null}
      {query.saved ? (
        <div className="alert alert-success" role="status">
          {t(`skills.saved.${query.saved}` as "skills.saved.awardType")}
        </div>
      ) : null}

      <h2 className="h5 mt-4">{t("skills.criterionSets.title")}</h2>
      {awardType.criterionSets.length === 0 ? (
        <p className="text-muted">{t("skills.criterionSets.empty")}</p>
      ) : (
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th scope="col">{t("skills.criterionSets.columns.version")}</th>
              <th scope="col">{t("skills.criterionSets.columns.status")}</th>
              <th scope="col">{t("skills.criterionSets.columns.source")}</th>
              <th scope="col">{t("skills.criterionSets.columns.criteria")}</th>
              <th scope="col">
                {t("skills.criterionSets.columns.effectiveFrom")}
              </th>
              <th scope="col">
                {t("skills.criterionSets.columns.effectiveTo")}
              </th>
            </tr>
          </thead>
          <tbody>
            {awardType.criterionSets.map((set) => (
              <tr key={set.id}>
                <td>
                  <Link href={`/skills/${awardType.id}/sets/${set.id}`}>
                    v{set.version}
                  </Link>
                </td>
                <td>
                  {t(
                    `skills.criterionSetStatus.${set.status}` as "skills.criterionSetStatus.DRAFT",
                  )}
                </td>
                <td>
                  {t(
                    `skills.issuingBody.${set.source}` as "skills.issuingBody.NRZ",
                  )}
                </td>
                <td>{set.criterionCount}</td>
                <td>
                  {set.effectiveFrom
                    ? formatCalendarDate(set.effectiveFrom)
                    : "—"}
                </td>
                <td>
                  {set.effectiveTo ? formatCalendarDate(set.effectiveTo) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasOpenDraft ? (
        <p className="form-text">{t("skills.criterionSets.openDraftNote")}</p>
      ) : (
        <details className="mt-3">
          <summary>{t("skills.criterionSets.addTitle")}</summary>
          <form action={createCriterionSetAction} className="row g-2 mt-2">
            <input type="hidden" name="awardTypeId" value={awardType.id} />
            <div className="col-md-4">
              <label className="form-label" htmlFor="newSetSource">
                {t("skills.fields.source")}
              </label>
              <select
                className="form-select"
                id="newSetSource"
                name="source"
                required
              >
                <option value="ORG">{t("skills.issuingBody.ORG")}</option>
                <option value="NRZ">{t("skills.issuingBody.NRZ")}</option>
              </select>
              <div className="form-text">{t("skills.fields.sourceHelp")}</div>
            </div>
            <div className="col-12">
              <button className="btn btn-outline-primary" type="submit">
                {t("skills.criterionSets.add")}
              </button>
            </div>
          </form>
        </details>
      )}

      <details className="mt-5">
        <summary className="h5">{t("skills.edit.title")}</summary>
        <form action={updateAwardTypeAction} className="row g-3 mt-2">
          <input type="hidden" name="awardTypeId" value={awardType.id} />
          <div className="col-md-5">
            <label className="form-label" htmlFor="editName">
              {t("skills.fields.name")}
            </label>
            <input
              className="form-control"
              id="editName"
              name="name"
              defaultValue={awardType.name}
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="editIssuingBody">
              {t("skills.fields.issuingBody")}
            </label>
            <select
              className="form-select"
              id="editIssuingBody"
              name="issuingBody"
              defaultValue={awardType.issuingBody}
              required
            >
              <option value="NRZ">{t("skills.issuingBody.NRZ")}</option>
              <option value="ORG">{t("skills.issuingBody.ORG")}</option>
            </select>
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("skills.edit.submit")}
            </button>
            <span className="form-text ms-3">
              {t("skills.edit.codeKindNote")}
            </span>
          </div>
        </form>
      </details>
    </main>
  );
}
