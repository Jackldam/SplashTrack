# Phase 0.4b — the scope/reach model and retention/erasure

**Branch** `build/v1-foundation`. **From** `5346b46` (end of phase 0.4a). **Date**
2026-09-03.

The second half of phase 0.4: `requirePermission` / `resolveReach` /
`coversResource` (D-147) and the retention/erasure columns (D-014, D-065,
D-066), left untouched by `docs/build/phase-0.4a-crypto-and-audit-report.md`
§7. Both are covered here — the reach model landed first, in two commits; the
retention/erasure mechanism completes it in four more.

---

## 1. What landed

| Commit | What |
|---|---|
| `c3ec2fe` | The grant tuple gains scope, validity and a granter (D-144, D-170, D-147) |
| `1aa52b3` | The scope/reach model — `requirePermission`, `resolveReach`, `coversResource` (D-147, D-145, D-139, D-170) |
| `9aa567a` | `RetentionPolicy` per data class, one row per class (D-065, D-110, D-155) |
| `9e7fe6a` | Data-class registry, bidirectionally synced against the schema (D-065, D-110) |
| `6fdc8c3` | D-014 erasure registry, completed per D-154 — `erase` \| `exempt(ground, until)` |
| `7a62f5b` | D-066 last-relationship-of-any-kind mechanism, guardian composability proven |
| *(this file)* | The report |

### 1.1 The reach model (`c3ec2fe`, `1aa52b3`) — landed before this task, read from its own commits

The grant tuple was `(personId, roleId, unitId?)` — two of `ScopeType`'s six
members and no validity window at all (F-113: an external examiner who
assessed one Saturday in March kept `exams.results.record` on that session
forever, and D-062's append-only results made a later amendment the effective
outcome).

- `ScopeType` enum, one member per `02-security-privacy.md` §2.1 scope type.
  `RELATED` is deliberately absent (OD-5, D-161). `unitId` is replaced (not
  joined) by `(scopeType, scopeId)` — `scopeId` carries no foreign key because
  its referent table depends on the scope type.
- `validFrom` / `validUntil` / `grantedByPersonId`, three hand-written CHECK
  constraints and a partial unique index the Prisma DSL cannot express.
  `validUntil` is mandatory for `SESSION` (D-144) and `COURSE` (D-170).
- `Reach` (`src/lib/authorization/reach.ts`) — an opaque, branded discriminated
  union, one variant per scope type plus `NONE` and `UNION`, constructible only
  by `resolveReach`, enforced at compile time (a non-exported unique symbol)
  and at run time (the same symbol is a real property, so a cast is caught).
  No `all: boolean` — organisation-wide reach is a variant only an
  `ORGANIZATION` grant can produce (F-112).
- `coversResource()` — named in the design, defined nowhere until now. Coverage
  is per relation and evaluated live (D-145): `GROUP` requires an active
  instructor assignment, `SESSION` is checked against its own window (D-068,
  D-179), `SELF` comes from a real seeded grant, never an implicit match
  (D-146). Expiry is evaluated inside `requirePermission` and `resolveReach` —
  never a cleanup job (D-144).
- `assertGrantable`: the §2.6 anti-amplification invariants.
- The §2.5 permission catalogue, the §1.2 high-risk set and D-146's `SELF` set,
  with `authorization-vocabulary-sync.test.ts` parsing §2.5 out of the design
  directly and failing in both directions.

Suite at `1aa52b3`: 145/145 green — this was the baseline this task inherited
and verified before touching anything.

### 1.2 `RetentionPolicy` per data class (`9aa567a`) — reviewed, one defect fixed

Inherited **uncommitted**: `prisma/schema.prisma` (+264 lines: `RetentionPolicy`,
`DataClass`, `LawfulBasis`, `RetentionTrigger`, `OnExpiry`, and a `///
@dataClass <CLASS>` marker on every model), the migration, and
`src/lib/retention/catalogue.ts` (23 proposal entries, one per `DataClass`
member). One test was red for the right reason:
`person-reference-sync.test.ts` had no classification for the new
`RetentionPolicy.confirmedByPersonId` column — D-014's forcing function doing
exactly its job. Fixed with a `SEVER_AND_RETAIN` entry.

