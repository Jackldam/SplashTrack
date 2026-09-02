# rev7 — independent domain-realism & scope review

**Scope of this pass.** Chapters `00`–`10`, `13`, `14`, `15` at `29a0021` on
`design/architecture-phase`. Chapters 11/12 read as history only. The two
predecessor reports (`report-realist.md`, `report-realist-round2.md`) were read
first, then set aside: the question here is not whether the rewrite *recorded*
the domain, but whether it *works* at a poolside on a Tuesday evening.

**Headline.** The domain rewrite is real, not cosmetic. Aftesten, the grade
scale, the pinned scheme version, `GroupMove` in both directions, the paper
fallback and the printed NRZ candidate list are all genuinely present and
several are better than what was proposed to them. But the rewrite landed on the
**assessment** half of the domain and left the **operational** half untouched:
**nothing in this design set creates a lesson.** And the number attached to the
result — 18–20 engineer-weeks — does not survive contact with what v1 still
contains.

---

## Part 0 — Walking a Tuesday evening

Five scenarios, end to end, with the moment each one stops.

**1. Register attendance for a group of twelve.** Works, and it is the best
screen in the set. `04-ux.md` §4.1: default-to-present, tap-for-absent, one
transaction, `clientEventId`, one audit event per registration. A past session
that was never registered surfaces on Today (`04-ux.md` §1), so the post-hoc
"enter it from the sheet afterwards" path the design commits to in §4.0(3)
actually exists. **No stop** — *provided the session row exists*, which is R-2.

**2. A child moves down a group.** Works, and it is right. `GroupMove` carries
`direction (UP/DOWN/LATERAL)`, a reason and `decidedByPersonId`
(`01-domain-model.md` §3.2, D-108). **Stop:** the target group's capacity is a
nullable field nothing checks (R-10).

**3. Run an aftest.** Model works: scheme pinned by FK, five-point scale,
per-criterion grades, waivers with a name on them, default-unset entry.
**Stop:** the gate's independence test disqualifies most of a small club's
instructors (R-7), and the assessor's reach depends on someone having created a
`SESSION` grant, which no workflow does (R-4/R-5 are the same defect).

**4. Enter an exam candidate list for a visiting NRZ delegate.** Works, and the
answer — print it, D-094 — is the right one. **No stop.**

**5. A child returns after a year away.** Works. D-059: one persistent
`StudentProfile`, a new `MembershipPeriod`, a new `Enrolment`, history intact.
**No stop.** This is the case most products in this space get wrong.

**6. The wifi drops mid-session.** **Stop.** See R-6. The print fallback is the
stated answer and nothing makes it happen before the failure.

---

### R-1 — The v1 estimate of ~18–20 engineer-weeks is not reconcilable with what v1 still contains

**Severity: blocker** (blocker to *planning*, not to code — but Jack will
schedule against this number).

`00-overview.md` §3.5.3 states:

> | v1 **as previously specified** | ~60–75 |
> | v1 **as re-cut above** | **~18–20** |

That number is inherited verbatim from `report-realist-round2.md` §E3, which
asserted it without a line-item table, against a predecessor that *had* one.
Reconstructing it from the round-1 table, applying only the cuts §3.5.1 actually
takes, and adding §3.5.2's new work:

| Area | Round 1 | After §3.5.1 | Note |
|---|---|---|---|
| Template extraction + tenant strip (D-056) | 3.5 | 3.5 | Not cut |
| Scope model | 3 | 2.5 | 5 types survive, + roster-resolved `SESSION` |
| Settings | 3 | 1 | Registry → plain page |
| Setup wizard + boot state machine | 2 | 2 | Not cut |
| Backup / restore / recovery token | 3.5 | 3 | Not cut |
| Migration / upgrade | 2.5 | 2 | Matrix out, fixture generation still ships (`06-…` §1) |
| IdP registry | 2.5 | 0 | Cut |
| Retention | 3 | 1 | Engine → constants |
| Consent + guardian authority | 1.5 | 1.5 | Not cut |
| Column encryption + envelope + rotation | 1 | 1.5 | **Grew** — see R-12 |
| Audit as a product surface | 1 | 1 | Not cut |
| Diagnostics + break-glass CLI | 1 | 1 | Not cut |
| Breach response (R-37) | — | 1 | **New** |
| Domain modules | 19.5 (9) | ~23 (11) | + assessment 2.5, + fees 2, − skills collapse 1 |
| Waitlist / group move / print / NRZ export | — | 3 | **New** |
| Branding + catalogue page + inquiry form | 4 | 1.5 | CMS cut |
| Design system, wireframes, i18n, WCAG | 3.5 | 3.5 | Not cut |
| CI build-out | 2 | 1.5 | 15 checks → 8 + scope-escape harness |
| Release engineering | 2.5 | 2 | Not cut |
| DEV env + deploy | 1 | 0.5 | UAT cut |
| **Total** | **60** | **~55** | |

