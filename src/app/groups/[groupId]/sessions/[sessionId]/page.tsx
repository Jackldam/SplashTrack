import { randomUUID } from "node:crypto";

import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LiveSearchPicker } from "@/components/live-search-picker/live-search-picker";
import { getConfiguredLocalization } from "@/lib/settings";
import { criteriaForSessionAftest } from "@/modules/assessment";
import { ATTENDANCE_STATES, getSessionRegister } from "@/modules/attendance";
import { getSessionForPrincipal, resolveTimeZone } from "@/modules/sessions";
import { listGradeScales } from "@/modules/skills";

import { guarded, requireSignedIn } from "../../../access";
import {
  addGuestAction,
  amendAttendanceAction,
  clearSessionLaneOverrideAction,
  overrideSessionLanesAction,
  recordAssessmentAction,
  registerAttendanceAction,
  removeGuestAction,
} from "../../../actions";
import { formatSessionMoment } from "../../../format";

/**
 * One lesson, its roster, and the make-up guest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ROSTER HERE IS DERIVED PLUS EXPLICIT, AND THE LABEL SAYS WHICH
 *
 * §3.2: the roster is *"derived from the group plus any explicitly added
 * guests"*. Group members are computed at the lesson's own date; a guest is a
 * row. The `GAST` badge is not decoration — it is the visible form of the reason
 * that child is readable to the instructor at all.
 *
 * D-179: *"een inhaalles is er 1 met een gast erbij"*. Adding one here is the
 * whole of the make-up mechanism, and the receiving instructor's sight of the
 * child comes from that row through `isOnSessionRoster` and a `SESSION` grant —
 * never from group membership, which the guest does not have, and never from an
 * administrator minting something at 16:55 on a Tuesday.
 *
 * The page is guarded on `{ session }`, which is what makes that work: a
 * `SESSION`-scoped grant reaches this screen and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT SAYS WHERE THE LANES CAME FROM, NOT ONLY WHAT THEY ARE
 *
 * D-190: a lesson normally inherits its season's lanes and occasionally carries
 * its own. Those are different facts and the screen states which one it is
 * looking at, because *"is dit een uitzondering of gewoon de reeks"* is the
 * question somebody standing at the pool is asking. Showing the lanes alone
 * would make the exception invisible, which is the failure the badge exists for.
 */
