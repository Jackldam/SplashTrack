# Phase 3.3 — the `fees` module

**Branch** `build/fees-module` · **From** `d1d69eb` (1075 tests before this
phase, per the phase 3.1 report; 1161 after this phase's own initial 86; 1172
after the corrective follow-up §0.3 below adds its own 11) · **Not pushed, not
merged, not deployed.**

`FeeType`, `Charge`, `Payment` — `01-domain-model.md` §2.2/§5,
`15-assessment-and-fees.md` §6. R-32: fee types, charges, payments, a
balance view per payer and per student, CSV export — tracking only, and the
line is the document (D-091): no invoice, no payment provider, no VAT, no
sequential numbering. Decisions implemented: **D-088** (the three-table
shape), **D-090** (payer stored per charge, no `Household`, with an automatic
default and a manual override — see §1.3), **D-091** (nothing
that emits a document headed *Factuur*), **D-092** (erasure exemption on a
fiscal ground; pseudonymisation, never deletion), **D-057/CLAUDE.md §4**
(this module owns none of `people`'s/`groups`'s tables; it calls their
published services).

---

## 0. What landed

| Commit area | |
|---|---|
| `feat(schema)` | `FeeType`, `Charge`, `Payment` — three enums (`FeeRecurrence`, `ChargeStatus`, `PaymentMethod`), six hand-written CHECKs, the `feesGrantStatements` append-only/column-restricted carve-out (the `Award` shape applied to `Charge`, the `ExamResult` shape applied to `Payment`); `DATA_CLASS_BY_MODEL`/`ERASURE_REGISTRY`/`PERSON_REFERENCE_CLASSIFICATION` entries. `CHARGES`/`PAYMENTS` `DataClass` members and their `RETENTION_CATALOGUE` rows were ALREADY provisioned (phase 0.4b) — no change needed there. |
| `feat(fees)` | the module: domain (`money.ts`, `balance.ts`, `csv.ts`, `fee-type.ts`, `charge.ts`, `payment.ts`), application (`fee-type-service.ts`, `charge-service.ts`, `payment-service.ts`, `balance-service.ts`, `export-service.ts`), infrastructure (two repositories, no reach-filter — see §1.2), `index.ts`; the fee-type catalogue and charge-creation UI on `/fees`, the balance views embedded on `/people/[personId]` (see §1.5 for why there), the CSV export route; Dutch/English strings. |
| `test(fees)` | fixtures, domain unit tests, service tests (idempotency, balance derivation, waive/cancel), scope-escape, hand-written-constraint tests, database-role append-only proof, one Playwright spec. |
| `fix(test-infra)` | `tests/unit/create-correction-pairing.test.ts`'s allowlist gained one entry (`Charge` — see §1.6); `tests/e2e/support/e2e-common.ts`'s `SCRATCH_DB_NAME` was pointed at this worktree's own database (see §3, verification). |
| `docs(build)` | this report. |

### 0.1 The schema

- **`FeeType`** (`code`, `name`, `amount`, `currency`, `recurrence`, `active`)
  — the `AwardType`/`Course` shape: an administrator authors it, never
  seeded, `active` retires an entry without deleting the history of charges
  already created against it.
- **`Charge`** (`payerPersonId?`, `studentProfileId?`, `feeTypeId`,
  `periodStart?`, `periodEnd?`, `amount`, `currency`, `dueDate`, `status`,
  `note?`, the waive triple, the cancel triple, `createdByPersonId?`,
  `clientEventId`) — the `Award` shape: append-only except a
  column-restricted `UPDATE` on exactly `status` and the two administrative
  pairs. **`status` stores three values, not `15-…` §6.1's five — see §1.1,
  the central design call of this phase.**
- **`Payment`** (`chargeId`, `amount`, `receivedAt`, `method`, `reference?`,
  `recordedByPersonId?`, `clientEventId`) — the `ExamResult` shape: pure
  append-only, `SELECT, INSERT` and nothing else, ever.
- Six hand-written CHECKs: three money-positivity checks, one period-order
  check, and two waive/cancel-pair biconditionals (`(status = 'WAIVED') =
  (waivedAt IS NOT NULL AND waivedReason IS NOT NULL)`, and the same shape
  for `CANCELLED`) — deliberately excluding `waivedByPersonId`/
  `cancelledByPersonId` from the constraint, the exact
  `ExamCandidate_confirmed_fields_check` lesson (phase 2.4 report §1.1): those
  two columns are `SEVER_AND_RETAIN`, and a future erasure must be able to
  null them without leaving a waived/cancelled charge in violation of a
  CHECK.
