import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  describeRelationshipAuthority,
  getPersonForPrincipal,
  LIFECYCLE_EVENT_TYPES,
  openPeriod,
  RELATIONSHIP_TYPES,
  type GuardianAuthority,
  type PersonRelationshipView,
} from "@/modules/people";

import { guarded, requireSignedIn } from "../access";
import {
  createMembershipAction,
  createStudentProfileAction,
  endMembershipPeriodAction,
  endRelationshipAction,
  recordLifecycleEventAction,
  recordRelationshipAction,
  startMembershipPeriodAction,
  updatePersonAction,
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
  searchParams: Promise<{ error?: string; saved?: string }>;
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
        <h1>{t("people.title")}</h1>
        <div className="alert alert-warning mt-4" role="alert">
          <h2 className="h5">{t("people.denied.title")}</h2>
          <p className="mb-0">
            {t("people.denied.explanation", { permission: result.permission })}
          </p>
        </div>
        <Link href="/people">{t("people.backToList")}</Link>
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

  return (
    <main className="container py-5">
      <nav className="mb-3">
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
            <p>
              {t("people.membership.number")}:{" "}
              <strong>{person.membership.memberNumber}</strong>
            </p>
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
            <p>
              {t("people.student.number")}:{" "}
              <strong>{person.studentProfile.studentNumber}</strong>
            </p>
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

        <details className="mt-4">
          <summary className="h5">{t("people.relationships.addTitle")}</summary>
          <form action={recordRelationshipAction} className="row g-3 mt-2">
            <input type="hidden" name="subjectPersonId" value={person.id} />
            <div className="col-md-4">
              <label className="form-label" htmlFor="relativePersonId">
                {t("people.relationships.relativeId")}
              </label>
              <input
                className="form-control"
                id="relativePersonId"
                name="relativePersonId"
                required
              />
              <div className="form-text">
                {t("people.relationships.relativeIdHelp")}
              </div>
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
