I read all 15 chapters and cross-checked every D-/F-/R-/OD-/FM- identifier and section reference with ripgrep. **21 findings**, ranked.

---

# BLOCKERS

## B-1 — `ScheduledSession` ownership: D-057 is contradicted twice in its own chapter
**`01-domain-model.md:120-131` vs `01-domain-model.md:234-239` and `:376`**

> **:120** `**Decision D-057 — `ScheduledSession` is owned by its own `sessions` module.**` … `An earlier draft had `planning` writing the table and `attendance` reading it — "one table, two owners", which violates this document's own isolation rule and would have been the first boundary to erode in practice.`

> **:234** `**`ScheduledSession` is the join point between planning and attendance.** Planning produces sessions; attendance consumes them. One table, two module owners — `planning` writes it, `attendance` reads it and writes `AttendanceRecord` against it. **This is the only shared table in the design and it is deliberate**`

> **:376** `| `ScheduledSession` | groupId, locationId, startsAt, endsAt, status | N `AttendanceRecord` | **Written by `planning`, read by `attendance`** |`

§2.3 states verbatim the design D-057 was written to reject, and calls it deliberate. An implementer reading §2.3/§3.4 builds no `sessions` module and puts the write path in `planning` — the exact "first boundary to erode". D-057 wins (it is in the register, in the module list at `:54`, and is the later decision). §2.3's paragraph and §3.4's Notes column must be rewritten to "owned by `sessions`; `planning` and `attendance` are both consumers".

## B-2 — "All configuration via environment variables" survives as a non-negotiable image property
**`03-deployment-model.md:71` vs `13-configuration-and-setup.md:59,97` and `00-overview.md:248`**

> **03:71** `- **All configuration via environment variables**, documented in one place. No configuration file editing required for a standard install.`

> **13:59** `**Decision D-036 — Configuration lives in the database and is administered in-app behind normal authentication**`
> **00:248 (R-17)** `a database-backed settings registry is the home of all configuration. An application-owned environment variable is permitted **only** when its value must be known before the database can be read`

This is listed under "**Non-negotiable properties of the image**". It is the single sentence most likely to be read as a build instruction, and it inverts the whole of chapter 13. D-036/D-037 win. Replace with "Five bootstrap environment variables (13 §3.1); all other configuration is database-backed and edited in-app."

## B-3 — `SECRET_KEY` has three mutually exclusive lifecycles
**`13-configuration-and-setup.md:84` vs `03-deployment-model.md:64-65` vs `10-findings.md:174`**

> **13:84** `SECRET_KEY        master key for encrypting secrets at rest (§5)` — listed as a **Layer 1 bootstrap environment variable, operator-supplied, restart required**

> **03:64** `- **No default credentials, ever.** Secrets are generated on first run and written to the data volume; the app refuses to start with a placeholder value.`

> **10:174** `the image generates its own secrets on first run so no example value is ever plausible as a real one`

Meanwhile D-040 (`14:52`) makes this key the **recovery token**, displayed once by the setup wizard (`13:270`). Env-var-supplied, self-generated-to-volume, and wizard-displayed are three different implementations with three different failure modes — and this is the key that gates every backup restore (F-24) and every encrypted medical column (D-013). An implementer must not have to guess. Resolution: the app generates `SECRET_KEY` on first run *if unset*, persists it where §3.1 says state lives, and displays it as the recovery token; `03:64` and `13 §3.1` must both say that in the same words, once, in one place.

## B-4 — The data-subject-rights table still specifies the erasure behaviour D-065 declares wrong
**`02-security-privacy.md:476` vs `02-security-privacy.md:497-542`, same chapter**

> **:476** `| Erasure | `person-erasure` transaction: anonymise `Person`, sever pointers, hard-delete special-category data, **retain pseudonymised legal records (D-007)** | …`

> **:497** `**Decision D-065 (replaces D-007)** … **Pseudonymisation is not anonymisation.** … Calling it "no longer identifiable" does not make it so.`

