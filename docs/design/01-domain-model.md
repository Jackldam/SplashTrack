# 01 — Functional Modules & Domain Model

## 1. Functional modules

SplashTrack is a **modular monolith**: one deployable application, internally
divided into modules that own their data, rules, API handlers, authorization
policies, UI and tests. Modules never read each other's tables directly;
cross-module operations go through published application services.

**Decision D-002 — Modular monolith, not microservices.**
**Reason.** The brief demands minimal coupling *and* minimal code *and* no
premature complexity. A modular monolith delivers the first two without the
distributed-systems tax of the third: one database, one transaction boundary,
one deployment, one set of secrets. Module boundaries are enforced by review,
lint rules on import paths, and service interfaces — not by network hops.
**Trade-off.** Boundaries are conventions, so they can be violated by a
careless import; we mitigate with an ESLint `no-restricted-imports` rule per
module. Independent scaling per module is not possible — accepted, because
nothing in the workload justifies it (`07-operations.md` §4).

### 1.1 Module map

Inherited from `WebAppTemplate` (already built, reused as-is):

```text
identity            Person, UserAccount, login sessions, MFA, passkeys
access-control      Roles, permissions, scopes, access groups, assignments
organization        The singleton organisation record, its settings and units
audit               Append-only security & privacy event trail
consent             Consent records with legal basis and authority evidence
pages               Custom pages CMS
profile-fields      Configurable person attributes
users               Account administration
api-credentials     Scoped machine credentials
email-templates     Templated transactional email
notifications       Delivery
maintenance         Scheduled jobs (retention, cleanup)
```

**Naming.** The module is `organization`, singular, and it manages **the**
organisation — its record, settings, branding and unit tree. It is not a tenant
registry, and nothing in the active design uses the word *tenant*. Likewise the
join table is `Membership`, not `OrganizationMembership`: there is only one
organisation to be a member of.

New SplashTrack domain modules (built in v1, in this order):

```text
people              Domain view over Person: relationships, guardians, tags
students            StudentProfile, lifecycle, enrolment state
groups              Group definition and membership over time
courses             Course/programme definitions, levels, enrolment
skills              Criterion catalogue and the informal per-lesson progress log
sessions            ScheduledSession — the shared scheduling primitive
attendance          Attendance events against a session  ← flagship
assessment          Award types, versioned criterion sets, grades, aftesten, waivers
exams               Exam sessions, candidates, assessors, results, awards
fees                Fee types, charges, payments, balances  ← tracking only
planning            Schedule construction, locations, resources, assignment
```

`assessment` and `fees` are specified in `15-assessment-and-fees.md`. `fees`
tracks money and emits no document (D-091); it is a ledger module, not a finance
system.

### 1.1.1 Removing what single-instance operation does not need

**Decision D-056 — Multi-tenant machinery inherited from the template is
*removed*, not left dormant.**

The template carries a tenant-scoping client extension, per-row tenant columns,
a platform-versus-organisation settings duality, and a platform role and
bootstrap layer. In a single-organisation installation none of it has a
function.

**Reason.** Dormant code is not free. It is attack surface — a scoping extension
that is bypassed everywhere gives a false sense of protection — plus maintenance
load, since every migration and refactor must keep it compiling, and a source of
confusion for anyone reading the codebase to learn how authorization actually
works. Dead security code is worse than absent security code, because it invites
the assumption that something is being enforced.

**Trade-off.** Extraction work up front, and a real divergence from the upstream
template that makes future cherry-picking harder. Accepted: the template is a
starting point, not a dependency we track.

Removed at extraction time: the tenant-scoping extension, tenant columns and
their composite foreign keys, `PlatformSettings` (merged into the organisation
singleton), `PlatformRoleAssignment`, and the platform permission namespace.

**Removal is incremental and test-covered.** Each removal is its own change with
the existing suites green before and after, so that reusable functionality —
authentication, authorization, GDPR tooling, audit, branding, CMS — is not
broken on the way out. Recorded as finding **F-26**.

Deliberately **not** modules: "reporting" (a read concern satisfied by queries
until proven otherwise), "invoicing" (`fees` tracks charges and payments and
stops there — `15-…` §6.5), "website" (the `pages` module plus theming already
is the website).

### 1.2 Dependency rule

Modules form a directed acyclic graph. Arrows point *downward only*:

```text
        planning        exams          fees
            \            /
        attendance   assessment
             |           |
          sessions     skills
              \        /
          groups  ·  courses
                 |
              students
                 |
               people
                 |
  identity / access-control / organization    (foundation)
```

A module may depend on modules below it, never above or sideways without an
explicit published interface. `attendance` may ask `groups` who is in a group;
`groups` may never ask `attendance` anything. Where an upward signal is needed
(e.g. "attendance was registered, update progress"), it goes through a domain
event, not a call.

`fees` sits at the top beside `exams` and depends only on `people` and
`students`. It never calls `exams`, and `exams` never calls it: the exam-fee
charge (D-089) is raised by a domain event published when a candidate reaches
`CONFIRMED`. The gate that `exams` enforces before that (D-085) likewise reads
`assessment` through its published service, never its tables.

