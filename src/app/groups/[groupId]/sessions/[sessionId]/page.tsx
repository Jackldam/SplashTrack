import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getConfiguredLocalization } from "@/lib/settings";
import { getSessionForPrincipal, resolveTimeZone } from "@/modules/sessions";

import { guarded, requireSignedIn } from "../../../access";
import { addGuestAction, removeGuestAction } from "../../../actions";
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
 */
export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; sessionId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
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

      {lesson.status === "SCHEDULED" ? (
        <details className="mt-4">
          <summary className="h6">{t("session.guest.title")}</summary>
          <p className="form-text">{t("session.guest.note")}</p>
          <form action={addGuestAction} className="row g-2 mt-2">
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="sessionId" value={lesson.id} />
            <div className="col-md-4">
              <label className="form-label" htmlFor="guestStudentProfileId">
                {t("session.guest.studentProfileId")}
              </label>
              <input
                className="form-control"
                id="guestStudentProfileId"
                name="studentProfileId"
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