The normative table in §5.5 tells the implementer to do the thing §5.6 (20 lines later) calls a GDPR error, and cites a decision the register marks `**(Superseded by D-065)**` (`09:15`). `04-ux.md:176` repeats it: *"the operator must see exactly which records will be anonymised and which **pseudonymised records will be retained (D-007)**"*. D-065 wins. Both cells must be rewritten to the policy evaluation in §5.6, and **no active chapter may cite D-007 as an instruction** (see also F-9 below).

## B-5 — F-15 is cited as live but exists only in a HISTORY chapter
**`10-findings.md:15`; register skips F-14 → F-16 at `10-findings.md:142,146`**

> **10:15** `**Replaced by F-15** — the same *shape* of risk now lives one level down, in unit- and group-scoped reach filtering.`

`grep -n '^### F-'` on `10-findings.md` returns F-01…F-14, then **F-16**. F-15's only definitions are `11-revision-single-tenant.md:76` and `:108` — a chapter whose banner reads *"Do not implement from it and **do not cite it as a requirement**"*. F-15 is the *replacement* for the highest-severity finding in the original design, so the register currently closes F-01 by forwarding to nothing. Add F-15 to `10-findings.md` between F-14 and F-16, carrying the text from ch. 11.

---

# MAJOR

## M-6 — F-14 is simultaneously closed and "the genuinely dangerous principal now"
**`02-security-privacy.md:630` vs `10-findings.md:142`, `03-deployment-model.md:42`, `12-…:31`**

> **02:630** `| **Operator with fleet deploy rights** | **The genuinely dangerous principal now.** Per-instance credentials in protected environments, required reviewers, all deploys audited — finding **F-14** |`

> **10:142** `### F-14 — **(Closed)** Fleet-operator threat model` / `No principal has access to any customer instance, because no such access exists.`

The same chapter's §6.1 carries the matching residue: `| CI → an instance | Per-instance deploy credentials, short-lived OIDC | GitHub Environments, **one per instance** |` and `| Instance → instance | No operator credential grants access to a second instance |` (`02:613-614`) — deleted at `03:41` (*"Per-instance deploy credentials and GitHub Environments per customer | We deploy nothing but our own dev/demo"*). F-14-closed wins; delete the `02:630` row and rewrite the two §6.1 rows to cover only our own dev/demo deploys.

## M-7 — FM-6 both asserts deleted fleet machinery and has been silently renumbered
**`07-operations.md:97` and `03-deployment-model.md:205`**

> **07:97** `| FM-6 | **Fleet version skew / migration fails mid-rollout** | … | **Waves, bounded skew, halt-on-failure**, per-instance restore (F-13) |`

> **03:39** `| Fleet manifest, **waved rollouts, version-skew monitoring** | We have no fleet |`

Two defects at one anchor. (a) FM-6 prescribes a mitigation chapter 03 explicitly deletes. (b) `03:205` says *"The tenant-in-cache-key hazard (**previously FM-6**) is gone"* — so FM-6 was reused for a different failure mode without updating the back-reference; a reader following it lands on fleet rollouts. Delete FM-6 from `07 §3` (it has no owner in a self-hosted model) and change `03:205` to name the hazard without an FM number. Related: `07:124` *"Sharding is moot: **the fleet is already partitioned** by organisation"* and `06:24` *"what keeps **a fleet of instances** maintainable by one team"*.

## M-8 — `platform.super_admin` is still a normative role in two active chapters
**`02-security-privacy.md:32`, `07-operations.md:57` vs `00-overview.md:391`, `02:242`**

> **02:32** `- **MFA is mandatory** for `platform.super_admin` and organisation administrator roles.`
> **07:57** `**Alert on security signals, not just uptime:** … any `platform.super_admin` use`

> **00:391** `**There is no platform super administrator.** Earlier drafts carried one from the multi-tenant design. **It is removed: there is no platform.**`
> **02:242** `**There is no platform super administrator, and no platform.**`

Chapter 00's approval note (`00:29`) explicitly claims this residue is gone. It is not: an implementer wiring MFA enforcement reads `02:32` and creates the role, and an operator wiring alerts reads `07:57` and alerts on a permission namespace `01:83` says was deleted. Same class, one more instance: `02:531` — *"Each policy is configurable by the organisation **within a platform maximum**"* (there is no platform to set a maximum). All three should read "instance administrator" / drop the cap.

