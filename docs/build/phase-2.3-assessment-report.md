# Phase 2.3 — the `assessment` module

**Branch** `build/assessment-module` · **From** `c68f3c0` (916 tests including
this phase's own — the pre-existing suite was 868 before this branch) · **Not
pushed, not merged, not deployed.**

`Assessment`, `AssessmentCriterionResult`, `CriterionWaiver` — the formal,
four-eyes-gated *aftest* (`15-assessment-and-fees.md` §2-5;
`01-domain-model.md` line ~130). A child reaches the exam only because a
*second, independent* instructor has graded every requirement and found it
at least *voldoende*. This phase builds that aftest: recording it, computing
its outcome from data rather than code, refusing it when the assessor is the
student's own instructor, and protecting the remark an assessor writes about
a child's body the same way a medical note is protected.

Decisions implemented: **D-080** (the pass rule, computed for real at last —
`computeOutcome` in `domain/pass-rule.ts`, no `AwardType.kind` branched on
anywhere), **D-081** (`Assessment.criterionSetId` pins the version; never
resolved by date), **D-085** (the four-eyes gate — the checkable half, see
§1.1), **D-086** (every criterion starts unset; an outcome is never computed
over one that stays that way — enforced server-side as `INCOMPLETE`, not
only as a UI convention), **D-087/D-148** (assessment remarks are the first
real production columns in the protected free-text class: column-encrypted,
audited on read, gated by `students.notes.*` rather than general
`students.read`), **D-005/D-061/D-062** (append-only, the
`SkillProgress`/`AttendanceEvent` supersession shape, a third time), and
**D-057/CLAUDE.md §4** (this module owns none of `skills`'/`sessions`'/
`groups`'/`courses`' tables; it calls their published services). **D-068**
(the blocker the chapter itself named — `SESSION` participation reach) was
resolved in the attendance phase and is used here exactly as attendance uses
it.

---

## 0. What landed

| Commit | |
|---|---|
| `feat(schema)` | `Assessment`, `AssessmentCriterionResult`, `CriterionWaiver` — two enums, three models, one hand-written CHECK, the append-only database carve-out (`assessmentGrantStatements`, `infra/assessment-database-role.sql`) built from this phase's first commit rather than retrofitted; two new `ENCRYPTED_COLUMNS` entries; three new `DATA_CLASS_BY_MODEL` bindings; two new `ERASURE_REGISTRY` entries; two new `PERSON_REFERENCE_CLASSIFICATION` entries; the `assessment.*` permission group |
| `feat(assessment)` | the module: domain (`pass-rule.ts`, `assessment.ts`), application (`assessment-service.ts`, `input.ts`), infrastructure (`assessment-repository.ts`, `assessment-reach-filter.ts`), `index.ts`; three small published-fact additions to `groups` (`isActiveInstructorOfStudent`), `skills` (`criterionSetDetailForAssessment`, `gradeValuesByIds`, `activeCriterionSetOfAwardType`, `listGradeScales`); the session-screen aftest form and the person-screen read-only history; Dutch/English strings; the `02-security-privacy.md` §2.5 catalogue update the new permissions required |
| `test(assessment)` | fixtures, domain, service (incl. scope-escape and the four-eyes workflow), constraints, and the append-only database proof folded into `attendance-append-only.test.ts` |
| `docs(build)` | this report |

### 0.1 The schema, and what it deliberately does not have

- **`Assessment`** (`kind`, `criterionSetId`, `studentProfileId`,
  `assessorPersonId?`, `assessedAt`, `scheduledSessionId?`, `outcome`,
  `outcomeComputedAt`, `supersedesAssessmentId?`, `groupId`, `remark?`,
  `clientEventId`) — **append-only from the first migration**, unlike
  `SkillProgress` (retrofitted a phase later) and on par with
  `AttendanceEvent`: the runtime role holds `SELECT, INSERT` and nothing
  else; the retention role holds `UPDATE` (sever) and `DELETE` (a future
  prune neither retention class has an automated job for yet, v1 ships no
  policy engine, D-120). `AssessmentKind` has exactly one member,
  `PRE_EXAM` — see §1.2 for why `EXAM` and `examSessionId` are deferred
  rather than half-built. `clientEventId` makes the write idempotent (P-02):
  a ten-minute grading session is exactly the kind a flaky connection
  interrupts.
- **`AssessmentCriterionResult`** (`assessmentId`, `criterionId`,
  `gradeValueId`, `remark?`) — the formal graded observation, one row per
  criterion per sitting (`@@unique`). `gradeValueId` is what D-080 compares,
  via `GradeValue.rank`.
- **`CriterionWaiver`** (`assessmentId`, `criterionId`, `reason`,
  `grantedByPersonId?`) — "we let this one go" as a named row, one per
  criterion per sitting. The service refuses a criterion carrying both a
  result and a waiver in one submission (§1.6).
- **`AssessmentCriterionResult.remark` is the first real production entry in
  `ENCRYPTED_COLUMNS` beyond `person_relationships.authority_evidence`** —
  `assessment.criterion_result_remark`, under the `medical-v1` HKDF purpose
  D-112's own diagram already reserves for "special-category columns...
  assessment remarks." Audited on read (`assessment.remark_revealed`, once
  per call, before decryption — the `revealRelationshipEvidence` pattern),
  gated by `students.notes.read` / `students.notes.write` rather than
  `assessment.read`/`.record`. **This phase originally shipped
  `Assessment.remark` (the sitting-level field) under the identical
  protection, as `assessment.assessment_remark`; DECIDED 2026-09-10 (Jack,
  §1.5) that the sitting-level remark is ordinary, unprotected text instead —
  only `AssessmentCriterionResult.remark` carries this protection now.**
