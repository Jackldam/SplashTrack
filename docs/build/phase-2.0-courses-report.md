# Phase 2.0 — the `courses` module

**Branch** `build/courses-module` · **From** `43a796c` (677 tests) · **To** 754
tests · **Not pushed, not merged, not deployed.**

`Course`, `CourseLevel` and `Enrolment` — R-06 — and the FK phase 1.6 declined
to add until they existed: `Group.courseLevelId`.

Decisions implemented: **D-059** (intervals, never a status flag), **D-093**
(no `EnrolmentStatus` member may mean "unpaid"), **D-109** (`TRIAL` is
modelled, no workflow is built), **D-134** (one home per fact — `endedAt IS
NULL` is the only "currently enrolled" signal), **D-145** (live per-relation
coverage, both directions: `courses` both consumes `groups`' published id
lookup and supplies the four `ScopeRelations` `groups`/`sessions` were
denying on), **D-163** (no dangling stub columns — twice, in both
directions), **D-170** (`COURSE` reach and its containment/window rules).

---

## 0. What landed

| Commit | |
|---|---|
| `f7ac8c0` | `feat(schema)` — `Course`, `CourseLevel`, `Enrolment`, `Group.courseLevelId`, 3 hand-written constraints |
| *(unstaged at time of writing)* | `feat(courses)` — the module: domain, application, infrastructure, `index.ts`, UI (`/courses`, `/courses/[courseId]`), Dutch/English strings, wiring into `people`'s and `groups`' existing screens |
| *(unstaged)* | `test(courses)` — fixtures, scope-escape suite, domain tests, service tests, hand-written-constraint tests |

### 0.1 The schema, and what it deliberately does not have

- **`Course`** (`name`, `description`, `active`) and **`CourseLevel`** (`name`,
  `sequence`) — `01-domain-model.md` §3.2. Teaching configuration, no personal
  data: both are `ORGANIZATION_SETTINGS`, on the `Group`/`GroupMembership`
  split phase 1.6 already established.
- **`Enrolment`** (`studentProfileId`, `courseId`, `status`, `startedAt`,
  `endedAt?`) — time-bounded, never a status flag (D-059). `EnrolmentStatus`
  is `{ENROLLED, TRIAL}`; there is no `ACTIVE`/`ENDED` member because whether
  an enrolment is running is `endedAt IS NULL`, one home for one fact
  (D-134). It shares `StudentProfile`'s data class (`STUDENT_PROFILE`), not a
  class of its own, on the same precedent as `GroupMembership`/`GroupMove`.
  It references `StudentProfile`, not `Person`, so it appears in neither the
  erasure registry nor `PERSON_REFERENCE_CLASSIFICATION` — it leaves when the
  profile an erasure deletes explicitly goes.
- **`Group.courseLevelId`** — §3.2's own field, nullable, no backfill. Phase
  1.6 declined it because `CourseLevel` did not exist yet and a dangling id is
  the stub column D-163 refuses; it exists now.

**Deliberately NOT added:**
- `CourseLevel.awardTypeId` — D-163. `AwardType` belongs to the unbuilt
  assessment/exams module; the column would be exactly the stub phase 1.6
  refused, from the other direction. It arrives with `AwardType`.
- Any end date on `Course` — see §1 below.

Three hand-written constraints the Prisma DSL cannot express, each pinned by
`tests/integration/courses-constraints.test.ts`: `Enrolment_window_order_check`
(`endedAt` after `startedAt`), `Enrolment_single_open_enrolment_key` (at most
one open enrolment per pupil per course), `CourseLevel_sequence_positive_check`.

### 0.2 What no service in this module will ever do

- Delete a `Course`, a `CourseLevel`, or an `Enrolment`. A course is retired
  with `active = false`; a level is pointed at by every group taught at it; an
  enrolment is a pupil's history and is *closed*, never removed. The
  `onDelete: Restrict` foreign keys refuse the first two at the database as
  well.
- Change `Enrolment.status` after the fact. Converting a *proefzwemmer* into a
  pupil is closing one interval and opening another — a new row, not the old
  one edited — which is what keeps the record that the trial happened.
  `tests/integration/courses-services.test.ts` asserts this directly: after a
  TRIAL→ENROLLED conversion, the old row is untouched and a second row exists.

---

## 1. Where the design and an existing decision disagree, and what stayed unresolved

