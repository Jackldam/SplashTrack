# Phase 1.8 — lane assignment

**Branch** `build/v1-foundation` · **from** `94bb462` (615 tests) · **to** the head
of this branch (641 tests) · **not pushed**.

Opened by the fifth instance in one week of a single defect:

> **A capability exists in the model or the service layer and nothing reaches
> it.** `/groups` had no link in. `createLane` had no caller.
> `deactivateRecurrence` had no caller. A closure could not be corrected.
> And `SessionLane` — a lesson's lanes, many-to-many, owned by `sessions`,
> classified for retention, present in the schema since phase 1.6 — **was never
> written by any line of code in this application.**

A club could say which pool a group swims in and not which lanes. That is the
half of the answer that matters the moment two groups share the water, and it is
most of what a swim school's timetable is *for*.

This one had waited on a domain answer, which arrived:

> *"Vaak ligt het het seizoen vast, een enkele keer wisselt het."*
> — Jack, swim instructor at the club, 2026-09-06

---

## 1. The model, and why that shape

**Lanes are an attribute of the *lesreeks*.** D-190. Not of the lesson, because
choosing lanes every week for a fact that changes once a season is exactly the
per-week cost the sentence above rules out. Not of the group or the club,
because then the *"enkele keer"* would be inexpressible.

So: `RecurrenceLane` holds a season's selection, every lesson the rule generates
inherits it, and one lesson may carry its own.

### 1.1 Inheritance is by reference, which is what makes it free

A generated lesson stores **nothing**. It stores `recurrenceId`, which it has
carried since phase 1.6, and its lanes are read through it. Thirty-six Tuesdays
inherit three lanes by pointing at one row, not by copying three rows
thirty-six times, and `generateSessions` was not changed at all.

That is also the whole of the *future* half of propagation: change a season's
lanes and every lesson that still inherits already says the new answer, because
it never said anything of its own. It is not implemented; it is a consequence.

`tests/integration/lane-assignment.test.ts` asserts it as a property rather than
trusting it — after a season is set up and a term generated, `SessionLane` holds
**zero** rows and no lesson carries a marker.

### 1.2 Three states, and the marker column that makes them distinguishable

| `ScheduledSession.laneSource` | Means | Rendered |
|---|---|---|
| `NULL` | Inherits its recurrence's lanes. The ordinary case. | *van de lesreeks* |
| `OVERRIDE` | A **person** chose these lanes for this lesson. | *afwijkend* |
| `PINNED` | **Nobody** chose them; the application froze them. | *vastgelegd* |

The column is the load-bearing part and it is worth saying why a join table
alone cannot do the job. "This lesson has no `SessionLane` rows" is ambiguous
between *"it inherits"* and *"somebody deliberately gave it no lanes"* — and
both are real. *"Deze week geen vaste baan"* is a decision that must survive the
next change to the season exactly as any other override does. Without a marker
it is indistinguishable from a lesson nobody has touched, and the next
propagation would silently overwrite it.

`PINNED` is a third value rather than a reuse of `OVERRIDE`, and that is
entirely about the reader. Telling somebody they deliberately changed fourteen
past lessons they never touched is a lie the schedule would tell them every time
they opened it.

---

## 2. What changing a season's lanes does — the decision, argued

The brief asked me to argue this rather than pick silently. The instinct it
offered — *future non-overridden lessons follow, past ones never change* — is
what I built, and one of the three rules is not free, which is the one worth the
argument.

### Rule 1 — an override is never touched

The requirement, not a judgement call. An override is a deliberate act and
silently reverting one is the class of surprise that makes people stop trusting
a schedule. Implemented as `where: { laneSource: null }` on the propagation.

### Rule 2 — a future non-overridden lesson follows

Free, by §1.1. And right: *"vanaf nu zwemmen we in baan 4 en 5"* is what a person
means when they change a season's lanes. A change that left next week alone would
leave them editing thirty rows by hand, which is the per-week cost the inherit
model exists to avoid.

### Rule 3 — a lesson that has already happened keeps the lanes it was taught in

**This one costs something, which is why it is the one an implementation
quietly drops.** Pure by-reference inheritance would give the past for free —
and would be wrong.

