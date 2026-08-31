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
identity            Person, UserAccount, sessions, MFA, passkeys
access-control      Roles, permissions, access groups, assignments
organizations       Tenants, membership, organisational units
organization-units  Hierarchy / reach
audit               Append-only security & privacy event trail
consent             GDPR consent records
pages               Custom pages CMS
profile-fields      Org-configurable person attributes
users               Account administration
api-credentials     Scoped machine credentials
email-templates     Templated transactional email
notifications       Delivery
maintenance         Scheduled jobs (retention, cleanup)
```

New SplashTrack domain modules (built in v1, in this order):

```text
people              Domain view over Person: guardians, relationships, tags
students            StudentProfile, enrolment state, student lifecycle
groups              Group definition and membership over time
courses             Course/programme definitions, levels, enrolment
skills              Skill catalogue, requirements, per-student progress
attendance          Sessions and attendance records  ← flagship
exams               Exam sessions, candidates, examiners, results, certificates
planning            Schedule, locations, resources, instructor assignment
```

Deliberately **not** modules: "reporting" (a read concern satisfied by queries
until proven otherwise), "billing" (deferred), "website" (the `pages` module
plus theming already is the website).

### 1.2 Dependency rule

Modules form a directed acyclic graph. Arrows point *downward only*:

```text
        planning        exams
            \            /
        attendance    skills
              \        /
          groups    courses
              \      /
              students
                 |
               people
                 |
  identity / access-control / organizations   (foundation)
```

A module may depend on modules below it, never above or sideways without an
explicit published interface. `attendance` may ask `groups` who is in a group;
`groups` may never ask `attendance` anything. Where an upward signal is needed
(e.g. "attendance was registered, update progress"), it goes through a domain
event, not a call.

**Decision D-003 — In-process domain events for upward/sideways signals.**
**Reason.** Keeps `attendance → skills` decoupled without a message broker.
**Trade-off.** Events are synchronous and transactional in v1, so a slow
handler slows the write. Accepted; if that becomes real, the handler moves to
the existing `maintenance` job runner without changing the publisher.

---

## 2. Domain model

### 2.1 The identity spine (inherited, unchanged)

```text
Organization ──< OrganizationMembership >── Person ──0..1── UserAccount
                                              │
                                              └──< RoleAssignment >── Role ──< RolePermission >── Permission
```

- `Person` is the **PII anchor**. Name, date of birth, contact details live
  here and nowhere else.
- `UserAccount` holds **no credentials** — Better Auth owns those. It is the
  optional bridge between a human and a login.
- Every org-scoped row carries a direct `organizationId` column with an index,
  injected centrally by `forOrganization(orgId)`.

**Decision D-004 — `Person` spans organisations; profiles are org-scoped.**
**Reason.** One human, one PII record, is the only model that makes GDPR
rectification and erasure tractable — correcting a date of birth must not
require finding N copies. It also supports the real case of an instructor
working for two swim schools.
**Trade-off.** `Person` is not org-scoped, so it cannot rely on the automatic
scoping extension; access to a Person must always be justified by a membership
or profile in an organisation the caller can reach. This is a genuine sharp
edge and is called out as risk **F-01** in `10-findings.md`, with a mandatory
`assertPersonReachable(personId, orgId)` guard as the mitigation.

### 2.2 The swim domain

```text
Organization
  ├──< Location
  ├──< Course ──< CourseLevel
  │       └──< Enrolment >── StudentProfile
  ├──< Group ──< GroupMembership >── StudentProfile
  │       └── instructor: Person (assignment, time-bounded)
  ├──< SkillCatalogue ──< Skill ──< SkillRequirement
  │                          └──< SkillProgress >── StudentProfile
  ├──< ScheduledSession ──< AttendanceRecord >── StudentProfile
  ├──< ExamSession ──< ExamCandidate >── StudentProfile
  │       ├──< ExamAssessor >── Person
  │       └──< ExamResult ──0..1── Certificate
  └──< CustomPage    (inherited CMS)