export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; sessionId: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
}) {
  const [t, { groupId, sessionId }, query, session] = await Promise.all([
    getTranslations(),
    params,
    searchParams,
    requireSignedIn(),
  ]);

  const actor = { principal: { personId: session.person.id } };
  const result = await guarded(() => getSessionForPrincipal(actor, sessionId));

  if (!result.ok) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/groups">{t("groups.title")}</Link>
        </nav>
        <h1>{t("session.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("groups.denied.title")}</h2>
          <p className="mb-0">
            {t("groups.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const lesson = result.value;
  if (!lesson) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/groups">{t("groups.title")}</Link>
        </nav>
        <h1>{t("session.title")}</h1>
        <p className="text-muted">{t("session.notFound")}</p>
      </main>
    );
  }

  const timeZone = resolveTimeZone(
    (await getConfiguredLocalization()).timeZone,
  );

  // ── Attendance (phase 2.2) ─────────────────────────────────────────────────
  // `guarded`: an instructor who may see the lesson but holds no
  // `attendance.read` is an ordinary case, not a 500. The register renders
  // from `attendance`'s own service — this page never reads its table.
  const register = await guarded(() => getSessionRegister(actor, sessionId));
  const rosterName = new Map(
    lesson.roster.map((member) => [
      member.studentProfileId,
      `${member.givenName} ${member.familyName}`,
    ]),
  );
  const supersededIds = register.ok
    ? new Set(
        register.value.events
          .map((event) => event.supersedesEventId)
          .filter((id): id is string => id !== null),
      )
    : new Set<string>();

  // ── Assessment (phase 2.3) ──────────────────────────────────────────────────
  // `guarded`: an instructor who may see the lesson but holds no
  // `assessment.read` is an ordinary case, not a 500 — most instructors never
  // see this section, because most of them are not the independent assessor
  // D-085 requires. `criteriaForSessionAftest` resolves the same
  // group -> course -> skills chain `skills` uses for its own picker.
  const aftest = await guarded(() =>
    criteriaForSessionAftest(actor, sessionId),
  );
  const gradeScales = aftest.ok ? await listGradeScales() : [];
  const gradeValues = gradeScales[0]?.values ?? [];

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/groups">{t("groups.title")}</Link>
        {" / "}
        <Link href={`/groups/${groupId}`}>{lesson.groupName}</Link>
        {" / "}
        <Link href={`/groups/${groupId}/schedule`}>{t("schedule.title")}</Link>
      </nav>

      <h1>{formatSessionMoment(lesson.startsAt, timeZone)}</h1>
      <p className="text-muted">
        {lesson.groupName}
        {lesson.poolName ? ` · ${lesson.poolName}` : ""}
      </p>

      {lesson.status === "CANCELLED" ? (
        <div className="alert alert-secondary" role="status">
          {t("session.cancelled", {
            reason: lesson.cancellationReason ?? "",
          })}
        </div>
      ) : null}

      {query.error ? (
        <div className="alert alert-danger" role="alert">
          {t(`groups.errors.${query.error}` as "groups.errors.validation")}
        </div>
      ) : null}
      {query.saved ? (
        <div className="alert alert-success" role="status">
          {t(`groups.saved.${query.saved}` as "groups.saved.group")}
        </div>
      ) : null}

      {/* ── the lanes, and where they come from ─────────────────────────────
          The badge names the state in all three cases here, unlike the schedule
          table where only the exceptions are badged: this screen is about ONE
          lesson, so "these are the season's lanes" is an answer rather than
          noise — it is exactly what somebody opening this page wants to know. */}
      <h2 className="h5 mt-4">{t("schedule.lanes.title")}</h2>
      <p>
        {lesson.laneAssignment.lanes.length === 0
          ? t("schedule.lanes.none")
          : lesson.laneAssignment.lanes.map((lane) => lane.name).join(", ")}
        <span
          className={
            lesson.laneAssignment.laneSource === "OVERRIDE"
              ? "badge text-bg-warning ms-2"
              : "badge text-bg-light ms-2"
          }
        >
          {t(
            `schedule.lanes.${
              lesson.laneAssignment.laneSource === "OVERRIDE"
                ? "override"
                : lesson.laneAssignment.laneSource === "PINNED"
                  ? "pinned"
                  : "inherited"
            }` as "schedule.lanes.inherited",
          )}
        </span>
      </p>

      {lesson.poolLanes.length === 0 ? (
        <p className="form-text">{t("schedule.lanes.sessionNoPool")}</p>
      ) : (
        <details className="mb-4">
          <summary>{t("schedule.lanes.sessionTitle")}</summary>
          <p className="form-text">{t("schedule.lanes.sessionNote")}</p>
          {/* The boxes are pre-ticked with the EFFECTIVE lanes — inherited or
              not — so "swap one lane" is one click and not a re-entry of the
              whole set from memory. */}
          <form action={overrideSessionLanesAction} className="mt-2">
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="sessionId" value={lesson.id} />
            <div className="d-flex flex-wrap gap-3">
              {lesson.poolLanes.map((lane) => (
                <div className="form-check" key={lane.id}>
                  <input
                    className="form-check-input"
                    id={`sessionLane-${lane.id}`}
                    name="laneIds"
                    type="checkbox"
                    value={lane.id}
                    defaultChecked={lesson.laneAssignment.lanes.some(
                      (chosen) => chosen.id === lane.id,
                    )}
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`sessionLane-${lane.id}`}
                  >
                    {lane.name}
                  </label>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <button
                className="btn btn-outline-secondary btn-sm"
                type="submit"
              >
                {t("schedule.lanes.sessionSave")}
              </button>
            </div>
          </form>

          {/* THE WAY BACK. An override entered on the wrong lesson is an
              ordinary mistake, and without this the only repair would be
              re-typing the season's lanes here — which looks identical and is
              not the same thing, so the next change to the series would skip
              this lesson for ever. */}
          {lesson.laneAssignment.laneSource === "INHERITED" ? null : (
            <form action={clearSessionLaneOverrideAction} className="mt-3">
              <input type="hidden" name="groupId" value={groupId} />
              <input type="hidden" name="sessionId" value={lesson.id} />
              <button
                className="btn btn-outline-secondary btn-sm"
                type="submit"
              >
                {t("schedule.lanes.sessionClear")}
              </button>
              <span className="form-text ms-3">
                {t("schedule.lanes.sessionClearNote")}
              </span>
            </form>
          )}
        </details>
      )}

      <h2 className="h5 mt-4">{t("session.roster.title")}</h2>
      {lesson.roster.length === 0 ? (
        <p className="text-muted">{t("session.roster.empty")}</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th scope="col">{t("groups.columns.pupil")}</th>
              <th scope="col">{t("groups.columns.studentNumber")}</th>
              <th scope="col">{t("session.roster.source")}</th>
              <th scope="col">{t("groups.columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {lesson.roster.map((member) => (
              <tr key={member.studentProfileId}>
                <td>
                  {member.givenName} {member.familyName}
                </td>
                <td>{member.studentNumber}</td>
                <td>
                  {member.source === "GUEST" ? (
                    <>
                      <span className="badge text-bg-info">
                        {t("session.roster.guest")}
                      </span>
                      {member.reason ? (
                        <span className="text-muted"> — {member.reason}</span>
                      ) : null}
                    </>
                  ) : (
                    t("session.roster.groupMember")
                  )}
                </td>
                <td>
                  {member.source === "GUEST" ? (
                    <form action={removeGuestAction}>
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="sessionId" value={lesson.id} />
                      <input
                        type="hidden"
                        name="studentProfileId"
                        value={member.studentProfileId}
                      />
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        type="submit"
                      >
                        {t("session.guest.remove")}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Attendance (phase 2.2) ──────────────────────────────────────────
          THE FLAGSHIP SCREEN, at last on its five modules (D-138). One form,
          the whole register, one transaction (`01-domain-model.md` §4) — an
          instructor who saves knows it either all landed or none did. A wrong
          state afterwards is a CORRECTION: a new event superseding the old
          one (D-061), never an edit, and the history stays readable below.
          The hidden client ids were generated when this page rendered, so a
          double-submit collapses to one write (P-02). */}
      <h2 className="h5 mt-4">{t("session.attendance.title")}</h2>
      {!register.ok ? (
        <p className="text-muted">
          {t("session.attendance.denied", { permission: register.permission })}
        </p>
      ) : register.value.events.length === 0 ? (
        lesson.status === "CANCELLED" ? (
          <p className="text-muted">{t("session.attendance.cancelledNone")}</p>
        ) : lesson.roster.length === 0 ? (
          <p className="text-muted">{t("session.attendance.emptyRoster")}</p>
        ) : (
          <form action={registerAttendanceAction}>
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="sessionId" value={lesson.id} />
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">{t("groups.columns.pupil")}</th>
                  <th scope="col">{t("session.attendance.state")}</th>
                  <th scope="col">{t("session.attendance.note")}</th>
                </tr>
              </thead>
              <tbody>
                {lesson.roster.map((member) => (
                  <tr key={member.studentProfileId}>
                    <td>
                      {member.givenName} {member.familyName}
                      <input
                        type="hidden"
                        name="studentProfileIds"
                        value={member.studentProfileId}
                      />
                      <input
                        type="hidden"
                        name={`client_${member.studentProfileId}`}
                        value={randomUUID()}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={t("session.attendance.state")}
                        className="form-select form-select-sm"
                        name={`state_${member.studentProfileId}`}
                        defaultValue="PRESENT"
                      >
                        {ATTENDANCE_STATES.map((state) => (
                          <option key={state} value={state}>
                            {t(
                              `session.attendance.states.${state}` as "session.attendance.states.PRESENT",
                            )}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={t("session.attendance.note")}
                        className="form-control form-control-sm"
                        name={`note_${member.studentProfileId}`}
                        maxLength={1000}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-primary btn-sm" type="submit">
              {t("session.attendance.submit")}
            </button>
          </form>
        )
      ) : (
        <>
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th scope="col">{t("groups.columns.pupil")}</th>
                <th scope="col">{t("session.attendance.state")}</th>
                <th scope="col">{t("session.attendance.recordedAt")}</th>
                <th scope="col">{t("session.attendance.correct")}</th>
              </tr>
            </thead>
            <tbody>
              {register.value.lines.map((line) => (
                <tr key={line.studentProfileId}>
                  <td>
                    {rosterName.get(line.studentProfileId) ??
                      line.studentProfileId}
                  </td>
                  <td>
                    {line.effective === null
                      ? t("session.attendance.notRegistered")
                      : t(
                          `session.attendance.states.${line.effective.state}` as "session.attendance.states.PRESENT",
                        )}
                  </td>
                  <td className="text-muted">
                    {line.effective === null
                      ? "—"
                      : formatSessionMoment(
                          line.effective.recordedAt,
                          timeZone,
                        )}
                  </td>
                  <td>
                    {line.effective === null ? (
                      /* A pupil added to the roster AFTER registration (a
                         late guest) gets a one-line registration of their
                         own — the same service, a register of one. */
                      <form
                        action={registerAttendanceAction}
                        className="d-flex gap-2"
                      >
                        <input type="hidden" name="groupId" value={groupId} />
                        <input
                          type="hidden"
                          name="sessionId"
                          value={lesson.id}
                        />
                        <input
                          type="hidden"
                          name="studentProfileIds"
                          value={line.studentProfileId}
                        />
                        <input
                          type="hidden"
                          name={`client_${line.studentProfileId}`}
                          value={randomUUID()}
                        />
                        <select
                          aria-label={t("session.attendance.state")}
                          className="form-select form-select-sm w-auto"
                          name={`state_${line.studentProfileId}`}
                          defaultValue="PRESENT"
                        >
                          {ATTENDANCE_STATES.map((state) => (
                            <option key={state} value={state}>
                              {t(
                                `session.attendance.states.${state}` as "session.attendance.states.PRESENT",
                              )}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          type="submit"
                        >
                          {t("session.attendance.submit")}
                        </button>
                      </form>
                    ) : (
                      <form
                        action={amendAttendanceAction}
                        className="d-flex gap-2"
                      >
                        <input type="hidden" name="groupId" value={groupId} />
                        <input
                          type="hidden"
                          name="sessionId"
                          value={lesson.id}
                        />
                        <input
                          type="hidden"
                          name="studentProfileId"
                          value={line.studentProfileId}
                        />
                        <input
                          type="hidden"
                          name="supersedesEventId"
                          value={line.effective.eventId}
                        />
                        <input
                          type="hidden"
                          name="clientEventId"
                          value={randomUUID()}
                        />
                        <select
                          aria-label={t("session.attendance.state")}
                          className="form-select form-select-sm w-auto"
                          name="state"
                          defaultValue={line.effective.state}
                        >
                          {ATTENDANCE_STATES.map((state) => (
                            <option key={state} value={state}>
                              {t(
                                `session.attendance.states.${state}` as "session.attendance.states.PRESENT",
                              )}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={t("session.attendance.note")}
                          className="form-control form-control-sm"
                          name="note"
                          maxLength={1000}
                          placeholder={t("session.attendance.note")}
                        />
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          type="submit"
                        >
                          {t("session.attendance.amend")}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* THE HISTORY D-061 KEEPS — every event, corrections included,
              in write order. A superseded row renders struck through rather
              than disappearing: who said a child was present, and when they
              changed their mind, is the record's whole point. */}
          <details className="mb-4">
            <summary>{t("session.attendance.historyTitle")}</summary>
            <ul className="list-unstyled mt-2">
              {register.value.events.map((event) => (
                <li
                  key={event.id}
                  className={
                    supersededIds.has(event.id)
                      ? "text-decoration-line-through text-muted"
                      : undefined
                  }
                >
                  {formatSessionMoment(event.recordedAt, timeZone)} —{" "}
                  {rosterName.get(event.studentProfileId) ??
                    event.studentProfileId}
                  :{" "}
                  {t(
                    `session.attendance.states.${event.state}` as "session.attendance.states.PRESENT",
                  )}
                  {event.supersedesEventId !== null
                    ? ` (${t("session.attendance.correction")})`
                    : ""}
                  {event.note ? (
                    <span className="text-muted"> — {event.note}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      {/* ── Assessment (phase 2.3) ──────────────────────────────────────────
          THE AFTEST DOES NOT INHERIT THE THIRTY-SECOND DOCTRINE (D-086). Every
          grade select below starts on the blank first option — there is no
          default and no "mark all voldoende" button anywhere on this screen.
          The outcome is never typed; it is computed by `recordAssessment` from
          the pinned criterion set the moment every criterion carries either a
          grade or a waiver, and the whole sitting is refused
          (`error=INCOMPLETE`) until it does. This is deliberately the slowest
          form in the product — an aftest is a scheduled, ten-minute act by a
          qualified assessor, not a poolside tap. */}
      <h2 className="h5 mt-4">{t("session.assessment.title")}</h2>
      {!aftest.ok ? (
        <p className="text-muted">
          {t("session.assessment.denied", { permission: aftest.permission })}
        </p>
      ) : aftest.value.reason !== null ? (
        <p className="text-muted">
          {t(
            `session.assessment.reason.${aftest.value.reason}` as "session.assessment.reason.NO_LEVEL",
          )}
        </p>
      ) : lesson.roster.length === 0 ? (
        <p className="text-muted">{t("session.roster.empty")}</p>
      ) : (
        <form action={recordAssessmentAction} className="mb-4">
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="sessionId" value={lesson.id} />
          <input
            type="hidden"
            name="criterionSetId"
            value={aftest.value.criterionSet!.id}
          />
          <input type="hidden" name="clientEventId" value={randomUUID()} />

          <p className="form-text">
            {t("session.assessment.set", {
              awardType: aftest.value.criterionSet!.awardTypeName,
              version: aftest.value.criterionSet!.version,
            })}
          </p>

          <div className="mb-3 col-md-6">
            <label className="form-label" htmlFor="assessStudent">
              {t("groups.columns.pupil")}
            </label>
            <select
              className="form-select"
              id="assessStudent"
              name="studentProfileId"
              defaultValue=""
              required
            >
              <option value="" disabled>
                {t("session.assessment.pickStudent")}
              </option>
              {lesson.roster.map((member) => (
                <option
                  key={member.studentProfileId}
                  value={member.studentProfileId}
                >
                  {member.givenName} {member.familyName}
                </option>
              ))}
            </select>
          </div>

          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th scope="col">{t("session.assessment.criterion")}</th>
                <th scope="col">{t("session.assessment.grade")}</th>
                <th scope="col">{t("session.assessment.waiver")}</th>
              </tr>
            </thead>
            <tbody>
              {aftest.value.criterionSet!.criteria.map((criterion) => (
                <tr key={criterion.id}>
                  <td>
                    {criterion.name}
                    <input
                      type="hidden"
                      name="criterionIds"
                      value={criterion.id}
                    />
                  </td>
                  <td>
                    {/* DEFAULT UNSET — the blank option is the initial
                        selection, on every criterion, every time (D-086). */}
                    <select
                      aria-label={t("session.assessment.grade")}
                      className="form-select form-select-sm"
                      name={`grade_${criterion.id}`}
                      defaultValue=""
                    >
                      <option value=""></option>
                      {gradeValues.map((grade) => (
                        <option key={grade.id} value={grade.id}>
                          {grade.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`waiver_${criterion.id}`}
                        name={`waiver_${criterion.id}`}
                        value="1"
                      />
                      <label
                        className="form-check-label"
                        htmlFor={`waiver_${criterion.id}`}
                      >
                        {t("session.assessment.waived")}
                      </label>
                    </div>
                    <input
                      aria-label={t("session.assessment.waiverReason")}
                      className="form-control form-control-sm mt-1"
                      name={`waiverReason_${criterion.id}`}
                      placeholder={t("session.assessment.waiverReason")}
                      maxLength={500}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mb-3">
            <label className="form-label" htmlFor="assessRemark">
              {t("session.assessment.remark")}
            </label>
            <textarea
              className="form-control"
              id="assessRemark"
              name="remark"
              maxLength={1000}
              rows={2}
            />
            <div className="form-text">
              {t("session.assessment.remarkNote")}
            </div>
          </div>

          <button className="btn btn-primary" type="submit">
            {t("session.assessment.submit")}
          </button>
        </form>
      )}

      {lesson.status === "SCHEDULED" ? (
        <details className="mt-4">
          <summary className="h6">{t("session.guest.title")}</summary>
          <p className="form-text">{t("session.guest.note")}</p>

          {/* A pupil already on the roster is excluded client-side — adding
              them again would only earn the unique-index refusal they did
              nothing to deserve. The picker calls the same reach-narrowed
              search the old two-step form did
              (`/api/people/student-candidates`, `student-candidate-filter.ts`
              unchanged); the id travels in the hidden field it fills, typed
              by nobody. */}
          <form action={addGuestAction} className="row g-2 mt-3">
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="sessionId" value={lesson.id} />
            <div className="col-md-6">
              <LiveSearchPicker
                name="studentProfileId"
                label={t("session.guest.search")}
                placeholder={t("session.guest.searchPlaceholder")}
                searchUrl="/api/people/student-candidates"
                excludeIds={[...rosterName.keys()]}
                required
              />
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="guestReason">
                {t("session.guest.reason")}
              </label>
              <input
                className="form-control"
                id="guestReason"
                name="reason"
                maxLength={500}
              />
            </div>
            <div className="col-12">
              <button className="btn btn-primary btn-sm" type="submit">
                {t("session.guest.submit")}
              </button>
            </div>
          </form>
        </details>
      ) : null}
    </main>
  );
}