- `Charge.payerPersonId`/`Charge.studentProfileId` are `onDelete: SetNull`,
  **not** `Cascade` — the one place this module's foreign keys deliberately
  differ from `ExamCandidate`'s. Proved directly in
  `fees-append-only.test.ts`: erasing the payer or the student severs the
  link and the charge, its amount and its payments survive untouched.

### 0.2 What no service in this module will ever do

- Update or delete a `Payment` — the database refuses the statement, proved
  as the real runtime role.
- Edit `Charge.amount`/`dueDate`/`feeTypeId`/`payerPersonId` — the runtime
  role's grant does not permit it at the column level, whoever writes the
  code path.
- Cache a `PAID`/`PARTIAL` status anywhere. Every balance is computed from
  `Charge.amount` and the sum of its `Payment.amount`s, every read
  (`domain/balance.ts`).
- Create a document headed *Factuur*, or anything resembling one.

### 0.3 A corrective follow-up, after independent review

Three items from this report's own §1 and §3 came back from review with
instructions to act on them, in `people`'s and `fees`'s existing write scope:

1. **§1.10's accessibility defect is FIXED, not worked around.** `.alert code`
   in `src/app/globals.css` now inherits the alert's own AA-compliant text
   colour instead of Bootstrap's fixed `$code-color` pink — see the rewritten
   §1.10.
2. **§1.3's automatic payer default (D-090) is now built**, on exactly the
   "small follow-up phase into `people`" this report itself called for — see
   the rewritten §1.3.
3. **§1.4 is rewritten from a broad "not wired" statement into the precise
   per-requirement product questions that actually block D-089 and §6.2**,
   found by reading `15-assessment-and-fees.md` §6.2–6.4 against the real
   `ExamCandidate`/`AwardType`/`FeeType`/`Enrolment` schema rather than
   restating the earlier report's summary. Neither is implemented — the
   blockers are real, not a scope-timing artefact — see the rewritten §1.4.

Nothing in §1.1, §1.2, §1.5–§1.9 changed; they are reproduced unedited below
for one document to stay the whole story.

---

## 1. Where this phase interpreted, stopped short, or found a real bug — read before assuming a gap is an oversight

### 1.1 `Charge.status` stores three values, not `15-…` §6.1's five — the central design call of this phase

`15-assessment-and-fees.md` §6.1 specifies `status ∈ {OPEN, PAID, PARTIAL,
WAIVED, CANCELLED}`. The build brief's own "Required product behavior"
overrides two of those five explicitly: *"Balance is derived from immutable
financial facts, not maintained as a mutable cached total."* A stored
`PAID`/`PARTIAL` column is exactly the cache that sentence forbids — it would
need writing on every `Payment` insert (by a trigger, or by application code
remembering to), and it would silently drift the moment a payment is
corrected out of band or a charge is edited by a future maintenance script.

So `Charge.status` stores only the two ADMINISTRATIVE DECISIONS a person
actually makes — `WAIVED` and `CANCELLED` — plus the `OPEN` default.
Whether an open charge currently reads as unpaid, partially paid or fully
paid is computed at read time, always, in `domain/balance.ts`
(`deriveChargeBalance`), from `charge.amount` and the live sum of its
payments. This is not a smaller feature than the five-state design — every
screen and the CSV export both render the full five-state vocabulary
(`OPEN`, `PARTIAL`, `PAID`, `WAIVED`, `CANCELLED`) — it is the same
vocabulary with two of the five values moved from a column to a function.

**Flagged for Jack**, because it is a literal departure from `15-…` §6.1's
schema sketch, even though it is required by the same document's governing
brief. If the intent was genuinely a stored `PAID`/`PARTIAL` column
(accepting the cache-consistency risk), that is a different, larger change:
a write path on every payment/charge mutation that recomputes and stores
the status, plus a job to catch drift.

### 1.2 No reach-filter file, and no list-narrowed-by-scope query anywhere in this module

Every other mature module (`exams`, `courses`, `skills`) has an
`infrastructure/*-reach-filter.ts` because it renders LISTS narrowed by the
caller's `Reach` (a GROUP-scoped instructor's own pupils, say). `fees` has
no such screen: every read is either **one** specific payer's balance,
**one** specific student's balance (both single-resource reads, the
`getCourseForPrincipal`/`getExamResultsForCandidate` shape — one
`requirePermission` call naming the one resource, then a plain query), or
the **whole-installation** CSV export (`{ organization: true }`-only, so
only `ORGANIZATION` reach ever passes and there is nothing to narrow
either). This is a property of the SCREENS R-32 asks for, not a shortcut
taken here — flagged so a reviewer does not go looking for a reach-filter
file that was never needed.

