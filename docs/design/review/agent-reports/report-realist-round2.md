All chapters and the previous report read. Here is the revised review.

---

# Design review, round 2 — with the domain expert in the room

**Revised verdict up front.** The previous report's headline is wrong in its premise and wrong in its instruction, but roughly half-right in its arithmetic. The design is **not over-scoped by a factor of two. It is mis-scoped.** About 45% of the specified effort goes into a self-hosting *product* whose first and only operator for the next year is Jack, on his own hardware — while six capabilities the domain expert names as weekly needs are absent from the documents entirely, one of them (**aftesten**) being the single most consequential control in the whole domain: the four-eyes gate on whether a child may sit an exam. The word "aftest" does not appear once in `docs/design/`. Neither does "NRZ".

So: cut roughly what the previous reviewer said to cut — its platform cut list survives essentially intact, because **not one of Jack's six answers is about self-hosting** — and spend the recovered budget on domain, not on shipping earlier.

---

## A. Re-scoring the scope verdict

### A1. Where the previous reviewer was flatly wrong

**"Written for a customer who does not exist."** OD-2 (`08-open-decisions.md:24`) is closed, and was closed before the report was written — the product owner is a practising swim instructor at the first customer. The report's central rhetorical move ("stop designing, go stand at a poolside") is addressed to someone who is standing at the poolside every week. That instruction is void.

**"The design models the steady state and has no model for exceptions."** Half wrong for the opposite reason to the one given: it *is* the correct criticism, but it was offered as speculation and is now confirmed fact. Jack's answers 1 and 2 turn five of the thirteen rows in that report's §A3 table from "the reviewer thinks schools do this" into requirements:

