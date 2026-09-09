# Staging — domain model, assessment and fees

> **MERGED, 2026-09-01.** Rows D-080–D-089 are in `09-decision-register.md`
> unchanged. Rows D-095–D-098 (`GroupMove`, trial/waitlist/make-up, retention
> lawful basis, attendance deletion) collided with `13-…`/`14-…`'s own
> D-095–D-098 and were **renumbered to D-108–D-111** in `01-domain-model.md`
> and the register — see `08-open-decisions.md`, Register integrity. Findings
> F-40–F-49 are in `10-findings.md` unchanged; F-51/F-52/F-54 are there as
> F-71/F-72/F-73 (renumbered to avoid colliding with `platform.md`'s F-50–F-54
> claim on the same range), and F-53 is F-74. All seven hand-offs in §3 below
> have been actioned in the live chapters. This file is kept for provenance;
> do not merge it again.

Prepared by the *Domain model + assessment & fees* agent, 2026-09-01.

**Numbers used.** Decisions **D-080 … D-098** (19 rows). Findings **F-40 … F-54**
(15 entries). Nothing below D-080 or F-40 is claimed, to leave room for the three
agents working concurrently. `09-decision-register.md` currently ends at D-067
and `10-findings.md` at F-28, so the gaps D-068…D-079 and F-29…F-39 are theirs.

**Files changed by this agent:** `docs/design/01-domain-model.md` (edited),
`docs/design/15-assessment-and-fees.md` (new), this file.

**Cross-chapter dependency, owned elsewhere:** D-085 (the four-eyes gate) cannot
be implemented without the `SESSION` participation reach proposed as **D-068** in
`02-security-privacy.md`. Chapter 15 references it and does not design it.

---

## 1. Rows for `09-decision-register.md`

