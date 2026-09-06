# Phase 1.6 — the `groups` and `sessions` modules

**Branch** `build/v1-foundation` · **From** `e07f4b0` (505 tests) · **To** 595
tests · **Not pushed, not deployed.** UAT is still at the previous HEAD and its
database was not touched.

The two modules that turn this into something a swim school recognises: a
teaching group with people in it, and a timetable of lessons those people turn
up to.

Decisions implemented: **D-057** (`sessions` owns `ScheduledSession`), **D-059**
(intervals, never a status flag), **D-060** (a teaching assignment is not a
grant), **D-108** (a move down is ordinary history), **D-121** (`UNIT` stays
flat), **D-145** (live per-relation coverage), **D-147** (the opaque `Reach`),
**D-175** (`Pool` and `Lane` are facilities), **D-179** (a make-up lesson is a
session with a guest), **D-180** (capacity, for placement).

---

## 0. What landed

| Commit | |
|---|---|
| `4336adb` | `fix(setup)` — an expired token is deleted, not left readable |
| `998b845` | `docs(glossary)` — identifiers, and the `Location`/`Pool` tie-break |
| `470cbcb` | `feat(schema)` — 11 tables, 2 data classes, 15 hand-written constraints |
| `abf8c71` | `feat(groups)` — the module D-145 rule 1 was waiting for |
| `71172be` | `feat(sessions)` — something finally creates lessons |
| `2a26bdf` | `feat(ui)` — Dutch surfaces for groups and the schedule |
| `154864f` | `test` — the five proofs, and two defects they caught |

### 0.1 Step 0 — the setup token that lied

The token expires by a timestamp inside the file, and **nothing touched the file
when that moment passed**. So an hour after issue, `cat $DATA_DIR/setup-token`
still printed 32 characters that look exactly like a working token, with the
expiry buried in a JSON field beside a warning banner that draws the eye away
from it. The owner pasted one, the wizard refused it, and he had three suspects —
the token, the wizard, or his own typing — with no way to tell which.
`setup:token`'s own help text sent him down that path: it told him to `cat` the
file.

**A credential that has stopped working must fail at the point of READING, not
at the point of use.** Expiry now retires the token: the file is removed and a
value-free `setup-token.expired` marker takes its place, so `cat` fails with
`No such file or directory` and `--status` can still tell EXPIRED apart from
NONE. The sweep runs from every caller that knows what time it is — the status
command, the wizard's submission, and the entrypoint's `--ensure` on every start
— because there is no timer in a process that may be stopped for the whole hour
the token was valid for.

The claim marker was redacted in the same commit, for the same reason: a spent
token has no business staying readable on the volume of a live installation
either.

And the guidance now names a route that works from every state — **issue, then
read** — rather than a `cat` that is only correct while a token happens to be
live:

```text
To get a token you can use, from any of those states:

    splashtrack setup:token --new
    cat /app/data/setup-token
```

---

## 1. The two things the design did not have

### 1.1 Nothing created a `ScheduledSession`

**No chapter and no decision in the design set creates one.** §4.1's flagship
attendance screen begins *"Today → [Start session]"* and there is no path by
which a session comes to exist. Six groups across roughly thirty-six teaching
weeks is about two hundred rows, and nobody is going to type them — so the
design's most important surface had no path to its own data.

Two tables are therefore **additions**, labelled as such in
`docs/glossary.md`, in `prisma/schema.prisma` and in the migration rather than
presented as something a decision asked for:

- **`SessionRecurrence`** — a weekday, a time of day, a duration, a pool, and
  the dates between which the rule runs.
- **`ScheduleException`** — a date range on which nothing is generated. A
  nullable `groupId`; **null means club-wide**, which is the ordinary case.

A **term is not an entity**. "Generate a term" is a `from`/`to` the
administrator supplies; the design names no `Term`, and inventing one would put
a second home beside `SessionRecurrence.startsOn`/`endsOn`.

### 1.2 Three names for where a lesson happens

