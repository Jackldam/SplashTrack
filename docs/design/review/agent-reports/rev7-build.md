# rev7 — Independent buildability review

**Reviewer role.** The engineer who has to start on Monday. Read-only on the
design chapters; every contradiction below is quoted from the actual source
repositories, not from the design.

**Scope.** `docs/design/00..10`, `13`, `14`, `15` at
`design/architecture-phase` HEAD `29a0021`.
Reference repositories read: `/root/projects/WebAppTemplate` @ `7db6488`
(branch `main`), `/root/projects/SplashTrack` @ `main` (prototype).

**Why this round exists.** The previous build review (`report-build.md`) found
two design claims about the template that were false. The design has since been
rewritten. This pass re-checks the rewrite and every *other* claim of the same
kind. Both of the predecessor's specific findings are now **correctly stated** —
see the verified list at the end. The defects below are new.

**How to read severity.**
`blocker` — an engineer cannot write the first correct line of the affected work
without an answer. `high` — work can start but will be redone. `medium` — costs
time or produces a wrong artefact that CI will not catch. `low` — a paper defect.

---

## Summary

| Severity | Count | Findings |
|---|---|---|
| **blocker** | 5 | B-3, B-7, B-12, B-13, B-17 |
| **high** | 7 | B-1, B-4, B-6, B-8, B-10, B-18, B-20 |
| **medium** | 6 | B-2, B-5, B-11, B-14, B-16, B-19 |
| **low** | 2 | B-9, B-15 |

**The three worst.**

1. **B-17** — audit chain checkpointing is ranked the #2 most retrofit-hostile
   mechanism in the product, is assigned to no phase, and is specified nowhere;
   meanwhile audit retention as specified (`DELETE`, floor 12 months) breaks the
   hash chain on its first run and leaves `audit:verify` permanently red.
2. **B-12** — the D-096 crypto envelope binds AAD to table and column *names*,
   while D-159, D-100 and D-056 all schedule renames of encrypted tables and
   columns. Neither `key:rotate` nor any v1 CI check detects the result, and an
   AAD failure is indistinguishable from corruption. This is build-order item 1.
3. **B-13** — D-095 commits v1 to a hand-written logical export/import engine
   for every column type, justified in the decision itself by the D-047 restore
   matrix, which `00-overview.md` §3.5.1 removed from v1. Chapter 14 still
   specifies the `pg_dump` alternative in full.

**Could an engineer start Monday?** Yes — on Phase 0 and on the parts of Phase 1
that are unambiguous, and that is real, well-specified work. But they cannot
finish Phase 1 without answers to B-12, B-13 and B-17, and they cannot start the
settings work at all (B-3, B-4) or the scope model's write half (B-10) as
written. Four of the five blockers are answerable in a single sitting; none of
them requires new design work, only a choice between options the chapters
already contain.

---

## Findings

### B-1 — D-135's "adopt as they are" is false for `person-reference-sync.test.ts`: the test hard-codes eight column names that D-056 deletes

**Severity: high**

**The design's claim.** `09-decision-register.md` D-135:

> Adopt `tests/unit/migration-safety.test.ts` and
> `person-reference-classification.ts` + `person-reference-sync.test.ts`
> **as they are**, rather than re-inventing them

and `05-technical.md` §5.1, table header:

> ### 5.1 Two template capabilities to adopt, not re-invent
> The design describes both of these as things to build. They already exist,
> tested, and **adopting them is free**

**The evidence.** The sync test contains a fixed floor of column names, not just
a schema↔map comparison:

`WebAppTemplate/tests/unit/person-reference-sync.test.ts:99-114`

```ts
  it("found the known Person-referencing columns (sanity check the parser itself)", () => {
    // A fixed floor of columns known (by manual audit) to reference Person
    // today. If this shrinks, the PARSER broke (e.g. reverted to the naive
    // brace pattern) — that is a bug in the test, not a schema change, and
    // must be investigated before touching the other two assertions below.
    for (const known of [
      "UserAccount.personId",
      "PlatformSettings.updatedByPersonId",
      "CustomPage.createdByPersonId",
      "CustomPage.updatedByPersonId",
      "EmailTemplate.updatedByPersonId",
      "MaintenanceJob.updatedByPersonId",
      "AuditEvent.actorPersonId",
      "PlatformBootstrap.personId",
    ]) {
      expect(schemaPersonRefs.has(known), known).toBe(true);
    }
  });
```

Four of those eight are models the design explicitly removes or renames:

- `PlatformSettings` and `PlatformBootstrap` — D-056 removes the multi-tenant /
  platform layer, and **D-100** renames the bootstrap record explicitly:
  *"The first-run record is `InstallationBootstrap`, not `PlatformBootstrap`"*.
- `CustomPage` ×2 — `00-overview.md` §3.5.1 moves *"R-12 / D-017 CMS beyond a
  course-catalogue page and an inquiry form"* out of v1.

So the test fails on the first Phase-2 removal commit, and its own comment
instructs the engineer that this is *"a bug in the test, not a schema change"* —
the exact wrong diagnosis, delivered with authority, at the moment they are
holding a screwdriver.

**What it costs.** Half a day, plus the risk that an engineer who believes the
comment reverts a correct removal. The rest of the test (the two bidirectional
assertions and the `RETAIN_BY_DESIGN`-needs-a-reason assertion) *is* genuinely
adoptable — the value D-135 claims is real, the word "as they are" is not.

**Recommendation (do not apply).** Restate D-135 as "adopt, minus the fixed
floor list, which is re-derived against SplashTrack's own schema in the same
commit as the D-056 removals". Name the four entries so nobody rediscovers this
in CI. The same commit must also empty `PERSON_REFERENCE_CLASSIFICATION` of the
removed models, or the *stale-entry* assertion fires from the other side.

---

### B-2 — the same decision's other half: `migration-safety.test.ts` ships an allowlist whose second assertion fails unless SplashTrack inherits a specific template migration

**Severity: medium**

**The design's claim.** D-135, as quoted above, and `05-technical.md` §5.1:

> | `tests/unit/migration-safety.test.ts` | Blocks the unsafe `ADD COLUMN … NOT NULL` without a default | …

**The evidence.** `WebAppTemplate/tests/unit/migration-safety.test.ts:33`:

```ts
const ALLOWLIST = new Set(["20260722105628_credential_role_assignment_unit"]);
```

and lines 71-79:

```ts
  it("keeps the allowlist tight (every allowlisted migration still exists)", () => {
    const dirs = new Set(migrationDirs());
    for (const allowed of ALLOWLIST) {
      expect(
        dirs.has(allowed),
        `allowlisted migration "${allowed}" not found — remove the stale entry`,
      ).toBe(true);
    }
  });
```

If SplashTrack starts from a squashed or fresh migration baseline — which
`06-delivery.md` §2.2 and D-048 imply it must, since the append-only lockfile is
seeded at v1.0 — that directory does not exist and the second `it()` fails. If
SplashTrack instead inherits the template's entire migration history verbatim,
that is a decision no chapter states, and it interacts directly with D-048
(the inherited chain becomes permanently unsquashable) and with the D-056
removals (each removal is a destructive migration replayed by every self-hoster
forever).

