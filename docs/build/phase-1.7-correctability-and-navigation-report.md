# Phase 1.7 — correctability and navigation

**Branch** `build/v1-foundation` · **from** `431cc84` (595 tests) · **to** the head
of this branch (615 tests) · **not pushed**.

Opened by three defects the owner hit inside ten minutes of using the
application for real:

> *"Als een bad is aangemaakt kan ik hem niet meer bewerken qua naam of lengte
> en ik heb een foutje gemaakt. Ook kan ik geen baden toevoegen. Ik kan ook niet
> makkelijk terug navigeren naar de hoofdpagina."*

All three are the same defect wearing three faces, and the general form is worth
stating before the fixes:

> **A screen that creates something must let you correct it, and every screen
> must be escapable.** A typo in a name is the most ordinary thing a user does.
> A product whose only recovery is a database edit is not usable by the person
> it was built for.

---

## 1. What landed

### 1.1 The way back is in the layout, not in the pages

`src/app/app-header.tsx`, rendered by `src/app/layout.tsx`.

`/people` and `/groups` rendered a heading, a table and a create form, and
nothing on either led anywhere but deeper. The only escape from a list screen
was the browser's own chrome — which on a phone held over a wet tiled floor is a
gesture, not a target.

**It is in the ROOT LAYOUT and that is the whole point.** A page cannot render
outside the layout, so no future module can ship a screen with no way out. This
had already happened once in the other direction: `groups` shipped with no link
*into* it, and the fix was one line on the landing page with a comment asking
the next author to remember. A comment is not a mechanism.

**It is only a home link.** The landing page already carries the entry to every
module, so home is one tap from anywhere and the module you want is the tap
after it. Module links *in the header* would have to know whether the caller is
signed in — the header renders on `/sign-in` and inside the setup wizard too —
and a header naming `Mensen` and `Groepen` to an anonymous visitor discloses
what this installation has before anybody authenticated, which is the failure
`access.tsx` describes. Reading the session to avoid that buys one tap at the
cost of putting authorization state into the layout. It reads the session not at
all.

The tap target is `--st-touch-target-min` — the same 48 px `globals.css` already
fixes for buttons, taken by name rather than as a second opinion — and the bar is
`sticky-top`, so the way home does not scroll off a long roster. The label is the
club's own name: `common.brand` is overridden per installation by
`src/i18n/request.ts`, so on UAT the home link reads *Zwemschool …*, not
*SplashTrack*.

Nested pages additionally name their parent, `<nav aria-label="kruimelpad">`, and
so does every denial and not-found branch — escaping matters most on the screen
that just refused you.

`tests/unit/navigation-shell.test.ts` holds both invariants at the source level,
in the shape `route-guard-coverage.test.ts` uses: deleting the header from the
layout typechecks, builds, and passes every behavioural test in the suite.

### 1.2 A pool and a lane can be corrected

`updatePool` and `updateLane` in `src/modules/sessions/application/facility-service.ts`,
`updatePoolAction` / `createLaneAction` / `updateLaneAction`, and a rebuilt
`/groups/pools`.

There was **no `updatePool` anywhere in the application**. And `createLane` had
been exported from `@/modules/sessions` since phase 1.6 with **no screen calling
it** — the pools page imported `createPoolAction` and nothing else — so the club
could record that it has a pool and could record none of the lanes in it. A
capability that exists in the service layer and in nobody's hands is not shipped,
whatever the export list says.

Correcting a pool, adding a lane and correcting a lane all live *inside* the pool
they belong to: one tap to open the thing you are looking at, no navigation to
fix it, and the list still fits on a phone with every pool closed.

Two things follow from a lane finally being addable:

- **A lane appears in the pool's schedule option** — `poolOptionLabel`, pure and
  therefore testable without rendering a page. `Pool` and `Lane` were both in the
  schema and only the pool had ever reached a screen, so adding a lane changed
  nothing anybody could see anywhere a lesson is planned.
- **An inactive pool is no longer offered for new recurrences.** That is what the
  flag is for: a pool out of service stops being a choice for lessons not yet
  planned, while every lesson already planned in it keeps saying where it was.

`FacilityError` translates the uniqueness violations the schema is right to hold
(`Pool.name`, `Lane[poolId, name]`). Renaming *"Instructiebda"* onto an existing
*"Instructiebad"* is an ordinary mistake and used to reach a screen as a 500.