`01-domain-model.md` §3.2 lists a `Location` table and §3.4 gives
`ScheduledSession` a `locationId`. The glossary maps *locatie* to
`OrganizationUnit`. **D-175** makes `Pool` and `Lane` facilities owned by
`sessions`, *"never `OrganizationUnit`s and never authorization scopes"*.

All three cannot hold. **D-175 is the later and explicit decision, and D-159 /
D-189 put the tie-break in the glossary**, so: there is no `Location` table, a
session references a `Pool` (optionally narrowed to `Lane`s), and its
*organisational* position comes from its group's `unitId` per §3.6. Recorded in
`docs/glossary.md` under *locatie*.

---

## 2. Where the design was silent, and what I decided

Three questions went to the domain expert and **no answer arrived inside the
build window**. Each is implemented, documented in `docs/glossary.md` under *To
confirm with the domain expert*, and flagged here.

| Question | Implemented | Cost to change |
|---|---|---|
| Does a group meet at one fixed weekly moment, or several? | **Several** — a group may carry more than one `SessionRecurrence` | None. Several subsumes one; a "one slot" answer needs a screen that offers one, not a migration |
| Are closures club-wide or per group? | **Both**, via a nullable `ScheduleException.groupId` where null is club-wide | None |
| What does `Group.capacity` count? | **Places in the group** — open `GroupMembership` rows. A make-up guest does not consume one | **This is the one worth correcting early.** If the club means bodies in the water, the check moves from the membership count to the session roster |

**The capacity reading is the one that keeps D-179 and D-180 coherent with each
other.** D-180 makes capacity an input to a *placement* decision, and placement
writes a `GroupMembership`. D-179 says a make-up guest is *not in the group*. A
guest who consumed a place would be occupying something they explicitly do not
hold, and a full group would start refusing make-up lessons — which is the
opposite of what a make-up lesson is for. It is asserted:
*"does not consume a place in a full group"*.

### 2.1 Two smaller readings, also recorded

**Scheduling uses `planning.read` / `planning.manage`.** §2.5's catalogue has no
permission for scheduled sessions — its `sessions.read` and `sessions.revoke`
are LOGIN sessions, in the `identity` group — and §2.5's own rule is that *"a
permission referenced anywhere in the design set and absent here is a defect,
not a shorthand"*. Inventing `sessions.manage` would have put the catalogue's
second home in a module. `planning.manage` is the catalogued permission for the
act of planning, which is exactly what generating a timetable is.

**`Group` has no `courseLevelId`.** §3.2 lists one and the `courses` module that
owns `CourseLevel` is not built. A dangling id column with no table behind it is
the stub column D-163 refuses: nothing could write it, nothing could read it, and
it would look like a level had been recorded. A group's level lives in its name
until `courses` lands — which is also where D-180's placement screen will get
"a group at the right level" from.

**`InstructorAssignment` is group-level only.** §3.2 writes `personId, groupId |
sessionId`. A substitute's reach comes from a `SESSION`-scoped grant (D-068),
not from this table, so a nullable `sessionId` nothing writes would be a stub
that looks like a feature.

---

## 3. What the modules are

### 3.1 `groups`

`Group`, `GroupMembership`, `GroupMove`, `InstructorAssignment`.

**The load-bearing part is `groups-scope-relations.ts`.** It supplies the two
halves of D-145 rule 1 — `activeInstructorGroupIds` and `isActiveGroupMember` —
which were on the throwing default until now, meaning **every `GROUP`-scoped
grant in the installation resolved to no coverage**. Safe, and wrong.

Both are evaluated at query time and neither is cached, which is what closes
**F-114**: `GroupMembership` rows are kept for life, so resolving group reach
from their existence would leave every instructor who ever taught a child with
permanent read access. An instructor whose assignment ends loses sight of the
group on their **next query**, not at the next cleanup run — D-144's argument,
applied: *a predicate cannot be behind schedule; a job can*.

**D-108 is enforced by shape, not by intention.** One move operation, one audit
event type across all three directions, one mandatory reason, one date-ordered
history query. `UP`, `DOWN` and `LATERAL` cannot diverge without somebody
deliberately adding a second path — and `groups-move-symmetry.test.ts` reads the
module's own source to make that go red.

