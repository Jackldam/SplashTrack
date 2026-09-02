# 15 — Assessment (*Aftesten*), Awards and Fees

> Added 2026-09-01, after the product owner — himself a practising swim
> instructor — described the process the design had modelled the wrong end of:
> *"een andere leraar die bevoegd is binnen de vereniging test mijn leerlingen af
> en bepaalt of ze examen mogen zwemmen of niet."*

## 1. What this chapter fixes

The design spent its entire assessment budget on the exam: D-052 (examiner
without membership), D-054 (`EXAM_SESSION` scope), D-062 (0..N results),
`ExamAssessor`, `Certificate`, `04-ux.md` §4.4. In the process actually used,
**the exam is the formality and the *aftest* is the assessment.** A child
reaches the exam only because a *second, qualified* instructor — not their own —
has already graded every requirement and found all of them at least
*voldoende*. The exam then produces PASS/FAIL and a number.

The word *aftest* did not appear once in `docs/design/`. Neither did *NRZ*.
That is the gap this chapter closes, together with the second thing the product
owner asked for and the design had deferred without deciding: **keeping track of
money** (`00-overview.md` P-03, OD-4).

Two things this chapter is careful not to do. It does not turn assessment into a
qualifications platform, and it does not turn fee tracking into accounting
software. Both boundaries are stated explicitly and defended, because both are
the kind that erode by accident.

---

## 2. The assessment model

### 2.1 Entities

```text
AwardType            code, name, kind ∈ {DIPLOMA, CERTIFICATE},
                     issuingBody ∈ {NRZ, ORG}

AssessmentScheme     awardTypeId, version, source, status ∈ {DRAFT, ACTIVE, RETIRED},
                     effectiveFrom, effectiveTo?, passFloorGradeId

SchemeCriterion      schemeId, code, name, sequence,
                     minimumGradeId?      ← NULL = use the scheme's pass floor;
                                            set = a per-criterion override

GradeScale           code, name                                (ordinal, org-owned)
GradeValue           scaleId, code, rank, label
                     ONVOLDOENDE=1 · MATIG=2 · VOLDOENDE=3 · GOED=4 · ZEER_GOED=5

Assessment           type ∈ {AFTEST, EXAM}, schemeId,
                     studentProfileId, assessorPersonId, assessedAt,
                     scheduledSessionId?, examSessionId?,
                     outcome ∈ {PASS, FAIL}, outcomeComputedAt,
                     supersedesAssessmentId?, remark?

AssessmentCriterionResult    assessmentId, criterionId, gradeValueId, remark?

CriterionWaiver              assessmentId, criterionId, reason, grantedByPersonId

PersonQualification          personId, type, validFrom, validTo?
```

`PersonQualification` is the model of *"een leraar die **bevoegd** is binnen de
vereniging"*. In reality a swimming qualification is a licence with renewal
requirements and a national register; one table with a type and two dates is the
correct v1 amount of it. Renewal reminders are a later conversation, not a later
schema.

`CriterionWaiver` exists so that "we let this one go" is a **row with a name and
a reason on it**, never an absence of a row. A pass computed over missing data
and a pass computed over an explicit waiver look identical afterwards unless the
waiver is recorded, and the second is defensible while the first is not.

`Assessment` is append-only in the same shape as attendance (D-061) and exam
results (D-062): a re-assessment writes a new row carrying
`supersedesAssessmentId`, and the effective assessment is the latest row nothing
supersedes. One derivation pattern across the product, not four.

### 2.2 The pass rule is data, not code

**Decision D-080 — There is one pass function, evaluated over scheme data. No
award type is branched on anywhere in the codebase.**

```text
pass(assessment) :=
  ∀ c ∈ criteria(assessment.schemeId) :
      ∃ r ∈ results(assessment, c) with rank(r.grade) ≥ rank(c.minimumGrade ?? scheme.passFloor)
      ∨ ∃ w ∈ waivers(assessment, c)
```