| ID | Decision | Reason | Trade-off | Where |
|---|---|---|---|---|
| D-080 | The assessment pass rule is one data-driven function over scheme rows: every criterion needs a result whose grade rank ≥ `criterion.minimumGrade ?? scheme.passFloor`, or a recorded waiver. No award type is branched on anywhere in the codebase | *"Alles minimaal voldoende"* is `passFloor = VOLDOENDE` with every override NULL; *"certificaten hebben afgezwakte eisen"* is a different `AwardType` with its own scheme carrying lower overrides or fewer criteria. The alternative — a global floor plus hardcoded exceptions — survives only until someone asks for a third award variant, and every school eventually has one | The rule is no longer readable from the code alone; answering "why did this child pass?" means reading the scheme too. The screen renders the effective threshold beside each criterion | `15-assessment-and-fees.md` §2.2 |
| D-081 | `Assessment.schemeId` pins a specific immutable scheme version. An `ACTIVE` scheme is never edited — editing produces version n+1 and stamps `effectiveTo` on n. The scheme is never resolved from the assessment date | Date resolution (`assessedAt BETWEEN effectiveFrom AND effectiveTo`) is the version everyone writes first and it breaks twice: on backdated entries, and whenever the NRZ revision date differs from the school's adoption date — which it always does, because a school finishes the running block under the old requirements | One more foreign key, and a scheme version can never be corrected in place; a typo in a criterion name requires a new version | `15-assessment-and-fees.md` §2.3 |
| D-082 | The existing `Certificate` entity is renamed `Award`; `AwardType.kind ∈ {DIPLOMA, CERTIFICATE}` carries the distinction | `Certificate` currently means "the physical proof of a diploma", but in this domain a *certificaat* is a **different award with weaker requirements**. Two meanings, one word, one of them already in the schema. Free today; a migration through every issued diploma later | "Award" is less familiar to a Dutch administrator than "certificaat". The UI keeps saying *diploma* and *certificaat* for the two `kind` values; only the table name changes | `15-assessment-and-fees.md` §2.4, `01-domain-model.md` §3.5 |
| D-083 | NRZ-derived schemes ship seeded and source-labelled (`source = NRZ`), org-editable, but editing one produces an org-owned **fork** rather than an in-place change | Without the fork a well-meaning administrator lowering one threshold quietly weakens a national diploma requirement, and nothing records that the school is no longer assessing to the NRZ standard. With it, the divergence is a visible object with an owner | More scheme rows, and adopting a minor NRZ correction means a new version rather than a patch. That is the correct direction of friction | `15-assessment-and-fees.md` §2.5 |
| D-084 | `SchemeCriterion` is the single criterion catalogue; `SkillRequirement` and `Skill` are collapsed into it and removed. `SkillProgress` survives as the informal per-lesson teaching log; `AssessmentCriterionResult` is the formal graded observation | Two catalogues covering the same concept diverge — not by decision but because a criterion gets added to whichever one the current screen writes, after which "what does Diploma A require?" has two answers. This **reduces** scope: one catalogue to seed, import, export and render | `SkillProgress` now references a versioned criterion, so a note taken under scheme version 3 renders against version 3's name. Correct, and the same pin as D-081 | `15-assessment-and-fees.md` §2.6, `01-domain-model.md` §3.3 |
| D-085 | An `ExamCandidate` may not reach `CONFIRMED` without a non-superseded `Assessment` with `type = AFTEST`, the target award's active `schemeId`, `outcome = PASS`, an assessor holding a valid `PersonQualification`, and an assessor who is not an `InstructorAssignment` holder for that student's group over the window. Overridable only with an explicit permission and a recorded, audited reason | This is the control the domain actually runs on — a different qualified instructor decides whether a child may sit the exam — and it was enforced by nothing but habit. The override exists because in a club with four instructors there will be a week with no independent assessor, and an un-overridable rule produces someone logging in as a colleague: the control is then gone **and** the audit trail is a lie | The gate's strength becomes reporting rather than prevention. Accepted: an override rate is a number a chair can act on; a workaround is not | `15-assessment-and-fees.md` §3 |
| D-086 | On the assessment screen every criterion starts **unset**. No default grade, no unconfirmed "mark all voldoende", no outcome computed over unset criteria. Set-whole-column is allowed behind an explicit confirmation | Pre-filling *voldoende* on the assessment that decides whether a child may sit an exam manufactures rubber-stamping and destroys the four-eyes control the feature exists to provide — the feature would then cost 2.5 weeks and deliver the appearance of the control. This contradicts the 30-second product thesis deliberately: that thesis governs the poolside operational moment, and an aftest is a scheduled deliberate act whose whole value is that someone looked | The slowest screen in the product, and the one most likely to attract "can't you just default these?". An aftest takes ten minutes and that is the correct number | `15-assessment-and-fees.md` §4 |
| D-087 | Assessment remarks sit behind `students.notes.read` / `students.notes.write`, not general `students.read`, and attach primarily at `AssessmentCriterionResult` | *"Kind vertoont een schaarslag"* is a developmental observation about a minor's body and behaviour, at least as sensitive to a parent as an allergy. D-010 gates medical notes and says nothing about assessment remarks, which were destined for a table readable by anyone with `students.read` | A permission check on a field inside an otherwise-readable screen; an assessor without the notes permission sees grades without the reasoning | `15-assessment-and-fees.md` §5 |
| D-088 | Fee tracking is three tables (`FeeType`, `Charge`, `Payment`), one idempotent generation job, one balance view and one CSV export. The payer is a `Person`, never the child; `Charge.amount` is copied at creation, not joined at read time | The product owner's verb is *bijgehouden* — tracked. A ledger answers it; a finance system answers a question nobody asked. Copying the amount stops next year's contribution silently restating last year's open charges | The treasurer still produces actual invoices elsewhere, from the CSV | `15-assessment-and-fees.md` §6.1–6.2 |
| D-089 | An exam-fee `Charge` is created by the event of an `ExamCandidate` reaching `CONFIRMED`, and at no other time | Encodes *"dit gebeurt dus ook alleen als ze echt examen gaan doen"* as an invariant rather than a convention someone must remember, and composes with D-085: no aftest pass → no confirmed candidate → no charge. The rule protecting the child from an exam they are not ready for is the rule protecting the family from a fee they do not owe | Cancelling a candidacy must cancel or waive the charge rather than delete it, leaving a `CANCELLED` row behind | `15-assessment-and-fees.md` §6.3 |
| D-090 | There is no `Household`. Charges group by `Charge.payerPersonId` at render time; the payer is derived from `PersonRelationship(GUARDIAN_OF)` at charge creation and stored on the charge, with a per-charge override | A household is a fourth identity concept alongside `Person`, `Membership` and `StudentProfile` (D-004) and will be wrong within a year in ways that are painful to unpick: divorced parents, split payment, a grandparent paying for one child. Grouping at render time gets the same screen and never needs correcting; storing the payer on the charge means a later change of payer does not restate history | No place to hang a household-level discount; "the family overview" is a query rather than a row | `15-assessment-and-fees.md` §6.4 |
| D-091 | v1 emits no invoice. Out of scope: payment providers, SEPA incasso files, VAT calculation, sequential invoice numbering, credit notes and refunds, dunning, accounting export, pro-rata credit — and any rendered document headed *Factuur* | The line is the document. A balance view and a CSV are internal administration; a PDF with an amount, the organisation's details and a parent's name, sent to that parent, is arguably a *factuur* under Dutch rules and inherits gapless numbering, mandatory fields, BTW treatment, credit notes and a seven-year obligation on a record the app now **authored**. A ledger that is wrong is an annoyance; an invoice that is wrong is a filing | Unpopular within a term. The treasurer invoices from the CSV in whatever they already use | `15-assessment-and-fees.md` §6.5 |
| D-092 | `Charge` and `Payment` are registered in the D-014 erasure registry with a **financial retention ground**, and erasure **pseudonymises** the charge (amount, date, fee type, period kept; person link removed) rather than deleting it | D-066 defaults person retention to 24 months after the last relationship; Dutch fiscal law wants seven years. Both are right and they collide on the same rows. Without this, the first erasure request either destroys the bookkeeping or silently skips it, and nobody finds out which until an accountant asks. Per D-065's honesty rule, a pseudonymised charge is still personal data — what it is not is a reason to keep the person | Financial rows outlive the people they refer to, so the erasure report must tell the subject that charges were retained and on what ground | `15-assessment-and-fees.md` §6.7, `01-domain-model.md` §5 |
| D-093 | Arrears never appear on the poolside surface. `Enrolment.status` remains a lifecycle, never a payment state | Every school has an unwritten "no payment, no lesson" rule, and once money is in the same database as the class list someone will ask why the class list does not flag it. Showing it would put a family's finances in front of a volunteer instructor, on a shared device, at the poolside, in front of the child. Availability of the data is not an argument for displaying it there. Re-affirms P-03's seam rather than drifting through it | An administrator cannot use the app to have an instructor quietly chase a parent. That is the intended outcome | `15-assessment-and-fees.md` §6.8 |
| D-094 | NRZ notification is an export — candidates, date of birth, award type, date. The visiting delegate receives a **printed** candidate list: no guest login, no share link, no read-only visitor account | The domain expert asked for a report, not an integration; an integration with a national body is a contract, someone else's schema and a support obligation, in exchange for saving one upload a term. For the delegate, the requirement is that a person beside the pool can read twelve names. Paper does that with no stranger touching a device holding children's records, no account lifecycle, no expiry logic and no scope type — about half a day of work. The low-tech answer is the better design here, not a compromise | A printed list cannot be revoked once handed over. Neither can a photograph of a screen, and paper at least persists no credential | `15-assessment-and-fees.md` §7 |
| D-095 | Moving a child between groups is recorded as a `GroupMove` carrying direction (`UP`/`DOWN`/`LATERAL`), a reason and the deciding person. Moving **down** is ordinary history, not a correction | Progress is per individual, not per group; both directions are normal. `GroupMembership` already held the data — what was missing was the act. Without a reason, a move down is indistinguishable from an administrative error and will be rendered as one; a parent reading "Group 4 → Group 3" with nothing attached draws the worst conclusion available. Recording direction explicitly also stops a lateral move (different evening, same level) reporting as a demotion | One more row per move and a required reason on an action administrators would rather do in two clicks. The reason is the entire value of the record | `01-domain-model.md` §3.2 |
| D-096 | Trial lessons, waiting lists and make-up lessons are **modelled**, and no workflow is built: `Enrolment.status = TRIAL`, `StudentLifecycleEvent.TRIAL_ATTENDED`, `WaitlistEntry` with a placement action from `Inquiry`, and `SessionRosterEntry` accepting a student who is not a member of the session's group. No booking flow, conversion funnel, shortened onboarding or entitlement counter | The waiting list is in daily use and gets its placement action. The other two the domain expert asked to allow for while stating **his own school does not run them** — so a workflow would be built for a customer who does not exist, the exact charge this review levelled at the rest of the design. The data shape is genuinely expensive to retrofit: a non-member on a roster touches reach resolution and the attendance aggregate at once | A school that does run trials and make-ups administers them by hand. A worse experience than a designed flow, and a better outcome than a designed flow nobody opens | `01-domain-model.md` §3.2 |
| D-097 | The retention table records a **lawful basis** per data class, and unresolved bases are printed as *unresolved* rather than left blank | The prose describing the table already promised to answer "on what lawful basis is it held" and the table did not carry the column, so the one question an organisation must answer to defend a default was the one the defaults did not state. A proposed basis can be argued with; a blank cannot | Some cells now read *unresolved* in a published document. That is the honest state and it makes the gap visible where the defaults are read | `01-domain-model.md` §5 |
| D-098 | Expired attendance events are **deleted**, not anonymised. Any aggregate kept is kept because it was computed, not because a row was stripped. Pre-migration backups gain a policy: deleted after the next successful start, at most 3 retained | Stripping the student reference does not anonymise here — a group of twelve, time-bounded `GroupMembership` rows and known session dates re-identify a large share of the stripped rows by a join and a counting argument, which fails the mechanical anonymisation test going into chapter 02. Pseudonymised data carries the same obligations, so nothing was gained by not deleting. Separately, D-044's pre-migration backup had **no** retention policy at all, so a full copy of the database including medical notes accumulated once per upgrade and outlived every rule in the table | Attendance-rate history beyond the window is lost unless someone deliberately computes and stores an aggregate first — which is the correct order | `01-domain-model.md` §5.3 |

