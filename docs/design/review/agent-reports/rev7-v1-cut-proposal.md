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

---

## B — KEEP IN v1 EVEN THOUGH IT LOOKS CUTTABLE

Everything here survives the argument *"there is only one club, and its operator
wrote the software"*. Each item fails that argument for one of exactly three
reasons, and the reason is stated in the first clause:

- **data exists** — adding it in v2 means migrating, or inventing, rows that are
  already written;
- **signature** — adding it in v2 rewrites a call every module makes;
- **the law does not count clubs** — the obligation attaches to processing
  children's health data, not to the number of deployments.

Twenty items. None is a week on its own; together they are the reason v1 cannot
be a prototype.

---

**B-1 · The encryption envelope, the decryptor registry and the golden vectors
(D-096, D-097, D-049).** *Data exists.* Build-order item 1 — *"every encrypted
byte written before the envelope exists has to be found and re-wrapped"*. Ship
it as **`v2:`** with AAD bound to a **stable logical column id** (B-20, B-12).
Roughly a day beyond the naive version, and the only alternative is a rewrite of
every ciphertext in the club's database.

**B-2 · Encrypting the D-148 protected class at write time — medical remarks,
pastoral/safeguarding notes, assessment remarks, `Inquiry` free text.** *Data
exists, and the law does not count clubs.* rev7-realism R-12 declined to call
this cut and was right to: a plaintext medical note written today is a plaintext
medical note in every backup ever taken, and encrypting the column in v2 leaves
the plaintext in every archive that already left the building. `02-…` §5.4's
argument for the inquiry text is the strongest one in the section — a parent's
first email is often *"mijn zoon heeft epilepsie en is bang in het water"*,
i.e. Article 9 data arriving through a public form. **A-8 cuts rotation, not
this.**

**B-3 · The audit hash chain, the `INSERT`-only database role, the retention
floor, and `audit:verify` (D-149, D-126).** *The law does not count clubs.* The
three Article 33 questions are answered from this trail and from nothing else,
and A-4 cuts the breach-response *tooling* on the explicit basis that the trail
survives. `UPDATE`/`DELETE` revoked on a second database role is a compose-file
change, not a project.

**B-4 · Audit chain checkpointing (B-17).** *Data exists.* Ranked #2 in
`06-delivery.md` §5's cost-of-doing-it-late table, assigned to **no phase**, and
specified **nowhere**. It is not optional and it is not free — see **C-9**,
where it is costed as an *addition*, because it is one. Retention as specified
(`onExpiry = DELETE`, floor 12 months) breaks the chain on its **first run**,
around month 12–24 of the only instance that will ever hold this club's history,
and `audit:verify` then reports a broken chain forever.

**B-5 · The scope model with reach as a required repository argument, the
branded `Reach` union, and per-module scope-escape tests (D-030, D-031, D-032,
D-147).** *Signature.* Build-order item 3 — *"it changes the signature of the
guard every module calls"*, and worse, a module built first has scope-escape
tests written against the wrong question. This is also the boundary that stops a
volunteer instructor reading another instructor's children, which is a
one-club problem as much as a fleet problem. **A-9 removes one variant from it;
that is not the same as deferring the model.**

**B-6 · `coversResource()` (B-10).** *Signature.* Not a feature — a specification
gap on the **write** half of B-5, named once in a delivery plan and defined in
no chapter, while the read half gets a fully specified eight-variant union.
Every write in the application calls it. Costed in **C-13**.

**B-7 · The `SESSION` scope type and roster-resolved reach (R-31, D-068,
D-144).** *Signature.* Cutting it makes the independent aftest assessor, the
substitute instructor, the receiving instructor of a make-up lesson and the
external examiner **all four impossible** — they are one problem, and none of
them holds a standing grant over the child. D-147 makes adding a scope variant a
compile error in every repository, which is exactly why the one that carries
four real workflows ships now.

