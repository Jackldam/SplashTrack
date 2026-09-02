# 08 — Open Architecture Decisions

These are the decisions this design deliberately does **not** make, because they
need input that is not available to me. Each is blocking or shaping in a way
that gets more expensive the later it is answered. Ordered by cost of delay.

---

### OD-1 — Is there a deployed prototype instance holding real data?

**Status: OPEN — unanswered, and blocking.**

The previous wording was *"Status: BLOCKING, confirmed by Jack (2026-08-31)"*,
which reads as though the decision were settled. It was not. What Jack confirmed
on 2026-08-31 is that the decision **is blocking** — not what the answer is.
Every future reader would have misread that line, so it is stated the long way
here: **nobody has answered this yet.**

**The question was also posed wrongly.** "Does the prototype have real users or
real data" cannot be answered by looking at a repository, and a repository is
all anyone has looked at. The answerable form is:

> **Is there a deployed prototype instance, and who holds its connection
> string?**

If nobody can name a running instance, the answer is no and **OD-1 closes the
same day.**

**Why it matters.** D-001 discards the prototype's schema and migration history.
That is free if the prototype was never deployed, and a data-migration project
if a school depends on it today.

**A fact this entry did not record.** The prototype **is not a separate
repository**. It sits in the working tree of *this* repository at `apps/web` on
`main` — 111 TypeScript files, 12 models, 4 migrations — and the design branch
sits on top of it (`00-overview.md` §2.2). So "no destructive action against the
existing repository" constrains the repository the v1 build will also occupy,
and the obvious move — replace `apps/web` — is exactly what this decision
forbids until it closes.

**What follows if the answer is yes** — recorded now, at zero cost, so it is not
designed under time pressure later:

- The import path becomes requirement **R-29** (not R-20, which is migrations
  and upgrades).
- It is **file-based, offline and one-way**: a standalone export script run
  against the prototype emits a documented JSON envelope; the importer consumes
  that file. No live database link in either direction, ever.
- The importer runs through the **new application services**, so rows land with
  correct scoping, consent state and audit — not by SQL.
- The prototype's `Organization` is **multi-row with a hierarchy**; SplashTrack's
  is an enforced singleton (D-027). An import therefore takes **one prototype
  organisation id as a required argument** and refuses without it. N prototype
  organisations means N installations, N imports, N recovery tokens.
- **Consent cannot be imported.** The prototype has no consent model, so the
  importer writes **zero** `Consent` rows, leaves every consent-gated feature
  off, and reports what could not be carried over. Anything else launders a
  compliance gap into a system whose privacy model depends on having a lawful
  basis on record.
- `OrganizationMemberCapability` maps to role assignments **explicitly**; the
  import **refuses on any unmapped capability** rather than silently dropping
  authority.
- Sequencing: the importer is written after the foundation and reshaping work,
  before any cutover — not first.

**Cost of delay.** High, and now cheap to remove: one look at whether a
prototype instance is running.

---

### OD-2 — **(Closed, 2026-09-01)** The first customer is Jack's own swim school.

**Answer.** The first customer is **Jack's own swim school**, and Jack is a
**practising instructor there**. It is a swim school; the domain model,
vocabulary and default catalogue are aimed at the right thing.

**Why closing this mattered more than it looks.** This decision was open, marked
"cost of delay: high", through an entire review round — and it distorted that
round badly in both directions. One reviewer's central instruction was "stop
designing and go stand at a poolside", addressed to someone who stands at one
every week. In the other direction, an open OD-2 left it *possible* that the
first customer would be a stranger self-hosting, which is what justified the IdP
registry, the diagnostics page as a third-party support tool, the
restore-from-every-release matrix and the full release-signing pipeline as **v1**
work. Closing it is what makes the v1 re-cut in `00-overview.md` §3.5 not merely
defensible but obvious: the first and only operator for the next year is the
author, on his own hardware.

**What remains.** Nothing blocking. The NRZ criterion thresholds still need
confirming from the source before a catalogue is seeded
(`15-assessment-and-fees.md`) — that is a data question, not an architecture
one.

<details><summary>Original entry</summary>

**Why it matters.** The domain model is shaped around swim education (skills,
levels, diplomas, poolside sign-off). If the first customer is, say, a sailing
school or a first-aid trainer, the model still fits — but the *vocabulary* and
the default skill catalogue do not, and terminology is far cheaper to decide
before the UI exists.
**Needed.** One named organisation and their actual process, ideally observed.
**Cost of delay.** High — this is the difference between designing for a real
workflow and designing for an imagined one.
</details>