**Decision D-057 — `ScheduledSession` is owned by its own `sessions` module.**

An earlier draft had `planning` writing the table and `attendance` reading it —
"one table, two owners", which violates this document's own isolation rule and
would have been the first boundary to erode in practice.

**Reason.** A session is a real domain concept in its own right: a time, a place,
a group, a status. Both `planning` (which creates and reschedules sessions) and
`attendance` (which records against them) are *consumers* of it. Giving it an
owner turns an implicit shared table into an explicit published service, and
makes the exam module's future need for the same primitive a reuse rather than a
duplicate.

**Trade-off.** One more module for a small table. That is the correct cost:
module count is cheap, ownership ambiguity is not.

**Decision D-003 — In-process domain events for upward/sideways signals.**
**Reason.** Keeps `attendance → skills` decoupled without a message broker.
**Trade-off.** Events are synchronous and transactional in v1, so a slow
handler slows the write. Accepted; if that becomes real, the handler moves to
the existing `maintenance` job runner without changing the publisher.

---

## 2. Domain model

### 2.1 The identity spine (inherited, unchanged)

```text
Organization ──< Membership >── Person ──0..1── UserAccount
                                  │
                                  └──< RoleAssignment >── Role ──< RolePermission >── Permission
```

- `Person` is the **canonical identity and biographical anchor**: name, date of
  birth, contact details, and the identifiers by which a human is recognised.

**Decision D-058 — `Person` is the canonical identity record, not the only place
personal data may live. Purpose-specific personal data stays in the module that
owns its purpose.**

Medical and pastoral remarks belong to `students`, not to `Person`. Attendance
belongs to `attendance`. Exam outcomes belong to `exams`.

**Reason.** Data protection is organised around *purpose*, not around tables.
Health data has a different lawful basis, a different permission, different
retention and different encryption from a name and a date of birth; storing it
on `Person` would drag all of that onto the identity record and make
least-privilege impossible — everyone who may see a class list would inherit
access to medical notes.
**Trade-off.** Personal data is spread across modules, so erasure and export
must consult a registry of contributing modules rather than one table. That
registry already exists and is test-enforced (D-014); this decision makes its
necessity explicit rather than accidental.
- `UserAccount` holds **no credentials** — Better Auth owns those. It is the
  optional bridge between a human and a login.
- There is no tenant column. Rows that a scoped role can reach carry `unitId`,
  and reach is resolved centrally by `resolveReach()`
  (`02-security-privacy.md` §2.3).

**Decision D-004 — One `Person` per human per installation. `Person`,
`Membership` and `StudentProfile` are three distinct concepts.**

An installation holds exactly one organisation, so one human is one `Person`
row — rectification and erasure then touch one place. That person may hold
several roles simultaneously (instructor, planner, parent); their reach is the
union of their scoped grants.

**Reason.** Separating the three concepts is what makes the real cases
representable: a member who never takes lessons, a student enrolled by a
guardian who is the member, an instructor who is also a parent, and an examiner
who is neither member nor student (D-052).

**Trade-off.** No continuity between organisations: someone working at two swim
schools has two records in two independent databases. That is the correct
privacy outcome — shared identity across installations would recreate exactly
the cross-organisation data path the distribution model exists to prevent.

### 2.2 The swim domain

```text
Organization
  ├──< Location
  ├──< Course ──< CourseLevel
  │       └──< Enrolment >── StudentProfile
  ├──< Group ──< GroupMembership >── StudentProfile
  │       ├──< GroupMove >── StudentProfile     (up or down, reason-carrying)
  │       └── instructor: Person (assignment, time-bounded)
  ├──< AwardType ──< CriterionSet ──< Criterion
  │                                          └──< SkillProgress >── StudentProfile
  ├──< Assessment ──< AssessmentCriterionResult >── Criterion
  │       └──< CriterionWaiver
  ├──< ScheduledSession ──< AttendanceEvent >── StudentProfile
  ├──< ExamSession ──< ExamCandidate >── StudentProfile
  │       ├──< ExamAssessor >── Person
  │       └──< ExamResult ──0..1── Award
  ├──< WaitlistEntry >── Person
  │       └──0..1── Inquiry          (public form submission, owned by `pages`)
  ├──< FeeType ──< Charge ──< Payment
  └──< CustomPage    (inherited CMS)

Person ──1──< StudentProfile        (org-scoped)
Person ──<   PersonRelationship >── Person   (guardian ↔ child)
Person ──<   PersonQualification              ("bevoegd" — see `15-…` §2.1)
```

The assessment, award and fee branches are specified in
`15-assessment-and-fees.md`; only their attachment points appear here.

### 2.3 Why these boundaries

**`StudentProfile` is separate from `Person`.** A person is a human; a student
profile is that human's enrolment identity in *one* organisation. It carries
the student number, join date, status, medical remarks and internal notes —
data that must not leak between organisations even when the same human is
known to both.