A schedule is not only a plan. It is read backwards, as the club's own record of
what it did, and *"waar zwommen we op 12 maart"* has one true answer that is not
*"wherever the rule happens to say today"*. Attendance will hang off these same
rows in a later phase, and an instructor reviewing a lesson is looking at the
water that lesson was in. Rewriting it silently is the same failure as reverting
an override, one table over.

So the previous lanes are **copied onto every already-started non-overridden
lesson and marked `PINNED`**, in the same transaction as the change. The cost is
paid **once**, at the moment somebody changes a season, and is proportional to
lessons already taught — a few dozen rows and one audit event. The budget that
mattered was *per week*, and per week it is still zero.

### The boundary is `startsAt <= now`, and nothing else

Not the status. A cancelled lesson is in the past or it is not, on the same clock
as every other one; making cancellation part of the rule would mean two rules to
explain and a lesson whose lanes move when somebody calls it off.

### The case that looks like an edge and is not

**Setting a season's lanes for the *first* time, after lessons have been taught,
pins those lessons with the empty set.** They render as *vastgelegd — geen
banen*, which is true: nobody recorded lanes for them at the time.

The alternative — letting the first assignment reach backwards — is the rule-3
violation wearing a friendly face, and it is the one an implementation that only
copies *rows* falls into by accident: with no lanes to copy there is nothing to
write, the lesson keeps inheriting, and it silently acquires lanes it was never
swum in. That is asserted on its own (`pins a past lesson that had NO lanes`),
and it is the reason the marker is a column rather than a row count.

Nothing is written when the selection did not change — otherwise pressing save on
an unchanged form would freeze a whole season's past and append an audit event
saying something happened. Same rule `updatePool` follows, same reason.

---

## 3. The surfaces

Dutch, server-side authorization before anything renders, every write audited.

### 3.1 On the recurrence — and on the rule that exists, not the form that makes one

`/groups/[groupId]/schedule`. Each rule in the list carries a *Banen voor deze
lesreeks* disclosure with a checkbox per lane.

**It is not on the create form, and that is a decision.** The lanes a person may
choose are the lanes of *that rule's pool* — and the create form has a `<select>`
the person is about to use, not a pool. Narrowing a lane list to it without
client JavaScript is not possible. The alternative is offering every lane in the
club and refusing the wrong ones after the submit, which is a refusal the person
did nothing to earn. So: create the rule with its pool, then choose its lanes,
and the second step is exact.

That step has to exist anyway. The whole reason lanes live on the recurrence is
that they change once a season, and *changing* them is this screen.

Checkboxes and not a multiple `<select>`: many-to-many is the real shape, and a
multi-select on a phone at the poolside is a control almost nobody operates
correctly. A rule with no pool, or a pool with no lanes, says so — the second
points at the screen that fixes it — rather than rendering an empty form.

The season's lanes are also on the rule's own line, above the fold. Under it they
would be invisible on the screen that decides where a group swims, which is the
defect a lane reaching no screen at all had.

### 3.2 On the lesson

`/groups/[groupId]/sessions/[sessionId]`: the lanes, a badge naming which of the
three states this is, a checkbox form to override, and — when it is not
inheriting — *Weer de lesreeks volgen*.

The boxes are pre-ticked with the **effective** lanes, inherited or not, so
"swap one lane" is one click rather than re-entering the set from memory. The
choices come from the read that already knows this lesson's pool, so every option
on offer is one the service will accept.

**The way back is not optional.** An override entered on the wrong lesson is an
ordinary mistake, and without a clear path the only repair would be re-typing the
season's lanes onto that lesson — which looks identical on screen and is not the
same row, so every later change to the series would skip it for ever. That is
asserted: after clearing, a *subsequent* change to the recurrence reaches the
lesson.

### 3.3 Reading it at a glance

| Surface | What it badges | Why |
|---|---|---|
| Schedule table | `OVERRIDE` and `PINNED` only | An *inherited* badge on thirty-five of thirty-six rows is noise that hides the one row it exists to point at. |
| One lesson's page | all three | The page is about one lesson, so *"these are the season's lanes"* is the answer somebody opened it for. |

