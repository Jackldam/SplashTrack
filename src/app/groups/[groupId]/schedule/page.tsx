import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getConfiguredLocalization } from "@/lib/settings";
import { getGroupForPrincipal } from "@/modules/groups";
import {
  listClosuresForGroup,
  listPoolsForPrincipal,
  listRecurrencesForGroup,
  listSessionsForPrincipal,
  resolveTimeZone,
} from "@/modules/sessions";

import { guarded, requireSignedIn } from "../../access";
import {
  cancelSessionAction,
  createClosureAction,
  createRecurrenceAction,
  deactivateRecurrenceAction,
  generateSessionsAction,
} from "../../actions";
import {
  formatCalendarDate,
  formatMinuteOfDay,
  formatSessionMoment,
  formatWeekday,
  poolOptionLabel,
  toDateInputValue,
} from "../../format";

/**
 * A group's schedule — the rules it is generated from, the closures that
 * interrupt it, and the lessons themselves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CANCELLED LESSONS ARE SHOWN, NOT HIDDEN
 *
 * A cancelled lesson stays on this page with its reason beside it. *"De les van
 * 12 maart is afgelast — bad in onderhoud"* is what a parent is asking about,
 * and a schedule that quietly omitted the row would answer *"there was no
 * lesson"*, which is a different and untrue thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY TIME IS RENDERED IN THE ZONE IT WAS GENERATED IN
 *
 * The organisation's configured zone is resolved once here and passed to the
 * formatter, so the page cannot show a lesson at 18:00 that the generator
 * created for 19:00 — which is exactly what a server rendering in UTC would do
 * for half the year.
 */
