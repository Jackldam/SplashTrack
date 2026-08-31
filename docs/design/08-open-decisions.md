# 08 — Open Architecture Decisions

These are the decisions this design deliberately does **not** make, because they
need input that is not available to me. Each is blocking or shaping in a way
that gets more expensive the later it is answered. Ordered by cost of delay.

---

### OD-1 — Does the existing SplashTrack prototype have real users or real data?

**Why it matters.** D-001 discards the prototype's schema and migration
history. That is free if the prototype was never used, and a data-migration
project if a swim school is depending on it today.
**Needed.** A yes/no, plus — if yes — how many organisations, how many people,
and whether they can tolerate a cutover.
**Cost of delay.** High. It changes whether v1 needs an import path at all.
**My assumption if unanswered:** no production users; no import path built.

---

### OD-2 — Who is the first real customer, and are they a swim school?

**Why it matters.** The domain model is shaped around swim education (skills,
levels, diplomas, poolside sign-off). If the first customer is, say, a sailing
school or a first-aid trainer, the model still fits — but the *vocabulary* and
the default skill catalogue do not, and terminology is far cheaper to decide
before the UI exists.
**Needed.** One named organisation and their actual process, ideally observed.
**Cost of delay.** High — this is the difference between designing for a real
workflow and designing for an imagined one.

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

### OD-4 — Are payments and invoicing in scope within 12 months?

**Why it matters.** Not for v1 — it is deferred either way. But if the answer is
"yes, next year", then `Enrolment` must keep a clean seam and never grow a
payment-status field, and the retention model must anticipate financial records
(7-year fiscal retention in NL, which conflicts differently with erasure than
diplomas do).
**Cost of delay.** Medium. Cheap to prepare, expensive to retrofit.

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

---

### OD-6 — Session timeout values for shared devices.

**Why it matters.** D-009 introduces `SHARED_DEVICE` mode but the concrete
numbers are a usability/security trade-off only the operator can make. Too
short and instructors re-authenticate mid-lesson with wet hands; too long and a
stolen tablet is an open door.
**Proposed defaults.** Idle 30 min (instructor), 15 min (admin), absolute 12 h.
**Cost of delay.** Low — configurable, decidable during UAT with real
instructors.

---

### OD-7 — Encryption key management for special-category columns.

**Why it matters.** D-013 encrypts medical/pastoral notes at column level. That
creates a key that must be stored outside the database, rotated, escrowed, and
available during restore. A lost key means permanently unreadable health data;
a key stored next to the data provides no protection.
**Options.** Cloud KMS (best, ties to OD-3); environment-injected key with
documented rotation and escrow (workable); no column encryption (rejected —
D-013 stands).
**Cost of delay.** Medium — it blocks implementing the students module's notes.

---

### OD-8 — Per-organisation identity providers (SSO).

**Why it matters.** The template has Microsoft Entra sign-in at the platform
level. An organisation wanting *its own* tenant SSO is a different feature with
real complexity (per-tenant IdP config, JIT provisioning, role mapping).
**Cost of delay.** Low. Explicitly deferred; the architecture does not need to
prepare for it beyond keeping authentication behind Better Auth.

---

### OD-9 — Is the public website expected to replace an existing site?

**Why it matters.** D-017 deliberately constrains the CMS. If a prospective
customer's current site has features outside that scope (a webshop, a booking
funnel, a blog with categories and authors), that gap should be known now
rather than discovered during UAT.
**Cost of delay.** Low-medium.

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
**My recommendation:** treat certificates as portable signed artefacts from the
start (they are already immutable, numbered records — D-007). That covers the
transfer case without any cross-instance data path.

---

### OD-13 — Which open-source licence?

**Why it matters.** "Fully open source" is a direction, not a licence, and the
choice is effectively irreversible once third-party contributions arrive.
**Options.**
- **AGPL-3.0** — anyone running a modified SplashTrack as a network service must
  publish their modifications. Protects against a competitor building a closed
  paid hosted version on your work. Some organisations' policies forbid AGPL.
- **Apache-2.0** — maximum adoption, explicit patent grant. Anyone may run a
  paid hosted SplashTrack without giving anything back.
- **MIT** — simplest, same trade-off as Apache without the patent clause.
**Also needed:** DCO or CLA for contributions, and a decision on trademark use
of the name.
**Cost of delay.** High and rising — relicensing after external contributions
requires every contributor's agreement.
**My recommendation: AGPL-3.0 + DCO.** It matches the intent (any party may
download and use it), keeps improvements flowing back, and preserves the option
of selling a hosted version yourself later. If broad enterprise adoption matters
more than reciprocity, Apache-2.0 instead — but decide deliberately.

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
**My assumption if unanswered:** an IT-literate operator comfortable with Docker
Compose, TLS and backups.