- **One hand-written constraint**, `Assessment_no_self_supersede_check`,
  proved in `tests/integration/assessment-constraints.test.ts` — the
  `AttendanceEvent_no_self_supersede_check` pattern.

### 0.2 What no service in this module will ever do

- Update or delete an `Assessment`, an `AssessmentCriterionResult` or a
  `CriterionWaiver` — and could not: the database refuses the statement
  whoever writes the code path, proved as the real runtime role.
- Compute an outcome over a criterion with neither a result nor a waiver
  (D-086). `recordAssessment` refuses the whole write (`INCOMPLETE`) first.
- Branch on `AwardType.kind` anywhere. D-080's function is one function over
  `CriterionSet`/`Criterion`/`GradeValue` rows.
- Let an `AssessmentCriterionResult.remark` (per-criterion) VALUE reach an
  audit event, an operational log, or a caller without
  `students.notes.read`/`.write`. `Assessment.remark` (sitting-level) is
  unprotected plain text since 2026-09-10 (§1.5) and carries no such
  restriction.
- Refuse `ExamCandidate → CONFIRMED`. That is `exams`' write, against a table
  this phase does not build — see §1.1.

---

## 1. Where this phase interpreted, stopped short, or declined — read before assuming a gap is an oversight

### 1.1 The four-eyes gate is built in two pieces, on two sides of a module boundary that is stated explicitly in the design set

This is the interpretive call the whole phase turns on, so it is stated
plainly rather than left to be inferred from the code.

**What D-085 formally requires**, `15-…` §3: `ExamCandidate → CONFIRMED`
needs a non-superseded `PRE_EXAM` `Assessment` where `outcome = PASS`,
`assessorPersonId` holds a valid `PersonQualification`, **and**
`assessorPersonId` is not an `InstructorAssignment` holder for the student's
group. Overridable, deliberately, with an audited reason.

**Two of those three clauses this phase cannot enforce as a refusal at all**,
because the tables they need do not exist yet: `ExamCandidate` and
`PersonQualification` are both named in the build brief, alongside `Award`
and `ExamResult`, as the *later* `exams` phase's own tables — and the design
set says so itself, not just the brief: `01-domain-model.md` line ~130,
almost verbatim, *"The gate that `exams` enforces before that (D-085)
likewise reads `assessment` through its published service, never its
tables."* Refusing the CONFIRMED transition is `exams`' write. Checking a
`PersonQualification` is impossible before that table exists.