Both of the domain expert's statements about thresholds are satisfied by rows:

- *"Alles moet minimaal voldoende zijn"* → `scheme.passFloorGradeId = VOLDOENDE`,
  every `SchemeCriterion.minimumGradeId` NULL.
- *"Certificaten hebben afgezwakte eisen"* → the certificate is a **different
  `AwardType`, with its own `AssessmentScheme`**, whose criteria carry lower
  `minimumGradeId` overrides, or fewer criteria, or waivable ones.

`if (kind === CERTIFICATE)` therefore never gets written.

**Reason.** The obvious alternative — one global floor plus exceptions expressed
in code — survives exactly until someone asks for a third award variant, and
every Dutch swim school eventually has one: a house certificate, a survival
badge, a school-specific level between two diplomas. At that point the exceptions
are load-bearing, they are in the pass function, and they are untested for the
combination nobody anticipated. Putting the weakening in rows costs one nullable
column and makes the third variant an afternoon of data entry.

**Trade-off.** The rule is no longer readable from the code alone; answering
"why did this child pass?" means reading the scheme as well as the function. The
assessment screen therefore renders the effective threshold next to each
criterion, which is what an assessor needs to see anyway.

### 2.3 Versioning: pin the foreign key, never look up by date

**Decision D-081 — `Assessment.schemeId` references a specific, immutable scheme
version. The scheme is never resolved from the assessment date.**

An `ACTIVE` scheme is never edited. Editing produces version *n+1* in `DRAFT`,
and activating it stamps `effectiveTo` on version *n* and retires it. Rendering a
2026 assessment joins through the pinned id and gets 2026's criteria, 2026's
labels and 2026's thresholds — permanently, and without a temporal query.

Explicitly rejected: resolving the scheme with
`assessedAt BETWEEN effectiveFrom AND effectiveTo`.

**Reason.** The date lookup is the version of this pattern everyone writes first,
and it has two failure modes that both occur. It breaks on **backdated entries** —
an assessment typed in on Monday for the Saturday before an activation reads the
wrong scheme. And it breaks whenever **the NRZ revision date and the school's
adoption date differ**, which they always do, because a school finishes the
running block under the old requirements and adopts the new ones with the next
intake. `effectiveFrom`/`effectiveTo` stay on the scheme as documentation of when
it was in use; nothing joins through them.

**Trade-off.** One more foreign key, and a scheme version can never be corrected
in place — a typo in a criterion name requires a new version. Accepted: that is
the same property that makes the record reconstructable, and a criterion name is
not worth a mutable catalogue.

### 2.4 A naming collision, fixed while it is still free

`Certificate {resultId, number, issuedAt, revokedAt?}` (`01-domain-model.md`
§3.5) means *"the physical proof of a diploma"*. In this domain a **certificaat
is a different award with weaker requirements than a diploma** — a distinct
thing a child can be assessed for. Two meanings, one word, and one of them is
already in the schema.

**Decision D-082 — The existing `Certificate` entity is renamed `Award`, and the
diploma/certificate distinction is carried by `AwardType.kind`.**

`Award` keeps its D-062 behaviour unchanged: issued against a *specific* result,
revoked and reissued rather than edited.

**Reason.** The collision is currently a rename in a design document. After the
first release it is a migration through every issued diploma row, in the table
whose history the product exists to preserve.

**Trade-off.** "Award" is a less familiar word to a Dutch administrator than
"certificaat". The UI label is not the table name; the model gets the unambiguous
term and the interface keeps saying *diploma* and *certificaat*, correctly, for
the two `AwardType.kind` values.

### 2.5 Where the scheme comes from

`Skill` is documented as *"Defined by this organisation"* (`01-domain-model.md`
§3.3). The NRZ requirements are not the organisation's to author.

**Decision D-083 — NRZ-derived schemes ship seeded and source-labelled
(`source = NRZ`). They are org-editable, but editing one produces an org-owned
fork rather than an in-place change.**

