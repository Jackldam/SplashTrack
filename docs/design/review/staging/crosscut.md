# Staging — cross-cutting decisions and findings

> **MERGED, 2026-09-01.** Every row and finding below is now in
> `09-decision-register.md` (D-120–D-136, D-138) and `10-findings.md`
> (F-80–F-91). D-137 was dropped in favour of D-086, which already covers the
> same decision under a lower number, per this file's own instruction. F-15
> was inserted between F-14 and F-16 as directed. This file is kept for
> provenance; do not merge it again.

Staged by the cross-chapter consistency and v1-scope pass (2026-09-01).

**Ownership.** This agent edited `00`, `04`, `05`, `06`, `07` and `08` only. It
does not own `09-decision-register.md` or `10-findings.md`, so everything that
belongs in those two chapters is staged here for their owner to merge.

**Numbers used.**

- **Decisions: D-120 – D-138.** The live register ends at D-067. The brief said
  to start at D-100, but the concurrently edited chapters 13 and 14 had already
  taken **D-100 – D-107**, and chapters 01/03/13/14/15 had taken **D-080 –
  D-099**, so this block starts at D-120 to leave the highest number in use
  (D-107) a clear margin.
- **Findings: F-80 – F-91**, plus **F-15**, which is not new — it is an existing
  finding that has never been defined in the active register (item 1 below).
  The live register ends at F-28; chapters 13 and 14 had taken **F-60 – F-63**,
  so this block starts at F-80 for the same reason.

**A note for whoever merges the register.** The number space is currently sparse
and non-contiguous — D-068…D-079 and D-108…D-119 are unused, as are F-29…F-59
and F-64…F-79. That is a side effect of four agents numbering in parallel, not a
meaning. Renumber into a contiguous sequence at merge time if you want to, but
do it in one pass and update every cross-reference, or leave the gaps and say
so; a half-renumbered register is worse than a gappy one.

**Possible overlap to check before merging.** D-122 (`RELATED` removed) is
implemented by chapter 02's owner; D-137 (the aftest screen) is adjacent to
chapter 15. Both are staged here because the *text* was changed in chapters this
agent owns. If either arrives from another agent with a lower number, take
theirs and drop mine.

---

## 1. F-15 — the finding that is cited but never defined

`10-findings.md` closes **F-01** by forwarding to F-15: *"Replaced by F-15 — the
same shape of risk now lives one level down."* But `grep '^### F-'` on that
chapter returns F-01…F-14 and then **F-16**. F-15's only definitions are in
`11-revision-single-tenant.md`, whose banner states it is history and **must not
be cited as a requirement**. The register therefore closes its own
highest-severity original finding by forwarding to nothing.

**Two things for the register's owner:**

1. Insert the definition below between F-14 and F-16.
2. The numbering gap **F-14 → F-16** is not an editorial slip; it is the symptom.
   It should not be silently closed by renumbering F-16 onward — F-16 is cited
   elsewhere.

Text, carried from `11-revision-single-tenant.md` and made active:

### F-15 — Scope filtering has the same failure mode tenancy did
**Severity: high — the highest-severity internal risk in the product.**
The isolation problem did not disappear when multi-tenancy did; it moved down a
level. An instructor must not browse another location's students, another
group's students, or a student outside the session they are assigned to. That is
now enforced by **scope filtering**, which has *exactly* the same failure mode
tenant filtering had: **a missed `where` clause silently returns too much.** It
fails open, it fails quietly, and no user reports it because nothing looks
broken.

**Response.** The tenancy tests are not simply deleted — they are **replaced**:
reach is a required repository argument (D-031), reach may only be constructed by
`resolveReach()` (D-030), and scope-escape tests are mandatory per module
(D-032). The minimum content of that suite — including the **list** case, which
is the one that must never be dropped — is specified in `06-delivery.md` §2.1.

---

## 2. Decision register rows to add