**A real defect found by review, not by inspection.** The inherited
`RetentionPolicy_confirmation_shape_check` required `confirmedLawfulBasis`,
`confirmedAt` **and** `confirmedByPersonId` to be null-or-set together. But
`confirmedByPersonId`'s FK is `ON DELETE SET NULL` — when its confirmer is
erased, the database nulls *only* that column, leaving the other two set. The
three-way CHECK then rejected that `UPDATE`, and the confirmer's own erasure
rolled back entirely. This is the identical Article 17 failure mode
`person-reference-classification.ts`'s own doc comment already warns about for
`OrganizationBranding.updatedByPersonId` in the template — reproduced here
through a CHECK constraint instead of a `Restrict` FK, and it would not have
been caught by `prisma validate`, `tsc`, or a migration diff. Only a test that
actually erases the confirmer catches it, which is why one exists now
(`tests/integration/retention-policy-constraints.test.ts`, "SEVERS the
confirmer pointer"). Fixed by dropping `confirmedByPersonId` from the
symmetry — it is accountability metadata, severed independently, and "a
confirmation stands after its confirmer leaves" (F-27) requires exactly that
decoupling. The fix is in the migration file itself (this migration had not
shipped), reapplied to both the dev and test databases by hand since editing
an already-applied migration file does not retroactively re-run it.

Everything else in the inherited work held up under review: the `ANONYMISE`
aggregate CHECK (D-155), the confirmation-shape null handling, the retain-for
positivity check, and the catalogue's own conclusions (no entry claims
`ANONYMISE` — attendance already reads `DELETE`, matching D-111's independent
reasoning; `Charge`/`Payment`'s `PSEUDONYMISE` reads as `REVIEW` + a future
erasure exemption rather than a fourth `OnExpiry` member, matching D-154's own
argument almost exactly).

`tests/unit/retention-catalogue.test.ts` is new: the catalogue covers exactly
the `DataClass` enum (both directions), every `ANONYMISE` entry names an
aggregate and every non-`ANONYMISE` entry does not, every `retainForDays` is a
positive integer or `null` and never exceeds `PLATFORM_MAXIMUM_RETENTION_DAYS`,
and the `RetentionProposal` type itself has no `confirmedLawfulBasis` field —
seeding a confirmation is a type error, not a discipline.

### 1.3 Data-class registry (`9e7fe6a`)

`DATA_CLASS_BY_MODEL` (`src/lib/retention/data-class-registry.ts`) binds every
model to its `DataClass`, mirroring the schema's `/// @dataClass` markers.
`tests/unit/data-class-registry-sync.test.ts` checks both directions plus a
third the encrypted-column precedent doesn't need: every model the schema
declares carries a marker at all (not only the ones with an entry), so a new
table with a forgotten marker fails the build rather than shipping
unclassified. Same shape D-167 uses for `/// @encrypted <columnId>` /
`ENCRYPTED_COLUMNS` — D-135's registry-with-a-test pattern, reused a third
time now (person-reference, encrypted-column, data-class).

### 1.4 D-014 erasure registry, completed per D-154 (`6fdc8c3`)

`ERASURE_REGISTRY` (`src/lib/retention/erasure-registry.ts`) is table-level:
every model referencing `Person` gets `{ kind: "erase" }` (the default —
column-level handling stays in `PERSON_REFERENCE_CLASSIFICATION`) or
`{ kind: "exempt", ground, until }` (the whole table carved out, with the
ground and the mechanism that eventually ends the exemption stated in the file
itself). `AuditEvent` is the one `exempt` entry — D-154's own example, Art.
5(2) accountability, bounded by the D-168 checkpointed prefix prune rather
than by erasure.

`tests/unit/erasure-registry-sync.test.ts` proves completeness against the
same field-detection logic `person-reference-sync.test.ts` uses, grouped to
model names, and proves the check is **non-vacuous**: a dedicated test clones
the real registry, deletes the `AuditEvent` entry, and asserts the check flags
exactly that name — the "temporarily remove an entry and show it goes red"
proof, kept as a standing regression test rather than a one-off manual check
that nobody re-runs.

`Charge`/`Payment` are not registered — those tables don't exist yet (the
`fees` module isn't extracted). The file's doc comment names their eventual
shape (`exempt("fiscal administration", 7 years)`, D-092/D-154) so the day
they land, the completeness test refuses to let them go unclassified rather
than requiring someone to remember.

### 1.5 D-066 last-relationship-of-any-kind (`7a62f5b`)