The fork is a new `AssessmentScheme` with `source = ORG`, carrying a reference to
the NRZ version it was derived from. The NRZ-sourced version stays intact and
retired.

**Reason.** Without the fork, a well-meaning administrator lowering one threshold
quietly weakens a national diploma requirement, and nothing in the database
records that the school is no longer assessing to the NRZ standard. With the
fork, the divergence is a visible object with an owner.

**Trade-off.** More scheme rows, and a school that legitimately wants to track a
minor NRZ correction has to adopt a new version rather than patch one. That is
the correct direction of friction.

**Not yet verified, and blocking.** The concrete NRZ criteria, their codes and
their thresholds are **not confirmed**. Everything above is the shape of the
catalogue, not its contents. **No catalogue may be seeded until the criteria are
confirmed with the domain expert**, and a seed containing invented swimming
requirements would be worse than an empty one — it would look authoritative.
Recorded as **F-44**.

### 2.6 One criterion catalogue, not two

`SkillRequirement` (`01-domain-model.md` §3.3) already is *"criteria per level,
assessed per student"*. `SchemeCriterion` is the same thing with an ordinal grade
instead of a four-state enum. Shipping both guarantees divergence and two seed
catalogues to maintain.

**Decision D-084 — `SchemeCriterion` is the single criterion catalogue.
`SkillRequirement` is collapsed into it and removed.**

What survives, and how the three now relate:

| Concept | Entity | Nature |
|---|---|---|
| The catalogue of what is required | `SchemeCriterion` | Versioned, source-labelled (D-081, D-083) |
| The informal teaching log | `SkillProgress` | Per-lesson, append-only, references a criterion. Unchanged in behaviour |
| The formal graded observation | `AssessmentCriterionResult` | Belongs to an `Assessment`, carries a `GradeValue` |

`Skill` and `SkillCatalogue` are absorbed: a criterion *is* the skill, and the
scheme *is* the catalogue. `CourseLevel` keeps its sequence and gains an optional
`awardTypeId` so a level can point at what it prepares for.

**Reason.** Two catalogues covering the same domain concept diverge — not
because anyone decides to diverge, but because a criterion gets added to the one
the current screen writes. Then "what does Diploma A require?" has two answers.

**This reduces scope rather than adding it.** The `skills` module shrinks: one
catalogue to seed, one to import and export, one to render. The assessment work
in this chapter is partly paid for by the deletion.

**Trade-off.** `SkillProgress` rows now reference a versioned criterion, so an
informal progress note taken under scheme version 3 renders against version 3's
criterion name. That is correct and it is the same pin as D-081.

---

## 3. The four-eyes gate

This is the control the whole chapter exists for, and it is a domain invariant,
not a UI check.

**Decision D-085 — An `ExamCandidate` may not reach `CONFIRMED` without a passed,
independent *aftest*.**

Formally, `CONFIRMED` requires a non-superseded `Assessment` where:

- `type = AFTEST`;
- `schemeId` = the active scheme of the target `AwardType`;
- `outcome = PASS`;
- `assessorPersonId` holds a `PersonQualification` valid at `assessedAt`; **and**
- `assessorPersonId` is **not** among the `InstructorAssignment` holders for that
  student's group over the assessment window.

**Overridable — deliberately.** A person holding an explicit override permission
may confirm a candidate without a qualifying aftest, and the override records who
did it and why, as an audited event.

**Reason for the gate.** This is what the domain expert described: a different
qualified instructor decides whether a child may sit the exam. It is a four-eyes
control on a decision that costs a family an exam fee and a child a disappointing
Saturday, and it is currently enforced by nothing but habit and a clipboard.

