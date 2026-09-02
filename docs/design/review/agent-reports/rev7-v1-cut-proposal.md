# rev7 — ranked v1 cut proposal

**Status: proposal. Read-only on the design chapters — nothing here is applied.**

**Base.** `design/architecture-phase`, chapters `00`–`10`, `13`, `14`, `15`.
Chapters 11/12 read as history. Inputs: `rev7-realism.md`, `rev7-build.md`,
`rev7-consistency.md`, `rev7-security.md`, `report-realist.md`,
`report-realist-round2.md`.

---

## 0. The target this proposal is cut against

Jack, 2026-09-02:

> "Currently I want it functional for my own swimschool and once we have V1
> functional I'll go to public V2."

**v1 has exactly one deployment, operated by its own author, at his own club.**
The repository stays public and stays AGPL-3.0 (D-067). What moves to v2 is not
openness — it is the obligation to be **installable and operable by a stranger**.

Three further decisions taken the same day, and what each does to scope:

| Decision | Effect on v1 |
|---|---|
| **OD-18 closed** — SplashTrack takes over membership administration eventually; the incumbent is member administration only; **no integrations in v1**, the only ingress is a **bulk CSV import** from the incumbent's export | Refutes the *premise* of rev7-realism R-11 (which argued against contribution tracking because the incumbent stays authoritative). The verdict survives on a different ground — see **A-1**. Promotes the importer (R-29/D-157) from a convenience to the only way pupils enter the system — see **C-2** |
| **SportLink** — mandatory only for competition-swimming and water-polo members, explicitly out of v1, noted for v2 | No v1 cost. Recorded so nobody designs an integration seam for it |
| **F-44 dissolved** — no NRZ catalogue is seeded; **an administrator authors the skill/criterion list and its links to certificates and diplomas inside the application** | Removes a blocker (`15-…` §9 item 2) and D-083's seed-and-fork machinery (−0.25 w). **Adds a catalogue-authoring surface that is in no estimate** (+1.5 w) — see **C-3** |
| The realism reviewer re-estimated the current scope at **~55–70 engineer-weeks** against a stated 18–20 | §3.5.3's `~18–20` is treated as **refuted** throughout this document. So is B-18, independently, from the model count |

**The cost baseline used here** is rev7-realism R-1's reconstructed line-item
table — the only line-item table anyone has produced against the post-§3.5
scope. It totals **~55 engineer-weeks before** the 20–30% integration/rework
uplift that both realist rounds apply, and **~66–72 after**. Every number below
is a delta against that table, stated pre-uplift; the uplift is applied once, at
the end.

**Two failure modes, named, because they pull in opposite directions.** An
over-large v1 that never ships is one. A v1 too thin to run a real Tuesday
evening is the other — and after §3.5 the design is *already* on the thin side
of the second one: **nothing in this design set creates a lesson** (R-2). List A
does not get to spend the money List C needs.

---

## A — CUT FROM v1 (moves to v2)

Ranked by weeks saved. **Total: ~11.0 engineer-weeks.**

Reversibility uses two words with fixed meanings:
**reversible** = can be added in v2 against data that already exists, with no
migration through live rows and no rewrite of a signature every module calls.
**retrofit-hostile** = cutting it now costs more later than building it now.
Nothing retrofit-hostile appears in this list; that is List B.

---

### A-1 — Contribution / membership-fee tracking. Ship **exam fees only** · **1.5 w**