Add the same 20–30% for integration and rework the round-1 table added, and v1
as re-cut is **~66–72 engineer-weeks**, not 18–20. The re-cut removed roughly
eight weeks of platform work and added roughly seven weeks of domain work.
**That is exactly what §3.5 says it is doing** — *"This is not 'ship less'. It
is spend the same budget on things a swim instructor will touch."* The
sentence is correct and the table two pages later contradicts it.

The cross-check that settles it without any table: v1 has **eleven domain
modules** (`01-domain-model.md` §1.1), and `06-delivery.md` §4.4 defines a slice
as *"data model → service → UI → tests → docs are all present; **scope-escape
tests exist** for the module"*. Eleven modules at that bar is 16–22 weeks by
itself. 18–20 for the whole release leaves under four weeks for the crypto
envelope, the boot state machine, backup/restore, the setup wizard, the scope
model, settings, consent, the erasure registry, diagnostics, breach response,
the design system, i18n, print, the eight CI checks, release signing and the
tenant strip.

**Why it matters at the poolside.** It does not — it matters six months from
now. At ~15 h/week this is not "next season", it is 2029. Every scope decision
in this review is worth taking *because* of this number, and taking them all
still leaves a release that needs deliberate staging into something a school can
use before it is finished.

**Recommendation.** Replace §3.5.3 with a line-item table that sums, and split
v1 into a **pilot cut** (what Jack's school can run) and a **release cut** (what
a stranger can install). Do not publish a single number that a reader will plan
against.

---

### R-2 — Nothing in this design creates a lesson

**Severity: blocker.**

`planning` is listed as a v1 module — *"Schedule construction, locations,
resources, assignment"* (`01-domain-model.md` §1.1) — and that one line is its
entire specification. Grep across `00`–`10`, `13`–`15` for `holiday`,
`vakantie`, `recurrence`, `recurring`: **zero hits** other than
`FeeType.recurrence`. There is no recurrence primitive, no holiday or
pool-closure calendar, no bulk season generation, no "copy last block", and no
screen for any of it. `04-ux.md` §3 gives `Planning → Calendar → Session detail`
and §4 specifies no planning workflow at all.

**The moment it fails.** September. Jack has six groups. A block is ~40 weeks
minus school holidays minus two pool closures — call it 36 sessions per group,
**216 `ScheduledSession` rows**, each with a date, a time, a location and a
group. Every one of them is hand-created before a single instructor can tap
"Start session", because `AttendanceEvent` is written against a session id
(`01-domain-model.md` §3.4). The flagship workflow is unreachable until someone
spends an evening in a form.

This is not a missing nicety. It is the precondition of the product thesis. The
clipboard does not have this problem: the sheet exists because someone printed
six of them.

**Why the design set doesn't see it.** `sessions` owns the table (D-057) and
`planning` is a consumer — a clean boundary that was argued carefully — and the
argument is entirely about *ownership*, never about *generation*. The concept
was decided and the capability was never specified.

**Recommendation.** Specify a recurrence primitive and an exception calendar in
`sessions`/`planning` before v1: a `SessionSeries` (group, weekday, time,
location, from/to) that generates `ScheduledSession` rows, plus an
org-level closure calendar (school holidays imported once as dates, pool
closures added by hand) that the generator skips. Roughly a week, and it is the
single highest-value week in the plan. Nothing else in v1 is usable without it.

---

### R-3 — A lesson cannot be cancelled

**Severity: high.**

`ScheduledSession` carries `status` (`01-domain-model.md` §3.4) and the field's
**values are never enumerated anywhere in the design set** — unlike
`AttendanceEvent.state`, `Enrolment.status`, `Charge.status` and
`StudentLifecycleEvent.type`, all of which are given explicit enums in the same
tables. Grep for `CANCELLED` finds it only on `Charge` and on the exam-candidate
withdrawal in `15-…` §6.3.

