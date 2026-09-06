# Phase 1.9 — correcting a lesson series

**Branch** `build/v1-foundation` · **from** `4a5ba47` (641 tests) · **to** the
head of this branch (657 tests) · **not pushed**. **No migration**, and §5 says
why that is a finding rather than an omission.

Opened by one sentence from the person who teaches at the club:

> *"Ook een lesreeks die is aangemaakt, kan ik niet meer bewerken."*
> — Jack, swim instructor, 2026-09-06

Phase 1.7 had already recorded that as answered, and phase 1.8 re-reviewed it
and agreed:

> **D‑6** recurrence weekday/time not editable — **Closed, not deferred.**
> Unchanged: stop-and-create *is* the correction, and the screen supports it.

---

## 1. That answer is wrong, and here is the count

Three facts, each read from the code rather than from the report:

1. `deactivateRecurrence` (`recurrence-service.ts`) sets `active: false` and
   **touches no `ScheduledSession` at all**. Deliberately: the rows it produced
   point at it through `recurrenceId`, and deleting the rule would orphan them.
2. The idempotency key is `@@unique([recurrenceId, occursOn])`
   (`schema.prisma`) — **per rule**, not per group and not per date.
3. Generation is `createMany({ skipDuplicates: true })` against that index
   (`schedule-service.ts`).

Together those say a replacement series **cannot** deduplicate against its
predecessor's lessons: it carries a different `recurrenceId`, so every row it
plans is new to the index. The first series' lessons are still on the timetable
and nothing removes them.

That is not an argument, it is an assertion, so it is written as one. From
`tests/integration/recurrence-correction.test.ts`, running phase 1.7's own
procedure — stop the rule, create another at the corrected time, generate:

```
✓ stop-and-create puts two lessons on the same evening
    march24 → 2 rows, wall clocks ["18:00", "18:30"]
✓ correcting the rule in place leaves one lesson that evening
    march24 → 1 row, wall clock "18:30"
```

**So stop-and-create is not a correction; it is a duplication.** For a club that
had already generated a term — which is the only club that would notice the
mistake — following the documented advice makes the schedule worse than leaving
the wrong rule alone.

Phase 1.8's §6 said it reviewed each deferral *"against the code rather than
against the report"*. For D‑6 it did not; it reviewed it against phase 1.7. The
row is struck through in that report now, with a pointer here.

---

## 2. What propagation does, and why it is not a new decision

The brief for this pass asked for the rules to be tested against the code rather
than adopted. They were, and D-190's answer holds — because its reason was never
about lanes:

> A schedule is not only a plan. It is read backwards, as the club's own record
> of what it did.

That is a property of the timetable. So the same four rules apply, and the only
thing that changes is the arithmetic.

| | Lanes (D-190) | Time, length, weekday, pool (D-191) |
|---|---|---|
| How a lesson holds it | **by reference** — `recurrenceId` | **by copy**, written at generation |
| The past | costs a write (`PINNED`) | **free** — frozen by not being written |
| The future | **free** — it never stored anything | costs a write per lesson |

**The mirror image.** In phase 1.8 the expensive half was rule 3 and the report
noted it is *"the one an implementation quietly drops"*. Here rule 3 is free and
**rule 2 is the one that is easy to drop**, so `moves the lessons still to come
and leaves the ones already taught` asserts both halves in one loop.

### Rule 1 — a deliberate deviation is never reverted

**Vacuous today, and stated anyway.** Nothing in this application changes one
lesson's `startsAt` or `poolId` — phase 1.8 §9 stopped on exactly that question
and left it open — so every future occurrence still follows its rule by
construction and there is nothing for the propagation to exclude.

A `timeSource`/`poolSource` marker column beside `laneSource` was **not** added.
A column with no surface is the defect `service-reachability.test.ts` exists
for, and phase 1.8's own §5 says the honest form is not to ship it. What the day
a per-lesson reschedule arrives needs is written into the service header instead:
it must carry a marker, and this propagation must skip it.

### Rule 2 — a future lesson follows