**`Group` is separate from `Course`.** A course is *what is taught* (Swimming
A, Level 3). A group is *who is taught together, when, by whom*. Conflating
them is the single most common modelling error in this domain: it makes it
impossible to move a student between groups without re-enrolling them, or to
run two groups of the same course. The prototype's `SwimGroup` already
recognised this; we keep it and generalise the name.

**`ScheduledSession` is the join point between planning and attendance.** It is
**owned by the `sessions` module** (D-057); `planning` and `attendance` are both
consumers of it. `planning` creates and reschedules sessions through the owning
service; `attendance` writes `AttendanceEvent` rows against them. The alternative
— attendance inventing its own session concept — guarantees drift, and the
alternative D-057 rejected, "one table, two owners", guarantees an eroded
boundary.

**`SkillProgress` is an event log, not a status column.** Each sign-off is an
immutable row: who signed, when, for which skill, at which session, with an
optional note. The student's "current level" is derived. This is what makes
the workflow auditable, undo-able, and legally defensible when a parent
disputes a diploma decision.

**Decision D-005 — Progress and attendance are append-only event logs.**
**Reason.** Auditability is a stated core principle; a mutable status column
destroys history and makes disputes unresolvable. Append-only rows also make
the offline-tolerance path (P-02) viable, because replaying an event is safe.
**Trade-off.** More rows and a derived-state query on every read. Mitigated
with a materialised `StudentProgressSummary` refreshed on write — added only
when a measured query is slow, not before.

---

## 3. Key entities and relations

Only fields that carry architectural or privacy meaning are listed. `id`,
`createdAt` and `updatedAt` are implied on every entity; `unitId` is implied on
every entity that participates in unit-scoped reach.

### 3.1 People — three distinct concepts

The single most important structural rule in the domain model: **`Person`,
`Membership` and `StudentProfile` are three different things with three
different lifecycles.** Member administration is not student administration.

```text
Person            the human, and the only PII anchor
  ├─ 0..1  UserAccount      optional login
  ├─ 0..1  Membership       optional: belongs to the organisation
  ├─ 0..1  StudentProfile   optional: takes lessons here
  └─ N     PersonRelationship   guardian of / emergency contact for
```

Every combination is valid and every one occurs in practice:

| Case | Person | Membership | StudentProfile | Account |
|---|---|---|---|---|
| Child taking lessons | ✓ | — | ✓ | — |
| Adult member who also swims | ✓ | ✓ | ✓ | optional |
| Member who never takes lessons | ✓ | ✓ | — | optional |
| Parent who consents for a child | ✓ | optional | — | later (P-04) |
| Instructor | ✓ | ✓ | — | ✓ |
| External examiner (D-052) | ✓ | — | — | temporary, scoped |

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `Person` | givenName, familyName, dateOfBirth, email?, phone? | 0..1 `UserAccount`, 0..1 `Membership`, 0..1 `StudentProfile` | Canonical identity anchor (D-058). One row per human per installation |
| `Membership` | memberNumber, unitId? | 1 `Person`, N `MembershipPeriod` | **One per person, for life.** The number stays the same across gaps |
| `MembershipPeriod` | membershipId, startedAt, endedAt?, endReason? | 1 `Membership` | Belonging is a set of intervals, not a status flag |
| `StudentProfile` | studentNumber, unitId | 1 `Person`, N `StudentLifecycleEvent`, N `Enrolment`, N `GroupMembership` | **Persistent.** Created once, never duplicated on return |
| `StudentLifecycleEvent` | studentProfileId, type (`JOINED`/`PAUSED`/`LEFT`/`RETURNED`/`TRIAL_ATTENDED`), occurredAt, reason? | 1 `StudentProfile` | Append-only lifecycle history; current state is derived |
| `PersonRelationship` | type (`GUARDIAN_OF`, `EMERGENCY_CONTACT`), fromPersonId, toPersonId, authority, evidence, validFrom, validTo? | Person ↔ Person | **v1.** `authority` records whether this relationship may consent on behalf of the subject (R-04); `evidence` records *how the claim was established* and is **non-optional where `authority = true`** (D-063). Every change audited |
| `PersonQualification` | personId, type, validFrom, validTo? | 1 `Person` | *"Een leraar die bevoegd is"* — what makes someone eligible to conduct an *aftest* (`15-…` §2.1) |
| `WaitlistEntry` | personId, studentProfileId?, **courseLevelId?**, requestedAt, source (`INQUIRY`/`MANUAL`), status (`WAITING`/`PLACED`/`WITHDRAWN`), note? | Person, 0..1 `Inquiry`, 0..1 `CourseLevel` | The front door. **One list for the club, not a queue per group** (D-180): an entry records the child **and the level** — not a course — and placement is a matching decision against groups that have room, never automatic and never strictly first-in-first-out. Placement creates the `StudentProfile`/`Enrolment`; the entry is closed, not deleted |
| `Inquiry` | submittedAt, name, email, phone?, message, childName?, childBirthDate?, status (`NEW`/`HANDLED`/`SPAM`), handledByPersonId? | 0..1 `WaitlistEntry` | **The public contact/enrolment form's submission.** Owned by `pages`, which is where §5's retention row for it already sits (6 months, `DELETE`). Referenced by `WaitlistEntry.source = INQUIRY` (D-109) and by `00-overview.md` R-33. Its free text is protected under D-148, so it is encrypted, read-audited and export-excluded like the other members of that class |