**B-8 · Append-only event models: `AttendanceEvent` with `clientEventId` and
`supersedesEventId` (D-061, D-005), `ExamResult` with `supersedesResultId`
(D-062), `GroupMove` (D-108), `MembershipPeriod` + `StudentLifecycleEvent`
(D-059).** *Data exists.* Build-order item 4 — *"converting a mutable column
into an event log after data exists means inventing the history you destroyed"*.
D-061's justification is not compliance theatre: attendance is evidence for
absence policy, for parental disputes and occasionally for safeguarding.
`clientEventId` is one indexed column and it is what makes P-02's offline path
additive rather than a rewrite.

**B-9 · `Person` / `Membership` / `StudentProfile` as three tables (D-004,
D-053, D-058).** *Data exists.* Retrofitting the split is a migration through
every table, and one retention policy forced onto both lifecycles is a
compliance defect on day one — a member may leave while diploma history is kept
ten years.

**B-10 · Consent with actor, purpose, lawful basis and authority evidence
(D-063), guardian authority expiring at the age of digital consent (D-151), and
the withdrawal constraint (D-152).** *Data exists, and the law does not count
clubs.* Build-order item 6 — *"a consent captured under the current shape has no
recoverable actor, and consent on behalf of a minor is the majority case"*.
D-151 is the cheapest control in the chapter: one computed condition over
`Person.dateOfBirth` and a configurable age, and it is the most predictable
consent failure in this domain — a club's eight-year-olds turn sixteen inside
the retention window whether or not anyone built a queue.

**B-11 · Boot-state predicates and restore-then-migrate (D-098, D-046, D-055).**
*Data exists.* **A-3 cuts the wizard, not this.** An empty database is ambiguous
— fresh install, or the first minute of a restore — and migrating immediately
resolves it wrongly: a migrated empty schema and a backup that no longer
restores cleanly into it. `FAILED` earns its place separately: a failed Prisma
migration stays recorded and blocks every later one, so without the state the
container crash-loops with no indication that the fix is `migrate resolve`.

**B-12 · Backup, restore, the Recovery Kit, and restore-fixture generation
(D-040, D-102, D-113, D-115, D-044, D-104, D-043, D-105).** *Data exists —
and there is exactly one copy of it.* This is the item the one-deployment target
makes **more** important, not less. There is no fleet to absorb a loss; there is
one box holding one club's children's records. Keep in full: the encrypted
archive with D-102's framed AEAD construction (plain AES-GCM is not a streaming
construction and truncation would verify), the printed recovery token,
D-044's automatic pre-migration backup with D-104's cap, D-043's refusal to
start against a newer schema, and **D-105's fixture generation** — which must
ship at v1.0 or v2 can never test restoring from v1.0, and v1.0's data is the
only data that will exist. *(The v1.3 restore **matrix** stays cut; only the
fixture is retained. `00-…` §3.5.1 already says this and `14-…` §4.3.1 still
does not — B-14.)*

**B-13 · Fix S-1 before any of B-12 is called done.** *Data exists.* rev7-security
**S-1**, severity critical: the Recovery Kit as specified needs a **third
artefact nobody is told to keep**. `SECRET_KEY` is the HKDF root for TOTP
encryption, settings secrets and the medical-column key (D-112), and it is not
in the archive by design (D-113) and never displayed (`13-…` §6.3). An operator
holding the `.stbak` and the printed token, doing exactly what the product told
them, brings up a fresh container, generates a **new** `SECRET_KEY`, restores —
and **nothing fails**: row counts match, migrations report clean, and every
medical remark, pastoral note, assessment remark, inquiry free text, SMTP
password and TOTP enrolment in the school is permanently unreadable, with MFA
mandatory and non-clearable. This is not a v2 concern. It is the difference
between a Recovery Kit and a ritual.

**B-14 · `D-048` never-squash, plus the append-only migration lockfile test
(D-124).** *Data exists.* Free as a policy, worthless as prose. It is what makes
the eventual **v1 → v2 upgrade of the live instance** survivable, and it is what
makes the D-047 matrix addable later. The enforcing test is inherited-adjacent
and cheap.