**Reason for the override, which matters as much.** In a club with four
instructors there will be a week when no independent qualified assessor is
available. An un-overridable rule does not produce four eyes in that week; it
produces someone logging in as a colleague, and then the control is gone *and*
the audit trail is a lie. A recorded override keeps both: the exception is
visible, attributable and countable, and if it is being used every week that is
itself the finding. This is the difference between a control and a nuisance.

**Trade-off.** Confirmation is now a rule with a bypass, so the gate's real
strength is reporting rather than prevention. Accepted: an override rate is a
number a chair can act on; a workaround is not.

### 3.1 The authorization dependency — owned elsewhere

The independent assessor is, by definition, not the child's instructor, and
therefore holds no `GROUP` grant covering that child. Under D-030 and D-031
(`02-security-privacy.md` §2.2–2.3) this would leave them unable to read the
student at all, and the gate above unimplementable — the reason this chapter
originally recorded a hard dependency here.

**Resolved.** `02-security-privacy.md` §2.1–2.2 decides **D-068**: `SESSION`
participation reach — reach follows assignment to a session and its roster, for
a bounded window — replacing the `EXAM_SESSION` scope of D-054. The same
mechanism covers the substitute instructor, the make-up lesson and the
external examiner. D-085 is implementable.

That chapter owns the decision; this chapter only records that the assessment
model depended on it.

---

## 4. The aftest screen does not inherit the thirty-second doctrine

**Decision D-086 — On the assessment screen every criterion starts *unset*.
Nothing is pre-filled with a passing grade.**

One assessor grades roughly twelve children against roughly twenty criteria in a
sitting — about 240 ordinal values. Every instinct the design has developed so
far says: default the common value, make the exception the tap
(`04-ux.md` §4.1). That instinct is correct for attendance and **actively wrong
here.**

Pre-filling *voldoende* on the assessment that decides whether a child may sit an
exam manufactures rubber-stamping. The four-eyes control in D-085 exists to
produce a second, independent judgement; a screen that arrives already agreeing
with the first one produces a signature instead. The feature would then cost two
and a half weeks and provide the *appearance* of the control it was built to
provide, which is worse than not building it.

What is allowed: setting a whole column at once (all twelve children on one
criterion) behind an explicit confirmation, keyboard and swipe entry, and
per-criterion progress so an interrupted aftest resumes. What is not allowed: a
default grade, a "mark all voldoende" button without confirmation, and an outcome
computed over unset criteria.

**This contradicts the product thesis** in `00-overview.md`, which stakes the
design on registering a whole group in under thirty seconds. The thesis is about
the *poolside operational moment* — attendance, a skill sign-off, a wet tablet.
An aftest is not that moment: it is a scheduled, deliberate act by a qualified
person whose entire value is that they looked. **An aftest takes ten minutes and
that is the correct number.** The thesis is a constraint on the operational
screens, not a licence to make every screen fast.

**Trade-off.** The slowest screen in the product, and the one most likely to
attract "can't you just default these?" from the people using it. The answer is
in this section and should be given, not softened.

---

## 5. Assessment remarks are notes, not general student data

The remarks the domain expert described are pedagogical observations about a
child's body and movement — *"kind vertoont een schaarslag"* — recorded because
they say what to work on, not because they decide the outcome. A child with a
scissor kick and sufficient propulsion (*stuwing*) passes; the remark still gets
written, because the next instructor needs it.

**Decision D-087 — Assessment remarks sit behind the notes permission family
(`students.notes.read` / `students.notes.write`), not general `students.read`.
They attach primarily at `AssessmentCriterionResult`.**

**Reason.** D-010 gates medical notes behind their own permission and says
nothing about assessment remarks, which are at least as sensitive to a parent
reading them. "Your child swims like this" is a developmental observation about a
minor's body and behaviour; the fact that it is written by an instructor rather
than a nurse does not change who should be able to read it.

Attaching at the criterion result, rather than only at the assessment, is where
instructors will write anyway — the remark is *about* the scissor kick, not about
the sitting — and it keeps the remark next to the grade it explains.