---

## 4. Authorization, and the refusals

`planning.manage` on all three writes, checked in the service and never inferred
from the page that rendered the form — a Server Action is reachable by POST
without it. `setRecurrenceLanes` guards on the recurrence's **own** group, read
from the row; the two session writes guard on `{ session }`, so a `SESSION`-scoped
grant reaches its lesson and nothing else (D-068).

The guard runs **before** the row is read on every path, so aiming at a
non-existent id still yields a denial rather than an existence oracle.

New `ScheduleError` reasons, each with a Dutch sentence rather than a 500:

- `laneNotInPool` — the lane does not exist, **or** is in another pool. One
  refusal for both deliberately: they are the same thing from the caller's side,
  and separating them answers *"does lane X exist"* for anybody who can reach the
  endpoint.
- `laneWithoutPool` — lanes chosen for a series or lesson that names no pool.
  A lane with no pool is not a place.
- `laneUnknown` — the selection was not a list of ids, or exceeded
  `LANE_SELECTION_MAX` (32; the club has nine).

Lane membership of a pool is checked in the service and not by a foreign key,
because a lane's pool is one join away from a recurrence and Postgres cannot
express that in a constraint. The pool is always read **from the row**, never
taken from the form — a `poolId` on the form would be a field an attacker could
change to put somebody else's lanes on a lesson, and it would buy one query.

---

## 5. The reachability check — built, and proved to fail

Phase 1.7 named this class of defect and fixed four instances of it **without
building the mechanism**, so phase 1.8 opened with a fifth. `tests/unit/service-reachability.test.ts` is the mechanism.

**Every write re-exported from a module's `./application/` layer must be named by
something under `src/app`.** Application services only — `./domain/` is pure
functions and `./infrastructure/` is repositories, and requiring a screen to name
`resolveTimeZone` would be noise that trains people to extend the allowlist.
Writes only — a read with no caller is a dead query; a write with no caller is a
promise the product does not keep, and every one of the five was a write.

**Verified by making it fail.** A temporary `deleteUnreachableThing` was exported
from `sessions`, and:

```
FAIL tests/unit/service-reachability.test.ts > every write a module exports is
     reachable from a screen > has a surface calling it, or an allowlisted reason not to
AssertionError: sessions: deleteUnreachableThing
  Each of these is exported from a module and called by nothing under src/app.
  Tests  1 failed | 3 passed (4)
```

The export was then removed and the file is green. The test also pins the five
capabilities by name, so a parser change that stopped seeing them cannot leave
the check green and useless.

**The allowlist is empty and *"not built yet"* is not a reason to add to it** —
that is precisely the state this test exists to make visible. If a service is
ahead of its screen, the honest form is not to export it.

A second, deliberately non-failing assertion reports how many *reads* no surface
reaches. Some are legitimately internal, so forcing the rule there would be
inventing one; a count that drifts upward is still worth seeing.

---

## 6. The seven deferrals, reviewed

Each checked against the code rather than against the report.

| | Still right to defer? | Finding |
|---|---|---|
| **D‑1** organisation settings have no screen | **Yes** | See below — it is the pattern, and it is already handled honestly. |
| **D‑2** member/pupil number not correctable | **Yes**, unchanged | No `updateMemberNumber`/`updateStudentNumber` exists anywhere. No orphaned capability. Still needs the domain answer about numbers other people already hold. |
| **D‑3** relationship authority/evidence | **Yes**, unchanged | No `updateRelationship` exists. The evidence column is encrypted (D‑096), so a correction path must be written with the envelope in mind. |
| **D‑4** assignment/placement made by mistake | **Yes — and the report understated it** | See below. |
| **D‑5** a cancelled lesson cannot be un-cancelled | **Yes**, unchanged | No service exists, deliberately. `ScheduledSession_cancellation_shape_check` was written with this case explicitly in mind. |
| **D‑6** recurrence weekday/time not editable | **Closed, not deferred** | Unchanged: stop-and-create *is* the correction, and the screen supports it. |
| **D‑7** a closure cannot be removed | **Yes**, unchanged | No delete path exists. Adding one to a module whose index deliberately exports none is a decision, not an implementation. |