**What this phase does enforce, and where it enforces it**: the one clause
that is checkable now — independence — refused at `recordAssessment`'s own
write time, not deferred to a later gate. An assessor who currently holds an
active `InstructorAssignment` for a group the student is currently a member
of is refused (`NOT_INDEPENDENT`) unless they hold the new
`assessment.independence.override` permission, in which case the write
succeeds and the audit event records `independentAssessor: false`. This is
**this phase's own reading**, not a quotation: D-085's formula describes a
condition evaluated at `ExamCandidate` confirmation time, over an
*already-recorded* assessment; nothing in the design states that the
independence clause must *also* gate the assessment's own recording. Three
reasons decided it anyway: the task brief names the four-eyes gate as "de
kern-mechaniek van deze fase"; building nothing that enforces it this phase
would ship the chapter's own thesis — *"the control the whole chapter exists
for"* — with zero real enforcement until `exams` exists; and it is safely
reversible, because D-085's own override machinery is exactly what an
enforcement-now decision needs to not become a nuisance.

**What is published for `exams` to read later**: `qualifyingAftestFacts(studentProfileId,
awardTypeId)`, a structured fact — not a boolean — returning which
assessment qualifies, who assessed it, whether independence held, and an
explicit `qualificationVerified: false` that can never be silently mistaken
for a real check. `exams`, when built, still needs to verify
`PersonQualification` itself and still owns the actual `CONFIRMED` refusal;
this function is the "published service, never its tables" half of the
promise the design already made.

**Flagged for Jack**: is write-time independence enforcement (with the
override) the right place for this, or should this phase have built *only*
the published fact and left all enforcement — independence included — to
`exams`? The case against what was built: it puts a piece of D-085's
authorization logic in a module the design's own dependency diagram places
*below* `exams`, which owns the decision. The case for what was built is
above. Either way, nothing here can be wrong in a way that later work cannot
adjust — `qualifyingAftestFacts` doesn't change shape either way.

### 1.2 `AssessmentKind` has one member; `EXAM` and `examSessionId` are not columns

`15-…` §2.1 gives `Assessment` both `scheduledSessionId?` and
`examSessionId?`, for `kind ∈ {PRE_EXAM, EXAM}`. `ExamSession` is an
`exams`-phase table (`01-domain-model.md` §3.5) that does not exist. A
nullable FK to a table that does not exist is the dangling stub CLAUDE.md §4
and D-163 both name as a defect, not a shortcut — so `examSessionId` is not a
column, and `AssessmentKind` carries only `PRE_EXAM`, on the exact
`CourseLevel.awardTypeId` precedent the skills report calls "real at last":
the column and the enum member arrive together, in the migration that adds
`ExamSession`. Not flagged as a question — this follows CLAUDE.md directly —
but named so the next implementer does not read the single-member enum as an
oversight.

### 1.3 The retention-granularity gap: one row, two data classes, one binding chosen

`01-domain-model.md` §5 gives "Assessment remarks" and "Assessment results
(formal)" **two different retention regimes** — 12 months/`DELETE` (D-087)
versus 7 years/`REVIEW` — and both `DataClass` enum members
(`ASSESSMENT_REMARKS`, `ASSESSMENT_RESULTS`) already existed in the schema,
pre-built by phase 0.4b. `DATA_CLASS_BY_MODEL` binds exactly one class per
*model*, not per column, and `Assessment`/`AssessmentCriterionResult` — on
the design's own one-table entity shape — carry both the remark and the
graded result in the same row.

**What this phase did**: bound both models to `ASSESSMENT_RESULTS`, the
longer and safer of the two — a formal result must never be under-retained,
and nothing in this codebase runs an automated retention job yet regardless
(v1 ships no policy engine, D-120; even `DELETE`-class tables like
`AttendanceEvent` only have the *capability* provisioned, not a schedule).
The retention role's grants on `Assessment`/`AssessmentCriterionResult`
include `UPDATE`, specifically so a future targeted redaction of `remark`
alone — nulling the column without touching the row — has a role to run as
when it is built.