**A lane cannot change pool.** Not a limitation to be lifted: `SessionLane` points
lessons at a lane, so a lane that moves rewrites where every lesson ever taught
in it happened.

### 1.3 The sweep found two more of the same, and both are fixed

- **A recurrence could not be stopped from any screen.** `deactivateRecurrence`
  shipped in 1.6 with no caller, so a rule typed with the wrong weekday could
  only be worked around by cancelling every lesson it generated, one at a time,
  each with a reason. There is now a *Reeks stoppen* button, and the note beside
  it says what stopping does and does not do.
- **A closure could not be corrected at all.** *"Kerstvakantie, 21-12 t/m 5-1"*
  typed as *"21-11"* is a fortnight of lessons the generator silently does not
  produce. `updateClosure` corrects the dates and the reason in place, guarded on
  the closure's **own** scope read from the row — taking the scope from the
  caller would let a `GROUP`-scoped principal aim a per-group edit at a club-wide
  closure and be checked against their own group. The scope itself is not
  editable, because turning a club-wide closure into one group's night off
  crosses the boundary `createClosure` guards.

---

## 2. In place, or superseding? — and why, per attribute

The rule the register states is about **history**: attendance and exam results
are event logs, and a correction there writes a superseding event because the
earlier answer is itself evidence — somebody was marked absent, somebody was told
they passed (D-061, D-062, `CLAUDE.md` rule 4). D-059 says the same about a
member leaving and returning: two `MembershipPeriod` rows, never a reopened one.

**A pool's name is not evidence of anything.** *"Instructiebda"* has no earlier
state worth reconstructing and answers no question a person can ask. Superseding
rows would give the club two pools where it has one, and every screen listing
facilities would have to learn to hide the corrected ones.

So the distinction is drawn **per attribute, not per table**, and what makes an
in-place correction acceptable is the **audit event** — who changed which fields,
when — which is the instrument `updateGroup` and `updatePerson` already use.

| Thing corrected this pass | Treated as | Why |
|---|---|---|
| `Pool.name`, `Pool.lengthMetres`, `Pool.active` | in place, audited | Club configuration. No earlier state is evidence; nothing derives from a former name. |
| `Lane.name`, `Lane.sequence` | in place, audited | Same. The lane's *pool* is not editable, because `SessionLane` makes it history. |
| `ScheduleException` dates and reason | in place, audited | Configuration for a generator. It changes what will be generated and never what exists. |
| `SessionRecurrence` | **stopped, never edited** | The lessons it produced point at it, and that pointer is half the idempotency key. Correction is stop-and-create. |
| `StudentLifecycleEvent` | **superseding event** (already correct) | The earlier event *is* evidence — the club's own account of its week. Proven, not assumed: see §3. |

Nothing that the append-only rules govern was made mutable by this pass, and the
fourth proof exists specifically to catch a future change that generalises
"make it editable" across the line.

---

## 3. The sweep: every surface built so far

*Correctable* = a mistake made on this surface can be repaired **through the UI**,
by the mechanism the domain rules require. *Escapable* = there is a tap that
leads out.