**None of the seven is a capability with no surface** — so none of them was this
pass's business under the brief's rule. Two need expanding.

**D‑1 is the pattern, and it is the one honest instance of it.**
`writeOrganizationConfig` is a write that no surface reaches. But it is
deliberately **not exported** from `@/lib/settings`, and its own doc comment says
so and says why: *"it exists now only so the strict validator has an exercised
write path and so the shape of the eventual service is fixed rather than invented
later."* That is exactly the form §5 prescribes for a service ahead of its screen,
which is why the reachability check does not fire on it and should not: it reads
module barrels, and this is not in one. The screen itself is a settings module,
not something to graft on here. **Defer stands.**

**D‑4 is worse than phase 1.7 recorded, and the correction is worth having.**
The report says a mistaken assignment *"can only be ended, which leaves a
zero-length interval"*. It cannot. `assertClosable` refuses `toDate <= fromDate`,
and `InstructorAssignment_window_order_check` / `GroupMembership_window_order_check`
refuse it at the database — both correctly, since a zero-length half-open interval
is active for no instant at all. So an assignment created by mistake **today**
cannot be ended today; the earliest end is tomorrow, and until then the
instructor can read that group's pupils. That sharpens the case for deferring
rather than weakening it: the fix is the append-only question *"does a mistaken
row disappear or stay as a closed interval"*, not a date-validation tweak.

### 6.1 What the 1.7 sweep missed, and why it is worth naming

The sweep table has twenty-two rows and none of them is *lanes on a lesson*. The
nearest is `/groups/[id]/schedule — pool choice`, marked `n/a` because a pool
choice creates nothing to correct. That was true of the pool and blind to the
lane: the sweep asked *"can a mistake made on this surface be repaired?"* and
never *"is there a capability with no surface at all?"*. Both questions matter and
only one was asked, which is how a table of twenty-two surfaces missed a whole
table in the schema. §5 is the answer, because a checklist is not a mechanism.

### 6.2 One invariant this pass deferred on purpose

`laneSource` is set **if and only if** `SessionLane` rows exist. It is held by
`lane-assignment-service.ts` in one transaction and pinned by
`lane-assignment.test.ts` — **not by the database.**

It spans two tables, so a CHECK cannot state it; the shape that could is a pair
of triggers. **This schema contains no triggers and no functions at all**, and
`applyRoleModel` (ADR‑0002 / D‑182) reassigns ownership of tables and sequences
only — so a plpgsql function added here would be the first database object with
no home in the role model. That is a decision about the schema's mechanisms, not
an implementation detail of lane assignment.

What it would take: two trigger functions (one `BEFORE INSERT OR UPDATE` on
`SessionLane`, one deferred `CONSTRAINT TRIGGER` on `ScheduledSession`, because
clearing deletes rows and clears the marker in one transaction and an immediate
trigger would fire on whichever statement ran first), plus extending
`applyRoleModel` to own functions and `groups-and-sessions-constraints.test.ts`
to name them. I wrote the triggers, read the ownership model, and took them back
out.

---

## 7. Definition of done — run, not claimed

| Check | Result |
|---|---|
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid 🚀` |
| `npm run typecheck` (`tsc --noEmit`) | clean |
| `npm run lint` | clean |
| `npm run format:check` | `All matched files use Prettier code style!` |
| `npm run build` | 16 routes, compiled |
| `npm test` — before | **615 passed** (49 files) |
| `npm test` — after | **641 passed** (51 files) |
| `db:recreate && migrate deploy` on a **scratch** database | `splashtrack_scratch_18`: *All migrations have been successfully applied* + *Role model in force … (applied as `splashtrack_owner`)*. Dropped afterwards. |
| the same **against a populated database** | `splashtrack_migrationcheck_populated`, below. Dropped afterwards. |

UAT was never dropped, reset or migrated — `splashtrack_uat` exists on the same
server and was not connected to. Nothing was pushed.

### 7.1 The migration, against rows

A fresh replay cannot catch the failure that matters. Prisma replays migrations
against **empty** tables, so an unsafe `ADD COLUMN … NOT NULL` with no default
succeeds locally and in CI and fails with P3009 on an incrementally-upgraded
database — blocking every later migration until an operator resolves it by hand.
`tests/unit/migration-safety.test.ts` catches the regex; it cannot catch the
behaviour, so this was run:

```
=== 1. migrate to the state BEFORE lane assignment ===
All migrations have been successfully applied.