`resolveLastRelationshipEnd` (`src/lib/retention/last-relationship.ts`)
implements D-066: a person's retention clock starts at the end of their *last*
relationship of any kind, not membership. A `RelationshipSource` registry
rather than one query, because only two of §5.1's relationship kinds have a
table today — `Membership` (existence only; no period columns, `MembershipPeriod`
is future `people`-module work per D-059) and `RoleAssignment` (a real
`validFrom`/`validUntil` window). `RELATIONSHIP_SOURCES` grows by one entry
per future module; the aggregation rule — held if *any* source holds, else the
*latest* end across all of them — never changes.

See §3 for how the guardian claim is proven without a `PersonRelationship`
table, which does not exist yet.

---

## 2. Definition of done — real output

Run at `7a62f5b`, in the order below.

```text
### npx prisma validate
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀

### npx tsc --noEmit
(no output — clean)

### npm run lint

> splashtrack@0.1.0 lint
> eslint

(no output — clean)

### npm run build
✓ Compiled successfully in 1009ms
  Running TypeScript ...
  Finished TypeScript in 4.9s ...
✓ Generating static pages using 5 workers (5/5) in 349ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/auth/[...all]
├ ƒ /api/health
└ ƒ /api/ready

### npm test
 Test Files  23 passed (23)
      Tests  281 passed (281)
   Duration  ~11s

### npm run db:recreate   (drop + recreate a scratch database, `prisma migrate deploy` from empty — R-20's fresh-install path)
[recreate-database] Dropped and recreated "splashtrack_freshcheck".
Applying migration `20260902230852_foundation_identity_authorization_settings_audit`
Applying migration `20260903044536_remove_platform_role_assignment`
Applying migration `20260903044636_remove_audit_event_organization_scope`
Applying migration `20260903064952_remove_organization_scoping_columns`
Applying migration `20260903065203_rename_organization_membership_to_membership`
Applying migration `20260903065629_merge_platform_settings_into_organization_singleton`
Applying migration `20260903065700_drop_membership_status_flag`
Applying migration `20260903065800_add_audit_checkpoint`
Applying migration `20260903130526_scope_and_validity_on_grants`
Applying migration `20260903132751_retention_policy_per_data_class`
All migrations have been successfully applied.
```

145/145 at the start (reach model only, classification fix already applied) →
281/281 at the end. 136 new tests, all from this task: retention catalogue
completeness (96 — `it.each` over all 23 `DataClass` entries × several
invariants), retention-policy DB constraints (12), data-class registry sync
(6), erasure registry completeness and non-vacuousness (6), last-relationship
mechanism (8 unit + 8 integration).

**New tests proving the three things explicitly asked for:**

- Erasure-registry completeness fails non-vacuously —
  `tests/unit/erasure-registry-sync.test.ts`, "the completeness check is
  NON-VACUOUS: deleting a real entry is caught".
- `ANONYMISE` cannot be satisfied by a row-level scrub —
  `tests/integration/retention-policy-constraints.test.ts`, "REFUSES ANONYMISE
  with no anonymisedAggregate", against the real `RetentionPolicy_anonymise_requires_aggregate_check`
  CHECK constraint.
- D-066's last-relationship trigger keeps a guardian while the child is kept —
  `tests/unit/last-relationship.test.ts`, the four "D-066: a guardian is held
  only while the child is held" cases.

---

## 3. Ambiguities the design did not settle, and how each was resolved

**D-154's "table" registry vs. D-014's column-level classification are two
different axes, and the design does not say so explicitly.** `PERSON_REFERENCE_CLASSIFICATION`
answers "what happens to this pointer FROM some row TO the erased person"
(`HARD_DELETE` / `CASCADES` / `SEVER_AND_RETAIN` / `RETAIN_BY_DESIGN`). D-154's
`erase | exempt(ground, until)` answers "is this TABLE's participation in
erasure normal, or is the whole table carved out." Reading D-154 literally as
a second, competing classification scheme for the *same* columns would have
produced two files disagreeing about `AuditEvent.actorPersonId`. Resolved by
building `ERASURE_REGISTRY` as a **table-level** registry that the column-level
one already implies: `AuditEvent` is `exempt` there *because*
`actorPersonId` is `RETAIN_BY_DESIGN` here, not the other way round. Documented
prominently in `erasure-registry.ts`'s own doc comment.