---

## 2. Entries for `10-findings.md`

### F-40 — *Aftesten* — the four-eyes gate on exam entry — was absent from the design entirely
**Severity: high.** The word *aftest* did not appear once in `docs/design/`, and
neither did *NRZ*. The entire assessment budget went to the exam (D-052, D-054,
D-062, `ExamAssessor`, `Certificate`, `04-ux.md` §4.4), but in the process
actually used the exam is the formality: a child reaches it only because a
**second, qualified instructor who is not their own** graded every requirement
and found all of them at least *voldoende*. `ExamResult.outcome` + `remarks?` was
the only assessment detail in the schema.
**Response.** `15-assessment-and-fees.md` §2–§3: a versioned criterion catalogue,
an ordinal grade scale, graded per-criterion results, recorded waivers,
`PersonQualification`, and D-085 making the gate a domain invariant on
`ExamCandidate → CONFIRMED` — overridable only with an explicit permission and a
recorded reason.

### F-41 — The independent assessor cannot read the student under the current authorization model
**Severity: high.** The assessor conducting an *aftest* is by definition not the
child's instructor and therefore holds no `GROUP` grant covering them. Under
D-030/D-031 they cannot read the student at all, which makes D-085 unimplementable
as the security model stands. The same hole blocks a substitute instructor, the
receiving instructor of a make-up lesson and the visiting delegate.
**Response.** Being resolved in `02-security-privacy.md` as a `SESSION`
participation reach (proposed **D-068**), replacing the `EXAM_SESSION` scope of
D-054. **Owned by that chapter; chapter 15 records only the dependency.** Until it
lands, the four-eyes gate cannot ship.