**B-15 · The break-glass CLI (R-19, `13-…` §7, D-141).** *Signature-adjacent.*
Promoted by A-3 from a safety net to the **primary bootstrap path**, and it is
already the only stated recovery from an authentication lockout. Lockout,
MFA reset, settings reset, all audited.

**B-16 · Medical and pastoral notes behind their own permission pair (D-010,
D-087, D-148).** *The law does not count clubs.* Least privilege on the data
class whose exposure would end the project — and D-148 is right that folding
pastoral into medical would be a *reduction* in least privilege: the instructor
who must know about a child's epilepsy would also read the note about the
family.

**B-17 · Retention constants with a `lawfulBasis` column, and the D-014 erasure
registry with its completeness test (D-065 reduced, D-110, D-014, D-154,
D-135).** *The law does not count clubs.* The **engine** is already cut; the
policy, the basis column and the registry are not. The registry's completeness
test is inherited, bidirectional and already built (`person-reference-sync.test.ts`)
— *"the cheapest compliance insurance in the document set"*. Adopt it **minus
its hard-coded eight-column floor**, which names four models D-056 removes or
renames and whose own comment will tell the engineer the removal is the bug
(**B-1**, rev7-build).

**B-18 · D-051 as a lint rule — `(public)` never imports a person repository.**
*The law does not count clubs.* Free, structural, and it prevents the worst
plausible incident for this product. Cutting it saves nothing.

**B-19 · The MFA mandate bound to permissions, and the `invariant` settings
class (D-130, D-150).** *The law does not count clubs.* An invariant that
becomes editable later is a control nobody can prove was ever on. Bind to
permissions, never to role names — and note **B-3** (rev7-build): **D-158 binds
session timeouts to the role names *instructor* and *administrator*, which
D-130 forbids and which has no defined answer for a club that invents a role
called "Hoofdbadmeester"**. Resolve to the permission form; the template already
ships the bounded, live, fail-safe-to-strict timeout mechanism (**B-5**,
rev7-build), so this is adding a dimension, not building timeouts.

**B-20 · Three schema shapes that are free today and a migration through live
data later.** *Data exists.*
- **`origin: IMPORTED_LEGACY`** on `MembershipPeriod` and `StudentLifecycleEvent`
  (B-15, rev7-build) — named once, in the chapter that does not own them, and
  the rows that most need the marker are the **entire CSV import** (C-2), which
  is now the only way pupils enter the system.
- **`Assessment.schemeId` pinning an immutable scheme version by FK (D-081)**,
  one criterion catalogue (**D-084**), and the `Certificate` → **`Award`** rename
  with `AwardType.kind` (**D-082**) — a rename today, a migration through every
  issued diploma later.
- **`Person.dateOfBirth` and `ProcessingObjection` in the Phase-1 foundation
  schema** (B-11, rev7-build) — otherwise Phase 2's consent work reaches
  forward into Phase 3's `people` module, which is how the DAG erodes in week
  three.

---

### What List B costs

Nothing new, except **B-4** (checkpointing) and **B-6** (`coversResource`), both
of which are genuinely unbuilt work and are therefore costed in List C rather
than hidden here. Everything else in List B is already inside the ~55-week
baseline. **List B is not a budget line — it is a fence.**

---

## C — ADD TO v1 THAT IS NOT THERE

Ranked by one test and one test only: **can Jack run a Tuesday evening without
it?** Nothing else decides the order. Where an item is a spec fix rather than a
feature, it is still here, because an engineer cannot build what nobody wrote.

**Total: ~6.3 engineer-weeks.**

---

### C-1 — Session generation: a recurrence primitive and a closure calendar · **~1.0 w** · R-2

**Nothing in this design set creates a lesson.** `planning` is a v1 module whose
entire specification is one line — *"Schedule construction, locations,
resources, assignment"* (`01-domain-model.md` §1.1). Grep across `00`–`10`,
`13`–`15` for `holiday`, `vakantie`, `recurrence`, `recurring`: **zero hits**
other than `FeeType.recurrence`. `04-ux.md` §4 specifies no planning workflow.