**Decision D-059 — Leaving and returning is modelled with periods and lifecycle
events, never by creating a second profile or flipping a status.**

One `Membership` per person with many `MembershipPeriod` rows; one persistent
`StudentProfile` with an append-only `StudentLifecycleEvent` history. Returning
creates a new period and new `Enrolment` / `GroupMembership` rows — it never
creates a second profile.

**Reason.** A returning swimmer is the same human with the same history, and that
history is the product's value: their skills, their diplomas, their previous
groups. A second profile fragments it and duplicates PII, which then has to be
merged by hand and re-erased twice. A status flag, meanwhile, silently destroys
the answer to "when were they a member?" — which matters for contributions,
insurance and retention.
**Trade-off.** Current membership and current student status are derived rather
than read from a column. A small derived-state helper covers it, and it is the
same append-only reasoning used for progress and attendance (D-005).

**Decision D-060 — Membership is never an implicit prerequisite for a role.**

Authorization comes exclusively from role assignments and their scopes
(`02-security-privacy.md` §2). An instructor, planner or examiner may hold a role
with no `Membership` at all, and holding a membership grants nothing by itself.

**Reason.** Membership is an *administrative and often financial* relationship;
authorization is a *security* concern. Conflating them means a volunteer
instructor who is not a paying member cannot be given access without inventing a
fake membership — and worse, it creates the reverse expectation that members
implicitly have rights. If an organisation genuinely wants "instructors must be
members", that is a configurable business rule they enable, checked at
assignment time, not an assumption baked into the model.
**Trade-off.** Two things to administer where a naive model has one. The UI
offers them together when adding a person, so the cost is conceptual, not
clerical.

**Decision D-053 — `Membership` and `StudentProfile` are separate tables, never
one table with a flag.**
**Reason.** They have different numbering, different lifecycles (a member can
leave while their diploma history is retained for ten years), different
retention rules and different permissions. A single table with a `isStudent`
flag would force one retention policy onto both and make "member who never
swims" awkward to represent.
**Trade-off.** Two lookups where a naive model has one, and administrators must
understand the distinction. The UI hides it: adding a person offers both
options.

**Guardian authority is a v1 requirement, not just a relationship.** Almost all
data subjects here are children who cannot legally consent. A consent record
therefore references both the **subject** person and the **consenting** person,
and is only valid if a `GUARDIAN_OF` relationship with `authority = true` existed
at the time it was given. That is why the relationship carries validity dates and
is audited: consent evidence that cannot be traced to the authority behind it is
not evidence.

### 3.2 Teaching structure

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `Course` | name, description, active | N `CourseLevel`, N `Enrolment` | What is taught |
| `CourseLevel` | name, sequence, awardTypeId? | 0..1 `AwardType` | E.g. Diploma A → B → C. `awardTypeId` says what the level prepares for; the requirements themselves live on that award's `CriterionSet` (`15-…` §2.6) |
| `Enrolment` | studentProfileId, courseId, status (incl. `TRIAL`), startedAt, endedAt? | Student ↔ Course | Status is a lifecycle, not a payment state (P-03 and D-093). `TRIAL` marks a *proefzwemmer* — a prospective pupil attending once |
| `Group` | name, courseLevelId?, capacity?, active | N `GroupMembership`, N `ScheduledSession` | Who is taught together |
| `GroupMembership` | studentProfileId, groupId, fromDate, toDate? | | **Time-bounded** — moving groups is a new row, not an update |
| `GroupMove` | studentProfileId, fromGroupId?, toGroupId, direction (`UP`/`DOWN`/`LATERAL`), reason, decidedByPersonId, occurredAt | N `GroupMembership` | The *action* behind the two membership rows. Both directions are ordinary history — see D-108 |
| `SessionRosterEntry` | sessionId, studentProfileId, source (`GROUP`/`GUEST`), reason? | 1 `ScheduledSession` | The roster of a session is derived from the group **plus** any explicitly added guests. A make-up lesson is a `GUEST` entry; nothing else about it is modelled |
| `InstructorAssignment` | personId, groupId \| sessionId, role, fromDate, toDate? | | Instructors change; history is preserved |
| `Location` | name, address?, capacity? | N `ScheduledSession` | Pools, halls |

**Decision D-108 — Moving a child to another group is recorded as a `GroupMove`
carrying a direction and a reason, and moving *down* is ordinary history, not a
correction.**

Progress in this domain is per individual, not per group: a faster child moves
up mid-block, and a child who is struggling moves back down. The domain expert
described both as normal.

**Reason.** `GroupMembership` already carries the *data* — two time-bounded rows.
What is missing is the *act*: who decided, when, and why. Without it, a move down
is indistinguishable from an administrative error, and the screen that renders
the child's history will present it as one. A parent reading "moved from Group 4
to Group 3" with no reason attached draws the worst conclusion available; the
same row with *"meer tijd nodig voor de schoolslagbeenslag"* is a teaching
decision. Recording the direction explicitly, rather than deriving it from level
sequence, also keeps a lateral move (a different evening, the same level) from
being reported as a demotion.