**D-065's per-row retention fact has no table to attach to yet.** The design
text ("the record is retained with its ground recorded") describes an
*individual record* an erasure request could not remove — `Charge`/`Payment`'s
eventual `exempt("fiscal administration", ...)` shape. No such table exists
yet (the `fees` module isn't extracted), so nothing was built against it; the
erasure registry's own doc comment names the shape for when it lands, so the
completeness test — not a person's memory — is what stops it going
unclassified.

**D-066's guardian claim has no table to test against for real.** `PersonRelationship`
(guardian ↔ child) is explicitly `people`-module, phase-0.4b-does-not-build
work (`01-domain-model.md` §2.4's `ScopeType` discussion is the schema's own
confirmation: `RELATED` was deferred to the guardian portal, and a guardian's
consent authority is named as "a `PersonRelationship` fact" that has no table
yet). Building the real source was not possible without inventing a table this
phase has no mandate to add. **Resolved by proving the mechanism's
composability against a fake stand-in source** rather than skipping the test
or building the table early: `resolveLastRelationshipEnd` takes a source list
as a parameter specifically so this is possible, and the fake "guardian of"
source asks the child's own `resolveLastRelationshipEnd` rather than storing an
end date, which is exactly the "follows automatically from the rule" the
design states. When `PersonRelationship` lands, it plugs into
`RELATIONSHIP_SOURCES` unchanged; the aggregation rule under test today is the
same rule it will run against.

**`Membership` cannot date its own ending.** §5.1 lists "an active
`MembershipPeriod`" as a relationship source, but only `Membership` exists
today — one row per person, no start/end columns (`MembershipPeriod`, D-059, is
future work the model's own doc comment names). `membershipSource` therefore
answers "held" or "no record" but never "ended on this date" — a departed
member's Membership row is presumably deleted at that point, and this source
has nothing to say about when. This is honest rather than a gap: a person
whose *only* recorded relationship was a since-deleted Membership row resolves
to `undefined` (no known trigger date) rather than a fabricated one, which is
what `resolveLastRelationshipEnd`'s doc comment states explicitly.

**RETENTION_CATALOGUE's `ROLE_ASSIGNMENTS` entry (not in §5's table) is left
`UNRESOLVED`, deliberately, and is worth flagging rather than silently
accepting.** A role grant's retention plausibly follows the audit floor (it is
what an audit actor id refers back to) or the person's own — that is a real
organisational choice, not a gap in this pass, and the catalogue entry says so
in its `source` field.

---

## 4. Every `PHASE 0.4` marker, accounted for

`grep -rn "PHASE 0.4" src prisma` (excluding `src/generated/`, a build
artefact) found 4 hits.

| Marker | Status |
|---|---|
| `prisma/schema.prisma:13` — the phase-0.4 header block | **Closed for retention.** Rewritten to record `RetentionPolicy`, the `@dataClass` binding and the erasure registry as done, and states plainly what is still absent (`erasePersonData`, R-25) |
| `src/modules/users/infrastructure/person-reference-classification.ts:28` — the erasure path does not exist | **Closed for the registry, left for the transaction.** Rewritten: both registries (column-level and table-level) are now complete and cross-checked; `erasePersonData` itself is explicitly R-25, not this phase |
| `prisma/schema.prisma:1006` (`AuditEvent`, "two things this model does not have") | **Out of retention scope, re-scoped explicitly rather than silently left.** Both items — the insert-only database role (D-149) and one-audit-event-per-aggregate-write — are unrelated to D-014/D-065/D-066; the first is a deployment step already tracked in `infra/audit-database-role.sql` and phase-0.4a's own report §5, the second is a load-test decision. Neither is touched here |
| `src/modules/audit/infrastructure/audit-repository.ts:14` — the insert-only role | **Same as above.** Not retention scope; already correctly self-described as a deployment step |

Nothing in the last two rows was touched, edited, or partially implemented —
they were already accurately scoped as *not* phase-0.4b-retention, and
rewriting them would have implied a change that did not happen.

---

## 5. What is still open after this phase

- **`erasePersonData`** — the transaction that actually walks both registries
  and performs an erasure. Explicitly R-25 (`02-security-privacy.md` §5.6),
  alongside the retention scheduled job. v1 does not ship the D-120 policy
  engine, so `onExpiry: REVIEW` today means "nothing happens automatically,"
  documented as such rather than silently absent.
- **`Charge`/`Payment`** registry and catalogue entries, the day the `fees`
  module lands (§3).
- **`PersonRelationship`**, and with it the real "guardian of" relationship
  source (§3).
- **D-149 part 2** (insert-only database role) and the one-audit-event-per-
  aggregate-write rule — unrelated to retention, tracked separately (§4).
- **`ROLE_ASSIGNMENTS`'s lawful basis** — flagged `UNRESOLVED` in the catalogue,
  an organisational decision rather than a build task (§3).