=== 2. put rows in the table the new migration alters ===
inserted 1 group, 1 recurrence, 3 lessons

=== 3. apply the new migration to the POPULATED database ===
Applying migration `20260906130000_lane_assignment`
All migrations have been successfully applied.

existing lessons after the upgrade: [
  { id: 's0', laneSource: null },
  { id: 's1', laneSource: null },
  { id: 's2', laneSource: null }
]
RecurrenceLane: "RecurrenceLane"
```

`null` on all three is the result worth reading: every lesson that already
exists on the owner's UAT instance was generated before lanes could be assigned,
so it inherits an empty set — which is what `laneSource IS NULL` says. That is
why the column is added **nullable with no default** rather than defaulted to a
value that would claim somebody had chosen something.

The script was written for this run and deleted; it is nine lines of `pg` around
two `migrate deploy` calls with the new migration directory temporarily moved
aside.

### 7.2 The lint failure I nearly shipped

`npm run lint` failed on `service-reachability.test.ts` — `@next/next/no-assign-module-variable`, a parameter named `module`. I did not see it, because I had piped the command through `tail -3`, which reports the exit status of `tail`. Renamed and re-run without the pipe. Recorded because the mistake was in how I *ran* the check, not in the code, and that is the kind that repeats.

---

## 8. New tests

`tests/integration/lane-assignment.test.ts` — 22 assertions against a real
Postgres, through the real services, with the real `ScopeRelations` of all three
modules registered. `NOW` sits **inside** the generated term on purpose: the
March lessons before it are the past rule 3 pins and the ones after it are the
future that follows, and a `NOW` outside the term makes one of the two halves
untestable.

The five the definition of done names:

1. **Generated sessions inherit the recurrence's lanes** — and store nothing
   doing it (`SessionLane` count 0, marker count 0).
2. **An override on one session leaves its neighbours untouched** — and leaves
   the recurrence untouched, which an override that wrote through would not.
3. **Clearing an override returns that session to inheriting** — proved by a
   *subsequent* change to the recurrence reaching it, which is what an
   implementation that merely copied the season's lanes onto the lesson would
   fail while looking identical.
4. **Changing the recurrence behaves as decided, with the deferred cases pinned**
   — overrides untouched, future moved, past pinned; the empty-past case; the
   no-op case; the other-series case; and the audit event's `pinnedSessions`
   count.
5. **A lane assignment without `planning.manage` is DENIED** on all three paths,
   changes nothing, and denies before reading the row.

`tests/unit/service-reachability.test.ts` — 4 assertions, §5.

---

## 9. The question I stopped on

**Can a lesson be moved to another pool?**

Not asked and not built. A session's `poolId` is copied from its recurrence at
generation and there is no surface that changes it — so *"het instructiebad is
in onderhoud, we zwemmen deze week in het wedstrijdbad"* has no answer, and the
lane override cannot supply one: the override is validated against the lesson's
own pool, which is still the closed one.

I did not build it, because the shape is not obvious and it is a different
decision from this one:

- A **per-lesson pool override** is the mirror of what this pass built, and would
  need the same three-state treatment. Cheap, symmetric, and it makes the lane
  override's validation depend on a second override on the same row.
- **Cancel and hand-schedule** is the path the application already has. Honest —
  the lesson genuinely moved — but a hand-scheduled lesson has no `recurrenceId`,
  so it inherits nothing and the club re-enters the lanes by hand, which is the
  per-week cost D-190 exists to avoid.
- **Nothing**: the club moves the lesson in real life and the schedule keeps
  saying the old pool. Which is what it does today, silently.

The real question underneath is whether the *pool* is a season attribute the way
the lanes now are, and that is a domain question with an answer I do not have.
Everything that does not depend on it shipped.
