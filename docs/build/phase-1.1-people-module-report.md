# Phase 1.1 — the `people` module

**Branch** `build/v1-foundation` · **from** `77208de` · **suite** 307 → **394**
passing.

The first domain module, and the one every other module depends on. Everything
before this commit range was foundation: identity, authorization, settings,
audit, retention. This is the first pass that stores something a swim school
would recognise.

---

## 1. What landed

| | |
|---|---|
| Tables | `MembershipPeriod`, `StudentProfile`, `StudentLifecycleEvent`, `PersonRelationship`; `Person` and `Membership` extended |
| Module | `src/modules/people/` — domain, infrastructure, application, 15 files |
| Surfaces | `/people`, `/people/[personId]`, `/people/[personId]/relationships/[id]/evidence` |
| Migrations | `20260904060000_people_module` |
| Tests added | 64 (five files, one fixture module) |
| Encrypted columns | 1 — the first production one in this schema |

### 1.1 The schema

```text
Person ──0..1── UserAccount
  ├─ 0..1  Membership ──< MembershipPeriod        lid / lidmaatschap
  ├─ 0..1  StudentProfile ──< StudentLifecycleEvent   leerling
  └─ N     PersonRelationship (from / to)         ouder, voogd, noodcontact
```

`Person` gained `dateOfBirth`, `email` and `phone`; `Membership` gained
`memberNumber`. Nothing else on the identity spine changed.

### 1.2 The module

```text
src/modules/people/
  domain/          guardian-authority · membership · student-lifecycle · numbering
  infrastructure/  person-repository · person-reach-filter · people-scope-relations
                   relationship-sources · registrations
  application/     people-service · membership-service · student-service
                   relationship-service · input
```

Domain is pure: no I/O, no clock of its own, `at` always passed. Infrastructure
holds the queries and the two registries this module supplies to. Application is
guard → validate → write → audit, in one transaction, every time.

---

## 2. How it wired into each phase-0 mechanism

### 2.1 `requirePermission` / `resolveReach` / `coversResource`

Every read of person data goes through them, and there is no branch in the module
that reaches a row without one.

**Single resources** are `requirePermission(principal, permission, { person })` or
`{ student }` — resource-referenced, never a bare check (D-030).

**Lists** resolve a `Reach` and hand it to the repository as a required argument
(D-031). `src/modules/people/infrastructure/person-reach-filter.ts` is the
translation, and it is the first one in this codebase. Three properties:

- **Every branch mirrors `coversResource(reach, { person })`.** If the two ever
  disagree, either a listable person fails their own detail page, or a person
  nobody may open appears in a list. The scope-escape suite compares them row by
  row over every person in the database, not over a hand-picked pair.
- **It has three outcomes, and `DENIED` is one of them.** A `GROUP`-scoped
  instructor covers no `Person` at all; the naive translation of that is an empty
  `where`, which renders as *"no people found"* — indistinguishable from a club
  with no members.
- **The switch is exhaustive**, so adding a scope type is a compile error here.
  That is D-147's intended cost, paid for the first time.

The module owns three of the thirteen scope relations — `unitOfPerson`,
`homeUnitOfStudent`, `personOfStudent` — and registers them through
`ensurePeopleRegistrations()`, called at the top of every service operation.
**Not** an import-time side effect: that would make correctness depend on module
evaluation order and, under a bundler that chunks server code, on which chunk
pulls the module in first — a failure that appears as a denial in production and
passes every test.

No `Reach` is constructed anywhere in the module. No permission check is skipped
"because the caller already checked".

### 2.2 The crypto envelope

`PersonRelationship.evidence` is **the first production encrypted column in this
schema**. The registry entry, the `/// @encrypted` marker and the column arrived
in one commit, which is the property `encrypted-column-registry.test.ts` exists
to force.

- `columnId` is `person_relationships.authority_evidence` — permanent, bound into
  the AAD of every value ever written for it.
- It derives under a **new HKDF purpose**, `relationship-evidence-v1`, and not
  under `medical-v1`. `medical-v1` is D-112's branch for special-category columns;
  guardian evidence is ordinary personal data that happens to be sensitive free
  text. One key for two data classes with two lawful bases and two retention
  policies is the collapse F-95 describes, one layer down.
- The repository types it `Sealed<"person_relationships.authority_evidence">`, so
  handing the column a plaintext is a compile error.
- The ciphertext is in **no** general projection. The person page selects a
  boolean — does evidence exist — and the one function that returns the value says
  so in its name.