**The moment it fails.** 16:10 on a Thursday, the pool calls: no lesson tonight.
There is no cancel action, so the session stays `SCHEDULED`. At 19:00 it appears
on Today as a session to register. Tomorrow it appears in *"anything requiring
attention (unregistered past sessions)"* (`04-ux.md` §1) — a permanent false
alarm, one per cancelled lesson, forever. The instructor's only move is to open
it and mark twelve children absent, which is a lie that lands in an append-only
evidence log the design justifies with *"for absence policy, for parental
disputes, and occasionally for safeguarding"* (D-061).

**Why it matters at the poolside.** A cancelled lesson is not an edge case; it
is several evenings a season, and the two cheapest wrong answers — mark everyone
absent, or ignore the row — are both worse than paper, where the sheet simply
never gets filled in.

**Recommendation.** Enumerate `ScheduledSession.status ∈ {SCHEDULED, CANCELLED,
COMPLETED}` with a cancel action carrying a reason, and state the three
consequences: cancelled sessions do not appear as unregistered, attendance
cannot be written against them, and the roster is retained. Half a day. Add the
guardian-notification consequence to the R-12 backlog, not to v1.

---

### R-4 — The make-up lesson is "modelled" but the receiving instructor still cannot see the child

**Severity: high.**

D-109 (`01-domain-model.md` §3.2) says make-up lessons are modelled, not built:
`SessionRosterEntry` accepts *"a student who is not a member of the session's
group"* with `source = GUEST`. D-068 (`02-security-privacy.md` §2.1) says the
`SESSION` scope covers *"the receiving instructor of a make-up lesson … needs to
read a guest student for one session"*.

**The gap between those two sentences.** The receiving instructor is the group's
**own** instructor, and they hold a `GROUP` grant, not a `SESSION` grant. §2.2's
coverage table is explicit that `GROUP` covers *"that group, its scheduled
sessions, and … the group-scoped relations of the **students in it**"*. A guest
is by construction not in it.

**The moment it fails.** Sanne missed Tuesday, comes Thursday instead. An
administrator adds a `SessionRosterEntry(GUEST)`. Thursday's instructor opens
the session: eleven names. Sanne is standing in the water and is not on the
screen. For her to appear, an administrator must additionally mint a
`SESSION`-scoped `RoleAssignment` for *that instructor* on *that session* with a
mandatory `validUntil` (D-144) — a per-make-up admin action nobody will do at
16:55, and one that is not in any workflow, screen or requirement.

**Why it matters.** R-38 promises the *data* shape costs nothing now and the
workflow can be added later. That is right about the schema and wrong about the
authorization: the model as specified does not let the ordinary case work at
all, so the "model only" claim is not true — what has been modelled is a roster
row nobody can read.

**Recommendation.** Make `GROUP` coverage read the **roster**, not the group
membership, for sessions of that group: an instructor assigned to a session may
read the students on that session's roster for its window, whatever put them
there. That is one clause in §2.2's coverage table and it removes the need for a
per-make-up grant entirely. It also strictly *narrows* nothing — the guest is
already deliberately placed there by an administrator.

---

### R-5 — A substitute instructor is locked out the morning after

**Severity: high.**

Two decisions collide. `04-ux.md` §4.0(3) commits to post-hoc entry as a
first-class path: *"A v1 used post-hoc from paper is a legitimate, winning v1."*
D-144 (`02-security-privacy.md` §2.1) makes `validUntil` **mandatory at schema
level** for `SESSION` scope, *"typically the session's date, occasionally a
short window around it"*.

**The moment it fails.** Marieke covers Groep A2 on Thursday evening, on paper,
because the hall wifi is bad. Friday morning she opens the app to type it in.
Her grant expired at midnight. `requirePermission` denies (expiry is *"enforced
in `requirePermission` and `resolveReach`, not by a cleanup job"* — correct, and
here it bites). Her options are to ask an administrator to re-issue a grant for
a session that has already happened, or to hand the sheet to someone else, who
then records attendance under **their** name in an append-only log whose entire
justification is *"who said a child was present, and when they changed their
mind, is precisely what must survive"* (D-061).

There is also no *action* that creates a substitute assignment. D-068 names the
substitute as a case the scope type covers; nothing in `04-ux.md` §4 or
`06-delivery.md` builds a screen where a planner says "Marieke covers Thursday",
and `InstructorAssignment` (`01-domain-model.md` §3.2) is a table with no
workflow attached.

