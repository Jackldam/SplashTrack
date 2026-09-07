# Phase 2.1 — the `skills` module

**Branch** `build/skills-module` · **From** `82859e3` (754 tests) · **To** 811
tests · **Not pushed, not merged, not deployed.**

`AwardType`, `GradeScale`/`GradeValue`, `CriterionSet`, `Criterion` — the
criterion catalogue (R-07) — and `SkillProgress`, the append-only, informal
per-lesson teaching log kept against it. Plus the column phase 2.0 named and
declined: `CourseLevel.awardTypeId`, real at last.

Decisions implemented: **D-084** (`Criterion` is the single catalogue,
`Skill`/`SkillRequirement` stay collapsed — this phase built the table that
decision only named), **D-081** (pin the criterion-set foreign key, never
resolve by date; `DRAFT → ACTIVE → RETIRED`, an `ACTIVE` set never edited),
**D-164** (the catalogue ships empty and administrator-authored — nothing here
seeds an `AwardType`, a `CriterionSet` or a `Criterion`), **D-160** (the one
grade scale *is* seeded, `onvoldoende…zeer goed`, on the pattern
`seedInstallation()` already uses for the permission catalogue), **D-005**
(`SkillProgress` is append-only, the same event-log shape as attendance and
exam results), **D-163** (no dangling stub columns — `CourseLevel.awardTypeId`
closes the one phase 2.0 opened), **D-189** (`CriterionSet`/`Criterion`, the
glossary's names, never `AssessmentScheme`/`SchemeCriterion`). **D-080** and
**D-188** are cited below as *data model prepared, mechanism not built* — see
§1.

---

## 0. What landed

| Commit | |
|---|---|
| `feat(schema)` | `AwardType`, `GradeScale`, `GradeValue`, `CriterionSet`, `Criterion`, `SkillProgress`, `CourseLevel.awardTypeId` — five enums, six models, four hand-written constraints |
| `feat(skills)` | the module: domain, application, infrastructure, `index.ts`; the two small cross-module additions (`courses.awardTypeOfCourseLevel`, `groups.courseLevelOfGroup`); the `courses`/`groups`/`people` UI wiring; Dutch/English strings |
| `test(skills)` | fixtures, scope-escape, domain, service and hand-written-constraint coverage |
| `docs(build)` | this report |

### 0.1 The schema, and what it deliberately does not have

- **`AwardType`** (`code`, `name`, `kind` ∈ {DIPLOMA, CERTIFICATE},
  `issuingBody` ∈ {NRZ, ORG}) — `ORGANIZATION_SETTINGS`, teaching
  configuration, no personal data, on the `Course`/`CourseLevel` precedent.
  No status, no delete, no retire flag: nothing in this module removes one,
  and an award type the club has stopped using simply stops getting a new
  `CriterionSet` version.
- **`GradeScale`/`GradeValue`** — generic and org-owned per §2.1
  (*"(ordinal, org-owned)"*), even though v1 seeds and uses exactly one:
  `onvoldoende=1 · matig=2 · voldoende=3 · goed=4 · zeer goed=5` (D-160,
  OD-17 resolved). Seeded by `seedInstallation()`
  (`src/lib/boot/seed.ts`), on the machine key `SEEDED_GRADE_SCALE_KEY =
  "nrz_5punts"` — the same idempotent-upsert shape the permission catalogue
  and the two system roles already use. **Read-only in this phase's UI**, per
  the build brief; the model permits a second scale, nothing authors one.
- **`CriterionSet`** (`awardTypeId`, `version`, `source` ∈ {NRZ, ORG},
  `status` ∈ {DRAFT, ACTIVE, RETIRED}, `effectiveFrom?`, `effectiveTo?`,
  `passFloorGradeId?`) — the versioned *eisenpakket*. **Never seeded**
  (D-164): `createCriterionSet` opens version 1 (or the next free version) as
  a `DRAFT`, and refuses to open a second `DRAFT` for the same award type
  while one is already open. `publishCriterionSet` is the one `DRAFT → ACTIVE`
  transition (D-081): in one transaction, this version becomes `ACTIVE` with
  `effectiveFrom = now`, and the award type's previous `ACTIVE` version (if
  any) becomes `RETIRED` with `effectiveTo = now`. Publishing refuses an empty
  set and a set with no pass floor — a published set with nothing to fail
  is not a state this module will write.