### 1.3 D-090's payer default is now built, on top of a new minimal `people` query surface

`15-…` §6.1: *"The payer is derived from `PersonRelationship(GUARDIAN_OF)`
at charge creation and stored on the charge, with a per-charge override."*
The override has existed since this phase's own first pass (summarised in
§0.3); this follow-up adds the default, exactly along the seam the original
report named: a new, minimal, published `people` query.

**The new surface.** `listActiveGuardiansForStudent(actor, studentProfileId)`
(`src/modules/people/application/relationship-service.ts`, exported from
`@/modules/people`) returns the ACTIVE `GUARDIAN_OF` relatives of the pupil
behind a `StudentProfile` id — administrative window only
(`coversInstant`, the `MembershipPeriod` half-open-interval rule applied to
`PersonRelationship.validFrom`/`validTo`), **never** the D-151
consent-authority derivation: paying a fee is not consenting on a child's
behalf, so a `GUARDIAN_OF` row with `authority: false` counts exactly the
same as one that claims it. Guarded exactly like `revealRelationshipEvidence`
— `people.read` on the SUBJECT, resolved from the `StudentProfile` id before
the guard runs, the same "look up, then guard on what was found" shape
`endRelationship` already uses. It returns FACTS ONLY: zero, one or several
candidates. Deciding what "unambiguous" means is deliberately not this
function's job — see below.

**Where the decision is made.** `people` states facts; `fees` decides.
`src/app/api/people/guardian-candidates/route.ts` exposes the query in the
existing candidate-picker's flat `{ id, label }` shape (mirroring
`relative-candidates`/`student-candidates`), and
`src/app/fees/charge-payer-and-student.tsx` (a new small client component,
replacing the two independent `LiveSearchPicker`s the charge form used to
render inline) is the ONLY place that turns "exactly one candidate" into a
preselection: it fetches the route the moment a student is picked, and calls
the payer field's own `LiveSearchPickerHandle.setSelection` — landing the
suggestion exactly as if the administrator had picked it, and leaving it
exactly as editable — only when (a) there is exactly one candidate and (b)
the payer field has not already been given a value by a genuine manual pick.
Zero or several candidates leaves the payer field untouched; a manual pick
(`onSelect`, never fired by `setSelection`) permanently latches out any
further automatic suggestion for the rest of that form. `LiveSearchPicker`
itself (`src/components/live-search-picker/live-search-picker.tsx`) gained
exactly two things to make this possible — an optional `onSelect` callback
and a `forwardRef`-exposed `setSelection` handle — and otherwise still knows
nothing about "defaults": every other picker on every other screen is
unaffected.

**Coverage.** `tests/integration/people-guardian-candidates.test.ts` (9
cases: zero/one/two active guardians, an administratively ended relationship,
one not yet started, an `EMERGENCY_CONTACT` correctly excluded, a
non-existent `StudentProfile` id yielding `[]` rather than a denial, and two
scope-escape cases — a `UNIT`-scoped reach outside the pupil's own unit, and
no grant at all). `src/app/api/people/guardian-candidates/route.test.ts` (2
cases, the route-wiring-only shape `relative-candidates/route.test.ts`
already established). `tests/e2e/fees.spec.ts` gained two browser scenarios:
one active guardian is suggested and used, by name, with no id ever typed or
pasted; two active guardians leave the field empty and the administrator
completes the charge manually, by name, through the same picker the override
always used.

### 1.4 D-089 (automatic exam-fee charge) and §6.2 (scheduled periodic billing) are still NOT wired — precisely why, this time

The original text of this section (reproduced in git history and in §0.3's
summary) gave one reason per item — "outside this phase's write scope" for
D-089, "no job runner exists" for §6.2. Both reasons are true but incomplete:
re-reading `15-assessment-and-fees.md` §6.2–6.4 against the ACTUAL
`ExamCandidate`/`AwardType`/`FeeType`/`Membership`/`Enrolment` schema (not
just the prose) finds that even with write scope opened to `exams/**` and a
job runner invented from nothing, neither item is finishable without
inventing product policy the design does not state. Four things have to be
unambiguous before either can be coded: which `FeeType` applies, what period
a `PERIODIC` charge covers, who the payer is, and what makes it run. The
audit below is per requirement, per item, against the real model — not a
restatement of "not wired".