**What is actually unspecified.** *Does SplashTrack begin with the template's
migration history, or with a fresh baseline?* No chapter answers this.
`14-…` §4 and D-046/D-048 assume a chain exists; `00-overview.md` §2.1 describes
extraction without saying what happens to `prisma/migrations/`. This is a
day-one question with a schema-shaped consequence.

**What it costs.** Ten minutes if answered, a rewrite of the migration baseline
if answered late — and D-048 makes "answered late" mean "answered by shipping a
squash you promised never to ship".

**Recommendation (do not apply).** Add one sentence to `05-technical.md` §3 or
`14-…` §4: fresh baseline at v1.0, template history discarded, allowlist
emptied, lockfile seeded from that baseline in the same commit.

---

### B-3 — the settings registry as specified has no role dimension, so D-158 is not implementable against it

**Severity: blocker (for the D-158 work item)**

**The design's claim.** `09-decision-register.md` D-158 (added today, `29a0021`):

> Session idle and absolute timeouts are **role-scoped** `bounded` settings,
> administrator-editable at runtime with no restart. Defaults: idle 30 min
> (instructor), 15 min (administrator), absolute 12 h; ceilings 8 h idle, 24 h
> absolute

and its own trade-off column concedes the dependency:

> A global single timeout cannot express the per-role table, so the setting is
> role-scoped — **one more dimension in the settings registry**.

**The evidence — that dimension was never added.** The registry schema is stated
once, in `13-configuration-and-setup.md` §3.2:

```text
key            organization.name
category       Organisation | Email | Authentication | Security | Privacy |
               Appearance | Website | Integrations | Maintenance
type           string | number | boolean | enum | json | secret
default        the built-in value
validation     Zod schema
scope          instance-wide
appliesLive    true | false  (see §4)
permission     which permission may change it
sensitive      whether the value is encrypted and masked
class          free | bounded | invariant   (D-150)
```

`scope` is not a variable — it is the literal constant `instance-wide`, and
`default` is a single value. There is no per-role key, no per-role default, no
statement of what a *third* role gets. Chapter 13 was last written at commit
`f8b2f8c`; D-158 landed at `29a0021` and did not touch it.

**And the deeper problem: roles are user-definable, so "role-scoped" has no
stable key.** The design says so itself, in D-130:

> `platform.super_admin` does not exist (D-056), so an alert on it never fires;
> **"organisation administrator roles" is not a checkable predicate either,
> since roles are user-definable**

D-130's whole point is that security-load-bearing configuration must bind to
**permissions, never to role names**. D-158 binds a security control to the role
names *instructor* and *administrator*. These two decisions cannot both be
implemented. An engineer asked to write `getSessionIdleTimeout(principal)` has
no defined answer for a school that creates a role called "Hoofdbadmeester".

**What it costs.** The registry data model, the settings UI, the
`settings:reset` clamp and the `bounded` validation all change shape. Retrofitting
a scope dimension after the registry exists means migrating every stored setting
row. This is item 5 in the build order — before every domain module.

**Recommendation (do not apply).** Resolve to the D-130 form: derive the
timeout from the highest-risk *permission* the principal holds (the same
"high-risk permission set" D-150 already defines for the MFA mandate), take the
**minimum** across matches, and default to the strictest when nothing matches.
That needs no new registry dimension — it is one `free`→`bounded` numeric per
risk tier — and it is well-defined for a role nobody has invented yet.

---

### B-4 — chapter 13 specifies a generated settings registry; chapter 00 moved exactly that out of v1

**Severity: high**

**The design's claim, side A.** `00-overview.md` §3.5.1, *Moved out of v1*:

> | **R-17 settings registry with generated UI** | A plain settings page for the
> ~15 settings that matter satisfies what D-036/D-038 actually require. **The
> metaprogramming project does not** |

**The design's claim, side B.** `13-configuration-and-setup.md` §3.2, unchanged:

> The registry is the single source of truth: **it generates the admin UI, the
> validation, the API surface, the documentation table, and the diagnostics
> page.** Adding a setting means adding a registry entry — never touching a
> form, a migration and a docs page separately.

That is the metaprogramming project, described as a requirement, in the chapter
an implementer opens to build settings. Nothing in chapter 13 says it is out.

**Why it is not a harmless duplication.** D-150 and D-158 both *depend* on the
registry being a real typed object (`class`, `bounded` floors/ceilings that
`settings:reset` respects, `invariant` rendered as a stated fact). A "plain
settings page for ~15 settings" does not have a `class` field to hang those on.
So the reduced version cannot carry D-150, and the full version is out of scope.
Build order item 5 has two mutually exclusive specifications.

**What it costs.** The difference between the two readings is on the order of a
week — roughly 5% of the whole 18–20 week estimate — decided by which chapter
the engineer reads first.

**Recommendation (do not apply).** Pick the middle that both decisions actually
need: a hand-written typed registry array (`key`, `type`, `default`, `class`,
`bounds`, `permission`, `appliesLive`) that the settings page *reads*, with no
generation of docs, API or diagnostics. State it in 13 §3.2 and delete the
"generates" sentence.

---

### B-5 — the design never mentions that the template already implements live, bounded, admin-configurable session timeouts

**Severity: medium (a reuse miss, and it makes B-3 cheaper than it looks)**

**The design's claim.** `13-…` §4 lists session timeouts as `appliesLive: true`
settings to be built, and D-158 specifies them as new work. `05-technical.md`
§5.1 is titled *"Two template capabilities to adopt, not re-invent"* — this is a
third, and it is not there.

**The evidence.** `WebAppTemplate/src/lib/auth/session.ts:33-45`:

```
 * Absolute session cap (Section 9.2): a session may not be renewed beyond this
 * age regardless of activity. Better Auth's sliding `expiresIn` provides the
 * 30-minute IDLE timeout; this provides the ABSOLUTE timeout, enforced here
 * because Better Auth has no built-in absolute cap.
 *
 * The enforced value is now ADMIN-CONFIGURABLE (Settings → Security), read via
 * `getConfiguredSecurityPolicy()` — a per-request-cached, fail-safe-to-default
 * query (a DB blip degrades to this same default, never to "no cap").
```

and `WebAppTemplate/src/lib/settings/config.ts:408-414`, which is D-150's
`bounded` class already implemented:

```ts
      sessionIdleTimeoutMinutes:
        Number.isFinite(rawIdleTimeoutMinutes) &&
        rawIdleTimeoutMinutes >= SESSION_IDLE_TIMEOUT_MINUTES.min &&
        rawIdleTimeoutMinutes <= SESSION_IDLE_TIMEOUT_MINUTES.max
          ? …
          : defaults.security.sessionIdleTimeoutMinutes,
```

`src/lib/auth/session.ts:136-142` further records that relying on Better Auth's
own `expiresIn` was tried and **abandoned** because it is fixed at auth-context
construction — the same singleton problem the design correctly identifies for
identity providers in F-105/D-106, already solved here for timeouts via an
application-owned `Session.lastSeenAt` column.

The design's search space contains **zero** references to `src/lib/settings/`,
`getConfiguredSecurityPolicy`, or `PlatformSettings` — I grepped all fifteen
chapters.

**What it costs.** Nothing if found; a re-implementation of a subtle,
already-debugged mechanism (the throttled `lastSeenAt` write, the
fail-safe-to-strict degradation, the ≤¼-window throttle bound) if not. The
comments in that file record two prior bugs whose fixes an engineer starting
fresh would not know to reproduce.