| ID | Decision | Reason | Trade-off accepted | Where |
|---|---|---|---|---|
| D-120 | The v1 scope is re-cut: the self-hosting *product* moves out (IdP registry, restore matrix, settings registry, UAT environment, retention engine, CMS, `/api/v1`, the 15-check CI) and the assessment domain moves in (aftesten, `SESSION` reach, billing-lite, waiting list, group moves, print, NRZ export, breach response) | The design was not over-scoped by a factor of two, it was **mis-scoped**: ~45% of specified effort went into a product for a self-hosting stranger, while six capabilities named as weekly needs were absent entirely. OD-2's closure — the first and only operator for the next year is the author, at his own school — makes that spend provably speculative | ~18–20 engineer-weeks against ~60–75 as specified, but a stranger self-hosting v1.0 gets a rougher experience than the design promised. Every deferred item is additive, none is structural | `00-overview.md` §3.5 |
| D-121 | `UNIT` is a **flat** scope in v1; the recursive descendant walk is not built | One pool. A recursive tree walk is the highest-risk code path in the application — it fails open, silently, at depth — and it was written for a federation that does not exist | A future federation needs the walk added, plus tests. Cheap later; a live scope-escape bug is not | `00-overview.md` §3.5.1, `02-…` §2.1 |
| D-122 | `RELATED` is **removed from the scope enum entirely** until the guardian portal ships | It was in three states at once: R-14 mandated building it in v1, P-04 and OD-5 deferred it, and the v1 starter-role catalogue shipped a Guardian role that used it. Deferring a scope while leaving it grantable is the worst option — an administrator assigns a scope whose enforcement nobody wrote, and it looks like it works | The Guardian role's consent authority is expressed without a scope axis in v1. The enum member returns with the portal that needs it | `00-overview.md` §3.2 P-04, `08-…` OD-5, `02-…` §2.1 |
| D-123 | Repository layout is **flat root** (revises D-021) | D-021 rested on "the existing SplashTrack repo already uses `apps/web`" — true of the *prototype*, false of the **template**, which is flat-root with `@/*` → `./src/*`. Adopting `apps/web` means moving the whole tree and rewriting `tsconfig`, both vitest project globs, `playwright.config.ts`, `prisma.config.ts`, the Dockerfile and two compose files, to buy room for a second artefact nobody has asked for | Adding a worker or docs site later means doing the move then, with a reason. If `apps/web` is adopted anyway it **must be the literal first commit** | `05-technical.md` §3 |
| D-124 | D-048 is enforced by `tests/unit/migration-history-append-only.test.ts`: the migration-name set at the last release tag is a subset of HEAD's, and no applied migration's SQL content hash has changed, against a committed lockfile | "Never squash" is a sentence in a document, and squashing *feels like tidying* — it gets done by someone being helpful, and the damage is invisible until a self-hoster's old backup will not restore | Every migration commit updates a lockfile. That diff is also a useful review artefact | `06-delivery.md` §2.2 |
| D-125 | Module boundaries are enforced on **Prisma model access**, not only on imports: each module exports a client narrowed to the models it owns, and a lint rule forbids the root client under `modules/` | `no-restricted-imports` catches cross-module *imports*. The actual violation — `prisma.scheduledSession.create()` inside `planning` — imports nothing and passes. The rule was checking the wrong noun, and D-057 exists precisely to prevent that write | A wrapper per module, and one more lint rule to maintain. A cruder rule banning `prisma.<model>` outside its owning module can ship first | `05-technical.md` §3.1 |
| D-126 | **One audit event per aggregate write, not per row** — one event for a group attendance registration, not thirty | `AuditEvent` is a tamper-evident hash chain whose appends serialize on a Postgres advisory lock. Thirty chained rows in one transaction contend globally against every other audit writer in the instance. The p95 target was set without knowing the lock exists | Per-student attribution comes from the attendance events themselves, which are append-only and carry the actor; the audit event covers the registration as an act | `05-technical.md` §5, `00-…` §4.1 |
| D-127 | Object storage is out of v1. Assets live on a mounted filesystem path and are captured inside the encrypted backup archive; volume-level redundancy is the operator's choice | `blob-storage.ts` supports only `"local"` and throws otherwise; there is no S3 client in `package.json`. "Versioned, replicated" was a managed-cloud assumption stated as *our policy*. A scheduled push to a bucket would also be an exfiltration channel for children's data with none of D-042's controls | An operator wanting off-host asset redundancy syncs the volume themselves. Fewer long-lived credentials in the settings store | `07-operations.md` §2, `05-…` §1 |
| D-128 | Breach response is a **v1 capability**: a "what did this account do" audit report, an active-session inventory with global revocation, delivery for high-severity events, and an incident checklist | The controller must assess and notify within 72 hours (Art. 33) and notify subjects for high-risk breaches (Art. 34). This is health data about children, so the Art. 34 threshold is met by default. The design shipped an audit trail and a metrics list and stopped — none of the three questions a breach requires could be answered | Development time in v1 for a capability nobody wants to use. The alternative is a swim school with no security staff improvising under a legal deadline | `07-operations.md` §1.4, R-37 |
| D-129 | Print fallbacks (class list, exam candidate list) ship in v1 as **minimum viable parity**, not as a convenience | The incumbent is paper, and **paper never has a zero-percent day**: a wet sheet is legible, a forgotten sheet is reconstructed from memory, a broken pen is replaced. An application that will not load shows nothing and the instructor has no move. P-02 ("offline prepared, not built") is defensible only because this exists | Half a week that buys no new capability — it buys the failure mode | `04-ux.md` §4.0, R-35 |
| D-130 | The MFA mandate and the security alert rules bind to **permissions**, never to role names | `platform.super_admin` does not exist (D-056), so an alert on it never fires and gives false assurance. "Organisation administrator roles" is not a checkable predicate either — roles are user-definable. A named high-risk permission set is both | The set must be maintained as permissions are added, and adding a permission to it is a security-relevant change requiring review | `07-operations.md` §1.3, `02-…` §1.2 |
| D-131 | An instructor holds a **bounded self-correction window** on their own sign-offs from the current session; beyond it, `skills.revoke` applies unchanged | As written there were two states — free undo before Save, permissioned revoke after — so a mis-tap on a 30 × 40 grid with wet hands required an administrator. That is a guaranteed weekly interruption produced by correct-looking design | A narrow window in which a sign-off can be withdrawn without the revoke permission. It is audited, writes a superseding event, and cannot touch another person's sign-off or an earlier session | `04-ux.md` §4.2 |
| D-132 | The WebAuthn RP ID is set **deliberately at setup**, changing it warns loudly, and every account retains a password + TOTP fallback | Starting on `http://nas.local:3000` and moving to a real domain is the **expected** path for this deployment, not an edge case — and changing `APP_URL` invalidates every passkey at once | A fallback factor per account is one more thing to enrol and one more credential to protect. Total lockout is worse | `04-ux.md` §4.0, `07-…` FM-15 |
| D-133 | For a **withdrawn or superseded** decision, the register row **is** the authoritative text, and the row says so instead of pointing at a chapter | D-011, D-015, D-027, D-028 and D-029 have no decision statement in any active chapter; their only full text is in chapters 11/12, whose banners forbid citing them. A reader following the register lands in a chapter telling them not to use what they just found. Writing five sections for decisions nobody will implement is worse | Withdrawn decisions are terser than live ones. That is the correct asymmetry | `09-decision-register.md`, `08-…` |
| D-134 | A normative rule is stated **once**, in one section; every other mention points at it and says so | D-037's rule was stated authoritatively in three places and agreed only because all three were edited at once — a pattern that has already produced one real bug in this design set. The same three-place duplication existed for D-047/D-048 and D-040. `13-…` §... already uses the right form: *"The rule … is stated once, in §3.1. It is not restated here."* | A reader wanting the rule follows one pointer. Cheaper than three copies drifting | `00-overview.md` §3.1 (R-13, R-14, R-17, R-18, R-20, R-28) |
| D-135 | Adopt `tests/unit/migration-safety.test.ts` and `person-reference-classification.ts` + `person-reference-sync.test.ts` as they are, rather than re-inventing them | The first already blocks the unsafe `ADD COLUMN … NOT NULL` without a default — the exact class that strands a self-hoster mid-upgrade. The second **is** D-014's "registry with a test asserting every `Person`-referencing table appears in it", already built and bidirectionally checked. The design described the second as something to create | The sync test goes red the moment a domain model adds a `Person` reference without a registry entry. That is the desired forcing function, so it belongs in the Definition of Done rather than being discovered in CI | `05-technical.md` §5.1 |
| D-136 | UAT as a separate environment is out of v1 (revises D-022); **D-023's rule is kept as free policy** — no environment below production ever receives a copy of production data | One person is author, reviewer and acceptor; a third environment between him and himself buys a handover that does not happen. D-022's image-promotion discipline is kept for DEV → PROD, and the template's `deploy-uat.yml` — which runs `docker compose build` **on the target host**, the direct inversion of D-022 — is deleted rather than extended | Bugs that only appear on a production-shaped deployment surface in production. Mitigated by the synthetic generator producing production-shaped volumes | `06-delivery.md` §1 |
| D-137 | The aftest screen does **not** inherit the thirty-second doctrine: criteria default **unset**, set-whole-column requires confirmation, and an aftest is expected to take ten minutes | The design's answer to everything else is "default the common value, make the exception the tap". Pre-filling a passing grade on the assessment that decides whether a child may sit an exam manufactures rubber-stamping and makes the four-eyes control ceremonial | The most consequential data entry in the product is also the slowest. Correct trade | `04-ux.md` §4.7, `15-…` |
| D-138 | The v1 build order is fixed by **cost of doing it late**: crypto envelope → audit chain rotation → scope model → append-only event models → settings → consent → restore fixtures → erasure registry; then repo hygiene → foundation → removals and reshaping → domain modules in DAG order → surfaces | Three of the highest-value mechanisms are the most retrofit-hostile: every encrypted byte written before the envelope must be re-wrapped, the scope model changes the signature of the guard every module calls, and converting a mutable column into an event log after data exists means inventing the history you destroyed | The flagship screen is built late. **Attendance sits on five modules; the instinct to build the demo first produces a flagship resting on stubs** | `06-delivery.md` §5 |