**D-089 — an exam fee `Charge` on `ExamCandidate` → `CONFIRMED`.**

| Requirement | Status | Finding |
|---|---|---|
| Fee-type mapping | **Blocked** | `FeeType` (`code, name, amount, currency, recurrence, active`) carries no reference to `AwardType`, and `AwardType`/`ExamCandidate` carry none back. Nothing in the schema says which `FeeType` is "the Diploma A exam fee" versus "the Diploma B exam fee". Matching by `FeeType.code`/`AwardType.code` naming convention would be exactly the "magic fee-type code" this follow-up was told not to invent. |
| Payer derivation | **Blocked** | `createCharge`'s `payerPersonId` is a REQUIRED field (`charge-service.ts`'s own `requiredText`) — there is no "create with no payer yet" path, and `Charge` has no update path to fill one in later (§1.7: the correction path is cancel-and-recreate, never an edit). D-090's derivation, now built (§1.3), can return zero or several candidates. A MANUAL charge leaves that to an administrator; an automatic trigger firing inside `confirmExamCandidate`, with nobody at a screen, has nothing to put in a required field the moment the candidate is an adult member (zero guardians) or a shared-custody pupil (two). The design's "per-charge override" phrasing assumes a human is present to exercise it; D-089's trigger has none. |
| Period/cadence | Not blocked | `ONE_OFF` is unambiguous for an exam fee — no interval to determine. |
| Runtime trigger | Not blocked, but moot | The trigger point itself IS unambiguous — inside `confirmExamCandidate`'s own transaction, at the exact statement that writes `status = CONFIRMED` — and needs no scheduler, unlike §6.2. It stays moot until the two **Blocked** rows above have answers, because there is nothing correct to trigger yet. |

**The two precise questions that unblock D-089:**
1. Which `FeeType` is charged for a `CONFIRMED` candidacy of a given
   `AwardType` — a new FK (`FeeType.awardTypeId`? `AwardType.examFeeTypeId`?),
   and what happens when an `AwardType` has none (refuse confirmation, or
   confirm with no charge)?
2. When D-090's guardian derivation does not name exactly one payer at the
   moment of automatic confirmation, who is billed — the candidate
   themselves as a fallback, no charge created (leaving a human to create one
   manually, which weakens "created by the event... at no other time" but
   does not break it), or something else?

**§6.2 — a scheduled job generating `PERIODIC` charges from active
`MembershipPeriod` × active `Enrolment`.**

| Requirement | Status | Finding |
|---|---|---|
| Fee-type mapping | **Blocked** | Neither `Membership` nor `Course`/`Enrolment` references a `FeeType`. With several active `PERIODIC` `FeeType`s (plausible — a swim club distinguishes contributie from a course-specific fee), nothing says which applies to which membership or enrolment. |
| Period/cadence | **Blocked** | `FeeRecurrence` is a two-value enum (`PERIODIC`/`ONE_OFF`) with no interval field — monthly, quarterly and annual are equally unstated, and `Charge.periodStart`/`periodEnd` are freeform dates with nothing in the schema to derive them from. Inventing "quarterly" (or any cadence) here is exactly the "arbitrary monthly/quarterly cadence" this follow-up was told not to invent. |
| Payer derivation | **Blocked** | Unlike an exam fee (always about a specific child), a membership fee's payer could be the member themselves (an adult) or, per D-090, a derived guardian for a minor member. §6.2's own text is silent on which applies when, and D-090's derivation returning zero/several guardians has the same "no human is watching" problem D-089 has above. |
| Runtime trigger | **Blocked** | Confirmed by grep before this paragraph was written, again: no `maintenance` module, job scheduler, or cron-style runner exists anywhere in this codebase. `DATABASE_MAINTENANCE_URL` (`src/lib/database/maintenance-client.ts`) is a Postgres ROLE credential for the retention job's direct writes, not a scheduler — there is nothing to hang a periodic job on without designing and building that infrastructure from nothing, which is cross-cutting, v1-scoped product/infra work (CLI command run by the host's own cron, on the `admin:create`/`/setup` CLI precedent D-039 already established? An HTTP route hit by an external scheduler? Something else?) — not a fact this report can assume its way past. |

**§6.2 is unimplementable as a small increment**, not merely deferred: every
one of its four requirements needs a product or infrastructure decision this
codebase does not currently encode anywhere. It is not touched in this
follow-up, and `src/modules/exams/**` is not touched either — both stay
exactly as `§2`'s dependency direction already describes them, satisfied
MANUALLY: `createCharge` accepts any `FeeType` for any payer/student pair,
so an administrator can create an exam-fee charge the moment a candidate is
confirmed, or a membership charge each period, by hand, which is what the
build brief's own "Required product behavior" asks for regardless of whether
the automatic triggers ever get built.