**What it is.** `15-assessment-and-fees.md` §6.2's periodic `MembershipPeriod ×
Enrolment` charge-generation job, the membership `FeeType`, the payer-level
balance view spanning two fee kinds, and the idempotency discipline that
periodic generation needs. Lives in **R-32** (`00-…` §3.1), **D-088**,
`15-…` §6.1–6.2, `04-ux.md` §1 and §3 (Fees nav section and its three-level page
hierarchy), `01-domain-model.md` §1.1 (`fees` as a v1 module).

**What ships instead.** `FeeType`, `Charge`, `Payment`, the **exam-fee event**
(**D-089** — a charge is created by an `ExamCandidate` reaching `CONFIRMED` and
at no other time), a per-child balance, and the CSV export (**D-091**: still no
document headed *Factuur*).

**Where I disagree with the input, and why.** rev7-realism **R-11** reached this
verdict from a premise that **OD-18 destroyed today**: it argued the incumbent
stays authoritative, so contribution tracking *creates* the dual entry it exists
to prevent. OD-18 closed the other way — SplashTrack takes over. So R-11's
reasoning no longer holds and the verdict has to be re-earned.

It is re-earned by the new target, not the old one. v1 is **one club for one
season, operated by its author**, and the incumbent is still running and still
does contributie correctly. Dual entry across two systems both run by the same
person for one season is an annoyance; it is not the abandonment risk that
sentence in `00-…` §3.5.2 describes, which is about a *school* maintaining two
systems indefinitely. Contribution tracking is the half the incumbent already
does; the exam fee is the only money in this domain SplashTrack originates.

**What Jack loses.** Contributie stays in the incumbent for one more season. He
cannot see "what does this family owe in total" in SplashTrack.

**Reversible.** Yes, and cleanly: the three tables ship, **D-092**'s financial
retention ground and pseudonymisation ship with them (an exam fee is a fiscal
record too), **D-093**'s seam is untouched. v2 adds a fee type and a generation
job against a schema that already exists.

---

### A-2 — Release engineering and operator documentation *for strangers* · **1.5 w**

**What it is**, itemised, because "self-hosting for strangers" is a theme and
this is the half of it that lives in the release pipeline:

- signed container images, published **SBOM**, **provenance attestation** — **R-22** (`00-…` §3.1), `03-deployment-model.md` §3 (*Supply chain*), **F-18**;
- GitHub Security Advisories, `SECURITY.md` with a disclosure address and a **response commitment** — `03-…` §2, §3;
- release notes *"written for an IT generalist, not for us"* — `03-…` §2;
- the install guide, the upgrade runbook, **`14-…` §6.2 "Never strand a self-hoster"**, the quarterly restore-drill documentation (`00-…` §4.3), **OD-15**'s minimum-operator-skill-level analysis.

**What stays** (hours, not weeks): `LICENSE` (AGPL-3.0, D-067), pinned
dependencies + Dependabot + the `npm audit` gate (F-18's cheap half),
`CONTRIBUTING.md` with the **DCO sign-off** (**F-28**) — that one is genuinely
retrofit-hostile in the relicensing sense and costs an afternoon — a `README`,
and a one-page runbook Jack writes for himself. Tag-only release from `main`
(**D-024**) and image **promotion** rather than build-on-host (**D-022**) stay:
they are discipline, not artefact production, and D-022 is what makes "what was
accepted is what ships" true on one instance too.

**What Jack loses.** The first public image is unsigned and has no SBOM. A
stranger who finds the repository cannot install it without reading the source.
That is the accepted v1 position, stated out loud.

**Reversible.** Yes. Signing, SBOM and provenance are workflow additions with no
data component. The one asymmetry: **v1.0's image can never be retroactively
signed**, so v2's first signed release is the earliest verifiable artefact.
Nobody is relying on v1.0's signature, because nobody but Jack runs v1.0.

---

### A-3 — The setup wizard as a web surface. Bootstrap from the CLI instead · **1.25 w**

**What it is.** `13-configuration-and-setup.md` §6.3 and **R-16**: the
unauthenticated `/setup` surface that creates the organisation and the first
administrator, forces MFA, offers restore, and self-destructs — plus everything
built to make an unauthenticated administrative surface safe: **D-039**'s
self-destruct, **D-099**'s four-row emptiness gate and the **`TAMPERED`** state
that refuses to serve, **D-101**'s filesystem-delivered single-use setup token
with its ≤60-minute expiry and `setup:token --new` reissue, and the WebAuthn
RP-ID-at-setup ceremony (**D-132**).

That apparatus exists because *"first run is the one moment no account can
exist"* — for an operator who has a browser and no shell. **Jack has a shell.**

**What ships instead.** `splashtrack setup:init` in the break-glass CLI
(`13-…` §7, **R-19**), which already has to exist for lockout recovery and MFA
reset, and which **D-141** already names as the recovery path from an
authentication misconfiguration. One command, host-access-proven, no
unauthenticated surface at all — which is strictly *better* security, not a
concession.

**What stays** — and this is the part that must not be swept up with it:
the **boot-state predicates** (**D-098**: `EMPTY` / `AHEAD` / `FAILED` /
`PARTIAL` / `EXISTING` / `CURRENT`) and **D-046**'s restore-then-migrate order.
Those are *data-safety* code, not onboarding code — they exist so an eager
`migrate deploy` does not destroy a restore in progress. See **B-11**. The
`InstallationBootstrap` record (**D-100**) also ships, so the wizard has its gate
waiting for it in v2.

**What Jack loses.** He types a command instead of filling a form, once.

**Reversible.** Yes — a wizard on top of an existing CLI bootstrap is additive.

---

### A-4 — Breach-response tooling (R-37 / D-128) · **1.0 w**

**What it is.** `07-operations.md` §1.4: the "what did this account do" audit
report, the active-session inventory with **global revocation**, notification
delivery for high-severity events, and the incident checklist.

**What stays.** The **checklist** — a markdown file, hours of work, and the part
that actually gets used under a 72-hour deadline. The audit trail it is worked
from stays in full (**B-3**, **B-4** below). Session revocation for one club is
`DELETE FROM "Session"` by the person who owns the box.

**Where I disagree with the design.** **D-128** justifies this as *"a v1
capability"* because Articles 33/34 thresholds are met by default for children's
health data. That is right about the **duty** and wrong about the **product
feature**. The duty is to assess and notify; it is discharged by a documented
procedure and a queryable audit trail, both of which ship. A swim school of ten
staff accounts does not need an inventory UI to know which sessions to kill.

**What Jack loses.** An incident is worked by hand from the audit log with
`psql`, under time pressure, by the one person who knows the schema — who is
also the person who would have built the report.

**Reversible.** Yes. Every item is a read-side report over data that already
exists; none of it changes a schema.

---

### A-5 — The design-system and WCAG programme beyond axe on the flagship screens · **0.75 w**

**What it is.** From `00-…` §4.1's *Required addition* rows and `04-ux.md` §5.3:
save-time contrast validation *"with the nearest passing shade offered"*, the
Playwright **browser matrix** (last 2 versions × 4 browsers), the **Playwright
trace budget** for page-interactive, and the i18n missing-key check.

**What stays.** WCAG 2.2 AA as a build discipline, **axe in E2E on the four
poolside screens** (attendance, skill matrix, session detail, student find), and
a plain contrast **warning** at save time. Bootstrap is inherited and already
token-themed (**D-019**), so the design system itself is not the cost here.

**What Jack loses.** Accessibility is asserted where it matters and gated
nowhere else; brand colours can be set to an unreadable pair with a warning
rather than a block.

**Reversible.** Yes — every item is a CI job.

---

### A-6 — The audit trail as a product **surface** (D-026, `07-…` §1.2) · **0.75 w**

**What it is.** The in-app audit browser with its own filtering, pagination,
authorization and performance profile — *"the audit UI becomes a real product
surface"* is D-026's own trade-off column.

**What stays, undiminished.** The `AuditEvent` hash chain itself, the
`INSERT`-only database role with `UPDATE`/`DELETE` revoked, the hard retention
floor, `splashtrack audit:verify` (all **D-149**), and one audit event per
aggregate write (**D-126**). See **B-3**.

**Why the surface and not the trail.** D-026's reason is that the organisation
is the controller and *"cannot demonstrate accountability on evidence only the
processor can see"*. In v1 the controller, the operator and the developer are
the same person, with database access. Article 5(2) accountability requires the
records to exist and be producible, not to be browsable in a web page.

**What Jack loses.** He queries the table instead of filtering a screen.

**Reversible.** Yes — a read-side view over an append-only table.

---

### A-7 — The performance gates (`00-…` §4.1 *Required addition* rows) · **0.75 w**

**What it is.** The attendance-write **load test** (p95 < 300 ms for a group of
30), the **query-count assertion** for the 30 × 40 skill matrix, the
**container cold-start test** (< 60 s including migrations), and the resource-
footprint measurement.

**What stays.** The *design rules* these gates protect, all of which are free
and none of which is a test: one audit event per group registration (**D-126** —
and `00-…` §4.1 already flags the p95 target was set without knowing the
advisory lock exists), no N+1 on the matrix, stateless app processes (**P-08**).
Measure all four **once, by hand, against a seeded instance before go-live**,
and write the numbers down.

**What Jack loses.** A regression in attendance latency is found by an
instructor rather than by CI.

**Reversible.** Yes — these are CI jobs against a seeded database.

---

### A-8 — `splashtrack key:rotate` and master-key rotation · **0.75 w**

**What it is.** `13-…` §5.3's resumable per-column re-wrap pass, and **D-114**'s
rotation half (*"rotation re-wraps the master key"*).

**What stays — and this is the important half.** The **envelope format** itself:
`<version>:<keyId>:<nonce>:<ct>` with AAD binding `(table, column, primary key,
keyId)` (**D-096**), the `DECRYPTORS` registry with `CURRENT_FORMAT` and the
committed golden-vector test (**D-097**, **D-049**), the two-level wrap for the
**backup archive** (**D-114**'s per-archive data key), and **D-113** (key
material never inside the archive). These are build-order item 1 and they are
retrofit-hostile — see **B-1**. Rotation is not: it is an operator *lifecycle*
capability for a key nobody has yet had reason to rotate.

**Two build defects that must be fixed while the envelope is being written
anyway, at no extra cost:** **B-20** — call the new format **`v2:`**, because
the inherited `identity` and `notifications` secret-crypto files already ship a
*different* four-field layout tagged `v1`, and a registry keyed on the version
tag cannot tell them apart. **B-12** — bind AAD to a **stable logical column
identifier**, not the physical table/column name, because D-159, D-100 and D-056
all schedule renames of encrypted tables and columns and an AAD failure is
indistinguishable from corruption.

**What Jack loses.** If `SECRET_KEY` is ever exposed, re-keying is a scripted
job written at that moment rather than a shipped command.

**Reversible.** Yes — *provided* the `keyId` field ships in the envelope from
the first encrypted byte, which it does. Without the `keyId` this would be
retrofit-hostile; with it, rotation is a batch job written later.

---

### A-9 — The `COURSE` scope type · **0.5 w**

**What it is.** One of six scope types in `02-security-privacy.md` §2.1/§2.2.
**R-18** established that it has **no v1 holder that `SESSION` does not cover**:
D-068 moved the external examiner and the aftest assessor to `SESSION`, leaving
`COURSE`'s only holder as *"Internal examiner | `COURSE`, time-bounded"* — and
§2.2 shows `COURSE` covers *"that course, its levels, its enrolments, and **all**
its exam sessions"*, which is exactly the over-grant D-068 rejects one page
later. It is also absent from `06-delivery.md` §2.1's mandatory scope-escape
test table, along with `SELF`.

**What ships instead.** `ORGANIZATION | UNIT | GROUP | SESSION | SELF`. An
internal examiner gets `SESSION` per exam session — which is how an exam day
works anyway — or `ORGANIZATION` if they coordinate.

**What Jack loses.** Nothing he has asked for.

**Reversible — with a named caveat.** **D-147** makes `Reach` an opaque branded
discriminated union with one variant per scope type, deliberately so that adding
a variant is *"a compile error in every repository at once"*. Re-adding `COURSE`
in v2 is therefore a mechanical sweep of every repository. That is the good kind
of cost and it is exactly why cutting the variant now is safe: the compiler will
not let v2 forget one.

**Independent of the cut, and not optional:** add `SELF` (and `COURSE` while it
exists) to `06-delivery.md` §2.1's scope-escape table, or the most important
gate in CI is partial in the place its guarantee is asserted to be total.

---

### A-10 — EN localisation. Ship NL only · **0.5 w**

**What stays.** `next-intl` with `defaultLocale = "nl"` (inherited, verified in
rev7-build's true-claims table), the **no-hardcoded-strings** lint rule, and
**P-05**'s locale discriminator on content tables.

**What Jack loses.** An English-speaking instructor reads Dutch. At his own club
that is nobody.

**Reversible.** Yes — adding `messages/en.json` later is translation, not
engineering, precisely because the lint rule shipped.

---

### A-11 — The diagnostics page as a support tool (R-21, `13-…` §8, D-156) · **0.5 w**

**What it is.** The page rendering effective configuration with **value
provenance**, connectivity checks, migration state, backup age, version and
advisory status, with the *"safe to paste into a public issue"* property.

**What stays.** The **backup-age warning on the dashboard** (**D-041**) — that
one is load-bearing and it is not part of this cut: *"an operator who wrongly
believes they have backups is worse off than one who knows they have none"*, and
it is the only signal that a scheduled backup silently stopped. Also stays:
**D-104**'s diagnostics warning when backup retention exceeds the shortest
special-category retention — as a start-up log line rather than a page.

**What Jack loses.** He reads logs and runs `psql` instead of loading a page.
The *reason* the page exists is producing an artefact for a **third-party
support conversation** (D-156's own trade-off names the volunteer producing it),
and in v1 there is no third party.

**Reversible.** Yes. `diagnostics.read` stays in the permission catalogue so the
page has its key waiting.

---

### A-12 — GDPR subject-rights as a CLI, not a self-service admin screen · **0.5 w**

**What it is.** `04-ux.md` §4.6's *"Fulfil a GDPR request"* workflow as a
screen — the request intake, the preview UI, the packaging and delivery flow.

**What stays, in full, because none of it is UI.** The **D-014** erasure
registry and its one-transaction erasure; the inherited
`person-reference-classification.ts` + `person-reference-sync.test.ts`
completeness test (**D-135**, minus its hard-coded column floor — **B-1**);
**D-154**'s `erase` / `exempt(ground, until)` entry kinds; **D-153**'s substance
— the export **refuses** rather than omits when a class is unreadable, redacts
third parties per relation, reuses the erasure preview, and ships the generated
annex of recipients, retention periods and source; **D-155**'s definition of
`ANONYMISE`. All of that is logic and it all ships. Only the screen goes.

**What Jack loses.** A subject access request is fulfilled by running a command
and reading its output, at a volume of roughly zero to two a year.

**Reversible.** Yes — the screen is a wrapper over commands that exist.

---

### A-13 — The public course-catalogue page · **0.5 w**

**What it is.** The already-reduced remnant of **R-12** / **D-017** — the
public-facing catalogue of courses and levels (`03-deployment-model.md` §5.2).

**What stays.** The **inquiry form** and the `Inquiry` table, because that is the
waiting list's ingress (**R-33**, **D-051**) and the waiting list is the front
door; the **branding tokens** (**D-016**, inherited and closed-set); **D-051**
enforced as the lint rule *"`(public)` never imports a person repository"*.

**What Jack loses.** The club's existing website keeps carrying the course
descriptions. Enquiries arrive at one public route instead of at the bottom of a
catalogue page. If even that is too much, waitlist entries can be created by an
administrator from a phone call — but the form is two days and it removes a
transcription step, so I would keep it.

**Reversible.** Yes.

---

### A-14 — The version check and in-app advisory warning · **0.25 w**

**What it is.** **D-034** / `03-…` §2.1: the outbound fetch of the advisories
file, the opt-out setting `update.check.enabled`, the in-app administrator
warning, and **F-131**'s disclosure analysis of what the request leaks.

**Why it goes.** Its entire justification is **F-17** — *"unpatched self-hosted
instances are the single biggest residual risk"*. In v1 there is one instance and
its operator is the person who cuts the releases. He knows what he shipped.

**A consequence worth banking.** **D-142** requires one shared egress-controlled
client because *"four admin-controlled server-side fetch surfaces exist — OIDC
discovery, SMTP test-send, backup destination endpoint, version check"*. OIDC
discovery went with the IdP registry (already cut), the backup destination is
mounted-volume-only in v1 (**D-103**), and this removes the fourth. **The shared
client ships with exactly one call site — SMTP test-send.** Keep the client:
it is the right shape, it is cheap at one call site, and v2 restores three.

**Reversible.** Fully.

---

### Already cut in `00-…` §3.5.1 — reconfirmed, **0 additional weeks**

Listed so the accounting is not double-counted and so the "self-hosting for
strangers" theme is itemised end to end. The new target makes every one of these
unarguable rather than merely defensible:

| Item | Where | Note under the new target |
|---|---|---|
| **Multi-IdP registry** (R-15, D-035, D-140) | `02-…` §1.2.1 | No Entra, no Keycloak, no Okta. Also removes D-140's whole account-takeover analysis from the v1 attack surface |
| **Restore-from-every-release CI matrix** (D-047) | `14-…` §4.3.1 | Zero prior releases. **Fixture *generation* still ships** — see B-12 |
| **`UNIT` recursive descendant walk** (D-121) | `02-…` §2.2 | One pool. Flat `UNIT` survives |
| **`SHARED_DEVICE`** (D-009, replaced by D-143) | `02-…` §1.3 | Replaced by a role-scoped idle timeout and an instructor role holding no export permission |
| **CMS beyond a catalogue page + form** (R-12, D-017) | `03-…` §5.2 | And now the catalogue page too — **A-13** |
| **UAT as a separate environment** (D-136, revising D-022) | `06-…` §1 | D-023's rule kept as free policy |
| **Retention *engine*** (D-065's configurable table, dry-runs, per-class confirmation) | `02-…` §5.6 | Constants + one job + the D-014 transaction. **D-066's trigger rule kept** — and corrected, see C-12 |
| **Settings registry with generated UI** (R-17) | `13-…` §3.2 | **B-4** shows chapter 13 still specifies the generated version in full and nothing in it says it is out. Resolve to rev7-build's middle: a hand-written typed registry array carrying `class` and `bounds`, read by a plain page |
| **`/api/v1` + OpenAPI + Swagger** (P-01) | `05-…` §4 | Thin-handler discipline only |
| **The 15-check CI** (R-28) | `06-…` §2.1 | Eight checks. **B-19**: the scope-escape gate must be the *first* Phase-2 deliverable, not a Phase-1 check against a scope model that does not exist yet — otherwise it ships green and vacuous |

---

### List A total

| | Weeks |
|---|---|
| A-1 Contribution tracking (exam fees only) | 1.5 |
| A-2 Release engineering + operator docs for strangers | 1.5 |
| A-3 Setup wizard as a web surface | 1.25 |
| A-4 Breach-response tooling | 1.0 |
| A-5 Design-system / WCAG programme | 0.75 |
| A-6 Audit trail as a product surface | 0.75 |
| A-7 Performance gates | 0.75 |
| A-8 `key:rotate` + master-key rotation | 0.75 |
| A-9 `COURSE` scope type | 0.5 |
| A-10 EN localisation | 0.5 |
| A-11 Diagnostics page | 0.5 |
| A-12 GDPR rights as CLI | 0.5 |
| A-13 Public course-catalogue page | 0.5 |
| A-14 Version check + advisories | 0.25 |
| **Total recovered** | **11.0** |

**Fourteen items, ~11.0 engineer-weeks, none of them retrofit-hostile.**

The honest framing: rev7-realism's *SHOULD LEAVE v1* list recovered 8.5 weeks
and concluded *"the size problem is not solvable by another round of cuts to the
platform"*. The new target buys 2.5 weeks more than that reviewer could take,
and the conclusion is unchanged. **The platform is no longer where the weight
is.** See the total in §Total.