**Flagged for Jack, genuinely open, and worth deciding before `exams` or a
retention engine is built on top of this**: two ways to close it. (a) Extend
the retention registry with a column-level override — a second, smaller
table keyed like `ENCRYPTED_COLUMNS`, naming a shorter retention for one
field of an otherwise longer-retained row — cheaper, stays inside the
design's one-table entity shape, but is a new registry mechanism nothing
else in this codebase has. (b) Split `remark` into its own 1:1 table per
model, so the existing one-class-per-model registry applies cleanly with no
new mechanism — costs a join, and a table the domain model does not
literally draw. Neither was chosen unilaterally; this is exactly the kind of
architecture decision that outlives one phase and should not be picked by
the phase that happens to hit it first. The same tension will recur for
`ExamResult.remarks` when `exams` is built.

### 1.4 The permission catalogue gap: `assessment.*` did not exist anywhere, and was added to both code and the design set

`02-security-privacy.md` §2.5 states its own rule: *"a permission referenced
anywhere in the design set and absent here is a defect, not a shorthand."*
D-085/D-086/D-087 all describe the aftest in detail and **never name a
permission for recording or reading one** — the reverse of F-109's gap (a
permission cited with no catalogue entry; here, an operation described with
no permission cited at all). `tests/unit/authorization-vocabulary-sync.test.ts`
enforces §2.5 and the code catalogue match exactly in both directions, so
this was not optional: `assessment.read`, `assessment.record` and
`assessment.independence.override` were added to
`src/lib/authorization/permissions.ts` **and** to `02-security-privacy.md`
§2.5's fenced block and its "additions" table, mirroring exactly how
`exams.candidacy.override` and `fees.*` were added by earlier phases when
they closed the same kind of gap.

**Flagged, mildly**: editing a design-set chapter is normally the design
process's business, not a build phase's. This phase did it because (a) the
sync test requires it, (b) there is a direct, repeated precedent for exactly
this kind of addition in the same chapter, and (c) the alternative — leaving
the test permanently red, or inventing a way to special-case `assessment.*`
out of the sync check — is worse. Worth a glance from Jack to confirm the
addition reads as intended, not because the mechanism is in question.

### 1.5 `Assessment.remark` is unprotected plain text; `AssessmentCriterionResult.remark` stays protected — DECIDED 2026-09-10 (Jack)

This was flagged as an open question at first sign-off: D-087's own words say
remarks attach "PRIMARILY" at the criterion result — *"the remark is about
the scissor kick, not about the sitting."* — while the entity list in `15-…`
§2.1 still gives `Assessment` its own `remark?` field, and the phase shipped
protecting both identically (same D-096 envelope class under `medical-v1`,
same `students.notes.*` permission gate, same audit-on-read) rather than only
the primary one.

**Decided 2026-09-10, by Jack, on review of the finished module:**
`Assessment.remark` (the SITTING-level note) reverts to an ordinary,
unprotected string column — no encryption, no `students.notes.read` gate, no
audit-on-read. `AssessmentCriterionResult.remark` (the PER-CRITERION note,
where D-087 says the remark "actually" gets written) is UNCHANGED and keeps
the full protected-free-text treatment. The reading that "primarily" was
describing where the protected class genuinely lives — not merely where an
assessor usually happens to type — is the one adopted.

What changed in code, in one commit:

- `prisma/schema.prisma` — the `/// @encrypted assessment.assessment_remark`
  marker is removed from `Assessment.remark`; the field stays `String?`
  (no column-type change, so no migration SQL was needed — confirmed with
  `prisma migrate diff` against the applied schema, which produced an empty
  script). `AssessmentCriterionResult.remark` keeps its
  `/// @encrypted assessment.criterion_result_remark` marker untouched.
- `src/lib/crypto/encrypted-columns.ts` — the
  `"assessment.assessment_remark"` registry entry is removed;
  `"assessment.criterion_result_remark"` is untouched. The bidirectional
  `tests/unit/encrypted-column-registry.test.ts` check (D-167) enforces that
  the schema and the registry agree.
- `src/modules/assessment/application/assessment-service.ts` — `recordAssessment`
  writes `Assessment.remark` directly (no `seal()`), and no longer requires
  `students.notes.write` to set a non-empty sitting-level remark (only a
  non-empty criterion-result remark still requires it). `revealRemarks`
  no longer touches the sitting-level `remark` at all: it is exposed exactly
  as stored, for every caller who can already reach `assessment.read`, with
  no `students.notes.read` check and no `assessment.remark_revealed` audit
  event for it. `AssessmentCriterionResult.remark` keeps `seal()`/`open()`,
  the `students.notes.*` gate and the audited reveal, unchanged.