- **`Criterion`** (`criterionSetId`, `code`, `name`, `sequence`,
  `minimumGradeId?`) — one requirement inside a set. `sequence` orders a list
  and decides nothing, on the `CourseLevel.sequence` pattern; `minimumGradeId`
  is `NULL = use the set's pass floor` per D-080. No delete, ever: a `DRAFT`
  set is corrected by editing a criterion's fields in place, and a published
  mistake is fixed in the *next* version (D-081's own words: *"a typo in a
  criterion name requires a new version"*).
- **`SkillProgress`** (`studentProfileId`, `criterionId`, `state` ∈
  {INTRODUCED, PRACTISING, ACHIEVED, REVOKED}, `assessedByPersonId?`,
  `assessedAt`, `sessionId?`, `note?`) — the informal, per-lesson log.
  `STUDENT_PROFILE` data class, on the `Enrolment` precedent: it shares the
  pupil's class and the `LAST_ENROLMENT_END` trigger rather than getting a
  class of its own. **Append-only** — `REVOKED` is a state written the same
  way any other is, never a delete and never an `UPDATE` of an earlier row.
- **`CourseLevel.awardTypeId`**, real at last — nullable, unbackfilled, on the
  `Group.courseLevelId` precedent phase 2.0 itself was: "we have not recorded
  what this level leads to" is a real and common state, not an error.

Four hand-written constraints, each named and each proved in
`tests/integration/skills-constraints.test.ts`:
`CriterionSet_one_active_per_award_type_key` (a partial unique index — exactly
one `ACTIVE` version per award type, the database's own backstop under
`publishCriterionSet`'s check), `CriterionSet_effective_from_with_status_check`
(a `DRAFT` never carries `effectiveFrom`, a published set always does — the
same "status and the date that explains it, together or not at all" pairing
`ScheduledSession.cancelledAt`/`cancellationReason` already uses),
`Criterion_sequence_positive_check` and `GradeValue_rank_positive_check` (both
`CourseLevel_sequence_positive_check`'s reasoning: a non-positive value is
only ever a typo).

### 0.2 What no service in this module will ever do

- Delete an `AwardType`, a `CriterionSet` or a `Criterion`. The catalogue is
  append/version-only (D-081, D-164).
- Edit a published (`ACTIVE`/`RETIRED`) `CriterionSet`, or add/correct a
  criterion inside one. `updateCriterionSet`, `createCriterion` and
  `updateCriterion` all re-check `status === "DRAFT"` **inside** the
  transaction that writes, not only before it — a set publishing between the
  read and the write refuses the write rather than racing it.
- Update an existing `SkillProgress` row. `REVOKED` is recorded the same way
  `ACHIEVED` is; `tests/integration/skills-services.test.ts` asserts this
  directly — after a REVOKED correction, the earlier row is untouched and a
  second row exists.
- Branch on `AwardType.kind` anywhere. D-080's pass rule (`rank(result) ≥
  rank(minimum ?? passFloor)`) is data this module's schema carries — the
  function itself belongs to the (unbuilt) assessment module; see §1.

---

## 1. Where this phase stops short of the design set, and why — read before assuming a gap is an oversight

### 1.1 D-080's pass function is not built here, and could not honestly be

§2.2's pass rule — `∀ c ∈ criteria : ∃ r with rank(r.grade) ≥ rank(c.minimumGrade
?? passFloor) ∨ ∃ waiver` — is written over `AssessmentCriterionResult` and
`CriterionWaiver`, both explicitly out of this phase's scope (the task brief
names them alongside `Assessment`, `Award`, `PersonQualification` as "a
separate, later, very careful slice"). What this phase built is the *data* the
rule will read the day it exists: `GradeValue.rank` as the only ordinal
comparison, `CriterionSet.passFloorGradeId` and `Criterion.minimumGradeId` as
the two-level override D-080 specifies. Nothing here computes a pass. That is
not a partial implementation of D-080 — it is the boundary the task brief
drew, taken literally.

### 1.2 D-188's JSON authoring surface is not built — the form editor only

D-188 specifies **two** interchangeable surfaces over one model: a form editor
(built) and a JSON document an administrator can upload to create or update a
whole catalogue in bulk, with round-tripping as "a requirement, not a nicety."
The build brief's scope list, read literally, asks for "Minimale
Nederlandstalige UI: catalogusbeheer (AwardType aanmaken, CriterionSet +
Criterion per set beheren, GradeScale is read-only/systeem)" — a form surface,
not a document one. Building D-188's second surface properly (constraint 2:
*"neither surface may express anything the other cannot"*; constraint 4: a
round-trip test in the suite) is a real, separate piece of work, not an
afternoon's addition to this phase. **Left undone, not silently dropped** —
D-188 is a named decision this build does not close, and whoever picks it up
next should read §2.7 of `15-assessment-and-fees.md` before starting, not this
report's summary of it.

### 1.3 The fork rule (D-164) is not automatically enforced

D-164: *"a new version that changes a threshold on an `NRZ`-labelled set is
stamped `ORG`."* `CriterionSet.source` is a field an administrator sets by
hand on every version, including the next one — `updateCriterionSet` never
inspects the *previous* version's criteria to detect that a threshold moved
and re-stamp the label automatically. Building that detection is a field-by-
field diff over two versions' `Criterion` rows, and neither the design set nor
this phase's brief specifies the algorithm precisely enough to build safely
(what counts as "a threshold changed" when a criterion is also added or
removed in the same version?). The administrator authoring the fork is trusted
to set `source = ORG` themselves; nothing stops them from forgetting.

### 1.4 `AwardType.code` and `.kind` are not correctable after creation

`updateAwardType` accepts `name` and `issuingBody`; `code` and `kind` are
fixed at creation. `code` is the identifier every `CriterionSet.awardTypeId`
and `CourseLevel.awardTypeId` points at by *id*, not by code, so this is not a
structural necessity — but `code` is also what an administrator
cross-references against a paper NRZ document, and `kind` decides which pass
rule (§1.1) a criterion set is authored against. Neither is unsafe to change
in principle; neither had a stated need to change in this phase, and inventing
a correction flow for a case nobody asked for is the premature machinery
`CLAUDE.md` warns against. A mistake today is fixed by creating a new award
type — administratively wasteful, never data-destructive.

### 1.5 `getSkillProgressForStudent` does not narrow per row beyond `{ student }` — the open question with the most teeth

This is the one worth reading slowly, because it is a real gap against D-145
rule 2, not a shortcut.

**What the design asks for.** §2.2: *"`GROUP` … the group-scoped relations of
the students in it. Not the whole student record."* D-145 rule 2 makes that a
*field-level* requirement — a `GROUP`-scoped instructor's `students.read`
returns "this group's progress and attendance," never the pupil's history
elsewhere. Phase 2.0's `EnrolmentEntry` closes the equivalent question for
enrolments: a course the caller cannot see is rendered `courseWithheld: true`
rather than silently included.

**What this module actually does.** `getSkillProgressForStudent` guards
`{ student: studentProfileId }` — the same single-resource gate
`getStudentEnrolments` uses — and once that gate is cleared, returns **every**
`SkillProgress` row for that pupil. There is no per-row narrowing to "the
rows this reach can attribute to a group it holds."

**Why closing it properly needs a fact the schema does not carry.**
`SkillProgress` has no `courseId` or `groupId` column — §3.3's field list gives
it `studentProfileId, criterionId, state, assessedByPersonId, assessedAt,
sessionId?, note?`, full stop. The only relational hook that could narrow by
group is the **optional** `sessionId`, and even a full per-row resolution
through it does not give the right answer:

- Rows with no `sessionId` (a correction made after the fact, a bulk import)
  cannot be attributed to any group at all through that path — narrowing would
  make them invisible to a `GROUP`-scoped reader even when they should
  arguably be visible, or visible to nobody but `ORGANIZATION`, neither of
  which the design states.
- Rows *with* a `sessionId` could in principle be narrowed via `sessions`'
  own `sessionFilterForReach` — but that function's `COURSES` branch is a
  deliberate `DENIED` (`session-reach-filter.ts`'s own comment: *"Answering
  'which scheduled sessions belong to this course' needs `sessionsOfCourse`,
  which `courses` owns and has not registered because it does not exist."*
  `courses`' `sessionsOfCourse` always answers `[]` — phase 2.0's own
  asymmetry, not new here). Routing `SkillProgress` visibility through it
  would mean a `COURSE`-scoped **aftest assessor** — whose entire reason to
  read this log is chapter 15's own thesis, *"the informal log is the
  product's daily value"* for exactly the person deciding whether a child
  sits an exam — sees **nothing**, ever, through that path. That is a worse
  defect than the one being fixed.

**What was rejected, and why.** Inventing a `groupId` column on
`SkillProgress` was rejected — the domain model (§3.3) does not give it one,
and adding a field to satisfy an authorization nuance the design never states
is exactly the kind of invention `CLAUDE.md` §7 asks not to guess at.
Routing narrowing through `sessionId` was rejected for the reason above: it
would produce a *worse* failure (an aftest assessor blind to the log) while
fixing a narrower one (an off-duty instructor slightly over-sighted). Between
an unclosed rule and a closed rule that breaks the person the chapter is
written for, this phase left the rule unclosed and wrote it down.

**What this means in practice today.** A `GROUP`-scoped instructor who
currently teaches a pupil in *any* group sees that pupil's *entire* skill
history — every criterion, every award type, every group they have ever been
taught in. That is coarser than D-145 rule 2 asks for. It is bounded by the
outer gate (`{ student }` still requires an active, live relation — a lapsed
instructor sees nothing, per D-145 rule 1), and it is the same shape
`getStudentEnrolments` would have had before phase 2.0 added course-level
narrowing specifically because `Enrolment.courseId` exists to narrow by.
**This is a decision for Jack, not a guess:** either accept the coarser
grain as the v1 shape for a per-lesson log (arguably defensible — the
alternative, silently hiding half a child's swimming history from the
instructor teaching them, has its own cost), or add the schema hook (a
`groupId` snapshot, most likely) in a follow-up slice with a stated reason.

---

## 2. The dependency direction, against the design set's own DAG

`06-delivery.md` §5 lists the intended build order as `people → students →
groups → courses → skills → sessions → attendance → …`. This repository's
actual history does not match it: `groups` and `sessions` were built together
in phase 1.6 (`470cbcb`), before `courses` (phase 2.0) and well before this
phase. `skills` therefore lands *after* `sessions` already exists, not before
it.

This mattered for exactly one design choice (§1.5): whether `skills` could
lean on `sessions`' `sessionFilterForReach` to narrow `SkillProgress` reads.
It could have, mechanically — the module exists. It was rejected on its own
merits regardless (the COURSE-branch defect above), so the DAG mismatch ended
up costing nothing this phase. But it is worth recording plainly: **`skills`
depends on `courses` and `groups`, and on neither `sessions` nor `people`
directly** (the `SkillProgress.assessedByPersonId`/`.studentProfileId` foreign
keys are schema-level references, not module imports — no file under
`src/modules/skills/` imports `@/modules/sessions` or `@/modules/people`).
That is a narrower dependency footprint than the stated DAG implies is
possible at this position, and it is narrower because §1.5 stayed an open
question rather than being closed through `sessions`.

---

## 3. Definition of Done (`06-delivery.md` §4.4)

| Requirement | Status |
|---|---|
| Data model | `AwardType`, `GradeScale`, `GradeValue`, `CriterionSet`, `Criterion`, `SkillProgress`, `CourseLevel.awardTypeId` — schema + migration `20260907140000_skills_module` |
| Service | `award-type-service.ts`, `grade-scale-service.ts`, `criterion-set-service.ts`, `criterion-service.ts`, `skill-progress-service.ts`, all behind `requirePermission` |
| UI | `/skills`, `/skills/[awardTypeId]`, `/skills/[awardTypeId]/sets/[criterionSetId]` (catalogue authoring, Dutch); the group screen's per-lesson progress form (`/groups/[groupId]`); the person screen's read-only progress log (`/people/[personId]`); the course-level award-type picker (`/courses/[courseId]`) — Dutch and English strings both present, both valid JSON, parity-tested |
| Scope-escape tests | `tests/integration/skills-scope-escape.test.ts` — the catalogue's `ORGANIZATION`-only property pinned against `UNIT` and `GROUP` by name; `recordSkillProgress`'s `{ group }` guard and its layered domain check (not-a-member) asserted as *distinguishable* failures; `getSkillProgressForStudent`'s `{ student }` gate |
| Domain/service tests | `tests/unit/skills-domain.test.ts`, `tests/integration/skills-services.test.ts`, `tests/integration/skills-constraints.test.ts` |
| `Person`-reference registry | `SkillProgress.assessedByPersonId` — `SEVER_AND_RETAIN`, on the `GroupMove.decidedByPersonId` pattern (`src/modules/users/infrastructure/person-reference-classification.ts`). `SkillProgress.studentProfileId` references `StudentProfile`, not `Person` — no entry needed, same as `Enrolment` |
| Erasure registry | `SkillProgress: { kind: "erase" }` added (it references `Person` directly, unlike `AwardType`/`GradeScale`/`GradeValue`/`CriterionSet`/`Criterion`, which reference none and are correctly absent) |
| Retention (`DATA_CLASS_BY_MODEL`) | All six new models classified — five `ORGANIZATION_SETTINGS`, `SkillProgress` shares `STUDENT_PROFILE` — closed in the same commit as the schema, not found later |
| CI | `npx vitest run`: 64 files / 811 tests passed, zero regressions in the pre-existing 754. `npm run typecheck`: clean. `npm run lint`: clean (the one pre-existing, unrelated warning phase 2.0 also noted). `npm run format:check`: clean on every file this phase touched |
| Jack's approval | Not yet requested — this report is the handoff |

**Open items for review, not silently resolved:**
1. §1.1 — D-080's pass function is unbuilt by design; this phase supplies its data model only.
2. §1.2 — D-188's JSON authoring surface is unbuilt; the form editor is the only surface this phase ships.
3. §1.3 — the D-164 fork rule (re-stamping `source = ORG` on a threshold change) is administrator-trusted, not detected.
4. §1.4 — `AwardType.code`/`.kind` have no correction path; recorded as a scope decision, not an oversight.
5. §1.5 — **the one that needs a decision, not just a reading**: `getSkillProgressForStudent` does not narrow per row to a `GROUP`-scoped reach's own relation, against D-145 rule 2's letter. The reasoning for leaving it open, and the two real alternatives, are in §1.5.
6. A domain question, not a technical one: **`SkillProgress.note` is free text about a child's body, written far more often than any other free-text field in this schema, and it is not currently in D-148's protected class** (medical remarks, pastoral notes, assessment remarks, inquiry text — see the schema comment on the field). D-148's own reasoning for including `AssessmentCriterionResult`'s remark — *"a developmental observation about a minor's body"* — reads as equally true of this field. Not decided here; flagged for Jack, who is the domain authority CLAUDE.md §7 says this kind of question belongs to.