**Recommendation (do not apply).** Add a third row to `05-technical.md` §5.1
naming `src/lib/auth/session.ts` + `src/lib/settings/config.ts` as the adoption
base for D-158, and note that the work is *adding a dimension to an existing
bounded setting*, not building timeouts.

---

### B-6 — `appendAuditEvent` opens its own transaction, so "one audit event per aggregate write" cannot be atomic with the write it records

**Severity: high**

**The design's claim.** `05-technical.md` §5 rule 6:

> **One audit event per aggregate write, not per row.** The template's
> `AuditEvent` is a tamper-evident hash chain whose appends serialize on a
> **Postgres advisory lock**. The domain model requires one transaction per
> group registration … So: **write one audit event for the group
> registration**, or batch the chain append.

The advisory-lock half of that is **true** — verified below. The unstated half
is the problem.

**The evidence.** `WebAppTemplate/src/modules/audit/infrastructure/audit-repository.ts:90-92`
and `:112`:

```ts
export async function appendAuditEvent(
  input: AuditEventInput,
): Promise<{ id: string; sequence: number; hash: string }> {
…
  return prisma.$transaction(async (tx) => {
```

It takes no `Prisma.TransactionClient` — I grepped the file, there is no
`TransactionClient` anywhere in it, and the six exported functions
(`:90`, `:173`, `:233`, `:329`, `:369`, `:384`) offer no tx-accepting variant.
It always starts its **own** transaction on the root `prisma` client.

Three consequences an engineer hits on the first audited domain write:

1. **The audit row is not atomic with the business write.** A crash between the
   two leaves an attendance registration with no audit event, or an audit event
   for a rolled-back registration. `02-security-privacy.md` builds the Article
   33 answer on this trail; "the trail is best-effort" is not a property any
   chapter states or accepts.
2. **`05-technical.md` §3.1's own rule forbids the fix.** The fix is to pass the
   caller's `tx` in — but D-125 requires each module to use a *narrowed* Prisma
   client and forbids the root client under `modules/`. The audit module's
   client and the attendance module's client are different objects; sharing one
   transaction across them is exactly the case the narrowing rule was not
   designed for, and no chapter says how it works.
3. **Holding `pg_advisory_xact_lock` inside a long domain transaction changes
   the contention profile the load test is supposed to measure.** The template's
   own comment (`audit-repository.ts:24-28`) justifies global serialization on
   the grounds that *"Audit writes are infrequent (sensitive actions only)"* —
   which stops being true when every attendance registration takes it.

**What it costs.** A signature change on the single most-called security
primitive in the application, plus a decision about transactional audit that
belongs in chapter 02. Cheap now, extremely expensive after twenty modules call
the old shape.

**Recommendation (do not apply).** Decide it in chapter 02 before Phase 3:
`appendAuditEvent(input, tx?)`, with an explicit statement that domain writes
pass their transaction and that the module-narrowing rule (D-125) has a named
exemption for the audit client. Then re-derive the p95 target
(`00-overview.md` §4.1 already flags that it was set without knowing the lock
exists).

---

### B-7 — `docs/glossary.md` does not exist, and D-159 makes it a hard prerequisite for the first domain module

**Severity: blocker (schedule), low (effort)**

**The design's claim.** D-159 (added today):

> `docs/glossary.md` fixes one English identifier per domain concept, with the
> Dutch term beside it, **before the first domain module is written**.

with the register's own file pointer reading `docs/glossary.md` **(to be
created)**.

**The evidence.** `ls docs/` on `design/architecture-phase`:

```
architecture.md
design
privacy
progress-2026-03-15-student-identity.md
student-identity-migration-plan.sql
student-management-hardening-phase1.md
student-management-plan-2026-03-15.md
```

No `glossary.md`. `06-delivery.md` §5 Phase 0 does schedule it —
*"Write the glossary (OD-10 — cheap, and it blocks every schema name after
it)"* — so the **order is right**; the artefact simply does not exist yet and
the delivery chapter still refers to it as an open decision (`OD-10`) rather
than a closed one (`D-159`).

**Is it blocking?** Yes, but correctly so, and it is the cheapest blocker in
this report. The four terms D-159 itself names (`afzwemmen` → the award event,
`aftesten` → the independent pre-exam assessment, `lesuur` → `ScheduledSession`,
`baan` → `Lane`) are already decided in prose. The unnamed ones are not:
chapter 15 introduces `GradeScale`, `GradeValue`, `CriterionSet`, `AwardType`,
`PersonQualification` — English already — but nothing fixes the English for
*diplomazwemmen*, *proefzwemmen*, *inhaalles*, *contributie*, *examengeld*,
*wachtlijst*, *vereniging* or *bevoegdheid*, all of which appear as domain
concepts across chapters 01 and 15 and all of which become column names.

**What it costs.** Half a day to write, against a Phase-3 module sequence eleven
modules long that cannot start without it. The risk is not the writing — it is
that Phase 0 is described as *"repository hygiene (days)"* and a glossary
written in that mood will cover four terms and miss twenty.

**Recommendation (do not apply).** Make the glossary's *completeness* criterion
explicit: every noun that becomes a table or a column in chapters 01 and 15 has
an entry before `people` starts. Update `06-delivery.md` Phase 0 to cite D-159
rather than OD-10.

---

### B-8 — D-138 states the build order as a single sequence that puts repository hygiene *after* the crypto envelope, inverting the chapter it cites

**Severity: high**

**The design's claim.** `09-decision-register.md` D-138 — the entry the brief
calls "the decision that fixes the order":

> The v1 build order is fixed by cost of doing it late: crypto envelope → audit
> chain rotation → scope model → append-only event models → settings → consent →
> restore fixtures → erasure registry; **then** repo hygiene → foundation →
> removals and reshaping → domain modules in DAG order → surfaces

Read as written, that is one twelve-step sequence, and repository hygiene is
step nine.

**The evidence — `06-delivery.md` §5, the section D-138 cites, says the
opposite.** It is *two* lists, not one, and it says so:

> Sequencing matters more than usual here because three of the highest-value
> mechanisms are the ones that are most expensive to retrofit. **Ranked by cost
> of doing it late:**

followed by the eight-row table, and then a separate heading:

> **Phases.**
> - **Phase 0 — repository hygiene (days).** … Add Zod. Write the glossary …
> - **Phase 1 — foundation, no domain code.** Crypto envelope and golden
>   vectors → …

The first list is a **risk ranking**; the second is the **schedule**. D-138
concatenates them with the word "then", which produces a sequence that cannot be
executed: the crypto envelope's validation and the settings registry both
require Zod (`05-technical.md` §2, `13-…` §3.2), which Phase 0 adds; and the
tracked `apps/web/.env` must be resolved before anything is public. Following
D-138 literally means writing the envelope before adding its validation
dependency, and rotating secrets after they have been in a public repository.

The concatenation also mixes categories. "Append-only event models" and
"consent" are not schedulable work items at all — they are *patterns* that come
into existence inside Phase 3 domain modules (`AttendanceEvent` is defined in
`01-domain-model.md` §3.4, in the `attendance` module). A reader who takes
D-138 as a schedule tries to build item 4 before item 5 (settings), while the
phases correctly put settings in Phase 1 and attendance in Phase 3.