---

## 3. Findings to add

### F-80 — v1 was mis-scoped, not over-scoped
**Severity: high.**
About 45% of specified effort went into a self-hosting *product* — an identity-
provider registry, a restore-from-every-release CI matrix, a settings registry
with a generated UI, a separate UAT environment, a retention engine, a CMS, a
versioned public API and a fifteen-check pipeline — for an operator who does not
exist. Meanwhile six capabilities named as weekly needs were absent from the
documents entirely, one of them the single most consequential control in the
domain. The word "aftest" appeared nowhere in `docs/design/`; neither did "NRZ".

The distinction matters because the obvious remedy is wrong: cutting the design
in half would have shipped the same missing product sooner.

**Response.** D-120. Both estimates are recorded, not just the new one
(`00-overview.md` §3.5.3). OD-2's closure is what makes the cut safe rather than
a gamble, and it is worth noting that OD-2 was open through a whole review round
and distorted it in both directions.

### F-81 — No breach-response capability at all
**Severity: high.**
The controller must be able to assess and notify within 72 hours (Article 33)
and notify data subjects for high-risk breaches (Article 34). This is health
data about children, so the Article 34 threshold is met by default rather than
argued about. The design shipped an audit trail and a list of metrics and
stopped. A swim school could answer none of the three questions a breach
requires: which records did this account touch, which sessions are live and how
do I kill them, whose data was in the artefact that leaked.
**Response.** D-128, R-37, `07-operations.md` §1.4. The third question is
answered honestly rather than solved: the backup manifest holds row counts, not
data subjects, so a leaked archive is treated as covering **every** subject in
the instance at that timestamp.

