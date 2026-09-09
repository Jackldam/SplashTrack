# rev7 — Independent consistency review

**Reviewer:** consistency agent, round 7 (independent verification of the fixes
made after rounds 1–6).
**Scope:** `docs/design/00..10`, `13`, `14`, `15`. Chapters 11 and 12 are
history and are excluded except where an active chapter depends on them.
**Base:** branch `design/architecture-phase`, HEAD `29a0021`.
**Lens:** internal consistency only — contradictions, duplicated normative
statements (D-134), dangling or wrong identifiers, decisions cited as live after
withdrawal. Security, domain realism and buildability are other agents' lenses.

Findings are appended in the order they were found, not in severity order. The
summary at the end ranks them.

---

## Findings

### C-1 — D-150 and D-158 state different hard ceilings for the absolute session lifetime

**Severity: high.**

Side A — `02-security-privacy.md` §4.1, the D-150 classification table, `bounded` row:

> | `bounded` | Editable within a hard floor/ceiling enforced by the setting's own schema, which `settings:reset` also respects | session idle ≤ 8 h **and absolute ≤ 12 h**; rate limits ≥ a stated minimum; audit retention ≥ 12 months (§3.2); … |

Side B — `09-decision-register.md`, D-158 (added today, 29a0021):

> Session idle and absolute timeouts are role-scoped `bounded` settings,
> administrator-editable at runtime with no restart. Defaults: idle 30 min
> (instructor), 15 min (administrator), **absolute 12 h; ceilings 8 h idle,
> 24 h absolute**

and `08-open-decisions.md` OD-6, the closure table:

> | Absolute session lifetime | 12 h | `bounded` | **≤ 24 h** |

**Why it matters.** Both statements are normative and both describe the same
field in the same settings schema. Under D-150 the absolute lifetime's ceiling
*equals its default* (12 h), which makes it a `bounded` setting that cannot
actually be raised — functionally an invariant. Under D-158/OD-6 an
administrator may raise it to 24 h. An implementer writing the settings registry
schema encodes one number and it is a security bound, so the wrong choice is
either a control that is weaker than the security chapter intends or a setting
the operator cannot use for the reason it was made editable. D-158's own "Where"
column points at `02-security-privacy.md` §4.1 (D-150) as the place this lands —
so it points at the text that disagrees with it. This is precisely the D-037
shape (one rule stated normatively in two places, the copies disagreeing) that
the previous round found and that the repair pass did not eliminate.

**Recommended resolution.** Pick the ceiling once. If 24 h is intended, edit the
D-150 table's `bounded` example to read "session idle ≤ 8 h, absolute ≤ 24 h" —
or better, replace the concrete numbers in D-150's table with a pointer
("session timeouts — see D-158") so the ceiling is stated once, in D-158, and
D-150 keeps only the classification. If 12 h is intended, correct D-158 and
OD-6's table together.

---

### C-2 — `02-security-privacy.md` §1.2 still presents the timeout values as an unresolved proposal and cites OD-6 as open

**Severity: high.**

Side A — `02-security-privacy.md` §1.2 (Authentication), unchanged by 29a0021:

> - Defined **idle and absolute** session timeouts. For SplashTrack the idle
>   timeout matters unusually much: tablets are shared at the poolside and left
>   unlocked. **Proposal: idle 30 min for instructor roles, 15 min for admin
>   roles, absolute 12 h. See open decision OD-6.**

Side B — `08-open-decisions.md` OD-6 heading and answer:

> ### OD-6 — **(CLOSED 2026-09-02)** Session timeout values.
> **Answer, from Jack: the proposed defaults are accepted, and they must be an
> administrator-changeable setting rather than a constant.**

