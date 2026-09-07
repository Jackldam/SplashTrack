import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { listCoursesForPrincipal } from "@/modules/courses";

import { guarded, requireSignedIn } from "./access";
import { createCourseAction } from "./actions";

/**
 * The course list — *Cursussen*.
 *
 * SERVER-SIDE AUTHORIZATION BEFORE ANYTHING RENDERS. The session is resolved,
 * then `listCoursesForPrincipal` resolves a `Reach` and hands it to the
 * repository as a required argument (D-031). A principal whose reach covers no
 * course gets the denial panel — never an empty table.
 *
 * That distinction carries more weight here than anywhere else in the
 * application: `COURSE` and `ORGANIZATION` are the only reaches that cover a
 * course at all, so an instructor, a Location Manager and an aftest assessor
 * are all refused this screen by design. *"Geen toegang"* tells them something
 * true and actionable; *"geen cursussen"* would tell them the club teaches
 * nothing.
 *
 * THE COUNTS ARE COUNTS. A course row says how many levels it has and how many
 * enrolments are open — never who they are. §2.2 puts a course's enrolments
 * inside `COURSE` coverage, and D-145 rule 2 makes that coverage per RELATION:
 * the pupils behind those numbers are reached through `{ student }`, on the
 * person screen, with their own guard.
 *
 * DUTCH LABELS, ENGLISH IDENTIFIERS. D-159 governs schema and code, not what an
 * administrator reads. Every string here comes from the message catalogue, and
 * `message-catalog.test.ts` keeps the two locales at parity.
 */
export default async function CoursesListPage({
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
    listCoursesForPrincipal({ principal: { personId: session.person.id } }),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <h1>{t("courses.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("courses.denied.title")}</h2>
          <p className="mb-0">
            {t("courses.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const courses = result.value;

  return (
    <main className="container py-5">
      <h1>{t("courses.title")}</h1>
      <p className="text-muted">{t("courses.subtitle")}</p>

      {params.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`courses.errors.${params.error}` as "courses.errors.validation")}
        </div>
      ) : null}

      {courses.length === 0 ? (
        <p className="text-muted">{t("courses.empty")}</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th scope="col">{t("courses.columns.name")}</th>
              <th scope="col">{t("courses.columns.description")}</th>
              <th scope="col">{t("courses.columns.levels")}</th>
              <th scope="col">{t("courses.columns.enrolments")}</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.id}>
                <td>
                  <Link href={`/courses/${course.id}`}>{course.name}</Link>
                  {course.active ? null : (
                    <span className="badge text-bg-secondary ms-2">
                      {t("courses.inactive")}
                    </span>
                  )}
                </td>
                <td className="text-muted">{course.description ?? "—"}</td>
                <td>{course.levelCount}</td>
                <td>{course.openEnrolments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="mt-5">
        <summary className="h5">{t("courses.create.title")}</summary>
        <form action={createCourseAction} className="row g-3 mt-2">
          <div className="col-md-5">
            <label className="form-label" htmlFor="name">
              {t("courses.fields.name")}
            </label>
            <input
              className="form-control"
              id="name"
              name="name"
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-7">
            <label className="form-label" htmlFor="description">
              {t("courses.fields.description")}
            </label>
            <textarea
              className="form-control"
              id="description"
              name="description"
              rows={2}
              maxLength={2000}
            />
            <div className="form-text">
              {t("courses.fields.descriptionHelp")}
            </div>
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("courses.create.submit")}
            </button>
          </div>
        </form>
      </details>
    </main>
  );
}