**Trade-off.** A permission check on a field inside a screen that is otherwise
readable, and an assessor without the notes permission sees grades without the
reasoning. Correct: an assessor who may not read notes may not read notes.

---

## 6. Fees — tracking, not invoicing

> *"Facturatie en betalingen zou handig zijn als dat ook door deze app kan worden
> **bijgehouden**. Je hebt de lidmaatschap kosten en indien een leerling klaar is
> voor examen zwemmen dan dienen ze voor het examen los te betalen. Dit gebeurt
> dus ook alleen als ze echt examen gaan doen."*

The verb is **bijgehouden** — tracked. This section builds a ledger and stops
hard, at a line stated in §6.5.

### 6.1 Entities

**Decision D-088 — Fee tracking is three tables, one scheduled job, one screen
and one export.**

```text
FeeType    code, name, amount, currency,
           recurrence ∈ {PERIODIC, ONE_OFF}, active

Charge     payerPersonId,            ← the payer is a Person, never the child
           studentProfileId?, feeTypeId,
           periodStart?, periodEnd?, amount, dueDate,
           status ∈ {OPEN, PAID, PARTIAL, WAIVED, CANCELLED}, note?

Payment    chargeId, amount, receivedAt,
           method ∈ {BANK, CASH, OTHER}, reference?, recordedByPersonId
```

`Charge.amount` is copied from the `FeeType` at creation, not joined at read
time: changing next year's contribution must not silently restate last year's
open charges.

`studentProfileId` is optional because a membership fee can be owed by an adult
member who is not a student, and an exam fee is always about a specific child.

**Screen.** A balance view per payer and per student —
*"Sanne de Vries — contributie Q3 €67,50 open · examengeld Diploma A €12,50
open."* **Export.** A CSV of open charges and recorded payments; the treasurer
keeps whatever tool they already use.

### 6.2 Membership fees

A scheduled job in the existing `maintenance` runner generates `PERIODIC` charges
from active `MembershipPeriod` × active `Enrolment`. It is **idempotent per
(payer, feeType, period)**, using the same `clientEventId` discipline as D-061
and for the same reason: a job that runs twice, a retry, and a manual re-run must
all collapse to one charge. Double-billing a parent is the fastest way to lose
the feature.

**Conditional on OD-18, raised 2026-09-02.** The club runs a commercial
membership administration system (OD-16). If it stays authoritative for
membership, this subsection does not ship: `Membership` and `MembershipPeriod`
become a read-only projection of that system and periodic contribution charges
are its job, not SplashTrack's — generating them here would be a second home for
a fact that already has one, and reconciliation between the two is precisely
what §6.6 keeps out of v1. **§6.3 (exam fees) is unaffected either way**: an exam
fee is created by an event that happens only inside SplashTrack, and no
membership system knows about it.

### 6.3 The exam fee is created by an event, never in advance

**Decision D-089 — An exam fee `Charge` is created by the event of an
`ExamCandidate` reaching `CONFIRMED`, and at no other time.**

**Reason.** This encodes *"dit gebeurt dus ook alleen als ze echt examen gaan
doen"* as an invariant rather than a convention someone has to remember. It also
composes exactly with §3: no independent aftest pass → no confirmed candidate →
no charge. The rule that protects the child from an exam they are not ready for
is the same rule that protects the family from a fee they do not owe.

**Trade-off.** Cancelling a confirmed candidacy must cancel or waive the charge
rather than delete it, so a withdrawn candidate leaves a `CANCELLED` row behind.
That is the correct trace.

### 6.4 No `Household` entity

**Decision D-090 — There is no `Household`. Charges group by
`Charge.payerPersonId` at render time.**

The payer is derived from `PersonRelationship(GUARDIAN_OF)` at charge creation
and stored on the charge, with a per-charge override.