### F-42 — Two criterion catalogues were being specified for the same concept
**Severity: medium.** `Skill`/`SkillRequirement` (`01-domain-model.md` §3.3) is
"criteria per level, assessed per student"; `SchemeCriterion` is the same thing
with an ordinal grade instead of a four-state enum. Shipping both guarantees
divergence — not by anyone's decision, but because a criterion gets added to
whichever catalogue the current screen writes — after which "what does Diploma A
require?" has two answers and two seed catalogues to maintain.
**Response.** D-084 collapses them: `SchemeCriterion` is the single catalogue,
`SkillProgress` is the informal per-lesson log referencing a criterion, and
`AssessmentCriterionResult` is the formal graded observation. This **reduces**
the `skills` module rather than doubling it.

### F-43 — `Certificate` named two different things in the same domain
**Severity: medium.** The schema's `Certificate` means "the physical proof of a
diploma". In this domain a *certificaat* is a **different award with weaker
requirements** — a distinct thing a child is assessed for. One word, two
meanings, one of them already modelled.
**Response.** D-082: rename to `Award`; `AwardType.kind ∈ {DIPLOMA, CERTIFICATE}`
carries the distinction. A rename in a design document today; after the first
release, a migration through every issued diploma row.

### F-44 — The NRZ criteria and thresholds are unverified, and blocking
**Severity: medium, and blocking for one deliverable.** Chapter 15 specifies the
*shape* of the scheme catalogue. Its **contents** — the concrete NRZ criteria,
codes and thresholds — are not confirmed, and were not verifiable in the sessions
that produced this design.
**Response.** No catalogue may be seeded until the criteria are confirmed with
the domain expert. A seed containing invented swimming requirements would be
worse than an empty one, because it would look authoritative and would be
assessed against. `AssessmentScheme.source` and D-083's fork rule exist so that
the provenance of whatever is eventually seeded stays visible.