### 1.5 The balance views are embedded on `/people/[personId]`, not on a route of their own

R-32 asks for "a balance view per payer and per student". The natural
first design was two dedicated pages, `/fees/payer/[personId]` and
`/fees/student/[studentProfileId]`. Built, then reverted, for a concrete
reason found while wiring the cross-link between them: a `Charge` stores
`studentProfileId`, and there is **no published service anywhere in this
codebase that resolves a `StudentProfile` id back to the `Person` who owns
it** — every existing screen navigates from `Person` downward
(`getPersonForPrincipal` returns `studentProfile.id` nested), never the
other way. A `/fees/student/[studentProfileId]` page could show a balance
but not the child's name without either inventing that lookup in `people`
(outside this phase's write scope) or navigating by the wrong key.

The balance views are instead two sections
(`src/app/fees/balance-section.tsx`, a shared component) on
`/people/[personId]/page.tsx` — the SAME screen `exams`, `skills` and
`assessment` already embed their own per-student views on, for the identical
reason (that page already has both the `Person` id and the nested
`studentProfile.id` in scope from one `getPersonForPrincipal` call). Each
section is independently `guarded()` on `fees.read`, and — this is the
point tested in `fees-scope-escape.test.ts` and stated in the page's own
comment — **renders nothing at all when denied, not a "no access" panel**:
D-093 (*"arrears never appear on the poolside surface"*) applied to a
screen `fees` does not own. An instructor with `people.read` but no
`fees.read` sees the person's membership, enrolments and progress exactly
as before, and no hint that a Financiën section exists to be denied.
`/fees` itself remains the module's own front door (fee-type catalogue,
charge creation, CSV export), linked from the landing page.

### 1.6 A real bug this module's own append-only test caught before it shipped

`Charge` was first modelled with an ordinary `updatedAt DateTime
@updatedAt` column, on the general "every table gets one" habit. Prisma's
client sets `@updatedAt` on every write regardless of which fields the
application code names — including a plain `create()` — so the very first
browser-driven charge creation in this phase's own e2e proof (§3) failed
with a raw `Null constraint violation` once the database's restrictive
column-level `UPDATE` grant was actually in force: the runtime role could
insert the row (a fresh `updatedAt` is set at create time regardless) but
the SCHEMA still carried the leftover column from before the fix, so once
`updatedAt` was removed from `schema.prisma`, older-schema scratch/test
databases needed a full drop-and-recreate to pick up the corrected shape —
a `prisma migrate deploy` alone does not retroactively drop a column the
current migration file no longer creates.