**`Course` has no end date, and D-170 needs one.** D-170 bounds a `COURSE`
grant's `validUntil` at *"the course's own end date + 7 days"*.
`01-domain-model.md` §3.2 — the authority on what a `Course` holds — lists
`name, description, active` and no dates at all.

This build did not invent one. Adding a date would be inventing a fact the
club has to maintain for a grant type nothing issues yet (the `exams` module's
Internal examiner role is the one that needs `COURSE` reach, and `exams` is
unbuilt); defaulting the ceiling instead would put the value back under the
control of whoever types it, which is the exact thing D-052 could never
enforce and D-170 exists to fix. So `courseEndDate` resolves to `null`
always, `assertGrantable` refuses every `COURSE` proposal as
`UNRESOLVABLE`, and that refusal is the safe direction rather than a shrug.
The cost today is zero: nothing in v1 issues a `COURSE` grant through the
issuing path. **This is an open question for whoever builds `exams`, not a
defect in this phase** — recorded here rather than guessed at.

A `COURSE` grant written directly to `RoleAssignment` (as the test fixtures
do) still resolves normally — `resolveReach` reads no relation for that path
— so the coverage rules below are live and tested even though the issuing
path is closed.

**A `COURSE`-scoped `RoleAssignment` requires `validUntil`, same as
`SESSION`.** `RoleAssignment_bounded_window_check` extends D-144's bounded-
window rule to `COURSE` at the schema level; this was not called out in
`courses-scope-relations.ts`'s own comments and was learned while writing
`tests/support/courses-fixtures.ts`.

---

## 2. The asymmetry `sessionsOfCourse` records

§2.2 gives `COURSE` coverage as *"that course, its levels, its enrolments, and
all its exam sessions"* — no mention of a course's groups' ordinary lessons.
`sessionsOfCourse` therefore always answers `[]`: not a stub (an unregistered
relation throws; this one returns a real, considered answer), but the honest
statement that `ExamSession` belongs to the unbuilt `exams` module and this
installation has none.

**The consequence is real and asymmetric, and it is pinned by a named test**
(`tests/integration/courses-scope-escape.test.ts`, *"does NOT reach the
group's scheduled lessons"*): a `COURSE`-scoped principal reaches the course's
groups (`groupsOfCourse`, the D-170 containment relation) but none of those
groups' `ScheduledSession` rows. `sessionFilterForReach`'s `COURSES` branch
denies for the matching reason, so the predicate and the list filter agree —
the property `06-delivery.md` §2.1 exists to protect.

---

## 3. Definition of Done (`06-delivery.md` §4.4)

| Requirement | Status |
|---|---|
| Data model | `Course`, `CourseLevel`, `Enrolment`, `Group.courseLevelId` — `f7ac8c0` |
| Service | `course-service.ts`, `level-service.ts`, `enrolment-service.ts`, all behind `requirePermission` + `resolveReach` |
| UI | `/courses`, `/courses/[courseId]`, course-level fields on the group screen, enrolments on the person screen — Dutch and English strings both present, both valid JSON |
| Scope-escape tests | `tests/integration/courses-scope-escape.test.ts` — a `COURSE`-scoped principal case (§2.1's requirement), the `sessionsOfCourse` asymmetry above, D-170 no-ranking checks (`UNIT`/`GROUP`/`SESSION` grants do not reach a course), list/predicate agreement, no-grant denial |
| Domain/service tests | `tests/unit/courses-domain.test.ts`, `tests/integration/courses-services.test.ts`, `tests/integration/courses-constraints.test.ts` |
| `Person`-reference registry | No new entry needed — `Enrolment` references `StudentProfile`, not `Person` (see §0.1); `Course`/`CourseLevel` reference neither |
| Retention (`DATA_CLASS_BY_MODEL`) | Schema carried the `/// @dataClass` markers from `f7ac8c0`; the registry side (`src/lib/retention/data-class-registry.ts`) was missing the three entries until this phase closed it out — `tests/unit/data-class-registry-sync.test.ts` is green |
| CI | `npx vitest run`: 60 files / 754 tests passed. `npm run typecheck`: clean. `npm run lint`: clean (one pre-existing, unrelated warning) |
| Jack's approval | Not yet requested — this report is the handoff |

**Open items for review, not silently resolved:**
1. §1's `courseEndDate` question — stays `UNRESOLVABLE` until `exams` exists or the design is amended.
2. §1's `RoleAssignment` bounded-window extension to `COURSE` — worth a one-line note on D-144 or D-170 itself so the next reader does not have to rediscover it from the constraint name.