### F-45 — Fee tracking's first regret is reconciliation, and it is deliberately not in v1
**Severity: medium.** What kills a tracked-billing feature is not the absence of
a payment provider; it is someone marking 180 charges `PAID` by hand each quarter
from a bank statement in another window. That is worse than the spreadsheet the
school has today.
**Response.** Named in advance rather than discovered. The specific missing piece
is **CAMT.053 / MT940 import with reference matching** — one uploaded bank file,
automatic matching on a structured reference in the charge, the remainder queued
for review. No payment provider, no PSD2, no bank API, roughly a week. It is out
of v1 and it is the **first** thing added after the first full billing period.

### F-46 — Financial retention conflicts with person retention
**Severity: high.** D-066 defaults person retention to 24 months after the last
relationship ends; Dutch fiscal law wants administration kept seven years. Adding
`Charge`/`Payment` puts both rules on the same rows.
**Response.** D-092: register both tables in the D-014 erasure registry with a
financial retention ground, and **pseudonymise** rather than delete on erasure.
Without this the first erasure request either destroys the bookkeeping or
silently skips it, and which one is not discovered until an accountant asks.

### F-47 — Adding money raises the value of a breach without changing the controls
**Severity: medium.** The database now holds children's health notes **and** who
owes money. Nothing about D-040 (encrypted backups) or D-042 (the export as an
exfiltration primitive) becomes wrong; both become more load-bearing.
**Response.** Recorded rather than mitigated, deliberately — the correct controls
were already chosen. This finding exists so that the change in stake is stated
when the money tables land, rather than discovered in an incident report.

### F-48 — "Anonymise attendance to aggregate" was not anonymisation
**Severity: medium.** The retention default for attendance events was `ANONYMISE`
to aggregate. Stripping the student reference does not anonymise here: a group
holds around twelve children, `GroupMembership` is retained and time-bounded, and
session dates are known — so a join and a counting argument re-identify a large
share of the stripped rows. That fails the mechanical anonymisation test being
added to `02-security-privacy.md`, and describing it as anonymisation in a privacy
notice would be the false comfort D-065 exists to prevent.
**Response.** D-098: delete expired attendance events. An aggregate may be kept
because it was **computed and stored**, never because a row was stripped.

### F-49 — Pre-migration backups had no retention policy at all
**Severity: medium.** D-044 takes an automatic backup before every migration —
the right behaviour — and no rule anywhere said what happens to it. A full copy
of the database, including medical notes, therefore accumulated once per upgrade
and outlived every rule in the retention table.
**Response.** Added to `01-domain-model.md` §5 as a data class with a real trigger
and cap: deleted after the next successful start, at most three retained, so that
a bad migration discovered late is still recoverable. **Touches `14-…` D-044**,
which is owned by another chapter — see §3 below.

### F-50 — The retention table stated no lawful basis
**Severity: medium.** The prose introducing the table promised to answer "on what
lawful basis it is held" for each data class. The table had no such column, so
the one question an organisation must answer in order to defend or change a
default was the question the defaults did not state.
**Response.** D-097 adds a `lawfulBasis` column with proposed bases, and prints
*unresolved* where the basis genuinely is — most visibly on exam results and
awards, where §5.2 already says the ground must be identified per organisation
rather than assumed.