---

### OD-3 — **(Resolved)** Hosting: the organisation self-hosts.

Answered by Jack: SplashTrack ships as an open-source Docker container that each
organisation runs on its own infrastructure. We host only a demo/reference
instance. What remains open is whether a *hosted* offering is ever added — see
OD-14.

<details><summary>Superseded analysis</summary>

**Why it matters.** Single-tenancy makes this decision much larger than it was.
It now determines the provisioning script, per-instance cost, backup tooling,
certificate automation and the whole fleet model.
**Two questions, not one:**
1. *Where do instances run?* One VPS per instance with Docker Compose (simplest,
   matches the template); several small instances co-located on shared hardware
   with separate databases and processes (cheaper, still isolated); or a managed
   container platform. Kubernetes remains discouraged — no demonstrated need.
2. *Who operates them — you, or the customer?* If SplashTrack is a hosted
   service you run, you are the processor and F-13/F-14 apply in full. If
   customers self-host, the fleet problem largely disappears but so does your
   ability to upgrade them, and support becomes much harder.
**Cost of delay.** **High, and higher than before** — it blocks the provisioning
script (D-028), which now blocks UAT.
</details>
Revisit when a customer contractually demands dedicated hardware.

---

### OD-4 — **(Partly answered)** Fee *tracking* is in v1; invoicing is not.

**Answered.** Fees are tracked in v1 — fee types, charges, payments, a balance
view and a CSV export (**R-32**). The school needs it kept, and without it they
keep their existing system and do dual entry, which is the most common reason
software like this is abandoned.

**The line, and it is deliberately hard: the document.** A balance view and a
CSV are internal administration. The moment the application renders an artefact
carrying an amount and the organisation's details and sends it to a parent, it
is arguably a *factuur* under Dutch rules and inherits sequential numbering,
mandatory fields, BTW treatment and a seven-year retention obligation on a
record the application now authored. **Nothing with an amount on it leaves the
system in v1.**

**Two costs of saying yes, absorbed rather than discovered:**

1. **Financial retention conflicts with person retention.** D-066 triggers
   person retention at the end of the last relationship; Dutch fiscal law wants
   administration kept seven years. `Charge` and `Payment` must be in the D-014
   erasure registry with a **financial retention ground**, and erasure must
   pseudonymise the charge rather than delete it. Done at the same time as the
   tables, or the first erasure request either destroys bookkeeping or silently
   skips it.
2. **The breach gets more valuable.** The database now holds children's health
   notes *and* who owes money. It does not change the controls; it changes how
   seriously D-040 and D-042 deserve to be taken. Both are already kept.

**Still open.** Whether **reconciliation** arrives — CAMT.053 / MT940 import
with payment-reference matching. It is out of the v1 estimate, and it is the
**first thing to add after the first full billing period**: without it someone
marks 180 charges paid by hand each quarter by reading a bank statement, which
is worse than the spreadsheet they have now and is exactly where a
tracked-billing feature gets abandoned.

**And one to re-affirm rather than drift through.** Within a term, someone will
ask why the class list does not flag arrears. It must not. **P-03's seam is kept
and arrears stay in the administration surface** — a payment flag on the
poolside screen puts a family's finances in front of a volunteer instructor.

---

### OD-5 — Guardian portal: v2 or never?

**Why it matters.** `PersonRelationship` is built in v1 regardless (it is
needed for consent on behalf of minors — F-02). But if guardians get their own
login, the authorization model needs a "reach" concept for *"my child's data
only"*, which is a genuinely different scoping axis from organisation
membership.
**Cost of delay.** Medium.
**My recommendation:** design the relationship table now (already decided), and
defer the portal until a customer asks. Do not build the scoping axis
speculatively.

**Decided (2026-09-01) — `RELATED` is removed from the scope enum entirely
until the guardian portal ships.** It was previously in three states at once:
R-14 mandated building the axis in v1, P-04 and this decision deferred it, and
the v1 starter-role catalogue shipped a Guardian role that *used* it. Deferring
it while leaving it grantable is the worst of the three: an administrator can
assign a scope whose enforcement nobody has written, and it will look like it
works. Reserving the enum member without implementing it is only marginally
better — the reserved-but-unimplemented member is exactly the kind of thing that
gets wired up by someone reading the enum rather than this chapter. So it is
gone from the enum, and it returns with the portal that needs it.

---

### OD-6 — Session timeout values.