## M-9 — The attendance entity has two names; the aggregate boundary uses the wrong one
**`01-domain-model.md:377` vs `:209`, `:237`, `:449`**

> **:377** `| **`AttendanceEvent`** | sessionId, studentProfileId, state, … `supersedesEventId?` | **Append-only.** …`
> **:209** `├──< ScheduledSession ──< **AttendanceRecord** >── StudentProfile`
> **:449** `| Session attendance | `ScheduledSession` | All its **`AttendanceRecord`** rows — **one transaction per group registration** |`

D-061 makes append-only, superseding *events* a data-integrity requirement. The ER diagram and the transaction-boundary table — the two places a schema author actually copies from — name a `Record`. `AttendanceEvent` wins (it is the D-061 entity, and `04:111`/`00 P-02` depend on `clientEventId` on it). Rename all three occurrences.

## M-10 — `PersonRelationship` is defined twice, with different fields, and one row is orphaned
**`01-domain-model.md:295` and `01-domain-model.md:331`**

> **:295** `| `PersonRelationship` | type (`GUARDIAN_OF`, `EMERGENCY_CONTACT`), fromPersonId, toPersonId, validFrom, validTo?, **evidence?** | Person ↔ Person | **v1.** Records the claimed authority *and how it was established* — see D-063 |`

> **:331** `| `PersonRelationship` | type (…), fromPersonId, toPersonId, **authority**, validFrom, validTo? | Person ↔ Person | **v1.** `authority` records whether this relationship may consent on behalf of the subject (R-04). Every change audited |`

Neither row is complete: `:295` omits `authority`, `:331` omits `evidence` — and **both fields are load-bearing**. D-063 (`02:435`) requires `authorityEvidenceId? → PersonRelationship`, and F-02 (`10:22`) requires the `authority` flag. Additionally `:331` is a stray table row sitting in prose *after* D-060, outside any table, so it renders as a broken line. Merge into one row at `:295` carrying `type, fromPersonId, toPersonId, authority, validFrom, validTo?, evidence?` and delete `:331`.

## M-11 — F-08's resolution contradicts D-059
**`10-findings.md:81` vs `01-domain-model.md:297-313`**

> **10:81** `**Response.** Reuse the profile and model the gap with **`leftAt`** / a new enrolment.`

> **01:297** `**Decision D-059 — Leaving and returning is modelled with periods and lifecycle events, **never by creating a second profile or flipping a status**.** … A status flag, meanwhile, silently destroys the answer to "when were they a member?"`

`leftAt` is exactly the status column D-059 forbids. F-08 is stale text from before D-059 existed. D-059 wins; F-08's response must read `MembershipPeriod` + `StudentLifecycleEvent`.

## M-12 — The prototype-import requirement is cited as R-20, which is a different requirement
**`00-overview.md:211-212` vs `00-overview.md:251,260` and `08-open-decisions.md:20`**

> **00:211** `If real data exists, a one-time export/import path becomes a v1 requirement **(R-20)** rather than an assumption.`

> **00:251** `| **R-20** | **Migrations and upgrades** — automatic forward-only migration on start … |`
> **00:260** `| R-29 | *Conditional on OD-1:* one-time import path from the existing prototype |`
> **08:20** `a one-time export/import path becomes requirement **R-29**`

`R-20` is wrong; `R-29` is correct and is used correctly in the other two places. Fix `00:211`.

## M-13 — The blocking CI gate has two different names, one of them the deleted tenancy concept
**`06-delivery.md:68,191` vs `02-security-privacy.md:314` / D-032**

> **06:68** `| **Organisation isolation tests** | Yes | Dedicated suite; a module without them fails DoD |`
> **06:191** `tests → docs are all present; **isolation tests** exist;`

> **02:314** `**Decision D-032 — Scope-escape tests are mandatory per module.**` … `Deleting the tenancy tests without replacing them would trade a tested boundary for an untested one.`

