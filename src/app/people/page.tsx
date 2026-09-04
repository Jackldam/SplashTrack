import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { listPeopleForPrincipal } from "@/modules/people";

import { guarded, requireSignedIn } from "./access";
import { createPersonAction } from "./actions";
import { formatCalendarDate } from "./format";

/**
 * The people list — *Mensen*.
 *
 * SERVER-SIDE AUTHORIZATION BEFORE ANYTHING RENDERS. The session is resolved,
 * then `listPeopleForPrincipal` resolves a `Reach` and hands it to the
 * repository as a required argument (D-031). A principal whose reach covers no
 * `Person` gets the denial panel — never an empty table, which would be
 * indistinguishable from a club with no members.
 *
 * DUTCH LABELS, ENGLISH IDENTIFIERS. D-159 governs schema and code, not what an
 * instructor reads at the poolside. Every string here comes from the message
 * catalogue, and `message-catalog.test.ts` keeps the two locales at parity.
 *
 * No table markup for a media query's sake: this is an administrator's screen at
 * a desk, not the poolside tablet. The attendance surfaces that must beat a
 * clipboard are a different module with a different interaction budget.
 */
export default async function PeopleListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  const [t, params, session] = await Promise.all([
    getTranslations(),
    searchParams,
    requireSignedIn(),
  ]);

  const result = await guarded(() =>
    listPeopleForPrincipal(
      { principal: { personId: session.person.id } },
      { query: params.q },
    ),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <h1>{t("people.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("people.denied.title")}</h2>
          <p className="mb-0">
            {t("people.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const people = result.value;

  return (
    <main className="container py-5">
      <h1>{t("people.title")}</h1>
      <p className="text-muted">{t("people.subtitle")}</p>

      {params.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`people.errors.${params.error}` as "people.errors.validation")}
        </div>
      ) : null}

      <form className="row g-2 my-4" method="get" action="/people">
        <div className="col-auto">
          <label className="form-label visually-hidden" htmlFor="q">
            {t("people.search.label")}
          </label>
          <input
            className="form-control"
            id="q"
            name="q"
            type="search"
            defaultValue={params.q ?? ""}
            placeholder={t("people.search.placeholder")}
            maxLength={120}
          />
        </div>
        <div className="col-auto">
          <button className="btn btn-outline-secondary" type="submit">
            {t("people.search.submit")}
          </button>
        </div>
      </form>

      {people.length === 0 ? (
        <p className="text-muted">{t("people.empty")}</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th scope="col">{t("people.columns.name")}</th>
              <th scope="col">{t("people.columns.dateOfBirth")}</th>
              <th scope="col">{t("people.columns.memberNumber")}</th>
              <th scope="col">{t("people.columns.studentNumber")}</th>
              <th scope="col">{t("people.columns.member")}</th>
              <th scope="col">{t("people.columns.studentState")}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                <td>
                  <Link href={`/people/${person.id}`}>
                    {person.givenName} {person.familyName}
                  </Link>
                </td>
                <td>
                  {person.dateOfBirth ? (
                    formatCalendarDate(person.dateOfBirth)
                  ) : (
                    // D-172: unknown is shown AS unknown. A blank cell reads as
                    // "nobody filled it in yet"; this is a fact with a
                    // consequence — guardian authority derives to lapsed.
                    <span className="text-warning-emphasis">
                      {t("people.unknownDateOfBirth")}
                    </span>
                  )}
                </td>
                <td>{person.memberNumber ?? "—"}</td>
                <td>{person.studentNumber ?? "—"}</td>
                <td>{person.isMember ? t("people.yes") : t("people.no")}</td>
                <td>
                  {person.lifecycleState
                    ? t(
                        `people.lifecycle.${person.lifecycleState}` as "people.lifecycle.ACTIVE",
                      )
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="mt-5">
        <summary className="h5">{t("people.create.title")}</summary>
        <form action={createPersonAction} className="row g-3 mt-2">
          <div className="col-md-4">
            <label className="form-label" htmlFor="givenName">
              {t("people.fields.givenName")}
            </label>
            <input
              className="form-control"
              id="givenName"
              name="givenName"
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="familyName">
              {t("people.fields.familyName")}
            </label>
            <input
              className="form-control"
              id="familyName"
              name="familyName"
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="dateOfBirth">
              {t("people.fields.dateOfBirth")}
            </label>
            <input
              className="form-control"
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
            />
            <div className="form-text">
              {t("people.fields.dateOfBirthHelp")}
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="email">
              {t("people.fields.email")}
            </label>
            <input
              className="form-control"
              id="email"
              name="email"
              type="email"
              maxLength={254}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="phone">
              {t("people.fields.phone")}
            </label>
            <input
              className="form-control"
              id="phone"
              name="phone"
              maxLength={64}
            />
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("people.create.submit")}
            </button>
          </div>
        </form>
      </details>
    </main>
  );
}