**What it costs.** The decision register is the artefact a new engineer greps.
An engineer who plans a sprint from D-138 and not from `06-delivery.md` §5
starts in the wrong place, and the error is invisible until Zod is missing.

**Recommendation (do not apply).** Split D-138 into two entries — a *risk
ranking* (no order claim) and a *phase schedule* — or make the single entry read
"…is the risk ranking that motivates the phase schedule in `06-delivery.md` §5,
which is authoritative."

---

### B-9 — two chapters give two different Phase-3 module orders, and D-138 calls the order fixed

**Severity: low**

**The design's claim.** `06-delivery.md` §5, Phase 3:

> `people → students → groups → courses → skills → sessions → attendance →
> assessment → exams → **planning → fees**`

**The evidence.** `01-domain-model.md` §1.1, *"New SplashTrack domain modules
(built in v1, **in this order**)"*, ends:

```text
exams               Exam sessions, candidates, assessors, results, awards
fees                Fee types, charges, payments, balances  ← tracking only
planning            Schedule construction, locations, resources, assignment
```

`fees` and `planning` are swapped. Both orders satisfy the DAG in
`01-domain-model.md` §1.2 (neither module depends on the other), so nothing
breaks — but two chapters each declare *the* order, and D-138 says it is fixed.

**What it costs.** Nothing technically. It costs the reader's confidence in
every other ordering claim in the set, which is the expensive part.

---

### B-10 — `coversResource()` is a named Phase-2 deliverable that no chapter defines

**Severity: high**

**The design's claim.** `06-delivery.md` §5, Phase 2:

> → the scope model, **`coversResource()`**, reach as a required repository
> argument, and the scope-escape **test harness** so every later module inherits
> it

**The evidence.** `coversResource` appears exactly once in the entire design
set — that line. I grepped all fifteen chapters:

```
docs/design/06-delivery.md:308:  `coversResource()`, reach as a required repository argument, and the
```

No signature, no return type, no chapter section. It is evidently the
single-resource counterpart to `resolveReach` — `05-technical.md` §5 rule 1 says
*"Single-resource reads and all writes go through `requirePermission(perm,
resourceRef)`; list queries take a `Reach` object"* — but the *list* half gets
a fully specified eight-variant discriminated union in `02-security-privacy.md`
§2.3 (D-147, quoted in full with its brand and its `NONE`/`UNION` variants),
and the *single-resource* half gets a function name in a delivery plan.

This is the asymmetry the brief calls "specified at two incompatible levels of
detail", on the two halves of the same mechanism — and this half is the one
every write in the application calls.

The unanswered questions an engineer hits immediately: does `coversResource`
take a `Reach` or a session? What is a `resourceRef` — a `{type, id}` pair, and
who resolves a `studentProfileId` to the group a `GROUP`-scoped grant covers?
For a `SESSIONS` reach, is the `window: DateRange` checked against the
resource's time or the clock? D-144 says expiry *"is evaluated inside
`requirePermission` and `resolveReach`"* and names no third function — so is
`coversResource` inside `requirePermission`, or beside it?

**What it costs.** The scope model is item 3 in the risk ranking precisely
because *"it changes the signature of the guard every module calls."* Getting
the list half right and improvising the single-resource half means the
improvisation is what every module calls.

**Recommendation (do not apply).** Specify `coversResource` in
`02-security-privacy.md` §2.3 alongside D-147, with the same rigour: signature,
the `resourceRef` shape, one row per `Reach` variant saying how a resource is
tested against it, and what `UNION` and `NONE` do.

---

### B-11 — "consent extension" is ranked sixth in the build order and defined nowhere

**Severity: medium**

**The design's claim.** `06-delivery.md` §5, risk ranking row 6:

> | 6 | **Consent extension** | Same retrofit-hostility as (4): a consent
> captured under the current shape has no recoverable actor, and consent on
> behalf of a minor is the majority case |

and Phase 2: *"→ **consent extension** → setup wizard on top of all of it."*

**The evidence.** The phrase "consent extension" occurs exactly twice in the
design set — both in `06-delivery.md`. No decision defines it; no chapter
section is called it; it has no F-number.

The *material* is there, scattered: D-063 (subject, actor, purpose, lawful
basis, authority evidence, timestamp, withdrawal), D-151 (guardian authority
expires at the age of digital consent, derived from `Person.dateOfBirth`,
evaluated at read time, feeding a re-consent queue), D-152 (`withdrawnAt`
valid only where `legalBasis = CONSENT`, enforced as a schema constraint;
`ProcessingObjection` as a separate event; a declared withdrawal cascade per
purpose). What no chapter states is that *those three together are the
"extension"*, that they are one work item, or that the item sits in Phase 2.

**A real ordering consequence, not just a naming one.** D-151 requires
`Person.dateOfBirth`, which the template does **not** have —
`grep -n dateOfBirth WebAppTemplate/prisma/schema.prisma` returns nothing; the
field is introduced by `01-domain-model.md:313`, i.e. by the `people` module in
**Phase 3**. And D-152's `ProcessingObjection` is not in `01-domain-model.md`'s
entity tables at all. So Phase 2's "consent extension" cannot be completed in
Phase 2 as the schema currently stands.

**What it costs.** An engineer plans a Phase-2 item they cannot scope, discovers
mid-sprint that half of it needs a Phase-3 column, and either blocks or reaches
forward into `people` — which is how the DAG erodes on week three.

**Recommendation (do not apply).** Give it a decision id and one section in
`02-security-privacy.md` §5.4 listing exactly what changes, then either move
`Person.dateOfBirth` and `ProcessingObjection` into the Phase-1 foundation
schema or move the consent extension to immediately after `people`.

---

### B-12 — the D-096 envelope binds AAD to table and column *names*, and no chapter says what a rename migration does to existing ciphertext

**Severity: blocker**

**The design's claim.** `13-configuration-and-setup.md` §5.1, D-096:

> Every encrypted value is stored as `v1:<keyId>:<nonce>:<ct>`, authenticated
> with AAD binding **`(table, column, primary key, keyId)`**.

> **Trade-off.** Envelopes get longer and every read site must pass its own
> `(table, column, pk)`. That is a small, mechanical cost…

**Why it is not mechanical.** Two of the four AAD components are *identifiers
the design has already committed to changing*:

- **D-159**, added today: *"Schema identifiers, column names, API field names
  and code are English without exception"* — and OD-10's closure adds
  *"chapters that use them as identifiers are **corrected when the module is
  written**."* So renames are scheduled, not hypothetical.
- **D-100**: *"The first-run record is `InstallationBootstrap`, not
  `PlatformBootstrap`"* — a table rename during extraction.
- **D-056**: *"`PlatformSettings` (merged into the organisation singleton)"* —
  a table rename plus a column move, on a table that holds settings-registry
  secrets, which D-096's own rotation table lists as encrypted.

A rename changes the AAD. Every existing ciphertext in that column then fails
to authenticate — indistinguishably, by design, from the tampering the AAD
exists to detect. Nothing in chapters 13, 14 or 02 mentions this.

**And the two mechanisms that look like they would catch it do not.**

1. `splashtrack key:rotate` re-wraps *"in one resumable pass per column, **keyed
   by `keyId`**"* (`13-…` §5.3). A rename does not change `keyId`, so rotation
   neither detects nor repairs it.
2. R-20 (`00-overview.md:399`) is *"automatic forward-only migration on start,
   automatic pre-migration backup"*. So the rename migration runs unattended, at
   container start, **after** the pre-migration backup is taken — the backup
   contains ciphertext bound to the old names, and the running instance can read
   neither. `14-…` §4.3.1's *"Every encrypted column decrypts to known
   plaintext"* assertion belongs to the D-047 matrix, which
   `00-overview.md` §3.5.1 moves **out of v1**.

**What it costs.** This is item 1 in the risk ranking — *"Nothing that stores a
secret may be written first"* — and it is the one place where getting the
envelope subtly wrong is unrecoverable rather than expensive: an AAD failure on
a medical note is silent data loss with a corruption-shaped error message.

**Recommendation (do not apply).** Bind AAD to a **stable logical identifier**
rather than the physical name — a per-column registry entry (`"student.medical
_remarks"`) that a rename updates in the mapping, not in the AAD — or state
explicitly that any migration renaming an encrypted column or its table must
decrypt-and-re-encrypt in the same migration, and add that to
`05-technical.md` §5 rule 5's PR requirement. Either way it must be decided
before the first encrypted byte is written.

