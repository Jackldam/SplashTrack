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
nullable field nothing checks (R-11).

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
| Column encryption + envelope + rotation | 1 | 1.5 | **Grew** — see R-10 |
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