Proven end to end in `people-writes.test.ts`: the stored bytes start `v1:`, the
plaintext is absent from them, `keyIdOf` reads the generation without decrypting,
and `JSON.stringify` of the whole person detail contains neither the value nor the
envelope.

### 2.3 The audit chain

Every write that touches personal data is an audited event, carrying identifiers
and field NAMES and never a value. Nine event types:

```
people.person.created                     people.membership.created
people.person.updated                     people.membership_period.started
people.student_profile.created            people.membership_period.ended
people.student_lifecycle_event.recorded   people.relationship.recorded
people.relationship.ended                 people.relationship.evidence_revealed
```

**`recordAuditEvent` and `appendAuditEvent` gained an optional transaction
client, and the first domain module is what made it necessary.** Without it the
append opens its own transaction on a different pooled connection and commits
independently — so a rolled-back write leaves behind an audit event for a change
that never happened, on an append-only trail that cannot then be corrected. Every
write in this module passes its `tx`, and `people-writes.test.ts` proves the
rollback case by forcing a unique-index violation after the append would have run.

The cost is stated in the audit repository's own doc comment: `pg_advisory_xact_lock`
is transaction-scoped, so the append lock is now held until the *caller's*
transaction commits. That is the same throughput constraint `05-technical.md` §5
rule 7 is about, and it is the right trade — a slower append is a performance
problem, an audit event for a change that did not happen is an integrity one.

The evidence disclosure uses the **throwing** variant and awaits it **before** the
plaintext is produced: a disclosure whose record could not be written does not
happen.

### 2.4 `RetentionPolicy` and the erasure registry

| Registry | What was added |
|---|---|
| `DATA_CLASS_BY_MODEL` | `MembershipPeriod` → `MEMBERSHIP_PERIODS`; `StudentProfile` and `StudentLifecycleEvent` → `STUDENT_PROFILE`; `PersonRelationship` → `PERSON_RELATIONSHIPS` (new class) |
| `RETENTION_CATALOGUE` | one proposal for `PERSON_RELATIONSHIPS`, `proposedLawfulBasis: UNRESOLVED` |
| `ERASURE_REGISTRY` | `StudentProfile` and `PersonRelationship`, both `erase` |
| `PERSON_REFERENCE_CLASSIFICATION` | `StudentProfile.personId`, `PersonRelationship.fromPersonId`, `PersonRelationship.toPersonId`, all `HARD_DELETE` |

`MembershipPeriod` and `StudentLifecycleEvent` are **deliberately absent from the
erasure registry**: they reference no `Person`, so the completeness test's third
assertion forbids an entry, and they leave by cascade with the row they belong
to. Their foreign keys are the only `onDelete: Cascade` edges in the domain half
of the schema. Asserted explicitly, because "no entry" and "forgotten" look
identical from outside.

**D-066's relationship sources**: the module registers three —
`membershipPeriodSource` (which *replaces* the period-less `membershipSource`
phase 0.4b could only half-build), `studentProfileSource`, and
`guardianRelationshipSource`. `RELATIONSHIP_SOURCES` became a **registry** rather
than a const array, for the reason its own comment anticipated and one it could
not: the sources now live in the module that owns their tables (D-057), and a
const array naming them would have imported the module that imports it.

D-066's composability claim — *"a guardian is held only while the child they are
guardian of is held, which follows automatically from the rule"* — is now proven
against **real rows** rather than fakes, in
`people-relationship-retention.test.ts`. The aggregation itself did not change by
one line.

### 2.5 `docs/glossary.md`

Eight terms added before they were used: `memberNumber`, `studentNumber`,
`MembershipPeriod`, `StudentLifecycleEvent`, the `PAUSED` state, `authority`,
`evidence`, `ageOfDigitalConsentYears`.

---

## 3. Every ambiguity resolved, and how

These are the places the design was silent, self-contradictory, or contradicted
by the brief. Each is a decision I made and would undo on request.

### 3.1 `StudentLifecycleEvent` has no `MOVED_GROUP` — **the one I would most like checked**

The brief lists the lifecycle as *"joined, moved group, paused, returned, left"*.
`01-domain-model.md` §3.1 gives the type set as `JOINED / PAUSED / LEFT /
RETURNED / TRIAL_ATTENDED`, and §2.2 gives a group move **its own entity** —
`GroupMove >── StudentProfile (up or down, reason-carrying)` — owned by the
`groups` module.