**Recommendation.** Default `SESSION` grants to `session.endsAt + N days` with N
a bounded setting (D-150's `bounded` class already exists for exactly this),
defaulting to 7. Keep the mandatory `validUntil`; it is right. And specify the
substitute assignment as a planner action that issues the grant as a side
effect — otherwise the mechanism exists and the button does not.

---

### R-6 — The print fallback only works if someone printed, and nothing makes that happen

**Severity: high.**

`04-ux.md` §4.0(1) is one of the best-argued pages in the set and I agree with
all of it: *"An application that will not load shows nothing at all, and the
instructor standing at the poolside has no move."* R-35 ships a printable class
list. P-02 is declared *"defensible **only** because it exists"*.

**The moment it fails.** The wifi is fine at 18:50 and gone at 19:05. Nobody
printed anything, because printing is a button on a screen you press when you
already expect trouble, and the whole point of the app is that you stopped
carrying paper. The instructor has a tablet showing a spinner and no sheet. The
fallback is real and unreached.

Worse for the pre-emptive case: the application is server-rendered Next.js. With
the network down the app does not degrade to a stale list — it does not load.
There is no cached shell, no service worker, and P-02 explicitly does not ship
one.

**Why it matters.** This is the *first-lesson failure* the same section calls
permanent: *"When the app fails, they go back to paper and never come back."*
The design correctly identifies the risk and then mitigates it with an action
that has to be taken before the risk is visible.

**Recommendation.** Two cheap things, neither of them an offline queue.
(a) Make the printed list a **routine artefact**, not a rescue: a weekly
"print this week's class lists" action, and say in the operator documentation
that it is expected practice for the first term.
(b) Cache the session shell and roster in the browser after it loads, so a
session opened at 18:50 survives the network dropping at 19:05 — the design
already commits to keeping failed writes on screen (§4.1 rule 6); this is the
same promise extended by one page load. Both are days, not weeks.

The procurement line in §4.0(6) — *"If the school buys an iPad, buy the cellular
model"* — is correct and stays. It does not cover the phone with no signal in a
semi-basement hall, which is the common case.

---

### R-7 — The four-eyes independence test has an undefined window, and the two readings give opposite answers in a four-instructor club

**Severity: medium.**

D-085 (`15-assessment-and-fees.md` §3) requires that
`assessorPersonId` is *"**not** among the `InstructorAssignment` holders for that
student's group **over the assessment window**"*. "The assessment window" is
never defined, here or in `01-domain-model.md` §3.2, and
`InstructorAssignment` binds to `groupId` **or** `sessionId` — so a one-evening
substitution creates an assignment of exactly the same kind as a standing one.

**The two readings.** *Narrow* ("assigned on the day of the aftest"): almost
nothing is excluded, and an instructor who taught the group last week may assess
it this week — the control is close to ceremonial. *Broad* ("ever assigned"): in
a club with four instructors who cover for each other, everyone has substituted
for everyone's group at some point, so nobody is independent for anything and
D-085's override becomes the normal path rather than the exception. Both
readings are available to an implementer reading the sentence.

**Why it matters.** D-085's own defence is that the override *rate* is the
signal a chair can act on: *"if it is being used every week that is itself the
finding."* That reporting is worthless if the rule's calibration is an accident
of how one developer read one clause.

**Recommendation.** Define it: independence is broken by a **standing**
`InstructorAssignment` to the child's group (one bound to `groupId`) that
overlaps the aftest date, and **not** by a session-level substitution. State the
reasoning — the relationship the control is about is "their own teacher", not
"someone who once stood in". Then the override rate means something.

---

### R-8 — The aftest screen is specified as a poolside screen and is in fact a seated data-entry screen

**Severity: medium.**

`04-ux.md` §4.7 and `15-…` §4 argue — correctly, and against the design's own
grain — that the thirty-second doctrine must not apply here, and land on *"an
aftest takes ten minutes and that is the correct number."* But §4.7 also
describes the interaction as live: *"[set whole column ▾] with confirmation, for
the criterion the group just did"*.

**The arithmetic.** §4 states the load itself: *"roughly twelve children against
roughly twenty criteria … about 240 ordinal values."* Ten minutes is **2.5
seconds per value**, on a tablet, with wet hands, while simultaneously *watching
twelve children swim* — which is the thing the assessor is actually there to do
and the entire justification for the control. Nobody hits that number, and an
assessor who tries will do the thing D-086 exists to prevent: sweep the column.

**What actually happens.** The aftester watches, makes short notes, and enters
the grades afterwards, seated, from those notes — the same shape as the
attendance-from-the-sheet path the design already blesses in §4.0(3), and the
reason `15-…` §2.1 gives `Assessment.assessedAt` separately from the row's
`createdAt`.

**Why it matters.** The design correctly refuses to make this screen fast and
then implicitly requires it to be. If it is built for the poolside it will be
optimised for sweeping; if it is built for a desk it can be keyboard-first, dense
and resumable, which is what "ten minutes" actually buys.

**Recommendation.** Say plainly that grades are **recorded from notes after the
sitting**, keep per-criterion resume (already specified), design the screen
keyboard-first for a laptop, and keep set-whole-column behind confirmation for
the genuinely uniform criterion. Nothing changes in the model; one paragraph
changes in §4.7 and it changes what gets built.

---

### R-9 — People waiting on the waiting list are deleted by the retention rule

**Severity: high.**

Two rules in `01-domain-model.md` §5 do not compose.

D-066 enumerates every relationship that holds a `Person`: *"an active
`MembershipPeriod`; an active `StudentProfile` enrolment; a role assignment …;
a guardian relationship to a person still held; an unexpired consent record; or
a legal retention ground on a record referencing them."* **A `WaitlistEntry` is
not on that list.** The retention table two pages up gives waitlist entries a
trigger of *"Placement or withdrawal"* — so the entry itself correctly survives
while someone is still waiting.

**The moment it fails.** A parent enquires in March. An `Inquiry` row is written
(D-051 — public forms never write `Person`), promoted to a `WaitlistEntry`,
which requires a `Person` (`01-…` §3.1: `WaitlistEntry | personId, …`). That
person has no membership, no enrolment, no role, no consent record and no legal
ground. Under D-066 their **last relationship of any kind** ended the moment it
began. They enter `REVIEW` and, after the configured period, are deleted —
while their waitlist entry, which the design calls *"The front door"*, points at
nothing. Dutch swim-school waiting lists run months to years; this is not a tail
case, it is the median entry.

A second, smaller version of the same defect: `Inquiry` retention is *6 months
from submission → `DELETE`*, while `WaitlistEntry` holds an optional reference
to it. Six months in, the front door's provenance is gone.

**Why it matters.** The failure is silent, it destroys the pipeline the school
loses prospects on today, and it is caused by the one rule (D-066) the design is
most pleased with — *"Every person category must be covered by construction,
because the one that is forgotten is the one that accumulates indefinitely."*
The forgotten one here does the opposite.

**Recommendation.** Add *"an open `WaitlistEntry`"* to D-066's list, and extend
`Inquiry` retention to the life of any `WaitlistEntry` derived from it. Two
lines. This is the cheapest correction in this review and the one with the most
embarrassing failure mode.

---

### R-10 — `Group.capacity` is nullable and nothing enforces it, on the action the design just made first-class

**Severity: medium.**

`Group | name, courseLevelId?, capacity?, active` (`01-domain-model.md` §3.2).
Nothing anywhere reads it. R-34 and D-108 make `GroupMove` a v1 requirement with
a direction, a reason and a decider — and `04-ux.md` §4.8's group-move row is
*"choose the target group, **give a reason**, confirm"*. No capacity check, no
"this group is full", no waiting-for-a-place state.

**The moment it fails.** The weekly management question in a swim school is not
"is Sanne ready" — it is *"is Sanne ready **and is there a spot in B2**"*. Both
predecessor reports named this and it is still unaddressed. Without the check,
the move screen will happily put a thirteenth child in a group of twelve, and
the person who finds out is the instructor on Tuesday.

**Recommendation.** One query and a soft block: show current occupancy against
`capacity` on the move screen, warn over capacity, allow the override (a group
of thirteen for one week is normal). Hours of work. Also make `capacity` mean
something on the waiting-list placement action (R-33), which has the identical
question.

---

### R-11 — OD-18: contribution tracking (§6.2) should not be built, and OD-18's option table is missing the option that is actually available

**Severity: high.** *(This is the answer to the brief's question 5.)*

OD-18 (`08-open-decisions.md`) frames three answers: SplashTrack takes over
membership, the incumbent stays authoritative and SplashTrack projects it, or
both own different things. The framing is honest and the "most expensive open
item" label is right. Two things are wrong with it.

**First, it is missing the fourth option, which needs no decision from Jack.**
`15-…` §6.2's own text already contains it: *"**§6.3 (exam fees) is unaffected
either way**: an exam fee is created by an event that happens only inside
SplashTrack, and no membership system knows about it."* That is the whole
answer. The exam fee is the only money in this domain that SplashTrack
originates, it is created by D-089 as a side effect of a state change the app
already owns, and it costs roughly two days on top of the `Charge`/`Payment`
tables. Contribution tracking — the `MembershipPeriod × Enrolment` generation
job, the periodic-charge idempotency discipline, the balance view spanning two
fee kinds, the CSV the treasurer reconciles by hand — is the expensive half, and
it is the half the incumbent already does.

**Second, the argument for fees inverts under OD-16's answer.** OD-4 and
`00-…` §3.5.2 both justify billing-lite with: *"without it the school keeps
their existing system and does dual entry, which is the most common reason
software like this is abandoned."* That sentence was written when the incumbent
was assumed to be paper. It is now known that the club runs **a commercial
membership administration system with export** (OD-16). So the dual entry is not
avoided by building contribution tracking — **it is created by it.** Two homes
for one fact, which is precisely what D-134 forbids inside the document and
OD-16 itself flags *"now appearing between systems."*

And the design has not absorbed its own hedge. §6.2 is conditional on OD-18, but
R-32 (`00-…` §3.1) states billing-lite as an unconditional v1 requirement,
`04-ux.md` §1 and §3 give Fees a nav section and a three-level page hierarchy,
`01-…` §1.1 lists `fees` as a v1 module at the top of the DAG, and §5 adds
`Charge`/`Payment` retention rows with D-092's pseudonymisation obligation. Five
commitments and one conditional.

**Verdict.** No — contribution tracking is not worth building. Build **exam fees
only**: `FeeType`, `Charge`, `Payment`, the exam-fee event (D-089), a per-child
balance and the CSV. Drop the periodic generation job, the membership-fee fee
type and the payer-level balance until OD-18 is answered in SplashTrack's
favour, which it may never be.

**What breaks if it is cut.** Nothing operational. The treasurer keeps doing
contributie where they already do it. D-092's financial-retention ground and
pseudonymisation still ship (exam fees are fiscal records too), so the expensive
compliance work is not deferred, only its volume. D-093 (arrears never on the
poolside surface) is unaffected and stays — it is right.

**What this also settles.** OD-18 stops being blocking. The only question left
for Jack is the one OD-16 already asks — can we have a sample export — and that
question belongs to R-29's importer, not to chapter 15.

---

### R-12 — Column encryption survived the re-cut without being discussed, and then grew

**Severity: medium.**

`report-realist-round2.md` §E1 listed *"**D-013** column encryption + **OD-7**
key management"* as out of v1, keeping D-010 (medical behind its own
permission), D-040 (encrypted backups) and the `v1:` envelope prefix. That row
is **absent from `00-overview.md` §3.5.1**, which takes every other cut on the
same list. Nothing anywhere records the reversal or argues for it.

Meanwhile the scope went the other way. OD-7 closed on 2026-09-02 against three
decisions — D-112 (`SECRET_KEY_FILE` root, HKDF per purpose), D-114 (two-level
envelope, Argon2id over a printed recovery token, per-archive data keys,
rotation re-wraps the master key) and D-096 (`v1:<keyId>:<nonce>:<ct>` with AAD
binding table, column, primary key and key id) — and D-148 **extended** the
encrypted class from medical/pastoral notes to *"assessment remarks and inquiry
free text"* (`02-…` §4). `06-delivery.md` §5 then ranks the encryption envelope
**#1 in the whole build order**: *"Nothing that stores a secret may be written
first."*

**Why it matters.** The threat this control addresses is a database dump
obtained without host access. On the deployment this product is designed for —
one Docker Compose stack, `SECRET_KEY_FILE` on the same filesystem as the
volume — that attacker is rare and the one who matters (a copied backup) is
already covered by D-040, which is kept. So the first two weeks of the build go
to a control whose premise §3.5's own reasoning undercuts, and the extension to
inquiry free text encrypts the contact form.

I am **not** confident enough to call this a cut. The counter-argument in
`02-…` §5.4 — that a parent's first email is often *"mijn zoon heeft epilepsie
en is bang in het water"*, i.e. Article 9 data arriving through the public form —
is a real reason to encrypt inquiry text, and it is a better argument than the
one the design gives for D-013 generally.

**Recommendation.** Decide it on the record rather than by omission. Either add
D-013 to §3.5.1 with the reasoning above, or add a row to §3.5 explaining why
the round-2 recommendation was rejected. What must not stand is a build order
whose #1 item is a control the scope chapter is silent about. Keeping the `v1:`
envelope *format* and the AAD design costs about a day and preserves the option
either way — that part of D-096 should ship regardless.

---

### R-13 — The product can record everything about a lesson and tell nobody anything

**Severity: high.**

There is no outbound communication to guardians anywhere in v1. P-06 defers
*"Notifications beyond transactional email"*; the guardian portal is committed to
v2 (OD-5); `07-operations.md` §1.4 ships notification delivery **for
high-severity security events**, to operators. Grep for a guardian-facing message
of any kind across the active chapters returns nothing.

**The moment it fails.** Three of them, weekly to termly:
- The pool closes on Thursday. Twelve families need to know today (and R-3 means
  the app cannot even represent the cancellation).
- Sanne is confirmed for the exam on 14 March. Her parents need the date, the
  time and the fee that D-089 just created — and D-093 correctly forbids putting
  the fee anywhere an instructor would mention it.
- Sanne moves from B2 down to B1. D-108 makes the reason a required field
  precisely so a parent is not left to guess — *"A parent reading 'moved from
  Group 4 to Group 3' with no reason attached draws the worst conclusion
  available"* — and then the reason is stored where no parent will ever read it.

**Why it matters.** Every one of those messages is sent today, by WhatsApp, from
someone's personal phone. SplashTrack does not have to win that; it has to not
make it worse. D-108's required reason is currently a cost with no beneficiary.

**Recommendation.** One screen: **send a message to the guardians of a group, or
of a session's roster, from a template.** The `email-templates` and
`notifications` modules are inherited and working (`01-…` §1.1), and
`PersonRelationship(GUARDIAN_OF)` already gives the recipient list. This is
days, not weeks, and it converts three recorded facts into three delivered ones.
It is not the portal and it does not pre-empt OD-5.

---

### R-14 — `EXCUSED` exists with no way for anyone to excuse anybody

**Severity: medium.**

`AttendanceEvent.state ∈ {PRESENT, ABSENT, EXCUSED, LATE}` (`01-…` §3.4), and
`04-ux.md` §4.1 gives *"long-press = EXCUSED/LATE + note"*. There is no inbound
channel that could tell the instructor a child is excused: no guardian portal
(v2), no form, no email intake, no absence link.

**The moment it fails.** Every week. A parent texts the instructor's personal
phone at 17:30. At 19:00 the instructor long-presses EXCUSED from memory, for
the children whose message they happened to see. The distinction between ABSENT
and EXCUSED — which is the whole point of having both, and which feeds any
future absence policy — is recorded on the basis of which parent had which
instructor's number.

**Why it matters.** It is not that the data is missing; it is that the data is
*wrong in a way nobody can see*, in the append-only log the design calls
evidence. Round 1 proposed the fix and round 2 dropped it without argument.

**Recommendation.** The cheapest version that works and needs no portal: a
signed, per-(session, student) link emailed or messaged to the guardian, that
writes an `EXCUSED` event with `source = GUARDIAN` and no login. Half a week.
If even that is too much for v1, then say plainly in `04-ux.md` §4.1 that
EXCUSED is instructor-asserted hearsay in v1, so nobody builds an absence report
on it later believing otherwise.

---

### R-15 — "Trial lessons: model only" does not actually make a trial cheap

**Severity: low.**

D-109 and R-38 say trials are modelled but no workflow is built:
`Enrolment.status = TRIAL`, `StudentLifecycleEvent.TRIAL_ATTENDED`, and a
`SessionRosterEntry` that accepts a non-member. The trade-off is stated as
*"A school that does run trials and make-ups administers them by hand — a guest
added to a roster, a note in the reason field."*

That understates it. `SessionRosterEntry` references `studentProfileId`, so a
child who comes once to see whether they like it needs the full `04-ux.md` §4.5
path first: search Person → create Person → create StudentProfile → create
Enrolment → guardian relationship → consent. Six steps and a consent record for
someone who may never return, before they can appear on a roster at all.

**Why it matters.** Barely, for Jack — his school does not run trials, and I
agree with the decision not to build the workflow. It matters for the claim: the
design says the model is there so the workflow is cheap later, and what is
actually there is a model that makes the workflow *possible*, not cheap.

**Recommendation.** Leave it. Correct D-109's trade-off sentence so a future
reader does not plan a half-day around it.

---

### R-16 — Two groups in one pool at the same hour is normal, and nothing models it

**Severity: medium.**

`Location | name, address?, capacity?` and `ScheduledSession | groupId,
locationId, startsAt, endsAt, status` (`01-…` §3.2, §3.4). Nothing prevents two
sessions in the same location at the same time, and nothing represents the thing
that makes that legitimate: **lanes**. `Lane` appears exactly once in the design
set, in OD-10's glossary list (*"`baan` → `Lane`"*), as a term to translate. It
is not an entity.

**The moment it fails.** 19:00 on Tuesday: A1 in lanes 1–2, B2 in lanes 3–4,
two instructors, one pool. The design can express both sessions, cannot express
that they are compatible, and cannot warn when the planner double-books lanes
1–2. `Location.capacity` is a single number that means "people", which answers a
different question.

**Why it matters at the poolside.** It is a planning-quality problem, not an
operational stop — the lesson happens whether or not the app knows. But
`00-overview.md` R-10 promises *"Planning: lessons, groups, locations,
instructors, **resources**"*, and this is the resource that exists.

**Recommendation.** Given R-2 already requires opening up `planning`, add a
`Lane` (or generic `LocationResource`) with an optional assignment on
`ScheduledSession` and a conflict check in the generator. If that is a week too
far, cut R-10's word "resources" rather than leaving a requirement with no
model behind it.

---

### R-17 — The build order schedules the season generator after everything that needs a season

**Severity: medium.**

`06-delivery.md` §5, Phase 3: *"`people → students → groups → courses → skills →
sessions → attendance → assessment → exams → planning → fees`"*, with the sound
warning *"Attendance is the flagship and it sits on five modules. Resist
starting there."*

The DAG order is right and the *delivery* order is wrong. `planning` is tenth of
eleven, so for the entire build — including every manual test of attendance,
skills, aftesten and exams — sessions exist only as rows somebody inserted by
hand or seeded. The first time anyone finds out whether a season can be
generated at all is after ten modules are built on top of the assumption that it
can.

**Why it matters.** R-2 says planning is unspecified. This says that even once
specified, the current plan discovers its problems last. Recurrence with
holiday exceptions is also the one piece of this domain with genuinely fiddly
edge cases (a moved lesson, a double week, a block that starts mid-holiday), and
it is the piece scheduled when the budget is gone.

**Recommendation.** Move the recurrence primitive and the closure calendar into
`sessions` and build them **with** `sessions`, before `attendance`. The rest of
`planning` (locations, resources, instructor assignment screens) can stay where
it is. It also makes the DEV seed honest: a synthetic dataset generated the way
production generates it.

---

### R-18 — `COURSE` scope has no v1 holder that `SESSION` does not cover, and the scope-escape gate does not test it

**Severity: medium.**

`02-…` §2.1 keeps five scope types plus `SELF`. `COURSE`'s only example is
*"Examiner for Diploma B"*, and §2.4's only holder is *"Internal examiner |
`COURSE`, time-bounded | Assesses any exam session of that course"*. But D-068
moved the external examiner and the aftest assessor to `SESSION`, and §2.2 shows
`COURSE` covers *"that course, its levels, its enrolments, and **all** its exam
sessions"* — which is exactly the over-grant D-068 rejects one page later:
*"`COURSE` scope over-grants every one of these — an assessor would gain every
future aftest and exam of that course, past and future, on exactly the records
that matter most."*

Then the gate that is supposed to catch scope escape does not cover it.
`06-delivery.md` §2.1's mandatory per-module cases are `GROUP`, `UNIT`,
`SESSION` and reach construction. **`COURSE` and `SELF` are absent from the
table** — two of the six scope types, one of which (`SELF`) has an explicitly
enumerated permission set that D-122 calls a security-relevant change to extend.

**Why it matters.** A scope type nobody in this club needs, that over-grants on
the product's most sensitive records, and that the most important gate in CI
does not exercise, is three separate reasons pointing the same way.

**Recommendation.** Drop `COURSE` from v1 — an internal examiner gets `SESSION`
per exam session (which is how the exam day works anyway) or `ORGANIZATION` if
they are the coordinator. That leaves `ORGANIZATION | UNIT | GROUP | SESSION |
SELF`. Independently and regardless: add `COURSE` (while it exists) and `SELF`
to the scope-escape table, or the gate's guarantee is partial in exactly the
place it is asserted to be total.