**Reframed.** `SHARED_DEVICE` mode (D-009) is out of v1 (`00-overview.md`
§3.5.1): it was opt-in by the party it restricted, and its most valuable
sub-behaviour — no exports from a poolside session — is achieved better by an
instructor role that simply holds no export permission. What is left is the
plain question the mode was wrapped around.

**Why it still matters.** Too short and instructors re-authenticate mid-lesson
with wet hands, which is a defect against a clipboard. Too long and a mislaid
device is an open door.
**Proposed defaults.** Idle 30 min (instructor), 15 min (administrator),
absolute 12 h.
**Cost of delay.** Low — they are settings, and the right way to decide them is
three lessons of real use, which is now available.

---

### OD-7 — **(Closed 2026-09-02)** Encryption key management for special-category columns.

**Resolution.** Answered by three later decisions, and closed against them:
**D-112** (`SECRET_KEY` supplied via `SECRET_KEY_FILE` is the single root;
every application key including the Better Auth signing secret is HKDF-derived
with a purpose label), **D-114** (two-level envelope — a master key wrapped by
Argon2id over the printed recovery token, per-archive data keys wrapped by the
master key; rotation re-wraps the master key) and **D-096** (`v1:<keyId>:<nonce>:<ct>`
with AAD binding table, column, primary key and key id). **Cloud KMS is
rejected**: it is not needed given the above and it contradicts the self-hosted
premise (D-064) — a self-hoster on a NAS has no KMS. Escrow is the operator's
recovery token (F-24 unchanged: losing it loses the data). This no longer blocks
the students module.

**Why it mattered (retained for the record).** D-013 encrypts medical/pastoral notes at column level. That
creates a key that must be stored outside the database, rotated, escrowed, and
available during restore. A lost key means permanently unreadable health data;
a key stored next to the data provides no protection.
**Options.** Cloud KMS (best, ties to OD-3); environment-injected key with
documented rotation and escrow (workable); no column encryption (rejected —
D-013 stands).
**Cost of delay.** Medium — it blocks implementing the students module's notes.

---

### OD-8 — **(Resolved, then moved out of v1)** Bring-your-own identity provider.

**Current status (2026-09-01): out of v1, decision retained.** The reasoning
below is still correct — self-hosting really does collapse the complexity, and
D-035 stands as the design. What changed is OD-2: the first and only operator
for the next year is Jack, who runs no Entra, no Google Workspace and no
Keycloak. A provider registry is **purely additive** — nothing about shipping
local accounts first blocks it, and no data has to be reshaped when it arrives.
So it is retained on paper and built when a deployment exists that needs it
(`00-overview.md` §3.5.1).

**One thing to settle before it is built, not after.** The template loads its
identity-provider configuration once at auth-context construction — its own
source comment says so — and the OAuth plugin takes a static provider array.
"Change a provider without a restart" is therefore **not** an inherited
capability, and D-038's live-apply promise should be spiked before it is relied
on. That is a reason to build the registry late, not a reason to fear it.

<details><summary>The reasoning that promoted it into v1, and remains sound</summary>

**Why it changed.** This was deferred under the multi-tenant assumption, where
per-tenant IdP configuration meant N configurations in one shared application —
genuinely complex. Self-hosting inverts that: **every deployment is exactly one
organisation**, so "their IdP" is simply "the instance's IdP". The complexity
evaporates, and the requirement becomes much more likely — an organisation
running its own server very often already runs its own Entra, Google Workspace
or Keycloak.
**Resolution.** D-035 — a database-backed provider registry administered in-app,
supporting local accounts plus any OAuth 2.0/OIDC provider. In v1 scope.
**Remaining sub-question:** does JIT provisioning create a `Person` as well as a
`UserAccount`, or only link to an existing one? **Recommendation: link only.**
Auto-creating people from an IdP would let anyone in the corporate directory
become a student record.
</details>

---

### OD-9 — **(Answered by scope)** Is the public website expected to replace an existing site?

**No, and v1 no longer tries.** The first school has a website. The public
surface in v1 is a **course-catalogue page and an inquiry form**; the general
CMS (R-12 / D-017) is out (`00-overview.md` §3.5.1). The gap this decision was
worried about — a webshop, a booking funnel, a blog with authors — is now
outside the product's stated scope rather than inside it and unbuilt, which is
the honest position.

**What survives, and is not negotiable:** D-051, enforced as a lint rule. The
`(public)` route group may not import a person repository. A reduced public
surface is not a reason to relax the one rule that makes a public page exposing
data about children structurally impossible.