| Surface | Correctable? | Escapable? | What I did |
|---|---|---|---|
| `/` landing | n/a — creates nothing | n/a — it *is* home | Nothing. |
| `/sign-in` | n/a | header | Header. |
| `/setup` (wizard) | organisation name and administrator, **no** | header (loops back into the wizard, which is correct while setup is unfinished) | Header only. See deferred D‑1. |
| `/mfa-enrolment` | n/a — enrolment, not a record | header | Header only. |
| `/people` (list) | yes — via the person's own page | **was no** → header | Header. |
| `/people/[id]` — identity | **yes**, in place + audited (`updatePerson`) | breadcrumb + header | Breadcrumb `aria-label`; breadcrumb added to the denial branch. |
| `/people/[id]` — membership number | **no** | as above | Deferred D‑2. |
| `/people/[id]` — membership periods | partial: start/end only, an entered end date cannot be repaired | as above | **Stopped and asking** — see §6. |
| `/people/[id]` — pupil number | **no** | as above | Deferred D‑2. |
| `/people/[id]` — lifecycle events | **yes**, by superseding event (already correct) | as above | Proved it (§4, proof 4). |
| `/people/[id]` — relationships | partial: end + record a new one | as above | Deferred D‑3. |
| `/people/[id]/…/evidence` | n/a — read-only disclosure | breadcrumb + header | Breadcrumb `aria-label`; breadcrumb added to the denial branch. |
| `/groups` (list) | yes — via the group's own page | **was no** → header | Header. |
| `/groups/[id]` — group attributes | **yes**, in place + audited (`updateGroup`) | breadcrumb + header | Breadcrumb added to denial and not-found branches. |
| `/groups/[id]` — instructor assignments | partial: assign + end | as above | Deferred D‑4. |
| `/groups/[id]` — placements | partial: place + end | as above | Deferred D‑4. |
| `/groups/[id]` — group moves | **yes**, by another move (append-only, D‑108) | as above | Nothing; already right. |
| `/groups/[id]/schedule` — recurrences | **was no** → **yes**, by stopping | breadcrumb + header | Added *Reeks stoppen* + note. |
| `/groups/[id]/schedule` — closures | **was no** → **yes**, in place + audited | as above | Added `updateClosure` + an edit form per closure. |
| `/groups/[id]/schedule` — lessons | cancel with a reason; **un-cancel: no** | as above | Deferred D‑5. |
| `/groups/[id]/schedule` — pool choice | n/a | as above | Inactive pools no longer offered; options now name the lanes. |
| `/groups/[id]/sessions/[id]` — guests | **yes** — add and remove | breadcrumb + header | Breadcrumb added to denial and not-found branches. |
| `/groups/pools` — pools | **was no** → **yes**, in place + audited | breadcrumb + header | The whole of §1.2. |
| `/groups/pools` — lanes | **was impossible** → add, and correct | as above | The whole of §1.2. |

---

## 4. The four proofs

`tests/integration/correctability.test.ts`, against a real Postgres, through the
real services, with the real `ScopeRelations` of all three modules registered.
Each is a place where a plausible fix is wrong in a way nothing else notices.

1. **A pool rename persists and is audited.** An update that writes the row and
   forgets the event passes every screen and leaves no answer to *"who renamed
   this pool"* — the one control that makes an in-place correction acceptable.
   Also asserted: only the fields that *actually* changed are recorded, and a
   save that changes nothing writes nothing, because a trail with entries for
   non-events is one nobody reads.
2. **A lane can be added to an existing pool and appears in that pool's schedule
   options.** A fix that adds the form and stops there leaves the lane visible on
   exactly one page and invisible where it is used.
3. **An edit without the write permission is DENIED, not silently ignored.** The
   page renders on `planning.read`; the write needs `planning.manage`. A reader
   is refused by name, the row is unchanged, and the guard runs **before** the
   row is read — otherwise the refusal a caller sees depends on whether the thing
   they aimed at exists, which is an existence oracle.
4. **A correction under an append-only rule produces a superseding record.** A
   pupil wrongly recorded as `LEFT` is corrected by a *new* `RETURNED` event: two
   rows, the first byte-for-byte intact, the derived state following the newer
   event at *now* and the older one at a date before the correction. Plus the
   strongest form — the module exports no `updateLifecycleEvent` to reach for.

Plus the sweep's own: a closure correction moves the dates, is audited, leaves
every already-generated lesson in place, and is denied without `planning.manage`.

---

## 5. Definition of done — run, not claimed

| Check | Result |
|---|---|
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid 🚀` |
| `npm run typecheck` (`tsc --noEmit`) | clean |
| `npm run lint` | clean |
| `npm run format:check` | `All matched files use Prettier code style!` |
| `npm run build` | 16 routes, compiled |
| `npm test` — before | **595 passed** (47 files) |
| `npm test` — after | **615 passed** (49 files) |
| `db:recreate && migrate deploy` on a **scratch** database | `splashtrack_scratch_17`, then `splashtrack_scratch_walkthrough`: *All migrations have been successfully applied* + *Role model in force*. Both dropped afterwards. |

**No migration was added, and that is the finding rather than an omission.**
`Pool`, `Lane` and `ScheduleException` already had every column these corrections
write. The gap was never in the schema; it was that nothing in the application
could write them.

UAT was never dropped, reset or migrated. Nothing was pushed.

---

## 6. Walking it over HTTPS

### 6.1 On UAT — by the owner, on the deployed build

The branch was built and deployed to the UAT stack
(`docker compose --env-file .env.uat build app && … up -d app`), healthy over
HTTPS at `https://uat.splashtrack.sysadminheaven.nl/api/health → 200`.