**Capacity refuses by default and takes an explicit, audited override** rather
than being a CHECK constraint. A ceiling that cannot be exceeded gets worked
around by raising it to 13 and forgetting, which destroys the number's meaning
permanently.

`InstructorAssignment` is registered as a **D-066 relationship source**. A
volunteer who teaches a group and holds no grant and no membership is otherwise
a person nothing reports as *held*, and §5.1's whole argument is that the
forgotten category is the one that accumulates indefinitely.

### 3.2 `sessions`

`Pool`, `Lane`, `SessionRecurrence`, `ScheduleException`, `ScheduledSession`,
`SessionLane`, `SessionRosterEntry`.

**Generation is idempotent by construction.** The unique index on
`(recurrenceId, occursOn)` is the answer to *"does this lesson already exist"*,
and the write is `createMany({ skipDuplicates: true })`. There is no
read-then-write window and no check anybody has to remember to write.

It also **never resurrects a cancelled lesson**, because the constraint sees a
`CANCELLED` row exactly as it sees a `SCHEDULED` one. That is the case an
"insert what is missing" implementation gets wrong: a cancelled lesson *looks*
missing.

**Cancelling is a status and a reason.** The row stays. *"De les van 12 maart is
afgelast — bad in onderhoud"* and *"there was no lesson on the 12th"* are
different answers to the parent asking why their child missed a week, and
deleting would take any attendance registered against it with it.

**Wall-clock times are two integers, and the zone is applied once per generated
date.** `startMinuteOfDay` and `durationMinutes`, resolved against the
organisation's configured `localization.timeZone` through `Intl`'s own tzdata.
Both Dutch DST transitions fall inside a swimming season; generating a term in
February by adding seven days to the first instant puts every lesson from April
an hour out — invisible in the data, obvious at the pool. The duration is added
to the **instant**, so a 45-minute lesson is 45 minutes long on the changeover
night rather than 105.

**The roster is derived plus explicit**, per §3.2 — group members are computed at
the lesson's own date and only guests are rows. Safe because `GroupMembership`
is time-bounded and never mutated: *"who was in group G on 3 March"* does not
change when a child moves in April. Materialising at generation time would have
been worse in the obvious direction — a term generated in September would miss
every child who joins in November.

**`isOnSessionRoster` is what makes D-179 work.** A make-up guest is visible to
the receiving instructor through a `SESSION` grant plus a roster row — never
through group membership, which a guest does not have, and never through an
administrator minting a grant at 16:55 on a Tuesday, which is the code path
D-031 calls the highest-risk in the application.

### 3.3 Surfaces

Five routes, Dutch, every one resolving the session and running a guarded read
**before the first element is returned** — a page that renders a heading and a
form has already disclosed that this installation has teaching groups and what
can be done to them.

```text
/groups                     list · create
/groups/[id]                members · instructors · place · move (all directions)
/groups/[id]/schedule       recurrences · closures · generate · cancel
/groups/[id]/sessions/[id]  roster · add a make-up guest
/groups/pools               facilities
```

**A denial is a rendered panel naming the permission**, never an empty list and
never a redirect. That matters more here than anywhere so far: D-145 rule 1 ends
an instructor's reach the moment their assignment closes, which is an ordinary
weekly event, and the difference between *"je hebt geen toegang"* and *"geen
groepen"* is the difference between a question somebody can answer and a screen
that looks broken.

**The move form is one form with direction as an ordinary `<select>`.** No
separate *terugzetten* button, no warning colour on one option, no extra
confirmation. A screen is where D-108's promise is easiest to break, and a red
button would render a normal teaching decision as a failure to the parent who
later reads the child's history. `groups-move-symmetry.test.ts` checks the Dutch
labels too.

---

## 4. Retention and erasure — every new table classified

`CLAUDE.md` rule 5, and the three bidirectional sync tests enforce it.