- `src/modules/assessment/infrastructure/assessment-repository.ts` —
  `AssessmentView.remarkSealed` becomes `AssessmentView.remark: string | null`
  (plain, read straight off the row); `AssessmentCriterionResultView.remarkSealed`
  is unchanged.
- UI (`src/app/people/[personId]/page.tsx`) — the sitting-level remark column
  now always shows the stored text (never redacted to `—` for lack of
  `students.notes.read`); the per-criterion remark is not rendered on this
  screen at all, unchanged from before this decision. The aftest-recording
  form (`src/app/groups/[groupId]/sessions/[sessionId]/page.tsx`) already
  showed the sitting-level remark as a plain, ungated textarea with no
  criterion-level remark input at all — that was true before this decision
  and needed no code change.
- Tests (`tests/integration/assessment-services.test.ts`) — the shared
  "remarks" suite is split into an unprotected-sitting-remark suite (writable
  without `students.notes.write`, readable without `students.notes.read`,
  never sealed) and an unchanged protected-criterion-remark suite (requires
  `students.notes.write` to set, `students.notes.read` to see, sealed at
  rest, audited on reveal).

**Honesty note on the UI step:** the design brief for this decision assumed
the sitting-level remark sat behind the same disclosure/reveal-button flow as
the criterion-level one. In the code as shipped, neither remark has a
distinct reveal-button UI component — both were rendered directly from
server-computed values (redacted to `null`/`—` server-side for a reader
without `students.notes.read`, on the read screen; shown as a plain textarea
with no gate at all, on the write screen), and the per-criterion remark has
no UI at all yet, on either screen. So "moving the sitting-level field out
from behind the reveal flow" reduced, in practice, to removing the
server-side redaction for it — there was no reveal button to remove client-side.

### 1.6 A criterion may not carry both a result and a waiver in one submission — not stated, decided for legibility

D-080's formula (`∃ r ... ∨ ∃ w`) is satisfied identically whether a
criterion has a result, a waiver, or — this phase's own addition — is
refused for having both. Nothing in the design states this either way; it
was decided here because a criterion graded *and* waived in the same sitting
is data nobody meant to produce, and refusing it costs nothing the formula
needs. `DOUBLY_DISPOSED_CRITERION` is the refusal; pinned in
`assessment-domain.test.ts`.

### 1.7 `recordAssessment` has no separate "amend" verb — one action for the original sitting and every correction

Attendance splits `attendance.record`/`attendance.amend`, and skills splits
`skills.assess`/`skills.revoke`, because a fresh registration and a
single-field correction are different shapes of action there. A correction
to an aftest is not a single-field edit — it is a full re-sitting, every
criterion re-graded, the same shape as an original one — so
`recordAssessment` handles both, distinguished only by
`supersedesAssessmentId`. One permission (`assessment.record`) covers both.
Flagged as a considered simplification, not an oversight of the
attendance/skills precedent.

### 1.8 Ids are pre-generated before insert — a pattern this codebase has not needed until now

D-096's AAD binds `(columnId, primary key, keyId)` — the row's own id must be
known *before* the encrypted value is sealed. Every other encrypted column
(`PersonRelationship.evidence`) belongs to an ordinarily-mutable table and
resolves this with create-then-update. `Assessment` is append-only from this
phase's first commit, so that escape does not exist: `recordAssessment`
generates `assessmentId`/each result's own id via `randomUUID()` and passes
them explicitly to `create()`, rather than trusting `@default(cuid(2))`.
Not a question — CLAUDE.md's five rules leave no other option here — but
named because it is a genuinely new pattern (append-only **and** encrypted,
together, for the first time) that whoever builds `exams`' `ExamResult`
(also append-only, also carrying a `remarks?` field per `01-domain-model.md`
§3.5) will need again.

### 1.9 The UI ships one screen, one sitting, one student at a time — not the multi-candidate matrix `04-ux.md` §4.7 sketches