**Reopens** the day a school without a website is the customer.

---

### OD-10 — Terminology and language of the domain model.

**Why it matters.** Code in English, UI in Dutch is the default assumption
(the template ships NL + EN, NL default). But domain terms — *diploma*,
*afzwemmen*, *baan*, *lesuur*, *proefzwemmen* — often have no good English
equivalent, and a bad translation in the schema haunts the codebase forever.
**My recommendation:** English for generic concepts (`Skill`, `Group`,
`Enrolment`), and keep Dutch domain terms untranslated where translation loses
meaning. Decide the glossary once, in a `docs/glossary.md`, before the first
domain module is written.
**Cost of delay.** Low individually, high cumulatively — renaming a schema
concept after ten modules use it is painful.

---

### OD-11 — **(Closed)** Per-customer cost floor.

Hosting cost is the organisation's own; there is no floor on our side. Reopens
only with a hosted offering (OD-14).

<details><summary>Superseded</summary>

**Why it matters.** A dedicated database, storage, certificate, backup schedule
and monitoring per organisation creates a hard marginal cost per customer that
a multi-tenant design would not have (F-16). That sets a floor on pricing and
may make very small organisations — a one-pool swim club with 40 members —
unprofitable to serve.
**Needed.** A rough target price per organisation per month, so the hosting
shape in OD-3 can be chosen to fit it.
**Cost of delay.** Medium. It does not block v1 development, but it does shape
the hosting decision, and reversing hosting later is expensive.
</details>

---

### OD-12 — Is cross-instance functionality ever required?

**Why it matters.** Single-tenancy makes some things impossible by design: a
swimmer transferring from school A to school B carrying their diploma history;
a national federation viewing results across affiliated schools; an examiner
working across several schools with one login. If any of these is a real
requirement, it needs a deliberate mechanism — most likely a signed, exportable
**credential document** rather than a shared database.
**Cost of delay.** Medium. Designing an export/import format is cheap now and
awkward later.
**My recommendation:** treat award records as portable signed artefacts from the
start — they are already immutable, numbered records, revoked and reissued
rather than edited (**D-062**, `01-domain-model.md` §3.5). That covers the
transfer case without any cross-instance data path.

**Citation corrected (2026-09-01).** This recommendation previously cited
**D-007** for the immutability claim. D-007 was about *erasure* — "erasure
severs identity; retained records survive pseudonymised" — it never said
anything about award immutability, and it is **superseded by D-065**. So the
whole of P-09's portable-certificates chain (`00-overview.md` §3.2 → this
decision → the claim) was routing through a withdrawn decision to reach a true
conclusion. It now routes through D-062, which actually states it.

---

### OD-13 — Which open-source licence? — **RESOLVED (2026-09-01): AGPL-3.0**

**Status: CLOSED.** Decided by Jack on 2026-09-01. See **D-067**.

**What the design assumed, and what was actually true.** This decision was
written as though the licence were still unchosen. It was not: the repository
already carried **GNU GPL-3.0** at its root, and had done so since before the
design phase began. The open decision was therefore not "pick a licence" but
"keep GPL-3.0 or move to AGPL-3.0", and nobody had noticed the difference.

That difference is the whole point. **GPL-3.0 is not triggered by network
use.** A competitor may take SplashTrack, modify it, run it as a paid hosted
service for swim schools, and publish nothing. Since SplashTrack is designed to
be *run as a service* by whoever deploys it, GPL-3.0's copyleft almost never
fires — the software is used over a network, not distributed. AGPL-3.0 §13
closes exactly that gap.

**Resolution.** `LICENSE` replaced with the verbatim GNU AGPL-3.0 text
(19 November 2007), obtained from `https://www.gnu.org/licenses/agpl-3.0.txt`.

**Why this was still possible.** Relicensing requires the agreement of every
copyright holder. Every commit in the repository's history — across the
identities `Jack den Ouden`, `Jack`, `Jackldam`, and the assistant/agent
identities operating under Jack's direction — traces to a single rightsholder.
There is no external contributor whose consent would have been required. Had
one genuine third-party contribution landed first, this change would have been
blocked or would have needed that person's agreement. The cost-of-delay warning
in the original entry was accurate, and the window was closed with days, not
weeks, to spare.

**Still open, and deliberately kept out of this decision:**
- **DCO for contributions** — see `CONTRIBUTING.md` and F-28. Needed before the
  next external pull request, not before the next commit.