| Table | `DataClass` | Erasure registry |
|---|---|---|
| `Group` | `ORGANIZATION_SETTINGS` | — (references no `Person`) |
| `GroupMembership` | `STUDENT_PROFILE` | — (cascades from `StudentProfile`) |
| `GroupMove` | `STUDENT_PROFILE` | `erase` |
| `InstructorAssignment` | **`INSTRUCTOR_ASSIGNMENTS`** (new) | `erase` |
| `Pool`, `Lane`, `SessionLane` | `ORGANIZATION_SETTINGS` | — |
| `SessionRecurrence`, `ScheduleException` | `ORGANIZATION_SETTINGS` | — |
| `ScheduledSession` | **`SCHEDULED_SESSIONS`** (new) | — |
| `SessionRosterEntry` | `ATTENDANCE_EVENTS` | — (cascades from `StudentProfile`) |

**Two classes were added rather than borrowed**, both `proposedLawfulBasis:
UNRESOLVED` per D-110, on the `ROLE_ASSIGNMENTS` / `PERSON_RELATIONSHIPS`
precedent:

- **`INSTRUCTOR_ASSIGNMENTS`** could not be `ROLE_ASSIGNMENTS` without blurring
  exactly the line D-145 rests on — a teaching assignment is a domain fact and a
  grant is an authorization one, and the whole live-coverage rule is that
  reaching a group's pupils requires **both**. It needed a class before it could
  be a D-066 relationship source at all.
- **`SCHEDULED_SESSIONS`** could not be `ATTENDANCE_EVENTS`: the timetable holds
  no personal data and **must not expire before the attendance that points at
  it**, or a retention run leaves orphan events nobody can name.

**`GroupMembership` and `GroupMove` share `STUDENT_PROFILE` deliberately.** That
class's own purpose text is *"administering a pupil's lessons, **groups** and
progress"* and its trigger is `LAST_ENROLMENT_END` — the same purpose, the same
trigger, the same expiry. Giving either its own class would be a second
retention decision about one fact.

**`SessionRosterEntry` shares `ATTENDANCE_EVENTS`** so the roster cannot outlive
the attendance it explains. Keeping *"these twelve children were expected on 3
March"* after the attendance is deleted would leave the more re-identifying half
of D-111's pair behind, which is the opposite of what that decision is for.

Column-level: `InstructorAssignment.personId` is `HARD_DELETE` (an instructor's
teaching history is their own data); `GroupMove.decidedByPersonId` is
`SEVER_AND_RETAIN` — **erasing the instructor who decided a move must not delete
a child's history to remove an adult's name**, so the decision and its reason
stand and the name goes.

---

## 5. Definition of done — run, not claimed

### 5.1 `prisma validate`, `tsc --noEmit`, `lint`, `format:check`

```text
=== prisma validate ===
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀

=== tsc --noEmit ===
(no output = clean)

=== npm run lint ===

> splashtrack@0.1.0 lint
> eslint


=== npm run format:check ===

> splashtrack@0.1.0 format:check
> prettier --check .

Checking formatting...
All matched files use Prettier code style!
```

### 5.2 `npm run build`

```text
Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/auth/[...all]
├ ƒ /api/health
├ ƒ /api/ready
├ ƒ /groups
├ ƒ /groups/[groupId]
├ ƒ /groups/[groupId]/schedule
├ ƒ /groups/[groupId]/sessions/[sessionId]
├ ƒ /groups/pools
├ ƒ /mfa-enrolment
├ ƒ /people
├ ƒ /people/[personId]
├ ƒ /people/[personId]/relationships/[relationshipId]/evidence
├ ƒ /setup
└ ƒ /sign-in


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

### 5.3 `npm test`

```text
 RUN  v4.1.11 /root/projects/SplashTrack
 Test Files  47 passed (47)
      Tests  595 passed (595)
   Duration  95.56s (transform 1.13s, setup 692ms, import 10.78s, tests 77.42s, environment 6ms)