§4.7's sketch shows a sitting as *"per candidate: every criterion..."* —
implying one screen grades several candidates against one criterion set in
sequence. `01-domain-model.md` §4's own aggregate table gives `Assessment`
exactly this phase built: one `Assessment` and everything it owns
(`AssessmentCriterionResult`, `CriterionWaiver`, the computed outcome) is
**one** transaction — the aggregate is one student's sitting, not a
multi-student batch, so §4.7's "matrix" is screen-level batching (loop the
same call once per candidate), not a wider transaction boundary. This phase
built the per-student form the aggregate actually is; a screen that loops it
across a whole sitting's candidates is real, useful, follow-up UI work, not
required by the aggregate boundary and not built here.

**Also not built, and allowed rather than required by D-086**: the
"set-whole-column-with-confirmation" convenience (grade one criterion across
every candidate at once). Building it needs client-side interactivity this
codebase's UI has not needed anywhere yet (every existing screen is a plain
server-rendered form). D-086 states this is *allowed*, not mandatory — what
is mandatory, and what this phase built, is that every criterion **starts**
unset and an outcome is never computed over one left that way. Flagged as a
deferred convenience, not a compliance gap.

### 1.10 Live browser verification was not performed — a pre-existing worktree limitation, not a new one

`npm run typecheck`, `npm run lint`, `npm run format:check` and the full
`vitest` suite all pass. `npm run build` (Turbopack) fails in this worktree
specifically — `node_modules` here is a symlink into the main checkout
(`/root/projects/SplashTrack/node_modules`, present before this phase
started), and Turbopack refuses to follow a symlink it reads as pointing
outside the project root. This is an environment property of the worktree,
reproducible on a clean checkout of this branch with no changes at all, and
it blocks both `next build` and (by the same mechanism) `next dev` here. The
session screen and person screen were reviewed by reading, matched against
the existing attendance/skills sections' exact structure, and typecheck
covers every prop and translation key — but nobody clicked through the form
in a browser. Said plainly rather than claimed: **UI correctness beyond
static analysis is unverified.**

---

## 2. The dependency direction, against the design set's own DAG

