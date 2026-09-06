import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  getGroupForPrincipal,
  listGroupsForPrincipal,
  GROUP_MOVE_DIRECTIONS,
} from "@/modules/groups";

import { guarded, requireSignedIn } from "../access";
import {
  assignInstructorAction,
  endInstructorAssignmentAction,
  endMembershipAction,
  moveStudentAction,
  placeStudentAction,
  updateGroupAction,
} from "../actions";
import { formatCalendarDate, toDateInputValue } from "../format";

/**
 * One group — its members, its instructors, and the two acts that change them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MOVE FORM IS ONE FORM, AND THE DIRECTION IS AN ORDINARY SELECT
 *
 * D-108 requires that moving a child DOWN a level be exactly as ordinary as
 * moving them up, and a screen is where that promise is most easily broken:
 * a *"Terugzetten"* button beside a *"Doorstromen"* button, in a different
 * colour, behind a confirmation the other one does not have, and a normal
 * teaching decision has been rendered as a failure to the parent who later reads
 * the child's history.
 *
 * So there is ONE form. `direction` is a `<select>` with three options in the
 * order the enum declares them, the reason is required whichever is chosen, the
 * submit button says the same thing either way, and no option carries a warning
 * colour or an icon. The help text under the field says so explicitly, because
 * the person filling it in is the one who needs to know that recording *down* is
 * expected rather than an admission.
 */