**The moment it fails.** September. Six groups × ~36 sessions after school
holidays and two pool closures = **216 `ScheduledSession` rows**, every one
hand-created in a form before a single instructor can tap *Start session*,
because `AttendanceEvent` is written against a session id. The flagship
workflow — the entire product thesis — is unreachable until someone spends an
evening typing.

**What to build.** A `SessionSeries` (group, weekday, time, location, from/to)
that generates `ScheduledSession` rows, plus an org-level **closure calendar**
(school holidays imported once as dates, pool closures added by hand) that the
generator skips.

**Build it *with* `sessions`, before `attendance`** (R-17). `06-delivery.md` §5
puts `planning` tenth of eleven, so under the current plan the first time anyone
discovers whether a season can be generated at all is **after ten modules are
built on the assumption that it can** — and recurrence-with-exceptions is the
one part of this domain with genuinely fiddly edge cases (a moved lesson, a
double week, a block starting mid-holiday). It also makes the DEV seed honest:
a synthetic dataset generated the way production generates it.

---

### C-2 — The CSV importer from the incumbent's export · **~1.0 w** · R-29 / D-157 / OD-18

**Promoted today.** It was already a v1 requirement, but OD-18's closure makes
it **the only ingress there is**: no integrations in v1, so every pupil, member,
guardian and contact detail arrives through this file or is typed by hand.

**What is buildable now, before the file exists.** rev7-build **B-15** settles
this and is right: everything the importer *is* is specified target-side and
depends on nothing about the source — dry-run-then-commit, a per-row rejection
report, unmapped columns **reported not dropped**, authority **never inferred**
(refuse on any unmapped role value rather than silently granting), **zero
`Consent` rows written** with a report of what could not be carried, and
lossy-by-construction records seeded with one synthetic
`StudentLifecycleEvent(JOINED)` and one `MembershipPeriod`. That is an importer
framework with a pluggable mapping, testable against a synthetic fixture.

**What is blocked.** Exactly one thing: the column mapping. **D-157** forbids
specifying it in advance and is right — *"a column mapping guessed in advance
fails on first contact with the real file, at the one moment a pilot cannot
absorb failure."*

**The one open ask for Jack in this whole document:** a sample export from the
incumbent. Nothing else here waits on him.

**Prerequisite:** `origin: IMPORTED_LEGACY` must exist on both append-only
models **before** the first import runs (B-20 above). The rows that most need
the marker are the ones written first.

---

### C-3 — The catalogue-authoring surface F-44 now requires · **~1.5 w** · new today

**What changed.** F-44 dissolved: no NRZ catalogue is seeded. **An administrator
authors the skill/criterion list and its links to certificates and diplomas
inside the application.** That is the right call — it keeps the product generic,
it removes a blocking data question (`15-…` §9 item 2), and it removes D-083's
seed-and-fork machinery (`source = NRZ`, fork-on-edit: **−0.25 w**, banked in
the total).

**But it is a straight swap of a data problem for a UI problem, and the UI is in
no estimate.** The entities exist on paper — `SchemeCriterion` (**D-084**),
`CriterionSet` and the data-driven pass rule (**D-080**), one seeded `GradeScale`
(**D-160**), `AwardType.kind ∈ {DIPLOMA, CERTIFICATE}` (**D-082**). What does not
exist is any way for a human to create them.

**What to build.** CRUD for criteria and criterion sets; assembling a set into a
scheme version; binding a set to an `AwardType` with per-criterion
`minimumGrade` overrides against `scheme.passFloor`; and — the part that is easy
to get wrong — **versioning as a first-class action**: an `ACTIVE` scheme is
never edited, editing produces version *n+1* and stamps `effectiveTo` on *n*
(**D-081**). Plus a preview of the effective threshold per criterion, which
`15-…` §2.2 already requires the assessment screen to render.