---

### B-13 — D-095 commits v1 to writing its own logical export/import engine, justified by a CI matrix that v1 does not ship, while chapter 14 still fully specifies the alternative

**Severity: blocker**

**The design's claim.** `14-backup-restore-upgrade.md` §3.1, D-095:

> The database export is a structured logical export the application writes and
> reads itself, not a raw `pg_dump` replayed by the database.

with the risk explicitly acknowledged and explicitly mitigated:

> It is more code than shelling out to `pg_dump`, and it **must be kept in step
> with the schema — which is exactly what the restore matrix (§4.3.1) tests on
> every pull request anyway.**

> **Trade-off.** We own the export/import code, including every column type and
> every future schema change.

**The evidence.** The restore matrix is D-047, and `00-overview.md` §3.5.1 moves
it out of v1:

> | **D-047** restore-from-every-release CI matrix | **Zero prior releases
> exist**, so the matrix is green while protecting nothing…

`06-delivery.md` §2.1 repeats it: *"**Out of v1:** the restore-from-every-supported-release matrix (D-047)."*

So v1 ships a hand-written export/import engine covering every column type in a
~70-model schema, and the single control D-095 names to keep it in step with
that schema **is not in v1**. The decision's own risk paragraph is load-bearing
and the load has been removed from under it. Nothing else in `06-delivery.md`
§2.1's eight blocking checks exercises a round-trip.

**And the chapter has not picked one mechanism.** D-095's trade-off keeps an
escape hatch — *"If v1 nonetheless ships `pg_dump`, §4.2's restrictions are
**mandatory, not advisory**, and `postgresql-client` must actually be in the
image — it is not today"* — and §4.2 then specifies the `pg_dump` path in full
(`14-…:327-343`): custom format only, `pg_restore --no-owner --no-acl
--no-comments`, a table-of-contents allow-list of object types, hard abort
outside it. Both mechanisms are specified to implementation depth. The two
differ by weeks of work and by which threat model applies.

**What it costs.** Phase 1 contains *"backup, restore and the recovery token"*
as one bullet. Under the `pg_dump` reading that is days; under D-095 it is a
serialization engine for every Prisma column type plus a matching importer that
preserves primary keys exactly (it must — D-096 binds AAD to the primary key,
see B-12) plus a per-release compatibility obligation. Nothing in the estimate
distinguishes them.

**Recommendation (do not apply).** Decide it, delete the loser from chapter 14,
and if D-095 stands, add a **round-trip test** (export a seeded database, import
into an empty one, assert row counts, primary keys and decrypted plaintexts) to
`06-delivery.md` §2.1's blocking checks. That is the cheap subset of D-047 that
protects the thing D-095 is worried about and does not need any prior release
to exist.

---

### B-14 — chapter 14 presents D-047 as a first-class v1 requirement with no marker that it was cut

**Severity: medium**

**The design's claim, side A.** `06-delivery.md` §2.1: *"**Out of v1:** the
restore-from-every-supported-release matrix (D-047)."*

**The design's claim, side B.** `14-…` §4.3.1, titled *"What this obliges us to
do — the actual cost"*:

> **Decision D-047 — CI tests restore from **every supported release** into
> `HEAD` … A matrix job: for each such version, restore a stored seeded backup
> of it into the current build, apply migrations, and assert the schema and a
> set of domain invariants.
> **Reason.** "Skipped versions are supported" is worthless as a sentence in a
> document. It is only true if a machine checks it on every pull request.

followed by the eight-row assertion table and a full specification of the
fixture-generation job. Nothing in chapter 14 says any of it is out of v1.
Chapter 14 was last written at `f8b2f8c`; the v1 re-cut is in `00-overview.md`
§3.5.1.

**What it costs.** A week of work an engineer builds because the chapter that
specifies it in detail says it is obligatory, and the chapter that cancelled it
is one they may not reach. Compounded by B-13, which depends on knowing D-047 is
gone.

**Recommendation (do not apply).** One line under §4.3.1: "Out of v1 per
`00-overview.md` §3.5.1; fixture generation ships, the matrix does not."

---

### B-15 — D-157 does *not* block the import work, but the field it writes is defined nowhere