**Reason.** "One parent, one bill, three children" is a real need and a household
table is the obvious answer to it, but a household is a **fourth identity
concept** alongside `Person`, `Membership` and `StudentProfile` (D-004), and it
is wrong within a year in ways that are painful to unpick: divorced parents,
split payment between two addresses, a grandparent who pays for one child only, a
family that shares an address but not a wallet. Grouping at render time gets the
same screen and never has to be corrected — and storing the payer *on the charge*
means a later change of payer does not restate history.

**Trade-off.** No place to hang a household-level discount, and "the family
overview" is a query rather than a row. If a genuine household-level need appears,
it can be added over the top of charges that already record who owed what.

### 6.5 The line: nothing that emits a document headed *Factuur*

**Decision D-091 — v1 emits no invoice. Out of scope, explicitly: payment
providers (Mollie, Stripe, iDEAL), SEPA incasso file generation, VAT
calculation, sequential invoice numbering, credit notes and refunds, dunning and
reminder automation, accounting-package export, pro-rata credit for missed
lessons — and any rendered document headed *Factuur*.**

**The line is the document, and that is why it is drawn there.** A balance view
and a CSV are internal administration: the organisation looking at its own
records. The moment the application renders a PDF carrying an amount, the
organisation's details and a parent's name, and sends it, that document is
arguably a *factuur* under Dutch rules — and it inherits sequential numbering
without gaps, mandatory fields, BTW treatment, credit-note handling for
corrections, and a seven-year obligation on a record the application now
*authored* rather than merely tracked. That is not a feature added to this
chapter; it is a second product with its own compliance surface, and it cannot be
half-built. A ledger that is wrong is an administrative annoyance. An invoice
that is wrong is a filing.

**Trade-off.** The treasurer still produces the actual invoices somewhere else,
from the CSV. This will be unpopular within a term and it is still the right
place to stop.

### 6.6 The first regret, named in advance: reconciliation

The thing that will make this feature fail is not the absence of Mollie. It is
that **someone marks 180 charges `PAID` by hand each quarter, reading a bank
statement in another window.** That is worse than the spreadsheet the school has
today, and it is precisely where a tracked-billing feature gets quietly
abandoned.

The specific missing piece is **CAMT.053 / MT940 import with reference
matching**: one uploaded bank file, automatic matching on a structured reference
embedded in the charge, the remainder queued for manual review. It needs no
payment provider, no PSD2 and no bank API, and it is roughly a week of work.

It is **out of v1 and it is the first thing added after the first full billing
period.** Naming it here is not a promise; it is so that when the first quarter
is painful, the answer is already identified rather than being rediscovered as an
argument for a payment provider.

### 6.7 Two costs of saying yes, both absorbed here

**1. Financial retention conflicts with person retention.**

**Decision D-092 — `Charge` and `Payment` are registered in the D-014 erasure
registry with a *financial retention ground*, and erasure **pseudonymises** the
charge rather than deleting it.**

D-066 defaults person retention to 24 months after the last relationship ends.
Dutch fiscal law wants administration kept for seven years. Both are right, and
they collide on the same rows. Pseudonymisation — the charge keeps its amount,
date, fee type and period, and loses the link to the person — satisfies the
bookkeeping need without holding a name. Following D-065's honesty rule, a
pseudonymised charge is **still personal data** while the person exists elsewhere;
what it is not is a reason to keep the person.

Without this, the first erasure request either destroys the bookkeeping or
silently skips it, and nobody finds out which until an accountant asks. The
retention rows for `Charge` and `Payment` are added to `01-domain-model.md` §5.

**2. The breach becomes more valuable.** The database now holds children's health
notes *and* who owes money. This does not change any control — D-040 (encrypted
backups) and D-042 (the export as an exfiltration primitive) were already the
right answers — but it does change how seriously they deserve to be taken, and it
should be said out loud when the money tables land rather than discovered in an
incident report. Recorded as **F-47**.

### 6.8 P-03's seam, re-affirmed rather than drifted through

