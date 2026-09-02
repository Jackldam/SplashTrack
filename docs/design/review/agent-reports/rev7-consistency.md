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