"Organisation isolation" is the *old tenancy* suite name — the one D-032 exists to replace. A team building the CI gate from chapter 06 writes cross-organisation isolation tests, which in a single-org instance are vacuous, and never writes the scope-escape suite that is now the primary internal control (`02:621`, `10:117`). D-032's name wins; rename both.

## M-14 — "Software targets — verified in CI" is false for most of the table
**`00-overview.md:313-327` vs `06-delivery.md:61-77`**

> **00:313** `### 4.1 Software targets — **verified in CI** on the reference deployment`
> rows: `Load test in CI against a seeded instance` · `Query-count assertion in CI` · `Playwright trace budget` · `Lint rule + missing-key check` · `contrast validated at save time`

Chapter 06's blocking-checks table — the authoritative list of what CI runs — contains **none** of these: no load test, no query-count assertion, no trace budget, no i18n key check, no contrast job. Only the restore matrix, axe-in-E2E, `npm audit` and secret scanning are actually listed. The table even contradicts its own header on the last row: *"Resource footprint | … | **Documented and measured** on the reference deployment"* — not CI. Either add the five jobs to `06 §2.1` or retitle §4.1 to "targets, and how each is checked" and mark the unimplemented ones as required additions. As written, a reader believes performance is gated. It is not.

## M-15 — The trust-boundary diagram omits `EXAM_SESSION`, the scope D-054 was written to add
**`02-security-privacy.md:584` vs `:148,175` and D-054**

> **:584** `│   ORGANIZATION ▸ UNIT ▸ GROUP ▸ COURSE ▸ SELF ▸ RELATED         │`

> **:181** `**Decision D-054 — `EXAM_SESSION` is a first-class scope type; there is **no "scope-like" access that lives outside the enum**.**`

Six of seven. The one omitted is the one protecting a child's diploma outcome from an external examiner's over-broad grant (`00:415`, D-052). Add `EXAM_SESSION` to the Boundary-2 diagram.

## M-16 — `RELATED` is v1 in one chapter, v2 in another, and grantable in the v1 starter-role table
**`00-overview.md:245` vs `02-security-privacy.md:150` vs `02:240` vs `00:269`**

> **00:245 (R-14, "Build now — v1")** `Scoped permission authorization (`ORGANIZATION` / `UNIT` / `GROUP` / `COURSE` / `EXAM_SESSION` / `SELF` / **`RELATED`**), deny by default`
> **02:150** `| `RELATED` | Persons the holder is related to | Guardian → their children **(v2 portal, table exists in v1)** |`
> **02:240** `| Guardian | **`RELATED`** | Consent on behalf of their child **(v1)**; portal access deferred |`
> **00:269 (P-04)** `only the login surface and **its `RELATED` scope axis** are deferred (OD-5)`

R-14 mandates building the axis in v1; P-04 and OD-5 (*"Do not build the scoping axis speculatively"*) defer it; the v1 starter-role catalogue ships a role that uses it. Pick one — P-04/OD-5 are the reasoned position, so R-14 should list six scope types with a note that `RELATED` is enum-reserved and unimplemented, and the Guardian row in `02 §2.4` must say the same.

## M-17 — Environment table says configuration is per-environment env vars
**`06-delivery.md:13` vs D-036/D-037**

> **06:13** `| Config | **Env vars per environment** | Same as PROD shape | — |`

Same defect class as B-2, in the table an implementer uses to set up DEV/UAT. Should read "bootstrap env vars per environment; all runtime settings database-backed (D-036)".

## M-18 — Register "Where" column points at sections that do not contain the decision
**`09-decision-register.md:19,23,35`**

> **09:19** `| D-011 | **(Withdrawn)** No platform-support role restriction needed | … | `03-deployment-model.md` **§1.1** |`
> **09:23** `| D-015 | **(Withdrawn)** No subdomain tenant resolution | … | `03-deployment-model.md` **§1.1** |`

`03 §1.1` is a six-row table titled "What this deletes — again". `grep -n 'D-011\|D-015' 03-deployment-model.md` returns **nothing**. D-027's pointer (`§1.2`) is also wrong — it appears at `03:81`, in §1.3. More broadly, **D-011, D-015, D-027, D-028 and D-029 have no `**Decision D-xxx —**` statement anywhere in an active chapter**; their only full statements are in HISTORY chapters 11/12, which the banners forbid citing. Either state them in chapter 03 or mark the register row as the authoritative text.