- **Trademark use of the name "SplashTrack"** — a licence governs the code, not
  the name. Undecided; low urgency; no code depends on it.

**Known trade-off, accepted.** Some organisations' procurement policies refuse
AGPL software outright. For swim schools and sports associations this is
unlikely to bind; for a municipal or hospital-adjacent buyer it might. That
adoption cost was accepted deliberately in exchange for reciprocity.

---

### OD-14 — Will there ever be a hosted "SplashTrack Cloud"?

**Why it matters.** Not for v1, and the architecture supports it trivially — a
hosted offering is just us being the operator of some instances. But it
reintroduces the processor role, DPAs, fleet operations (F-13/F-14) and the
per-customer cost floor (F-16), all of which we just deleted. Knowing whether
it is on the roadmap affects the licence choice (OD-13) above all.
**Cost of delay.** Low technically, high commercially.
**My recommendation:** decide the licence as if the answer is yes, build as if
the answer is no.

---

### OD-15 — Minimum supported operator skill level.

**Why it matters.** It sets the bar for the install experience. "Comfortable
with Docker Compose on a VPS" and "a swim school volunteer with a Synology NAS"
are very different products — the second needs a one-click package, a
reverse-proxy story and far more documentation.
**Cost of delay.** Medium. It shapes documentation and packaging, not the
architecture.
**Partially answered (2026-08-31).** Jack's requirement — full in-app
configuration, no restarts — sets the bar firmly at the *low* end: the operator
must manage Docker, TLS and backups, and **nothing else**. All application
configuration is in the web interface (`13-configuration-and-setup.md`).
**Still open:** whether to also ship one-click packages (Synology, Unraid,
CasaOS, Proxmox helper script), which would widen reach considerably at the cost
of maintaining packaging we do not control.

---

### OD-16 — Does a digital pupil list exist anywhere at all?

**Why it matters, and it is load-bearing.** CSV import of the current pupil list
has been described as *"what makes a pilot possible at all"*. But the incumbent
is **pen and paper**. If the school genuinely runs on paper, **there may be no
digital list to import** — and entering 100 children by hand is one evening, at
which point CSV import drops out of v1 entirely.

Most clubs keep a member ledger or an Excel somewhere for contributie, so it
probably exists. **Probably is not good enough for a line item**, and this
assumption has never been checked.

**Needed.** One answer: is the list in Excel, in a ledger, in the prototype
database, or nowhere? If "nowhere", say so and the import work disappears.
**Cost of delay.** Medium, and it is the cheapest question in this chapter to
answer — it takes one look in a drawer.
**Note.** This is a different question from OD-1. OD-1 asks whether a *prototype
instance* holds data; this asks whether *any* digital list exists. Both can be
"no", and if both are, R-29 and the whole import path leave v1 together.

---

### Register integrity — **(Resolved, 2026-09-01)**

Both defects previously recorded here are fixed. D-011, D-015, D-027, D-028
and D-029 now state, in the register row itself, that the row is the
authoritative text for a withdrawn or superseded decision (D-133); the wrong
"Where" pointers (D-011/D-015 → `03-…` §1.1, D-027 → §1.2) are corrected. See
`09-decision-register.md` for the fixed rows.

Separately, the register was found to have a much larger version of the same
problem: **D-090 through D-098 were each assigned twice**, to two unrelated
decisions in different chapters (the assessment/fees chapter and the
platform/backup chapters, drafted concurrently). Both sets had already been
written into their live chapters under the same numbers. Resolved by
renumbering the later-written side (`01-domain-model.md`'s D-095–098 →
D-108–111; `13-…`/`14-…`'s D-090–094 → D-112–116) and updating every
cross-reference; see `09-decision-register.md` for the reconciled set and
`10-findings.md` for the merged review findings this closes.

### OD-17 — Is the five-value grade scale the only one a school will ever use?

**Why it matters.** `GradeScale`/`GradeValue` (`15-assessment-and-fees.md`
§2.1) is modelled as org-owned specifically so a school *could* define its own
ordinal scale, but the only scale in scope is the five NRZ-style values
(*onvoldoende…zeer goed*) the domain expert described. Nobody has asked
whether that flexibility is ever used, and it is cheap to leave unused but
not free to remove once seeded data references it.
**Cost of delay.** Low. The model already supports either answer; this is a
data question, not an architecture one, and it can wait until the NRZ
catalogue itself is confirmed (F-44).
**My recommendation:** ship the one scale, keep the table generic since it
cost nothing, and do not ask the question until a second scale is actually
requested.

