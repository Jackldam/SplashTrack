# rev8 — verification of the two rev7 chapter rewrites

Branch `build/v1-foundation`, from HEAD `c8b6085`. Read-only on the design
chapters except for two mechanical propagations, committed separately and listed
under *Fixes applied* at the end.

**What was verified, and against what.** Two rewrites landed unchecked:

- **Rewrite A — chapters 01 and 15.** `Certificate` → `Award` (D-082), the
  skills-catalogue collapse (D-084), the `PersonRelationship` merge, the §2.2 ER
  diagram, and the D-057 ownership contradiction. Chapter 01 was last touched
  `e84d79e`, 2026-09-02 23:52; chapter 15 `afaeaca`, 2026-09-02 18:14.
- **Rewrite B — chapters 03, 13 and 14.** The `SECRET_KEY` lifecycle (D-112),
  the boot state machine (D-055/D-098/D-099), the Recovery Kit (D-040/D-114/
  D-166) and the archive format (D-102/D-169). Reported in
  `rev7-core-repairs.md`. Chapter 03 was last touched `9de14c9`, 2026-09-02
  08:27; chapter 13 `33a0d8d`, 23:58; chapter 14 `df086f3`, 2026-09-03 00:02.

**No design chapter has been edited since 2026-09-03 00:02.** Decisions D-174
through D-188 and phases 1.0–1.5 of the build both landed after that. That
single fact produces most of what follows.

Checks run: the five rewritten chapters read in full; the register, findings and
open-decisions read in full; all four rev7 reports sampled with every named
blocker traced to the chapter text; identifier integrity checked mechanically
across all of `docs/`; and the chapters compared against `src/`, `prisma/` and
`docs/adr/` where they overlap. The suite is green — **42 files, 505 tests**.

---

## What holds

These were checked and are sound. They are listed because "verified true" is the
half of a review that is usually missing.

1. **The `Certificate` → `Award` rename is complete.** `01-…` §2.2's ER diagram
   (`ExamResult ──0..1── Award`), §3.5's entity row, `04-ux.md`, `docs/glossary.md`
   and the register all use `Award`. `grep -rn Certificate src/ prisma/` returns
   nothing but the `CERTIFICATE` value of `AwardType.kind`, which is the point of
   D-082. The surviving prose occurrences in `15-…` §1, §2.4 and `10-…` F-43
   describe the pre-rename state and are correct as history. **`15-…` §9 item 3's
   claim that the rename is applied throughout is true.**

2. **The skills-catalogue collapse (D-084) is applied in both chapters.**
   `Skill`, `SkillRequirement` and `SkillCatalogue` are gone from `01-…` §3.3 and
   `15-…` §2.6; `SkillProgress` survives referencing a versioned criterion, and
   the §2.2 ER diagram hangs it off `SchemeCriterion` rather than off a second
   catalogue. (The *name* of that catalogue is a separate defect — see D-3.)

3. **The `PersonRelationship` merge is applied and matches the code.** One entity
   with a `type` enum in `01-…` §3.1, `model PersonRelationship` in
   `prisma/schema.prisma:918` with `authority`, `evidence` and
   `PersonRelationshipType`, and `evidence` correctly registered as an encrypted
   column (`@encrypted person_relationships.authority_evidence`).

4. **D-057 is stated once and pointed at once.** The decision is in `01-…` §1.2;
   §2.3 references it without restating it. D-134-compliant, and the "one table,
   two owners" contradiction is genuinely resolved.

5. **All five rev7 buildability blockers have a decision *and* chapter text.**
   B-3 → D-173 (`02-…` §4.1.2), B-7 → D-170 (`02-…` §2.6.1), B-12 → D-167
   (`13-…` §5.1.1), B-13 → D-169 (`14-…` §3.1.1), B-17 → D-168 (`02-…` §3.2.1).
   Each was read in the chapter, not taken from the report.

6. **D-166's consequential edits landed.** The token-wrapped key record is in
   `14-…` §2.3, the fingerprint gate and decryptability proof in §4.2.2, D-113's
   amendment in `13-…` §3.1.1, `secret:recover` in §7's command list, and the
   key-custody line in §8's diagnostics list. This was the largest single claim
   in `rev7-core-repairs.md` and it checks out.