```

505 at `e07f4b0`; 595 now. +7 from the setup-token fix, +83 from this phase.

### 5.4 `db:recreate && migrate deploy` from empty

```text
migrations/
  └─ 20260902230852_foundation_identity_authorization_settings_audit/
    └─ migration.sql
  …
  └─ 20260904060000_people_module/
    └─ migration.sql
  └─ 20260906060000_groups_and_sessions/
    └─ migration.sql

All migrations have been successfully applied.
[recreate-database] Role model in force on "splashtrack_freshcheck" (applied as splashtrack_owner).
```

And the migrations produce exactly the datamodel — `prisma migrate diff` from
the freshly migrated database to `schema.prisma`:

```text
Loaded Prisma config from prisma.config.ts.

No difference detected.
```

### 5.5 The five properties, by name

```text
 ✓ generating a term from a recurrence > produces exactly the expected lessons
 ✓ generating a term from a recurrence > skips a configured holiday and says which
 ✓ generating a term from a recurrence > IS IDEMPOTENT — running it twice does not double the schedule
 ✓ generating a term from a recurrence > does not resurrect a cancelled lesson on a later run
 ✓ cancelling one occurrence > KEEPS IT IN THE HISTORY rather than deleting it
 ✓ cancelling one occurrence > refuses to cancel twice rather than overwriting the first reason
 ✓ moving a pupil back down a level > leaves TWO GroupMembership rows and loses no history
 ✓ moving a pupil back down a level > records a move UP through exactly the same path
 ✓ moving a pupil back down a level > refuses a move with no reason, in either direction
 ✓ an instructor whose assignment has ended > CANNOT read the group's pupils, and the refusal is a DENIAL
 ✓ an instructor whose assignment has ended > loses the group's schedule too, on the same query
 ✓ an instructor whose assignment has ended > keeps the assignment row, so 'who taught this group' still has an answer
 ✓ a make-up guest (inhaalles, D-179) > is visible to the receiving instructor with NO administrator granting anything
 ✓ a make-up guest (inhaalles, D-179) > does not consume a place in a full group
```

Plus the scope-escape suite `06-delivery.md` §2.1 requires, asserting on the
**fields returned** and on the `SESSION` window as a real predicate:

```text
 ✓ a GROUP-scoped instructor > sees their own group and NOT the one next door
 ✓ a GROUP-scoped instructor > returns only THEIR group's pupils in the fields it renders (D-145 rule 2)
 ✓ a GROUP-scoped instructor > reads a pupil's history NARROWED to their own group, not all of it
 ✓ a GROUP-scoped instructor > says a group name was WITHHELD rather than rendering it as absent
 ✓ the list filters mirror coversResource > agrees with the predicate on every group, for every principal
 ✓ a SESSION-scoped grant > reaches that lesson and NOT its group
 ✓ a SESSION-scoped grant > reaches NOTHING outside its time window — not even its own session
 ✓ a SESSION-scoped grant > carries the make-up guest and no other pupil
 ✓ a SESSION-scoped grant > agrees with coversResource on the session list
 ✓ a principal with no grant at all > is DENIED rather than shown an empty list, everywhere
```

Every hand-written constraint, named (24 assertions), and the recurrence
arithmetic including both DST transitions (19). Full run of the five new files:

```text
 Test Files  5 passed (5)
      Tests  75 passed (75)