### F-51 — `PersonRelationship` was defined twice with different fields, and consent validity depended on the difference
**Severity: high.** (Raised as **M-10** and **C-1**.) One definition carried
`evidence?` and no `authority`; the other carried `authority` and no `evidence`,
and the second was a stray table row sitting in prose after D-060, outside any
table, rendering as a broken line. **Both fields are load-bearing** — D-063
requires `authorityEvidenceId → PersonRelationship`, F-02 requires the
`authority` flag. An implementer picking the second definition never builds
`evidence`, and in a custody dispute the school can show a flag saying someone
was authorised and nothing recording how that was established: precisely the
false comfort D-063 exists to prevent.
**Response.** Merged into one row —
`type, fromPersonId, toPersonId, authority, evidence, validFrom, validTo?` —
with `evidence` **non-optional where `authority = true`**. The duplicate is
deleted.

### F-52 — The attendance entity had two names, and the aggregate boundary used the wrong one
**Severity: medium.** (Raised as **M-9** / **B-6**.) D-061 makes append-only
superseding *events* a data-integrity requirement, but the ER diagram, the §3.4
session row and the §4 aggregate table all still said `AttendanceRecord` — the
superseded, mutable name, and exactly the three places a schema author copies
from.
**Response.** All occurrences renamed to `AttendanceEvent`.

### F-53 — F-08's resolution contradicts D-059 in the sentence that resolves it
**Severity: medium.** (Raised as **M-11**.) F-08's response reads "model the gap
with `leftAt`" — exactly the status column D-059 forbids, and for exactly the
reason D-059 gives: a flag silently destroys the answer to "when were they a
member?". F-08 is stale text written before D-059 existed.
**Response.** D-059 wins. The domain chapter now implies nothing otherwise — no
`leftAt` appears anywhere in `01-domain-model.md`. **The F-08 text itself is in
`10-findings.md` and was not edited by this agent** — see §3 below.

### F-54 — Chapter 01 contradicted D-057 twice, in the same chapter
**Severity: medium.** (Raised as **C-14**.) §2.3 still asserted *"One table, two
module owners — planning writes it, attendance reads it… This is the only shared
table in the design and it is deliberate"*, and §3.4's Notes column repeated it,
while D-057 four sections earlier says `sessions` owns `ScheduledSession`. The
contradicted text was the part a reader trusts, because it explains itself.
**Response.** Both rewritten to "owned by `sessions`; `planning` and `attendance`
are both consumers". The paragraph defending the shared table as *deliberate* is
deleted rather than softened — it argued for a decision the design has since
reversed.

---

## 3. Hand-offs — changes this agent could not make

Ordered by how badly they leave the document set inconsistent if skipped.

1. **`10-findings.md` F-08** — its response must stop saying `leftAt` and read
   `MembershipPeriod` + `StudentLifecycleEvent` instead (F-53 above). Until then
   the findings chapter contradicts D-059.
2. **`02-security-privacy.md`** — D-068 (`SESSION` participation reach) is a hard
   dependency of D-085. Chapter 15 §3.1 states the dependency and designs
   nothing. If D-068 is dropped or reshaped, D-085 must be revisited, not
   quietly shipped.
3. **`04-ux.md` §4.4** — refers to `Certificate`; must follow the D-082 rename to
   `Award`. D-082 is only free if both names never coexist.
4. **`04-ux.md` §4.1 / `00-overview.md` product thesis** — D-086 states an
   explicit exception to the 30-second doctrine for the assessment screen. The UX
   chapter should carry the exception where the doctrine is stated, or a reader
   of chapter 04 alone will build the wrong screen.
5. **`14-backup-restore-upgrade.md` D-044** — the pre-migration backup retention
   policy (delete after next successful start, keep at most 3) is now stated in
   `01-domain-model.md` §5 but not in the chapter that owns the backup (F-49).
6. **`00-overview.md` P-03 / OD-4** — fee tracking is now specified rather than
   deferred. P-03's seam is re-affirmed by D-093, not removed; OD-4 should be
   closed against `15-assessment-and-fees.md` §6.
7. **`08-open-decisions.md`** — worth an open item for the one question this work
   could not answer: whether the school will define its own `GradeScale`, or
   whether the five NRZ values are the only scale that will ever exist. The model
   supports either; nobody has been asked.
