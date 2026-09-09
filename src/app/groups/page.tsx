import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { listGroupsForPrincipal } from "@/modules/groups";

import { guarded, requireSignedIn } from "./access";
import { createGroupAction } from "./actions";

/**
 * The group list — *Groepen*.
 *
 * SERVER-SIDE AUTHORIZATION BEFORE ANYTHING RENDERS. The session is resolved,
 * then `listGroupsForPrincipal` resolves a `Reach` and hands it to the
 * repository as a required argument (D-031). A principal whose reach covers no
 * group gets the denial panel — never an empty table.
 *
 * That distinction is not theoretical here. D-145 rule 1 ends an instructor's
 * reach the moment their `InstructorAssignment` closes, which is an ordinary
 * weekly event; the difference between *"je hebt geen toegang"* and *"geen
 * groepen"* is the difference between a question somebody can answer and a
 * screen that looks broken.
 *
 * DUTCH LABELS, ENGLISH IDENTIFIERS. D-159 governs schema and code, not what an
 * instructor reads at the poolside. Every string here comes from the message
 * catalogue, and `message-catalog.test.ts` keeps the two locales at parity.
 */
export default async function GroupsListPage({
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
    listGroupsForPrincipal({ principal: { personId: session.person.id } }),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <h1>{t("groups.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("groups.denied.title")}</h2>
          <p className="mb-0">
            {t("groups.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const groups = result.value;

  return (
    <main className="container py-5">
      <h1>{t("groups.title")}</h1>
      <p className="text-muted">{t("groups.subtitle")}</p>

      {params.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`groups.errors.${params.error}` as "groups.errors.validation")}
        </div>
      ) : null}

      <p className="mt-3">
        <Link className="btn btn-outline-secondary btn-sm" href="/groups/pools">
          {t("groups.pools.link")}
        </Link>
      </p>

      {groups.length === 0 ? (
        <p className="text-muted">{t("groups.empty")}</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th scope="col">{t("groups.columns.name")}</th>
              <th scope="col">{t("groups.columns.occupancy")}</th>
              <th scope="col">{t("groups.columns.instructors")}</th>
              <th scope="col">{t("groups.columns.schedule")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td>
                  <Link href={`/groups/${group.id}`}>{group.name}</Link>
                </td>
                <td>
                  {group.capacity === null ? (
                    // UNKNOWN IS SHOWN AS UNKNOWN, never as unlimited. A group
                    // with no stated ceiling is a group nobody has thought
                    // about, and D-180's placement decision needs to know which
                    // of the two it is looking at.
                    <>
                      {group.occupied}{" "}
                      <span className="text-warning-emphasis">
                        {t("groups.capacityUnknown")}
                      </span>
                    </>
                  ) : (
                    <>
                      {group.occupied} / {group.capacity}
                      {group.occupied >= group.capacity ? (
                        <span className="badge text-bg-secondary ms-2">
                          {t("groups.full")}
                        </span>
                      ) : null}
                    </>
                  )}
                </td>
                <td>
                  {group.instructors.length === 0
                    ? t("groups.noInstructor")
                    : group.instructors
                        .map(
                          (instructor) =>
                            `${instructor.givenName} ${instructor.familyName}`,
                        )
                        .join(", ")}
                </td>
                <td>
                  <Link href={`/groups/${group.id}/schedule`}>
                    {t("groups.columns.scheduleLink")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="mt-5">
        <summary className="h5">{t("groups.create.title")}</summary>
        <form action={createGroupAction} className="row g-3 mt-2">
          <div className="col-md-6">
            <label className="form-label" htmlFor="name">
              {t("groups.fields.name")}
            </label>
            <input
              className="form-control"
              id="name"
              name="name"
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="capacity">
              {t("groups.fields.capacity")}
            </label>
            <input
              className="form-control"
              id="capacity"
              name="capacity"
              type="number"
              min={1}
              max={500}
            />
            <div className="form-text">{t("groups.fields.capacityHelp")}</div>
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("groups.create.submit")}
            </button>
          </div>
        </form>
      </details>
    </main>
  );
}