export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const [t, { groupId }, query, session] = await Promise.all([
    getTranslations(),
    params,
    searchParams,
    requireSignedIn(),
  ]);

  const actor = { principal: { personId: session.person.id } };
  const result = await guarded(() => getGroupForPrincipal(actor, groupId));

  if (!result.ok) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/groups">{t("groups.title")}</Link>
        </nav>
        <h1>{t("groups.detail.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("groups.denied.title")}</h2>
          <p className="mb-0">
            {t("groups.denied.explanation", { permission: result.permission })}
          </p>
        </div>
      </main>
    );
  }

  const group = result.value;
  if (!group) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/groups">{t("groups.title")}</Link>
        </nav>
        <h1>{t("groups.detail.title")}</h1>
        <p className="text-muted">{t("groups.detail.notFound")}</p>
      </main>
    );
  }

  // The move form needs somewhere to move TO. Reach-filtered like everything
  // else: an instructor sees only the groups they currently teach, so they
  // cannot move a child into a group they have no relationship with.
  const targets = await guarded(() => listGroupsForPrincipal(actor));
  const moveTargets = (targets.ok ? targets.value : []).filter(
    (candidate) => candidate.id !== group.id,
  );

  const today = toDateInputValue(new Date());

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/groups">{t("groups.title")}</Link>
      </nav>

      <h1>{group.name}</h1>
      <p className="text-muted">
        {group.capacity === null
          ? t("groups.detail.occupancyUnknown", { occupied: group.occupied })
          : t("groups.detail.occupancy", {
              occupied: group.occupied,
              capacity: group.capacity,
            })}
        {" · "}
        <Link href={`/groups/${group.id}/schedule`}>
          {t("groups.columns.scheduleLink")}
        </Link>
      </p>

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

      <h2 className="h5 mt-4">{t("groups.detail.instructors")}</h2>
      {group.instructors.length === 0 ? (
        <p className="text-muted">{t("groups.noInstructor")}</p>
      ) : (
        <ul className="list-group mb-3">
          {group.instructors.map((instructor) => (
            <li
              className="list-group-item d-flex justify-content-between align-items-center"
              key={instructor.personId}
            >
              <span>
                {instructor.givenName} {instructor.familyName}
                {instructor.role ? (
                  <span className="text-muted"> — {instructor.role}</span>
                ) : null}
              </span>
              <form
                action={endInstructorAssignmentAction}
                className="d-flex gap-2"
              >
                <input type="hidden" name="groupId" value={group.id} />
                <input
                  type="hidden"
                  name="personId"
                  value={instructor.personId}
                />
                <input
                  aria-label={t("groups.instructor.endDate")}
                  className="form-control form-control-sm"
                  name="toDate"
                  type="date"
                  defaultValue={today}
                  required
                />
                <button
                  className="btn btn-outline-secondary btn-sm"
                  type="submit"
                >
                  {t("groups.instructor.end")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {/* The consequence, stated where the act happens: ending an assignment is
          how an instructor's reach over this group ends (D-145 rule 1), and it
          takes effect on their next query. */}
      <p className="form-text">{t("groups.instructor.endNote")}</p>

      <details className="mb-4">
        <summary>{t("groups.instructor.assign")}</summary>
        <form action={assignInstructorAction} className="row g-2 mt-2">
          <input type="hidden" name="groupId" value={group.id} />
          <div className="col-md-5">
            <label className="form-label" htmlFor="personId">
              {t("groups.instructor.personId")}
            </label>
            <input
              className="form-control"
              id="personId"
              name="personId"
              required
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="role">
              {t("groups.instructor.role")}
            </label>
            <input
              className="form-control"
              id="role"
              name="role"
              maxLength={60}
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="fromDate">
              {t("groups.instructor.fromDate")}
            </label>
            <input
              className="form-control"
              id="fromDate"
              name="fromDate"
              type="date"
              defaultValue={today}
              required
            />
          </div>
          <div className="col-12">
            <button className="btn btn-primary btn-sm" type="submit">
              {t("groups.instructor.assign")}
            </button>
          </div>
        </form>
      </details>

      <h2 className="h5">{t("groups.detail.members")}</h2>
      {group.members.length === 0 ? (
        <p className="text-muted">{t("groups.detail.noMembers")}</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th scope="col">{t("groups.columns.pupil")}</th>
              <th scope="col">{t("groups.columns.studentNumber")}</th>
              <th scope="col">{t("groups.columns.since")}</th>
              <th scope="col">{t("groups.columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((member) => (
              <tr key={member.membershipId}>
                <td>
                  {member.givenName} {member.familyName}
                </td>
                <td>{member.studentNumber}</td>
                <td>{formatCalendarDate(member.fromDate)}</td>
                <td>
                  <form action={endMembershipAction} className="d-flex gap-2">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input
                      type="hidden"
                      name="studentProfileId"
                      value={member.studentProfileId}
                    />
                    <input
                      aria-label={t("groups.membership.endDate")}
                      className="form-control form-control-sm"
                      name="toDate"
                      type="date"
                      defaultValue={today}
                      required
                    />
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      type="submit"
                    >
                      {t("groups.membership.end")}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="mb-4">
        <summary>{t("groups.place.title")}</summary>
        <form action={placeStudentAction} className="row g-2 mt-2">
          <input type="hidden" name="groupId" value={group.id} />
          <div className="col-md-4">
            <label className="form-label" htmlFor="placeStudentProfileId">
              {t("groups.place.studentProfileId")}
            </label>
            <input
              className="form-control"
              id="placeStudentProfileId"
              name="studentProfileId"
              required
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="placeFromDate">
              {t("groups.place.fromDate")}
            </label>
            <input
              className="form-control"
              id="placeFromDate"
              name="fromDate"
              type="date"
              defaultValue={today}
              required
            />
          </div>
          <div className="col-md-5">
            <label className="form-label" htmlFor="placeReason">
              {t("groups.place.reason")}
            </label>
            <input
              className="form-control"
              id="placeReason"
              name="reason"
              maxLength={500}
              required
            />
          </div>
          <div className="col-12 form-check ms-2">
            <input
              className="form-check-input"
              id="placeOverride"
              name="overrideCapacity"
              type="checkbox"
            />
            <label className="form-check-label" htmlFor="placeOverride">
              {t("groups.place.override")}
            </label>
          </div>
          <div className="col-12">
            <button className="btn btn-primary btn-sm" type="submit">
              {t("groups.place.submit")}
            </button>
          </div>
        </form>
      </details>

      <h2 className="h5">{t("groups.move.title")}</h2>
      {/* ONE FORM FOR ALL THREE DIRECTIONS. See the file comment: a separate
          "terugzetten" button, in red, behind an extra confirmation, is how a
          normal teaching decision becomes something that reads as a failure. */}
      <p className="form-text">{t("groups.move.note")}</p>
      <form action={moveStudentAction} className="row g-2">
        <input type="hidden" name="fromGroupId" value={group.id} />
        <div className="col-md-3">
          <label className="form-label" htmlFor="moveStudentProfileId">
            {t("groups.move.pupil")}
          </label>
          <select
            className="form-select"
            id="moveStudentProfileId"
            name="studentProfileId"
            required
          >
            {group.members.map((member) => (
              <option
                key={member.studentProfileId}
                value={member.studentProfileId}
              >
                {member.givenName} {member.familyName}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label" htmlFor="toGroupId">
            {t("groups.move.toGroup")}
          </label>
          <select
            className="form-select"
            id="toGroupId"
            name="toGroupId"
            required
          >
            {moveTargets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-2">
          <label className="form-label" htmlFor="direction">
            {t("groups.move.direction")}
          </label>
          <select
            className="form-select"
            id="direction"
            name="direction"
            required
          >
            {GROUP_MOVE_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {t(
                  `groups.move.directions.${direction}` as "groups.move.directions.UP",
                )}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-2">
          <label className="form-label" htmlFor="occurredAt">
            {t("groups.move.occurredAt")}
          </label>
          <input
            className="form-control"
            id="occurredAt"
            name="occurredAt"
            type="date"
            defaultValue={today}
            required
          />
        </div>
        <div className="col-md-2">
          <label className="form-label" htmlFor="moveReason">
            {t("groups.move.reason")}
          </label>
          <input
            className="form-control"
            id="moveReason"
            name="reason"
            maxLength={500}
            required
          />
        </div>
        <div className="col-12 form-check ms-2">
          <input
            className="form-check-input"
            id="moveOverride"
            name="overrideCapacity"
            type="checkbox"
          />
          <label className="form-check-label" htmlFor="moveOverride">
            {t("groups.place.override")}
          </label>
        </div>
        <div className="col-12">
          <button className="btn btn-primary btn-sm" type="submit">
            {t("groups.move.submit")}
          </button>
          <span className="form-text ms-3">{t("groups.move.reasonHelp")}</span>
        </div>
      </form>

      <details className="mt-5">
        <summary className="h5">{t("groups.edit.title")}</summary>
        <form action={updateGroupAction} className="row g-3 mt-2">
          <input type="hidden" name="groupId" value={group.id} />
          <div className="col-md-6">
            <label className="form-label" htmlFor="editName">
              {t("groups.fields.name")}
            </label>
            <input
              className="form-control"
              id="editName"
              name="name"
              defaultValue={group.name}
              required
              maxLength={120}
            />
          </div>
          <div className="col-md-3">
            <label className="form-label" htmlFor="editCapacity">
              {t("groups.fields.capacity")}
            </label>
            <input
              className="form-control"
              id="editCapacity"
              name="capacity"
              type="number"
              min={1}
              max={500}
              defaultValue={group.capacity ?? ""}
            />
          </div>
          <div className="col-md-3 form-check mt-4 ms-2">
            <input
              className="form-check-input"
              id="editActive"
              name="active"
              type="checkbox"
              defaultChecked={group.active}
            />
            <label className="form-check-label" htmlFor="editActive">
              {t("groups.fields.active")}
            </label>
          </div>
          <div className="col-12">
            <button className="btn btn-primary" type="submit">
              {t("groups.edit.submit")}
            </button>
          </div>
        </form>
      </details>
    </main>
  );
}