**Trade-off.** One more row per move, and a required reason on an action
administrators would rather do in two clicks. Accepted: the reason is the entire
value of the record.

**Decision D-109 — Trial lessons, waiting lists and make-up lessons are
*modelled*; no workflow is built for them in v1.**

What exists: `Enrolment.status = TRIAL`, `StudentLifecycleEvent.TRIAL_ATTENDED`,
`WaitlistEntry` with a placement action from an `Inquiry`, and
`SessionRosterEntry` accepting a student who is not a member of the session's
group. What does not exist: a trial-booking flow, a conversion funnel, a
shortened onboarding path, a make-up entitlement counter, a "this child is owed
two lessons" ledger, or a slot-booking screen.

**Reason.** The waiting list is in daily use and gets its placement action. The
other two the domain expert explicitly asked to *"houd rekening met"* while
saying **his own school does not run them** — so a workflow would be built for a
customer who does not exist, which is precisely the charge this review levelled
at the rest of the design. The data shape, though, is genuinely expensive to
retrofit: attendance for a child who is not in the session's group touches the
roster, reach resolution and the attendance aggregate at once. Model now, build
never or build on request.

**Trade-off.** A school that does run trials and make-ups administers them by
hand — a guest added to a roster, a note in the reason field. That is a worse
experience than a designed flow and a better outcome than a designed flow nobody
opens.

### 3.3 Skills and progress

**The criterion catalogue lives in `15-assessment-and-fees.md` §2, not here.**
An earlier draft carried `Skill` and `SkillRequirement` — "criteria per level,
assessed per student" — alongside the versioned `Criterion` that the
assessment model needs. They are the same concept with a different result type,
and D-084 collapses them into one: `Criterion` is the single catalogue.
This *removes* a table rather than adding one — and D-164 removes the seed
catalogue as well: v1 ships an empty one and an authoring surface (`15-…` §2.5,
§2.7).

**The names are the glossary's, under D-189.** This section and `15-…` §2 used
`AssessmentScheme` and `SchemeCriterion`; `docs/glossary.md` — the D-159
authority — says `CriterionSet` and `Criterion`, as does every decision from
D-160 onward. D-189 makes the glossary the tie-breaker and this is the applied
case.

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `CriterionSet` | awardTypeId, version, source, status, effectiveFrom, effectiveTo?, passFloorGradeId | 1 `AwardType`, N `Criterion` | The versioned *eisenpakket* — `docs/glossary.md`, D-160. **Authored in the application, never seeded** (D-164); `source` is the provenance label an administrator sets (`15-…` §2.5) |
| `Criterion` | criterionSetId, code, name, sequence, minimumGradeId? | 1 `CriterionSet` | The single criterion catalogue. Versioned and source-labelled — `15-…` §2.1, D-081, D-164 |
| `SkillProgress` | studentProfileId, criterionId, state, assessedByPersonId, assessedAt, sessionId?, note? | 1 `Criterion` | **Append-only**, and **informal**: the per-lesson teaching log. `state` ∈ {INTRODUCED, PRACTISING, ACHIEVED, REVOKED} |
| `AssessmentCriterionResult` | assessmentId, criterionId, gradeValueId, remark? | 1 `Assessment`, 1 `Criterion` | The **formal** graded observation, made during an *aftest* or an exam. `15-…` §2.1 |

`SkillProgress` is what an instructor writes at the poolside; it decides nothing.
`AssessmentCriterionResult` is what a qualified assessor writes during an
*aftest*; it decides whether a child sits an exam. Keeping both, against one
catalogue, is deliberate — the informal log is the product's daily value and the
formal result is its evidential one.

### 3.4 Attendance

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `ScheduledSession` | groupId, locationId, startsAt, endsAt, status | N `SessionRosterEntry`, N `AttendanceEvent` | **Owned by `sessions`** (D-057); `planning` and `attendance` are both consumers |
| `AttendanceEvent` | sessionId, studentProfileId, state, recordedByPersonId, recordedAt, `clientEventId`, `supersedesEventId?`, note? | | **Append-only.** `state` ∈ {PRESENT, ABSENT, EXCUSED, LATE}. A correction is a *new* event pointing at the one it replaces — the superseded row is never modified. `clientEventId` is a client-generated UUID making the write idempotent (P-02) |
| *(derived)* `AttendanceStatus` | sessionId, studentProfileId → effective state | | The current answer per student per session: the latest event not superseded by another. Materialised only if measurement demands it |

**Decision D-061 — Attendance is an append-only event log; a correction never
mutates an existing row.**

An instructor who marked a child absent and then finds them in the water writes
a *new* event carrying `supersedesEventId`. The effective status is derived: the
latest event for that student and session that nothing supersedes.

