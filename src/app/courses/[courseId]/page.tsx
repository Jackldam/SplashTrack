import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getCourseForPrincipal } from "@/modules/courses";

import { guarded, requireSignedIn } from "../access";
import {
  createCourseLevelAction,
  updateCourseAction,
  updateCourseLevelAction,
} from "../actions";

/**
 * One course — what it is, and the levels it is taught in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LEVELS ARE THE POINT OF THIS SCREEN
 *
 * A course on its own is a name and a paragraph. What makes it useful is the
 * ordered list of levels underneath it, because that is what a group is
 * attached to and what a placement decision reads (D-180). Every level shows
 * how many groups sit at it, so somebody about to rename or reposition one can
 * see whether anything depends on it before they do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT HERE
 *
 * **The enrolled pupils, by name.** Only a count. §2.2 puts a course's
 * enrolments inside `COURSE` coverage and D-145 rule 2 makes that coverage per
 * RELATION — a name belongs to the person screen, which guards `{ student }`.
 * Listing children here would also make this the widest personal-data surface
 * in the application for the one grant type nobody has issued yet.
 *
 * **A field saying which diploma a level prepares for.** §3.2 gives
 * `CourseLevel` an `awardTypeId?` and `AwardType` belongs to the assessment
 * module, which is not built. A disabled dropdown or an empty column would
 * report an absence that is really an unbuilt module, so the screen says so in
 * one line instead (D-163).
 *
 * **A delete button, for either.** A course is retired with `In gebruik`
 * switched off and keeps everything under it; a level is pointed at by every
 * group taught at it and by every pupil's history through those groups. The
 * `Restrict` foreign keys refuse both at the database as well.
 */