### F-82 — The design asserted CI capabilities that do not exist
**Severity: high.**
`00-overview.md` §2.1 claimed the template's CI "already runs … container build,
and a migration-against-populated-database job"; `06-delivery.md` §2.1 said "the
template's CI already implements most of this". The actual `ci.yml` has **three
jobs** — `verify`, `e2e`, `migrate-populated`. There is no container build, no
`npm audit` gate, no CodeQL, no secret-scanning job, and no axe assertion
anywhere in `tests/`. Of fifteen required checks, seven existed. The design was
describing a plan in the present tense, which is the failure mode that makes a
whole document untrustworthy.

Compounding it: `deploy-uat.yml` runs `docker compose build` **on the target
host** — building at deploy time rather than promoting an image, the direct
inversion of D-022, and existing behaviour that would have been extended rather
than replaced.

**Response.** Both chapters corrected in place rather than quietly rewritten
(D-136). v1 ships eight blocking checks; everything else is listed below the
line with its honest status, in one place, so the two chapters cannot drift
apart again.

### F-83 — An application that will not load has no equivalent of a wet sheet
**Severity: high.**
The design measured itself against another system. There is none: the incumbent
is a clipboard. Paper never has a zero-percent day — a wet sheet is still
legible, a forgotten sheet is reconstructed from memory, a broken pen is
replaced. An app that will not load shows nothing and the instructor has no
move. And the failure is not recoverable in the usual sense: when paper fails
the instructor blames the rain; when the app fails they go back to paper and do
not come back. Reliability across the first three lessons outweighs any feature.
**Response.** D-129 — print fallbacks in the first release, and P-02's
"prepared, not built" is now explicitly conditional on them. `07-…` FM-14.