**Severity: low** (and the answer to the brief's question is: yes, schedulable)

**The design's claim.** D-157:

> The importer cannot be built until a sample export is supplied. That is the
> intended ordering, not a delay: the work is small once the file is in hand and
> unbounded when it is not

**Verdict: the rest of the import work is schedulable, and D-157 is right.**
What is deferred is exactly one thing — the column mapping. Everything the
importer *is* is already specified target-side in `00-overview.md` §2.2 and
D-157, and none of it depends on the source file:

- dry-run-then-commit with a per-row rejection report;
- unmapped columns **reported, never silently dropped**;
- authority never inferred — *"the import refuses on any unmapped value rather
  than silently dropping — or silently granting — authority"*;
- zero `Consent` rows written, consent-gated features left off, a report of what
  could not be carried;
- lossy-by-construction records seeded with one synthetic
  `StudentLifecycleEvent(JOINED)` and one `MembershipPeriod`.

That is an importer framework with a pluggable mapping. It can be built, tested
against a synthetic fixture, and have the real mapping dropped in later.

**The one defect.** `00-overview.md:308` requires those seeded rows be *"marked
`origin: IMPORTED_LEGACY` so nobody later reads an import artefact as evidence
in a dispute"*. Neither `origin` nor `IMPORTED_LEGACY` appears anywhere else in
the design set — I grepped all fifteen chapters. `01-domain-model.md:315,317`
define `MembershipPeriod` and `StudentLifecycleEvent` without it. It is an
evidentiary field, named once, on two append-only models, in the chapter that
does not own them.

**What it costs.** Minutes now; a migration adding a column to two append-only
tables after they hold rows, later — and the rows that most need the marker are
the ones written before it existed.

**Recommendation (do not apply).** Add `origin` to both entity rows in
`01-domain-model.md` §3.1 with its enum, in the `students` module's schema, so
it exists before the importer needs it.

---

### B-16 — OD-18 is open and blocks half of chapter 15; chapter 15's own dependency list is stale about which decisions are still open

**Severity: medium**

**The design's claim.** `15-assessment-and-fees.md` §9, item 5:

> **(Open — OD-17, `08-open-decisions.md`)** The grade scale is assumed to be
> the five ordinal values given.

**The evidence.** OD-17 was closed in the same commit that last edited chapter
15 (`29a0021`, *"close OD-1/5/6/10/16/17"*), and recorded as **D-160** —
*"One seeded `GradeScale` — onvoldoende / matig / voldoende / goed / zeer goed …
no scale editor ships in v1"*. Chapter 15 §9 still lists it open.

Meanwhile the item that *is* open and *does* block work is not in §9 at all:
**OD-18**, raised by the same commit —

> This does not block the design of students, groups, sessions, attendance,
> assessment or exams … It blocks only the membership and contributie half of
> chapter 15.
> **Cost of delay.** High and rising: it is cheap now and becomes a rewrite of
> chapter 15 plus its schema once written.

OD-18 is well written and correctly bounded — this finding is not against it.
It is against §9, the list an engineer opening chapter 15 reads to find out what
is safe to start.

**Also still open and correctly flagged:** §9 item 2, F-44 — no scheme catalogue
may be seeded until the NRZ criteria and thresholds are confirmed. That one
genuinely blocks the `assessment` module's seed data, and it is a question for
Jack rather than a design gap.

**What it costs.** `fees` is the last Phase-3 module in one ordering and the
second-to-last in the other (B-9), so the schedule accidentally protects this —
but the estimate counts it.

**Recommendation (do not apply).** Rewrite §9 as of `29a0021`: item 5 closed by
D-160; add OD-18 as the open item that gates §6.2 contributie tracking; keep
F-44.

---

### B-17 — the second-most-retrofit-hostile mechanism in the product ("audit chain checkpointing") is in no phase and specified nowhere, and audit retention as specified breaks the chain on its first run

**Severity: blocker**

**The design's claim.** `06-delivery.md` §5, risk ranking row 2 — the number-two
item in the whole product, ranked by cost of doing it late:

> | 2 | **Audit chain-aware rotation and checkpointing** | The chain is
> append-only at the database level. Deciding rotation after two years of events
> means retroactively rewriting a tamper-evidence claim |

**The evidence — it exists nowhere else.** `checkpoint` appears twice in the
entire design set: that row, and an example branch name in the same file
(`06-delivery.md:193`, `docs/151-adr-audit-chain-checkpointing`). There is no
decision, no chapter section, no F-number. And the **Phases** list immediately
below assigns it to no phase: Phase 1 is *"Crypto envelope and golden vectors →
boot state machine including the `FAILED` state → settings → production
Dockerfile → backup, restore and the recovery token → the eight CI checks"*.
Items 1, 5 and 7 of the ranking are in Phase 1; item 3 and 6 in Phase 2; item 4
in Phase 3; item 8 in the DoD. **Item 2 is in none of them.**

**Why this is a blocker and not a documentation gap — the pieces that *are*
specified are in direct conflict.**

1. `01-domain-model.md:578` sets audit retention with `onExpiry` = **`DELETE`**,
   floor 12 months (D-149/D-150), shipped default 24 months.
2. D-149 part 1 requires `splashtrack audit:verify` plus *"a chain-status line on
   the diagnostics page"*, because *"a tamper-evident record nobody ever checks
   is tamper-evident in the same way an unwatched camera is."*
3. The verification the template actually implements walks from genesis:

   `WebAppTemplate/src/modules/audit/infrastructure/audit-repository.ts:378-386`

   ```
    * Reads every event in chain order (by `sequence`) with the fields needed to
    * recompute the hash chain. Used by `verifyAuditChain`; also the basis for the
    * future `audit.read`-gated viewer. Ordered ascending so the walk starts at the
    * genesis link.
    */
   export async function readAuditChain(): Promise<StoredAuditEvent[]> {
     const rows = await prisma.auditEvent.findMany({
       orderBy: { sequence: "asc" },
   ```

   and `audit-event.ts:93`:
   `export const AUDIT_GENESIS_HASH = "genesis:webapp-template:audit:v1";`

So: on the **first** retention run — month 12 to 24 of the first instance — the
maintenance job deletes the oldest rows, the surviving head row's
`previousHash` points at a row that no longer exists, and `audit:verify` reports
a broken chain on the diagnostics page **forever after**, for a legitimate
deletion. The control D-149 exists to provide becomes a permanent red light that
operators learn to ignore, which is strictly worse than not having it.

Checkpointing is the answer — a signed anchor at the truncation boundary that
verification treats as a new genesis. It is ranked #2 precisely because
retrofitting it means *"retroactively rewriting a tamper-evidence claim"*. It is
not designed.

**Two further concrete costs an engineer hits in the same file.**

- `readAuditChain()` materialises the **whole table** in memory. `07-operations.md:188`
  calls `AuditEvent` *"Fastest-growing table"*. Verification is unrunnable on a
  two-year instance without a chunked walk — which is the same work as
  checkpointing.
- `AUDIT_GENESIS_HASH` is the literal string `"genesis:webapp-template:audit:v1"`.
  Changing it invalidates every chain written before the change; keeping it ships
  a product whose tamper-evidence root says `webapp-template`. Either way it is a
  decision that must be made in the first commit that writes an audit event, and
  no chapter mentions the constant exists.

**Recommendation (do not apply).** Before Phase 1 closes: define a
`AuditCheckpoint` record (sequence, hash-at-that-point, timestamp, signed under
a `HKDF(SECRET_KEY, info="audit-checkpoint")` key), require the retention job to
write one before it deletes anything, make `verifyAuditChain` verify
checkpoint-to-checkpoint and chunk its walk, and settle the genesis constant.
Give it a decision id and a phase.

---

### B-18 — the ~18–20 engineer-week estimate is not defensible against the chapter contents

**Severity: high**

**The design's claim.** `00-overview.md` §3.5.3:

> | | Engineer-weeks |
> | v1 **as previously specified** | ~60–75 |
> | v1 **as re-cut above** | **~18–20** |

**The arithmetic against what the chapters actually specify.**

The template ships 35 Prisma models (`grep -c "^model " WebAppTemplate/prisma/schema.prisma`).
`01-domain-model.md`'s entity tables define **27** new ones, and
`15-assessment-and-fees.md` adds roughly a dozen more that chapter 01 does not
list (`AssessmentScheme`, `CriterionSet`, `GradeScale`, `GradeValue`,
`AwardType`, `Assessment`, `FeeType`, `Charge`, `Payment`, `SkillCatalogue`,
`SkillRequirement`, `ProcessingObjection`). Call it **~40 new models**, minus
D-056's removals, across **11 new modules**.

`06-delivery.md` §4.4 defines done as:

> data model → service → UI → tests → docs are all present; **scope-escape tests
> exist** for the module … **Backend without UI is not a slice.**

At 18–20 weeks, and reserving anything at all for Phases 0–2 and 4, Phase 3 gets
perhaps 11–13 weeks for 11 modules and ~40 models with services, screens,
scope-escape suites (four cases × read/write/list per module, per §2.1), erasure
registry entries, and docs. That is under three days per model **including its
UI**. For `assessment` alone — versioned criterion schemes, a five-point graded
result per criterion, waivers, `PersonQualification`, the four-eyes gate, and an
aftest screen that `15-…` §4 explicitly says must *not* inherit the
thirty-second fast-path doctrine — three days per model is not a stretch, it is
a different project.

**And Phases 0–2 are not small.** They contain, per §5: the crypto envelope plus
a golden-vector suite; a six-state boot machine (D-098) that is *"itself
data-critical code and is covered by a test matrix with one case per state"*
(`14-…` §4.3); the settings registry (whose scope is itself contested — B-4);
a production Dockerfile; the Recovery Kit with a framed AEAD construction
(D-102: libsodium `secretstream` or `age`, sequence-bound chunks, separately
authenticated manifest); backup **and** a logical export/import engine for every
column type if D-095 stands (B-13); eight CI checks of which **seven do not
exist today** (§2.1); the D-056 removals *"incrementally, tests green at each
step"* against a 35-model schema; the eight-variant opaque `Reach` type with
per-repository exhaustive translation; and the setup wizard.

That is a 6–10 week block on its own, before the first domain screen.

**What is *not* in the estimate at all.** Every row of `00-overview.md` §4.1
marked **"Required addition"** — the attendance load test, the query-count
assertion, the Playwright trace budget, the container test, axe in E2E, the
browser matrix. Six named work items, each listed with the honest status
*"is a v1 work item that does not yet exist"*.

**What it costs.** Not the number — the *decisions made because of* the number.
A 20-week plan justifies the D-047 cut that B-13 shows removed D-095's safety
net, and justifies "days" for Phase 0 that B-7 shows must produce a complete
glossary. An estimate that is wrong by a factor of two makes the wrong scope
cuts look free.

**Recommendation (do not apply).** Re-derive bottom-up per module and per
Phase-0–2 item, publish the per-item numbers rather than a single range, and if
the total lands above ~30 weeks, re-run §3.5.1 with the real figure — the
re-cut's own logic (spend the budget where an instructor touches it) is sound
and would survive an honest number.

---

### B-19 — Phase 1 ships the scope-escape CI gate; Phase 2 builds the scope model it tests

**Severity: medium**

**The design's claim.** `06-delivery.md` §5, Phase 1:

> → **the eight CI checks**, including image **promotion** rather than a build on
> the target host.

and §2.1 lists the eight, of which:

> | **Scope-escape tests** | Yes | **New, and the most important gate in this
> table.** |

But Phase 2 is where the thing under test is built:

> **Phase 2** … → the scope model, `coversResource()`, reach as a required
> repository argument, and the scope-escape **test harness** so every later
> module inherits it

**Why it matters more than it looks.** §2.1 is emphatic that a mis-named gate
produces a vacuous one:

> a team building the gate from this chapter writes cross-organisation isolation
> tests, which in a single-organisation instance are **vacuous and pass
> forever**

A gate wired in Phase 1 against a scope model that does not exist yet is
vacuous by construction, and a green check is exactly the signal that stops
anyone revisiting it. The four required cases (`GROUP`, `UNIT`, `SESSION`,
reach-not-constructible) each name a `Reach` variant that Phase 2 introduces.

**What it costs.** Low if noticed, high if not: the most important gate in the
table ships green and empty, and the harness that would fill it arrives a phase
later with nothing failing to prompt it.

**Recommendation (do not apply).** Phase 1 ships seven checks; the scope-escape
gate is the **first** deliverable of Phase 2, wired at the same commit as
`resolveReach`, with at least one deliberately-failing case committed and then
fixed so the gate is proven non-vacuous.

---

### B-20 — D-096's new envelope reuses the version tag `v1`, which the inherited code already uses for a different four-field layout

**Severity: high**

**The design's claim.** `13-configuration-and-setup.md` §5.1, D-096:

> Every encrypted value is stored as **`v1:<keyId>:<nonce>:<ct>`**

and §5.2, D-097:

> One `src/lib/crypto/envelope.ts` holds a
> `DECRYPTORS: Record<FormatVersion, Decryptor>` registry and a
> `CURRENT_FORMAT`. … A committed golden-vector test carries **one entry per
> format ever shipped**.

**The evidence.** The template's existing envelope is *also* `v1` and *also*
four colon-separated fields, with a different meaning in positions 2 and 3:

`WebAppTemplate/src/modules/identity/infrastructure/secret-crypto.ts:29,67-70`

```ts
const FORMAT = "v1";
…
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new Error("Malformed encrypted secret.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
```

So the inherited layout is `v1:<iv>:<tag>:<ct>` and the proposed one is
`v1:<keyId>:<nonce>:<ct>`. A `DECRYPTORS` registry keyed on the version tag
cannot tell them apart — both are `"v1"` with four fields — so the new decryptor
reads a `keyId` out of an IV and a nonce out of a GCM tag. The failure is a
garbage decrypt or an authentication error, not a clean "unknown format", which
is exactly the class D-049 and D-097 exist to eliminate.

This is not hypothetical, because the code that writes the old format is
inherited and live from day one: the Entra client secret
(`identity/infrastructure/secret-crypto.ts`) and the notification-provider
secret (`notifications/infrastructure/secret-crypto.ts`) — the two divergent
copies the design correctly identifies, with different HKDF labels
(`"entra-login-secret-encryption-v1"` at `identity/…:27` and
`"notification-provider-secret-encryption-v1"` at `notifications/…:26`), both
`FORMAT = "v1"`. Any secret entered into the setup wizard or the settings page
before the envelope lands is written in the old layout under a `v1` tag.

**What it costs.** Trivial to avoid now (call the new format `v2`, register the
template's layout as `v1` in `DECRYPTORS` with its two HKDF labels, and ship
golden vectors for both). Expensive to discover: the symptom is an
unreadable SMTP password or an un-decryptable medical note, and B-12 means an
AAD failure looks identical.

**Recommendation (do not apply).** Amend D-096 to name the new envelope `v2:`,
and make D-097's golden-vector file's *first* entries the two inherited `v1`
purposes — which is also the only way the "one entry per format ever shipped"
promise is true on day one rather than from the second format onward.

---

## CLAIMS ABOUT THE TEMPLATE I VERIFIED AS TRUE

Every statement below is one the design makes about `WebAppTemplate` or the
prototype. I checked each against the source. All of these hold, and several are
unusually precise — the design is materially more accurate about its foundation
than it was at `report-build.md`.

**The two claims the previous review falsified are now correctly stated.**

| Design statement | Verified against | Verdict |
|---|---|---|
| `13-…` §4.1: *"The template's own comment at `src/lib/auth/auth.ts:507-509` says the opposite — the Entra login configuration 'is read once at auth-context construction and so only applies on the next restart/redeploy'"* | `auth.ts:507-509`, verbatim: *"which is read once at auth-context construction and so only applies on the next restart/redeploy"* | **True, quoted accurately, and the inverted claim is gone.** The correction is properly attributed (F-105) and generates a real decision (D-106) rather than being silently patched |
| `13-…` §3.1.1: *"there is no `SECRET_KEY`"* in the template | `grep -rn SECRET_KEY src/ prisma/ docker* Makefile` → no matches | **True.** And the three incompatible lifecycles are now one statement in one place (D-112) |

**Claims about the CI pipeline.**

| Design statement | Verified against | Verdict |
|---|---|---|
| `06-…` §2.1: *"`.github/workflows/ci.yml` has **three jobs** — `verify`, `e2e` and `migrate-populated`"* | `ci.yml:22`, `:110`, `:196` | **True** |
| §2.1: *"There is **no container build, no `npm audit` gate, no CodeQL, no secret-scanning job, and no axe assertion anywhere in `tests/`** — grep finds axe only in prose"* | Nothing matching `npm audit|codeql|gitleaks|trufflehog` in `.github/workflows/`; `grep -rn axe tests/ package.json` returns only two unrelated prose matches (`tests/e2e/README.md:344`, `tests/e2e-live/lib/totp-serial.ts:21` — both the English word "relaxes") | **True, and precisely stated** |
| §2.1: *"Migration against populated DB — Inherited: applies base migrations, populates rows, then applies the PR's migrations"* | `ci.yml:240` *"Resolve base commit"*, `:253` *"Apply BASE migrations, then populate representative rows"*, `:264` *"Apply THIS PR's new migrations on the populated database"* | **True** |
| §1: *"`deploy-uat.yml` in the template runs `docker compose build` **on the target host**"* | `deploy-uat.yml:37,40` — `COMPOSE="docker compose -f docker-compose.uat.yml --env-file $ENV_FILE"` then `$COMPOSE build`, over SSH on the target | **True** |
| §2.1: *"`apps/web/.env` is currently **tracked** and in history, which must be resolved before the repository is public"* | `git ls-tree -r --name-only main` on SplashTrack lists `apps/web/.env`; it holds `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `DATABASE_URL` among 13 keys | **True, and it is a genuine Phase-0 blocker.** Rotation is required, not just a `git rm` |

**Claims about the application code.**

| Design statement | Verified against | Verdict |
|---|---|---|
| `05-…` §5 rule 6: *"The template's `AuditEvent` is a tamper-evident hash chain whose appends serialize on a **Postgres advisory lock**"* | `audit-repository.ts:114` — `await tx.$executeRaw\`SELECT pg_advisory_xact_lock(${AUDIT_APPEND_LOCK_KEY})\`` | **True.** The template's own comment (`:24-28`) even concedes the volume assumption the design questions: *"Audit writes are infrequent (sensitive actions only), so global serialization is acceptable"* |
| `05-…` §1: *"`blob-storage.ts` supports only `"local"` and throws on anything else; there is no S3 client in `package.json`"* | `src/lib/uploads/blob-storage.ts:94-101` — `const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase() \|\| "local"; switch … default: throw new Error(\`Unknown STORAGE_DRIVER … Supported drivers: "local".\`)`; no S3 dependency in `package.json` | **True** |
| `13-…` §5.2: *"the template's `decryptSecret` **throws on any format mismatch** … There are also **two independent copies of the file with different HKDF labels and separate `FORMAT` constants** (`identity` and `notifications`)"* | `identity/infrastructure/secret-crypto.ts:29` `FORMAT = "v1"`, `:27` `KEY_INFO = "entra-login-secret-encryption-v1"`, `:67-68` throws; `notifications/infrastructure/secret-crypto.ts:28` `FORMAT = "v1"`, `:26` `KEY_INFO = "notification-provider-secret-encryption-v1"` | **True in every particular.** See B-20 for the consequence the design did not draw |
| `05-…` §2: *"Validation — Zod. **To be added.** … It is in neither — no `zod` in `package.json`, no imports"* and `13-…` §3.2's F-108 | `grep -n zod package.json` → no match, in both repositories | **True** |
| `05-…` §3: *"The template is **flat-root**: `src/`, with `@/*` mapped to `./src/*`"* | `tsconfig.json:21-23` — `"paths": { "@/*": ["./src/*"] }`; `src/` at the repository root | **True**, and the D-021 reversal it justifies is correct |
| `06-…` Phase 2: *"the platform-super-admin branch inside `requirePermission`, which is **real code and not just prose**"* | `access-control/application/composable-permissions.ts:23` — `if (auth.grantedVia === "platform_super_admin") {` | **True** |
| `05-…` §4: *"Scoped `ApiCredential`s are inherited from the template"* | `prisma/schema.prisma:951` `model ApiCredential`, plus `tests/unit/api-credential-validation.test.ts` | **True** |
| `05-…` §2: *"i18n — next-intl, cookie-based locale. Inherited (ADR-006). **NL default**"* | `src/i18n/config.ts:19` — `export const defaultLocale: Locale = "nl";`, with `messages/nl.json` and `messages/en.json` | **True** |
| `14-…` §3.1: *"`postgresql-client` must actually be in the image — **it is not today**"* | `Dockerfile` — no `apt-get`/`apk add` of `postgresql-client`; the only `postgresql` match is a placeholder `DATABASE_URL` at `:39` | **True** |
| `05-…` §5.1: *"`tests/unit/migration-safety.test.ts` blocks the unsafe `ADD COLUMN … NOT NULL` without a default"* | `tests/unit/migration-safety.test.ts:36-46` — the `ADD_NOT_NULL` regex plus the separate `DEFAULT` check | **True** (the *"adopt as they are"* qualifier is B-2) |
| `05-…` §5.1: *"`person-reference-classification.ts` + `person-reference-sync.test.ts` **is** D-014's registry-with-a-test … checked **bidirectionally**"* | `person-reference-sync.test.ts:116-146` — one assertion for schema-columns-missing-from-the-map, one for map-entries-missing-from-the-schema, plus a third requiring a written reason for every `RETAIN_BY_DESIGN` | **True, and the design under-sells it** — the mandatory-reason assertion is a third control it does not mention (the *"as they are"* qualifier is B-1) |
| `05-…` §5.1: *"the build goes red the moment a domain model adds a `Person` reference without a registry entry"* | Same test, the `missing` assertion; the classification file's header calls itself *"the forcing function, for every Person-referencing column, going forward"* | **True** |
| `01-…` §1.1.1 / D-056: the template carries *"a tenant-scoping client extension, per-row tenant columns, a platform-versus-organisation settings duality, and a platform role and bootstrap layer"* | `src/lib/database/organization-scope.ts` (`ORG_SCOPED_MODELS`/`ORG_SCOPE_EXEMPT_MODELS`, `tests/unit/organization-scope-sync.test.ts`); `prisma/schema.prisma:923 model PlatformRoleAssignment`, `:1045 model PlatformBootstrap`, `:1165 model PlatformSettings`; `access-control/application/platform-role-service.ts` | **True** — all four exist and are substantial |
| `00-…` §2.2: the prototype *"has no `Person`/`UserAccount` split … no branding system, no CMS, no API layer, and no consent or retention model"* | Prototype `main` has 12 models against the template's 35; none of the above present | **True** |

**One capability the design misses in the template's favour** — recorded here
because the brief asks for the verified list to carry the same weight as the
defects: `src/lib/auth/session.ts` + `src/lib/settings/config.ts` already
implement a live, admin-configurable, floor-and-ceiling-bounded session idle and
absolute timeout with fail-safe-to-strict degradation. That is D-150's `bounded`
class and most of D-158, already built and already debugged twice. See B-5.