7. **The reach model matches D-147.** `src/lib/authorization/reach.ts:79-104` is
   a branded discriminated union with an `ORGANIZATION` variant, `NONE` and
   `UNION`, and no `all: boolean`.

8. **Numbering integrity is clean.** 173 register rows, no duplicate `D-`
   number; 105 findings, no duplicate `F-`; 19 `OD-`, all closed; 38 `R-`. After
   the D-137 fix below, **every `D-`, `F-`, `R-` and `OD-` id cited anywhere
   under `docs/` resolves to a definition** — zero dangling references. Register
   gaps (D-069–079, D-117–119, D-137) and finding gaps are unallocated numbers,
   not losses; the D-090–D-098 collision recorded in `08-…` *Register integrity*
   is genuinely repaired.

---

## Confirmed defects

Fourteen. Severity is about consequence if built from, not about how wrong the
sentence is.

### D-1 · HIGH · `15-…` §2.5 states the opposite of D-164

The register points D-164 at `15-assessment-and-fees.md` §2. §2 does not carry
it, and §2.5 states its negation as a decision:

> **Decision D-083 — NRZ-derived schemes **ship seeded** and source-labelled
> (`source = NRZ`).** — `docs/design/15-assessment-and-fees.md:168-170`

> D-164 | The assessment catalogue is **authored in the application by an
> administrator**, never seeded from source. **v1 ships an empty catalogue** plus
> the surface to build one — `docs/design/09-decision-register.md:157`