*"Vanaf nu beginnen we om half zeven"* is what a person means, and it is the
whole reason to correct a rule rather than edit thirty rows. Each future lesson's
`startsAt` is recomputed with `wallClockToInstant` on **its own date**, which is
the generator's rule and not a detail: a term spanning the last Sunday in March
would otherwise be an hour out for half of itself. Asserted separately
(`keeps the wall clock across the March change of offset`), because an
implementation that shifted `startsAt` by a fixed number of milliseconds passes
every other assertion in the file.

### Rule 3 — a lesson already taught never moves

The boundary is `startsAt <= now` and nothing else — **not the status**, the same
sentence D-190 uses, so there is one rule to explain rather than two.

### Rule 4 — a cancelled lesson stays cancelled

`status`, `cancelledAt` and `cancellationReason` appear in no write in this
service, so a cancellation cannot be undone by a correction. That is by
construction rather than by a check, which is the same shape
`ScheduledSession_cancellation_shape_check` gives it at the database: half a
cancellation is not a cancellation, and this service never writes either half.

**A future cancelled lesson MOVES, and stays cancelled.** This is the one place
the brief's phrasing and the implementation could have diverged, so it is worth
the paragraph. Leaving the cancelled lesson on the old date looks like the
cautious choice and is the opposite: the corrected rule then generates a fresh
`SCHEDULED` lesson that week beside the abandoned one, and **a time correction
silently reopens a week the club called off** — precisely the outcome
"een afgelaste les blijft afgelast" is there to prevent. Asserted as
`is not silently reopened by the correction`: after the move and a regeneration,
that week holds exactly one lesson and it is `CANCELLED`.

---

## 3. The weekday, which is the half that touches the idempotency key

`occursOn` is not an ordinary column — it is one of the two things that make
generation idempotent. Moving it is therefore the part that can quietly
reintroduce the defect in §1.

**Forward always.** The shift is `(new - old + 7) % 7`, which is 0–6 days, so a
lesson lands inside the week it belonged to and never before it. A signed offset
would move Thursday 26 March to Tuesday 24 March — a date that has already
passed, on a rule that never taught it. Asserted as `never moves a lesson
backwards into a past it did not happen in`.

**No collisions, at any point.** Every future row shifts by the same constant, so
the seven-day spacing is preserved and no moved date can coincide with another
of this rule's dates. They are written newest-first anyway, so no intermediate
state of the transaction can violate the unique index either.

**`startsOn` is carried forward, and that is load-bearing.** It becomes the first
occurrence the rule still owns. Without it, a rule claiming to start in September
while its September lessons sat on the old weekday would, on the next generation
run over a past window, produce a second set of lessons for **every week the club
has already taught** — the §1 defect, arriving later and by a different road. The
rule describes what it plans from here; the lessons behind it are the record of
what it planned before, and they keep pointing at it.

The test that matters is not that the dates look right but that generation is
still idempotent afterwards:

```
✓ leaves generation idempotent — a re-run creates nothing
    generateSessions(...) → created: 0, total unchanged at 9
```

### Two consequences, neither hidden

**A moved lesson can land on a closure.** Nothing in this application deletes a
lesson, and cancelling one needs a reason only a person can write — so the
service **counts** them and the count comes back to the screen in bold. Silence
here is what costs somebody a drive to the pool.

**The last lesson of a term can land past the rule's own `endsOn`, and stays
there.** Thursday → Tuesday is five days forward, so 30 April becomes 5 May on a
rule that runs to 30 April. It is a real occurrence to teach or cancel; what it
is not is something the rule will produce again. Pinned by the test rather than
left to be discovered.

---

## 4. The pool, and the one refusal

A lane is a place inside a pool, so moving a season to another pool **empties its
lane selection** — the same loss `setRecurrenceLanes([])` is. It therefore owes
the past the same freeze, and it calls D-190's own `pinPastOccurrences` rather
than repeating rule 3 in a second place: two copies of that rule is how one of
them quietly stops matching the other. `pinPastOccurrences` is exported from
`lane-assignment-service.ts` **to the module and no further** — it is half of a
write, not a capability a screen calls, so it is not in `index.ts`.

Nothing is pinned when the season had no lanes to lose. Freezing a past lesson
to say the application decided something it had not is the same lie `PINNED`
exists to avoid.

