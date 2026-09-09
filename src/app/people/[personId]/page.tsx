import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  ENROLMENT_STATUSES,
  getStudentEnrolments,
  listCoursesForPrincipal,
} from "@/modules/courses";
import {
  describeRelationshipAuthority,
  getPersonForPrincipal,
  LIFECYCLE_EVENT_TYPES,
  listPeopleForPrincipal,
  openPeriod,
  RELATIONSHIP_TYPES,
  type GuardianAuthority,
  type PersonRelationshipView,
} from "@/modules/people";
import { getAttendanceForStudent } from "@/modules/attendance";
import { getSkillProgressForStudent } from "@/modules/skills";

import { endEnrolmentAction, enrolStudentAction } from "@/app/courses/actions";
import { formatMoment } from "@/app/skills/format";

import { guarded, requireSignedIn } from "../access";
import {
  createMembershipAction,
  createStudentProfileAction,
  endMembershipPeriodAction,
  endRelationshipAction,
  recordLifecycleEventAction,
  recordRelationshipAction,
  startMembershipPeriodAction,
  updateMembershipAction,
  updatePersonAction,
  updateStudentProfileAction,
} from "../actions";
import { formatCalendarDate, toDateInputValue } from "../format";

/**
 * One person's record — identity, membership, pupil, and who answers for them.
 *
 * THE THREE CONCEPTS ARE THREE SECTIONS, and that is D-053 rendered rather than
 * merely stored. §3.1's trade-off is that "administrators must understand the
 * distinction. The UI hides it: adding a person offers both options" — so a
 * person with neither a membership nor a pupil record shows both invitations,
 * side by side, and neither is a prerequisite for the other (D-060).
 *
 * GUARDIAN AUTHORITY IS SHOWN AS DERIVED, NOT AS STORED. Each relationship
 * renders the outcome of `resolveGuardianAuthority` at THIS request's instant,
 * with the date it lapses where that can be computed. Nothing on this page
 * writes that outcome anywhere, and a page reload after a birthday shows a
 * different answer with no row having changed — which is the whole of D-151.
 */