export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [t, { courseId }, query, session] = await Promise.all([
    getTranslations(),
    params,
    searchParams,
    requireSignedIn(),
  ]);

  const actor = { principal: { personId: session.person.id } };
  const result = await guarded(() => getCourseForPrincipal(actor, courseId));

  if (!result.ok) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/courses">{t("courses.backToList")}</Link>
        </nav>
        <h1>{t("courses.detail.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("courses.denied.title")}</h2>
          <p className="mb-0">
            {t("courses.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const course = result.value;
  if (!course) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/courses">{t("courses.backToList")}</Link>
        </nav>
        <h1>{t("courses.detail.title")}</h1>
        <p className="text-muted">{t("courses.detail.notFound")}</p>
      </main>
    );
  }

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/courses">{t("courses.backToList")}</Link>
      </nav>

      <h1>
        {course.name}
        {course.active ? null : (
          <span className="badge text-bg-secondary ms-2 align-middle">
            {t("courses.inactive")}
          </span>
        )}
      </h1>
      {course.description ? (
        <p className="text-muted">{course.description}</p>
      ) : null}
      <p className="text-muted">
        {t("courses.detail.enrolments", { count: course.openEnrolments })}
      </p>

      {query.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`courses.errors.${query.error}` as "courses.errors.validation")}
        </div>
      ) : null}
      {query.saved ? (
        <div className="alert alert-success" role="status">
          {t(`courses.saved.${query.saved}` as "courses.saved.course")}
        </div>
      ) : null}

      <h2 className="h5 mt-4">{t("courses.detail.levels")}</h2>
      {course.levels.length === 0 ? (
        <p className="text-muted">{t("courses.detail.noLevels")}</p>
      ) : (
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th scope="col">{t("courses.level.sequence")}</th>
              <th scope="col">{t("courses.level.name")}</th>
              <th scope="col">{t("courses.level.groups")}</th>
              <th scope="col">
                <span className="visually-hidden">
                  {t("courses.edit.submit")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {course.levels.map((level) => (
              <tr key={level.id}>
                {/* ONE ROW IS ONE FORM. Renaming a level and moving it in the
                    order are the same edit, so they save together — two forms
                    would let somebody save half of a correction. */}
                <td colSpan={4} className="p-0">
                  <form
                    action={updateCourseLevelAction}
                    className="row g-2 align-items-end p-2 m-0"
                  >
                    <input type="hidden" name="courseId" value={course.id} />
                    <input type="hidden" name="levelId" value={level.id} />
                    <div className="col-auto">
                      <label
                        className="form-label visually-hidden"
                        htmlFor={`sequence-${level.id}`}
                      >
                        {t("courses.level.sequence")}
                      </label>
                      <input
                        className="form-control form-control-sm"
                        id={`sequence-${level.id}`}
                        name="sequence"
                        type="number"
                        min={1}
                        max={999}
                        defaultValue={level.sequence}
                        required
                        style={{ width: "6rem" }}
                      />
                    </div>
                    <div className="col-md-5">
                      <label
                        className="form-label visually-hidden"
                        htmlFor={`level-name-${level.id}`}
                      >
                        {t("courses.level.name")}
                      </label>
                      <input
                        className="form-control form-control-sm"
                        id={`level-name-${level.id}`}
                        name="name"
                        defaultValue={level.name}
                        required
                        maxLength={120}
                      />
                    </div>
                    <div className="col-auto text-muted">
                      {t("courses.level.groups")}: {level.groupCount}
                    </div>
                    <div className="col-auto">
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        type="submit"
                      >
                        {t("courses.level.save")}
                      </button>
                    </div>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* The honest line about `awardTypeId`. D-163: the column is not there,
          and an empty field would report an absence that is really an unbuilt
          module. */}
      <p className="form-text">{t("courses.detail.awardNote")}</p>

      <details className="mt-3">
        <summary>{t("courses.level.addTitle")}</summary>
        <form action={createCourseLevelAction} className="row g-2 mt-2">
          <input type="hidden" name="courseId" value={course.id} />
          <div className="col-md-5">
            <label className="form-label" htmlFor="newLevelName">
              {t("courses.level.name")}
            </label>
            <input
              className="form-control"
              id="newLevelName"
              name="name"
              required
              maxLength={120}
            />
          </div>
          <div className="col-auto">
            <label className="form-label" htmlFor="newLevelSequence">
              {t("courses.level.sequence")}
            </label>
            <input
              className="form-control"
              id="newLevelSequence"
              name="sequence"
              type="number"
              min={1}
              max={999}
            />
          </div>
          <div className="col-12">
            <div className="form-text mb-2">
              {t("courses.level.sequenceHelp")}
            </div>
            <button className="btn btn-outline-primary" type="submit">
              {t("courses.level.add")}
            </button>
          </div>
        </form>
      </details>

      <details className="mt-5">
        <summary className="h5">{t("courses.edit.title")}</summary>
        <form action={updateCourseAction} className="row g-3 mt-2">
          <input type="hidden" name="courseId" value={course.id} />
          <div className="col-md-5">
            <label className="form-label" htmlFor="editName">
              {t("courses.fields.name")}
            </label>
            <input
              className="form-control"
              id="editName"
              name="name"
              defaultValue={course.name}
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-7">
            <label className="form-label" htmlFor="editDescription">
              {t("courses.fields.description")}
            </label>
            <textarea
              className="form-control"
              id="editDescription"
              name="description"
              rows={2}
              maxLength={2000}
              defaultValue={course.description ?? ""}
            />
            <div className="form-text">
              {t("courses.fields.descriptionHelp")}
            </div>
          </div>
          <div className="col-12 form-check ms-2">
            <input
              className="form-check-input"
              id="editActive"
              name="active"
              type="checkbox"
              defaultChecked={course.active}
            />
            <label className="form-check-label" htmlFor="editActive">
              {t("courses.fields.active")}
            </label>
            <div className="form-text">{t("courses.fields.activeHelp")}</div>
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("courses.edit.submit")}
            </button>
          </div>
        </form>
      </details>
    </main>
  );
}