**I cannot sign in on UAT, and that is the application working as designed.**
`admin:create` refuses a second administrator on an instance that has completed
first-run setup:

```
This installation has already completed first-run setup (2026-09-05T20:15:38.927Z).
`admin:create` creates the FIRST administrator and is refused afterwards — an
unaudited second path to an ORGANIZATION-scoped account is the thing D-141's
invariant exists to make unnecessary.
```

That refusal is correct and I did not work around it. What UAT does have is
better evidence than anything I could have staged — **the owner used it himself**,
minutes after the deploy:

```
        amsterdam         |       eventType       | actor |            changedFields
--------------------------+-----------------------+-------+------------------------------------
 2026-09-06 09:36:41.297  | sessions.pool.updated | Jack  | {"fields": "name"}
 2026-09-06 09:36:50.806  | sessions.pool.updated | Jack  | {"fields": "name"}
 2026-09-06 09:36:56.846  | sessions.pool.updated | Jack  | {"fields": "lengthMetres"}
 2026-09-06 09:37:12.024  | sessions.lane.created | Jack  | {"fields": "name,sequence", …}
 … nine lane.created events, 09:37:12 → 09:38:41 …

      pool       | lengthMetres |                     lanes
-----------------+--------------+------------------------------------------------
 Doelgroepen bad |           20 | Badje 1, Badje 2, Badje 3
 Wedstrijd bad   |           25 | Baan 1, Baan 2, Baan 3, Baan 4, Baan 5, Baan 6
```

Two pools renamed, one length corrected, nine lanes added — through a browser
session over HTTPS, every write audited with `actorAuthMethod: session`. The
pools that were `Bad 1` and `Bad 2` with zero lanes are now the club D-175
describes: six 25 m lanes and three.

The header was verified unauthenticated on the same origin, on every route
including the ones that redirect to sign-in:

```
GET /             -> 200  st-home-link … href="/"
GET /sign-in      -> 200  st-home-link … href="/"
GET /groups       -> 200  (→ /sign-in)   st-home-link … href="/"
GET /groups/pools -> 200  (→ /sign-in)   st-home-link … href="/"
GET /people       -> 200  (→ /sign-in)   st-home-link … href="/"
```

### 6.2 The authenticated walk, end to end

Because I hold no account on UAT, the signed-in walk ran against a **throwaway
stack of the same `splashtrack:local` image**, behind a self-signed TLS
terminator on `https://localhost:8443`, on a scratch database
(`splashtrack_scratch_walkthrough`) — created, walked, and dropped. UAT's
database was not touched by it.

`scripts/phase-1.7-walkthrough.mjs` drives it, and is kept so the next person can
re-run it in one command. It runs the wizard on an unset-up instance (a password
it generates and never prints) or signs in with `UAT_ADMIN_PASSWORD` on one that
is already set up — the path the owner can run on his own instance.

```
─── 2. the landing page, and the header that is now on every page
h1:        SplashTrack
header:    "🏊 Zwemschool Walkthrough — naar de startpagina" -> /
modules:   Naar Mensen, Naar groepen

─── 3. a pool, created with the typo this phase exists for
now at:    https://localhost:8443/groups/pools
crumb:     Groepen
saved:     Bad toegevoegd.
list:      Instructiebda

─── 4. correcting it — the thing that was impossible
saved:     Bad bijgewerkt.
list:      Instructiebad — 25 m Geen banen vastgelegd.

─── 5. adding lanes — the capability no screen ever called
added baan 1: Baan toegevoegd.
added baan 2: Baan toegevoegd.
list:      Instructiebad — 25 m 2 banen: baan 1, baan 2

─── 6. a group, so the lane has a schedule to appear in
group at:  https://localhost:8443/groups/qo1y84n4tuog7zgkdkevz3lg
pool opts: geen bad gekozen | Instructiebad — baan 1, baan 2

─── 7. home, from three different depths
from /groups/<id>/schedule  (three segments deep)
  was:  https://localhost:8443/groups/qo1y84n4tuog7zgkdkevz3lg/schedule
  now:  https://localhost:8443/
from /groups/pools          (two segments deep)
  was:  https://localhost:8443/groups/pools
  now:  https://localhost:8443/
from /people                (one segment deep)
  was:  https://localhost:8443/people
  now:  https://localhost:8443/
```