§2.6 repeats the seeding premise ("one catalogue to seed, one to import and
export"), and the chapter never mentions D-164. An implementer reading chapter
15 builds a seeder that D-164 deleted.

**Fix.** Rewrite §2.5 around D-164: replace D-083's seeding rule with the
authoring surface, keep `AssessmentScheme.source` as the provenance label for
anything an administrator imports, and mark D-083 superseded in its register row.
Correct §2.6's "one catalogue to seed" to "one catalogue to author".

### D-2 · HIGH · D-188 is in no chapter, and chapter 15 is where it belongs

D-188's `Where` is `15-assessment-and-fees.md` §2. Chapter 15 has no mention of a
form editor, a JSON document, round-tripping, or `CriterionSet`. D-188 is a v1
critical-path surface — nothing can be assessed before a catalogue exists — with
zero chapter specification.

**Fix.** A new `15-…` §2.7 stating D-188: one aggregate, two surfaces, the same
validator, whole-file rejection, export/re-import round-trip as the drift test.

### D-3 · HIGH · Two identifiers for one concept: `CriterionSet` vs `AssessmentScheme`

`docs/glossary.md` — the D-159 authority that "fixes one English identifier per
domain concept" — says:

> | eisen / eisenpakket | `CriterionSet` | fixed | — `docs/glossary.md:53`

Chapters 01 §3.3 and 15 §2.1 use `AssessmentScheme` with `SchemeCriterion`.
Every decision from D-160 onward (D-160, D-164, D-188) says `CriterionSet`;
`grep -rln CriterionSet docs/` hits the glossary, register, open-decisions and
findings but **neither chapter**. This is exactly the "rename applied in one
chapter and not another" class, and it is in the naming register whose whole
purpose is to prevent it.

**Fix.** Pick one — the glossary is the authority under D-159, so `CriterionSet`
— and apply it through `01-…` §2.2, §3.3 and `15-…` §2.1–2.6, or amend the
glossary row and the three decisions instead. Not both.

### D-4 · HIGH · D-116 as written is the precondition D-182 forbids, and the code does the opposite

> **Decision D-116 — The application's database role is not a superuser. **It
> owns its own schema and nothing else**, `NOSUPERUSER NOCREATEROLE` …
> — `docs/design/14-backup-restore-upgrade.md:479-481`
> (repeated verbatim at `docs/design/03-deployment-model.md:86`)

> **Precondition, previously unstated: the revoke means nothing while the
> application role *owns* the audit tables** — an owner re-grants itself in one
> statement — D-182, `docs/design/09-decision-register.md:175`

```ts
// src/lib/database/role-model.ts:180-186
`ALTER SCHEMA public OWNER TO ${quote(owner)}`,      // a separate NOLOGIN role
`GRANT USAGE ON SCHEMA public TO ${quote(app)}`,     // the runtime role: USAGE only
```

`infra/provision-roles.sql` creates `splashtrack_owner` `NOLOGIN`,
`splashtrack_app` and `splashtrack_retention`. **The code is right** — D-182 was
accepted by Jack on 2026-09-04 and implemented and tested in phase 1.2 — and two
chapters state a rule that would make D-149 part 2 decorative.

**Fix.** Amend D-116 in `14-…` §4.2.1 to "owns nothing; a separate non-connecting
owner role owns the schema, and the runtime role holds `USAGE` plus DML", cite
D-182 and ADR-0002, and reduce `03-…` §1.2's row to a pointer (D-134).

### D-5 · HIGH · Chapter 13's boot state machine contradicts `src/lib/boot/state.ts`

The brief called this the highest-risk overlap. It is.

> **Decision D-099 — Setup mode requires **all** of: no bootstrap record, zero
> `UserAccount` rows, zero `Person` rows and zero `RoleAssignment` rows. Data
> present with the bootstrap record missing is not `PARTIAL`; it is `TAMPERED`.**
> — `docs/design/13-configuration-and-setup.md:647-649`

```ts
// src/lib/boot/state.ts:525-534
if (started > 0 && evidence.length === 0) {
  return decide("PENDING_ENROLMENT",
    `First-run setup is still running: ${shape.userAccounts} ` +
    "administrator account(s) exist, none has enrolled a second factor, " +
    "and the installation holds nothing else. … so this serves.");
}
```

`BootState` at `:72-80` has **eight** members; `13-…` §6.1's D-098 table has six
rows and no `PENDING_ENROLMENT`. **The code is right, and the document describes
a bug that actually fired:** D-186 records that on 2026-09-04 `admin:create`
succeeded on UAT and the container then refused to serve with *"the installation
holds data (1 person row(s), 1 account(s), 2 role assignment(s))"* — the product
refusing the one page that could finish the install. `src/lib/setup/gate.ts:27-28`
quotes §6.3 back and notes it is stale.

§6.3 is stale in the same direction: it lists a step 0 (restore), a step 4
(recovery token) and a step 5 (email settings) that do not exist, and says the
record is written at step 6 "Done", where D-185 writes it on MFA verification.
`src/app/setup/page.tsx:31-48` documents each omission and why — the doc has not
absorbed any of it.

**Fix.** Add `PENDING_ENROLMENT` as a seventh row to §6.1's table; replace
§6.2's predicate with D-186's two conditions verbatim; restate §6.3's steps as
the three built (token → organisation + administrator with password twice → MFA
with QR) and mark 0/4/5 as pending the export and mail engines, as the code
already does.

### D-6 · HIGH · `02-…` §3.2 D-149 part 2 contradicts D-182 and the code

> **A separate database role with `INSERT`-only grant on `AuditEvent`** … **The
> application writes audit events as that role and everything else as its
> ordinary role.** — `docs/design/02-security-privacy.md:1023-1025`

> **Confirms D-149's separate database roles, with one correction: **there is no
> separate append-only *writer* connection**.** … the runtime role, which **is**
> the append-only writer — D-182, `09-decision-register.md:175`

```ts
// src/lib/database/role-model.ts:237-239
`REVOKE ALL ON TABLE "AuditEvent" FROM ${quote(app)}`,
`GRANT SELECT, INSERT ON TABLE "AuditEvent" TO ${quote(app)}`,
```

The code is right. §3.2's trade-off paragraph also says an operator "must create
two roles rather than one"; the provisioning file creates three.

**Fix.** Replace part 2's text with D-182's three-role model and correct the
trade-off count.

### D-7 · HIGH · rev7 C-11 was never closed, in a chapter Rewrite A owned

> `ExamAssessor` | … Access comes from an `EXAM_SESSION`-scoped role assignment
> (**D-054**). — `docs/design/01-domain-model.md:492`

D-054's own register row reads **"(Superseded by D-068)"**, and D-068 replaced
`EXAM_SESSION` with `SESSION`. C-11 was rated **high** by the rev7 consistency
pass and named in its summary as one of the three highest-yield defects. It
survives verbatim in the chapter the rewrite covered. Chapter 15 §3.1 gets this
right, so the two chapters now disagree about the same mechanism.

**Fix.** `01-…` §3.5's `ExamAssessor` row cites D-068 and says `SESSION`.

### D-8 · MEDIUM-HIGH · `13-…` §3.1.1's HKDF tree is incomplete, and it declares itself authoritative

The section is headed *"`SECRET_KEY` — the single authoritative statement"*, and
its tree closes with `└─` after five labels
(`docs/design/13-configuration-and-setup.md:125-131`). The code has eight:

```ts
// src/lib/crypto/secret-key.ts:63-95
export const KEY_PURPOSES = [
  "auth-signing-v1", "totp-v1", "settings-secret-v1", "medical-v1",
  "backup-master-v1", "audit-anchor-v1", "fixture-v1",
  "relationship-evidence-v1", /* + the setup-wizard cookie MAC */ ]
```

`audit-anchor-v1` is D-168's checkpoint MAC — specified in `02-…` §3.2.1 and
absent from the section that claims to state the derivation once.

**Fix.** Add the missing labels with their decisions, or replace the closed tree
with a pointer to `src/lib/crypto/secret-key.ts` as the single home.

### D-9 · MEDIUM-HIGH · S-2 exists only in an agent report, and `14-…` §2.3 asserts a property S-2 disproves

> The master key is also derivable as `HKDF(SECRET_KEY, info="backup-master-v1")`
> — `docs/design/14-backup-restore-upgrade.md:97`

> the token is revocable by re-wrapping (D-114), and the re-wrap now covers the
> whole key record, so **a departing volunteer's copy is genuinely retired**
> — `docs/design/14-backup-restore-upgrade.md:218-220`

Anyone who held `SECRET_KEY` — which D-166 now also places, wrapped, in every
archive header — can derive the master key of every archive ever written,
regardless of token rotation. `rev7-core-repairs.md:292-298` names S-2 as
"adjacent, deliberately not taken" and calls it *"the single largest remaining
hole in the crypto envelope"* — and it was never raised into `10-findings.md`.
The same is true of **B-20** (the `v1` format tag colliding with the inherited
`secret-crypto.ts` `FORMAT = "v1"`) and **B-6** (`appendAuditEvent` opening its
own transaction). All three are invisible to the design set.

**Fix.** Raise S-2, B-20 and B-6 as findings F-146–F-148 with the report's own
text, and soften §2.3's revocation claim to what it can support.

### D-10 · MEDIUM-HIGH · rev7 C-3 was never closed: `AFTEST` versus `PRE_EXAM`

> `Assessment           type ∈ {AFTEST, EXAM}` — `docs/design/15-assessment-and-fees.md:49`

> | **aftesten / aftest** | `Assessment` (kind: `PRE_EXAM`) | fixed |
> — `docs/glossary.md:46`

The value *and* the field name differ, and D-159 makes English identifiers
mandatory "without exception". C-3 was rated **high**. Register row D-085 uses
`AFTEST` too, so the register is on the chapter's side of the disagreement.

**Fix.** Adopt the glossary (`kind: PRE_EXAM`) in `15-…` §2.1 and §3 and in
D-085's row, or amend the glossary and record why.

### D-11 · MEDIUM · Chapter 15 calls two closed questions open, twice

> **No catalogue may be seeded until the criteria are confirmed** … Recorded as
> **F-44**. — `docs/design/15-assessment-and-fees.md:187-190`
> … (§2.5, F-44). **Still open** — `:589`
> **(Open — OD-17, …)** The grade scale is assumed … and unasked as a
> requirement. — `:597-600`

F-44 is **CLOSED — dissolved rather than answered** (`10-findings.md:397`),
OD-17 is **CLOSED 2026-09-02** (`08-open-decisions.md:536`, → D-160).
`00-overview.md:62-65` repeats both as "the two genuinely open questions".

**Fix.** Rewrite §2.5's blocking note and §9 items 2 and 5 as closed with their
decisions; correct the overview sentence.

### D-12 · MEDIUM · `03-…` §1.2's image status table is stale and presented as verified fact

The section says *"Verified against the repository: the Dockerfile is a
self-described development/Sprint-0 image"* and then:

> | **Runs as non-root**, read-only root filesystem, multi-stage build, no build
> tools or devDependencies in the final layer, digest-pinned base image … |
> **None of this holds today.** Single-stage, root, undigested, devDeps present |
> — `docs/design/03-deployment-model.md:87`
> | **Health and readiness endpoints** … | **To build** | — `:89`

The current `Dockerfile` is four-stage, ends `USER splashtrack` (`:179`), pins
`node:22-alpine@sha256:c610fcdf…` (`:57`) and runs `npm ci --omit=dev` (`:117`);
`src/app/api/health/route.ts` and `src/app/api/ready/route.ts` both exist. A
"To build" row against built work is how work gets done twice.

**Fix.** Re-run the status column against the tree and cite
`docs/build/phase-1.0-deployment-and-breakglass-report.md`.

### D-13 · MEDIUM · `03-…` §1.2 still wants `postgresql-client` in the image

> | **`postgresql-client` present** for dump/restore tooling | **Absent today** |
> `14-…` §3.1 | — `docs/design/03-deployment-model.md:88`

D-169 put `pg_dump`/`pg_restore` **out of scope, not a fallback**, and `14-…`
§4.2.1 names `postgresql-client`'s absence as a *reason*, listing its presence
among the terms anyone reintroducing the path would have to meet. Chapter 03
still lists it as a target property, pointing at a section that no longer
specifies it. The `Dockerfile:48` comment says it is "deliberately ABSENT".

**Fix.** Delete the row, or restate it as "deliberately absent (D-169)".

### D-14 · MEDIUM · rev7 C-16 was never closed, and shipped code now contradicts it

> … with `onExpiry` being `DELETE`, `ANONYMISE` or `REVIEW`
> — `docs/design/01-domain-model.md:553-554`
> | Charges | … | **`PSEUDONYMISE`** (D-092) | — `:575` (and `:576` for Payments)

```prisma
// prisma/schema.prisma:1822-1839
enum OnExpiry { DELETE  ANONYMISE  REVIEW }
```

The same section states the enum and then uses a fourth value D-155 explicitly
rules out. The code has three values. This is now a doc-versus-code
contradiction, not only an internal one.

**Fix.** Either express D-092's financial retention as `REVIEW` with the ground
recorded, or add `PSEUDONYMISE` to the enum in `02-…` §5.6, the schema and
D-065 — one of the two, stated once.

### D-15 · MEDIUM · D-174–D-188 are in no chapter, and D-177 is the one that hurts

Fifteen decisions exist only in the register, findings and open-decisions:
D-174, D-175, D-176, D-177, D-178, D-179, D-180, D-181, D-182, D-183, D-184,
D-185, D-186, D-187, D-188 (plus D-160 and D-164, see D-1/D-2). Their `Where`
columns name chapter sections that do not carry them — D-175, D-177, D-179 and
D-180 all name `01-domain-model.md`, which mentions none of them.

Most are propagation debt. **D-177 is more than that:** it creates `SafetyNote`,
a special-category free-text field whose lawful basis is explicit consent, which
is encrypted, read-audited, export-excluded and *"retained no longer than the
enrolment that justifies it"*. `01-…` §5 is the retention table's only home and
has no row for it. The same section has no `Pool`, `Lane` (D-175) or
`GroupMove`-adjacent make-up guest reach (D-179).

**Fix.** One propagation pass over `01-…` §2.2, §3.1–3.2 and §5, and `15-…` §6
for D-178. Highest first: D-177's retention row.

### D-16 · MEDIUM · `Inquiry` is referenced four times and defined nowhere

`01-…` §3.1's `WaitlistEntry` row gives it a relation ("Person, 0..1 `Inquiry`"),
§3.2's D-109 names it, and `00-overview.md` R-33 and §3.4 depend on it. There is
no entity row for it in any chapter and it is absent from the §2.2 ER diagram
that Rewrite A rewrote.

**Fix.** Add an `Inquiry` row to `01-…` §3.1 (owned by `pages`, per the §5
retention row that already exists for it) and to the ER diagram.

---

## Low severity

| # | Defect | Fix |
|---|---|---|
| L-1 | `13-…` §5.1.1 says the re-encrypt rule is "added to `05-technical.md` §5 as **rule 7**". It is **rule 6** there; rule 7 is the audit-event rule. D-167's register row says rule 6. | Change 7 → 6. |
| L-2 | `13-…` §7's break-glass list omits `admin:create`, `setup:init`, `audit:verify`, `audit:grants`, `boot:state` and `db:apply-grants`, all implemented. D-187 demotes the first two "in the usage text **and the documentation**" — which does not mention them. | Add them, marked as the host path the wizard replaces. |
| L-3 | `01-…` §3.1 gives `WaitlistEntry` a `courseId?`; D-180 says an entry records "the child **and the level**". | `courseLevelId?`. |
| L-4 | `00-overview.md:58-59` says the register is "D-001–D-138" and findings "F-01–F-108"; they run to D-188 and F-145. | Update, or drop the range. |

---

## Reads oddly — not defects

Short, as instructed.

- D-188's prose says "award types, **their skills** and the requirement
  thresholds" after D-084 removed `Skill`. It is quoting the shape of Jack's
  request; the model reference in the same row is `CriterionSet`.
- `15-…` §1 and §2.4 use the word `Certificate` while describing the collision
  D-082 fixed. Correct as history.
- `01-…` §2.3 restates D-057's ownership rule; it is a pointer with a citation,
  not a second normative home.

---

## Fixes applied

Two, both mechanical propagations of decisions already taken — no design
judgement exercised. Everything else above is left for an author, because
choosing between a chapter and a register is a decision, not a repair.

- **`fa51f55`** — `02-…` §3.2.1's `AuditCheckpoint` record said the anchor was
  the last *surviving* sequence and its hash. D-168's register row was corrected
  on 2026-09-03 (`a2e656d`) to the last **pruned** sequence, and the
  implementation follows the corrected rule
  (`prisma/schema.prisma:1520-1525`; `src/modules/audit/domain/audit-checkpoint.ts:9-18`,
  whose header notes that the chapter's sketch says the wrong thing). Corrected
  the record and added the reasoning as a dated note.
- **`f9de799`** — D-176 cited "the DPIA (**D-137**)". D-137 has never existed;
  the DPIA is **F-134**. It was the only dangling identifier in the set.

---

## Verdict

**Rewrite A (chapters 01, 15) cannot be trusted as it stands.** Its five named
tasks are done and done well — the rename, the collapse, the merge, the ER
diagram and D-057 all verify — but chapter 15 states the negation of D-164,
omits D-188 entirely, calls two closed questions open, and disagrees with the
glossary about the name of its central entity; chapter 01 still cites a
superseded decision as the live access mechanism (C-11, rated high in rev7 and
untouched). The rewrite closed what it was asked to close and did not notice
what moved underneath it.

**Rewrite B (chapters 03, 13, 14) can be trusted for what it claims, and its
claims are now partly out of date.** Every closure in `rev7-core-repairs.md` was
traced into the chapter text and holds, including the largest one (D-166). Its
own "deliberately not taken" list is honest — and it is the reason S-2, B-20 and
B-6 are real holes that no register knows about. What it could not have known is
that D-181 through D-187 and phases 1.0–1.5 would land within forty-eight hours
and leave chapter 13's boot state machine describing the exact bug that locked
the owner out of UAT on 2026-09-04.

**The pattern rev7's consistency pass named is still the dominant one, and it has
moved rather than shrunk.** In rev7 it was "the register was updated; the
chapters mostly were not". It now runs in both directions: seventeen decisions
live only in the register, and three of the chapters' most load-bearing
statements — D-099's predicate, D-116's ownership, D-149's writer role — are
contradicted by code that is green, tested and right. **Where the document and
the implementation disagree, the implementation is correct in every case found.**
That is a good sign about the build and a bad one about the chapters: they are no
longer the place to learn how this system works.

---

## rev8 repair pass — what was closed, 2026-09-05

Appended by the author acting on this report, on `build/v1-foundation` from
HEAD `aea1d68`. **No application code was changed**; `npm test` reports
**42 files, 505 tests passed** before and after, which is the intended signal.

### All seven HIGH findings closed

| # | What was done | Commit |
|---|---|---|
| **D-1** | `15-…` §2.5 rewritten around **D-164**. D-083 marked *(Superseded by D-164)* in the register and retained in §2.5 as history — because the **fork rule and the `source` label survive it**: that argument never depended on where the first version came from. §2.6's *"one catalogue to seed"* → *"to author"* | `21dc87c` |
| **D-2** | New `15-…` §2.7 specifies **D-188**: one aggregate, two surfaces, the same validator, whole-file rejection, export/re-import round-trip as the drift test | `21dc87c` |
| **D-3** | **`CriterionSet` wins.** New **D-189** makes `docs/glossary.md` the tie-breaker under D-159 and applies it: `AssessmentScheme` → `CriterionSet`, `SchemeCriterion` → `Criterion`, `schemeId` → `criterionSetId`, across `01-…`, `15-…`, `10-…` and four register rows | `21dc87c` |
| **D-4** | **D-116 amended** in `14-…` §4.2.1 to D-182's model — the runtime role owns *nothing*, a non-connecting `splashtrack_owner` owns the schema. `03-…` §1.2 reduced to a pointer (D-134); the full role model left to ADR-0002 §7 | `d34ddc4` |
| **D-5** | `13-…` §6.1 gains `PENDING_ENROLMENT` (predicate 4 splits three ways, eight states); §6.2 replaced with **D-186**'s two conditions verbatim, including the UAT measurement; §6.3 restated as the three built steps with 0/4/5 marked pending the export and mail engines | `4f4d131` |
| **D-6** | `02-…` §3.2 part 2 replaced with **D-182**: the runtime role *is* the append-only writer, there is no separate writer connection. Trade-off count corrected to three roles / two credentials | `cde8729` |
| **D-7** | `01-…` §3.5's `ExamAssessor` row cites **D-068** and `SESSION` (rev7 **C-11**) | `d2d6db0` |

### Also closed

**D-8** (`13-…` §3.1.1) — the tree now points at `KEY_PURPOSES` as the single
home and tabulates the four missing labels with their decisions. A closed
diagram goes stale by the ordinary operation of the rule it describes.
**D-9** — see the correction below. **D-10** — `PRE_EXAM` adopted (folded into
D-189). **D-11** — was already closed by `5f11a00`/`aea1d68` before this pass
began. **D-12/D-13** — `03-…` §1.2's status column re-run against the tree and
**dated**; `postgresql-client` restated as deliberately absent (D-169).
**D-14** — `onExpiry` has three values; see the correction below. **D-16** —
`Inquiry` gets an entity row and an ER-diagram edge. **L-1** rule 7 → 6.
**L-2** — six commands added to §7, marked as the host path D-187 demotes.
**L-3** — `courseLevelId?`. **L-4** — the range dropped rather than updated.

### Two places the report's own instruction would have documented a stale defect

Both were caught by checking the tree before writing, which is this pass's own
version of the lesson the report is about.

- **D-9 proposed raising S-2, B-20 and B-6 as F-146–F-148. Only S-2 is real.**
  **B-20** — there is no second party to the `v1` tag collision:
  `secret-crypto.ts` does not exist in `src/`, removed at extraction (D-056).
  **B-6** — `appendAuditEvent` already takes an optional `client`
  (`audit-repository.ts:119-121`) and joins the caller's transaction. Both are
  recorded as **F-147** and **F-148** with that outcome, rather than raised as
  defects. **S-2 is raised as F-146 and is open**: `SECRET_KEY` alone derives
  the master key of every archive, so token rotation does not retire a
  `SECRET_KEY` holder's copy — and `14-…` §2.3's *"genuinely retired"* is now
  bounded to what the envelope supports. **Closing F-146 is a decision for
  Jack, not a repair.**
- **D-14's proposed fix was to add `PSEUDONYMISE` to the enum or express D-092
  as `REVIEW`. The code had already reasoned it out**, and better than either:
  `prisma/schema.prisma`'s `enum OnExpiry` says *"Retention expiry and erasure
  exemption are two mechanisms; the fiscal ground belongs to the second."* So
  `onExpiry` is `REVIEW` and D-092's pseudonymisation stays in the D-014
  erasure registry, which is also the shape D-154 generalises. Adopted as
  written there.

### Deferred, with the reason

**D-15 — the D-174–D-188 propagation pass. Deferred, and the measurement is why.**
The report scopes this as fifteen decisions. Checking every register row's
`Where` column against the chapter it names finds **42 mismatches**, and most
predate D-174 entirely — D-007, D-086, D-120 through D-138, D-158 through
D-165. This is not rev8-era debt; it is the standing condition of the `Where`
column. Writing eight of the fifteen into chapters would leave the class open
and the count roughly where it started.

What this pass **did** propagate is everything the high findings required plus
D-15's own highest item: D-164, D-177 (the missing `SafetyNote` retention row —
`01-…` §5 is the table's only home), D-180, D-182, D-185, D-186, D-187, D-188
and the new D-189. **Still unpropagated: D-174, D-175, D-176, D-178, D-179,
D-181, D-183, D-184.** The rest is a scoped pass of its own, and it should
start from the 42, not the 15.

### Integrity checks, re-run

```text
=== 1. DEFINITIONS AND DUPLICATE NUMBERS ===
  D    174 defined   174 unique  duplicates: NONE
  F    108 defined   108 unique  duplicates: NONE
  OD    19 defined    19 unique  duplicates: NONE
  R     38 defined    38 unique  duplicates: NONE

=== 2. DANGLING REFERENCES ===
  live design set (docs/, excluding review archives):
    none
```

**A note on scoping check 2, because this report's own "zero dangling" claim
depends on it.** Canonical ids are zero-padded — `D-001`…`D-189`, `F-01`…`F-148`,
`R-01`…`R-38`. The reports under `docs/design/review/` use their own *local*
single-digit labels for their own findings (this report's `D-1`…`D-16`, rev7's
`R-1`…`R-9`, the staging files' `F-50`…`F-64`), and those are not register ids.
A checker that does not require the canonical width reports ~55 false
positives. Within the live design set — everything under `docs/` except the
review archives — **zero dangling references**, and no duplicate `D-`, `F-`,
`R-` or `OD-` number anywhere.

The review archives still cite `D-069`, `D-070`, `D-071`, `D-079`, `D-117`,
`D-119`, `D-137` and eighteen superseded staging `F-` numbers. Those are frozen
historical documents citing unallocated numbers and renumbered staging
findings; they are correct as history and were not touched.

```text
Test Files  42 passed (42)
     Tests  505 passed (505)
```

### Where the code turned out to be right — every time, again

D-4, D-5, D-6, D-8, D-9 and D-14 all resolved in the code's favour, and in two
of them (`enum OnExpiry`, `appendAuditEvent`) the code had already written down
the reasoning the chapter was missing. **No case was found where the code was
wrong and the chapter right.** The nearest thing to one is F-146, and it is not
that: the `backup-master-v1` derivation is deliberate and correct: what was
wrong was `14-…` §2.3 claiming a revocation property the derivation does not
support.

The report's closing judgement — *"they are no longer the place to learn how
this system works"* — is less true of chapters 02, 03, 13, 14 and 15 than it
was this morning, and still true of the `Where` column.