Person ──1──< StudentProfile        (org-scoped)
Person ──<   PersonRelationship >── Person   (guardian ↔ child)
```

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

**`ScheduledSession` is the join point between planning and attendance.**
Planning produces sessions; attendance consumes them. One table, two module
owners — `planning` writes it, `attendance` reads it and writes
`AttendanceRecord` against it. This is the only shared table in the design and
it is deliberate: the alternative (attendance inventing its own session
concept) guarantees drift.

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
`organizationId`, `createdAt`, `updatedAt` are implied on every org-scoped
entity.

### 3.1 People and students

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `Person` | givenName, familyName, dateOfBirth, email?, phone? | 0..1 `UserAccount`, N `OrganizationMembership` | **Not** org-scoped. The only PII anchor |
| `PersonRelationship` | type (GUARDIAN_OF, EMERGENCY_CONTACT), fromPersonId, toPersonId | Person ↔ Person | Built in v1 (cheap); guardian portal deferred |
| `StudentProfile` | studentNumber, status, joinedAt, leftAt?, notes? | 1 `Person`, N `Enrolment`, N `GroupMembership` | Org-scoped. Medical/pastoral notes are **special-category data** — see `02-security-privacy.md` §5.3 |

### 3.2 Teaching structure

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `Course` | name, description, active | N `CourseLevel`, N `Enrolment` | What is taught |
| `CourseLevel` | name, sequence | N `SkillRequirement` | E.g. Diploma A → B → C |
| `Enrolment` | studentProfileId, courseId, status, startedAt, endedAt? | Student ↔ Course | Status is a lifecycle, not a payment state (P-03) |
| `Group` | name, courseLevelId?, capacity?, active | N `GroupMembership`, N `ScheduledSession` | Who is taught together |
| `GroupMembership` | studentProfileId, groupId, fromDate, toDate? | | **Time-bounded** — moving groups is a new row, not an update |
| `InstructorAssignment` | personId, groupId \| sessionId, role, fromDate, toDate? | | Instructors change; history is preserved |
| `Location` | name, address?, capacity? | N `ScheduledSession` | Pools, halls |

### 3.3 Skills and progress

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `Skill` | code, name, description, catalogueId, sequence | N `SkillRequirement`, N `SkillProgress` | Org-defined; catalogues are copyable between orgs by a platform admin |
| `SkillRequirement` | courseLevelId, skillId, mandatory | | Defines "what does Diploma A require" |
| `SkillProgress` | studentProfileId, skillId, state, assessedByPersonId, assessedAt, sessionId?, note? | | **Append-only**. `state` ∈ {INTRODUCED, PRACTISING, ACHIEVED, REVOKED} |

### 3.4 Attendance

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `ScheduledSession` | groupId, locationId, startsAt, endsAt, status | N `AttendanceRecord` | Written by `planning`, read by `attendance` |
| `AttendanceRecord` | sessionId, studentProfileId, state, recordedByPersonId, recordedAt, clientEventId, note? | | `state` ∈ {PRESENT, ABSENT, EXCUSED, LATE}. `clientEventId` is a **client-generated UUID** making the write idempotent (P-02) |

**`clientEventId` is the single most important forward-looking field in the
schema.** It costs one indexed column now and is what makes offline-tolerant
attendance a feature addition rather than a rewrite. A retry, a double-tap or
a replayed offline queue all collapse to the same row.

### 3.5 Exams

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `ExamSession` | courseLevelId, locationId, scheduledAt, status | N `ExamCandidate`, N `ExamAssessor` | |
| `ExamCandidate` | examSessionId, studentProfileId, status | 0..1 `ExamResult` | |
| `ExamAssessor` | examSessionId, personId, role | | Supports the **external examiner** case (F-03) without org membership |
| `ExamResult` | candidateId, outcome, recordedByPersonId, recordedAt, remarks? | 0..1 `Certificate` | Append-only; a correction is a new row referencing the superseded one |
| `Certificate` | resultId, number, issuedAt, revokedAt?, revokeReason? | | A diploma is a legal-ish artefact: issue and revoke, never delete |

### 3.6 Multi-tenancy invariant

Every org-scoped entity above carries `organizationId` **directly**, even when
it could be derived through a parent. `AttendanceRecord` could reach its
organisation via `ScheduledSession → Group → Organization`, but stores it
anyway.

**Decision D-006 — Denormalise `organizationId` onto every org-scoped row.**
**Reason.** It makes the central scoping extension a single `where` injection
instead of a join, makes every isolation test trivial, and makes an accidental
cross-tenant leak require *two* mistakes rather than one.
**Trade-off.** Redundant data that could theoretically diverge. Mitigated by a
database check: `organizationId` is part of composite foreign keys where the
parent relation exists, so the database itself refuses a child whose org
differs from its parent's.

---

## 4. Aggregate and transaction boundaries

| Aggregate | Root | Transactionally consistent with |
|---|---|---|
| Person + account | `Person` | Its `UserAccount`, its memberships |
| Student | `StudentProfile` | Its enrolments and group memberships |
| Session attendance | `ScheduledSession` | All its `AttendanceRecord` rows — **one transaction per group registration** |
| Exam | `ExamSession` | Candidates, assessors, results |
| Organisation config | `Organization` | Branding, settings, pages |

Registering attendance for a group writes all records in **one transaction**.
Partial attendance is not a valid state — an instructor who saves must know it
either all landed or none did.

---

## 5. Data ownership

"Ownership" answers three questions per data class: which module may write it,
which organisation controls it, and who is the GDPR controller.

| Data class | Writing module | Tenant scope | GDPR role | Retention default |
|---|---|---|---|---|
| Person PII | `identity` | Cross-org (shared human) | SplashTrack = processor; each org = controller for its use | While any active membership + 24 months |
| Login credentials | Better Auth | Cross-org | Processor | Account lifetime |
| Student profile & notes | `students` | Single org | Org is controller | Enrolment + 24 months, then anonymise |
| Medical / pastoral notes | `students` | Single org | Org is controller, **special category** | Enrolment + 12 months, then hard delete |
| Attendance records | `attendance` | Single org | Org is controller | 24 months, then aggregate + anonymise |
| Skill progress | `skills` | Single org | Org is controller | 7 years (evidence for diplomas) |
| Exam results & certificates | `exams` | Single org | Org is controller | 10 years — a diploma must remain verifiable |
| Audit events | `audit` | Org-tagged, platform-readable | Joint; legitimate interest | 24 months minimum, then rotate |
| Public page content | `pages` | Single org | Org is controller | Until deleted by org |
| Platform settings | `organizations` | Platform | SplashTrack is controller | Indefinite |
| Operational logs | `lib/logging` | None — **no PII** | n/a | 30 days |

**The retention conflict is real and must be surfaced, not hidden.** Exam
results are kept for 10 years, but the `Person` behind them may exercise the
right to erasure. These cannot both be satisfied literally.

**Decision D-007 — Erasure severs identity; it does not delete the record.**
**Reason.** Erasing a `Person` anonymises the person record and severs the
link, while the `ExamResult` and `Certificate` survive as pseudonymised rows
retaining only the certificate number and outcome. The organisation keeps a
verifiable diploma register; the human is no longer identifiable from it. This
is the standard reconciliation of Article 17 with a legal-retention basis.
**Trade-off.** A revoked-diploma dispute after erasure can no longer be traced
to a named individual. Accepted, and it must be stated in the organisation's
privacy notice — a **process** obligation SplashTrack cannot solve in code.
This is finding **F-06**.