**The fix, and why it is the `Award` shape rather than a patched grant**:
`Charge` has NO `updatedAt` column at all now, exactly like `Award`
(`prisma/schema.prisma`'s own comment on the field explains this). Adding
`updatedAt` to the column-restricted GRANT was the other available fix and
was rejected: it would have made "which columns can the runtime role
write" and "which columns exist for audit purposes" two different lists to
keep in sync, for a timestamp this append-only-with-two-exceptions table
does not need (the waive/cancel pairs' own timestamps already answer "when
did this change" for the one thing that does change).

Two direct consequences, both applied before any test ran against it:
`prisma/migrations/20260916090000_fees_module/migration.sql` and its
`.lockfile.json` entry were edited in place (never applied to any shared or
long-lived database — this is new, uncommitted work on a feature branch,
the same ground `D-048`'s own test treats as pre-release), and every local
database this phase touched (`splashtrack_wt_fees`,
`splashtrack_wt_fees_test`, `splashtrack_scratch_e2e_wt_fees`) was dropped
and recreated from the corrected migration rather than patched in place.

### 1.7 `Charge` has no `updateChargeAction`, by design — and `tests/unit/create-correction-pairing.test.ts` was told why

That structural test (not part of this module, pre-existing) asserts every
`create<Noun>Action` has a sibling `update<Noun>Action`, with an allowlist
for the cases where a DIFFERENT verb serves the correction. `Charge`'s
correction path is `cancelChargeAction` followed by a fresh
`createChargeAction` — never an in-place edit of `amount`/`payerPersonId`/
`dueDate`, which are immutable financial facts by design and unwritable by
the runtime role at the database level regardless (§1.6). The allowlist
entry states this; see the test file's diff.

### 1.8 `Charge.note`/`Payment.reference` are plain, unprotected text — the `ExamResult.remarks` precedent applied without asking again

Neither field is in the D-148 protected-free-text class (medical/pastoral
notes, assessment remarks, inquiry text). A fee note is administration
about MONEY — *"Q3, naar afspraak in twee termijnen"* — not a developmental
observation about a child. **Flagged for Jack anyway**, on the exams phase's
own precedent for flagging this class of judgement call rather than
silently extending it: if an administrator ever writes something about a
CHILD in a fee note, nothing here detects it, and the module offers no
structural reason that could not happen. No existing module's free-text
field is fully guarded against this either (`ExamResult.remarks` has the
identical shape), so this is a restatement of an open question rather than
a new one.

### 1.9 No D-066 `RelationshipSource` registered for `fees`

`01-domain-model.md` §5.1 lists *"a legal retention ground on a record
referencing them"* among the relationships that hold a person open against
D-066's retention clock — which a `Charge`/`Payment` arguably is. Not
registered in this phase: determining whether a person is genuinely "held"
by an outstanding financial obligation requires comparing `sum(Payment)`
against `Charge.amount` per charge (the same derivation
`domain/balance.ts` already does for display), and `erasePersonData` — the
transaction that would ever CONSUME a registered source — is not built
(R-25, still not built, the same state every other module's registrations
report). Wiring a source with no consumer to exercise it risks papering
over a real design question (is "held" the presence of any charge at all,
or only a genuinely open one?) with an untested answer. **Flagged as a
precise follow-up**, not silently skipped: `src/lib/retention/
last-relationship.ts`'s own registry is exactly where it belongs once R-25
exists to use it.

### 1.10 The pre-existing accessibility defect, now fixed at its actual cause

`assertNoAccessibilityViolations`, run on the landing page right after first
sign-in in this phase's own e2e proof, failed on a `color-contrast` violation
inside `src/app/break-glass-banner.tsx`: `<code>{alert.command}</code>`
inside Bootstrap's `.alert-warning` rendered at a 4.06:1 contrast ratio
against the 4.5:1 WCAG AA threshold. The cause is Bootstrap 5.3's own fixed
`$code-color` (`$pink`, `#d63384`), which `<code>` uses regardless of which
background it sits on — computed directly (the same sRGB relative-luminance
formula WCAG 2.x specifies): `#d63384` against `.alert-warning`'s background
is 4.06:1, matching the violation exactly, while the alert's OWN text colour
(`$warning-text-emphasis`, Bootstrap 5.3's "-emphasis"/"-subtle" pair, chosen
specifically to clear AA against its matching "-subtle" background) is
7.21:1 against the same background.

**The fix** (`src/app/globals.css`): `.alert code { color: inherit; }`. Not
scoped to `.alert-warning` alone — every `.alert-*` variant's own text colour
is built from the same AA-passing "-emphasis"/"-subtle" pair, so the rule
generalises to the one other place a `<code>` sits inside an alert today
(`src/app/page.tsx`'s `.alert-info` setup instructions) without needing a
second rule when a third one appears.

**The proof is a permanent assertion, not a dismissal.** The e2e spec used to
click the banner's own "Gezien" button BEFORE running the accessibility
check — a real administrator's action, but one that would have made this
check pass by making the violating element disappear rather than by fixing
it, the exact failure mode a corrective review flagged. `tests/e2e/fees.spec.ts`
now asserts the "Gezien" button IS visible (i.e., the banner is genuinely
on screen, undismissed) immediately before calling
`assertNoAccessibilityViolations`, and only dismisses it afterwards. This is
the ONE place in the whole suite that exercises `break-glass-banner.tsx`'s
accessibility at all — everywhere else it is dismissed first, which is
correct for THOSE specs' own subject matter but would have hidden a
regression here.

---

## 2. The dependency direction

`fees` depends on `people` (`listPeopleForPrincipal`/
`/api/people/relative-candidates` for the payer picker,
`listStudentCandidatesForPrincipal`/`/api/people/student-candidates` for the
student picker, and now `listActiveGuardiansForStudent`/
`/api/people/guardian-candidates` for D-090's automatic default, §1.3 — all
three pre-existing or added in `people/**`, none of it reused by `fees`
through anything but `@/modules/people`'s published surface or a Route
Handler under `/api/people/`) and, in the UI layer only, embeds into a screen
`people` owns (`src/app/people/[personId]/page.tsx`). No file under
`src/modules/fees/` imports any other module's internals — only their
published `index.ts` surfaces — and no other module imports `fees`. `exams`
is still NOT touched (§1.4, rewritten): D-089's blockers are two open
product questions, not a write-scope limit this follow-up could have lifted.

---

## 3. Verification

- **Environment.** This worktree had no `.env`/`.env.e2e` before this phase.
  A dedicated database (`splashtrack_wt_fees`, `_test` suffix for Vitest)
  and dedicated Postgres roles (`splashtrack_app_fees`,
  `splashtrack_retention_fees`) were provisioned against the shared
  `splashtrack-postgres-1` container — new roles and a new database only,
  nothing belonging to the main checkout or a sibling worktree was read,
  altered or touched. `tests/e2e/support/e2e-common.ts`'s
  `SCRATCH_DB_NAME` was repointed from a stale value that in fact belonged
  to a different, live worktree (`wt_attendance`) to this worktree's own
  `splashtrack_scratch_e2e_wt_fees`, eliminating a real collision risk
  rather than a hypothetical one.
- `npx vitest run` — **1172 / 1172 passed** (104 files), the 1161-test
  baseline after this phase's initial pass plus this follow-up's own 11
  (`tests/integration/people-guardian-candidates.test.ts`, 9;
  `src/app/api/people/guardian-candidates/route.test.ts`, 2), zero
  regressions.
- `npm run typecheck` — clean.
- `npm run lint` — clean (module-boundary rules included).
- `npm run format:check` — clean.
- `npm run build` — successful, `/api/people/guardian-candidates` present in
  the route list. The only warning (`app-version.ts`'s dynamic filesystem
  tracing) is the same pre-existing, non-failing one the phase 2.3 and 2.4
  reports already recorded.
- `npx playwright test tests/e2e/fees.spec.ts` (run with `.env.e2e` sourced,
  its own dedicated port — see that file's own header) — **4 / 4 passed**,
  against a freshly migrated scratch database and a real production build:
  the original happy path and refusal scenario, plus the two D-090 scenarios
  this follow-up adds (§1.3) — one active guardian is suggested and used by
  name, with no id ever typed or pasted; two active guardians leave the payer
  field empty and the administrator completes the charge manually, by name.
  The axe accessibility check now runs against the break-glass banner WHILE
  IT IS VISIBLE, undismissed (§1.10) — a permanent assertion that the banner
  is on screen before the check runs, not a dismissal that would have made
  the check pass by hiding the element it exists to verify.
- Scope-escape suite (`fees-scope-escape.test.ts`, 8 cases): UNIT-scoped
  reach follows the payer's/student's own unit; GROUP-scoped reach covers a
  student charge through active group membership and NEVER a person-only
  (membership) charge, because `{ person }` is never covered by a `GROUP`
  reach at all (`covers-resource.ts`'s own rule); `waiveCharge`/
  `cancelCharge`/`recordPayment` re-derive their guard from the CHARGE's own
  stored payer/student, never from a caller-supplied resource id, even when
  the caller genuinely knows the target charge's id; no grant at all is
  denied outright for every write and read, and `fees.export` is required
  specifically (`fees.read`/`fees.manage` do not imply it).
- Append-only/grant proof (`fees-append-only.test.ts`, run as the REAL
  runtime role): `Payment` — `SELECT, INSERT` only, `UPDATE`/`DELETE`
  refused by the database. `Charge` — `SELECT, INSERT` plus a
  column-restricted `UPDATE` on exactly the seven waive/cancel/status
  columns, `DELETE` refused; an `UPDATE` touching `amount`, `dueDate`,
  `feeTypeId` or `payerPersonId` is refused even alongside an otherwise
  legal column. Erasing a payer, a student, or the administrator who
  waived a charge SEVERS the link (`SET NULL`) and leaves the charge, its
  amount and its payment history intact — the D-092 pseudonymisation
  prerequisite, proved directly.
- Hand-written constraints (`fees-constraints.test.ts`, 12 cases): money
  positivity on all three tables, period ordering, both waive/cancel
  biconditionals in BOTH directions, and both idempotency keys, including
  a direct proof that `recordPayment`'s service-level replay agrees with
  the database's own unique constraint.

---

## 4. Definition of Done (`06-delivery.md` §4.4)

| Requirement | Status |
|---|---|
| Data model | `FeeType`, `Charge`, `Payment` — schema + migration `20260916090000_fees_module`, six hand-written CHECKs, the append-only/column-restricted carve-out (`feesGrantStatements`, `infra/fees-database-role.sql`) |
| Service | `fee-type-service.ts` (`createFeeType`, `updateFeeType`, `listFeeTypesForPrincipal`, `getFeeTypeForPrincipal`), `charge-service.ts` (`createCharge`, `waiveCharge`, `cancelCharge`), `payment-service.ts` (`recordPayment`), `balance-service.ts` (`getFeeBalanceForPayer`, `getFeeBalanceForStudent`), `export-service.ts` (`exportFeesCsv`) — all behind `requirePermission` on the pre-catalogued `fees.read`/`fees.manage`/`fees.export`. D-090's automatic payer default (§1.3) is `people`'s own `listActiveGuardiansForStudent`, not a `fees` service — `fees` only consumes it, through `/api/people/guardian-candidates` |
| UI | `/fees` (catalogue + charge creation + CSV download link), two balance sections embedded on `/people/[personId]` (§1.5), Server Actions for every write, all real forms against real services. The charge form's payer/student fields are now `src/app/fees/charge-payer-and-student.tsx` (§1.3), a small client component wiring D-090's default between two otherwise-unchanged `LiveSearchPicker`s. Dutch and English strings both present, both valid JSON, parity-checked by `message-catalog.test.ts` |
| Scope-escape tests | `tests/integration/fees-scope-escape.test.ts` — see §3. D-090's default has its own, in `people`: `tests/integration/people-guardian-candidates.test.ts` |
| Domain/service tests | `tests/unit/fees-domain.test.ts` (28 cases: money formatting/parsing, balance derivation, CSV escaping), `tests/integration/fees-services.test.ts` (23 cases), `tests/integration/fees-constraints.test.ts` (12 cases), `tests/integration/people-guardian-candidates.test.ts` (9 cases, §1.3), `src/app/api/people/guardian-candidates/route.test.ts` (2 cases, §1.3) |
| `Person`-reference registry | `Charge.payerPersonId`/`.createdByPersonId`/`.waivedByPersonId`/`.cancelledByPersonId`, `Payment.recordedByPersonId` — all `SEVER_AND_RETAIN` |
| Erasure registry | `Charge`, `Payment`: `{ kind: "exempt" }` on the fiscal ground (D-092), exactly as `erasure-registry.ts`'s own header anticipated before this phase existed |
| Retention (`DATA_CLASS_BY_MODEL`) | `Charge` → `CHARGES`, `Payment` → `PAYMENTS` (both pre-provisioned, phase 0.4b), `FeeType` → `ORGANIZATION_SETTINGS` |
| Encrypted columns | None. `Charge.note`/`Payment.reference` are plain text — §1.8 |
| CI | `npx vitest run`: 104 files / 1172 tests, zero regressions. `npm run typecheck`/`lint`/`format:check`: clean. `npm run build`: successful. `npx playwright test tests/e2e/fees.spec.ts`: 4/4 |
| Jack's approval | Not yet requested — this report is the handoff |

**Open items for review, not silently resolved:**

1. §1.1 — `Charge.status`'s three-state shape (not `15-…` §6.1's five) is
   the central interpretive call of this phase, made to satisfy the build
   brief's explicit "derived, not cached" requirement. Worth confirming
   this is the intended reading of the two documents together.
2. §1.3 — D-090's automatic payer default is now built (this follow-up);
   confirm the "exactly one active guardian ⇒ preselect, still overridable;
   zero or several ⇒ manual" reading is the intended one.
3. §1.4 — **D-089 and §6.2 remain unbuilt, now for named, precise reasons**
   rather than a scope/infrastructure summary: D-089 needs an answer to
   "which `FeeType` per `AwardType`" and "who is billed when D-090 names zero
   or several guardians at an automatic trigger with nobody watching"; §6.2
   needs those same two answers PLUS a billing cadence (`FeeRecurrence`
   carries no interval today) and an actual job-running mechanism, none of
   which the design states. Two product questions unblock D-089; §6.2 needs
   all four before a line of it can be written.
4. §1.5 — the balance views live on `/people/[personId]`, not on routes of
   their own, because resolving a `StudentProfile` id back to its `Person`
   has no published service anywhere in this codebase today.
5. §1.9 — no D-066 relationship source registered for an open financial
   obligation; a precise, deliberate deferral pending R-25.
6. §1.10 — the accessibility defect in `break-glass-banner.tsx` is now
   FIXED (`.alert code { color: inherit; }`, `src/app/globals.css`), and
   `tests/e2e/fees.spec.ts` asserts the banner is genuinely on screen,
   undismissed, at the moment the accessibility check runs — a permanent
   proof, not a workaround.