**Why it ranks third and not tenth.** Skill sign-off is a Tuesday-evening
workflow (`04-ux.md` §4.2, the flagship's twin), and it writes `SkillProgress`
against a versioned criterion. With no catalogue there are no criteria, so there
is no sign-off and no aftest. Attendance is the only poolside workflow that
survives without this — and C-1 has to land first for attendance to exist at
all.

---

### C-4 — Roster-based reach for a session's own instructor · **~0.1 w (one clause + tests)** · R-4

**The gap between two decisions that were written to agree.** **D-109** models
make-up lessons: `SessionRosterEntry` accepts *"a student who is not a member of
the session's group"* with `source = GUEST`. **D-068** says `SESSION` scope
covers *"the receiving instructor of a make-up lesson"*. But the receiving
instructor is the group's **own** instructor and holds a `GROUP` grant, and
`02-…` §2.2 is explicit that `GROUP` covers *"the group-scoped relations of the
**students in it**"* — a guest is by construction not in it.

**The moment it fails.** Sanne missed Tuesday and comes Thursday. An
administrator adds the roster entry. Thursday's instructor opens the session:
eleven names. Sanne is standing in the water and is not on the screen. For her
to appear, an administrator must additionally mint a `SESSION`-scoped
`RoleAssignment` for *that instructor* on *that session* with a mandatory
`validUntil` (**D-144**) — at 16:55, in a workflow that exists in no screen.

**The fix.** One clause in `02-…` §2.2's coverage table: an instructor assigned
to a session may read the students on **that session's roster** for its window,
whatever put them there. It narrows nothing — the guest was deliberately placed
there by an administrator — and it removes the per-make-up grant entirely.

**Do not skip the tests.** This is a coverage-rule change, so it needs its
scope-escape cases in the same commit.

---

### C-5 — Lesson cancellation · **~0.1 w** · R-3

`ScheduledSession.status` exists and its **values are enumerated nowhere** —
unlike `AttendanceEvent.state`, `Enrolment.status`, `Charge.status` and
`StudentLifecycleEvent.type`, which all get explicit enums in the same tables.

**The moment it fails.** 16:10 Thursday, the pool calls: no lesson tonight.
There is no cancel action, so the session stays `SCHEDULED`. At 19:00 it appears
on Today as a session to register; tomorrow it appears forever in *"anything
requiring attention (unregistered past sessions)"* (`04-ux.md` §1) — one
permanent false alarm per cancelled lesson. The instructor's only move is to
mark twelve children absent, which is a **lie written into an append-only
evidence log** whose justification is safeguarding (D-061).

**The fix.** `ScheduledSession.status ∈ {SCHEDULED, CANCELLED, COMPLETED}`, a
cancel action carrying a reason, and three stated consequences: cancelled
sessions are not "unregistered", attendance cannot be written against them, and
the roster is retained.

---

### C-6 — Substitute assignment as an action, with a grant window that outlives the lesson · **~0.4 w** · R-5

Two decisions collide. `04-ux.md` §4.0(3) commits to post-hoc entry as a
first-class path — *"A v1 used post-hoc from paper is a legitimate, winning
v1."* **D-144** makes `validUntil` schema-mandatory for `SESSION` scope,
*"typically the session's date"*.

**The moment it fails.** Marieke covers Groep A2 on Thursday, on paper, because
the hall wifi is bad. Friday morning her grant has expired; `requirePermission`
denies. Her options are to ask an administrator to re-issue a grant for a lesson
that already happened, or to hand the sheet to someone else who records
attendance **under their own name** in the log whose entire point is *"who said
a child was present, and when they changed their mind"*.

And there is no *action* that creates a substitution at all: **D-068** names the
substitute as a case the scope type covers, and `InstructorAssignment` is a
table with no workflow attached — no screen where a planner says *"Marieke
covers Thursday"*.

**The fix.** Default `SESSION` grants to `session.endsAt + N days`, N a
`bounded` setting (**D-150**'s class already exists for exactly this),
defaulting to 7. **Keep the mandatory `validUntil`** — it is right. And specify
the substitute assignment as a planner action that issues the grant as a side
effect, or the mechanism exists and the button does not.

---

### C-7 — Guardian communication: one screen, one templated message · **~0.6 w** · R-13

**The product can record everything about a lesson and tell nobody anything.**
There is no outbound message to a guardian anywhere in v1: P-06 defers
notifications, the portal is v2 (**OD-5** / **D-161**), and `07-…` §1.4's
delivery is for high-severity security events, to operators.

**Three failures, weekly to termly:**
- The pool closes Thursday. Twelve families need to know **today** — and without
  C-5 the app cannot even represent the cancellation.
- Sanne is confirmed for the exam on 14 March. Her parents need the date, the
  time and the fee **D-089** just created — and **D-093** correctly forbids
  putting arrears anywhere an instructor would mention them.
- Sanne moves from B2 down to B1. **D-108** makes the reason a required field
  *precisely* so a parent is not left to guess — *"a parent reading 'moved from
  Group 4 to Group 3' with no reason attached draws the worst conclusion
  available"* — and then stores it where no parent will ever read it. **D-108's
  required reason is currently a cost with no beneficiary.**

**The fix.** One screen: send a templated message to the guardians of a group,
or of a session's roster. The `email-templates` and `notifications` modules are
inherited and working; `PersonRelationship(GUARDIAN_OF)` already gives the
recipient list. This is not the portal and does not pre-empt **OD-5**.

**What it does not do.** Every one of these messages is sent today by WhatsApp
from someone's personal phone. SplashTrack does not have to win that. It has to
not make it worse.

---

### C-8 — A print fallback that is routine, plus a cached session shell · **~0.4 w** · R-6

`04-ux.md` §4.0(1) is one of the best-argued pages in the set and its conclusion
is correct: *"An application that will not load shows nothing at all, and the
instructor standing at the poolside has no move."* **P-02** is declared
*"defensible **only** because [the print fallback] exists"* (**D-129**).

**And it mitigates the risk with an action nobody takes.** The wifi is fine at
18:50 and gone at 19:05. Nobody printed anything, because printing is a button
you press when you already expect trouble and the whole point of the app is that
you stopped carrying paper. Worse, the app is server-rendered Next.js: with the
network down it does not degrade to a stale list, **it does not load**.

**Two cheap fixes, neither of them an offline queue.** (a) Make the printed list
a **weekly routine artefact** — a "print this week's class lists" action, stated
in the runbook as expected practice for the first term. (b) Cache the session
shell and roster in the browser after it loads, so a session opened at 18:50
survives the network dropping at 19:05 — `04-ux.md` §4.1 rule 6 already promises
to keep failed writes on screen; this is the same promise extended by one page
load.

*(R-35's print fallbacks themselves are already inside the baseline's 3-week
waitlist/group-move/print/NRZ bucket. This is the ~0.4 w delta that makes them
reachable.)*

---

### C-9 — Audit chain checkpointing · **~0.5 w** · B-17 (rev7-build)

Ranked **#2 in the whole product** by cost of doing it late (`06-delivery.md`
§5), assigned to **no phase**, and specified in **no chapter** — `checkpoint`
appears twice in the entire design set, once in that table and once as an
example branch name.

**Why it is a deadline item and not a Tuesday item.** Audit retention is
`onExpiry = DELETE` with a 12-month floor and a 24-month shipped default. On the
**first retention run** the job deletes the oldest rows, the surviving head's
`previousHash` points at a row that no longer exists, and `audit:verify` reports
a broken chain **permanently, for a legitimate deletion** — a red light
operators learn to ignore, which is strictly worse than no light. The template's
verifier also walks from genesis and materialises the whole table in memory, on
what `07-…` §1.2 calls the fastest-growing table.

**What to build.** An `AuditCheckpoint` (sequence, hash-at-that-point,
timestamp, signed under `HKDF(SECRET_KEY, info="audit-checkpoint")`); the
retention job writes one before deleting anything; `verifyAuditChain` verifies
checkpoint-to-checkpoint and chunks its walk. And settle
`AUDIT_GENESIS_HASH` — it is currently the literal string
`"genesis:webapp-template:audit:v1"`, and it must be decided in the first commit
that writes an audit event.

**Deadline:** before the first retention run, i.e. before month 12 of the live
instance. Practically: before Phase 1 closes, because it changes the retention
job and the verifier together.

---

### C-10 — Capacity check on group move and waitlist placement · **~0.1 w** · R-10

`Group.capacity` is a nullable field and **nothing anywhere reads it**, on the
action **R-34** and **D-108** just made first-class. `04-ux.md` §4.8's group-move
row is *"choose the target group, give a reason, confirm"* — no occupancy, no
"this group is full", no waiting-for-a-place state.

**The weekly management question in a swim school is not "is Sanne ready" — it
is "is Sanne ready **and is there a spot in B2**".** Both predecessor reports
named this and it is still unaddressed. Without it the move screen will put a
thirteenth child in a group of twelve and the person who finds out is the
instructor on Tuesday.

**The fix.** One query and a soft block: show occupancy against `capacity`, warn
over capacity, allow the override (a group of thirteen for one week is normal).
Same check on the **R-33** waitlist placement action, which asks the identical
question.

---

### C-11 — Absence self-report, or an honest sentence · **~0.4 w, or 0** · R-14

`AttendanceEvent.state` includes `EXCUSED` and there is **no inbound channel
that could excuse anybody**: no portal (v2), no form, no email intake, no
absence link. `04-ux.md` §4.1 gives *"long-press = EXCUSED/LATE + note"* and
nothing to base it on.

**Every week.** A parent texts the instructor's personal phone at 17:30. At
19:00 the instructor long-presses EXCUSED from memory, for the children whose
message they happened to see. The distinction between ABSENT and EXCUSED — the
whole reason both exist, and the basis of any future absence policy — is
recorded on the basis of which parent had which instructor's number.

**Two acceptable outcomes, and one unacceptable one.** Build a signed,
per-`(session, student)` link, messaged to the guardian, that writes `EXCUSED`
with `source = GUARDIAN` and needs no login (~0.4 w, and it composes with C-7's
delivery path). **Or** state plainly in `04-ux.md` §4.1 that **EXCUSED is
instructor-asserted hearsay in v1** (0 w), so nobody builds an absence report on
it later believing otherwise. What is not acceptable is shipping the enum and
saying nothing.

---

### C-12 — Waitlist entries must hold a `Person` · **2 lines, 0 w** · R-9

**The cheapest correction in this review and the one with the most embarrassing
failure mode.** **D-066** enumerates every relationship that holds a `Person` —
membership, enrolment, role assignment, guardian relationship, unexpired
consent, legal retention ground. **A `WaitlistEntry` is not on the list.**

A parent enquires in March. An `Inquiry` is written (**D-051** — public forms
never write `Person`), promoted to a `WaitlistEntry`, which requires a `Person`.
That person has no membership, no enrolment, no role, no consent and no legal
ground: under D-066 their last relationship of any kind ended the moment it
began. They enter `REVIEW` and are deleted — while the entry the design calls
*"the front door"* points at nothing. **Dutch swim-school waiting lists run
months to years; this is the median entry, not a tail case.** Second, smaller
version: `Inquiry` retention is 6 months → `DELETE`, while `WaitlistEntry` holds
a reference to it, so the front door's provenance vanishes at six months.

**The fix.** Add *"an open `WaitlistEntry`"* to D-066's list, and extend
`Inquiry` retention to the life of any entry derived from it.

---

### C-13 — Specify `coversResource()` · **~0.2 w** · B-10 (rev7-build)

Not a feature — the **write half of the authorization model**, named exactly
once in the entire design set, in `06-delivery.md` §5 Phase 2, with no
signature, no return type and no chapter section. The read half gets a fully
specified eight-variant branded union (**D-147**). Every write in the
application calls this one.

Unanswered on day one: does it take a `Reach` or a session? What is a
`resourceRef`? Who resolves a `studentProfileId` to the group a `GROUP` grant
covers? For a `SESSION` reach, is the window checked against the resource's time
or the clock? **D-144** says expiry is evaluated inside `requirePermission` and
`resolveReach` and names no third function — so is `coversResource` inside
`requirePermission` or beside it?

**Blocks Phase 2.** Specify it in `02-…` §2.3 alongside D-147, with the same
rigour: signature, `resourceRef` shape, one row per `Reach` variant, and what
`UNION` and `NONE` do.

---

### C-14 — A defined independence window for the four-eyes gate · **1 sentence, 0 w** · R-7

**D-085** requires the assessor be *"not among the `InstructorAssignment`
holders for that student's group **over the assessment window**"*, and the
assessment window is **defined nowhere**. `InstructorAssignment` binds to
`groupId` **or** `sessionId`, so a one-evening substitution creates an
assignment of the same kind as a standing one.

Both readings are available to an implementer. *Narrow* ("assigned on the day"):
almost nothing is excluded and the control is ceremonial. *Broad* ("ever
assigned"): in a club of four instructors who cover for each other, **nobody is
independent for anything** and D-085's override becomes the normal path.

D-085's own defence is that the override **rate** is the signal a chair can act
on — *"if it is being used every week that is itself the finding."* That
reporting is worthless if the rule's calibration is an accident of how one
developer read one clause.

**The fix.** Independence is broken by a **standing** `InstructorAssignment` to
the child's group (one bound to `groupId`) overlapping the aftest date, and
**not** by a session-level substitution. The relationship the control is about
is *"their own teacher"*, not *"someone who once stood in"*.

---

### C-15 — Lanes: take the zero-week option · **0 w** · R-16

Two groups in one pool at the same hour is normal, and nothing models it.
`Lane` appears exactly once in the design set — in **OD-10**'s glossary list, as
a term to translate. It is not an entity. `Location.capacity` is a single number
meaning "people", which answers a different question.

R-16 offers a `LocationResource` with a conflict check in the generator (~3 d)
**or** deleting the word *"resources"* from **R-10**. **Take the deletion.** It
is a planning-quality problem, not an operational stop — the lesson happens
whether or not the app knows the lanes — and C-1 is already spending a week
opening up `planning`. A requirement with no model behind it is worse than an
absent requirement; `Lane` returns in v2 with the rest of scheduling.

---

### List C total

| # | Item | Weeks | Finding |
|---|---|---|---|
| C-1 | Session generation: recurrence + closure calendar | 1.0 | R-2 |
| C-2 | The CSV importer (now the only ingress) | 1.0 | R-29 / D-157 / OD-18 |
| C-3 | Catalogue-authoring surface | 1.5 | F-44 dissolved |
| C-4 | Roster-based reach | 0.1 | R-4 |
| C-5 | Lesson cancellation | 0.1 | R-3 |
| C-6 | Substitute action + grant window | 0.4 | R-5 |
| C-7 | Guardian communication screen | 0.6 | R-13 |
| C-8 | Routine print + cached session shell | 0.4 | R-6 |
| C-9 | Audit chain checkpointing | 0.5 | B-17 |
| C-10 | Capacity check | 0.1 | R-10 |
| C-11 | Absence self-report (or the sentence) | 0.4 | R-14 |
| C-12 | Waitlist entries hold a `Person` | 0.0 | R-9 |
| C-13 | Specify `coversResource()` | 0.2 | B-10 |
| C-14 | Independence window | 0.0 | R-7 |
| C-15 | Lanes — delete "resources" from R-10 | 0.0 | R-16 |
| | **Total added** | **6.3** | |

**C-4, C-5, C-10, C-12 and C-14 together are under two days and close five real
failures.** They should not wait for a scope conversation, a chapter rewrite or
this document's approval.
