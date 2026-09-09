# Phase 2.2 — the `attendance` module

**Branch** `build/attendance-module` · **From** `e4043aa` (813 tests) · **To**
857 tests · **Not pushed, not merged, not deployed.**

**Amended after Jack's decision round (2026-09-09).** All eight open items
were reviewed; six stand as built (each carries a *besloten* note below), two
became work: the one-mechanism guest/roster component (§1.4, now built) and
the `SkillProgress` database carve-out retrofit (§1.6, now built).

`AttendanceEvent` — the append-only register of who showed up
(`01-domain-model.md` §3.4), written against `ScheduledSession` (which
`sessions` owns and keeps owning, D-057) and `StudentProfile`. The register on
the lesson screen, the read-only history on the person screen, and — new for a
domain table — the append-only property enforced by PostgreSQL itself rather
than only by module code.

Decisions implemented: **D-005**/**D-061** (append-only event log; a
correction is a *new* event carrying `supersedesEventId`, the superseded row
never modified; the effective status is derived at read time), **D-057**
(`attendance` is a consumer of `ScheduledSession` — it reaches the lesson and
its roster through `sessions`' published `findSessionRegisterFacts`, never the
tables), **D-111** (expired events are hard-**DELETED**, never anonymised —
the retention role holds the only `DELETE`), **D-126** (ONE audit event per
group registration, not one per pupil), **D-145 rule 2** (a `GROUP`-scoped
reach reads *this group's* attendance only, via a write-time `groupId`
snapshot — the exact mechanism Jack chose for `SkillProgress` in the phase
2.1 follow-up, here from day one and NOT NULL), **D-179** (a make-up guest's
attendance derives from *participation in the session* — which is also why
the write guard is `{ session }`, see §1.1), **P-02** (`clientEventId` makes
every write an idempotent replay), and `01-domain-model.md` §4's transaction
boundary (*"partial attendance is not a valid state"* — one registration, one
transaction). **D-003** is cited below as *named by the design, not built* —
see §1.2.

---

## 0. What landed

| Commit | |
|---|---|
| `feat(schema)` | `AttendanceState`, `AttendanceEvent`, one hand-written CHECK; `attendanceGrantStatements` + `infra/attendance-database-role.sql` (the DB carve-out); all three registries closed in the same commit |
| `feat(attendance)` | the module: domain, application, infrastructure, `index.ts`; `sessions`' published `findSessionRegisterFacts`; the lesson-screen register and person-screen history; Dutch/English strings |
| `test(attendance)` | fixtures, domain, service, scope-escape, constraints — and `attendance-append-only.test.ts` flipped from proving the gap to proving the control |
| `chore(format)` | four files that predate this branch failed `format:check`; formatted, no content change |
| `docs(build)` | this report |
| `feat(sessions)` *(decision round)* | the widened roster-change guard: `groups.assign_members` **or** `attendance.record` on `{ session }` opens `addGuestToSession`/`removeGuestFromSession` — the one guest mechanism of §1.4 |
| `feat(skills)` *(decision round)* | `skillProgressGrantStatements` + `infra/skill-progress-database-role.sql`: the same DB carve-out retrofitted onto `SkillProgress` — §1.6 |
| `test(attendance)` *(decision round)* | roster-guard scope-escape, the trial-swimmer path, the SkillProgress refusal proof; skills fixtures reworked for the revoked `DELETE` |
| `docs(build)` *(decision round)* | this report's amendments |

### 0.1 The schema, and what it deliberately does not have

- **`AttendanceEvent`** (`sessionId`, `studentProfileId`, `state` ∈
  {PRESENT, ABSENT, EXCUSED, LATE} — §3.4's exact vocabulary, nothing
  invented — `recordedByPersonId?`, `recordedAt`, `clientEventId` (unique),
  `supersedesEventId?`, `groupId`, `note?`) — `ATTENDANCE_EVENTS` data class,
  the class the retention catalogue has carried since phase 1.6 finally
  getting the table it was written for: CONTRACT, session date, 24 months,
  `DELETE` (D-111).
- **`groupId` is NOT NULL**, unlike `SkillProgress.groupId`. Every attendance
  event has a required session and every session has a group, so the case
  that made the skills column nullable — a row with no group context — cannot
  arise. It is a write-time snapshot stamped from the session fact the guard
  already covered, never re-derived, and it is what `attendanceFilterForReach`
  narrows a `GROUP` reach by.
- **The index D-061 names** — `(sessionId, studentProfileId, recordedAt)` —
  "answers the derivation directly", and does.
- **One hand-written constraint**,
  `AttendanceEvent_no_self_supersede_check`, proved in
  `tests/integration/attendance-constraints.test.ts`. The cross-row half of
  D-061's rule — a correction points at an event of the *same* session and
  pupil — is not expressible as a CHECK; `amendAttendance` enforces it inside
  the writing transaction and the service suite pins it.
- **The supersede FK is `NO ACTION`, not `RESTRICT`**, so D-111's retention
  prune can take a superseded event and its correction in one statement —
  they always share a session, so a per-session prune never strands the pair.
- **No derived `AttendanceStatus` table.** §3.4's own words: *"materialised
  only if measurement demands it."* Nothing has measured. The derivation is
  `effectiveAttendanceByStudent`, a pure function: per pupil, the latest
  event nothing supersedes — supersession beats recency, recency decides
  among survivors, and both halves are unit-tested.

### 0.2 The database-level carve-out — the first for a domain table

`00-overview.md` P-07 claims *"audit, attendance and progress are append-only
and queryable."* For attendance that claim was, until this phase, a red
warning: `tests/integration/attendance-append-only.test.ts` existed solely to
assert the gap, and its banner named the exit condition — *"a real
`Attendance` module shipped with its own carve-out (mirroring
`auditGrantStatements`)"*. That is what was built:

- `attendanceGrantStatements` (`src/lib/database/role-model.ts`), applied by
  `db:apply-grants` after every migration beside the audit exception, and
  verified by `applyRoleModel` the same way: the **runtime role holds
  `SELECT, INSERT` on `AttendanceEvent` and nothing else**; the **retention
  role holds the only `DELETE`** (D-111's pruner), and no `INSERT` — a prune
  records itself in the *audit* trail, never by writing attendance rows.
- `infra/attendance-database-role.sql` is the operator/auditor-readable copy,
  kept honest by `tests/unit/attendance-grant-sql-sync.test.ts` — the exact
  `audit-grant-sql-sync` shape.
- **Erasure still works, and the test proves the mechanism rather than
  asserting the intention**: the runtime role deletes a `StudentProfile` and
  the attendance rows go with it, because a referential action runs with the
  *owner's* privileges. The same mechanism severs `recordedByPersonId`
  (`SET NULL`) — and note for whoever builds R-25's `erasePersonData`: an
  *explicit* application-level `UPDATE … SET recordedByPersonId = NULL`
  would be **refused** by these grants. The sever must come from the FK's
  referential action (delete the `Person`) or run as the retention role.
  `PERSON_REFERENCE_CLASSIFICATION` says so on the entry itself.

### 0.3 What no service in this module will ever do

- Update or delete an `AttendanceEvent` — and, for the first time, *could
  not*: the database refuses the statement whoever writes the code path
  (`attendance-append-only.test.ts`, as the real runtime role).
- Write a partial register. One registration is one transaction (§4); a
  refused entry — a pupil not on the roster — refuses the lot, asserted
  directly.
- Write more than one audit event per registration (D-126). Per-pupil
  attribution is the attendance events' own job; they carry the actor.
- Put a note in the audit trail. Counts and a closed state vocabulary only,
  the `skills.progress.recorded` restraint.
- Register against a roster it computed itself. The effective roster — group
  members *on the lesson's own date* plus explicit entries — is `sessions`'
  published answer, one call, ids only.

---

## 1. Where this phase interpreted, stopped short, or declined — read before assuming a gap is an oversight

### 1.1 Writes guard `{ session }`, where §2.2's own example says `{ group }`

`02-security-privacy.md` §2.2 opens with `requirePermission(session,
'attendance.record', { group: groupId })` as *the* illustration of a guarded
write, and phase 2.1's `recordSkillProgress` took that shape literally. This
module deliberately does not, and the reason is a decision that postdates the
example: **D-179**. A make-up guest's receiving instructor, and a
`SESSION`-scoped substitute, have *no* relationship with the child or the
group beyond that lesson's roster — a `{ group }` guard would deny exactly
the people D-179 exists to let through. `{ session }` loses nothing in the
other direction: §2.2's own coverage matrix gives `GROUP` "that group, **its
scheduled sessions**", so the ordinary instructor passes the same guard, and
the scope-escape suite pins both directions (a `GROUP` instructor denied
group B's lesson; a `SESSION` substitute denied the next week's). This is a
considered divergence from the letter of the example toward the sense of the
matrix — flagged for Jack in case the example was meant as binding.
**Besloten (2026-09-09): akkoord as built** — the D-179 reasoning stands; the
`{ session }` guard is the ruling reading.

### 1.2 D-003's domain event — "attendance was registered, update progress" — is not published, because there is nothing to publish to

§1.2 of the domain model routes the upward `attendance → skills` signal
through an in-process domain event (D-003). No domain-event mechanism exists
anywhere in this codebase — no bus, no publisher, no subscriber, and `skills`
has no consumer waiting. Building a one-customer event bus inside this phase,
for a signal whose consumer does not exist, is the premature machinery
`CLAUDE.md` warns against; registering attendance therefore updates nothing
in `skills`, and nothing in the design says concretely what it *would* update
(§3.3's `SkillProgress` is written by an instructor's explicit act, not
derived from presence). **Left undone and named** — whoever builds the first
real event consumer should build D-003's mechanism then, with a real
subscriber to design against.
**Besloten (2026-09-09): akkoord** — stays unbuilt; attendance and skills are
deliberately separate things until a real consumer exists.

### 1.3 Only a `GROUP` reach narrows the student history — the same stance the skills follow-up settled, inherited deliberately

`getAttendanceForStudent` guards `{ student }`, then narrows per row via
`attendanceFilterForReach` — and only the `GROUP` variant narrows.
`ORGANIZATION`, `UNIT`, `COURSE`, `SESSION` and `SELF` see the full history,
exactly as `skillProgressFilterForReach` leaves them, and for the same
recorded reasons (phase 2.1 report §1.5): the design states no per-row rule
for those variants over this table, routing `COURSE` through `sessions`'
reach filter would deny an aftest assessor outright, and `SELF` is the
pupil's own record (D-146 names "own attendance" in the `SELF` set). D-145
rule 2 — the one narrowing the design *does* state — is the one built. If
Jack wants `UNIT` or `SESSION` narrowed too, the filter is one `case` away;
it was not guessed at here.
**Besloten (2026-09-09): akkoord as built** — only `GROUP` narrows,
consistent with skills.

### 1.4 The "child not in the session's group" scenario — CLOSED in the decision round: one guest mechanism, reachable by whoever records

`01-domain-model.md` line 429 calls this the expensive-to-retrofit shape:
*"attendance for a child who is not in the session's group touches the
roster, reach resolution and the attendance aggregate at once."* The model
this phase settled on is that **the roster is the boundary**: attendance is
recordable for exactly the pupils on the session's effective roster (derived
members at the lesson's date, plus explicit `SessionRosterEntry` rows), and a
child outside it is refused with `NOT_ON_ROSTER`. That keeps D-179's access
story intact (the recording instructor can *see* the child because the
roster row exists) and writes no attendance that reach resolution cannot
later justify.

**Besloten (2026-09-09), and built:** Jack wants no refusal-shaped dead end
and no split between "member of another group" and "true guest" — **one
mechanism** for every child who does not derive from the group. That
mechanism already existed structurally (a `GUEST` `SessionRosterEntry`,
D-109's own *"a guest added to a roster"*); what closed the gap is threefold:

1. **The roster-change guard is widened** (`requireRosterChange`,
   `roster-service.ts`): `groups.assign_members` **or** `attendance.record`
   on `{ session }` opens `addGuestToSession` and, symmetrically,
   `removeGuestFromSession`. §2.5's instructor sketch ("attendance, skill
   sign-off, read student basics") holds no `groups.assign_members`, so
   without the second door the poolside instructor was back to needing an
   administrator — D-179's own nightmare. The widening changes WHO, never
   HOW FAR: the resource reference stays `{ session }`, one lesson's roster,
   and the scope-escape suite pins that an attendance-only instructor of
   group A adds a guest to their own lesson and is denied group B's.
2. **The trial swimmer needs no new concept, and this is the model's answer,
   not this phase's invention**: `SessionRosterEntry.studentProfileId`
   requires a `StudentProfile`, and a `StudentProfile` requires no
   membership (D-060 — neither is a prerequisite for the other). So a
   proefzwemmer is registered as a pupil once, through the existing people
   screen, and added per lesson like anyone else. Proved end-to-end in
   `attendance-services.test.ts` (a profile with no membership anywhere:
   guest row, then ordinary registration). No lighter concept was needed, so
   none was invented — this open question dissolved rather than being
   decided.
3. **Group attribution of the resulting events**: stamped with the
   **session's** group, exactly as every registration already was — the
   `groupId` snapshot comes from `findSessionRegisterFacts`, never from the
   child's "own" group. This matches D-145's cross-unit rule (*"the group's
   unit governs that group's attendance"*) and how the snapshot already
   works. The one consequence worth stating: the guest's home-group
   instructor does **not** see that row through a `GROUP`-scoped read (it
   belongs to the host group); the host instructor and every broader reach
   do. That is the consistent reading, and it was Jack's stated preference.

The `NOT_ON_ROSTER` message and the lesson screen's guest section now say
all of this in Dutch and English — the refusal names the repair and the
repair is on the same screen. **What is still deliberately not built**: the
one-act "register attendance and create the roster row implicitly"
convenience — the roster row stays an explicit act, because it is the
access-affecting one (`grantsSessionReach` in its audit event).

### 1.5 A cancelled lesson refuses new registration; corrections still land

§3.4 does not state what happens when somebody registers attendance against
a `CANCELLED` session. This phase refuses it (`SESSION_CANCELLED`): a
cancelled lesson is one nobody attended, and `addGuestToSession` already
refuses cancelled lessons on the same logic. `amendAttendance` deliberately
does *not* re-check status or roster: a correction is about what happened,
and the lesson being cancelled *after* attendance was registered — or the
child leaving the group since — must not make recorded history
uncorrectable. Both halves are readings, not quotations; flagged.
**Besloten (2026-09-09): akkoord** — explicitly confirmed, both halves.

### 1.6 `SkillProgress` — P-07's third member — CLOSED in the decision round: the same carve-out, retrofitted

This report originally flagged the asymmetry (attendance protected by the
database, skills by module code only) and left the call to Jack. **Besloten
(2026-09-09): close it** — and it is closed, in this branch rather than a
separate skills one, because the mechanism lives here:

- `skillProgressGrantStatements` (`src/lib/database/role-model.ts`), applied
  and verified beside the audit and attendance exceptions: the runtime role
  holds `SELECT, INSERT` on `SkillProgress` and nothing else. Documented in
  `infra/skill-progress-database-role.sql`, sync-tested by
  `tests/unit/skill-progress-grant-sql-sync.test.ts`.
- **One deliberate difference from the attendance grants**: the retention
  role holds `UPDATE` here as well as `DELETE`. Severing
  `assessedByPersonId` on a recorder's erasure may need an explicit
  `SET NULL` that the runtime role can no longer issue (the FK's own
  referential action covers a `Person` DELETE; the future R-25
  `erasePersonData` covers the rest, running as retention). Attendance
  withholds `UPDATE` because its sever is FK-only and its expiry a pure
  prune; skills' `SKILL_PROGRESS` class is `REVIEW` at 7 years.
- No migration was needed: like the attendance carve-out, grants are not
  schema — `db:apply-grants` re-applies them after every migration, and the
  test database gets them through the same `applyRoleModel` path.
- The behavioural proof moved with it: `attendance-append-only.test.ts` now
  shows a real `SkillProgress` UPDATE and DELETE refused by PostgreSQL as
  the real runtime role, and `skills-fixtures.ts` was reworked to clean up
  through the `StudentProfile` cascade — the only door the runtime role
  still has, which is itself the property under test.

### 1.7 `clientEventId` is generated at page render, not by an offline client

P-02's data model is fully in place — the column, the unique index, the
skip-replayed-entries write path, and tests for whole and partial replays.
What generates the id today is the *server component* rendering the form, so
the collapse it buys is the double-submit and the browser retry, not yet a
true offline queue. That queue is client machinery this phase did not build;
when it arrives, the write path needs no change. (§3.4 calls the field "the
single most important forward-looking field in the schema" — the forward
part is now free.)

### 1.8 `AttendanceEvent.note` inherits the D-148 open question, unresolved

The phase 2.1 report's item 6 flagged that `SkillProgress.note` — free text
about a child, written often — is not in D-148's protected free-text class.
`AttendanceEvent.note` is the same kind of field with the same exposure
("ziek gemeld", "opgehaald door oma") and the schema comment points at the
same open question. Not decided here either; the two should be decided
together, by Jack.
**Besloten (2026-09-09): akkoord as built** — a purely internal instructor
field, governed by a usage rule, no technical enforcement added.

---

## 2. The dependency direction, against the design set's own DAG

§1.2's DAG allows `attendance → sessions` and `attendance → groups`
(*"`attendance` may ask `groups` who is in a group"*). The module as built
uses **only `attendance → sessions`**: the roster question is asked of
`sessions` (`findSessionRegisterFacts`), which owns the derived-plus-explicit
resolution and already asks `groups` for its half. No file under
`src/modules/attendance/` imports `@/modules/groups` or `@/modules/people` —
the `studentProfileId`/`recordedByPersonId` foreign keys are schema-level
references, not module imports. That is a narrower footprint than the DAG
permits, on the phase 2.1 precedent, and it means the roster logic exists in
exactly one place: the same `findSessionDetail`/`isOnSessionRoster` two-half
resolution reach checks already use, so the register and the reach can never
disagree about who was expected.

`groups` still never asks `attendance` anything; nothing in `groups`,
`sessions` or `skills` imports the new module. The one place outside
`src/modules/attendance/` that does is the UI layer and the shared
registries, which is where cross-module wiring belongs.

---

## 3. Definition of Done (`06-delivery.md` §4.4)

| Requirement | Status |
|---|---|
| Data model | `AttendanceState`, `AttendanceEvent` — schema + migration `20260909080000_attendance_module`, one hand-written CHECK |
| Service | `attendance-service.ts`: `registerSessionAttendance`, `amendAttendance`, `getSessionRegister`, `getAttendanceForStudent` — all behind `requirePermission`, on §2.5's own `attendance.read`/`attendance.record`/`attendance.amend` (already in the catalogue since phase 0.4; nothing invented) |
| UI | The register on the lesson screen (`/groups/[groupId]/sessions/[sessionId]`): first registration as one form for the whole roster, then per-line corrections and a late-guest line, plus the full struck-through history; the read-only attendance log on the person screen (`/people/[personId]`). Dutch and English strings both present, both valid JSON, parity-tested by the existing `message-catalog` suite |
| Scope-escape tests | `tests/integration/attendance-scope-escape.test.ts` — a `GROUP` instructor of group A denied group B's lesson for write and read, by name; D-145 rule 2's per-row narrowing (a pupil in two groups yields one row to the group's instructor, two to the organization); a `SESSION`-scoped substitute confined to their one lesson; the no-grant caller denied outright; and (decision round) the widened roster guard — an attendance-only instructor adds a guest to their own lesson, is denied group B's, and the no-grant caller is denied the roster change |
| Domain/service tests | `tests/unit/attendance-domain.test.ts`, `tests/integration/attendance-services.test.ts`, `tests/integration/attendance-constraints.test.ts`, `tests/integration/attendance-append-only.test.ts` (now proving the control), `tests/unit/attendance-grant-sql-sync.test.ts` |
| `Person`-reference registry | `AttendanceEvent.recordedByPersonId` — `SEVER_AND_RETAIN`, on the `SkillProgress.assessedByPersonId` pattern, with the append-only nuance recorded on the entry (§0.2). `studentProfileId` references `StudentProfile`, not `Person` — no entry needed, same as `Enrolment` |
| Erasure registry | `AttendanceEvent: { kind: "erase" }` — not `exempt`: append-only constrains *who* may delete, not whether erasure applies |
| Retention (`DATA_CLASS_BY_MODEL`) | `AttendanceEvent: "ATTENDANCE_EVENTS"` — the class that has been waiting since phase 1.6, closed in the schema commit |
| CI | After the decision round: `npx vitest run`: 70 files / 857 tests passed, zero regressions in the pre-existing 813. `npm run typecheck`: clean. `npm run lint`: clean (the one pre-existing, unrelated warning phases 2.0 and 2.1 also noted). `npm run format:check`: clean — including four files that already failed at `e4043aa`, formatted in their own `chore` commit rather than silently inside a feature one |
| Jack's approval | **Decision round completed 2026-09-09** — all eight items answered; the two that became work (items 4 and 6) are built on this branch |

**The original eight open items, and how the decision round settled each
(the full reasoning stays in the section each points at):**

1. §1.1 — `{ session }` write guard. **Besloten: akkoord as built** (D-179).
2. §1.2 — D-003's `attendance → skills` event unbuilt. **Besloten: akkoord**
   — deliberately separate until a real consumer exists.
3. §1.3 — only `GROUP` narrows the student history. **Besloten: akkoord as
   built**, consistent with skills.
4. §1.4 — the child outside the session's group. **Besloten: build it as one
   mechanism — and built**: the widened roster guard
   (`groups.assign_members` *or* `attendance.record`, on `{ session }`),
   trial swimmers covered by the model's own `StudentProfile`-without-
   membership shape (D-060 — no new concept needed, so the flagged model
   question dissolved), events attributed to the session's group.
5. §1.5 — cancelled lessons refuse new registration, accept corrections.
   **Besloten: akkoord**, explicitly confirmed.
6. §1.6 — the `SkillProgress` carve-out. **Besloten: retrofit it — and
   built**: `skillProgressGrantStatements`, retention holding
   `UPDATE`+`DELETE` (the sever), runtime role append-only, behaviourally
   proved.
7. §1.8 — `AttendanceEvent.note` and D-148. **Besloten: akkoord as built** —
   internal instructor field, usage rule, no technical enforcement.
8. §0.2 — the R-25 severing nuance. **Besloten: akkoord** — stays a recorded
   open build item, picked up only when a real erasure need arrives; the
   classification entries carry the instruction for that implementer.

**No new open questions came out of the decision round.** The one candidate
— whether a trial swimmer needs a lighter concept than `StudentProfile` —
turned out to be answered by the model itself (item 4 above) rather than a
genuine choice.