| Previous report's guess | Jack's answer | Status |
|---|---|---|
| Make-up lessons (#1 gap) | Answer 1 — must be supported | **Confirmed requirement** |
| Trial lesson / proefzwemmen (#7) | Answer 1 — must be supported | **Confirmed requirement** |
| Waiting list (#6) | Answer 1 — "wachtlijsten hebben we" | **Confirmed requirement** |
| Doorstroom, moving up (#9) | Answer 2 — and *both directions* | **Confirmed, and broader than described** |
| Payment (#10) | Answer 4 — wants it tracked | **Confirmed requirement** |
| Zwem-ABC as external catalogue (#11) | Answer 3 + 6 — NRZ sets the eisen | **Confirmed, and the fix is bigger than "three columns"** |

That reviewer got the domain right by inference and then discredited its own findings by insisting nobody had checked. Its §A3 table is the most valuable page it produced.

**"`EXAM_SESSION` scope is a scope inversion / examiners work from a paper list."** Correct conclusion, wrong reasoning, and it missed the real finding underneath. See §B5 — the scope model needs a *different* mechanism, not a smaller enum.

### A2. Where it remains right — and is now more right

Jack described a domain. He described no operator, no second organisation, no IdP, no fleet. The report's platform cut list therefore stands untouched, and OD-2's closure makes it **stronger**, not weaker: previously it was possible the first customer would be a stranger self-hosting, which would have justified the setup wizard, the diagnostics page for third-party support, the IdP registry, the restore-from-every-release matrix and the release-signing pipeline. We now know the first operator is the author. Every hour spent making self-hosting pleasant for a stranger in v1 is provably speculative in a way it was not last week.

The 60–75 engineer-week estimate is directionally sound and I have no material quarrel with the line items. Adding §E's domain work takes the *unreduced* number past 70 weeks. Confirming, rather than refuting, that the current v1 definition cannot ship.

### A3. Where I refuse to capitulate

Jack's answer 1 contains a request to build for a customer who does not exist — his own words: *"houd rekening met proefzwemmen en inhaallessen **maar die hebben wij zelf niet**."* That is precisely the charge the previous reviewer levelled at the design, relocated into the product owner's own answer. Being the domain expert about how Dutch swim schools work does not make him right about what should be in *this* release.

**Verdict: take the model, refuse the workflow.**

- **Make-up lesson** — the *data* change is real and expensive to retrofit: attendance must be recordable for a student who is not in the session's group, and the receiving instructor must be able to reach them. Build the mechanism (§B5), because it is the same mechanism aftesten and substitution need. Build **no** dedicated "book a make-up slot" flow, no entitlement counter, no "you owe this child two lessons" ledger. Cost of the model: ~0. Cost of the workflow: 1.5 weeks for a school that does not use it.
- **Trial lesson** — `Enrolment.status = TRIAL` plus a `StudentLifecycleEvent` type. One enum member each. **No** lightweight-attendee entity, no shortened onboarding path, no conversion funnel. The previous report was right that §4.5's six-step onboarding is heavy for someone who may never return; it is also true that a school which doesn't run trials will never notice.

Second refusal, on billing: Jack asked for tracking. §C gives tracking and stops hard at the point where the app emits a document with an amount on it. That line will be unpopular within a term and I still recommend it.

### A4. The honest one-line re-score

> Not "cut half". **Cut the self-hosting product out of v1, add the assessment domain into it, and the net is roughly the same total size — but every week of it is now spent on something a swim instructor will touch.** v1 as revised: ~18–20 engineer-weeks (§E), against ~60–75 as specified.

---

## B. Modelling *aftesten*

### B1. The inversion worth naming first

The design has spent its entire assessment budget on the exam: D-052 (examiner without membership), D-054 (`EXAM_SESSION` scope), D-062 (0..N results), `ExamAssessor`, `Certificate`, `04-ux.md` §4.4. In the process Jack describes, **the exam is the formality and the aftest is the assessment.** A child only reaches the exam because a second qualified instructor already graded every NRZ requirement and found all of them at least *voldoende*. The exam produces PASS/FAIL and a number; the aftest produces the actual per-criterion evidence, the pedagogical remarks, and the decision that matters.

All of that granularity is currently modelled nowhere. `ExamResult.outcome` + `remarks?` (`01-domain-model.md:408`) is the only assessment detail in the schema.

### B2. Proposed entities

Proposed as **D-067 – D-071** (register ends at D-066).

**D-067 — One versioned criterion catalogue, two kinds of observation against it.**

```text
AwardType            code, name, kind ∈ {DIPLOMA, CERTIFICATE}, issuingBody ∈ {NRZ, ORG}
AssessmentScheme     awardTypeId, version, source, status ∈ {DRAFT, ACTIVE, RETIRED},
                     effectiveFrom, effectiveTo?, passFloorGradeId   ← the global "minimaal voldoende"
SchemeCriterion      schemeId, code, name, sequence,
                     minimumGradeId?   ← NULL = use scheme passFloor; set = per-criterion override
GradeScale           code                                  (ordinal, org-owned)
GradeValue           scaleId, code, rank, label
                     ONVOLDOENDE=1 · MATIG=2 · VOLDOENDE=3 · GOED=4 · ZEER_GOED=5

Assessment           type ∈ {AFTEST, EXAM}, schemeId  ← pinned FK, not a date lookup
                     studentProfileId, assessorPersonId, assessedAt,
                     scheduledSessionId?, examSessionId?,
                     outcome ∈ {PASS, FAIL}, outcomeComputedAt,
                     supersedesAssessmentId?, remark?
AssessmentCriterionResult   assessmentId, criterionId, gradeValueId, remark?
CriterionWaiver             assessmentId, criterionId, reason, grantedByPersonId  ← recorded, never silent
PersonQualification         personId, type, validFrom, validTo?   ← "een leraar die bevoegd is"
```

`SkillRequirement` (`01-domain-model.md:369`) **is** `SchemeCriterion` and must be collapsed into it — see B7(2). `SkillProgress` survives unchanged as the informal, per-lesson teaching log.

### B3. The pass rule, data-driven

One function, no award-type branch anywhere in the codebase:

```
pass(assessment) :=
  ∀ c ∈ criteria(assessment.schemeId) :
      ∃ r ∈ results(assessment, c) with rank(r.grade) ≥ rank(c.minimumGrade ?? scheme.passFloor)
      ∨ ∃ w ∈ waivers(assessment, c)
```

Jack's two statements are both satisfied by data, not code:

- *"Alles moet minimaal voldoende zijn"* → `scheme.passFloorGradeId = VOLDOENDE`, every `minimumGradeId` NULL.
- *"Certificaten hebben afgezwakte eisen"* → the certificate is a **different `AwardType` with its own `AssessmentScheme`**, whose criteria carry lower `minimumGradeId` overrides, or fewer criteria, or waivable ones. `if (kind === CERTIFICATE)` never gets written.

This is the whole trick and it is worth one nullable column: the weakening lives in rows. The alternative — a global floor plus hardcoded certificate exceptions — will be in production within a month of someone asking for a third award variant.

**Consequence for the existing schema, and it is a naming collision, not a detail.** `Certificate { resultId, number, issuedAt, revokedAt? }` (`01-domain-model.md:409`) currently means *"the physical proof of a diploma"*. In Jack's domain a **certificaat is a different award with weaker requirements than a diploma**. Two meanings, one word, and one of them is already in the schema. Rename the existing entity to `Award` or `IssuedDocument`, and let `AwardType.kind` carry the diploma/certificate distinction. This is free today and a migration through issued-diploma rows later. *(I could not verify the exact NRZ certificate rules — web search is unavailable in this session — so I am relying on Jack's statement, which is sufficient for the modelling but the specific NRZ thresholds need confirming before seeding a catalogue.)*

### B4. Versioning — pin the FK, never look up by date

`Assessment.schemeId` is a foreign key to a **specific immutable scheme version**. An `ACTIVE` scheme is never edited; editing produces version n+1 and stamps `effectiveTo` on n. Rendering a 2026 assessment joins through the pinned id and gets 2026's criteria, 2026's labels and 2026's thresholds, permanently.

Do **not** resolve the scheme by `assessedAt BETWEEN effectiveFrom AND effectiveTo`. That is the version of this pattern everyone writes first, and it breaks the moment someone backdates an entry, or the moment NRZ's revision date and the school's adoption date differ — which they always do, because a school finishes the running block under the old eisen.

This is a stronger fix than the previous report's item 13 ("add effective-from/to on requirements"). Dates alone are not enough.

### B5. The relationship to the exam — and the finding that pays for this whole review

**The gate, as a domain invariant.** An `ExamCandidate` may not reach `CONFIRMED` unless there exists a non-superseded `Assessment` where `type = AFTEST`, `schemeId` = the target award's active scheme, `outcome = PASS`, `assessorPersonId` holds a valid `PersonQualification`, **and** `assessorPersonId` is not among the `InstructorAssignment` holders for that student's group over the assessment window. Overridable only with an explicit permission and a recorded reason — because in a club with four instructors there will be a week where no independent assessor exists, and an un-overridable rule just gets worked around by logging in as someone else.

**Now the problem.** The independent assessor is *by definition* not the child's instructor and therefore holds no `GROUP` grant covering that child. Under D-030 and D-031 (`02-security-privacy.md` §2.2–2.3) they cannot read the student at all. **Aftesten does not fit the authorization model.** Neither does a substitute instructor, nor the receiving instructor of a make-up lesson, nor the visiting NRZ delegate.

**D-068 (proposed) — reach follows participation, not only group membership.** Introduce one scope type, `SESSION`, whose coverage is: *the sessions to which the holder is assigned as staff, and the students on those sessions' rosters, for a bounded window around the session time.* `ScheduledSession`, `ExamSession` and an aftest sitting are all the same shape — a time, a place, assigned staff, a roster.

One mechanism then solves four problems the design currently has zero or bad answers for:

| Problem | Current design | With `SESSION` reach |
|---|---|---|
| Aftesten by an independent instructor | Impossible — no grant | Assign as assessor → reach follows |
| Substitute instructor covering a group | Impossible without admin re-scoping | Assign to the session → reach follows |
| Make-up lesson, visiting child | Impossible — child not in group | Add to roster → reach follows |
| External examiner | `EXAM_SESSION` scope (D-054) | Same mechanism, one fewer enum member |

**This deletes D-054.** The previous report wanted `EXAM_SESSION` cut for cost reasons and would have left the examiner login case unsolved; this replaces it with a more general primitive that is *smaller* than the current scope set, because `EXAM_SESSION` disappears into it. Combined with dropping the `UNIT` tree (§E), v1 ships four scope types — `ORGANIZATION | GROUP | SESSION | SELF` — down from seven, and covers strictly more real cases than seven does today. Cutting scope types makes the security better, and this time it also makes the domain work.

### B6. Do aftest and exam share one assessment model?

**Verdict: yes at the criterion layer, no at the outcome layer.**

Share `AssessmentScheme` / `SchemeCriterion` / `Assessment` / `AssessmentCriterionResult`. Do **not** fold `ExamResult` and the award record into `Assessment`. They diverge on everything that matters downstream:

- **Retention.** Award records: 10 years where a ground applies (`01-domain-model.md:478`). Aftest detail: months. Merging forces one policy onto both and re-runs the F-06 mistake in a new place.
- **Permission and audience.** A parent disputes a diploma; nobody appeals an aftest to a lawyer. The award needs revocation and reissue (D-062 machinery); the aftest needs supersession only.
- **Erasure.** Aftest criterion remarks are pedagogical observations about a child's body and behaviour. They should erase with the student profile; award records may not.

So: `ExamResult` keeps its append-only D-062 shape and gains an optional `assessmentId` pointing at the exam-day detail. Two tables, one vocabulary.

### B7. Attacking my own proposal

1. **The aftest screen is harder than attendance, and I have just made it the second flagship.** One qualified instructor watching a group grades ~12 children × ~20 criteria = 240 ordinal values in one sitting. The design's answer to everything so far is "default the common value and make the exception the tap" (`04-ux.md` §4.1). **Do not apply it here.** Pre-filling VOLDOENDE on the assessment that decides whether a child may sit an exam manufactures rubber-stamping and destroys the four-eyes control the feature exists to provide. Verdict: default *unset*, allow set-whole-column with confirmation, accept that an aftest takes ten minutes. This is the one screen where the 30-second doctrine is actively wrong, and the design's product thesis (`00-overview.md:86`) gives no room to say so.
2. **Two catalogues will drift.** `Skill`/`SkillRequirement` (`01-domain-model.md` §3.3) already is "criteria per level, assessed per student". `SchemeCriterion` is the same thing with a grade instead of a state enum. Shipping both guarantees divergence and two seed catalogues to maintain. **Collapse: `SchemeCriterion` is the single catalogue.** `SkillProgress` stays as the informal per-lesson log referencing a criterion; `AssessmentCriterionResult` is the formal graded observation. Net effect on §E's estimate: this *saves* about a week, because the skills module shrinks rather than doubling.
3. **`PersonQualification` is a slippery slope.** "Bevoegd binnen de vereniging" in reality means a licence with a validity date, CPD requirements and a register. One table with `type`/`validFrom`/`validTo` is the correct v1 amount. If someone asks for licence renewal reminders, that is a v2 conversation, not a schema change.
4. **The remark's privacy class is unhandled.** "Kind vertoont een schaarslag" is a developmental observation about a child. D-010 gates *medical* notes behind their own permission; it says nothing about assessment remarks, which will be at least as sensitive to a parent reading them and are currently destined for a table visible to anyone with `students.read`. Attach remarks primarily at `AssessmentCriterionResult` (that is where instructors will want them), and put them behind the `students.notes.*` permission family, not the general read.
5. **Where the scheme comes from is unresolved.** `Skill` is documented as *"Defined by this organisation"* (`01-domain-model.md:368`). The NRZ eisen are not the organisation's to author. v1 should ship the NRZ-derived scheme as a **seeded, org-editable but source-labelled** catalogue (`source = NRZ`), with editing an NRZ-sourced scheme producing an org-owned fork rather than an in-place edit. Otherwise a well-meaning administrator quietly weakens a diploma requirement and nothing records that they did.

---

## C. Billing, bounded

Jack's verb is **"bijgehouden"** — tracked. Take him at his word and build a ledger, not a finance system.

### C1. The smallest thing that satisfies the ask

Three tables, one job, one screen, one export.

```text
FeeType    code, name, amount, currency, recurrence ∈ {PERIODIC, ONE_OFF}, active
Charge     payerPersonId,           ← the payer is a Person, never the child
           studentProfileId?, feeTypeId,
           periodStart?, periodEnd?, amount, dueDate,
           status ∈ {OPEN, PAID, PARTIAL, WAIVED, CANCELLED}, note?
Payment    chargeId, amount, receivedAt, method ∈ {BANK, CASH, OTHER},
           reference?, recordedByPersonId
```

- **Membership fee:** a scheduled job generates `PERIODIC` charges from active `MembershipPeriod` × active `Enrolment`. Idempotent per (payer, feeType, period) — the same `clientEventId` discipline as D-061, for the same reason.
- **Exam fee:** created **by the event** of an `ExamCandidate` reaching `CONFIRMED`, never in advance. This encodes Jack's *"dit gebeurt dus ook alleen als ze echt examen gaan doen"* as an invariant instead of a convention, and it composes with the aftest gate in §B5 — no aftest pass, no candidate, no charge.
- **Screen:** a balance view per payer and per student. *"Sanne de Vries — contributie Q3 €67,50 open · examengeld Diploma A €12,50 open."*
- **Export:** CSV of open charges and recorded payments. The treasurer keeps whatever they use now.

**On households.** Billing forces "one parent, one invoice, three children" — the previous report's item 12. **Do not build a `Household` entity.** It is a fourth identity concept alongside `Person`/`Membership`/`StudentProfile` and it will be wrong within a year (divorced parents, split payment, a grandparent paying). Group by `Charge.payerPersonId` at render time, derive the payer from `PersonRelationship(GUARDIAN_OF)` at charge creation, and let it be overridden per charge.

### C2. What must not be built in v1 — explicitly

Payment provider integration (Mollie, Stripe, iDEAL). SEPA direct debit / incasso file generation. VAT calculation. **Anything that emits a document headed "Factuur".** Sequential invoice numbering. Credit notes and refunds. Dunning and reminder automation. Ledger export to accounting software. Pro-rata credit for missed lessons.

**The line is the document.** A balance view and a CSV are internal administration. The moment the app renders a PDF with an amount and the organisation's details and sends it to a parent, it is arguably a *factuur* under Dutch rules and inherits sequential numbering, mandatory fields, BTW treatment and a seven-year retention obligation on a record the app now authored. That is not a feature; it is a second product with a compliance surface. Emit nothing.

### C3. The first real regret, named

**Reconciliation.** Not "no Mollie" — *"someone marks 180 charges PAID by hand each quarter by reading a bank statement."* That is worse than the spreadsheet they have now, and it is exactly where a tracked-billing feature gets abandoned. The specific missing piece is **CAMT.053 / MT940 import with payment-reference matching**: one upload, match on a structured reference embedded in the charge, mark the rest for manual review. It is roughly a week, it needs no payment provider, no PSD2, no bank API, and it is the difference between the feature living and dying. My verdict: it is out of the 18–20-week v1 and it is the **first thing** to add after Jack's first full billing period.

Second regret, arriving within one term: **arrears → operations.** Every school has a "no payment, no lesson" rule. Once the money is in the same database as the attendance screen, someone will ask why the class list doesn't flag it. P-03's clean seam (`00-overview.md:268`) is the right call and this decision should be re-affirmed rather than drifted through — a payment flag on the poolside screen puts a child's family finances in front of a volunteer instructor on a shared device. Keep it in the administration surface.

### C4. The cost of saying yes, stated plainly

Accepting billing has two consequences the design must absorb, and neither is free:

1. **Financial retention conflicts with person retention.** D-066 defaults person retention to 24 months after the last relationship ends. Dutch fiscal law wants administration kept seven years. `Charge`/`Payment` must be registered in the D-014 erasure registry with a *financial retention ground*, and erasure must pseudonymise the charge rather than delete it. If this is not done at the same time as the tables, the first erasure request either destroys bookkeeping or silently skips it.
2. **The breach gets more valuable.** The database now holds children's health notes *and* who owes money. It does not change the controls; it does change how loudly D-040 (encrypted backups) and D-042 (the download as an exfiltration primitive) deserve to be treated. Both are already in the keep list.

---

## D. Paper is the incumbent

Answer 5 is the most strategically important thing Jack said, and it changes the calculus in both directions.

### D1. What gets *more* serious

**1. Offline / no-fallback — now the single largest product risk, and for a reason the previous report got wrong.** It framed this as "you'll lose a lesson's data". Against a clipboard, losing a lesson's data is Tuesday. The real asymmetry is the *shape* of the failure: **paper never has a zero-percent day.** A wet sheet is still legible, a forgotten sheet is reconstructed from memory at the end of the lesson, a broken pen is replaced by another pen. An app that won't load shows nothing at all and the instructor has no move.

So the previous report's throwaway — *"the design owes a 'print tonight's class lists' button"* — is not a nice-to-have. It is **minimum viable parity with the incumbent** and belongs in the first release. P-02 ("prepared, not built") is defensible *only* if that button exists.

**2. A first-lesson failure is permanent.** When paper fails, the instructor blames the rain. When the app fails, they go back to paper and never come back. Reliability on the first three lessons is worth more than any feature in §E.

**3. The flagship constraint may be wrong for v1.** `00-overview.md:86` stakes the product thesis on real-time poolside registration in under thirty seconds. But the win Jack actually described is *"stop losing the paper"* — which is satisfied by entering attendance from the sheet, on a phone, after the lesson. Those are different first releases. **Verdict: keep the 30-second target as a design constraint** (it produces a better UI regardless) **but stop letting it justify apparatus** — specifically the shared-device machinery below. A v1 that is used post-hoc from paper is a legitimate, winning v1.

**4. The WebAuthn RP-ID lockout gets worse, not better.** `13-…` §4 notes that changing `APP_URL` invalidates every passkey. Jack will start on something like `http://nas.local:3000` and move to a real domain — that is the *expected* path for this deployment, not an edge case. v1 must set the RP ID deliberately at setup, warn loudly on change, and always retain a password + TOTP fallback per account. Cheap; currently a live trap.

### D2. What gets *less* important

**5. `SHARED_DEVICE` (D-009) — cut it.** Jack would use his phone; the preference is an iPad. A personal phone with a biometric lock is not the threat model D-009 was written for. Its four sub-behaviours (shortened timeout, PII suppression, blocked exports, **step-up to leave the attendance context**) are led by the one instructors will disable first. Replace with: a short idle timeout, and an instructor role that simply holds no export or admin permission. The previous report was right about this and Jack's answer makes it more right, not less.

**6. Step-up MFA on the pool deck — cut.** Against a clipboard, any re-authentication mid-lesson is a defect. Keep MFA at *login* for administrator roles (R-13) — that is once a week on a personal phone and entirely reasonable.

**7. Passkeys — keep, and the previous report's criticism largely evaporates.** Its objection was valid only under the shared-tablet assumption: every instructor registering a passkey on one communal iPad. On a personal phone a passkey is Face ID, which is genuinely the best wet-hands answer available and needs no typing at all. `02-security-privacy.md` §1.2's claim survives; only its framing needs correcting.

**8. RF-hostile pool hall — partly self-solving, and the fix is procurement, not engineering.** A phone has cellular. A WiFi-only iPad does not. **If the school buys an iPad, buy the cellular model.** That one sentence in the deployment documentation is worth more than a week of offline queue engineering, and it should be written down before anyone estimates offline sync.

### D3. One assumption I want flagged, because it changes a Tier-1 line item

The previous report called CSV import of the current pupil list *"what makes a pilot possible at all"*. If the school genuinely runs on pen and paper, **there may be no digital list to import.** Most clubs do keep a member ledger or an Excel somewhere for contributie, so it probably exists — but the assumption is load-bearing and unverified. If it doesn't exist, entering 100 children by hand is one evening and the import can drop out of v1 entirely. **Worth one question to Jack before it is estimated.**

---

## E. Revised v1 cut list

### E1. Out of v1 — decision retained on paper, not built

| Item | Reasoning now that OD-2 is closed |
|---|---|
| **R-15 / D-035** IdP registry | The first and only operator is Jack. No Entra, no Keycloak. Purely additive later — a registry is not structural |
| **D-047** restore-from-every-release CI matrix | Zero prior releases exist. **Keep D-048** (never squash) — a policy, costs nothing, and is what makes D-047 addable at v1.3 |
| **D-013** column encryption + **OD-7** key management | Same host holds the DB and the key. **Keep D-010** (medical behind its own permission), **keep D-040** (encrypted backups — the artefact that travels), **keep the `v1:` envelope prefix from D-049** (one day, genuinely hard to retrofit) |
| **D-054** `EXAM_SESSION` scope | **Replaced, not deleted** — subsumed by `SESSION` reach (D-068, §B5), which is strictly more capable |
| **`UNIT` tree scope** | One pool. A recursive descendant walk is the highest-risk code path in the app for a federation that does not exist |
| **D-009** `SHARED_DEVICE` | §D2(5). Idle timeout + a role with no export permission |
| **R-12 / D-017** CMS beyond a course-catalogue page + inquiry form | The school has a website. **Keep D-051** as a lint rule: `(public)` never imports person repositories |
| **D-022/D-023** UAT as a separate environment | One person is author, reviewer and acceptor. **Keep D-023's rule** — never copy production data — as free policy |
| **D-065/D-066** retention *engine* | Ship retention *constants* in one file, one scheduled job, and the D-014 erasure transaction. **Keep D-066's trigger rule** (last relationship of any kind) — it is the correct rule and costs nothing to encode as a constant |
| **R-17** settings *registry* with generated UI | A settings page for the ~15 settings that matter satisfies D-036/D-038's actual requirement |
| **P-01** `/api/v1` + OpenAPI + Swagger | `05-…` §4 already concedes it contains health/ready plus one example |
| **R-28** full 15-check blocking CI | Ship eight: format, lint, typecheck, unit, integration, E2E, migration-against-populated-DB, secret scanning |

Everything in the previous report's §B4 keep-list stays kept, unchanged. Its thirteen load-bearing decisions were correct and none of Jack's answers touches them.

### E2. Into v1 — currently absent, and needed weekly

| Item | Proposed decision | Est. | Why it cannot wait |
|---|---|---|---|
| **Aftesten**: schemes, criteria, grade scale, graded results, waivers, `PersonQualification`, the four-eyes gate | **D-067, D-069** | 2.5 w | The control that decides whether a child sits an exam. Absent entirely. Retrofitting graded criteria under a live `SkillProgress` catalogue is a migration through every child's progress |
| **Versioned schemes pinned by FK**, `AwardType {DIPLOMA, CERTIFICATE}`, rename `Certificate` → `Award` | **D-070** | (in above) | Three columns and a rename today; a migration through issued diplomas the day NRZ revises the eisen |
| **`SESSION` participation reach**, replacing `EXAM_SESSION` | **D-068** | 0.5 w net | Aftesten, substitution, make-up lessons and external examiners are one problem. Currently all four are impossible |
| **Billing-lite**: 3 tables, generation job, balance view, CSV, financial retention ground | **D-071** | 2 w | Answer 4. Without it the school keeps its existing system and does dual entry — the most common reason vertical SaaS is abandoned |
| **Waiting list**: `WaitlistEntry` + placement action from `Inquiry` | — | 1 w | Answer 1. The front door and the pipeline. Currently in "deliberately deferred" (`00-…:278`) while `EXAM_SESSION` got its own scope type |
| **Group move, both directions**, reason-carrying | — | 0.5 w | Answer 2. `GroupMembership` supports the data; the *action* and the "back down" case don't exist. `Group.courseLevelId` is already nullable — that survives, correctly |
| **Print: class list, exam candidate list** | — | 0.5 w | §D1(1) parity with paper, **and** answer 3 — the NRZ delegate needs the list *op dat moment* |
| **NRZ notification export** (candidates, DOB, award, date) | — | 0.5 w | Answer 3. A report, not an integration — Jack said so explicitly |
| **Make-up lesson & trial: model only** | — | ~0 | §A3. Enum members and a roster that accepts a non-member. No workflows |

**On the NRZ delegate specifically:** do not build a guest login, a share link or a read-only visitor account. A printed candidate list — name, date of birth, award type, date — handed to the delegate at the pool is what the situation actually calls for, involves no stranger touching a device holding children's records, and takes half a day. This is one place where the low-tech answer is not a compromise.

### E3. The revised v1, in one block

**~18–20 engineer-weeks.** Running on Jack's own hardware, at Jack's own school, replacing paper.

Template extraction with tenant strip · local auth + MFA + passkeys · four scope types (`ORGANIZATION | GROUP | SESSION | SELF`) with `resolveReach` as a required repository argument and scope-escape tests per module (D-030/D-031/D-032, undiminished) · people · students · groups · courses/levels · sessions with recurrence and holiday exceptions · attendance (D-005/D-061 intact) · **one versioned criterion catalogue with informal progress and formal graded assessment** · **aftesten with the four-eyes gate** · exams-lite with the award record and the NRZ export · **billing-lite** · **waiting list** · group moves both ways · print fallbacks · setup wizard + boot state machine (D-055) + pre-migration backup (D-044) + encrypted backup and recovery token (D-040) + restore-then-migrate (D-046) · a plain settings page · diagnostics · break-glass CLI · erasure transaction with the registry test (D-014) and hardcoded retention · public course catalogue + inquiry form + branding tokens · eight CI checks · image, compose file, install docs, licence.

**Compared to the previous report's Tier 1 (12–14 weeks):** +2.5 aftesten, +2 billing, +1 waitlist, +1 the rest, −1 from collapsing the two skill catalogues (§B7.2). Net ≈ +5.5 weeks, for a release the domain expert can actually run his school on instead of one he runs alongside his existing admin.

---

## Residual disagreements with the product owner, stated rather than smoothed

1. **Proefzwemmen and inhaallessen are gold-plating for v1** by his own admission — his school does not do them. Model, don't build. (§A3)
2. **Billing stops at the balance view.** No document with an amount on it leaves the system in v1, and reconciliation — the thing that decides whether the feature survives contact with a real quarter — is deliberately not in the first release. (§C2, §C3)
3. **The aftest screen must not inherit the 30-second doctrine.** Defaulting criteria to a passing grade would make the four-eyes control ceremonial. (§B7.1)
4. **If the iPad is bought, buy cellular** — cheaper and more effective than the offline engineering it displaces. (§D2.8)
5. **One open question worth asking before estimating:** does a digital pupil list exist anywhere (Excel, a ledger, the prototype DB), or is the import path importing nothing? (§D3)