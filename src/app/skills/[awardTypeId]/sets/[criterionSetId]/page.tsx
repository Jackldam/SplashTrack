import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  getCriterionSetForPrincipal,
  listGradeScalesForPrincipal,
} from "@/modules/skills";

import { guarded, requireSignedIn } from "../../../access";
import {
  createCriterionAction,
  publishCriterionSetAction,
  updateCriterionAction,
  updateCriterionSetAction,
} from "../../../actions";

/**
 * One criterion set — its requirements, in order, and the act of publishing
 * it (D-081).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EDITABLE ONLY WHILE `DRAFT`
 *
 * Every form on this screen — the set's own fields, adding a criterion,
 * correcting one — is offered only when `status === "DRAFT"`. Once
 * `ACTIVE`/`RETIRED` the screen renders the set read-only and shows why: the
 * service refuses the same edits (D-081), and a form that submits into a
 * refusal is a worse experience than one that was never offered.
 *
 * THE GRADE SCALE IS SHOWN, NEVER EDITED HERE (D-160, the build brief). Its
 * values populate the pass-floor and per-criterion minimum-grade `<select>`s;
 * `/skills` never adds "manage grade scale", because there is exactly one and
 * this phase does not author a second.
 */
export default async function CriterionSetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ awardTypeId: string; criterionSetId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [t, { awardTypeId, criterionSetId }, query, session] =
    await Promise.all([
      getTranslations(),
      params,
      searchParams,
      requireSignedIn(),
    ]);

  const actor = { principal: { personId: session.person.id } };
  const result = await guarded(() =>
    getCriterionSetForPrincipal(actor, criterionSetId),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href={`/skills/${awardTypeId}`}>
            {t("skills.backToAwardType")}
          </Link>
        </nav>
        <h1>{t("skills.set.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("skills.denied.title")}</h2>
          <p className="mb-0">
            {t("skills.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const set = result.value;
  if (!set) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href={`/skills/${awardTypeId}`}>
            {t("skills.backToAwardType")}
          </Link>
        </nav>
        <h1>{t("skills.set.title")}</h1>
        <p className="text-muted">{t("skills.set.notFound")}</p>
      </main>
    );
  }

  const scales = await guarded(() => listGradeScalesForPrincipal(actor));
  const gradeValues = scales.ok ? scales.value.flatMap((s) => s.values) : [];
  const isDraft = set.status === "DRAFT";

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href={`/skills/${awardTypeId}`}>
          {t("skills.backToAwardType")}
        </Link>
      </nav>

      <h1>
        {set.awardTypeName} — v{set.version}
      </h1>
      <p className="text-muted">
        {t(
          `skills.criterionSetStatus.${set.status}` as "skills.criterionSetStatus.DRAFT",
        )}
        {" · "}
        {t(`skills.issuingBody.${set.source}` as "skills.issuingBody.NRZ")}
      </p>

      {query.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`skills.errors.${query.error}` as "skills.errors.validation")}
        </div>
      ) : null}
      {query.saved ? (
        <div className="alert alert-success" role="status">
          {t(`skills.saved.${query.saved}` as "skills.saved.criterionSet")}
        </div>
      ) : null}

      <h2 className="h5 mt-4">{t("skills.criteria.title")}</h2>
      {set.criteria.length === 0 ? (
        <p className="text-muted">{t("skills.criteria.empty")}</p>
      ) : (
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th scope="col">{t("skills.criteria.columns.sequence")}</th>
              <th scope="col">{t("skills.criteria.columns.code")}</th>
              <th scope="col">{t("skills.criteria.columns.name")}</th>
              <th scope="col">{t("skills.criteria.columns.minimumGrade")}</th>
              {isDraft ? (
                <th scope="col">
                  <span className="visually-hidden">
                    {t("skills.criteria.save")}
                  </span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {set.criteria.map((criterion) =>
              isDraft ? (
                <tr key={criterion.id}>
                  <td colSpan={5} className="p-0">
                    <form
                      action={updateCriterionAction}
                      className="row g-2 align-items-end p-2 m-0"
                    >
                      <input
                        type="hidden"
                        name="awardTypeId"
                        value={awardTypeId}
                      />
                      <input
                        type="hidden"
                        name="criterionSetId"
                        value={criterionSetId}
                      />
                      <input
                        type="hidden"
                        name="criterionId"
                        value={criterion.id}
                      />
                      <div className="col-auto">
                        <input
                          aria-label={t("skills.criteria.columns.sequence")}
                          className="form-control form-control-sm"
                          name="sequence"
                          type="number"
                          min={1}
                          max={999}
                          defaultValue={criterion.sequence}
                          required
                          style={{ width: "6rem" }}
                        />
                      </div>
                      <div className="col-md-2">
                        <input
                          aria-label={t("skills.criteria.columns.code")}
                          className="form-control form-control-sm"
                          name="code"
                          defaultValue={criterion.code}
                          required
                          maxLength={40}
                        />
                      </div>
                      <div className="col-md-4">
                        <input
                          aria-label={t("skills.criteria.columns.name")}
                          className="form-control form-control-sm"
                          name="name"
                          defaultValue={criterion.name}
                          required
                          maxLength={200}
                        />
                      </div>
                      <div className="col-md-3">
                        <select
                          aria-label={t("skills.criteria.columns.minimumGrade")}
                          className="form-select form-select-sm"
                          name="minimumGradeId"
                          defaultValue={criterion.minimumGradeId ?? ""}
                        >
                          <option value="">
                            {t("skills.criteria.useSetFloor")}
                          </option>
                          {gradeValues.map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-auto">
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          type="submit"
                        >
                          {t("skills.criteria.save")}
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={criterion.id}>
                  <td>{criterion.sequence}</td>
                  <td>{criterion.code}</td>
                  <td>{criterion.name}</td>
                  <td>
                    {gradeValues.find((v) => v.id === criterion.minimumGradeId)
                      ?.label ?? t("skills.criteria.useSetFloor")}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}

      {isDraft ? (
        <details className="mt-3">
          <summary>{t("skills.criteria.addTitle")}</summary>
          <form action={createCriterionAction} className="row g-2 mt-2">
            <input type="hidden" name="awardTypeId" value={awardTypeId} />
            <input type="hidden" name="criterionSetId" value={criterionSetId} />
            <div className="col-md-2">
              <label className="form-label" htmlFor="newCriterionCode">
                {t("skills.criteria.columns.code")}
              </label>
              <input
                className="form-control"
                id="newCriterionCode"
                name="code"
                required
                maxLength={40}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="newCriterionName">
                {t("skills.criteria.columns.name")}
              </label>
              <input
                className="form-control"
                id="newCriterionName"
                name="name"
                required
                maxLength={200}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label" htmlFor="newCriterionSequence">
                {t("skills.criteria.columns.sequence")}
              </label>
              <input
                className="form-control"
                id="newCriterionSequence"
                name="sequence"
                type="number"
                min={1}
                max={999}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="newCriterionMinGrade">
                {t("skills.criteria.columns.minimumGrade")}
              </label>
              <select
                className="form-select"
                id="newCriterionMinGrade"
                name="minimumGradeId"
                defaultValue=""
              >
                <option value="">{t("skills.criteria.useSetFloor")}</option>
                {gradeValues.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <div className="form-text mb-2">
                {t("skills.criteria.sequenceHelp")}
              </div>
              <button className="btn btn-outline-primary" type="submit">
                {t("skills.criteria.add")}
              </button>
            </div>
          </form>
        </details>
      ) : null}

      {isDraft ? (
        <>
          <details className="mt-5">
            <summary className="h5">{t("skills.set.editTitle")}</summary>
            <form action={updateCriterionSetAction} className="row g-3 mt-2">
              <input type="hidden" name="awardTypeId" value={awardTypeId} />
              <input
                type="hidden"
                name="criterionSetId"
                value={criterionSetId}
              />
              <div className="col-md-4">
                <label className="form-label" htmlFor="editSource">
                  {t("skills.fields.source")}
                </label>
                <select
                  className="form-select"
                  id="editSource"
                  name="source"
                  defaultValue={set.source}
                  required
                >
                  <option value="ORG">{t("skills.issuingBody.ORG")}</option>
                  <option value="NRZ">{t("skills.issuingBody.NRZ")}</option>
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label" htmlFor="editPassFloor">
                  {t("skills.set.passFloor")}
                </label>
                <select
                  className="form-select"
                  id="editPassFloor"
                  name="passFloorGradeId"
                  defaultValue={set.passFloorGradeId ?? ""}
                  required
                >
                  <option value="" disabled>
                    {t("skills.set.passFloorPlaceholder")}
                  </option>
                  {gradeValues.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.label}
                    </option>
                  ))}
                </select>
                <div className="form-text">{t("skills.set.passFloorHelp")}</div>
              </div>
              <div className="col-12">
                <button className="btn btn-primary" type="submit">
                  {t("skills.edit.submit")}
                </button>
              </div>
            </form>
          </details>

          <form action={publishCriterionSetAction} className="mt-4">
            <input type="hidden" name="awardTypeId" value={awardTypeId} />
            <input type="hidden" name="criterionSetId" value={criterionSetId} />
            <button className="btn btn-success" type="submit">
              {t("skills.set.publish")}
            </button>
            <span className="form-text ms-3">
              {t("skills.set.publishHelp")}
            </span>
          </form>
        </>
      ) : (
        <p className="form-text mt-4">{t("skills.set.notEditable")}</p>
      )}
    </main>
  );
}