`01-domain-model.md` §1.2's diagram places `assessment` directly below
`exams` and depending only on `skills`. The module as built depends on four:
`skills` (the pinned catalogue), `sessions` (`findSessionRegisterFacts`, the
`{ session }` guard's own roster/status), `groups`
(`isActiveInstructorOfStudent`, `courseLevelOfGroup`), and `courses`
(`awardTypeOfCourseLevel`) — the last two because resolving "which criterion
set does this session's group assess against" needs the exact
`group -> course -> skills` chain `skills`' own `listCriteriaForGroup`
already walks, reused here as a second caller of the same published facts
rather than re-derived against different rules. This is the same shape the
skills report recorded for its own build: the stated DAG under-states a
module's real dependency footprint by one hop, and the actual footprint is
narrower than the DAG *permits* even though it is wider than the diagram
*draws* — no file under `src/modules/assessment/` imports `@/modules/exams`
(which does not exist), and none of `skills`/`sessions`/`groups`/`courses`
imports `assessment`.

---

## 3. Definition of Done (`06-delivery.md` §4.4)

| Requirement | Status |
|---|---|
| Data model | `Assessment`, `AssessmentCriterionResult`, `CriterionWaiver` — schema + migration `20260909100000_assessment_module`, one hand-written CHECK, the append-only carve-out from the first commit |
| Service | `assessment-service.ts`: `recordAssessment`, `getAssessmentsForStudent`, `getEffectiveAssessmentsForStudent`, `qualifyingAftestFacts`, `criteriaForSessionAftest` — all behind `requirePermission` on the new `assessment.*` keys (added to both the catalogue and `02-security-privacy.md` §2.5, §1.4) |
| UI | The aftest form on the lesson screen (`/groups/[groupId]/sessions/[sessionId]`) — one student, every criterion, default unset, no client-side "mark all" shortcut (§1.9); the read-only aftest history on the person screen (`/people/[personId]`). Dutch and English strings both present, both valid JSON, parity-tested by `message-catalog.test.ts` |
| Scope-escape tests | `tests/integration/assessment-scope-escape.test.ts` — a `SESSION`-scoped assessor confined to their one lesson; a `GROUP`-scoped instructor's write on their OWN pupil passing the guard but refused `NOT_INDEPENDENT` by the layered domain check, with the override proven separately; the no-grant caller denied outright; `getAssessmentsForStudent`'s `GROUP` narrowing (one row to each group's own reader, both to the organization) |
| Domain/service tests | `tests/unit/assessment-domain.test.ts`, `tests/integration/assessment-services.test.ts` (21 cases: D-080's pass rule, D-086 completeness, the four-eyes independence check and its override, remark encryption/permission-gating/audit-on-read, P-02 replay, supersession, `qualifyingAftestFacts`), `tests/integration/assessment-constraints.test.ts` |
| `Person`-reference registry | `Assessment.assessorPersonId` and `CriterionWaiver.grantedByPersonId` — `SEVER_AND_RETAIN`, on the `AttendanceEvent.recordedByPersonId`/`SkillProgress.assessedByPersonId` pattern. `AssessmentCriterionResult` references no `Person` directly and correctly takes no entry (it cascades from `Assessment`) |
| Erasure registry | `Assessment: { kind: "erase" }`, `CriterionWaiver: { kind: "erase" }` |
| Retention (`DATA_CLASS_BY_MODEL`) | All three models bound to `ASSESSMENT_RESULTS` — the longer, safer of the two regimes the design gives this domain; the shorter `ASSESSMENT_REMARKS` policy is not mechanically enforced by this binding, flagged and left open in §1.3 |
| Encrypted columns | `assessment.criterion_result_remark` only — registered, audited on read, gated by `students.notes.*`. `assessment.assessment_remark` was removed 2026-09-10 (Jack, §1.5): `Assessment.remark` is now unprotected plain text |
| CI | `npx vitest run`: 78 files / 916 tests passed, zero regressions in the pre-existing 868. `npm run typecheck`: clean. `npm run lint`: clean (the one pre-existing, unrelated warning phases 2.0-2.2 also noted, in `database-role-model.test.ts`). `npm run format:check`: clean on every file this phase touched. `npm run build`: blocked by a pre-existing worktree limitation, §1.10 |
| Jack's approval | Not yet requested — this report is the handoff |

**Open items for review, not silently resolved:**

1. §1.1 — **the central interpretive call of this phase.** The four-eyes
   gate is built in two pieces: independence is refused at write time here
   (with an override), qualification and the `CONFIRMED` refusal itself are
   left to `exams`, which does not exist yet. Is enforcing independence at
   `recordAssessment` the right layer, or should this phase have shipped
   only the published fact and left all enforcement to `exams`?
2. §1.3 — the retention-granularity gap between `ASSESSMENT_REMARKS` (12mo,
   DELETE) and `ASSESSMENT_RESULTS` (7yr, REVIEW) over one row. Bound to the
   longer regime; the shorter one is unenforced. Two ways to close it are
   named; neither picked.
3. §1.4 — `assessment.*` added to `02-security-privacy.md` §2.5 as well as
   to code, on precedent. Worth a glance, not a real question.
4. §1.5 — **CLOSED 2026-09-10 (Jack).** `Assessment.remark` is now
   unprotected plain text; `AssessmentCriterionResult.remark` stays protected
   under D-087/D-148, unchanged. See §1.5 for what changed in code.
5. §1.9 — the UI is one-student-per-sitting, matching the D-061-style
   aggregate boundary; the multi-candidate batch screen `04-ux.md` §4.7
   sketches is real follow-up work, not built here.
6. §1.10 — **no live browser verification.** `npm run build` fails in this
   worktree on a pre-existing symlink/Turbopack issue unrelated to this
   phase's code; typecheck/lint/tests are the verification that exists.
7. A domain question the independence check makes concrete for the first
   time: `isActiveInstructorOfStudent` checks whether the assessor instructs
   **any** group the student is currently active in, not only the group the
   session being assessed belongs to. D-085 says "that student's group,"
   singular, which is ambiguous the moment a pupil belongs to more than one
   group at once (D-060 permits this). The wider reading was chosen as the
   safer one for a four-eyes control — flagged in case the narrower reading
   was intended.