Both cannot hold. D-134 allows a normative fact exactly one home, and "when did
this child change group" recorded in two places drifts the first time one is
written without the other. The owning module wins, because a group move needs the
two group ids `StudentLifecycleEvent` has nowhere to put.

**The domain constraint travels with it, and is written into the enum's doc
comment so a reader looking for "moved group" finds it**: moving a child DOWN a
level must be as ordinary in the history as moving up — no direction flag that
reads as a failure, no "demotion" wording, no screen rendering one direction in
red. That is a rule about `GroupMove` and it is now recorded where the `groups`
module's author will hit it.

### 3.2 `Person.dateOfBirth` is NULLABLE

§3.1's table writes it non-optional. D-172 is later and explicit: a placeholder
date is **forbidden outright** ("indistinguishable from a real one the moment it
is written"), the importer rejects a row it cannot parse a date for, and *"where
the column must accept null for an imported record, unknown date ⇒ authority
treated as lapsed"*.

A `NOT NULL` column cannot express that — it forces exactly the thing D-172
forbids. So the column is nullable, and `resolveGuardianAuthority` fails a null to
`LAPSED_UNKNOWN_BIRTHDATE`: the safe direction and, more importantly, the visible
one.

Stored as a `DATE`, not a timestamp, and rendered in UTC everywhere. A birthday is
a calendar day; west of Greenwich, formatting it in the configured zone moves 1
May to 30 April, and D-151's whole control is a comparison against that date.

### 3.3 `StudentProfile.unitId` is NULLABLE

§3.1 writes it without a `?`. Nothing in v1 creates an `OrganizationUnit`: there
is no units module, no seeded unit, and the club has one location. A `NOT NULL`
column would make registering a pupil impossible until a module outside this pass
exists.

Null **denies** `UNIT` reach rather than widening it — `homeUnitOfStudent` returns
null and every coverage rule is a positive membership test — so the nullable
column fails safe.

### 3.4 Membership operations are gated on `people.update`

§2.5's catalogue defines `people.*` and `students.*` and **no** membership
permission, while §2.4's *Member Administrator* is the role that administers
membership. §2.5's own rule settles it: *"a permission referenced anywhere in the
design set and absent here is a defect, not a shorthand."* Inventing
`membership.manage` at the call site would put the catalogue's second home in a
service file, which is what `PermissionKey` being a union rather than `string`
exists to prevent.

If the club later wants member administration separable from rectification, the
fix is a catalogue key in §2.5 and one edit — not a string invented locally.

### 3.5 Creating a `Person` requires `ORGANIZATION`-scoped `people.create`

A person who does not exist yet has no unit, no group and no home, so there is
nothing narrower for D-030's required resource reference to name. The consequence
is stated rather than hidden: a `UNIT`-scoped Member Administrator **cannot
register a new person**. That is the honest reading of a scope model in which
coverage is resource containment (D-170) and the resource does not exist yet; the
alternative is a create path naming no resource at all, which D-030 forbids for
exactly this reason.

### 3.6 `PERSON_RELATIONSHIPS` is a new `DataClass`

§5's table has no row for guardian relationships. Folding them into
`PERSON_IDENTITY` would put encrypted, custody-relevant free text under the
identity policy's 24-month `REVIEW` — a retention decision made by accident. The
enum already had a documented precedent for classes the chapter never listed
(`ROLE_ASSIGNMENTS`, `RATE_LIMIT_COUNTERS`, `API_CREDENTIALS`), each shipping with
`proposedLawfulBasis: UNRESOLVED`. This follows it.

The basis is genuinely unresolved and is the organisation's to settle: `CONTRACT`
(part of administering the lessons the family signed up for) and
`LEGAL_OBLIGATION` (Art. 5(2) accountability evidence behind every consent a
guardian gave) are both defensible.

### 3.7 `PersonRelationship.evidence` is encrypted; `StudentLifecycleEvent.reason` is not

D-148's protected free-text class is medical remarks, pastoral notes, assessment
remarks and inquiry text. Neither field is named in it.

Evidence is encrypted anyway: it is free text about a family's legal
arrangements, and D-063's own worked example for why the field exists is a
custody dispute. Its read is audited for the same reason — stricter than the
design requires, and recorded here so the next reviewer argues with a decision
rather than discovering one.

A lifecycle reason (*"verhuisd"*, *"even te druk op school"*) is not in that
class and is **not** encrypted. The risk that somebody types a medical fact there
is real, and it is answered where the design answers it: a length bound, a
purpose line at the capture point saying what does not belong in the field, and
`students.notes.*` existing for anything that is actually a note about the child.

### 3.8 The relationship write order — a constraint the design did not anticipate

`PersonRelationship_evidence_required_check` (D-063) fired **between** the two
statements that create a relationship. The evidence is sealed with the row's own
primary key in the AAD (D-096) — the binding that stops one family's evidence
authenticating against another's row — so the id must exist before the value can
be sealed, and the id is assigned by the insert.

Three ways out were available:

1. Mint the id in the application. The schema's ids are `cuid(2)` with no exported
   generator, so this meant a second id-minting convention in one column, or a
   new dependency, to work around a constraint's timing.
2. **Defer the check to commit.** Attempted, and rolled back: *Postgres does not
   support `DEFERRABLE` CHECK constraints.* The migration is not in the history —
   it was `migrate resolve --rolled-back` and deleted.
3. Create the row **without** the authority claim, and make the claim in the same
   statement that records its basis.

Took 3, and on reflection it says the rule rather than working around it: **you
cannot claim authority until the basis for it is recorded.** The failure mode if a
future refactor drops the second statement is a claim *not made*, rather than a
claim with no evidence.

### 3.9 Smaller ones

- **`Person.email` is not `UserAccount.email`.** The first is a contact address
  for someone who overwhelmingly has no account (a child, a guardian) and is not
  unique — two siblings share a parent's address. The second is a login
  identifier. Merging them would make a contact address a credential.
- **A membership period's `endReason` is free text, not an enum.** The reasons a
  family leaves are open-ended, and a closed vocabulary contains the reasons
  somebody thought of.
- **Overlapping *closed* membership periods are allowed**; two *open* ones are
  not. A club back-filling its paper history produces overlaps, and refusing
  legitimate history to enforce tidiness is how a status flag gets reinvented.
- **No `recordedByPersonId` anywhere.** Who did it is accountability evidence and
  its home is the audit trail, which already carries `actorPersonId` for every
  write here. A person column would be a second, mutable copy — and a further
  `Person` reference for the erasure registry to classify, for no fact the trail
  does not hold.
- **A `StudentProfile` with no events is `ACTIVE`, not unknown.** It exists
  because somebody registered a pupil; reporting otherwise would treat "nobody
  has typed a JOINED event yet" as "this child is not our pupil".
- **The landing-page link to `/people` is not permission-gated.** §1.1 rule 1
  separates UI gating from authorization, the screen itself refuses with a denial
  naming the missing permission, and a volunteer who cannot see the link cannot
  ask for the grant.

---

## 4. Definition of done — real output

Run on `build/v1-foundation`, working tree clean, 2026-09-04.

### `npx prisma validate`

```
Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀
```

### `npx tsc --noEmit`

```
(no output — exit 0)
```

### `npm run lint`

```
> splashtrack@0.1.0 lint
> eslint

(no findings)
```

### `npm run format:check`

```
Checking formatting...
All matched files use Prettier code style!
```

> This was **red at `77208de`** — three files under `src/cli/` that a Prettier
> version bump reformats. Fixed in its own commit (`9262139`) so it is not hidden
> inside the module work.

### `npm run build`

```
✓ Compiled successfully in 4.2s
  Running TypeScript ...
  Finished TypeScript in 6.7s ...
✓ Generating static pages using 5 workers (7/7) in 434ms

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/auth/[...all]
├ ƒ /api/health
├ ƒ /api/ready
├ ƒ /people
├ ƒ /people/[personId]
├ ƒ /people/[personId]/relationships/[relationshipId]/evidence
└ ƒ /sign-in
```

### `npm test`

```
 Test Files  32 passed (32)
      Tests  394 passed (394)
   Start at  08:31:35
   Duration  22.52s (transform 771ms, setup 495ms, import 4.27s, tests 13.12s, environment 4ms)
```

Baseline at `77208de` was **307 passed (26 files)**. The new and changed files:

| File | Tests |
|---|---|
| `tests/integration/people-scope-escape.test.ts` | 19 |
| `tests/integration/people-writes.test.ts` | 15 |
| `tests/unit/people-domain.test.ts` | 15 |
| `tests/unit/guardian-authority.test.ts` | 13 |
| `tests/integration/people-relationship-retention.test.ts` | 11 |
| `tests/integration/people-guardian-authority.test.ts` | 6 |
| `tests/unit/erasure-registry-sync.test.ts` | 6 → 8 |
| `tests/integration/last-relationship.test.ts` | 8 → 10 |

### `npm run db:recreate` (fresh database, from empty)

```
All migrations have been successfully applied.
```

### `npx prisma migrate deploy`

```
Datasource "db": PostgreSQL database "splashtrack", schema "public" at "localhost:5432"
12 migrations found in prisma/migrations
No pending migrations to apply.
```

### Drift check — `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`

```
-- This is an empty migration.
```

---

## 5. What the new tests prove

The brief named five. Each one, and where it lives:

**A `GROUP`-scoped instructor cannot read a person outside their reach, and the
failure is a denial rather than an empty list.**
`people-scope-escape.test.ts`. Read, write and list are all denied; the list
assertion checks that the call **threw**, not that it returned nothing. Two
assertions go beyond the minimum:

- the instructor's reach is asserted **non-empty**, so the denials are about
  coverage and not about a grant that does not exist;
- the list is compared to the per-row guard **row by row over every person in the
  database**. A list returning more than the guard allows is F-15 one level down;
  returning less is a screen nobody can use.

The full §2.1 matrix is there — `GROUP`, `UNIT` (flat), `SESSION` inside and
outside its window, and reach construction refused structurally — plus a lapsed
`InstructorAssignment` reaching nothing (D-145 rule 1, F-114).

**Leave-and-return produces two `MembershipPeriod` rows and destroys no history.**
`people-writes.test.ts`. Two rows; the first compared field-by-field to prove it
is untouched; one `Membership` and one member number across the gap; and the
derived answers — member in 2021, **not** in 2023, member again now — which is
precisely what a status flag destroys. The partial unique index is proven
separately by writing past every service.

**Guardian authority evaluates as lapsed once the child passes the configured age,
without any job running.**
`guardian-authority.test.ts` (the rule) and `people-guardian-authority.test.ts`
(the wiring). The integration test compares `updatedAt` before and after the
child is sixteen: **if anything ever starts marking rows on a birthday, that
assertion goes red.** It also proves the *configured* age is the age used —
thirteen lapses where sixteen does not — and that an unknown date of birth lapses
to a named outcome a human can act on.

**The erasure-registry completeness test still passes, with every new table
classified.**
`erasure-registry-sync.test.ts`, now naming both new tables and their answer, and
asserting that the two cascade-only tables are correctly absent.

**An audit event exists for each personal-data write.**
`people-writes.test.ts`. Per event type, with the actor and target; the
`changedFields` compared exactly and then grepped for the submitted name and date
of birth; a refused write leaving no event; and a rolled-back write leaving none
either.

---

## 6. Follow-ups this pass created or sharpened

1. **`docs/design/09-decision-register.md` should record `PERSON_RELATIONSHIPS`**
   as a data class and its unresolved basis, alongside the three classes phase
   0.4b added on the same footing.
2. **D-151's re-consent queue does not exist yet.** The derivation produces
   `requiresReconsent` and the person page renders it per relationship; the queue
   that collects them across the instance belongs to the privacy admin area
   (D-172), which is a later pass. What exists is the predicate it will read.
3. **The `SafetyNote` (D-177) is the next pass**, as the brief says. It is the
   second entry in `ENCRYPTED_COLUMNS` and the first in D-148's protected class,
   so it also brings read-auditing as a *rule* rather than as this module's
   judgement call.
4. **`students.medical.*` and `students.notes.*` have no columns yet.** They are
   named in the permission catalogue and gate nothing. The `students` module owns
   them.
5. **Group moves.** `GroupMove` is the `groups` module's, with the
   direction-symmetry constraint recorded in
   `src/modules/people/domain/student-lifecycle.ts`.
6. **`Enrolment` will add a fourth relationship source.** §5.1's "an active
   `StudentProfile` enrolment" is answered today from the profile's own lifecycle,
   which is what this module can answer honestly. The registry takes one more
   entry; the aggregation does not change.
7. **The bulk CSV importer (D-157)** is where D-172's row-rejection rule actually
   bites. `optionalDate` already refuses an unparseable date rather than
   synthesising one, which is the half of the rule this module owns.

---

## 7. The one question I had to answer myself

**Does `StudentLifecycleEvent` carry a group move?** §3.2 above has the full
reasoning; the short version is that the brief says yes and the design set says no
twice, so the design set won and the constraint the brief was really carrying —
that moving down must read as ordinarily as moving up — is recorded where the
module that owns the move will find it.

If the answer is that the club genuinely wants a *group-independent* "changed
level" event on the pupil's own timeline, distinct from `GroupMove`, that is a
different entity and it is additive: one enum member, one migration, no rewrite.
It is worth asking Jack, because the two readings produce different screens.