And the same walk's audit trail, from the scratch database:

```
       eventType       |                       changedFields
-----------------------+-----------------------------------------------------------
 sessions.pool.created | {"fields": "name,lengthMetres"}
 sessions.pool.updated | {"fields": "name,lengthMetres"}
 sessions.lane.created | {"fields": "name,sequence", "laneId": "a4c3vo…"}
 sessions.lane.created | {"fields": "name,sequence", "laneId": "bwl8cv…"}
```

---

## 7. Deferred, with reasons

**D‑1 — the organisation's own settings have no screen at all.** The wizard sets
the name and the copy beside it says *"you can change it later"*, and later does
not exist yet. A settings surface is a phase 4 module, not something to graft on
here.

**D‑2 — a member number and a pupil number cannot be corrected.** Both are
allocated or supplied once at creation. Correcting one is not obviously an
attribute edit: a number the club has already put on a card, a list or a parent's
email is something *other people hold*, and whether a correction should preserve
the old value as a former number is a domain question, not a UI one. Too large
for this pass, and it needs an answer before it is built.

**D‑3 — a relationship's authority, evidence or start date can only be corrected
by ending it and recording a new one.** That is the right shape for the
*authority* — it is bitemporal and the earlier grant is evidence — but it is a
heavy way to fix a typo in the evidence text, and the evidence column is
encrypted (D‑096), so a correction path has to be written with the envelope in
mind. Small but not trivial; deliberately not rushed.

**D‑4 — an instructor assignment or a placement created by mistake can only be
ended, which leaves a zero-length interval.** Ending is correct for a real
change; a same-day *mistake* is a different act, and whether the mistaken row
should disappear or stay as a closed interval is exactly the append-only
question. Not decided here.

**D‑5 — a lesson cancelled by mistake cannot be un-cancelled.** A cancellation
carries a reason and is what a parent is told, so reversing it is plausibly
history rather than a correction. Left alone deliberately.

**D‑6 — a `SessionRecurrence`'s weekday, time or duration cannot be edited.**
Stopping it and creating a new one *is* the correction, because the sessions it
already produced point at it: editing in place would silently re-describe lessons
that already happened. This one is closed rather than deferred — the behaviour is
the answer, and the screen now supports it.

**D‑7 — a `ScheduleException` entered wholly in error can be corrected but not
removed.** Narrowing it to a single past day is a workaround, and adding a delete
path to a module whose index deliberately exports none is a decision, not an
implementation.

---

## 8. The question I stopped on

**How is a `MembershipPeriod` corrected?**

`endMembershipPeriod` writes an end date once and `assertCanStartPeriod` refuses
to reopen a closed period — correctly, because "they came back" must start a new
period rather than erase a departure (D‑059). But that leaves **no path at all**
for a period *ended on the wrong date*, which is an ordinary typo: `31-12` for
`13-12`, and the club's record now says a member left three weeks late.

The three candidate answers are genuinely different, and each has a cost:

1. **In place, audited** — like a pool's name. Cheapest, and it treats an
   interval boundary as an attribute. But a membership period is the closest
   thing in the built application to the evidence D‑059 protects, and this makes
   the answer to *"when did they leave"* rewritable.
2. **A superseding period row** — faithful to D‑061/D‑062's shape. Needs a
   `supersedesPeriodId` column, a migration, and a change to every derivation
   (`isCurrentlyAMember`, `openPeriod`, `lastMembershipEnd`, the retention clock
   that hangs off them). No `supersedes` column exists anywhere in the schema
   today.
3. **A correction event beside the period**, leaving the row alone — a third
   pattern, and D‑134 says a normative rule gets one home.

D‑059 does not settle it: it fixes how *leaving and returning* are modelled and
says nothing about repairing a mistyped boundary. Choosing here would either
weaken an append-only guarantee or add a schema pattern on my own authority, so
I stopped. Everything that does not depend on the answer shipped.