export default async function GroupSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    generated?: string;
    planned?: string;
    skipped?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const [t, { groupId }, query, session] = await Promise.all([
    getTranslations(),
    params,
    searchParams,
    requireSignedIn(),
  ]);

  const actor = { principal: { personId: session.person.id } };

  const groupResult = await guarded(() => getGroupForPrincipal(actor, groupId));
  if (!groupResult.ok) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/groups">{t("groups.title")}</Link>
        </nav>
        <h1>{t("schedule.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("groups.denied.title")}</h2>
          <p className="mb-0">
            {t("groups.denied.explanation", {
              permission: groupResult.permission,
            })}
          </p>
        </div>
      </main>
    );
  }
  const group = groupResult.value;
  if (!group) {
    return (
      <main className="container py-5">
        <nav aria-label="kruimelpad" className="mb-3">
          <Link href="/groups">{t("groups.title")}</Link>
        </nav>
        <h1>{t("schedule.title")}</h1>
        <p className="text-muted">{t("groups.detail.notFound")}</p>
      </main>
    );
  }

  const timeZone = resolveTimeZone(
    (await getConfiguredLocalization()).timeZone,
  );

  // The window the table shows. Defaults to a year around today, which covers
  // "what did we do last term" and "what have I generated for next term" in one
  // screen without a filter nobody would use.
  const now = new Date();
  const windowFrom = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const windowTo = query.to
    ? new Date(`${query.to}T23:59:59.999Z`)
    : new Date(now.getTime() + 275 * 24 * 60 * 60 * 1000);

  const [sessions, recurrences, closures, pools] = await Promise.all([
    guarded(() =>
      listSessionsForPrincipal(actor, {
        from: windowFrom,
        to: windowTo,
        groupId,
      }),
    ),
    guarded(() => listRecurrencesForGroup(actor, groupId)),
    guarded(() => listClosuresForGroup(actor, groupId)),
    guarded(() => listPoolsForPrincipal(actor)),
  ]);

  const today = toDateInputValue(now);

  return (
    <main className="container py-5">
      <nav aria-label="kruimelpad" className="mb-3">
        <Link href="/groups">{t("groups.title")}</Link>
        {" / "}
        <Link href={`/groups/${group.id}`}>{group.name}</Link>
      </nav>

      <h1>{t("schedule.title")}</h1>
      <p className="text-muted">
        {t("schedule.subtitle", { group: group.name, timeZone })}
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
      {query.generated !== undefined ? (
        // THE COUNTS, not just "done". An administrator who expected 36 lessons
        // and got 34 needs to see that two were skipped by a closure, or the
        // only way to tell a working holiday calendar from a broken generator is
        // to count rows.
        <div className="alert alert-info" role="status">
          {t("schedule.generated", {
            created: query.generated,
            planned: query.planned ?? "0",
            skipped: query.skipped ?? "0",
          })}
        </div>
      ) : null}

      <h2 className="h5 mt-4">{t("schedule.recurrences.title")}</h2>
      {!recurrences.ok || recurrences.value.length === 0 ? (
        <p className="text-muted">{t("schedule.recurrences.empty")}</p>
      ) : (
        <>
          <ul className="list-group mb-3">
            {recurrences.value.map((rule) => (
              <li
                className="list-group-item d-flex justify-content-between align-items-center gap-2"
                key={rule.id}
              >
                <span>
                  {t("schedule.recurrences.line", {
                    weekday: formatWeekday(rule.weekday),
                    start: formatMinuteOfDay(rule.startMinuteOfDay),
                    duration: rule.durationMinutes,
                    pool: rule.poolName ?? t("schedule.noPool"),
                  })}
                  <span className="text-muted">
                    {" "}
                    — {formatCalendarDate(rule.startsOn)}
                    {rule.endsOn ? ` … ${formatCalendarDate(rule.endsOn)}` : ""}
                  </span>
                  {!rule.active ? (
                    <span className="badge text-bg-secondary ms-2">
                      {t("schedule.recurrences.inactive")}
                    </span>
                  ) : null}
                </span>
                {/* A RULE TYPED WITH THE WRONG WEEKDAY HAD NO REPAIR PATH. The
                  service could stop one since phase 1.6 and no screen called
                  it, so the only way out was cancelling every lesson it made,
                  one at a time, each with a reason. It stops the rule and
                  leaves the timetable alone — see `deactivateRecurrence` for
                  why deleting it would orphan and then duplicate the lessons
                  it already produced. */}
                {rule.active ? (
                  <form action={deactivateRecurrenceAction}>
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="recurrenceId" value={rule.id} />
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      type="submit"
                    >
                      {t("schedule.recurrences.stop")}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="form-text">{t("schedule.recurrences.stopNote")}</p>
        </>
      )}

      <details className="mb-4">
        <summary>{t("schedule.recurrences.add")}</summary>
        <form action={createRecurrenceAction} className="row g-2 mt-2">
          <input type="hidden" name="groupId" value={group.id} />
          <div className="col-md-2">
            <label className="form-label" htmlFor="weekday">
              {t("schedule.fields.weekday")}
            </label>
            <select
              className="form-select"
              id="weekday"
              name="weekday"
              required
            >
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <option key={day} value={day}>
                  {formatWeekday(day)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="startTime">
              {t("schedule.fields.startTime")}
            </label>
            <input
              className="form-control"
              id="startTime"
              name="startTime"
              type="time"
              defaultValue="18:00"
              required
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="durationMinutes">
              {t("schedule.fields.duration")}
            </label>
            <input
              className="form-control"
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              min={1}
              max={1440}
              defaultValue={45}
              required
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="poolId">
              {t("schedule.fields.pool")}
            </label>
            {/* INACTIVE POOLS ARE NOT OFFERED. That is what the flag is for:
                a pool taken out of service stops being a choice for lessons
                that have not been planned yet, while every lesson already
                planned in it keeps saying where it was. */}
            <select className="form-select" id="poolId" name="poolId">
              <option value="">{t("schedule.noPool")}</option>
              {(pools.ok ? pools.value : [])
                .filter((pool) => pool.active)
                .map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {poolOptionLabel(pool)}
                  </option>
                ))}
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="startsOn">
              {t("schedule.fields.startsOn")}
            </label>
            <input
              className="form-control"
              id="startsOn"
              name="startsOn"
              type="date"
              defaultValue={today}
              required
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="endsOn">
              {t("schedule.fields.endsOn")}
            </label>
            <input
              className="form-control"
              id="endsOn"
              name="endsOn"
              type="date"
            />
          </div>
          <div className="col-12">
            <button className="btn btn-primary btn-sm" type="submit">
              {t("schedule.recurrences.add")}
            </button>
          </div>
        </form>
      </details>

      <h2 className="h5">{t("schedule.closures.title")}</h2>
      {!closures.ok || closures.value.length === 0 ? (
        <p className="text-muted">{t("schedule.closures.empty")}</p>
      ) : (
        <ul className="list-group mb-3">
          {closures.value.map((closure) => (
            <li className="list-group-item" key={closure.id}>
              {formatCalendarDate(closure.fromDate)} …{" "}
              {formatCalendarDate(closure.toDate)} — {closure.reason}
              <span className="badge text-bg-light ms-2">
                {closure.groupId === null
                  ? t("schedule.closures.clubWide")
                  : t("schedule.closures.groupOnly")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="mb-4">
        <summary>{t("schedule.closures.add")}</summary>
        <form action={createClosureAction} className="row g-2 mt-2">
          <input type="hidden" name="groupId" value={group.id} />
          <div className="col-md-3">
            <label className="form-label" htmlFor="scope">
              {t("schedule.closures.scope")}
            </label>
            <select className="form-select" id="scope" name="scope">
              <option value="club">{t("schedule.closures.clubWide")}</option>
              <option value="group">{t("schedule.closures.groupOnly")}</option>
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="closureFrom">
              {t("schedule.fields.from")}
            </label>
            <input
              className="form-control"
              id="closureFrom"
              name="fromDate"
              type="date"
              required
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="closureTo">
              {t("schedule.fields.to")}
            </label>
            <input
              className="form-control"
              id="closureTo"
              name="toDate"
              type="date"
              required
            />
          </div>
          <div className="col-md-5">
            <label className="form-label" htmlFor="closureReason">
              {t("schedule.fields.reason")}
            </label>
            <input
              className="form-control"
              id="closureReason"
              name="reason"
              maxLength={500}
              required
            />
          </div>
          <div className="col-12">
            <button className="btn btn-primary btn-sm" type="submit">
              {t("schedule.closures.add")}
            </button>
            <span className="form-text ms-3">
              {t("schedule.closures.note")}
            </span>
          </div>
        </form>
      </details>

      <h2 className="h5">{t("schedule.generate.title")}</h2>
      <form action={generateSessionsAction} className="row g-2">
        <input type="hidden" name="groupId" value={group.id} />
        <div className="col-md-3">
          <label className="form-label" htmlFor="generateFrom">
            {t("schedule.fields.from")}
          </label>
          <input
            className="form-control"
            id="generateFrom"
            name="from"
            type="date"
            defaultValue={today}
            required
          />
        </div>
        <div className="col-md-3">
          <label className="form-label" htmlFor="generateTo">
            {t("schedule.fields.to")}
          </label>
          <input
            className="form-control"
            id="generateTo"
            name="to"
            type="date"
            required
          />
        </div>
        <div className="col-12">
          <button className="btn btn-primary btn-sm" type="submit">
            {t("schedule.generate.submit")}
          </button>
          <span className="form-text ms-3">{t("schedule.generate.note")}</span>
        </div>
      </form>

      <h2 className="h5 mt-5">{t("schedule.lessons.title")}</h2>
      {!sessions.ok ? (
        <div className="alert alert-warning" role="alert">
          {t("groups.denied.explanation", { permission: sessions.permission })}
        </div>
      ) : sessions.value.length === 0 ? (
        <p className="text-muted">{t("schedule.lessons.empty")}</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th scope="col">{t("schedule.columns.moment")}</th>
              <th scope="col">{t("schedule.columns.pool")}</th>
              <th scope="col">{t("schedule.columns.status")}</th>
              <th scope="col">{t("groups.columns.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.value.map((lesson) => (
              <tr key={lesson.id}>
                <td>
                  <Link href={`/groups/${group.id}/sessions/${lesson.id}`}>
                    {formatSessionMoment(lesson.startsAt, timeZone)}
                  </Link>
                </td>
                <td>{lesson.poolName ?? t("schedule.noPool")}</td>
                <td>
                  {lesson.status === "CANCELLED" ? (
                    <>
                      <span className="badge text-bg-secondary">
                        {t("schedule.lessons.cancelled")}
                      </span>
                      {lesson.cancellationReason ? (
                        <span className="text-muted">
                          {" "}
                          — {lesson.cancellationReason}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    t("schedule.lessons.scheduled")
                  )}
                </td>
                <td>
                  {lesson.status === "SCHEDULED" ? (
                    <form action={cancelSessionAction} className="d-flex gap-2">
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="sessionId" value={lesson.id} />
                      <input
                        aria-label={t("schedule.fields.reason")}
                        className="form-control form-control-sm"
                        name="reason"
                        maxLength={500}
                        placeholder={t("schedule.lessons.cancelReason")}
                        required
                      />
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        type="submit"
                      >
                        {t("schedule.lessons.cancel")}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="form-text">{t("schedule.lessons.cancelNote")}</p>
    </main>
  );
}