## M-19 — Backup policy specifies an object-storage tier that does not exist in the product
**`07-operations.md:73` vs `13:85`, `14:71`, D-033**

> **07:73** `| Object storage | **Versioned, replicated** |`

The shipped artifact is one app image plus Postgres (D-033); assets live on a filesystem path (`13:85` `DATA_DIR   uploads/assets path`) and are backed up *inside* the `.stbak` archive (`14:71`). "Versioned, replicated" is a managed-cloud assumption from the hosted design, and it is stated as our policy rather than as operator guidance. Replace with "included in the encrypted backup archive (14 §3.1); volume-level redundancy is the operator's choice."

## M-20 — OD-12 cites D-007 for a claim D-007 never made
**`08-open-decisions.md:189`**

> **08:189** `treat certificates as portable signed artefacts from the start (they are already immutable, numbered records — **D-007**)`

D-007 was *"Erasure severs identity; retained records survive pseudonymised"* — superseded, and never about certificate immutability. The supporting decision is D-062 / `01 §3.5` (`Certificate` issued against a specific result, revoked-and-reissued, never edited). Also note `00:274` promises `P-09 | Portable certificates … | Certificates are immutable numbered records, signable later (OD-12)` — that chain currently routes through a withdrawn decision.

## M-21 — The flagship performance target is stated at two different group sizes
**`04-ux.md:94` vs `00-overview.md:88,317`**

> **04:94** `**Target: under 30 seconds for a group of ~12, on a tablet, with wet hands.**`
> **00:88** `register attendance and sign off a skill for **a whole group** in under thirty seconds`
> **00:317** `| Attendance write latency | p95 < 300 ms server-side **for a group of 30** |`

The product thesis and the NFR both size a group at 30; the UX chapter — which owns the interaction design that must hit the target — sizes it at 12. Thirty taps versus twelve is a different screen. `00` wins (it is also the size used for the skill matrix at `00:318` and `07:120`); fix `04:94`.

---

# MINOR — edit artifacts that change meaning

**`02:215-216`** clause duplicated mid-sentence: *"means there is **one place to get list filtering right — one place to get list filtering right**, which is the boundary that actually exists"*.

**`02:311-312`** ungrammatical merge of two claims, losing the DoD rule: *"These replace the old **scope-escape suite is non-optional** for Definition of Done."* Should read "…replace the old tenancy suite, and are non-optional for Definition of Done."

**`01:259-260`** *"`id`, **`id`**, `createdAt`, `updatedAt` are implied on every entity"* — `id` listed twice; the second was presumably `organizationId`, removed by D-006 and correctly deleted, leaving a duplicate.

**`13:275`** `**`PlatformBootstrap`** is the template's existing enforced-singleton first-run record, **reused unchanged**` — retains the `Platform` prefix that D-056/`01:82-83` deletes alongside `PlatformSettings` and `PlatformRoleAssignment`. Rename or state explicitly why this one keeps the namespace.

**`08:18-19`** OD-1 status is self-cancelling: *"**Status: BLOCKING, confirmed by Jack (2026-08-31).** No destructive action is taken … until this is answered."* — confirmed *and* unanswered. `00:209` reads *"**Condition — not yet satisfied.**"* Say which.

**`06:112`** example branch `docs/151-adr-subdomain-tenancy` — subdomain tenancy is D-015, withdrawn.

---

## Structural note for the requester

The D-037 duplicate-normative bug that was already fixed is **still structurally present**: D-037's rule is stated authoritatively in three places — `00:248` (R-17), `09:45` (register), `13:97-113`. They agree today only because all three were edited at once. `13:143` shows the right pattern (*"The rule governing what may live in the environment is stated once, in §3.1 (D-037). It is not restated here."*) and should be applied to R-17 and the register row, which should point at 13 §3.1 rather than restate the criterion. The same three-place duplication exists for D-047/D-048 (`00:259` R-28, `06:71`, `14:179-203`) and D-040 (`00:249` R-18, `09:48`, `14:33`).