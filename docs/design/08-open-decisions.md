# 08 — Open Architecture Decisions

These are the decisions this design deliberately does **not** make, because they
need input that is not available to me. Each is blocking or shaping in a way
that gets more expensive the later it is answered. Ordered by cost of delay.

---

### OD-1 — **(CLOSED 2026-09-02)** Is there a deployed prototype instance holding real data?

**Answer, from Jack: there is no prototype instance.** Nobody holds a
connection string because nothing is deployed. The prototype exists only as
source in `apps/web` on `main`.

**Consequences, all of them releasing:**

- **D-001 is free.** Discarding the prototype's schema and its four migrations
  costs nothing; no school depends on them.
- **`apps/web` may be replaced** rather than worked around. The constraint this
  entry placed on the v1 build — "no destructive action against the existing
  repository until OD-1 closes" — is lifted. The replacement is still a normal
  reviewed change on a branch, not a `git rm` on `main`.
- **R-29 does not exist for the prototype.** There is no one-off import path
  from prototype data, because there is no prototype data. The import question
  moves entirely to OD-16, which has a different and non-empty answer.
- Nothing here reopens D-001; it confirms the trade-off column was free.

---

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

### OD-5 — **(CLOSED 2026-09-02)** Guardian portal: v2 or never?

**Answer, from Jack: v2 — confirmed, not "maybe".**

This is a firmer answer than the entry asked for, and it changes what v1 owes.
"Defer until a customer asks" was the recommendation; "it is coming in v2" is a
commitment, and a commitment has design consequences a deferral does not:

- **The v1 removal of `RELATED` from the scope enum stands unchanged.** An
  unimplemented-but-grantable scope is worse than an absent one, and that
  reasoning does not depend on when the portal ships. It returns with the
  portal, as one reviewed change that adds the enum member, its
  `resolveReach` variant and its enforcement together (D-147 makes the addition
  a compile error everywhere it must be handled — the desired forcing function).
- **v1 may not foreclose the axis.** `PersonRelationship` (F-02), the
  `ON_BEHALF_OF` consent records and D-151's age-of-digital-consent expiry are
  already the substrate the portal will read. No v1 decision may assume that
  the only readers of a student's record are staff. Where that assumption would
  otherwise be cheap — a query that hard-codes staff reach, a screen that
  renders "your child" as impossible — it is not taken.
- **What is still not built in v1:** the portal, guardian authentication,
  guardian-facing screens and the reach variant itself. Speculative scoping
  work remains out.

**D-161** records the "do not foreclose" obligation, because a commitment kept
only in this chapter is a commitment nobody implementing chapter 02 will read.

---

---

### OD-6 — **(CLOSED 2026-09-02)** Session timeout values.

**Answer, from Jack: the proposed defaults are accepted, and they must be an
administrator-changeable setting rather than a constant.**

That second half is the substantive part, and it lands on an existing rule
rather than creating a new one. **D-150** already classifies every setting as
`free`, `bounded` or `invariant`; session timeouts are named there as `bounded`
with a hard ceiling of 8 hours idle. Jack's answer is therefore satisfiable
exactly as the security model already requires:

| Setting | Default | Class | Bound |
|---|---|---|---|
| Idle timeout, standard | 30 min | `bounded` | 5 min – 8 h |
| Idle timeout, elevated | 15 min | `bounded` | 5 min – 8 h |
| Absolute session lifetime | 12 h | `bounded` | 1 h – 24 h |

**This table is a summary of the answer; the normative statement is
`02-security-privacy.md` §4.1.2 (D-173)** — including the tier rule, which is
what changed after this entry was first written.

**Why the bound is not negotiable even though the value is.** D-143 removed
`SHARED_DEVICE` and leaned the poolside threat model on "the Instructor role
holds no export permission, plus a short role-based idle timeout". If the
timeout were `free`, the second half of that mitigation could be set to a year
by the person it restricts — the same self-declaration defect D-143 exists to
remove. Bounded gives Jack what he asked for (change it after three lessons of
real use, from the admin UI, no restart) without re-opening it.

**Per-permission, not per-role — corrected.** The entry first closed as
*"per-role, so the setting is role-scoped; one more dimension in the settings
registry"*, recorded as **D-158**. That was wrong on three counts and is
superseded by **D-173**: it bound a security control to role names, which D-130
forbids because roles are user-definable; its 24-hour absolute ceiling
contradicted D-150's 12-hour one; and the registry it named as its home defines
`scope` as the single literal `instance-wide`, so the dimension it required does
not exist. The two idle defaults now differ by **whether the principal holds any
high-risk permission**, which is checkable, survives a school inventing a role,
and needs no new registry dimension. Jack's answer — the defaults are accepted
and must be administrator-changeable — is unchanged and still satisfied.

---

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

### OD-10 — **(CLOSED 2026-09-02)** Terminology and language of the domain model.

**Answer, from Jack: schema and code are always English.** No exceptions, no
untranslated Dutch identifiers.

This overrides my recommendation, which was to keep Dutch domain terms
untranslated where translation loses meaning (`afzwemmen`, `lesuur`, `baan`).
Jack's rule is the stricter and more maintainable one, and it removes a judgment
call from every future module author — which is worth more than the fidelity
lost on three or four terms.

**What this obliges, since "English" alone does not settle the hard cases:**

- A **glossary** (`docs/glossary.md`) fixes one English identifier per domain
  concept *before* the first domain module is written, with the Dutch term
  beside it. The glossary is the translation record; the schema is not.
- Where an English word would mislead, the glossary carries the definition
  rather than the schema carrying Dutch. `afzwemmen` → the assessment/award
  event; `aftesten` → the independent pre-exam assessment (chapter 15);
  `lesuur` → `ScheduledSession`; `baan` → `Lane`.
