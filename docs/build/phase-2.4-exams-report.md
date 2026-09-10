# Phase 2.4 — the `exams` module

**Branch** `build/exams-module` · **From** `0d1c7fb` (996 tests including this
phase's own — the pre-existing suite was 918 before this branch) · **Not
pushed, not merged, not deployed.**

`PersonQualification`, `ExamCandidate`, `ExamResult`, `Award` —
`01-domain-model.md` §3.1/§3.5, `15-assessment-and-fees.md` §3. This phase
finishes the four-eyes gate the assessment phase deliberately left in two
pieces: D-085's `ExamCandidate → CONFIRMED` refusal, checked against a live
`PersonQualification` and a live re-verification of independence, never a
cache of assessment's own write-time decision. It also builds the diploma
record itself — an append-only `ExamResult` (D-062) and the `Award` it is
issued against — and D-052's examiner-without-membership reach, reusing
`SESSION` scope rather than inventing anything new.

Decisions implemented: **D-085** (the four-eyes gate, now checkable in full:
qualifying assessment, independence re-verified live, and a valid
`PersonQualification`, with an audited override), **D-052** (an examiner
needs no membership; a `SESSION`-scoped, time-bounded grant is enough — proved
directly, no new account-provisioning UI built), **D-062** (`ExamResult`
0..N per candidate, append-only, `supersedesResultId` for corrections),
**D-082/D-089** (`Award`, issued against a specific PASS result, revoked
rather than edited), **D-057/CLAUDE.md §4** (this module owns none of
`assessment`'s/`groups`'/`sessions`' tables; it calls their published
services).

---

## 0. What landed

| Commit | |
|---|---|
| `feat(schema)` | `PersonQualification`, `ExamCandidate`, `ExamResult`, `Award` — four enums/models, five hand-written CHECKs, the `examsGrantStatements` append-only carve-out (with a column-restricted `UPDATE` on `Award`, new in this codebase); one new `DataClass` enum member (`PERSON_QUALIFICATIONS`); `DATA_CLASS_BY_MODEL`/`RETENTION_CATALOGUE`/`ERASURE_REGISTRY`/`PERSON_REFERENCE_CLASSIFICATION` entries |
| `feat(exams)` | the module: domain (`exam-candidate.ts`, `exam-result.ts`), application (`exam-candidate-service.ts`, `exam-result-service.ts`, `person-qualification-service.ts`), infrastructure (three repositories, one reach filter), `index.ts`; the confirm/register/withdraw/record-result/issue-award/revoke-award UI on the person screen; Dutch/English strings |
| `test(exams)` | fixtures, domain, service (the full D-085 matrix, the override flow), scope-escape, constraints, append-only database proof |
| `docs(build)` | this report |

### 0.1 The schema, and the one departure from pure append-only

- **`PersonQualification`** (`personId`, `type`, `validFrom`, `validTo?`,
  `grantedByPersonId?`) — *"een leraar die bevoegd is binnen de vereniging"*.
  **Not append-only**: an ordinary mutable table, the `MembershipPeriod`
  shape — ending a qualification early is a `validTo` mutation, never a new
  row. `type` is a free string, not an enum — see §1.3.
- **`ExamCandidate`** (`studentProfileId`, `awardTypeId`, `groupId`, `status`,
  `confirmedAt?`, `confirmedByPersonId?`, `qualifyingAssessmentId?`,
  `overrideUsed`, `overrideReason?`, `withdrawnAt?`, `withdrawnReason?`) —
  also **not** append-only: a mutable state machine, `PENDING → CONFIRMED` or
  `PENDING → WITHDRAWN`, the `WaitlistEntry` shape. Three hand-written
  CHECKs: `overrideUsed`/`overrideReason` set together;
  `status = CONFIRMED` implies `confirmedAt` is set (deliberately NOT
  `confirmedByPersonId` — see §1.1's real bug); `status = WITHDRAWN` implies
  both `withdrawnAt` and `withdrawnReason`.
- **`ExamResult`** (`candidateId`, `outcome`, `recordedByPersonId?`,
  `recordedAt`, `supersedesResultId?`, `reason?`, `remarks?`, `assessmentId?`,
  `scheduledSessionId?`, `clientEventId`) — **append-only**, the
  `Assessment`/`AttendanceEvent` shape exactly: the runtime role holds
  `SELECT, INSERT` and nothing else. `remarks` is plain, unprotected text, the
  `Assessment.remark` precedent (phase 2.3's 2026-09-10 decision) — see §1.4.
- **`Award`** (`resultId`, `awardTypeId`, `number`, `issuedAt`, `revokedAt?`,
  `revokeReason?`) — **a deliberate, named departure from pure append-only**,
  see §1.2. The runtime role holds `SELECT, INSERT`, plus a Postgres
  **column-restricted** `UPDATE` on exactly `revokedAt, revokeReason` — a
  pattern new to this codebase.
- **`ExamSession`/`ExamAssessor`** and `Assessment.examSessionId`/
  `AssessmentKind.EXAM` are **deliberately not built** — see §1.5.

### 0.2 What no service in this module will ever do

- Update or delete an `ExamResult` — the database refuses the statement,
  proved as the real runtime role (`exams-append-only.test.ts`).
- Edit `Award.resultId`/`awardTypeId`/`number`/`issuedAt` — the runtime
  role's grant does not permit it at the column level, whoever writes the
  code path.
- Confirm a candidacy without checking `PersonQualification` — the table
  this phase exists to add, closing the gap assessment's own report named.
- Trust assessment's write-time independence decision. `confirmExamCandidate`
  re-derives it live, every time — see §1.1.

---

## 1. Where this phase interpreted, stopped short, or found a real bug — read before assuming a gap is an oversight

### 1.1 The D-085 formula, checked in full, and a real erasure bug the browser check caught

`15-…` §3: `CONFIRMED` requires a non-superseded `PRE_EXAM` `Assessment` with
`outcome = PASS`, an assessor holding a valid `PersonQualification`, and that
assessor NOT being an `InstructorAssignment` holder for the student's group.
`confirmExamCandidate` checks all three, in that order, via
`domain/exam-candidate.ts`'s `firstUnmetClause` — the first unmet clause is
the refusal reported, so an exams manager always knows exactly which of
D-085's three conditions to fix.

**Independence is re-verified LIVE, not trusted from assessment's write.**
`qualifyingAftestFacts.independentOfStudentGroup` is computed fresh on every
call (assessment's own repository queries `InstructorAssignment` at read
time, never caches a write-time answer) — so calling it again here, at
confirmation, is a genuine second check against the CURRENT group-assignment
state, catching the case where a pupil moves groups, or an instructor
assignment starts, between the aftest and the confirmation attempt. Pinned in
`exams-services.test.ts`'s `"refuses NOT_INDEPENDENT — re-verified LIVE"`
case: an aftest recorded by a genuinely independent assessor, who is THEN
assigned as the pupil's own instructor before confirmation is attempted —
refused, exactly as a write-time-only check would have missed.

**A real bug, found only by the mandatory browser verification, not by any
of the 900+ database tests**: the first version of
`ExamCandidate_confirmed_fields_check` required BOTH `confirmedAt` AND
`confirmedByPersonId` non-null whenever `status = CONFIRMED`. That is wrong —
`confirmedByPersonId` is classified `SEVER_AND_RETAIN` (`onDelete: SetNull`,
the `Assessment.assessorPersonId` pattern), because erasing the confirming
PERSON must not erase the CANDIDACY. The browser check's own cleanup step —
erasing the temporary administrator account after it had confirmed a real
candidacy — hit exactly this: the `SetNull` referential action tried to null
`confirmedByPersonId` on a `CONFIRMED` row and the CHECK refused the UPDATE,
which is not a refusal `Person.delete()` can recover from. Fixed by dropping
`confirmedByPersonId` from the CHECK (only `confirmedAt` is required) — the
migration, the schema comment, and `exams-constraints.test.ts` all carry the
fix and a regression test for the erasure path specifically. **This is
exactly the kind of defect the browser-verification requirement exists to
catch**, and no unit or integration test in this phase's own suite would
ever have found it, because none of them erased the confirming person after
confirming a candidacy.

### 1.2 `Award`'s column-restricted grant — a considered, named departure from D-061/D-062's shape

The build brief asks for `Award`/`ExamResult` "append-only (D-005/D-061/
D-062-patroon)". `ExamResult` is exactly that. `Award` cannot be, literally:
`01-domain-model.md` §3.5 gives it `revokedAt?`/`revokeReason?` on the SAME
row — the `ScheduledSession.cancelledAt`/`cancellationReason` pattern, not
the `supersedesXId` one. A pure "no UPDATE ever" grant would make the
domain model's own revocation mechanism impossible to implement; a plain
mutable table would make `number`/`issuedAt`/`resultId`/`awardTypeId`
editable, which nothing in the design permits and which the append-only
precedent this module otherwise follows would flag as a regression.

**Resolution**: Postgres COLUMN-LEVEL `GRANT`. The runtime role gets
`SELECT, INSERT` plus `UPDATE (revokedAt, revokeReason)` — nothing else.
Proved directly in `exams-append-only.test.ts`: an `UPDATE` touching
`number` or `issuedAt` (even alongside an allowed column in the same
statement) is refused by the database; an `UPDATE` touching only
`revokedAt`/`revokeReason` succeeds. This is a genuinely new pattern in this
codebase — flagged for Jack in case a different resolution (e.g. `Award` as
a second table split into an immutable issuance row plus a mutable
revocation row) is preferred; the column-grant approach was chosen because
it needs no schema change beyond what the domain model already states and
keeps `Award` one row per diploma, matching how an administrator actually
thinks about it.

### 1.3 `PersonQualification.type` is a free string, not an enum

Neither `01-domain-model.md` nor `15-…` names a closed vocabulary of
qualification types, and D-085's own formula asks only "does ANY valid
`PersonQualification` exist at `assessedAt`", never "of which type" — the
confirmation check does not filter by `type` at all. Inventing an enum here
would assert a taxonomy the design never stated. Flagged as a genuinely open
question: if the organisation later wants different qualification TYPES to
gate different things (an aftest assessor vs. an exam-day examiner, say),
`type` staying a free string means that distinction is not yet enforceable
anywhere — it is recorded, not read.

### 1.4 `ExamResult.remarks` and `Award.revokeReason` are unprotected plain text — an extension of phase 2.3's decision, not a fresh one

Phase 2.3's report (§1.5) records Jack's 2026-09-10 decision that
`Assessment.remark` (a sitting-LEVEL note, not the per-criterion one) is
ordinary text because it is a decision-level annotation, not a developmental
observation about a child's body. `ExamResult.remarks` is the same shape of
field, one level up the same hierarchy — a note about an exam-day outcome,
not about the child — so this phase applies the same reasoning without
asking again. **Flagged for confirmation anyway**, because it was this
phase's own reading rather than a restatement of an already-decided case:
if Jack's actual intent in 2026-09-10's decision was narrower (specific to
`Assessment.remark`'s literal column), `ExamResult.remarks` should instead
get the `AssessmentCriterionResult.remark` protected-free-text treatment
(D-096/D-148), and that is a schema change (new `ENCRYPTED_COLUMNS` entry, a
column-level protection this table does not currently have).

### 1.5 `ExamSession`/`ExamAssessor` are not built — the assessment phase's own precedent, applied here

`01-domain-model.md` §3.5 gives `ExamSession` a `locationId`, `ExamCandidate`
an `examSessionId`, and `ExamAssessor` a row of its own. None of the three
exists in this phase's schema. Three reasons, stacked:

1. **Precedent.** The assessment phase's own report (§1.2) already deferred
   `Assessment.examSessionId`/`AssessmentKind.EXAM` for exactly this reason —
   a nullable FK to a table that does not exist is the dangling stub
   CLAUDE.md §4/D-163 forbids.
2. **`ExamSession.locationId` is stale against a later decision.**
   `01-domain-model.md` §3.5 was written before D-175 replaced the `Location`
   concept with `Pool`/`Lane` (`ScheduledSession`'s own model comment states
   this explicitly). Building `ExamSession` today would mean choosing
   between the domain model's literal, superseded field and the actual
   schema's `Pool`/`Lane` shape — a decision this phase should not make
   unilaterally either.
3. **The build brief itself does not ask for it.** It names
   `PersonQualification`, `ExamCandidate`, `Award`/`ExamResult` — not
   `ExamSession`/`ExamAssessor`.

**What this means for D-052/D-068 in practice**: without `ExamSession`, an
external examiner's `SESSION`-scoped grant has nothing exam-specific to
point at. `ExamResult.scheduledSessionId` (optional) reuses `sessions`'
existing `ScheduledSession` table instead — the exact
`Assessment.scheduledSessionId` precedent — so the SAME `SESSION` scope
mechanism the assessment phase built for the independent aftest assessor
covers the external examiner too, with no second scheduling primitive.
Proved directly in `exams-scope-escape.test.ts`: a `SESSION`-scoped examiner
with no membership records a result on exactly the lesson slot their grant
names, and is denied on another.

**Flagged for Jack**: `ExamCandidate` therefore has no `examSessionId` at
all — a genuine gap against the literal domain model, not merely a deferred
column. Whether an actual `ExamSession` table (redesigned against
`Pool`/`Lane` rather than the stale `Location` field) is real follow-up work
for this module, or belongs to `planning` (which owns scheduling primitives
generally), was not decided here.

### 1.6 `groupId` is a caller-supplied snapshot, not a resolved "current group" — the same ambiguity assessment flagged

A pupil may belong to more than one group at once (D-060). Rather than
inventing a "the" current-group resolver, `registerExamCandidate` takes
`groupId` as an explicit input, validated against `groups`' own
`activeGroupMemberIds` (the student must actually be an active member).
This is the SAME open reading the assessment phase's report named for
`isActiveInstructorOfStudent` (§1's item 7): D-085 says "that student's
group", singular, and it is ambiguous the moment a pupil is in several.
Flagged again here rather than resolved differently, since the two modules
should probably agree on an eventual answer.

### 1.7 `exams.manage` covers `PersonQualification` administration — no new permission added

Granting/ending a qualification is guarded by the already-registered
`exams.manage`, not a new key. No chapter in the design set names a separate
permission for it, and `exams.manage`'s catalogue entry is broad enough
(D-085/D-052/D-062/D-089 all fall under the general `exams.*` group already
in `02-security-privacy.md` §2.5, pre-provisioned before this phase started).
Unlike the assessment phase (which found and closed a real permission-catalogue
gap), this phase found no gap: `exams.read`, `.manage`, `.assess`,
`.results.record`, `.candidacy.override`, and `certificates.issue`/`.revoke`
were all already present in both the code catalogue and the design chapter,
seeded by an earlier phase.

### 1.8 Live browser verification — performed twice, the second time after fixing a real bug

The worktree-local `node_modules` symlink was removed and a full `npm install`
run in this worktree before any test ran; `npm run dev`, `npm run build` and
a real Chromium session against the dev server all succeeded.

A temporary administrator account was created for real — `signUpEmail`
(server-side, `accountProvisioningMarker`-wrapped, the same mechanism
`admin:create` uses), MFA-enrolled with a real TOTP secret
(`@better-auth/utils/otp`), the session cookie from the POST-verification
session (Better Auth mints a NEW session on `verifyTOTP` — the pre-2FA
sign-in cookie does not carry `mfaEvidence: TOTP_PROVEN` and is rejected by
`requireEnrolledSession`; this took two attempts to get right) handed
directly to a headless Chromium context via Playwright (`chromium.launch`),
with an `ORGANIZATION`-scoped role holding `exams.*`/`certificates.*`/
`skills.read`/`groups.read`.

**The successful scenario**, driven entirely through real form submissions
on `/people/[personId]`: register a candidacy for a pupil with a genuinely
qualifying aftest (an independent, `PersonQualification`-holding assessor's
recorded PASS) → confirm (D-085's full formula passes, no override needed,
status becomes `Bevestigd`) → record a PASS exam result → issue an award,
number `A-BROWSER-0001`, rendered on the screen next to the result. The
revoke form appeared for the newly issued, unrevoked award.

**The denial scenario**, same screen, same session: register a SECOND
candidacy for a DIFFERENT award type with no recorded aftest at all →
confirm → refused. The rendered page showed a red `alert-danger` banner with
the exact Dutch sentence *"Er is geen geldige, geslaagde aftest voor deze
leerling en dit diploma/certificaat. Een kandidaat kan alleen worden
bevestigd na een geslaagde aftest (het vier-ogen-principe, D-085)."* — not
a 500, not a silent no-op — and the candidacy's status remained `In
afwachting` (PENDING), visibly not confirmed. The URL carried
`?error=NO_QUALIFYING_ASSESSMENT`, confirming the refusal reached the UI
through the same `people.errors.<reason>` mechanism every other module on
this screen already uses.

All temporary domain rows, the temporary role, and the temporary
administrator account (including its session and TOTP factor) were removed
after the check; a direct count query confirmed zero `examsfx_`-prefixed
rows and zero leftover accounts afterward.

---

## 2. The dependency direction

`exams` depends on `assessment` (`qualifyingAftestFacts` — the published,
structured fact, never assessment's tables), `groups`
(`activeGroupMemberIds`, to validate a candidacy's `groupId` snapshot), and
`sessions` (`findSessionRegisterFacts`, the `{ session }` guard's own
roster — the D-052/D-068 path). No file under `src/modules/exams/` imports
any of `assessment`/`groups`/`sessions`/`skills`/`courses`/`people`
backwards, and none of those modules imports `exams`. `fees` (not yet
built) is documented to depend on neither `exams` nor be depended on by it —
the exam-fee charge (D-089) is a domain event when `fees` exists, not a
call — so this phase adds no forward reference to a module that does not
exist yet.

---

## 3. Definition of Done (`06-delivery.md` §4.4)

| Requirement | Status |
|---|---|
| Data model | `PersonQualification`, `ExamCandidate`, `ExamResult`, `Award` — schema + migration `20260910090000_exams_module`, five hand-written CHECKs, the append-only/column-restricted carve-out (`examsGrantStatements`, `infra/exams-database-role.sql`) |
| Service | `exam-candidate-service.ts` (`registerExamCandidate`, `confirmExamCandidate`, `withdrawExamCandidate`, `getExamCandidatesForStudent`), `exam-result-service.ts` (`recordExamResult`, `getExamResultsForCandidate`, `issueAward`, `revokeAward`), `person-qualification-service.ts` (`grantQualification`, `endQualification`) — all behind `requirePermission` on the already-registered `exams.*`/`certificates.*` keys |
| UI | The candidacy/result screen on `/people/[personId]` — registration, confirmation (with an override-reason field), withdrawal, result recording, award issue/revoke, all as real forms against real Server Actions. Dutch and English strings both present, both valid JSON, parity-tested by `message-catalog.test.ts` |
| Scope-escape tests | `tests/integration/exams-scope-escape.test.ts` — a `SESSION`-scoped external examiner confined to their one lesson slot; a `GROUP`-scoped exams manager denied for a candidacy under a group they do not manage and permitted for their own; `getExamCandidatesForStudent`'s `GROUP` narrowing; the no-grant caller denied outright |
| Domain/service tests | `tests/unit/exams-domain.test.ts` (the full D-085 clause matrix, qualification-window edge cases, D-062 effective-result derivation), `tests/integration/exams-services.test.ts` (27 cases: every D-085 clause individually, the override, ALREADY_CONFIRMED/ALREADY_WITHDRAWN races, P-02 replay, supersession, award issue/revoke, PersonQualification grant/end), `tests/integration/exams-constraints.test.ts` |
| `Person`-reference registry | `PersonQualification.personId` (HARD_DELETE), `.grantedByPersonId` (SEVER_AND_RETAIN), `ExamCandidate.confirmedByPersonId` (SEVER_AND_RETAIN), `ExamResult.recordedByPersonId` (SEVER_AND_RETAIN) — `Award` references no `Person` directly and correctly takes no entry |
| Erasure registry | `PersonQualification`, `ExamCandidate`, `ExamResult`: `{ kind: "erase" }`. Not `exempt` — `15-…` §5.2 is explicit that an erasure request does not automatically lose to a diploma register; the retention ground (if any) lives in the catalogue's `proposedLawfulBasis: UNRESOLVED`, not as a registry-level exemption invented here |
| Retention (`DATA_CLASS_BY_MODEL`) | `ExamCandidate`/`ExamResult`/`Award` bound to `EXAM_RESULTS_AND_AWARDS` (pre-provisioned by phase 0.4b — 10 years, `REVIEW`, lawful basis unresolved per organisation, §5.2). `PersonQualification` bound to a new class, `PERSON_QUALIFICATIONS`, the `INSTRUCTOR_ASSIGNMENTS` precedent |
| Encrypted columns | None. `ExamResult.remarks` and `Award.revokeReason` are unprotected plain text — flagged in §1.4 as this phase's own extension of phase 2.3's decision, worth Jack's explicit confirmation |
| CI | `npx vitest run`: 84 files / 996 tests passed — the 918-test pre-phase baseline plus this phase's own 78, zero regressions. `npm run typecheck`: clean. `npm run lint`: clean. `npm run format:check`: clean. `npm run build`: successful; the same pre-existing, non-failing `app-version.ts` tracing warning phase 2.3 already recorded |
| Jack's approval | Not yet requested — this report is the handoff |

**Open items for review, not silently resolved:**

1. §1.2 — `Award`'s column-restricted `UPDATE` grant is a new pattern in
   this codebase, chosen over splitting `Award` into an immutable issuance
   row plus a mutable revocation row. Worth a glance to confirm the
   resolution is the right one.
2. §1.3 — `PersonQualification.type` is a free string; D-085's check does
   not filter by type. If different qualification types should gate
   different exam-related powers later, this needs a real vocabulary and a
   filtered check, not just a label.
3. §1.4 — `ExamResult.remarks`/`Award.revokeReason` follow phase 2.3's
   "sitting-level remark is unprotected" decision by extension, not by a
   fresh ruling from Jack. Worth an explicit confirmation, since the
   alternative (protected free text, D-096/D-148) is a real schema change if
   the extension was not intended this broadly.
4. §1.5 — **the largest open item.** `ExamSession`/`ExamAssessor` and
   `ExamCandidate.examSessionId` are not built, on the assessment phase's
   own dangling-stub precedent plus a genuine staleness in the domain
   model's `locationId` field (superseded by D-175's `Pool`/`Lane`). Whether
   a redesigned `ExamSession` is this module's own follow-up work or
   belongs with `planning` was not decided here.
5. §1.6 — `groupId` is caller-supplied, not resolved — the same D-085
   "which group" ambiguity the assessment phase already flagged for
   `isActiveInstructorOfStudent`. The two modules should probably agree on
   one eventual answer.
6. §1.1 — **CLOSED during this build, not left open**: the
   `confirmedByPersonId`-in-CHECK bug the browser verification caught was
   fixed before this report was written (migration, schema comment, and a
   new regression test proving the erasure path). Named here so the fix is
   visible as a fix, not assumed to have always been correct.