```

**Nothing is faked.** `tests/support/groups-fixtures.ts` registers the REAL
`ScopeRelations` of all three modules against real rows in a real Postgres, so
*"an instructor whose assignment has ended cannot read that group's pupils"* is
a statement about the query that will run in production rather than about a
stand-in. `authorization-fixtures.ts` had to fake every relation and said so;
the four still on the throwing default belong to `courses`, which does not
exist.

---

## 6. Two defects the suites caught

Both were in code I had just written, and both are fixed rather than asserted
around.

### 6.1 `ScheduledSession_cancellation_shape_check` did not enforce its own claim

Written as an equality between two booleans:

```sql
("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL AND …)
```

That looks symmetric and is not. The right-hand side is **already false when
either field is null**, so a `SCHEDULED` row carrying a stale
`cancellationReason` with no `cancelledAt` satisfies `false = false` and passes —
which is exactly the row *uncancelling* would leave behind, and the case the
constraint's own comment said it existed for. Now a `CASE`, with both branches
stated.

The migration was **edited in place**: it is unpushed, on a feature branch, and
had been applied to nothing but my own scratch and test databases, both of which
were dropped and replayed. UAT is at the previous HEAD.

### 6.2 `getStudentGroupHistory` leaked across groups

It guarded on `{ student }` — the right reference, since the history spans
groups — and returned everything. But a `GROUP` grant **does** cover
`{ student }` for a pupil in that group (`coversResource`'s `GROUPS`/`student`
branch), so the guard passed and a `GROUP`-scoped instructor received every group
the child had ever been in, by name, with dates, including the club-swimming
group they have no relationship with.

That is **D-145 rule 2**: coverage is per *relation*, and a group grant returns
*that group's* records. This is precisely the case `06-delivery.md` §2.1 means
when it requires the escape suite to assert on the **fields returned** rather
than only on reachability — and `covers-resource.ts` says it from the other side:
*"a green `coversResource` is necessary and not sufficient."*

The reach now goes to the repository as a required argument and the narrowing
happens in the query. A move whose *other* end is out of reach still appears —
it is the instructor's own record, and dropping it would make a child appear to
vanish from the history with no explanation — with the other group's name
**withheld and said to be withheld**, because a blank `fromGroupName` already
means *"this was a first placement"*.

Fixing that surfaced a third, smaller one: **`{ group: {} }` is not a no-op
relation filter in Prisma.** Using it for the `ALL` case returned an empty
history to an `ORGANIZATION`-scoped administrator. It is now kept distinct as
`null` — the same reason `GroupReachFilter` has an `ALL` variant instead of an
empty `where`.

---

## 7. Deliberately not built

Named so the next reviewer argues with a decision rather than discovering a gap.

- **Attendance registration.** A different module against these rows (D-057).
  `ScheduledSession` has no `COMPLETED` status: whether a lesson has happened is
  its date against the clock, and a status column saying so would be a second,
  mutable copy of a fact the timestamp already carries.
- **Assessment, fees, the waiting list, the CSV importer, the catalogue editor.**
  Out of scope for this pass.
- **A make-up entitlement counter** — D-109 models the shape and builds no
  workflow, and the domain expert's own school does not run them.
- **Monthly or n-weekly recurrence.** No swim school described one, and an
  unused recurrence engine is the apparatus §4.0 spends a page arguing against.
- **Deleting a `SessionRecurrence`.** Deactivating is the operation: the sessions
  it produced point at it through `recurrenceId`, which is half the idempotency
  key, so deleting the rule would orphan them via `SetNull` and the next
  generation run would recreate all of them as duplicates.
- **A `no-restricted-imports` lint rule per module (D-125).** Still not built;
  the boundaries here are held by the module barrels and by review, as they were
  for `people`.

---

## 8. Open, and for Jack

1. **What does `Group.capacity` count?** Built as places in the group; a guest
   does not consume one. If the club means bodies in the water, say so — it is a
   small change now and a data question later.
2. **One weekly slot per group, or several?** Built as several. A "one slot"
   answer costs a screen change, not a migration.
3. **Club-wide closures, per-group closures, or both?** Built as both.
4. **`InstructorAssignment.role` is free text**, not an enum — the club's own
   words (*hoofdinstructeur*, *hulpinstructeur*, *stagiair*) are not mine to
   invent, and nothing binds a rule to it (D-130). If the club has a fixed set,
   it can become one.
5. **The three unresolved lawful bases** — `INSTRUCTOR_ASSIGNMENTS` and
   `SCHEDULED_SESSIONS` ship `UNRESOLVED` per D-110, joining
   `ROLE_ASSIGNMENTS`, `PERSON_RELATIONSHIPS`, `EXAM_RESULTS_AND_AWARDS` and
   `API_CREDENTIALS`. They must be settled before those defaults ship (F-128).