**Reason.** "Append-only" was previously asserted while the model still allowed
an in-place update, which would have quietly destroyed exactly the history the
claim promises. Attendance is evidence — for absence policy, for parental
disputes, and occasionally for safeguarding. Who said a child was present, and
when they changed their mind, is precisely what must survive.
**Trade-off.** Reads need a derived-state resolution instead of a direct column,
and the table grows with corrections. Both are cheap; a `(sessionId,
studentProfileId, recordedAt)` index answers the derivation directly.

**`clientEventId` is the single most important forward-looking field in the
schema.** It costs one indexed column now and is what makes offline-tolerant
attendance a feature addition rather than a rewrite. A retry, a double-tap or a
replayed offline queue all collapse to the same event.

### 3.5 Exams

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `ExamSession` | courseLevelId, locationId, scheduledAt, status | N `ExamCandidate`, N `ExamAssessor` | |
| `ExamCandidate` | examSessionId, studentProfileId, status | **0..N** `ExamResult` | A candidate may have several results over time: an original, a correction, an appeal outcome. Reaching `CONFIRMED` requires a passed independent *aftest* — D-085, `15-…` §3 |
| `ExamAssessor` | examSessionId, personId, role | | Records **who assessed** this session — an attribution fact, not an access grant. Access comes from a `SESSION`-scoped role assignment (**D-068**, which replaced D-054's `EXAM_SESSION` scope type; `02-security-privacy.md` §2.1–2.2 owns the mechanism). Supports the external examiner with no membership (D-052) |
| `ExamResult` | candidateId, outcome, recordedByPersonId, recordedAt, `supersedesResultId?`, reason?, remarks?, assessmentId? | 0..1 `Award` | **Append-only.** A correction is a new row pointing at the one it replaces. The **effective result** is the latest non-superseded row; exactly one exists per candidate at any time. `assessmentId` points at the exam-day per-criterion detail where it was recorded |
| `Award` | resultId, awardTypeId, number, issuedAt, revokedAt?, revokeReason? | 1 `AwardType` | The issued document. Issued against a *specific* result; correcting a result revokes the award and issues a new one — never edits it. **Renamed from `Certificate` (D-082)**, because in this domain a *certificaat* is a different kind of award, not the proof of a diploma |

**Decision D-062 — A candidate has 0..N results, not 0..1.**
**Reason.** A single-result model forces a correction to overwrite the original,
destroying the record of what was first decided and by whom — on a diploma
outcome, the one thing that must stay reconstructable. Appeals and
administrative corrections are normal in this domain, not exceptional.
**Trade-off.** Every read resolves the effective result rather than following a
single relation. One indexed lookup, and it is the same derivation pattern used
for attendance (D-061) and skill progress (D-005) — one concept, not three.

### 3.6 Scoping invariant

There is no tenant column. Instead, every entity that can be *reached* by a
scoped role resolves to a position in the organisational unit tree. `Group`
carries `unitId`; `ScheduledSession` inherits its unit from its group;
`StudentProfile` carries its home `unitId`. Reach resolution (§2.3 of
`02-security-privacy.md`) walks that tree, and every list query is filtered by
it.

**Decision D-006 (withdrawn) — `organizationId` is *not* carried on domain
rows.**
**Reason.** With one organisation per database the column is a constant. It
would be dead weight on ~20 tables, and a constant column gives no protection
while implying one, which is worse than absent. Domain rows instead carry
`unitId` where the organisational unit is meaningful — that is the column that
actually constrains access now (`02-security-privacy.md` §2).
**Trade-off.** Consolidating instances into a shared database later would
require adding the column and a backfill. Accepted deliberately; the brief
rules out multi-tenancy, and designing for a rejected model is exactly the
premature complexity the brief warns against.

---

## 4. Aggregate and transaction boundaries

| Aggregate | Root | Transactionally consistent with |
|---|---|---|
| Person + account | `Person` | Its `UserAccount`, its memberships |
| Student | `StudentProfile` | Its enrolments and group memberships |
| Session attendance | `ScheduledSession` | All its `AttendanceEvent` rows — **one transaction per group registration** |
| Assessment | `Assessment` | All its `AssessmentCriterionResult` and `CriterionWaiver` rows, and the computed outcome (`15-…` §2) |
| Exam | `ExamSession` | Candidates, assessors, results |
| Charge | `Charge` | Its `Payment` rows and the derived balance (`15-…` §6) |
| Organisation config | `Organization` | Branding, settings, pages |

Registering attendance for a group writes all records in **one transaction**.
Partial attendance is not a valid state — an instructor who saves must know it
either all landed or none did.

---

## 5. Data ownership

"Ownership" answers four questions per data class: which module may write it,
who may reach it, on what lawful basis it is held, and what happens when that
basis expires.

**All retention below is a *default proposal*, not a rule we impose.** Each is a
`RetentionPolicy` the organisation confirms or changes, with `onExpiry` being
`DELETE`, `ANONYMISE` or `REVIEW` (`02-security-privacy.md` §5.6, D-065).

**Decision D-110 — The retention table records a lawful basis per data class.**
The column existed in the prose describing this table ("on what lawful basis it
is held") and not in the table itself, so the one question an organisation must
answer to defend a default was the one the defaults did not state. A proposed
basis can be argued with; a blank cannot. Where the entry reads *unresolved*, it
is unresolved and must be settled before that default ships (F-128).

| Data class | Writing module | Reach | Lawful basis (proposed) | Trigger | Default retention | On expiry |
|---|---|---|---|---|---|---|
| Person identity | `identity` | Instance-wide | Contract / legitimate interest | Last relationship of any kind ends (§5.1) | 24 months | `REVIEW` → delete |
| Login credentials | Better Auth | Instance-wide | Contract | Account closed | Immediate | `DELETE` |
| Membership periods | `people` | Unit | Contract; legal obligation where a fiscal record depends on it | Last period ends | 7 years (financial/administrative, if applicable) | `REVIEW` |
| Student profile | `students` | Unit | Contract | Last enrolment ends | 24 months | `REVIEW` |
| Medical / pastoral notes | `students` | Unit + `students.medical.read` | **Explicit consent** (Art. 9) | Last enrolment ends | 12 months | **`DELETE`** — never anonymise |
| Assessment remarks | `assessment` | Group + `students.notes.read` | Legitimate interest (teaching) | Assessment date | 12 months | **`DELETE`** (D-087) |
| Attendance events | `attendance` | Group | Contract | Session date | 24 months | **`DELETE`** — see §5.3 |
| Skill progress | `skills` | Group | Contract | Achievement date | 7 years | `REVIEW` |
| Assessment results (formal) | `assessment` | Course / instance | Contract; legal claims where a ground applies | Assessment date | 7 years | `REVIEW` |
| Exam results & awards | `exams` | Course / instance | *Unresolved* — a ground must be identified per organisation (§5.2) | Award issue | 10 years **only where a retention ground applies** | `REVIEW` (§5.2) |
| **`SafetyNote` free text** | `students` | Instructors teaching that child **this season**, resolved through `resolveReach` — never by role name, never club-wide | **Explicit consent** (Art. 9(2)(a)), given by the guardian or by the pupil once D-151's age is reached, with authority evidence | Enrolment that justifies it ends, **or consent is withdrawn** | No longer than that enrolment | **`DELETE`** — never anonymise. Withdrawal deletes the text at once (D-177) |
| Charges | `fees` | `fees.read` | Legal obligation — fiscal administration | Charge due date | 7 years | `REVIEW` — **and see the pseudonymisation note below** (D-092) |
| Payments | `fees` | `fees.read` | Legal obligation — fiscal administration | Received date | 7 years | `REVIEW` — **and see the pseudonymisation note below** (D-092) |
| Consent records | `consent` | Instance-wide | Legal obligation — accountability (Art. 5(2)) | Withdrawal or expiry of purpose | As long as needed to demonstrate compliance | `REVIEW` |
| Audit events | `audit` | `audit.read` | Legitimate interest — security, and Art. 5(2) accountability | Event date | **Floor computed, stated once in `02-security-privacy.md` §3.2.1 (D-168):** `max(12 months, the longest configured retention among the classes these events evidence)` — with exam results and awards below at 7–10 years, that is the effective floor | `DELETE`, **prefix-only and checkpointed** (D-168) |
| Inquiries (public forms) | `pages` | Instance-wide | Legitimate interest — responding to a request | Submission | 6 months | `DELETE` |
| Waitlist entries | `students` | Unit | Legitimate interest — placing a request | Placement or withdrawal | 12 months | `DELETE` |
| **Pre-migration backups** | `maintenance` | Operators | Legitimate interest — recoverability | Migration run (D-044) | **Deleted after the next successful start; at most 3 retained** | `DELETE` |
| Public page content | `pages` | Instance-wide | — (no personal data) | — | Until deleted | — |
| Organisation settings & branding | `organization` | Singleton | — (no personal data) | — | Indefinite | — |
| Operational logs | `lib/logging` | Operators — **no PII** | Legitimate interest — operations | Write | 30 days | `DELETE` |

**Note on the two `fees` rows (D-092, and rev8 D-14).** These rows previously
read `PSEUDONYMISE`, which is **not a value `onExpiry` has**: the enum is
`DELETE`, `ANONYMISE`, `REVIEW` in the sentence above this table, in
`02-security-privacy.md` §5.6, and in `prisma/schema.prisma` (`enum OnExpiry`) —
and D-155 rules the fourth value out explicitly. The section stated the enum and
then used a value outside it.

**The two are different mechanisms, and separating them resolves it — which is
the reading the implementation had already reached.** `enum OnExpiry` in
`prisma/schema.prisma` states it: *"Retention expiry and erasure exemption are
two mechanisms; the fiscal ground belongs to the second."* `onExpiry` is what
happens when *retention runs out*, and at seven years the fiscal ground has
lapsed, so `REVIEW` is right — a human decides. **D-092 is about *erasure*:**
when a person exercises Article 17 while the fiscal ground still applies, the
charge is **pseudonymised** rather than deleted — it keeps its amount, date, fee
type and period and loses the link to the person. That is an **erasure exemption
on a financial retention ground**, which is exactly the shape D-154 generalises,
and it belongs to the D-014 erasure registry where D-092 puts it, not to this
column. Adding a fourth `onExpiry` value would reopen the argument D-155 spends
a page closing — that pseudonymisation does not end the obligation. Following D-065's honesty rule, a pseudonymised charge is **still
personal data** while the person exists elsewhere; what it is not is a reason to
keep the person.

**Note on `SafetyNote` (D-177).** Its row is above, and it is the one retention
default in this table whose trigger is not a date: *"retained no longer than the
enrolment that justifies it"*, and **withdrawal of consent deletes the text
immediately**, before any expiry. Consent is its lawful basis, so the retention
default is a ceiling, not a promise to keep it that long.

**Note on the audit row (F-133, settled by D-168).** Audit events must be
retained *at least as long as the longest-retained data class whose changes they
evidence*. Exam results and awards are kept up to 10 years while the record of
**who** entered an outcome would have expired at 24 months — eight years before
the outcome it attributes, in a design that justifies append-only results with
"a parent disputes a diploma decision". This was left as an open hand-off in
three documents and is now settled: the floor is **computed** from this table
rather than typed, in `02-security-privacy.md` §3.2.1, and the settings layer
displays it. It is deliberately one instance-wide value and not a per-event-class
one, because a per-class expiry deletes a sparse interior subset of the hash
chain, which no checkpoint can anchor (D-168 rule 2).

**On the pre-migration backup row.** D-044's automatic backup before a migration
is the right behaviour and it had **no retention policy at all** — meaning a full
copy of the database, including medical notes, accumulated once per upgrade and
outlived every rule in this table. A backup taken as a safety net is only needed
until the thing it protects against has not happened: delete it after the next
successful start, and keep at most three so that a bad migration discovered late
is still recoverable. Recorded as **F-49**.

### 5.1 People with no membership are not an edge case

The most common person in the database — a child taking lessons — has **no
membership at all**. Neither do guardians, external examiners, or former
students. A retention rule keyed on "active membership" would therefore miss the
majority of data subjects, silently retaining them forever.

**Decision D-066 — Person retention is triggered by the end of the person's
*last relationship of any kind*, not by membership.**

Relationships that hold a `Person`: an active `MembershipPeriod`; an active
`StudentProfile` enrolment; a role assignment (instructor, planner, examiner —
including an expired-but-within-retention exam assessment); a guardian
relationship to a person still held; an unexpired consent record; or a legal
retention ground on a record referencing them.

When the last one lapses, the person enters `REVIEW` and, after the configured
period, is deleted or genuinely anonymised. A guardian is held only while the
child they are guardian *of* is held — which follows automatically from the
rule rather than needing a special case.

**Reason.** Every person category must be covered by construction, because the
one that is forgotten is the one that accumulates indefinitely.
**Trade-off.** "Last relationship" is a computed condition over several modules
rather than a column, so it belongs to the same registry that erasure uses
(D-014) and is covered by the same test that asserts every `Person`-referencing
table is registered.

### 5.2 Awards and the right to erasure — honestly

An erasure request does **not** automatically lose to a diploma register.

The organisation must identify an actual ground for retention — a legal
obligation, or the establishment or defence of legal claims. Many swim schools
will have none, in which case the award record is deleted or genuinely
anonymised like anything else. Where a ground does exist, the record is retained
**with that ground recorded against it**, the data subject is told which records
were kept and why, and the retention is revisited when the ground expires.

And where an award number remains looked-up-able, the honest statement is that
the record is **pseudonymised, not anonymous** — it is still personal data
(D-065). Telling a parent otherwise would be wrong, and the privacy notice must
not do so. Finding **F-06 (revised)**.

### 5.3 Attendance does not "anonymise to aggregate"

**Decision D-111 — Expired attendance events are **deleted**, not anonymised.**
What may be kept is a genuinely aggregate counter that no longer references a
student — and it is kept because it was computed, not because a row was stripped.

The previous default said `ANONYMISE` to aggregate. Stripping the student
reference from an attendance event does not produce anonymous data here. A group
holds around twelve children, `GroupMembership` is retained and time-bounded, and
session dates are known. Anyone with both tables can re-identify a large share of
the stripped rows by a join and a counting argument — twelve memberships, eleven
present, one absent, and the absent child is whoever the roster says was not
counted. That fails the mechanical test for anonymisation being written into
`02-security-privacy.md`, and calling it anonymisation in a privacy notice would
be the same false comfort D-065 exists to prevent.

**Reason.** Anonymisation claims must survive the joins the same database makes
trivial. If a row can be re-identified from data the application itself retains,
it was pseudonymised, and pseudonymised data is still personal data with the same
obligations — so nothing was gained by not deleting it.

**Trade-off.** Attendance-rate history beyond the retention window is lost unless
someone deliberately computes and stores an aggregate first. That is the correct
order: decide what statistic is worth keeping, compute it, keep that — rather
than keeping the raw rows and calling them anonymous. Recorded as **F-48**.