**Decision D-093 — Arrears never appear on the poolside surface.**

`Enrolment.status` remains a lifecycle, never a payment state
(`00-overview.md` P-03). Every school has an unwritten "no payment, no lesson"
rule, and once the money is in the same database as the class list, someone will
ask why the class list does not flag it.

**Reason.** It would put a family's finances in front of a volunteer instructor,
on a shared device, at the poolside, in front of the child. That the data is
available is not an argument that it should be shown there. Arrears live in the
administration surface, where the person who is allowed to act on them works.

**Trade-off.** An administrator who wants an instructor to quietly chase a parent
cannot use the app to do it. That is the intended outcome.

---

## 7. NRZ notification: a report, not an integration

The organisation must tell the NRZ who is swimming for which diploma and when.
Sometimes a delegate attends and needs to see the candidate list *at that
moment*.

**Decision D-094 — NRZ notification is an export — candidates, date of birth,
award type, date — and the visiting delegate receives a printed list.**

No integration: the domain expert said so explicitly, and an integration with a
national body is a contract, a schema owned by someone else, and a support
obligation, in exchange for saving one file upload a term.

**No guest login, no share link, no read-only visitor account for the delegate.**
A printed candidate list, handed over at the pool and taken away or destroyed, is
what the situation actually calls for. It involves no stranger touching a device
holding children's records, no account lifecycle, no expiry logic, no scope type,
and no question about what else that account could reach. It takes about half a
day to build.

**The low-tech answer is not a compromise here — it is the better design.** The
temptation is to read "the delegate needs access" as "the delegate needs an
account"; the requirement is that a person standing next to the pool can read
twelve names, and paper does that with a smaller attack surface than anything
this application could offer. This is also the same printed-list capability the
design owes as its paper fallback: a class list that prints is minimum parity
with the clipboard being replaced.

**Trade-off.** A printed list cannot be revoked once handed over. Neither can a
photograph of a screen, and the printed list at least does not persist a
credential.

---

## 8. What this chapter deliberately does not contain

| Not built | Why |
|---|---|
| Qualification renewal reminders, CPD tracking, a licence register | `PersonQualification` records validity. The rest is a v2 conversation, not a schema change |
| An appeals workflow for an aftest | Supersession covers a re-assessment. Nobody appeals an aftest to a lawyer; the award is where dispute machinery belongs (D-062) |
| Merging `ExamResult` into `Assessment` | They diverge on retention (years versus months), audience, revocation and erasure. `ExamResult` gains an optional `assessmentId` pointing at the exam-day detail. Two tables, one vocabulary |
| Any invoice, payment provider or bank integration | §6.5 |
| Bank reconciliation | §6.6 — first addition after v1, deliberately not in it |
| A `Household` | §6.4 |
| An NRZ API client or a delegate account | §7 |

---

## 9. Dependencies and open items

1. **(Resolved) D-085 depended on `SESSION` participation reach.** Decided as
   **D-068** in `02-security-privacy.md` §2.1–2.2 — no longer proposed. The
   four-eyes gate is implementable.
2. **No scheme catalogue may be seeded until the NRZ criteria and thresholds are
   confirmed with the domain expert** (§2.5, F-44). Still open — a question for
   Jack, not an architecture decision.
3. **(Resolved) The `Certificate` → `Award` rename (D-082)** is applied
   throughout `01-domain-model.md` and `04-ux.md` — neither chapter uses
   `Certificate` as an entity name any longer.
4. **(Resolved) D-086's exception to the thirty-second doctrine** is now stated
   both here and where the doctrine itself lives: `04-ux.md` §4.7 and the
   product-thesis qualification in `00-overview.md` §1.
5. **(Open — OD-17, `08-open-decisions.md`)** The grade scale is assumed to be
   the five ordinal values given. Whether a school may ever define its own
   scale is supported by the model (`GradeScale` is org-owned) and unasked as a
   requirement.