export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    relativeSearch?: string;
  }>;
}) {
  const [t, { personId }, query, session] = await Promise.all([
    getTranslations(),
    params,
    searchParams,
    requireSignedIn(),
  ]);

  const at = new Date();
  const result = await guarded(() =>
    getPersonForPrincipal(
      { principal: { personId: session.person.id }, at },
      personId,
    ),
  );

  if (!result.ok) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/people">{t("people.backToList")}</Link>
        </nav>
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

  const person = result.value;
  if (!person) notFound();

  // The derivation, once per relationship, all against `at`.
  const guardians = await Promise.all(
    person.guardians.map(async (relationship) => ({
      relationship,
      authority: await describeRelationshipAuthority(
        {
          authority: relationship.authority,
          validFrom: relationship.validFrom,
          validTo: relationship.validTo,
          // The SUBJECT is this person: their own date of birth decides.
          subjectDateOfBirth: person.dateOfBirth,
        },
        at,
      ),
    })),
  );
  const dependants = await Promise.all(
    person.dependants.map(async (relationship) => ({
      relationship,
      authority: await describeRelationshipAuthority(
        {
          authority: relationship.authority,
          validFrom: relationship.validFrom,
          validTo: relationship.validTo,
          // Here THIS person is the relative, so the subject is the other one.
          subjectDateOfBirth: relationship.otherPerson.dateOfBirth,
        },
        at,
      ),
    })),
  );

  const currentPeriod = person.membership
    ? openPeriod(person.membership.periods)
    : null;

  // ── Enrolments (phase 2.0) ────────────────────────────────────────────────
  //
  // BOTH READS ARE `guarded`, and both denials are ordinary. `courses.read` is
  // a permission most staff do not hold — §2.2 makes `COURSE` (or
  // `ORGANIZATION`) the only reach that covers a course at all — so a Member
  // Administrator who can see this person's membership may legitimately not be
  // able to see what they are signed up for. That is a sentence on the section,
  // not a 500 and not a silently missing block.
  //
  // The two are separate questions on purpose: `getStudentEnrolments` reads
  // THIS pupil's rows (guarded on `{ student }`, then narrowed to the courses
  // the caller reaches), while `listCoursesForPrincipal` supplies the dropdown
  // for a NEW enrolment. A caller can be entitled to the first and not the
  // second.
  const enrolments = person.studentProfile
    ? await guarded(() =>
        getStudentEnrolments(
          { principal: { personId: session.person.id }, at },
          person.studentProfile!.id,
        ),
      )
    : null;
  const enrolmentCourses = person.studentProfile
    ? await guarded(() =>
        listCoursesForPrincipal({
          principal: { personId: session.person.id },
          at,
        }),
      )
    : null;
  // Withheld entries are excluded from the actionable list: `endEnrolment`
  // re-checks `enrolments.manage` on the course itself, so a caller who
  // cannot see the course's name cannot end it either — offering the form
  // would only produce a denial. The entry itself still appears in the
  // read-only history above, withheld as intended.
  const openEnrolments = enrolments?.ok
    ? enrolments.value.filter(
        (entry) => entry.endedAt === null && !entry.courseWithheld,
      )
    : [];

  // ── Skill progress (phase 2.1) — read-only here; see the section below. ──
  const skillProgress = person.studentProfile
    ? await guarded(() =>
        getSkillProgressForStudent(
          { principal: { personId: session.person.id }, at },
          person.studentProfile!.id,
        ),
      )
    : null;

  // ── Attendance (phase 2.2) — read-only here; see the section below. ──
  const attendance = person.studentProfile
    ? await guarded(() =>
        getAttendanceForStudent(
          { principal: { personId: session.person.id }, at },
          person.studentProfile!.id,
        ),
      )
    : null;

  // ── The relative picker's candidates (mirrors the phase 2.2 guest picker;
  // see `git show 60529c6`) ──────────────────────────────────────────────────
  // A name search, never a typed id. Candidates come from THIS caller's own
  // `people.read` reach (`listPeopleForPrincipal`, unchanged from the people
  // list page) — deliberately not narrowed to "people already connected to
  // this subject", because the relative is by definition someone NOT yet on
  // this person's record. That reach already denies rather than empties for a
  // caller with no `people.read` coverage at all, same as everywhere else this
  // reach is used.
  const relativeSearch =
    typeof query.relativeSearch === "string" ? query.relativeSearch.trim() : "";
  const relativeCandidates = relativeSearch
    ? await guarded(() =>
        listPeopleForPrincipal(
          { principal: { personId: session.person.id }, at },
          { query: relativeSearch },
        ),
      )
    : null;
  // The subject cannot be their own relative.
  const pickableRelatives = relativeCandidates?.ok
    ? relativeCandidates.value.filter((candidate) => candidate.id !== person.id)
    : [];

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/people">{t("people.backToList")}</Link>
      </nav>

      <h1>
        {person.givenName} {person.familyName}
      </h1>

      {query.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`people.errors.${query.error}` as "people.errors.validation")}
        </div>
      ) : null}
      {query.saved ? (
        <div className="alert alert-success" role="status">
          {t("people.saved")}
        </div>
      ) : null}

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <section className="mt-4">
        <h2 className="h4">{t("people.sections.identity")}</h2>
        <form action={updatePersonAction} className="row g-3">
          <input type="hidden" name="personId" value={person.id} />
          <div className="col-md-4">
            <label className="form-label" htmlFor="givenName">
              {t("people.fields.givenName")}
            </label>
            <input
              className="form-control"
              id="givenName"
              name="givenName"
              defaultValue={person.givenName}
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
              defaultValue={person.familyName}
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
              defaultValue={
                person.dateOfBirth ? toDateInputValue(person.dateOfBirth) : ""
              }
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
              defaultValue={person.email ?? ""}
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
              defaultValue={person.phone ?? ""}
              maxLength={64}
            />
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("people.save")}
            </button>
          </div>
        </form>
      </section>

      {/* ── Membership — a set of intervals, never a flag ─────────────────── */}
      <section className="mt-5">
        <h2 className="h4">{t("people.sections.membership")}</h2>
        {person.membership ? (
          <>
            <form
              action={updateMembershipAction}
              className="row g-2 align-items-end"
            >
              <input type="hidden" name="personId" value={person.id} />
              <div className="col-auto">
                <label className="form-label" htmlFor="memberNumber">
                  {t("people.membership.number")}
                </label>
                <input
                  className="form-control"
                  id="memberNumber"
                  name="memberNumber"
                  defaultValue={person.membership.memberNumber}
                  required
                  maxLength={32}
                />
              </div>
              <div className="col-auto">
                <button className="btn btn-outline-secondary" type="submit">
                  {t("people.membership.correct")}
                </button>
              </div>
            </form>
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">{t("people.membership.startedAt")}</th>
                  <th scope="col">{t("people.membership.endedAt")}</th>
                  <th scope="col">{t("people.membership.endReason")}</th>
                </tr>
              </thead>
              <tbody>
                {person.membership.periods.map((period) => (
                  <tr key={period.id}>
                    <td>{formatCalendarDate(period.startedAt)}</td>
                    <td>
                      {period.endedAt ? (
                        formatCalendarDate(period.endedAt)
                      ) : (
                        <span className="badge text-bg-success">
                          {t("people.membership.open")}
                        </span>
                      )}
                    </td>
                    <td>{period.endReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {currentPeriod ? (
              <form action={endMembershipPeriodAction} className="row g-2">
                <input type="hidden" name="personId" value={person.id} />
                <div className="col-auto">
                  <label className="form-label" htmlFor="endedAt">
                    {t("people.membership.endedAt")}
                  </label>
                  <input
                    className="form-control"
                    id="endedAt"
                    name="endedAt"
                    type="date"
                    required
                  />
                </div>
                <div className="col-auto">
                  <label className="form-label" htmlFor="endReason">
                    {t("people.membership.endReason")}
                  </label>
                  <input
                    className="form-control"
                    id="endReason"
                    name="endReason"
                    maxLength={500}
                  />
                </div>
                <div className="col-auto align-self-end">
                  <button className="btn btn-outline-secondary" type="submit">
                    {t("people.membership.end")}
                  </button>
                </div>
              </form>
            ) : (
              <form action={startMembershipPeriodAction} className="row g-2">
                <input type="hidden" name="personId" value={person.id} />
                <div className="col-auto">
                  <label className="form-label" htmlFor="startedAt">
                    {t("people.membership.startedAt")}
                  </label>
                  <input
                    className="form-control"
                    id="startedAt"
                    name="startedAt"
                    type="date"
                  />
                </div>
                <div className="col-auto align-self-end">
                  <button className="btn btn-outline-primary" type="submit">
                    {t("people.membership.startAgain")}
                  </button>
                </div>
                <div className="col-12">
                  <p className="form-text mb-0">
                    {t("people.membership.returnHelp")}
                  </p>
                </div>
              </form>
            )}
          </>
        ) : (
          <form action={createMembershipAction} className="row g-2">
            <input type="hidden" name="personId" value={person.id} />
            <div className="col-auto">
              <label className="form-label" htmlFor="memberNumber">
                {t("people.membership.number")}
              </label>
              <input
                className="form-control"
                id="memberNumber"
                name="memberNumber"
                maxLength={32}
              />
              <div className="form-text">
                {t("people.membership.numberHelp")}
              </div>
            </div>
            <div className="col-auto">
              <label className="form-label" htmlFor="startedAt">
                {t("people.membership.startedAt")}
              </label>
              <input
                className="form-control"
                id="startedAt"
                name="startedAt"
                type="date"
              />
            </div>
            <div className="col-auto align-self-end">
              <button className="btn btn-outline-primary" type="submit">
                {t("people.membership.create")}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ── The pupil — persistent, with an append-only history ───────────── */}
      <section className="mt-5">
        <h2 className="h4">{t("people.sections.student")}</h2>
        {person.studentProfile ? (
          <>
            <form
              action={updateStudentProfileAction}
              className="row g-2 align-items-end"
            >
              <input type="hidden" name="personId" value={person.id} />
              <input
                type="hidden"
                name="studentProfileId"
                value={person.studentProfile.id}
              />
              <div className="col-auto">
                <label className="form-label" htmlFor="studentNumber">
                  {t("people.student.number")}
                </label>
                <input
                  className="form-control"
                  id="studentNumber"
                  name="studentNumber"
                  defaultValue={person.studentProfile.studentNumber}
                  required
                  maxLength={32}
                />
              </div>
              <div className="col-auto">
                <button className="btn btn-outline-secondary" type="submit">
                  {t("people.student.correct")}
                </button>
              </div>
            </form>
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">{t("people.student.occurredAt")}</th>
                  <th scope="col">{t("people.student.event")}</th>
                  <th scope="col">{t("people.student.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {person.studentProfile.lifecycleEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatCalendarDate(event.occurredAt)}</td>
                    <td>
                      {t(
                        `people.lifecycleEvent.${event.type}` as "people.lifecycleEvent.JOINED",
                      )}
                    </td>
                    <td>{event.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <form action={recordLifecycleEventAction} className="row g-2">
              <input type="hidden" name="personId" value={person.id} />
              <input
                type="hidden"
                name="studentProfileId"
                value={person.studentProfile.id}
              />
              <div className="col-auto">
                <label className="form-label" htmlFor="type">
                  {t("people.student.event")}
                </label>
                <select className="form-select" id="type" name="type" required>
                  {LIFECYCLE_EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(
                        `people.lifecycleEvent.${type}` as "people.lifecycleEvent.JOINED",
                      )}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-auto">
                <label className="form-label" htmlFor="occurredAt">
                  {t("people.student.occurredAt")}
                </label>
                <input
                  className="form-control"
                  id="occurredAt"
                  name="occurredAt"
                  type="date"
                />
              </div>
              <div className="col-auto">
                <label className="form-label" htmlFor="reason">
                  {t("people.student.reason")}
                </label>
                <input
                  className="form-control"
                  id="reason"
                  name="reason"
                  maxLength={500}
                />
              </div>
              <div className="col-auto align-self-end">
                <button className="btn btn-outline-primary" type="submit">
                  {t("people.student.record")}
                </button>
              </div>
              <div className="col-12">
                {/* The purpose line at the capture point. A lifecycle reason is
                    not in D-148's protected class, so it is not encrypted — and
                    the honest answer to that is to say what does not belong in
                    it, at the moment somebody is typing. */}
                <p className="form-text mb-0">
                  {t("people.student.reasonPurpose")}
                </p>
              </div>
            </form>
          </>
        ) : (
          <form action={createStudentProfileAction} className="row g-2">
            <input type="hidden" name="personId" value={person.id} />
            <div className="col-auto">
              <label className="form-label" htmlFor="studentNumber">
                {t("people.student.number")}
              </label>
              <input
                className="form-control"
                id="studentNumber"
                name="studentNumber"
                maxLength={32}
              />
              <div className="form-text">{t("people.student.numberHelp")}</div>
            </div>
            <div className="col-auto">
              <label className="form-label" htmlFor="openingEvent">
                {t("people.student.event")}
              </label>
              <select
                className="form-select"
                id="openingEvent"
                name="openingEvent"
              >
                {LIFECYCLE_EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(
                      `people.lifecycleEvent.${type}` as "people.lifecycleEvent.JOINED",
                    )}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-auto">
              <label className="form-label" htmlFor="occurredAt">
                {t("people.student.occurredAt")}
              </label>
              <input
                className="form-control"
                id="occurredAt"
                name="occurredAt"
                type="date"
              />
            </div>
            <div className="col-auto align-self-end">
              <button className="btn btn-outline-primary" type="submit">
                {t("people.student.create")}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ── What this pupil is signed up for (phase 2.0) ───────────────────
          Only for a person who HAS a pupil record: an `Enrolment` references a
          `StudentProfile`, and offering to enrol a member with no profile
          would be offering something the model cannot represent. D-053's split
          rendered rather than merely stored, the same way the sections above
          do it. */}
      {person.studentProfile ? (
        <section className="mt-5">
          <h2 className="h4">{t("people.enrolments.title")}</h2>

          {enrolments && !enrolments.ok ? (
            <p className="text-muted">
              {t("people.enrolments.denied", {
                permission: enrolments.permission,
              })}
            </p>
          ) : enrolments && enrolments.value.length === 0 ? (
            <p className="text-muted">{t("people.enrolments.none")}</p>
          ) : enrolments ? (
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">{t("people.enrolments.course")}</th>
                  <th scope="col">{t("people.enrolments.status")}</th>
                  <th scope="col">{t("people.enrolments.from")}</th>
                  <th scope="col">{t("people.enrolments.to")}</th>
                </tr>
              </thead>
              <tbody>
                {enrolments.value.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {/* A WITHHELD COURSE SAYS SO. The enrolment is this
                          child's history and belongs in the list; what is
                          withheld is the course's NAME, and rendering that as
                          a blank would read as "no course". */}
                      {entry.courseWithheld ? (
                        <span className="text-muted">
                          {t("people.enrolments.courseWithheld")}
                        </span>
                      ) : (
                        entry.courseName
                      )}
                    </td>
                    <td>
                      {t(
                        `courses.enrolmentStatus.${entry.status}` as "courses.enrolmentStatus.ENROLLED",
                      )}
                    </td>
                    <td>{formatCalendarDate(entry.startedAt)}</td>
                    <td>
                      {entry.endedAt === null ? (
                        <span className="text-muted">
                          {t("people.enrolments.open")}
                        </span>
                      ) : (
                        formatCalendarDate(entry.endedAt)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {/* ENROL. The course list is the caller's own reach, so a principal
              who reaches no course is told there is nothing to choose rather
              than shown an empty dropdown. */}
          <details className="mt-3">
            <summary>{t("people.enrolments.addTitle")}</summary>
            {enrolmentCourses &&
            enrolmentCourses.ok &&
            enrolmentCourses.value.length > 0 ? (
              <form action={enrolStudentAction} className="row g-2 mt-2">
                <input
                  type="hidden"
                  name="back"
                  value={`/people/${person.id}`}
                />
                <input
                  type="hidden"
                  name="studentProfileId"
                  value={person.studentProfile.id}
                />
                <div className="col-md-5">
                  <label className="form-label" htmlFor="enrolCourseId">
                    {t("people.enrolments.course")}
                  </label>
                  <select
                    className="form-select"
                    id="enrolCourseId"
                    name="courseId"
                    required
                  >
                    {enrolmentCourses.value.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-auto">
                  <label className="form-label" htmlFor="enrolStatus">
                    {t("people.enrolments.status")}
                  </label>
                  <select
                    className="form-select"
                    id="enrolStatus"
                    name="status"
                    required
                  >
                    {ENROLMENT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(
                          `courses.enrolmentStatus.${status}` as "courses.enrolmentStatus.ENROLLED",
                        )}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-auto">
                  <label className="form-label" htmlFor="enrolStartedAt">
                    {t("people.enrolments.startDate")}
                  </label>
                  <input
                    className="form-control"
                    id="enrolStartedAt"
                    name="startedAt"
                    type="date"
                    required
                  />
                </div>
                <div className="col-auto align-self-end">
                  <button className="btn btn-outline-primary" type="submit">
                    {t("people.enrolments.add")}
                  </button>
                </div>
              </form>
            ) : (
              <p className="form-text">{t("people.enrolments.noCourses")}</p>
            )}
          </details>

          {/* END. One form per OPEN enrolment, because ending names which one:
              a pupil taking two courses has two, and a single form with a
              course dropdown would let somebody end the wrong one by leaving
              the default selected. */}
          {openEnrolments.length > 0 ? (
            <details className="mt-2">
              <summary>{t("people.enrolments.endTitle")}</summary>
              <ul className="list-group mt-2">
                {openEnrolments.map((entry) => (
                  <li
                    className="list-group-item d-flex justify-content-between align-items-center gap-2"
                    key={entry.id}
                  >
                    <span>
                      {entry.courseWithheld
                        ? t("people.enrolments.courseWithheld")
                        : entry.courseName}
                    </span>
                    <form action={endEnrolmentAction} className="d-flex gap-2">
                      <input
                        type="hidden"
                        name="back"
                        value={`/people/${person.id}`}
                      />
                      <input
                        type="hidden"
                        name="studentProfileId"
                        value={person.studentProfile!.id}
                      />
                      <input
                        type="hidden"
                        name="courseId"
                        value={entry.courseId}
                      />
                      <input
                        aria-label={t("people.enrolments.endDate")}
                        className="form-control form-control-sm"
                        name="endedAt"
                        type="date"
                        defaultValue={toDateInputValue(new Date())}
                        required
                      />
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        type="submit"
                      >
                        {t("people.enrolments.end")}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {/* ── The informal, per-lesson skill-progress log (phase 2.1) ────────
          READ-ONLY here: recording happens on the GROUP screen, guarded on
          `{ group }` (`02-security-privacy.md` §2.2's own `attendance.record`
          example) — see `@/modules/skills` `skill-progress-service.ts`. This
          section guards `{ student }`, the `getStudentEnrolments` shape, and
          — UNLIKE that one — shows every reachable row with no further
          per-course narrowing; the file comment on the service explains why. */}
      {person.studentProfile ? (
        <section className="mt-5">
          <h2 className="h4">{t("people.skillProgress.title")}</h2>

          {skillProgress && !skillProgress.ok ? (
            <p className="text-muted">
              {t("people.skillProgress.denied", {
                permission: skillProgress.permission,
              })}
            </p>
          ) : skillProgress && skillProgress.value.length === 0 ? (
            <p className="text-muted">{t("people.skillProgress.none")}</p>
          ) : skillProgress ? (
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">{t("people.skillProgress.criterion")}</th>
                  <th scope="col">{t("people.skillProgress.awardType")}</th>
                  <th scope="col">{t("people.skillProgress.state")}</th>
                  <th scope="col">{t("people.skillProgress.date")}</th>
                  <th scope="col">{t("people.skillProgress.note")}</th>
                </tr>
              </thead>
              <tbody>
                {skillProgress.value.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.criterionName}</td>
                    <td>
                      {entry.awardTypeName} (v{entry.criterionSetVersion})
                    </td>
                    <td>
                      {t(
                        `groups.skillProgress.states.${entry.state}` as "groups.skillProgress.states.INTRODUCED",
                      )}
                    </td>
                    <td>{formatMoment(entry.assessedAt)}</td>
                    <td className="text-muted">{entry.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {/* ── The attendance record (phase 2.2) ──────────────────────────────
          READ-ONLY here: registering happens on the LESSON screen, guarded on
          `{ session }` — see `@/modules/attendance` `attendance-service.ts`.
          This section guards `{ student }` and is then narrowed per row by
          the caller's reach (only `GROUP` narrows — the exact
          `getSkillProgressForStudent` stance one section up). Superseded
          events render struck through, never hidden: D-061 keeps the
          correction history because it IS the record. */}
      {person.studentProfile ? (
        <section className="mt-5">
          <h2 className="h4">{t("people.attendance.title")}</h2>

          {attendance && !attendance.ok ? (
            <p className="text-muted">
              {t("people.attendance.denied", {
                permission: attendance.permission,
              })}
            </p>
          ) : attendance && attendance.value.length === 0 ? (
            <p className="text-muted">{t("people.attendance.none")}</p>
          ) : attendance ? (
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">{t("people.attendance.lesson")}</th>
                  <th scope="col">{t("people.attendance.group")}</th>
                  <th scope="col">{t("people.attendance.state")}</th>
                  <th scope="col">{t("people.attendance.recordedAt")}</th>
                  <th scope="col">{t("people.attendance.note")}</th>
                </tr>
              </thead>
              <tbody>
                {attendance.value.map((entry) => (
                  <tr
                    key={entry.id}
                    className={
                      entry.superseded
                        ? "text-decoration-line-through text-muted"
                        : undefined
                    }
                  >
                    <td>{formatCalendarDate(entry.occursOn)}</td>
                    <td>{entry.groupName}</td>
                    <td>
                      {t(
                        `session.attendance.states.${entry.state}` as "session.attendance.states.PRESENT",
                      )}
                    </td>
                    <td>{formatMoment(entry.recordedAt)}</td>
                    <td className="text-muted">{entry.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      {/* ── Who answers for this person, and who they answer for ──────────── */}
      <section className="mt-5">
        <h2 className="h4">{t("people.sections.guardians")}</h2>
        <RelationshipTable
          rows={guardians}
          personId={person.id}
          evidenceAvailable={person.evidenceAvailable}
          emptyLabel={t("people.relationships.noGuardians")}
          otherColumnLabel={t("people.relationships.relative")}
          labels={await relationshipLabels()}
        />

        <h2 className="h4 mt-4">{t("people.sections.dependants")}</h2>
        <RelationshipTable
          rows={dependants}
          personId={person.id}
          evidenceAvailable={person.evidenceAvailable}
          emptyLabel={t("people.relationships.noDependants")}
          otherColumnLabel={t("people.relationships.subject")}
          labels={await relationshipLabels()}
        />

        <details className="mt-4" open={relativeSearch !== ""}>
          <summary className="h5">{t("people.relationships.addTitle")}</summary>

          {/* STEP 1 — find the relative BY NAME, the guest-picker pattern
              (`git show 60529c6`): a plain GET form, so the page stays a
              Server Component and re-renders with the reach-narrowed
              candidates instead of a per-keystroke endpoint existing. */}
          <form method="get" className="row g-2 mt-2">
            <div className="col-md-6">
              <label className="form-label" htmlFor="relativeSearch">
                {t("people.relationships.search")}
              </label>
              <input
                className="form-control"
                id="relativeSearch"
                name="relativeSearch"
                defaultValue={relativeSearch}
                placeholder={t("people.relationships.searchPlaceholder")}
                required
              />
            </div>
            <div className="col-md-3 align-self-end">
              <button
                className="btn btn-outline-secondary btn-sm"
                type="submit"
              >
                {t("people.relationships.searchSubmit")}
              </button>
            </div>
          </form>

          {/* STEP 2 — pick one of the matches and record the relationship.
              The select carries names; the id travels as the option VALUE,
              typed by nobody. */}
          {relativeCandidates === null ? null : !relativeCandidates.ok ? (
            <p className="text-muted mt-2">
              {t("people.relationships.searchDenied", {
                permission: relativeCandidates.permission,
              })}
            </p>
          ) : pickableRelatives.length === 0 ? (
            <p className="text-muted mt-2">
              {t("people.relationships.noResults", { query: relativeSearch })}
            </p>
          ) : (
            <form action={recordRelationshipAction} className="row g-3 mt-2">
              <input type="hidden" name="subjectPersonId" value={person.id} />
              <div className="col-md-4">
                <label className="form-label" htmlFor="relativePersonId">
                  {t("people.relationships.pick")}
                </label>
                <select
                  className="form-select"
                  id="relativePersonId"
                  name="relativePersonId"
                  required
                >
                  {pickableRelatives.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.familyName}, {candidate.givenName}
                      {candidate.dateOfBirth
                        ? ` (${formatCalendarDate(candidate.dateOfBirth)})`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label" htmlFor="relationshipType">
                  {t("people.relationships.type")}
                </label>
                <select
                  className="form-select"
                  id="relationshipType"
                  name="type"
                  required
                >
                  {RELATIONSHIP_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(
                        `people.relationshipType.${type}` as "people.relationshipType.GUARDIAN_OF",
                      )}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label" htmlFor="validFrom">
                  {t("people.relationships.validFrom")}
                </label>
                <input
                  className="form-control"
                  id="validFrom"
                  name="validFrom"
                  type="date"
                />
              </div>
              <div className="col-md-3 align-self-end">
                <div className="form-check">
                  <input
                    className="form-check-input"
                    id="authority"
                    name="authority"
                    type="checkbox"
                  />
                  <label className="form-check-label" htmlFor="authority">
                    {t("people.relationships.authority")}
                  </label>
                </div>
              </div>
              <div className="col-12">
                <label className="form-label" htmlFor="evidence">
                  {t("people.relationships.evidence")}
                </label>
                <textarea
                  className="form-control"
                  id="evidence"
                  name="evidence"
                  rows={2}
                  maxLength={2000}
                />
                {/* D-063's purpose line, non-dismissable, at the capture point. */}
                <div className="form-text">
                  {t("people.relationships.evidencePurpose")}
                </div>
              </div>
              <div className="col-12">
                <button className="btn btn-primary" type="submit">
                  {t("people.relationships.add")}
                </button>
              </div>
            </form>
          )}
        </details>
      </section>
    </main>
  );
}

/** The Dutch labels the relationship table needs, resolved once. */
async function relationshipLabels() {
  const t = await getTranslations();
  return {
    type: t("people.relationships.type"),
    authority: t("people.relationships.authority"),
    validFrom: t("people.relationships.validFrom"),
    validTo: t("people.relationships.validTo"),
    evidence: t("people.relationships.evidence"),
    showEvidence: t("people.relationships.showEvidence"),
    noEvidence: t("people.relationships.noEvidence"),
    end: t("people.relationships.end"),
    status: {
      ACTIVE: t("people.authority.ACTIVE"),
      LAPSED_BY_AGE: t("people.authority.LAPSED_BY_AGE"),
      LAPSED_BY_RECORD: t("people.authority.LAPSED_BY_RECORD"),
      LAPSED_UNKNOWN_BIRTHDATE: t("people.authority.LAPSED_UNKNOWN_BIRTHDATE"),
      NOT_CLAIMED: t("people.authority.NOT_CLAIMED"),
    },
    lapsesOn: t("people.authority.lapsesOn"),
    types: {
      GUARDIAN_OF: t("people.relationshipType.GUARDIAN_OF"),
      EMERGENCY_CONTACT: t("people.relationshipType.EMERGENCY_CONTACT"),
    },
  };
}

type RelationshipLabels = Awaited<ReturnType<typeof relationshipLabels>>;

/**
 * One relationship table.
 *
 * The authority column shows the DERIVED status, and the four lapse outcomes are
 * visually distinct from `NOT_CLAIMED` — an emergency contact never had
 * authority to lose, and rendering it as "lapsed" would fill a re-consent queue
 * with rows nobody needs to act on.
 */
function RelationshipTable({
  rows,
  personId,
  evidenceAvailable,
  emptyLabel,
  otherColumnLabel,
  labels,
}: {
  rows: {
    relationship: PersonRelationshipView;
    authority: GuardianAuthority;
  }[];
  personId: string;
  evidenceAvailable: ReadonlySet<string>;
  emptyLabel: string;
  otherColumnLabel: string;
  labels: RelationshipLabels;
}) {
  if (rows.length === 0) return <p className="text-muted">{emptyLabel}</p>;

  return (
    <table className="table table-sm align-middle">
      <thead>
        <tr>
          <th scope="col">{otherColumnLabel}</th>
          <th scope="col">{labels.type}</th>
          <th scope="col">{labels.authority}</th>
          <th scope="col">{labels.validFrom}</th>
          <th scope="col">{labels.validTo}</th>
          <th scope="col">{labels.evidence}</th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ relationship, authority }) => (
          <tr key={relationship.id}>
            <td>
              <Link href={`/people/${relationship.otherPerson.id}`}>
                {relationship.otherPerson.givenName}{" "}
                {relationship.otherPerson.familyName}
              </Link>
            </td>
            <td>{labels.types[relationship.type]}</td>
            <td>
              <span
                className={`badge text-bg-${
                  authority.status === "ACTIVE"
                    ? "success"
                    : authority.status === "NOT_CLAIMED"
                      ? "secondary"
                      : "warning"
                }`}
              >
                {labels.status[authority.status]}
              </span>
              {authority.lapsesOn && authority.status === "ACTIVE" ? (
                <div className="form-text">
                  {labels.lapsesOn} {formatCalendarDate(authority.lapsesOn)}
                </div>
              ) : null}
            </td>
            <td>{formatCalendarDate(relationship.validFrom)}</td>
            <td>
              {relationship.validTo
                ? formatCalendarDate(relationship.validTo)
                : "—"}
            </td>
            <td>
              {evidenceAvailable.has(relationship.id) ? (
                <Link
                  href={`/people/${personId}/relationships/${relationship.id}/evidence`}
                >
                  {labels.showEvidence}
                </Link>
              ) : (
                <span className="text-muted">{labels.noEvidence}</span>
              )}
            </td>
            <td>
              {relationship.validTo === null ? (
                <form action={endRelationshipAction}>
                  <input type="hidden" name="personId" value={personId} />
                  <input
                    type="hidden"
                    name="relationshipId"
                    value={relationship.id}
                  />
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    type="submit"
                  >
                    {labels.end}
                  </button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