- **UI stays Dutch by default** (the template ships NL + EN, NL default). This
  decision is about identifiers, not about what an instructor reads at the
  poolside. Where a Dutch UI label and an English identifier diverge, the
  glossary records the pair so a support question can be traced from screen to
  column.
- Existing chapters that use Dutch terms as *prose* are unaffected; chapters
  that use them as *identifiers* are corrected when the module is written.

Recorded as **D-159**.

---

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

### OD-16 — **(CLOSED 2026-09-02)** Does a digital pupil list exist anywhere at all?

**Answer, from Jack: yes. The club runs a commercial membership administration
system, and it offers export.**

This is the opposite of the answer the entry was braced for, and it lands
harder than "the import work survives".

**What it settles:**

- **The import path stays in v1.** R-29 is not deleted; it is now grounded in a
  real source rather than a hoped-for spreadsheet.
- **The importer is built against an actual export file, never an invented CSV
  schema.** This is the whole value of the answer. A column set guessed in
  advance is a column set that fails on contact, at the one moment a pilot
  cannot absorb failure. Recorded as **D-157**: no import mapping is specified
  until an export sample from the incumbent system is in hand, with an explicit
  unmapped-column report rather than silent dropping.
- **The pen-and-paper premise was only ever true for attendance and
  assessment**, not for the member base. Chapter 04's "the incumbent is paper"
  framing (D-129, print fallbacks) remains correct for the poolside surfaces and
  is now known to be wrong for membership data. Both statements coexist; the
  chapters say which is which.

**What it opens, and I am not deciding it (see OD-18).** If membership
administration already runs in a commercial system, SplashTrack's own
`Membership`, `MembershipPeriod` and contributie tracking (chapter 15) may be a
second home for a fact that already has one — the exact duplication D-134
forbids inside the document, now appearing between systems. One-time import,
periodic sync and full takeover are three different products. That question is
Jack's, and it is now the most expensive open item in this chapter.

---

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

### OD-17 — **(CLOSED 2026-09-02)** Is the five-value grade scale the only one a school will ever use?

**Answer, from Jack: yes — *onvoldoende / matig / voldoende / goed / zeer goed*
is the scale.**

Resolved exactly as recommended, and the recommendation stands unchanged:

- **Seed one scale**, the five NRZ-style ordinal values, with "minimally
  *voldoende*" as the pass threshold except where an `AwardType`'s
  `CriterionSet` sets a lower one (certificates with relaxed requirements —
  chapter 15 §2).
- **Keep `GradeScale`/`GradeValue` generic anyway.** The table cost nothing to
  write and removing it now would be a schema change to buy nothing. It stays
  org-owned and versioned; nobody builds a scale editor for it in v1.
- **Versioning still matters** for the reason it always did (chapter 15): an
  aftest from 2026 must stay readable against the criterion set that applied in
  2026, whatever the NRZ does in 2028. Confirming today's scale does not make
  it permanent.

Recorded as **D-160**.

---

---

### OD-18 — **(CLOSED 2026-09-02)** Does SplashTrack take over membership administration, or coexist with the incumbent system?

**Raised earlier the same day by OD-16's answer, and answered the same day.**

**Answer, from Jack: option 1 — SplashTrack takes it over.** The incumbent is
*only* a member administration system, and SplashTrack is intended to hold all
of the club's digital needs eventually. The read-only-projection branch (option
2) and the split branch (option 3) are both dead.

**But with a constraint that changes how the takeover happens:**

> **No integrations with any external system in v1.** The only ingress is a
> **bulk import from a CSV** that the other system can export.

That constraint is worth more than it looks. It converts a systems-integration
problem into a file-parsing problem, removes every question about sync
direction, conflict resolution and staleness, and means the incumbent is
**switched off**, not kept alive alongside. Recorded as **D-163**.

**What this settles in the chapters:**

- `15-assessment-and-fees.md` §6.2 (membership fees) **is built as written**.
  The conditional note added earlier today is removed: `Membership` and
  `MembershipPeriod` are systems of record here, not projections.
- **D-157 simplifies.** It still forbids inventing a column mapping before a
  real file exists, but the source is now a CSV export rather than a vendor
  API, and the importer is a **one-time bulk load**, not a recurring feed.
- No adapter, no vendor coupling and no scheduled synchronisation appears
  anywhere in v1.

**One new fact arrived with the answer, and it is not v1 — see OD-19.**

---

### OD-19 — SportLink registration for competition and water-polo members

**Raised 2026-09-02 by Jack, as context rather than as a request.**

**The fact.** Members who swim competitively or play water polo must *also* be
registered in **SportLink** to be allowed to compete. This is mandatory for
those members and irrelevant for ordinary lesson pupils — the large majority.

**Explicitly out of v1.** D-163 admits no external integration in v1, and this
is one. It is recorded because it is a real obligation the club carries, and
because knowing it exists changes one small thing now: a person may hold an
**external registration in another system**, and a future integration should
not have to invent where that identifier lives.

**What v1 does about it: nothing, deliberately.** No SportLink field, no
external-id column, no stub. Adding an identifier column later is a migration;
inventing a shape for an integration nobody has specified is a guess that will
be wrong. `01-domain-model.md`'s `Person` is the obvious home when the time
comes.

**What v2 must decide.** Whether SplashTrack pushes to SportLink, reads from
it, or merely records that a member is registered there — three quite different
commitments. Also whether competition membership is a distinct membership kind
in the domain model at all, which today it is not.

**Cost of delay.** Low. Nothing in v1 becomes harder by not answering it.