**It refuses when a future lesson carries lanes of its own.** Those lanes are in
the pool being left behind, and both alternatives are worse than a refusal:
clearing the override is the reversion D-190 most exists to forbid, and keeping
it leaves a lesson naming water it is not in. So the person is told, in Dutch,
with the number of lessons and the way out — *"weer de lesreeks volgen"*, which
is already on each of those lessons' pages. The refusal writes nothing: not the
rule, not the past, not the override, and that is asserted rather than assumed.

`poolNotFound` is a second refusal, and it is a new reason rather than a reuse of
`FacilityError`'s `facilityNotFound` because the reason **is** a message key and
the two classes may not share a name. An inactive pool is refused as well as a
missing one: a pool taken out of service is not a place to plan lessons, which is
why the create form never offered it.

---

## 5. The screen, and the fields that are not on it

`/groups/[groupId]/schedule`, a disclosure on each rule: weekday, start time,
length, pool. Server-side authorization before anything renders, `planning.manage`
checked in the service and never inferred from the page.

**The rule's own pool is always an option, even when it is inactive.** Offering
only active pools would leave the `<select>` with no option matching its current
value, and a browser then selects the first — so saving a change of *time* would
silently move the series out of its pool. `RecurrenceView` gained `poolId` for
exactly this; the pool's name could not do it.

**The season's window is deliberately not a field, and the form says so.** The
brief's rule: a form with a hole in it teaches that the product is broken; a form
that explains the hole teaches how it works. The Dutch the person reads:

> *'Loopt vanaf' en 'loopt tot' staan hier niet. Die bepalen wat er nog
> gegenereerd wordt, niet hoe laat de les is — en bij het verzetten van de dag
> schuift 'loopt vanaf' zelf mee, zodat er niet twee plekken zijn die hetzelfde
> vastleggen. Een reeks die eerder of langer moet lopen: maak een tweede reeks.*

That is the true reason and not a polite one: §3 carries `startsOn` itself, so a
field for it would be a second writer for one value.

The other two notes are on the form for the same reason — before the click rather
than after it:

> *Dag, tijd, duur en bad van de hele reeks. Lessen die nog moeten komen schuiven
> mee; lessen die al geweest zijn blijven staan zoals ze gegeven zijn, en een les
> die je hebt afgelast blijft afgelast.*

> *Een ander bad wist de banen van de reeks — een baan ligt in een bad, dus die
> keuze maak je opnieuw. Lessen die al geweest zijn houden de banen waarin ze
> gezwommen zijn.*

**What the write did comes back in the URL**, as `generateSessionsAction` already
does. The form shows four fields and the write reaches every lesson that has not
happened yet, none of which is on screen when somebody presses save. A lesson
moved onto a closure is called out separately and in bold.

### Reachability

`updateRecurrence` is a write by `service-reachability.test.ts`'s vocabulary
(`update…`), so it falls under the check by construction and the check is green.
It was **held back from `index.ts` for one commit** — the service landed
unexported, the screen and the export landed together — which is that file's own
prescription for a service ahead of its screen, followed rather than quoted.

The way back exists for everything this adds: the edit is itself the repair path,
and a value typed wrongly is retyped. Nothing here creates a row that cannot be
corrected on the screen that created it.

---

## 6. Definition of done — run, not claimed

| Check | Result |
|---|---|
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid 🚀` |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run format:check` | `All matched files use Prettier code style!` |
| `npm run build` | 16 routes, compiled |
| `npm test` — before | **641 passed** (51 files) |
| `npm test` — after | **657 passed** (52 files) |
| migrations, fresh database | `splashtrack_recurrencecheck`: 14 migrations, *All migrations have been successfully applied* + ADR-0002 role model in force |
| schema drift | `prisma migrate diff --exit-code`: **No difference detected** |
| migrations, populated database | *No pending migrations*; every seeded row unchanged |

UAT was never dropped, reset or migrated. `splashtrack_uat` still holds 2 people,
2 pools, 9 lanes, 1 group, 2 series and 3 lessons — verified by a read-only
count after the run. Nothing was pushed.

### 6.1 There is no migration, and that is the finding

`prisma/schema.prisma` is byte-identical to the commit this branched from. A
correction to a rule is a service, an action and a form; the columns it writes
have all existed since phase 1.6.