### F-84 — The attendance latency target was set without knowing about a lock
**Severity: medium.**
`AuditEvent` is a tamper-evident hash chain whose appends serialize on a
Postgres advisory lock. The domain model requires one transaction per group
registration. At 30 students that is 30 attendance events plus, naively, 30
chained audit rows taken one at a time against a lock contended by every other
audit writer in the instance — under a p95 < 300 ms target written before anyone
knew the lock existed.
**Response.** D-126: one audit event per group registration. **Decide this
before the load test is written**, not after it fails.

### F-85 — The module-boundary lint rule does not catch the violation it exists to prevent
**Severity: medium.**
`no-restricted-imports` catches cross-module *imports*. The violation D-057 was
written to prevent — `prisma.scheduledSession.create()` called from inside
`planning` — imports nothing from `sessions` and passes cleanly. The rule was
checking the wrong noun, and the boundary it claimed to enforce as "a build
failure" was a convention.
**Response.** D-125.

### F-86 — The WebAuthn RP-ID lockout sits on the expected deployment path
**Severity: medium.**
Changing `APP_URL` changes the relying-party id and invalidates every passkey.
Starting on something like `http://nas.local:3000` and moving to a real domain
later is not an edge case for this deployment — it is the **expected** sequence,
and passkeys are the design's best wet-hands answer, so the accounts most likely
to rely on them are the ones most likely to be locked out.
**Response.** D-132. Cheap now; a total-lockout incident otherwise.

### F-87 — The skill-matrix undo boundary requires an administrator for a mis-tap
**Severity: medium.**
Two states existed: free undo before Save, and a permissioned `skills.revoke`
with a mandatory reason after it. A `GROUP`-scoped instructor holds no
`skills.revoke`, so a fat-fingered achievement on a 30 × 40 grid with wet hands
becomes an administrator's job. Weekly, by construction.
**Response.** D-131 — a bounded self-correction window on the instructor's own
sign-offs from the current session.

### F-88 — The Article 15 export discloses third parties and can silently omit health data
**Severity: medium.**
Two defects in one surface. (a) The export includes guardian details, instructor
names on sign-offs, staff-authored notes and audit actor ids — other people's
personal data — with no preview and no redaction pass, while the erasure flow
next door has a mandatory preview. (b) Medical data is omitted unless the
*requester* holds `students.medical.read`, but the entitled party in an
Article 15 request is the **data subject**, not the operator running the export.
A member administrator therefore produces an export that looks complete, is
delivered as the organisation's Article 15 response, and is silently missing the
health data.
**Response.** Reuse the erasure preview pattern for export, including what is
disclosed about third parties; and make the export **fail loudly** rather than
quietly omitting (`04-ux.md` §4.6). This finding is staged rather than fully
resolved: the redaction pass and the retention/recipients/source annex are
chapter 02's to specify.

### F-89 — Five decisions have no statement in any active chapter
**Severity: medium.**
D-011, D-015, D-027, D-028 and D-029 exist only as register rows; their full
text is in chapters 11 and 12, whose banners forbid citing them as requirements.
The register's "Where" column compounds it — D-011 and D-015 point at
`03-deployment-model.md` §1.1, a table that mentions neither, and D-027's
pointer names §1.2 when it appears in §1.3.
**Response.** D-133: for a withdrawn or superseded decision the register row is
the authoritative text and says so. The three wrong pointers should be corrected
or removed at the same time.

### F-90 — Whether a digital pupil list exists has never been checked
**Severity: medium — and it is the cheapest open question in the set.**
CSV import has been described as what makes a pilot possible at all. But the
incumbent is pen and paper, and if the school genuinely runs on paper there may
be **no digital list to import**: entering 100 children by hand is one evening,
and the import path leaves v1 entirely. Most clubs keep a ledger or an Excel for
contributie, so it probably exists — probably is not good enough for a line
item.
**Response.** OD-16. Note that this is a *different* question from OD-1: if both
answers are "nothing", R-29 and the import path leave v1 together.

### F-91 — D-048 was enforced by nothing
**Severity: medium.**
"Migration chains are never squashed within a major version" is the policy that
keeps every self-hoster's old backup restorable, and it was a sentence in a
document. Squashing feels like tidying; the damage is invisible until someone's
restore fails, years later, on a machine we cannot see.
**Response.** D-124.
