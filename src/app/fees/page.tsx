import { randomUUID } from "node:crypto";

import { getTranslations } from "next-intl/server";

import { listFeeTypesForPrincipal } from "@/modules/fees";

import { guarded, requireSignedIn } from "./access";
import {
  createChargeAction,
  createFeeTypeAction,
  updateFeeTypeAction,
} from "./actions";
import { ChargePayerAndStudentFields } from "./charge-payer-and-student";
import { formatMoney } from "./format";

/**
 * The `fees` module's front door — *Financiën*: the fee-type catalogue
 * (D-088, the `AwardType`/`Course` shape) and the one form that creates a
 * charge. The balance VIEWS live on their own pages
 * (`/fees/payer/[personId]`, `/fees/student/[personId]`), reached from here
 * after a charge is created, and from the person screen
 * (`src/app/people/[personId]/page.tsx`).
 *
 * D-093 IS WHY THIS PAGE EXISTS AT ALL, SEPARATE FROM `/people`. Arrears
 * never appear on the poolside surface — `fees.read`/`fees.manage` are
 * administration permissions nobody with only `people.read` holds, so this
 * area is reached ONLY by the people actually meant to see money, on its own
 * screen, never folded into the shared person record where an instructor
 * might be looking too.
 */
export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [t, query, session] = await Promise.all([
    getTranslations(),
    searchParams,
    requireSignedIn(),
  ]);

  const actor = { principal: { personId: session.person.id } };
  const result = await guarded(() =>
    listFeeTypesForPrincipal(actor, { includeInactive: true }),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <h1>{t("fees.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("fees.denied.title")}</h2>
          <p className="mb-0">
            {t("fees.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const feeTypes = result.value;
  const activeFeeTypes = feeTypes.filter((f) => f.active);

  return (
    <main className="container py-5">
      <h1>{t("fees.title")}</h1>
      <p className="text-muted">{t("fees.subtitle")}</p>

      {query.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`fees.errors.${query.error}` as "fees.errors.validation")}
        </div>
      ) : null}
      {query.saved ? (
        <div className="alert alert-success" role="status">
          {t(`fees.saved.${query.saved}` as "fees.saved.feeType")}
        </div>
      ) : null}

      <div className="d-flex justify-content-between align-items-center mt-4">
        <h2 className="h4 mb-0">{t("fees.feeTypes.title")}</h2>
        <a className="btn btn-outline-secondary btn-sm" href="/api/fees/export">
          {t("fees.export.download")}
        </a>
      </div>

      {feeTypes.length === 0 ? (
        <p className="text-muted">{t("fees.feeTypes.empty")}</p>
      ) : (
        <table className="table table-sm align-middle mt-2">
          <thead>
            <tr>
              <th scope="col">{t("fees.feeTypes.columns.code")}</th>
              <th scope="col">{t("fees.feeTypes.columns.name")}</th>
              <th scope="col">{t("fees.feeTypes.columns.amount")}</th>
              <th scope="col">{t("fees.feeTypes.columns.recurrence")}</th>
              <th scope="col">
                <span className="visually-hidden">
                  {t("fees.feeTypes.edit.submit")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {feeTypes.map((feeType) => (
              <tr key={feeType.id}>
                <td colSpan={5} className="p-0">
                  <form
                    action={updateFeeTypeAction}
                    className="row g-2 align-items-center p-2 m-0"
                  >
                    <input type="hidden" name="feeTypeId" value={feeType.id} />
                    <div className="col-auto text-muted">{feeType.code}</div>
                    <div className="col-md-3">
                      <label
                        className="form-label visually-hidden"
                        htmlFor={`ft-name-${feeType.id}`}
                      >
                        {t("fees.feeTypes.columns.name")}
                      </label>
                      <input
                        className="form-control form-control-sm"
                        id={`ft-name-${feeType.id}`}
                        name="name"
                        defaultValue={feeType.name}
                        required
                        maxLength={120}
                      />
                    </div>
                    <div className="col-auto">
                      <label
                        className="form-label visually-hidden"
                        htmlFor={`ft-amount-${feeType.id}`}
                      >
                        {t("fees.feeTypes.columns.amount")}
                      </label>
                      <div className="input-group input-group-sm">
                        <span className="input-group-text">
                          {feeType.currency}
                        </span>
                        <input
                          className="form-control"
                          id={`ft-amount-${feeType.id}`}
                          name="amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          defaultValue={(feeType.amount / 100).toFixed(2)}
                          required
                          style={{ width: "7rem" }}
                        />
                      </div>
                    </div>
                    <div className="col-auto text-muted">
                      {t(
                        `fees.feeTypes.recurrence.${feeType.recurrence}` as "fees.feeTypes.recurrence.ONE_OFF",
                      )}
                    </div>
                    <div className="col-auto form-check">
                      <input
                        className="form-check-input"
                        id={`ft-active-${feeType.id}`}
                        name="active"
                        type="checkbox"
                        defaultChecked={feeType.active}
                      />
                      <label
                        className="form-check-label"
                        htmlFor={`ft-active-${feeType.id}`}
                      >
                        {t("fees.feeTypes.columns.active")}
                      </label>
                    </div>
                    <div className="col-auto">
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        type="submit"
                      >
                        {t("fees.feeTypes.edit.submit")}
                      </button>
                    </div>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="mt-3">
        <summary className="h5">{t("fees.feeTypes.create.title")}</summary>
        <form action={createFeeTypeAction} className="row g-3 mt-2">
          <div className="col-md-3">
            <label className="form-label" htmlFor="code">
              {t("fees.feeTypes.fields.code")}
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
              {t("fees.feeTypes.fields.name")}
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
            <label className="form-label" htmlFor="amount">
              {t("fees.feeTypes.fields.amount")}
            </label>
            <input
              className="form-control"
              id="amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="recurrence">
              {t("fees.feeTypes.fields.recurrence")}
            </label>
            <select
              className="form-select"
              id="recurrence"
              name="recurrence"
              required
              defaultValue="ONE_OFF"
            >
              <option value="ONE_OFF">
                {t("fees.feeTypes.recurrence.ONE_OFF")}
              </option>
              <option value="PERIODIC">
                {t("fees.feeTypes.recurrence.PERIODIC")}
              </option>
            </select>
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("fees.feeTypes.create.submit")}
            </button>
          </div>
        </form>
      </details>

      <h2 className="h4 mt-5">{t("fees.charges.create.title")}</h2>
      {activeFeeTypes.length === 0 ? (
        <p className="text-muted">{t("fees.charges.create.noFeeTypes")}</p>
      ) : (
        <form action={createChargeAction} className="row g-3 mt-2">
          <input type="hidden" name="clientEventId" value={randomUUID()} />
          <ChargePayerAndStudentFields
            payerLabel={t("fees.charges.fields.payer")}
            payerPlaceholder={t("fees.charges.fields.payerPlaceholder")}
            studentLabel={t("fees.charges.fields.student")}
            studentPlaceholder={t("fees.charges.fields.studentPlaceholder")}
            studentHelp={t("fees.charges.fields.studentHelp")}
          />
          <div className="col-md-4">
            <label className="form-label" htmlFor="feeTypeId">
              {t("fees.charges.fields.feeType")}
            </label>
            <select
              className="form-select"
              id="feeTypeId"
              name="feeTypeId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                {t("fees.charges.fields.feeTypePlaceholder")}
              </option>
              {activeFeeTypes.map((feeType) => (
                <option key={feeType.id} value={feeType.id}>
                  {feeType.name} —{" "}
                  {formatMoney(feeType.amount, feeType.currency)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="periodStart">
              {t("fees.charges.fields.periodStart")}
            </label>
            <input
              className="form-control"
              id="periodStart"
              name="periodStart"
              type="date"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="periodEnd">
              {t("fees.charges.fields.periodEnd")}
            </label>
            <input
              className="form-control"
              id="periodEnd"
              name="periodEnd"
              type="date"
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="dueDate">
              {t("fees.charges.fields.dueDate")}
            </label>
            <input
              className="form-control"
              id="dueDate"
              name="dueDate"
              type="date"
              required
            />
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="note">
              {t("fees.charges.fields.note")}
            </label>
            <textarea
              className="form-control"
              id="note"
              name="note"
              rows={2}
              maxLength={1000}
            />
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("fees.charges.create.submit")}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