**Why it matters.** Two defects in one paragraph, both today's.
(a) *Stale reference*: OD-6 is closed; chapter 02 is the chapter an implementer
of authentication reads, and it tells them the numbers are a proposal awaiting a
decision that has in fact been made.
(b) *Substantive*: the review brief for this round asks specifically whether
anything still "treats session timeouts as constants". This paragraph does. It
lists three fixed values with no mention that they are defaults of
administrator-editable, role-scoped `bounded` settings (D-158). Chapter 02
§1.3 has the same gap in smaller form — "A **short idle timeout** for instructor
sessions (OD-6), applied by role" — again citing OD-6 as if live.
Additionally this paragraph is a third normative copy of the same three numbers
(alongside OD-6's table and D-158), which D-134 forbids.

**Recommended resolution.** Replace §1.2's proposal bullet with a pointer:
timeouts are role-scoped `bounded` settings, values and bounds stated once in
D-158. Change §1.3's "(OD-6)" to "(D-158)". Do not restate the numbers in
chapter 02.

---
### C-3 — `AFTEST` is a Dutch-derived schema enum value, which D-159 forbids "without exception"

**Severity: high.**

Side A — `09-decision-register.md`, D-159 (added today, 29a0021):

> Schema identifiers, column names, API field names and code are English
> **without exception**. `docs/glossary.md` fixes one English identifier per
> domain concept, with the Dutch term beside it, before the first domain module
> is written.

and its own trade-off column names the term explicitly:

> `afzwemmen`, **`aftesten`**, `lesuur` and `baan` lose their exact Dutch sense
> in the schema; the glossary carries the definition instead.

Side B — `15-assessment-and-fees.md` §2 (the entity sketch, line 49):

> `Assessment           type ∈ {AFTEST, EXAM}, schemeId,`

restated at §3 (line 238) as a normative gate condition:

> - `type = AFTEST`;

and load-bearing in `09-decision-register.md` D-085:

> An `ExamCandidate` may not reach `CONFIRMED` without a non-superseded
> **`AFTEST`** `Assessment` with `outcome = PASS` …

**Why it matters.** This is not prose — D-159 explicitly exempts prose and
explicitly does not exempt enum values ("schema identifiers … without
exception"). `AFTEST` is an enum member of `Assessment.type`, i.e. a value
persisted in a column. An implementer building chapter 15 hits a direct
conflict on their first schema file: follow D-159 and the identifier in D-085,
§2 and §3 no longer exists; follow chapter 15 and D-159 is violated on the day
it was written. Because the term is *the* four-eyes control's discriminator
(D-085), a silent rename by whoever writes the module first will decouple the
register from the chapter.

Note that D-159 is not obviously wrong here — it says the glossary should carry
`aftesten`, and OD-10 §2 maps `aftesten` → "the independent pre-exam
assessment". What is missing is the English identifier D-159 requires. The
design set never states one.

**Recommended resolution.** Either (a) fix the English identifier now, in the
glossary D-159 mandates, and update `15-…` §2/§3 and D-085 in the same change,
or (b) add an explicit, register-recorded exception to D-159 for `AFTEST` and
drop the words "without exception". Do not leave both statements standing.

---

### C-4 — D-161's obligation exists only in the register; the two sections it names say nothing about it, and `00-overview.md` still frames the guardian portal as merely deferred

**Severity: medium.**

Side A — `09-decision-register.md`, D-161 (added today), "Where" column:

> `02-security-privacy.md` §2.2/§2.3, `01-domain-model.md` §5

with the decision text:

> The guardian portal is committed to v2. v1 removes `RELATED` from the scope
> enum as decided, and **additionally may not foreclose the axis: no v1 decision
> may assume staff are the only readers of a student's record**

Side B — commit 29a0021 touched `00-overview.md`, `08-open-decisions.md`,
`09-decision-register.md`, `10-findings.md` and `15-assessment-and-fees.md`.
It did **not** touch `02-security-privacy.md` or `01-domain-model.md`. §2.3
("Reach — the read side") contains D-031 and D-147 and no mention of guardians,
non-staff readers or a v2 portal; `01-domain-model.md` §5 ("Data ownership")
likewise. The nearest text, `02-security-privacy.md` §2.1, still reads:

> **`RELATED` is not in this enum.** OD-5 (`08-open-decisions.md`) decided on
> **2026-09-01** to remove it entirely rather than reserve it unimplemented …
> The enum member returns with the portal that needs it.

and `00-overview.md` §3.2, row P-04:

> | P-04 | Guardian **portal** | The relationship and consent authority are
> built in v1 (R-04). **The login surface is deferred**, and `RELATED` is
> removed from the scope enum entirely **until the portal ships** … (OD-5) |

**Why it matters.** OD-5's closure states the reason this distinction was
recorded at all: *"a commitment kept only in this chapter is a commitment nobody
implementing chapter 02 will read."* That is exactly the state the design set is
now in — the commitment is in `08-…` and the register, and the two chapters an
implementer of authorization and of the domain model actually reads carry no
trace of it. `00-overview.md`'s P-04 row is the v1-scope table, and it says
"deferred" and "until the portal ships", which is the deferred-indefinitely
framing D-161 was written to replace. Separately, chapter 02 §2.1 dates the
decision to 2026-09-01 while OD-5 was open until 2026-09-02 — a small stale
date, but it is the sentence a reader uses to check currency.

This is a *stale/incomplete-fix* finding rather than a contradiction: nothing
here states the opposite of D-161, but the fix was recorded and not landed.

**Recommended resolution.** Either correct D-161's "Where" pointer to the
sections that actually carry it (`08-…` OD-5 and the register), or land one
sentence in `02-security-privacy.md` §2.3 and `01-domain-model.md` §5. Update
P-04's row to say "committed to v2 (OD-5, D-161)" rather than "deferred".

---

### C-5 — `08-open-decisions.md` OD-18 cites `D-4`, which resolves to D-004 (a decision about `Person` identity) and not to OD-4

**Severity: low.**

Side A — `08-open-decisions.md` OD-18, third table row (added today):

> | **Both authoritative for different things** | … | The worst option to
> discover late: reconciliation is exactly the work **D-4/F-45** kept out of v1 |

Side B — `09-decision-register.md` D-004:

> One `Person` per human per installation; `Person`, `Membership` and
> `StudentProfile` are three distinct concepts …

The decision that actually kept reconciliation out of v1 is **OD-4**
(`08-open-decisions.md` §OD-4, "**Still open.** Whether **reconciliation**
arrives — CAMT.053 / MT940 import with payment-reference matching. It is out of
the v1 estimate"), which is how the same fact is cited in `00-overview.md`
row P-03: "Reconciliation (CAMT.053 / MT940 import with reference matching) …
not a v1 item (OD-4)".

**Why it matters.** Low impact — a reader chasing `D-4` lands on the identity
spine and finds nothing about reconciliation, then guesses. It is worth fixing
because it was introduced today, in the entry the chapter itself calls "the most
expensive item currently open".

**Recommended resolution.** `D-4/F-45` → `OD-4/F-45`.

---

### C-6 — OD-16 claims "the chapters say which is which" about the pen-and-paper premise; they do not, and two chapters still state it unqualified

**Severity: medium.**

Side A — `08-open-decisions.md` OD-16 (closed today):

> - **The pen-and-paper premise was only ever true for attendance and
>   assessment**, not for the member base. Chapter 04's "the incumbent is paper"
>   framing (D-129, print fallbacks) remains correct for the poolside surfaces
>   and is now known to be wrong for membership data. **Both statements coexist;
>   the chapters say which is which.**

Side B — the chapters do not. `04-ux.md` §4.0 opens:

> ### 4.0 The incumbent is pen and paper
> Everything in this chapter was written against an implicit competitor: another
> system. **There is none.** The thing SplashTrack has to beat is a clipboard …

and `00-overview.md` §1 (the thesis qualification, unedited by 29a0021):

> **One qualification, added after the domain review.** The thesis is the design
> constraint, not the definition of success. **The incumbent is pen and paper**,
> and paper never has a zero-percent day …

Chapter 04 is not a poolside-only chapter: its §5 fee table specifies the
**Balance** surface —

> | **Balance** (R-32) | Per payer and per student: open charges, recorded
> payments, running balance … | **Administration surface only.** …

— which is precisely the surface where an incumbent system does exist (OD-16),
and whose ownership is the subject of OD-18.

**Why it matters.** "There is none" is the premise that justifies a set of
scope reductions (print fallback as parity, post-hoc entry as a winning v1,
"first-lesson failure is permanent"). Those conclusions are sound for the
poolside surfaces and unexamined for the membership/fees surfaces, where the
comparison is now against a commercial product a volunteer already uses. An
implementer or scoper reading chapter 04 top-to-bottom will apply a
clipboard-grade bar to a screen that has to beat real software. It also leaves
OD-16 asserting a state of the document that is not true, which is the kind of
claim later rounds trust rather than re-check.

**Recommended resolution.** Add one sentence to `04-ux.md` §4.0 scoping "there
is none" to the poolside surfaces and pointing at OD-16/OD-18 for the
membership and fees surfaces; likewise qualify `00-overview.md` §1's "the
incumbent is pen and paper". Alternatively, weaken OD-16's claim to a hand-off
("the chapters must be corrected to say which is which") so it reads as
outstanding work rather than completed work.

---
### C-7 — D-158 requires role-scoped settings; the settings registry that must carry them defines `scope` as the single value `instance-wide`

**Severity: high.**

Side A — `09-decision-register.md`, D-158 (added today), decision and "Where":

> Session idle and absolute timeouts are **role-scoped** `bounded` settings,
> administrator-editable at runtime with no restart. … | A global single timeout
> cannot express the per-role table, **so the setting is role-scoped — one more
> dimension in the settings registry**. … | `02-security-privacy.md` §4.1
> (D-150), **`13-configuration-and-setup.md` §3.2** |

echoed in `08-open-decisions.md` OD-6:

> **Per-role, not global.** The two defaults differ by role, so the setting is
> role-scoped; a single global number cannot express the table above.

Side B — `13-configuration-and-setup.md` §3.2, the registry definition (not
touched by 29a0021):

> ```text
> key            organization.name
> category       Organisation | Email | Authentication | Security | Privacy | …
> type           string | number | boolean | enum | json | secret
> default        the built-in value
> validation     Zod schema
> **scope          instance-wide**
> appliesLive    true | false  (see §4)
> permission     which permission may change it
> sensitive      whether the value is encrypted and masked
> class          free | bounded | invariant   (D-150)
> ```
>
> The registry is **the single source of truth**: it generates the admin UI, the
> validation, the API surface, the documentation table, and the diagnostics page.

**Why it matters.** This is the most implementer-visible defect in today's
changes. D-158 explicitly says the new dimension goes "in the settings
registry", and names §3.2 as its home — but §3.2 states `scope` as a single
literal value with no alternatives, and §3.2 also claims to be the single source
of truth that *generates* the admin UI and API. Someone building the registry
from §3.2 produces a schema in which `session.idleTimeout` can hold exactly one
number. They then reach D-158 and either bolt a role dimension on outside the
registry (breaking the single-source-of-truth claim and the generated UI), or
collapse the per-role table to one global value (re-creating the defect OD-6's
closure says a global number cannot express). Neither is what either document
wants, and nothing in the design set says which to do.

Note also that §3.2's own restatement of the `bounded` bounds — "session idle ≤
8 h, audit retention ≥ 12 months, rate limits ≥ a stated minimum, backup
retention ≤ the shortest special-category retention" — is a **fourth** normative
copy of that list (with 02 §4.1, OD-6's table and D-158), and it silently omits
the absolute-lifetime bound that C-1 shows the other three disagree about.

**Recommended resolution.** Extend §3.2's registry sketch to admit a
`scope  instance-wide | per-role` (or a `dimension` field) and say which
settings use it, in the same change that resolves C-1. State the bounds in one
place and have §3.2 and §4.1 point at it.

---

### C-8 — R-32 (billing-lite) is stated as an unconditional v1 requirement in two places while `15-…` §6.2 now makes half of it conditional on OD-18

**Severity: medium.**

Side A — `15-assessment-and-fees.md` §6.2 (added today):

> **Conditional on OD-18, raised 2026-09-02.** … If it stays authoritative for
> membership, **this subsection does not ship**: `Membership` and
> `MembershipPeriod` become a read-only projection of that system and periodic
> contribution charges are its job, not SplashTrack's

and `08-open-decisions.md` OD-18, middle row:

> | **Incumbent stays authoritative; SplashTrack imports periodically** |
> `Membership`/`MembershipPeriod` become a **read-only projection**;
> **contributie tracking leaves v1**; **no membership editing UI** | …

Side B — `00-overview.md` §3.1, R-32, unqualified:

> | R-32 | **Billing-lite** — fee types, charges, payments, a balance view per
> payer and per student, CSV export. No document carrying an amount leaves the
> system (§1.2, `15-…`) |

and `00-overview.md` §3.5's "moved into v1" table, whose stated *reason* is now
the thing OD-18 puts in question:

> | **Billing-lite** — fee types, charges, payments, balance view, CSV export |
> R-32 | **Without it the school keeps its existing system and does dual entry**,
> which is the most common reason vertical software is abandoned |

`04-ux.md` §5 carries the same unconditional framing in its Balance row (R-32),
and `04-ux.md` §1's navigation sketch lists `Fees ← balances, charges, payments
(R-32)` with no caveat.

**Why it matters.** OD-18 is described by its own chapter as "the most expensive
item currently open" and "high and rising" cost of delay, and its consequence is
that a named subsection of chapter 15 does not ship. The v1 requirements table
is the artefact a scoper and an implementer plan against, and it does not carry
the condition. The §3.5 rationale is a sharper problem: it justifies R-32 by
saying the alternative is dual entry with an existing system — and OD-16 has now
established that an existing system *is* in place, which is why OD-18 exists.
The requirement may well survive, but its justification and its scope are now
open and the overview presents both as settled.

This is a fix that was applied in one chapter and not propagated, not a
disagreement about the underlying facts.

**Recommended resolution.** Mark R-32 in §3.1 and §3.5 as split: exam fees
unconditional (§6.3), membership/periodic contribution charges conditional on
OD-18 (§6.2). Add the same one-clause caveat to `04-ux.md` §5's Balance row.

---

### C-9 — `15-…` §9 still lists OD-17 as open and the grade scale as "assumed" and "unasked"

**Severity: low.**

Side A — `15-assessment-and-fees.md` §9 "Dependencies and open items", item 5:

> 5. **(Open — OD-17, `08-open-decisions.md`)** The grade scale is **assumed** to
>    be the five ordinal values given. Whether a school may ever define its own
>    scale is supported by the model (`GradeScale` is org-owned) and **unasked as
>    a requirement**.

Side B — `08-open-decisions.md` OD-17:

> ### OD-17 — **(CLOSED 2026-09-02)** Is the five-value grade scale the only one a school will ever use?
> **Answer, from Jack: yes — *onvoldoende / matig / voldoende / goed / zeer goed*
> is the scale.** … Recorded as **D-160**.

**Why it matters.** Low: nothing is built differently, because D-160 keeps the
generic tables exactly as §9 assumes. But §9 is chapter 15's own open-items
checklist — the list someone works through before building the module — and it
says a closed question is open and that the requirement was never asked when it
was asked and answered. Every other item in that list is correctly marked
"(Resolved)", so the one stale entry is the one a reader trusts.

**Recommended resolution.** Rewrite item 5 as "(Resolved — OD-17, D-160)" with
the confirmed scale and the note that versioning is still required.

---

### C-10 — D-159's "English without exception" versus D-160's seeded Dutch grade codes

**Severity: low** (reads as an unstated boundary rather than a flat
contradiction, but the two decisions were written on the same day and never
reconciled).

Side A — `09-decision-register.md` D-159:

> Schema identifiers, column names, API field names and code are English
> **without exception**.

Side B — `15-assessment-and-fees.md` §2.1, the `GradeValue` sketch, and D-160
which seeds it:

> ```text
> GradeValue           scaleId, code, rank, label
>                      **ONVOLDOENDE=1 · MATIG=2 · VOLDOENDE=3 · GOED=4 · ZEER_GOED=5**
> ```

with §2.2's normative pass rule written against one of them:

> - *"Alles moet minimaal voldoende zijn"* → `scheme.**passFloorGradeId =
>   VOLDOENDE**`, every `SchemeCriterion.minimumGradeId` NULL.

**Why it matters.** These are `code` column *values*, not identifiers, so D-159
arguably does not reach them — but D-159 says "without exception" and nothing in
either decision draws that line. Chapter 15 also writes `VOLDOENDE` as a
symbolic constant in a rule expression, which is the form that most looks like
an identifier. A module author following D-159 literally will rename these and
break §2.2's worked example; one following chapter 15 will seed Dutch codes and
believe D-159 was violated.

**Recommended resolution.** One clause in D-159 stating whether the rule covers
seeded data values and enum members, or a sentence in D-160 stating that these
codes are data and deliberately Dutch. Resolve together with C-3, which is the
same boundary applied to `AFTEST`.

---
### C-11 — `01-domain-model.md` §3.5 states the exam-access mechanism as an `EXAM_SESSION`-scoped grant citing D-054, which is superseded and whose scope type no longer exists

**Severity: high.**

Side A — `01-domain-model.md` §3.5, the `ExamAssessor` row (normative, in the
entity table an implementer builds from):

> | `ExamAssessor` | examSessionId, personId, role | | Records **who assessed**
> this session — an attribution fact, not an access grant. **Access comes from
> an `EXAM_SESSION`-scoped role assignment (D-054).** Supports the external
> examiner with no membership (D-052) |

Side B — `09-decision-register.md`, D-054 and D-068:

> | D-054 | **(Superseded by D-068)** `EXAM_SESSION` is a first-class scope
> type; no access mechanism lives outside the scope enum | …
>
> | D-068 | `SESSION` is a first-class scope type: reach follows assignment to a
> specific session's roster, for a bounded window, and **replaces `EXAM_SESSION`
> (D-054)** | …

and `02-security-privacy.md` §2.1, the scope enum, which contains `SESSION` and
no `EXAM_SESSION`:

> | `SESSION` | **Participation in one scheduled session (lesson, aftest or exam
> session) and its roster, for a bounded window** | "Independent aftest assessor,
> Groep A1's Thursday aftest" · … · "External examiner, Saturday 14 March" |

and `00-overview.md` R-31:

> | R-31 | **`SESSION` participation reach** … **Replaces the `EXAM_SESSION`
> scope** (`02-security-privacy.md` §2.1) |

**Why it matters.** This is the clearest case in the set of a superseded
decision still cited as live, and it is cited *as the mechanism*, in the
chapter that defines the entity. `01-…` §3.5 is where someone implementing
exams reads what grants an assessor access; it tells them to use a scope type
that `02-…` §2.1 does not define and `09-…` records as replaced. Every other
mention of `EXAM_SESSION` in the active chapters is correctly marked as history
(`00-…` §3.5, `10-…` F-… , `15-…` §3, `02-…` §2.2), so this is the single
survivor of that renaming pass — which is exactly why it will not be caught by
someone who checks one other chapter and assumes the rename was complete.

**Recommended resolution.** Change the `ExamAssessor` Notes cell to "Access
comes from a `SESSION`-scoped role assignment (D-068, replacing D-054)".

---

### C-12 — `10-findings.md`'s Security-risks table still names `SHARED_DEVICE` (D-009) as the mitigation for a High risk, which F-127 in the same file says was removed

**Severity: medium.**

Side A — `10-findings.md`, "## Security risks" table (presented as the current
risk register; the chapter's own preamble is "The brief explicitly asks for
these"):

> | Shared tablet left unlocked | High | **`SHARED_DEVICE` mode (D-009)** |

Side B — `10-findings.md` F-127, ~1000 lines later in the same file:

> D-009 was … **cited as *the* mitigation for two separate High risks and for
> FM-13**, so the strongest control in the poolside threat model was a
> self-declaration.
> **Response.** D-143 supersedes D-009 and records what v1 actually ships …

and `02-security-privacy.md` §6.2, the equivalent row in the abuse-scenario
table, already corrected:

> | Instructor tablet stolen from pool deck | Short idle timeout by role; the
> Instructor role holds no export, bulk or admin permission at any scope
> (**D-143**); session revocation from the breach-response inventory (D-128) |

**Why it matters.** F-127's stated defect is "D-009 was cited as the mitigation
for two separate High risks". The repair updated chapter 02 and `07-operations.md`
FM-13, and left one of the two High-risk citations standing — in the table that
is the design set's summary risk register, and in the same file as the finding
that says it was fixed. A reader auditing whether F-127 was resolved will find
the answer contradicted by the table three screens above it. `00-overview.md`
§3.5.1 also correctly lists D-009 as removed.

**Recommended resolution.** Replace the mitigation cell with D-143's text and a
pointer to `02-…` §1.3, or mark the whole table as a historical snapshot with a
pointer to `02-…` §6.2 as the live register — the latter only if that is
actually true, since `03-…` and `07-…` currently treat it as live.

---

### C-13 — D-017 and D-051 are two authoritative statements of the same public-surface rule, in two chapters, with neither pointing at the other

**Severity: medium.** (A D-134 violation that survived the D-134 repair pass.)

Side A — `09-decision-register.md` D-017, home `03-deployment-model.md` §5.1:

> | D-017 | The public surface has its own read model and **may not touch person
> tables** | … | `03-deployment-model.md` §5.1 |

restated normatively in `03-deployment-model.md` §5.1:

> **Decision D-017 (unchanged, and now carrying more weight) — the public
> surface …**

Side B — `09-decision-register.md` D-051, home `00-overview.md` §3.4:

> | D-051 | The public surface **may not read any person, student, member,
> group, attendance, progress or exam record, nor expose any endpoint from which
> their existence can be inferred** | … | `00-overview.md` §3.4 |

restated normatively in `00-overview.md` §3.4 ("The anonymous-access rule").

**Why it matters.** D-134 requires that "a normative rule is stated **once**, in
one section; every other mention points at it and says so". Here one rule has
two decision ids, two homes, and two full statements, and neither row nor
section references the other. The copies are not identical: D-051 is strictly
broader (it forbids inference endpoints, enumerable identifiers and non-uniform
responses on public forms; D-017 forbids reading person tables). Downstream
citation has already split along the difference — `10-findings.md` F-10 and its
risk table, `07-operations.md` §, and `03-…` §5.1/§5 all cite **D-017** alone
for the structural claim, while `00-…` §3.5.1 and OD-9 cite **D-051** alone as
the rule that survives the CMS cut. An implementer who lands on D-017 builds a
read model with no person imports and can still ship an inquiry form that
confirms whether an email address is already known — which D-051 forbids and
D-017 does not mention.

This is the same failure mode as D-037 (last round's most valuable find) with
the duplication expressed as two decision numbers rather than three copies of
one, which is presumably why the D-134 sweep did not catch it.

**Recommended resolution.** Make D-051 the single statement and reduce D-017's
register row and `03-…` §5.1 to a pointer ("the rule is stated once, in
`00-overview.md` §3.4 / D-051"), or the reverse. Update the citations in
`10-…` F-10, `10-…`'s risk table and `07-…` §… to name the surviving id.

---
### C-14 — The blocking-CI list is stated three times despite R-28 saying it is stated once; the count is wrong and the copies drop the check the authoritative table calls the most important

**Severity: high.**

Side A — `06-delivery.md` §2.1, declared by R-28 to be the single home. Its
table has **nine** rows marked "Blocking in v1: Yes":

> | Format (Prettier) | Yes | … |
> | Lint (ESLint, incl. module-boundary rules) | Yes | … |
> | Typecheck | Yes | … |
> | Unit tests (Vitest) | Yes | … |
> | Integration tests | Yes | … |
> | **Scope-escape tests** | Yes | **New, and the most important gate in this table.** See below |
> | **Migration against populated DB** | Yes | … |
> | Secret scanning | Yes | … |
> | E2E (Playwright) | Yes | … |

while the prose immediately above it says:

> **v1 ships eight blocking checks** (`00-overview.md` §3.5.1).

Side B — `00-overview.md` §3.1, R-28:

> | R-28 | **Reduced (§3.5):** **eight** blocking CI checks — format, lint,
> typecheck, unit, integration, E2E, migration-against-populated-database,
> secret scanning. **The check list is stated once, in `06-delivery.md` §2.1** |

and `00-overview.md` §3.5.1, a third statement:

> | **R-28's full 15-check CI** | **Eight checks:** format, lint, typecheck,
> unit, integration, E2E, migration-against-populated-database, secret scanning.
> Seven of the fifteen were asserted to exist and did not (§2.1) |

**Why it matters.** Three defects compounding:
(a) R-28 asserts the list is stated once and then states it, and §3.5.1 states
it a third time — a direct D-134 violation *in the sentence that invokes D-134's
discipline*.
(b) The two copies in `00-overview.md` are **not** the nine-row table. Both omit
**scope-escape tests**, which §2.1 flags as "the most important gate in this
table" and which D-032 and D-147 both depend on
(`02-…` §2.3: "`06-delivery.md` §2.1's scope-escape gate already requires
asserting that a `Reach` cannot be constructed outside `resolveReach()`").
(c) The number "eight" is wrong against the table it claims to summarise —
nine rows say Yes. Someone building the CI pipeline from the overview ships
eight jobs and no scope-escape gate; someone building it from §2.1's table ships
nine and wonders which of the two documents is stale.

The §2.1 preamble's own stated purpose — the below-the-line checks are "named
here so `00-overview.md` §4.1 and this table cannot drift apart again" — is
evidence this exact drift was previously found and repaired above the line only.

**Recommended resolution.** Correct the count to nine in both `06-…` §2.1's
prose and `00-…` §3.5.1, and reduce R-28 to what it claims to be — a pointer
with no enumeration at all. Add scope-escape tests to §3.5.1's cell.

---

### C-15 — The MFA high-risk permission set is enumerated in two chapters, the two lists differ, and the shorter one claims to be "the same set"

**Severity: high.**

Side A — `02-security-privacy.md` §1.2, the authoritative definition (nine
entries):

> Any principal holding any permission in the **high-risk set** —
> `organization.settings.manage`, **`identity.providers.manage`**,
> `roles.assign`, **`roles.manage`**, **`accessgroups.assign`**, `privacy.*`,
> `audit.read`, `backup.*`, `students.medical.*` — at **any** scope must have a
> verified second factor.

Side B — `07-operations.md` §1.3, the security-alerting table (six entries),
asserting identity with Side A:

> | Privilege use | Any use of a permission in the high-risk set
> (`organization.settings.manage`, `privacy.*`, `roles.assign`, `audit.read`,
> the backup permissions, `students.medical.*`) — **the same set that compels
> MFA (`02-security-privacy.md` §1.2)** |

`identity.providers.manage`, `roles.manage` and `accessgroups.assign` are absent
from the second list.

**Why it matters.** The second list is not decoration — it defines which
privilege uses raise a security alert. Implemented as written, the three missing
permissions compel MFA but generate no privilege-use alert. Those three are the
privilege-escalation permissions specifically: `02-…` §6.2 lists "**Settings
administrator adds their own identity provider and logs in as instance
administrator**" and "**Location manager grants themselves an
organisation-scoped role**" as named abuse scenarios, and `02-…` §1.2.1 says
`identity.providers.manage` is "in the high-risk set that compels MFA". The
alerting gap is therefore precisely on the actions the threat model treats as
the escalation path.

D-130's own trade-off column predicted this — "The named high-risk permission
set must be maintained as permissions are added" — and D-134 forbids the second
enumeration that made it possible. The clause "the same set that compels MFA"
makes it worse than a plain duplicate: a reviewer diffing the two is told they
match.

**Recommended resolution.** Delete the parenthetical enumeration from
`07-operations.md` §1.3 and leave only the pointer to `02-…` §1.2, per D-134.
If a reader-facing list is wanted there, generate it from one named constant and
say so.

---
### C-16 — The retention table uses a fourth `onExpiry` value, `PSEUDONYMISE`, that the enum is stated three times as not having — and that D-155 explicitly rules out

**Severity: high.**

Side A — the enum, stated normatively in three places, always with three values.
`02-security-privacy.md` §5.6, the `RetentionPolicy` model:

> ```text
> RetentionPolicy
>   …
>   onExpiry           **DELETE | ANONYMISE | REVIEW**
> ```

`01-domain-model.md` §5, the preamble to the retention table itself:

> Each is a `RetentionPolicy` the organisation confirms or changes, with
> `onExpiry` being **`DELETE`, `ANONYMISE` or `REVIEW`** (`02-security-privacy.md`
> §5.6, D-065).

`09-decision-register.md` D-065:

> Retention and erasure are policy-driven per data class: purpose, lawful basis,
> trigger, expiry action (**`DELETE`/`ANONYMISE`/`REVIEW`**)

and D-155 closes the set explicitly:

> `ANONYMISE` means destroying the row-level record … **A class that cannot meet
> this may only be `DELETE` or `REVIEW`.**

Side B — `01-domain-model.md` §5, two rows of the same table whose preamble
states the three-value enum:

> | Charges | `fees` | `fees.read` | Legal obligation — fiscal administration |
> Charge due date | 7 years | **`PSEUDONYMISE`** (D-092) |
> | Payments | `fees` | `fees.read` | Legal obligation — fiscal administration |
> Received date | 7 years | **`PSEUDONYMISE`** (D-092) |

backed by `09-decision-register.md` D-092 ("erasure **pseudonymises** the charge
rather than deleting it") and OD-4 ("erasure must pseudonymise the charge rather
than delete it").

**Why it matters.** `onExpiry` is a persisted enum on a table an implementer
writes on day one of the privacy module. Built from the stated enum it has three
members, and the two `fees` rows are then unrepresentable — the developer picks
`DELETE` (destroying bookkeeping, which D-092 exists to prevent) or `REVIEW`
(nothing happens automatically, per §5.6's own warning) or silently adds a
fourth member nobody reviewed. This is not a wording slip: §5.6 spends a page
establishing that pseudonymisation is *not* anonymisation and D-155 closes the
set on exactly that reasoning, so adding `PSEUDONYMISE` is a substantive
decision that has been taken in a table cell and nowhere else.

Note the finding is about the *enum*, not about D-092's substance — retaining a
pseudonymised financial record on a fiscal ground is coherent. What is missing is
the fourth member being declared, defined (what exactly is stripped, and what
survives) and reconciled with D-155's argument.

**Recommended resolution.** Add `PSEUDONYMISE` to the enum in `02-…` §5.6, to
D-065's register row and to `01-…` §5's preamble, with a one-paragraph
definition in §5.6 stating that it is *not* anonymisation, that the record
remains personal data, and that it is available only where a statutory retention
ground is recorded. Amend D-155's closing sentence to name the three options.

---

### C-17 — `RetentionPolicy.dataClass` enumerates eight classes; the table it governs has twenty rows, and the enum still names the entity D-082 renamed

**Severity: low.**

Side A — `02-security-privacy.md` §5.6:

> ```text
> RetentionPolicy
>   dataClass          person identity · attendance · progress · exam result ·
>                      **certificate** · medical note · audit event · inquiry
> ```

Side B — `01-domain-model.md` §5's retention table, which is the instantiation
of that model, carries twenty rows including classes absent from the enum:
*Membership periods*, *Student profile*, *Assessment remarks*, *Charges*,
*Payments*, *Consent records*, *Waitlist entries*, *Pre-migration backups*,
*Operational logs*, *Public page content*, *Organisation settings & branding*,
*Login credentials*.

And `09-decision-register.md` D-082:

> The existing **`Certificate` entity is renamed `Award`**; `AwardType.kind ∈
> {DIPLOMA, CERTIFICATE}` carries the distinction

**Why it matters.** Low — the `dataClass` line reads as illustrative ("·"
separators, sentence-case labels) rather than as a closed enum, so most readers
will not build a type from it. It is listed because (a) if anyone does treat it
as the enum, twelve retention classes have no policy, and (b) `certificate` is
the pre-D-082 entity name in a model sketch, which `15-…` §9 item 3 records as
resolved for `01-…` and `04-…` only — chapter 02 was not in that pass's scope
and still carries it.

**Recommended resolution.** Either mark the `dataClass` line "illustrative — the
authoritative class list is `01-domain-model.md` §5" (D-134's pointer form), or
complete it. Rename `certificate` → `award` either way.

---
### C-18 — The importer's failure behaviour is specified three times today, in three partial and partly conflicting forms

**Severity: medium.**

Side A — `00-overview.md` §2.2 (rewritten today), constraint 1:

> 1. **Authority is never inferred.** Whatever the source calls a role,
>    capability or permission level maps to a SplashTrack role assignment
>    explicitly, and the import **refuses on any unmapped value** rather than
>    silently dropping — or silently granting — authority.

Side B — `09-decision-register.md` D-157 (added today):

> … **unmapped columns are reported, never silently dropped**, and the import is
> a **dry-run-then-commit with a per-row rejection report**

Side C — `00-overview.md` §3.1, the R-29 row (rewritten today):

> | R-29 | One-time import of the existing pupil/member list … mapping specified
> against a real sample file only, **unmapped columns reported not dropped**,
> zero `Consent` rows written (D-157, §2.2) |

**Why it matters.** Three statements of one behaviour, none of which is a
superset of the others:

| Rule | §2.2 | D-157 | R-29 |
|---|---|---|---|
| Unmapped **authority** value | **refuse the import** | not mentioned | not mentioned |
| Unmapped **column** | not mentioned | report, do not drop | report, do not drop |
| Dry-run then commit | not mentioned | **required** | not mentioned |
| Per-row rejection report | not mentioned | **required** | not mentioned |
| Zero `Consent` rows | required (constraint 2) | not mentioned | **required** |

For the one case the copies both address — a column the source uses to express
a role or permission level, which is simultaneously an "unmapped column" and an
"unmapped authority value" — they prescribe different behaviour: §2.2 refuses,
D-157 reports and (by implication) proceeds. That is the safety-relevant case,
and it is the one they disagree on.

D-134 requires one home. D-157's own "Where" column names `00-overview.md` R-29
and `08-…` OD-16, i.e. it points at two of the three copies rather than
declaring one authoritative.

**Recommended resolution.** State the importer's contract once — most naturally
in D-157's row, since it is the decision — covering all five rules above, and
reduce §2.2 and R-29 to pointers. Resolve the refuse-vs-report question
explicitly for authority-bearing columns.

---
### C-19 — Backup retention is a hard ceiling in the settings registry and an overridable-with-warning ceiling in chapter 14

**Severity: medium.**

Side A — `13-configuration-and-setup.md` §3.2, the registry that is "the single
source of truth for validation":

> `bounded` settings carry **hard floors and ceilings the schema enforces** and
> which `settings:reset` also respects — **it clamps to the bound** rather than
> restoring an unbounded default (session idle ≤ 8 h, audit retention ≥ 12
> months, rate limits ≥ a stated minimum, **backup retention ≤ the shortest
> special-category retention**).

Side B — `14-backup-restore-upgrade.md` §5.2, D-104:

> - **Ceiling.** The registry **refuses** a backup retention longer than the
>   shortest special-category retention, **or — where an operator has a
>   documented reason to exceed it — surfaces the mismatch as a diagnostics
>   warning** naming both figures. Silently allowing the mismatch is what turns
>   an Article 15 response into a false statement.

`02-security-privacy.md` §4.1 carries a third, compressed form that preserves
the escape hatch — "backup retention ≤ the shortest special-category retention,
**or a diagnostics warning** (D-104)" — while `09-decision-register.md` D-150's
own row drops it: "backup retention ≤ the shortest special-category retention".

**Why it matters.** The registry either accepts a value above the ceiling or it
does not, and `settings:reset`'s clamping behaviour follows from the answer. If
§3.2 is implemented as written, D-104's documented-exception path does not
exist, and an operator with a legitimate long backup horizon has no setting —
D-150's own stated consequence ("changes code, not a setting") applied to a case
D-104 says should be a warning. If D-104 is implemented as written, the registry
is not the hard bound §3.2 and D-150 describe, and `settings:reset` will clamp
away the documented exception at the next reset without telling anyone.

**Recommended resolution.** Decide whether `bounded` admits a
warn-and-allow variant. If it does, that is a change to D-150's classification
(a fourth behaviour, or a per-setting `onExceed: refuse | warn`), and it belongs
in D-150 and §3.2 rather than in one bullet of chapter 14. If it does not,
delete the "or" clause from D-104 and from `02-…` §4.1.

---
## FIXES I VERIFIED AS CORRECT

Each item below is a repair made after an earlier round that I checked against
the current text and found sound. This list is the other half of the review: it
is what should *not* be re-opened.

**1. D-037's three-place duplication (last round's headline find) is genuinely
repaired.** `13-configuration-and-setup.md` §3.1 carries the only normative
statement; §3.3 says "The rule governing what may live in the environment is
stated once, in §3.1 (D-037). It is not restated here"; `00-overview.md` R-17,
`06-delivery.md` §1 and `03-deployment-model.md` §2 all cite rather than
restate. The pointer form D-134 prescribes is actually used.

**2. D-057's two in-chapter contradictions (F-73) are gone.** `01-domain-model.md`
§2.3 now reads "**owned by the `sessions` module** (D-057); `planning` and
`attendance` are both consumers", and §3.4's `ScheduledSession` Notes cell says
the same. The paragraph that defended "one table, two owners" as *deliberate*
was deleted, not softened — which is what F-73's response claimed. `05-technical.md`
§3.1 agrees.

**3. Register integrity (D-133) holds where it was applied.** D-011, D-015 and
D-029 each carry "(Withdrawn/Reaffirmed — this row is the authoritative text;
see D-133)" with a "Where" cell that explicitly says *no active section*, and
points at chapter 11 as history only. D-027's previously wrong pointer is
corrected: it now names `03-deployment-model.md` §1.3, and §1.3 does state the
singleton with D-027 cited. *Minor nuance, not a finding:* `08-open-decisions.md`'s
register-integrity note lists D-027 among the rows that "state, in the register
row itself, that the row is the authoritative text for a withdrawn or superseded
decision" — D-027 is live and correctly does not, so the note over-claims by one
entry while the underlying rows are right.

**4. The D-090–D-098 double-assignment is cleanly resolved.** Mechanical check
of `09-decision-register.md`: 146 rows, zero duplicate ids, range D-001…D-161.
The gaps left by the renumbering (D-069–D-079, D-117–D-119, D-137) are dead
numbers — I grepped every active chapter for each and **none is cited anywhere**.
No orphan references survived the renumber.

**5. Identifier hygiene is otherwise good.** Programmatic cross-check of every
`D-`, `F-`, `R-`, `OD-`, `P-` and `FM-` reference in chapters 00–10, 13, 14, 15
against its register (`09-…` rows, `10-…` `###` headings, `00-…` §3 tables,
`08-…` `###` headings, `07-…` §1.5 table): **every reference resolves**, with
the single exception of the `D-4` typo reported as C-5. F-01…F-133 numbering has
no duplicates. FM-1…FM-15 are all defined in `07-operations.md` §1.5.

**6. No active chapter cites chapters 11 or 12 as a requirement.** The only
references are `00-overview.md` §1's reading-order table ("*History only:*"),
`03-deployment-model.md`'s header banner, and three register "Where" cells that
say "History only in `11-revision-single-tenant.md`". Nothing depends on them
normatively.

**7. OD-1's closure propagated correctly through the prototype-import path.** I
grepped every mention of "prototype" in the active chapters. Nothing still
assumes a prototype import or a prototype database: `00-overview.md` §2.2/§2.3
are rewritten, `05-technical.md` §3 references the prototype only as a location
on `main` (D-123's basis), `01-domain-model.md` §2.3 references it only as prior
art for `SwimGroup`, and `10-findings.md` F-12 references it only as a reason for
D-001. The "no destructive action until OD-1 closes" constraint appears nowhere
except in the sentences that record its lifting. *One stale trace, too small to
number:* D-001's register trade-off column still reads "any live data needs
export/import" — conditional phrasing that is now known to be moot, but it does
not instruct anyone to do anything.

**8. D-007's withdrawal is cleanly enforced.** `04-ux.md` §… states the rule
directly — "no active chapter may cite D-007 as an instruction" — and no active
chapter does. OD-12's citation was corrected to D-062 and the correction is
recorded in the entry; `00-overview.md` P-09 carries the same correction. This
is the cleanest of the superseded-decision repairs, and it is the model C-11
(D-054) should follow.

**9. D-082's `Certificate` → `Award` rename is complete in the two chapters it
claimed.** `01-domain-model.md` §3.5 uses `Award` throughout with the rename
noted, and `04-ux.md` contains no `Certificate` entity reference at all.
`15-…` §9 item 3's claim is accurate as scoped. (The lowercase `certificate`
survival in `02-…` §5.6's `dataClass` sketch is C-17 and was outside that
pass's stated scope.)

**10. D-147's opaque `Reach` covers the scope enum exactly.** The six scope
types in `02-security-privacy.md` §2.1 (`ORGANIZATION`, `UNIT`, `GROUP`,
`COURSE`, `SESSION`, `SELF`) each have a matching `Reach` variant, plus `NONE`
and `UNION`. `RELATED` is absent from both, consistently. The union/opaque
reasoning in §2.3 and D-147's register row agree word for word in substance.

**11. D-111/D-155 (attendance `DELETE`, not `ANONYMISE`) is consistent
everywhere.** `01-domain-model.md` §5's table row reads "**`DELETE`** — see
§5.3", §5.3 gives the re-identification argument, `02-…` §5.6 D-155 gives the
mechanical definition and cites attendance as already moved, and `10-…` F-123
records it. No chapter still prescribes `ANONYMISE` for attendance. (The
separate `PSEUDONYMISE` problem is C-16 and is a different rule.)

**12. F-95's `SECRET_KEY` lifecycle is stated once and pointed at twice.**
`13-configuration-and-setup.md` §3.1.1 is the single home; `03-deployment-model.md`
§1.2 and `14-backup-restore-upgrade.md` §1 both explicitly decline to restate it
and point there. This is the D-134 pattern executed correctly, including the
"and says so" half.

**13. OD-6's closure lands on D-150 rather than inventing a parallel rule.** The
*classification* half is right: OD-6 correctly reasons from D-150's existing
`bounded` class instead of creating a new mechanism, and correctly ties the bound
to D-143's threat model. The defects are the numbers and the missing registry
dimension (C-1, C-2, C-7), not the shape of the decision.

**14. F-44's status update is internally consistent.** `10-findings.md` F-44 now
carries an owner and a precise blast radius ("What is blocked is **seeding**"),
and `15-…` §9 item 2 and `08-…` OD-2's "What remains" both say the same thing in
the same scope — a data question, blocking a seeded catalogue only. Three
places, but two are explicit pointers to the finding, so this is a correct
D-134 shape rather than a duplicate.

---

## Summary

**19 findings: 7 high, 8 medium, 4 low.** No blockers — nothing here stops the
design being built, and several findings are the same defect class the previous
round found, surviving in a new location.

| Severity | Findings |
|---|---|
| high | C-1, C-2, C-3, C-7, C-11, C-14, C-15 |
| medium | C-4, C-6, C-8, C-12, C-13, C-16, C-18, C-19 |
| low | C-5, C-9, C-10, C-17 |

**The pattern.** Eleven of the nineteen are one shape: **a rule stated
normatively in more than one place, where the copies have drifted apart**
(C-1, C-2, C-3, C-13, C-14, C-15, C-16, C-18, C-19) or where a fix was recorded
in the register and not landed in the chapter the register points at (C-4, C-12).
D-134 exists to prevent exactly this and is itself violated by the requirements
table that invokes it (C-14: R-28 says "the check list is stated once" and then
states it). Three of the requirement rows in `00-overview.md` §3.1 that end with
"stated once, in X" — R-13, R-14, R-28 — each have a second enumeration
somewhere that has drifted (C-15, C-11, C-14 respectively). That is the highest-
yield place to look next round.

**Today's changes specifically.** D-157–D-161 are individually well-reasoned and
none contradicts an earlier decision it did not revise. What they consistently
lack is propagation: D-158 names two sections that were not edited (C-1, C-2,
C-7), D-161 names two sections that were not edited (C-4), D-159 was not checked
against the schema sketches already in the set (C-3, C-10), and OD-16/OD-18's
consequences reached chapter 15 §6.2 but not R-32 or chapter 04 (C-8, C-6). The
register was updated; the chapters mostly were not.