Answering *"was the migration tested against a populated database"* with a
migration that does not exist would be theatre, so the check was rewritten to
ask what actually matters when a phase adds none: **`prisma migrate diff` between
the migrated database and `schema.prisma`.** With `--exit-code`, empty is 0 and
any difference is 2 — so a migration that was *needed and forgotten* cannot pass
quietly. It reported `No difference detected`.

The populated run was kept anyway, seeded to the shape of the owner's UAT
instance — two pools, nine lanes, one group, two series, three lessons, all
generated before this feature existed — and `migrate deploy` against it was a
no-op with every row intact. The script was written for this run and deleted.

**One thing that run proved on its own:** seeding had to go through the *app*
role, because the retention role the migrations run as was refused `INSERT` on
`Pool` with `permission denied for table Pool`. That is ADR-0002's role model
working exactly as specified, observed rather than assumed.

### 6.2 Two things found while writing the tests

**A club-wide `ScheduleException` written by a test survives
`resetGroupsFixtures`.** The helper drops one whose `groupId` *or* whose reason
carries the fixtures prefix — a club-wide closure has a NULL `groupId`, so an
unprefixed reason leaves it in the shared test database for ever. Three leaked
from early runs of this file and silently suppressed 26 March for **every group
in the database**, which surfaced as a Thursday series generating eight lessons
where it should have generated nine. Removed by hand; the closure in the test is
now group-scoped, and the reason is a comment in the file. The helper itself was
not changed — the escape hatch is deliberate and the fix belongs at the call
site — but a suite that needs a club-wide closure must prefix its reason.

**The local `.env` and `.env.uat` name the same two Postgres roles on the same
server.** This morning's UAT password rotation therefore broke `npm test` with
`password authentication failed for user "splashtrack_retention"` — nothing to
do with this branch. The local file was re-pointed at the current values without
either ever crossing a command line, a log or this document. Worth naming as a
deployment observation: **rotating a UAT credential should not be able to break
a developer's test run**, and today it can, because there is one Postgres server
and one pair of roles behind two environments.

---

## 7. New tests

`tests/integration/recurrence-correction.test.ts` — 16 assertions against a real
Postgres, through the real services, with the real `ScopeRelations` of all three
modules registered. `NOW` sits **inside** the generated term, as in
`lane-assignment.test.ts` and for the same reason, and the term straddles the
last Sunday in March so the wall clock is asserted on both sides of a change of
offset.

The ones worth knowing by name:

1. **`stop-and-create puts two lessons on the same evening`** — §1. It is first
   in the file because it is why the rest exist.
2. **`leaves generation idempotent — a re-run creates nothing`** — §3. If the
   moved dates did not line up exactly with what the corrected rule now plans,
   the next generation run would fill the gaps and the club would be back to two
   lessons a week.
3. **`is not silently reopened by the correction`** — §2, rule 4.
4. **`keeps the wall clock across the March change of offset`** — §2, rule 2.
5. **`refuses while a lesson still to come has lanes of its own, and writes
   nothing`** — §4, including that the refusal is clean.
6. **`is DENIED, and changes nothing`** — `planning.read` is not
   `planning.manage`, and the denial is the check that runs in production.

---

## 8. The question I stopped on

**Should `deactivateRecurrence` do something about the lessons its rule has
already produced?**

It is the other half of §1 and this pass did not touch it. Stopping a series
today leaves every future lesson it generated on the timetable, `SCHEDULED`,
with no rule behind them. For a club that has genuinely finished with a series
that is arguably right — the lessons were planned and someone may still teach
them — and for a club that stopped the wrong rule it is a fortnight of ghosts
they must cancel one at a time.

The correction path no longer depends on the answer, which is why it is safe to
leave open: nobody needs to stop a series to fix one. But *"stop this series and
call off what is left of it"* is a real sentence, and it is a different act with
a different record — a cancellation needs a reason, and one reason for thirty
lessons is a decision about what the trail says, not an implementation detail.
It belongs to whoever answers phase 1.8's D‑5 (a cancelled lesson cannot be
un-cancelled), because they are the same question about the same column from two
sides.
