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

_(continued — findings B-8 onward below)_
