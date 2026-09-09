# SplashTrack — Design & Architecture

**Versie:** 2026-09-02 (rev. 6) · **Branch:** `design/architecture-phase` · PR #14

**141 beslissingen · 94 findings · 14 actieve hoofdstukken.**

Hoofdstuk 00 staat op AKKOORD. Hoofdstukken 01–15 blijven in review.
Hoofdstukken 11 en 12 zijn historie en staan bewust niet in dit document.

Onder elke sectiekop staat een reviewblok. Kruis aan, typ eronder, stuur terug.


---

# SplashTrack — Product Vision, Requirements & Scope

> **Status: authoritative.** This document and chapters 01–10 and 13–15
> describe **one** architecture: an open-source, self-hosted, single-organisation
> application. There are no multi-tenant or platform-operator assumptions left in
> the active chapters.
>
> Chapters 11 and 12 are **history, not authority** — they record how the design
> arrived here and why. Nothing in them may be used as an implementation
> instruction. If they appear to contradict an active chapter, the active
> chapter is correct and the revision note is stale.


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## Review status


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**Chapter 00 — Status: AKKOORD** (Jack, 2026-08-31)

- The product direction is **accepted**.
- **`WebAppTemplate` is the implementation foundation** (D-001); the existing
  SplashTrack repository serves only as a domain reference.
- **Obsolete multi-tenant functionality is removed, not retained unused**
  (D-056) — incrementally, covered by tests, for a smaller attack surface and
  less maintenance debt.
- **Environment configuration follows the bootstrap-necessity criterion**
  (D-037), not an arbitrary count: a variable is permitted only when its value
  must be known before the database can be read, or when it determines where
  persistent state lives. Everything else is database-backed.
- Chapter 00 is now **consistent with the later single-instance, self-hosted
  architecture**: one organisation per installation, no shared control plane, no
  platform super administrator, database-backed runtime settings, and the
  security-first / GDPR-by-design requirements intact.

**Correction (2026-09-01).** The bullet above previously claimed that the
platform-super-administrator residue was gone from the active chapters. It was
not. The independent review found `platform.super_admin` still normative in
`02-security-privacy.md` §1.2 (MFA mandate) and `07-operations.md` §1.3 (the
security alert list) — an alert on a principal that cannot exist never fires and
gives false assurance. Both are removed, and the MFA mandate and the alert list
are now bound to **permissions** rather than to role names, because roles are
user-definable and a role name is not a checkable predicate.

**Scope correction (2026-09-01).** The v1 definition below has been re-cut. It
is not a trim: roughly 45% of the previously specified effort went into a
self-hosting *product* whose first and only operator for the next year is Jack,
on his own hardware, while six capabilities he names as weekly needs were absent
from the design entirely. See **§3.5**. The word "aftest" did not appear
anywhere in this design set before that revision; neither did "NRZ".

Chapters 01–15 remain **under review**; approving chapter 00 approves nothing
else, and the open decisions in `08-open-decisions.md` remain open.

**Register reconciliation (2026-09-01).** Four review passes ran concurrently
against this design and each numbered its own decisions and findings, staged
in `review/staging/`. Consolidating them into `09-decision-register.md` and
`10-findings.md` found that **D-090 through D-098 had each been assigned
twice**, to unrelated decisions in the assessment/fees chapter and the
platform/backup chapters, and both sides had already been written into their
live chapters under the same numbers. This is now fixed — see
`08-open-decisions.md`, *Register integrity* — and the register (D-001–D-138,
with documented gaps) and findings (F-01–F-108, with documented gaps) are
current as of this revision. The domain input in `15-assessment-and-fees.md`
(aftesten, examengeld, contributie, wachtlijst, proeflessen, inhaallessen,
group moves, NRZ export, poolside/papieren fallback) is fully incorporated;
the two genuinely open questions from that input — the NRZ criterion catalogue
contents (F-44) and whether a school will ever define its own grade scale
(OD-17) — are data questions for Jack, not architecture.

## Document set


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| # | Deliverable | Where |
|---|---|---|
| 1 | Product vision | `00-overview.md` §1 |
| 2 | Core requirements | `00-overview.md` §3 |
| 3 | Non-functional requirements | `00-overview.md` §4 |
| 4 | User types | `00-overview.md` §5 |
| 5 | Roles & authorization model (scoped) | `02-security-privacy.md` §2 |
| 6 | Functional modules | `01-domain-model.md` §1 |
| 7 | Domain model | `01-domain-model.md` §2 |
| 8 | Entities & relations | `01-domain-model.md` §3 |
| 9 | Data ownership | `01-domain-model.md` §5 |
| 10 | GDPR / privacy model | `02-security-privacy.md` §5 |
| 11 | Trust boundaries | `02-security-privacy.md` §6 |
| 12 | Security architecture | `02-security-privacy.md` §1–4 |
| 13 | Distribution & isolation architecture | `03-deployment-model.md` §1 |
| 14 | Theming architecture | `03-deployment-model.md` §4 |
| 15 | Public website architecture | `03-deployment-model.md` §5 |
| 16 | Information architecture | `04-ux.md` §1 |
| 17 | Navigation structure | `04-ux.md` §2 |
| 18 | Key user workflows | `04-ux.md` §4 |
| 19 | UI / design system | `04-ux.md` §5 |
| 20 | High-level technical architecture | `05-technical.md` §1 |
| 21 | Repository structure | `05-technical.md` §3 |
| 22 | DEV/PROD model | `06-delivery.md` §1 |
| 23 | CI/CD strategy | `06-delivery.md` §2 |
| 24 | GitHub workflow | `06-delivery.md` §3 |
| 25 | Lucky AI permissions & boundaries | `06-delivery.md` §4 |
| 26 | Logging, auditing, observability | `07-operations.md` §1 |
| 27 | Backup / restore | `14-backup-restore-upgrade.md` |
| 28 | Failure modes | `07-operations.md` §3 |
| 29 | Scalability | `07-operations.md` §4 |
| 30 | Open architecture decisions | `08-open-decisions.md` |
| + | Configuration, setup & administration | `13-configuration-and-setup.md` |
| + | Assessment (aftesten), awards & fees | `15-assessment-and-fees.md` |
| + | Decision register (all decisions) | `09-decision-register.md` |
| + | Findings (gaps, risks, inconsistencies) | `10-findings.md` |
| — | *History only:* how the design changed | `11-…`, `12-…` |

---

## 1. Product vision


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

SplashTrack is an **open-source, self-hosted** web application for organisations
that teach, assess and certify swimming. It ships as a Docker image; each
organisation runs its own independent instance on infrastructure it owns and
controls (`03-deployment-model.md`).

The product thesis is one sentence, and it is the constraint the rest of the
design is shaped around:

> **An instructor standing at the poolside with wet hands should be able to
> register attendance and sign off a skill for a whole group in under thirty
> seconds, on a tablet, without training — and the organisation behind them
> should get a compliant, auditable record of everything that happened.**

The management depth — members, courses, exams, planning, fees — exists because
organisations need it, but it must never leak complexity into that operational
moment.

**One qualification, added after the domain review.** The thesis is the design
constraint, not the definition of success. **The incumbent is pen and paper**,
and paper never has a zero-percent day: a wet sheet is still legible, a
forgotten sheet is reconstructed from memory, a broken pen is replaced. The win
actually asked for is *"stop losing the paper"* — which is satisfied by entering
attendance from the sheet, on a phone, after the lesson. A v1 used post-hoc from
paper is a legitimate, winning v1. The thirty-second target is kept because it
produces a better interface regardless; it is no longer allowed to justify
apparatus (`04-ux.md` §4.0). It also does **not** govern the aftest screen,
where defaulting to a passing grade would make the four-eyes control ceremonial
(`15-assessment-and-fees.md`).

**Secondary thesis, reduced to what v1 ships.** The public surface is a
**course-catalogue page, an inquiry form and the branding tokens** — enough that
"find a course and get in touch" is one system rather than an integration. The
general content-managed site (R-12 / D-017) is out of v1: the first school has a
website already, and a second CMS is the least valuable week in the plan
(§3.5).

### 1.1 Domain scope — swim education first

**Decision D-050 — v1 is designed for the swimming-lesson domain, not for a
generic education platform.**

Vocabulary, default skill catalogues, exam concepts (diplomas), group structures
and the poolside workflows are all modelled on swim schools. Where a concept is
genuinely generic — `Person`, `Group`, `Course`, `Skill`, `Enrolment` — it is
named generically, so a future adjacent domain is not blocked. But no
abstraction is introduced *now* for a customer that does not exist.

**Reason.** A generic platform built before a second domain exists is
speculation, and it is what makes products vague and slow. The brief's KISS
requirement points the same way.
**Trade-off.** Adapting to a materially different domain later will require real
work rather than configuration. Accepted deliberately: extensibility is
preserved through clean module boundaries and generic core entities, not through
premature abstraction.

### 1.2 What SplashTrack is not

- Not a CMS at all in v1. A course-catalogue page and an inquiry form; no page
  builder, no plugins, no theme marketplace (§3.5).
- Not an LMS. No e-learning content, no video hosting, no SCORM.
- **Not an invoicing platform.** v1 tracks fees, charges, payments and a balance
  (R-32) and stops hard at the document: **no artefact carrying an amount and
  the organisation's details ever leaves the system in v1.** The moment it does,
  it is arguably a *factuur* under Dutch rules and inherits sequential
  numbering, mandatory fields, BTW treatment and a seven-year retention
  obligation on a record the application now authored. That is a second product
  (OD-4).
- Not an HR system. Instructors are people with roles, not employees with payroll.
- Not a hosted service. We publish software; we operate nothing (OD-14).
- Not offline-first as a v1 guarantee — but attendance is designed so offline
  tolerance is an addition rather than a rewrite (§3.2, P-02).

---

## 2. Starting position


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Two repositories were analysed before any decision was taken.

### 2.1 `Jackldam/WebAppTemplate` — the technical base

A mature, deliberately extracted foundation: ~35 Prisma models, 30 ADRs, an
862-line authoritative `Architecture.md`, plus focused security, privacy,
database, API and branding documents.

Stack: Next.js App Router on Node, PostgreSQL, Prisma, Better Auth, Bootstrap
themed via CSS custom properties, next-intl (NL + EN), Docker Compose, Vitest +
Playwright, pino.

Already working: `Person` / `UserAccount` separation, roles, permissions, access
groups, organisational units, branding with uploaded assets, a custom-pages CMS,
consent records, audit events, API credentials, MFA, passkeys, Microsoft Entra
sign-in with **its configuration stored encrypted in the database and edited
in-app**, email templates, maintenance jobs, rate limiting, GDPR person-erasure.

**What its CI actually runs — corrected.** An earlier draft of this section
claimed the template's CI "already runs format, lint, typecheck, seed smoke-test,
unit and integration tests, Playwright E2E, container build, and a
migration-against-populated-database job". That was checked against
`.github/workflows/ci.yml` during review and is **false in one respect and
misleading in another**. The workflow has **three jobs**:

| Job | Contains |
|---|---|
| `verify` | format, lint, typecheck, seed smoke-test, Vitest, build |
| `e2e` | Playwright |
| `migrate-populated` | base migrations → populate rows → apply the PR's migrations |

There is **no container build**, no `npm audit` gate, no CodeQL, no
secret-scanning job, and **no axe assertion anywhere in `tests/`** — grep finds
only prose. Of the fifteen checks this design once required, seven exist.
`06-delivery.md` §2.1 states the corrected picture and what v1 actually ships.

Worse, and worth naming here because it is the opposite of a decision this
design makes: `deploy-uat.yml` runs `docker compose build` **on the UAT host**.
It builds at deploy time rather than promoting an image — the direct inversion
of D-022. That is existing behaviour to be **replaced**, not extended.

The migration-against-populated-database job is nonetheless real, and it is one
of the two best things in the template. The other is
`tests/unit/migration-safety.test.ts`, which blocks the unsafe
`ADD COLUMN … NOT NULL` without a default — free enforcement for exactly the
class of migration that would strand a self-hoster mid-upgrade.

**Assessment: the single most valuable asset in the project.** It answers, with
tested code, most of the non-domain requirements — the tedious,
security-critical part that is easy to get wrong.

**How it is adopted (D-056).** The template is the implementation foundation,
and its reusable parts are retained where applicable: security and
authentication primitives, the authorization framework, GDPR tooling, audit
infrastructure, branding and CMS, the testing setup and the operational
components.

Its **multi-tenant-specific** parts are a different matter. Tenant models,
middleware, authorization paths, schema elements and any other code that has no
purpose in a single-instance architecture are **identified and actively removed
during extraction** — not carried along unused. Nothing is preserved merely
because it already exists.

Removal is **incremental and covered by tests**, so that reusable functionality
is not broken on the way out. The objective is a smaller attack surface, less
complexity and less maintenance debt — dormant security code is worse than
absent security code, because it suggests an enforcement that is not
happening.

Quality signal: the schema comments document real incidents. One foreign-key
comment explains that a `Restrict` constraint once caused a GDPR Article 17
erasure to roll back entirely, and why the column is now `SetNull` as defence in
depth. That is code that has been operated, not merely written.

### 2.2 The prototype — the domain reference

**A fact this section previously got wrong: the prototype is not a separate
repository.** It is in the working tree of *this* repository, at `apps/web` on
`main` — **111 TypeScript files, 12 Prisma models, 4 migrations**
(`20260314000000_init` … `20260428213000_add_organization_hierarchy_and_capabilities`),
and the design branch sits on top of it. That matters: "no destructive action
against the existing repository" (OD-1) is a constraint on the repository the v1
build will also occupy, and the obvious move — replace `apps/web` — is exactly
what OD-1 forbids until it closes.

Models include `User`, `Organization`, `OrganizationWelcomePage`, `Student`,
`SwimGroup`, `GroupMembership`, `OrganizationMember`,
`OrganizationMemberCapability`, `AuditLog`.

**Assessment: valuable as domain evidence, not as a foundation.** It has no
`Person`/`UserAccount` split (which the brief explicitly requires), no branding
system, no CMS, no API layer, and no consent or retention model.

**Two shape mismatches that any import must handle explicitly** (R-29, OD-1):

1. The prototype's `Organization` is **multi-row with a hierarchy**;
   SplashTrack's is an enforced singleton (D-027). A prototype holding N
   organisations has no single target — it becomes N installations, N imports, N
   recovery tokens. The importer therefore takes **one prototype organisation id
   as a required argument** and refuses to run without it. Likewise
   `OrganizationMemberCapability` must map to role assignments explicitly, and
   the import **refuses on any unmapped capability** rather than silently
   dropping authority.
2. **Consent cannot be imported.** The prototype has no consent model. Every
   photo permission, medical note and marketing flag would arrive with no lawful
   basis, into a system whose privacy model (D-063, D-065, F-27) rests on having
   one. The importer writes **zero** `Consent` rows, leaves every consent-gated
   feature off, and emits a report of what could not be carried over. That is
   the difference between an import that improves the school's compliance
   position and one that launders a gap.

The import is also **lossy by construction**: prototype `Student` and
`GroupMembership` carry status, not history, so each imported student starts
with one synthetic `StudentLifecycleEvent(JOINED)` and one `MembershipPeriod`,
marked `origin: IMPORTED_LEGACY` so nobody later reads an import artefact as
evidence in a dispute.

### 2.3 D-001 — build from the template, port the domain as concepts

**Decision D-001 (approved) — `WebAppTemplate` is the technical base. The
existing SplashTrack repository is used as a *domain reference only*; its code
is not carried forward.**

**Reason.** The brief's own priorities — security first, GDPR by design, least
privilege, auditability, minimal code — are precisely the properties the
template has and the prototype lacks. Re-deriving them from the prototype would
contradict "minimale hoeveelheid code". The prototype's real value is knowledge
about the domain, and knowledge ports for free.

**Trade-off.** The prototype's code and migration history are not reused.

**Condition — open, and asking the wrong question.** Whether the prototype's
*migration history* may be discarded depends on whether it holds data that must
be migrated. That is **OD-1, and it is still blocking**: no destructive action is
taken against `apps/web`, its migration history, or any prototype database until
it closes. If real data exists, a one-time export/import path becomes a v1
requirement — **R-29**, not R-20 (R-20 is migrations and upgrades).

The question as posed cannot be answered from a repository. The answerable form
is: *is there a deployed prototype instance, and who holds its connection
string?* If nobody can name a running instance, OD-1 closes the same day
(`08-open-decisions.md` OD-1).

---

## 3. Core requirements


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Three categories, as the brief demands. **"Prepare"** means the architecture must
not need rework when the feature arrives — not that it is built now.

### 3.1 Build now — v1

**How to read the platform requirements below.** Several of them previously
restated a rule that is also stated authoritatively somewhere else. That is not
a style problem: D-037's rule was stated in three places and agreed only because
all three happened to be edited at once, and **that exact pattern has already
produced a real bug in this design set.** The same three-place duplication
existed for D-047/D-048 and for D-040.

So a normative rule is now stated **once**, in one section, and every other
mention points at it and says so — the form `13-configuration-and-setup.md`
already uses: *"The rule … is stated once, in §3.1. It is not restated here."*
A requirement row that points rather than restates is not vague; it is the only
version that cannot drift.

**Product and domain**

| ID | Requirement |
|---|---|
| R-01 | Distinct `Person`, `StudentProfile` and `Membership` concepts; a person may exist with no login account and with no student profile (§5.1, `01-domain-model.md` §3.1) |
| R-02 | Member administration: people, contact details, relationships, org membership |
| R-03 | Student administration: enrolment identity, status, progress — **not** the same thing as membership |
| R-04 | Guardian relationships between persons, with the authority to consent on behalf of a minor, modelled and audited (§3.2 P-04 covers only the *portal*) |
| R-05 | Groups with time-bounded membership |
| R-06 | Courses, levels and enrolment |
| R-07 | Skill catalogue, requirements per level, append-only per-student progress with instructor sign-off |
| R-08 | Attendance registration — the flagship operational workflow |
| R-09 | Exams: sessions, candidates, examiners (including external), results, award records |
| R-10 | Planning: lessons, groups, locations, instructors, resources |
| R-11 | Branding without code changes |
| R-12 | **Reduced (§3.5):** a public course-catalogue page, an inquiry form and the branding tokens. Not a general CMS |
| R-30 | **Aftesten** — versioned criterion schemes, a five-point grade scale, graded per-criterion results, waivers, `PersonQualification`, and the four-eyes gate on exam candidacy (`15-assessment-and-fees.md`) |
| R-31 | **`SESSION` participation reach** — reach follows assignment to a session and its roster, for a bounded window. Replaces the `EXAM_SESSION` scope (`02-security-privacy.md` §2.1) |
| R-32 | **Billing-lite** — fee types, charges, payments, a balance view per payer and per student, CSV export. No document carrying an amount leaves the system (§1.2, `15-…`) |
| R-33 | **Waiting list** — `WaitlistEntry` plus a placement action from `Inquiry` |
| R-34 | **Group moves in both directions**, carrying a reason — moving up *and* back down |
| R-35 | **Print fallbacks** — class list and exam candidate list, printable from the portal (`04-ux.md` §4.0) |
| R-36 | **NRZ notification export** — candidates, date of birth, award type, date. A report, not an integration |
| R-38 | **Make-up lessons and trial lessons: model only** — a roster that accepts a non-member, `Enrolment.status = TRIAL`, a `StudentLifecycleEvent` type. No booking flow, no entitlement counter |

**Platform, security and operability — all v1, none optional**

| ID | Requirement |
|---|---|
| R-13 | Authentication with MFA. **The mandate is bound to permissions, not to role names** — roles are user-definable, so a role name is not a checkable predicate. The permission set that compels enrolment is stated once, in `02-security-privacy.md` §1.2 |
| R-14 | Scoped permission authorization, deny by default, enforced server-side. **The scope set is stated once, in `02-security-privacy.md` §2.1; it is not restated here.** v1 keeps `UNIT` as a flat scope (no descendant walk), removes `RELATED`, and replaces `EXAM_SESSION` with `SESSION` participation reach (R-31, §3.5) |
| R-15 | **Out of v1 (§3.5).** Local accounts only. The IdP registry (D-035) is retained on paper and is purely additive later |
| R-16 | **First-run setup wizard** — organisation, first administrator, forced MFA, optional restore (D-039) |
| R-17 | **In-app configuration.** The rule governing what may live in the environment is stated once, in `13-configuration-and-setup.md` §3.1 (D-037); it is not restated here. v1 ships a **plain settings page** for the ~15 settings that matter, not a registry with a generated UI — that satisfies D-036/D-038's actual requirement (§3.5). No container restart for a runtime setting |
| R-18 | **Encrypted backup and restore** — the Recovery Kit. Stated once, in `14-backup-restore-upgrade.md` §2 (D-040); not restated here |
| R-19 | **Recovery and break-glass** — host-level CLI for lockout, MFA reset, settings reset; all audited (`13-…` §7) |
| R-20 | **Migrations and upgrades** — automatic forward-only migration on start, automatic pre-migration backup, restore-then-migrate. Stated once, in `14-backup-restore-upgrade.md` §4 (D-043 – D-046, D-048); not restated here |
| R-21 | **Diagnostics page** — effective configuration, value provenance, connectivity, migration state, backup age, version and advisory status; safe to paste in a public issue |
| R-22 | **Secure release artifacts** — signed images, SBOM, provenance, pinned dependencies, tag-only release workflow (F-18) |
| R-23 | Audit logging of security-, privacy- and domain-significant events, readable by the organisation |
| R-24 | GDPR rights: access, rectification, erasure, export — operated by the organisation itself, which is the controller (D-064) |
| R-25 | **Reduced (§3.5):** retention constants in one file, one scheduled job, and the D-014 erasure transaction. D-066's trigger rule — the end of the person's **last relationship of any kind** — is encoded as a constant, because it is correct and costs nothing. The policy *engine* (D-065's configurable table, dry-run runs, per-class confirmation) is retained on paper |
| R-26 | Public surface cannot enumerate or expose any person, student, member, group or other private record (§3.4) |
| R-27 | **Reduced (§3.5):** DEV and PROD. UAT as a separate environment is out of v1 — one person is author, reviewer and acceptor. The same tag still publishes the public image |
| R-28 | **Reduced (§3.5):** eight blocking CI checks — format, lint, typecheck, unit, integration, E2E, migration-against-populated-database, secret scanning. The check list is stated once, in `06-delivery.md` §2.1 |
| R-29 | *Conditional on OD-1:* one-time import path from the prototype at `apps/web`, taking one prototype organisation id as a required argument (§2.2) |
| R-37 | **Breach-response capability** — a "what did this account do" audit report, an active-session inventory with global revocation, notification delivery for high-severity events, and an incident checklist. For health data about children the Article 33/34 thresholds are met by default, so this is a v1 requirement for this data class (`07-operations.md` §1.4) |

### 3.2 Architecturally prepare — not built in v1

| ID | Requirement | Preparation |
|---|---|---|
| P-01 | Public REST API for integrations | Route handlers stay thin and application services are the shared layer — that is the whole preparation. **No `/api/v1` surface, no OpenAPI document and no Swagger UI ship in v1** (§3.5); scoped `ApiCredential`s are inherited and stay unused |
| P-02 | Offline-tolerant attendance | Attendance writes are idempotent events carrying a client-generated id. **Defensible only because the print fallback (R-35) exists** — see `04-ux.md` §4.0 |
| P-03 | Invoicing and payment collection | v1 tracks charges and payments (R-32); `Enrolment` never grows a payment-state field, and no document with an amount is emitted. Reconciliation (CAMT.053 / MT940 import with reference matching) is the first thing added after the first full billing period, not a v1 item (OD-4) |
| P-04 | Guardian **portal** | The relationship and consent authority are built in v1 (R-04). The login surface is deferred, and **`RELATED` is removed from the scope enum entirely until the portal ships** — an unimplemented enum member that a starter role can be granted is worse than an absent one (OD-5) |
| P-05 | Multi-language content | Content tables carry a locale discriminator from day one |
| P-06 | Notifications beyond transactional email | Template's notification module stays in place |
| P-07 | Reporting / analytics | Audit, attendance and progress are append-only and queryable |
| P-08 | Larger single instances | Stateless app processes; no in-process session or cache state |
| P-09 | Portable award records between organisations | Award records are immutable, numbered, revoked-and-reissued rather than edited — **D-062**, not D-007. D-007 was about erasure and is superseded; it never made a claim about immutability. Signable later (OD-12) |

### 3.3 Deliberately deferred

Resource/inventory management; staff shift planning; invoicing and payment
collection (P-03); native mobile apps; e-learning content; SCIM provisioning; a
hosted "SplashTrack Cloud" (OD-14); any cross-instance data path.

**Two notes.** Configurable SSO/OIDC was previously listed here, then promoted
to R-15, and is now out of v1 again for a different and better reason — see
§3.5. **Waiting lists were listed here and are now in v1 (R-33):** they were
deferred while `EXAM_SESSION` was given its own scope type, which is the wrong
way round. The waiting list is the front door.

### 3.4 The anonymous-access rule

**Decision D-051 — The public surface may not read any person, student, member,
group, attendance, progress or exam record, and must expose no endpoint from
which their existence can be inferred.**

Concretely: no person or membership queries from `(public)`; no enumerable
identifiers; opaque non-sequential ids everywhere; uniform responses on public
forms so a submitted email cannot be confirmed or denied; public forms write to
an `Inquiry` table, never to `Person`; and rate limiting on every public write.
Publishing anything person-derived (an instructor page, a results list) requires
an explicit opt-in that copies approved fields into a published content record.

**Reason.** The worst plausible incident for this product is a public page
exposing data about children. Making it structurally impossible is worth more
than any amount of careful coding (`03-deployment-model.md` §5.1).
**Trade-off.** Some naturally public-feeling features need a deliberate
publishing step. That friction is exactly where consent belongs.

---

### 3.5 The v1 re-cut — what moved, and why

**The verdict this section implements.** The design was **not over-scoped by a
factor of two; it was mis-scoped.** Roughly 45% of the specified effort went
into a self-hosting *product* whose first and only operator for the next year is
Jack, on his own hardware — while six capabilities he names as weekly needs were
absent from the documents entirely. One of those, **aftesten**, is the single
most consequential control in the domain: the four-eyes gate deciding whether a
child may sit an exam. The word did not appear once in this design set. Neither
did "NRZ".

This is not "ship less". It is **spend the same budget on things a swim
instructor will touch.**

**What made the re-cut possible: OD-2 is closed.** The first customer is Jack's
own swim school and he is a practising instructor there. Previously it was
possible that the first customer would be a stranger self-hosting, which would
have justified the IdP registry, the diagnostics page for third-party support,
the restore-from-every-release matrix and the full release-signing pipeline.
We now know the first operator is the author. Every hour spent making
self-hosting pleasant for a stranger in v1 is provably speculative in a way it
was not a week ago.

#### 3.5.1 Moved **out** of v1 — decision retained on paper, not built

| Item | Reasoning |
|---|---|
| **R-15 / D-035** IdP registry | The first and only operator is Jack. No Entra, no Keycloak, no Okta. Purely additive later: a registry is not structural, and nothing about local accounts blocks it |
| **D-047** restore-from-every-release CI matrix | **Zero prior releases exist**, so the matrix is green while protecting nothing. **D-048 is kept** (never squash a migration chain): it is free, and it is precisely what makes D-047 addable at v1.3. **Fixture *generation* must still ship in v1.0** — otherwise v1.0 is permanently untestable as a restore source |
| **`UNIT` recursive tree walk** | `UNIT` survives as a **flat** scope; the descendant walk does not. One pool. A recursive walk is the highest-risk code path in the application, written for a federation that does not exist |
| **D-009 `SHARED_DEVICE`** | Replaced by a short idle timeout and an instructor role that simply holds no export or admin permission. Its four sub-behaviours were led by the one instructors would disable first, and it was opt-in by the party it restricts |
| **R-12 / D-017 CMS** beyond a course-catalogue page and an inquiry form | The school has a website. **D-051 is kept** and enforced as a lint rule: `(public)` never imports a person repository |
| **D-022 / D-023 UAT as a separate environment** | One person is author, reviewer and acceptor. **D-023's rule is kept** — never copy production data into a lower environment — as free policy. D-022's image-promotion discipline is kept for DEV → PROD |
| **D-065 / D-066 retention *engine*** | Ship retention **constants** in one file, one scheduled job, and the D-014 erasure transaction. **D-066's trigger rule is kept** as a constant: the end of the person's last relationship *of any kind*, because the most common person in the database — a child taking lessons — has no membership at all |
| **R-17 settings registry with generated UI** | A plain settings page for the ~15 settings that matter satisfies what D-036/D-038 actually require. The metaprogramming project does not |
| **P-01 `/api/v1` + OpenAPI + Swagger** | `05-technical.md` §4 already conceded the v1 surface was health/ready plus one worked example. Ship the thin-handler discipline; ship no versioned surface |
| **R-28's full 15-check CI** | Eight checks: format, lint, typecheck, unit, integration, E2E, migration-against-populated-database, secret scanning. Seven of the fifteen were asserted to exist and did not (§2.1) |

#### 3.5.2 Moved **into** v1 — absent today, needed weekly

| Item | Requirement | Why it cannot wait |
|---|---|---|
| **Aftesten** — versioned criterion schemes, five-point grade scale, graded per-criterion results, waivers, `PersonQualification`, four-eyes gate | R-30 | The control that decides whether a child sits an exam, modelled nowhere. Retrofitting graded criteria under a live progress catalogue is a migration through every child's history |
| **`SESSION` participation reach**, replacing `EXAM_SESSION` | R-31 | Aftesten by an independent assessor, a substitute instructor, a make-up lesson's receiving instructor and an external examiner are **one** problem. All four are currently impossible: the assessor is by definition not the child's instructor and therefore holds no grant covering that child |
| **Billing-lite** — fee types, charges, payments, balance view, CSV export | R-32 | Without it the school keeps its existing system and does dual entry, which is the most common reason vertical software is abandoned |
| **Waiting list** — `WaitlistEntry` + placement from `Inquiry` | R-33 | The front door and the pipeline |
| **Group moves in both directions**, carrying a reason | R-34 | The data supports it; the *action* and the "back down" case do not exist |
| **Print fallbacks** — class list, exam candidate list | R-35 | Minimum viable parity with paper, not a nice-to-have (`04-ux.md` §4.0). Also the NRZ delegate needs the candidate list *at that moment* |
| **NRZ notification export** | R-36 | A report, not an integration |
| **Breach-response capability** | R-37 | Health data about children: the Article 33/34 thresholds are met by default, and the design shipped an audit trail and a metrics list and stopped |
| **Make-up and trial lessons: model only** | R-38 | The *data* change is expensive to retrofit and costs nothing now. The *workflows* are gold-plating — by the product owner's own account his school does not run them |

#### 3.5.3 Estimate — both numbers, recorded

| | Engineer-weeks |
|---|---|
| v1 **as previously specified** | ~60–75 |
| v1 **as re-cut above** | **~18–20** |

The two numbers are close in structure and far apart in value. The reduction is
not achieved by shipping less product; it is achieved by removing a
self-hosting product built for an operator who does not exist, and spending
about six of the recovered weeks on assessment, fees, the waiting list and print
— net roughly +5.5 weeks against the leanest previous proposal, for a release the
domain expert can run his school on rather than run alongside his existing
administration.

**One residual disagreement, stated rather than smoothed.** Proefzwemmen and
inhaallessen are, by the product owner's own words, things his school does not
do. Being the domain expert about how Dutch swim schools work does not settle
what belongs in *this* release. Verdict: **take the model, refuse the
workflow** (R-38).

---

## 4. Non-functional requirements


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**Scope note.** SplashTrack is software that organisations run themselves. We
therefore state **software targets** (what the application must achieve on a
reference deployment) and **operator guidance** (what the organisation is
responsible for). *We cannot and do not offer an infrastructure SLA.*

### 4.1 Software targets, and how each is checked

This table previously carried the header *"Software targets — verified in CI"*.
That was false for most of its rows: the load test, the query-count assertion,
the Playwright trace budget, the i18n missing-key check and save-time contrast
validation appear nowhere in `06-delivery.md` §2.1, which is the authoritative
list of what CI actually runs — and the last row contradicted the header in the
same table. A reader came away believing performance was gated. It is not.

The **Status** column is now the honest one. *Gated* means a red build.
*Required addition* means it is a v1 work item that does not yet exist and is
not currently checked by anything.

| Area | Target | How it is checked | Status |
|---|---|---|---|
| Attendance write latency | p95 < 300 ms server-side for a group of 30 | Load test against a seeded instance | **Required addition.** And the target itself needs re-deriving first: audit appends take a Postgres advisory lock, so 30 attendance events plus 30 audit rows would serialize globally. See `05-technical.md` §5 rule 6 — write **one** audit event per group registration |
| Group skill matrix (30 × 40) | p95 < 500 ms, no N+1 | Query-count assertion | **Required addition** |
| Page interactive, portal on a 4G tablet | p95 < 2.5 s | Playwright trace budget | **Required addition** |
| Cold start to serving | < 60 s including migrations | Container test | **Required addition** — there is no container build job today (§2.1) |
| Accessibility | WCAG 2.2 AA, including against configured brand colours | axe in E2E; contrast validated at save time | **Required addition.** The design asserted axe was inherited; grep finds it only in prose, nowhere in `tests/` |
| Browser support | Last 2 versions of Chrome/Edge/Safari/Firefox; iPadOS Safari first-class | Playwright matrix | **Required addition** — E2E runs, the matrix does not |
| Localisation | NL default, EN available; no hardcoded UI strings | Lint rule + missing-key check | **Required addition** |
| Migration safety | No `ADD COLUMN … NOT NULL` without a default | `tests/unit/migration-safety.test.ts` | **Gated — inherited, and it works.** Adopt it, do not re-invent it |
| Migration history is append-only | No squash, no edit of an applied migration | `tests/unit/migration-history-append-only.test.ts` against a committed lockfile | **Required addition.** D-048 is currently enforced by nothing (`06-delivery.md` §2.2) |
| Migration against a populated database | Applies cleanly over existing rows | `migrate-populated` CI job | **Gated — inherited** |
| Restore from every supported release | Succeeds and migrates forward | Restore matrix job | **Out of v1** (§3.5). Zero prior releases exist. Fixture *generation* still ships in v1.0 |
| Dependency risk | No known high/critical CVEs at merge | `npm audit` + Dependabot | **Required addition** — no audit gate exists today |
| Secret exposure | Zero secrets in the repository | Secret scanning + push protection | **Required addition.** `apps/web/.env` (dev-local placeholder credentials) was removed from `HEAD` and `.gitignore`'d on 2026-09-01 — it is untracked from this commit forward. **Residual risk not yet resolved:** the file's content still exists in the commits between `059c99b` and `3402343` and is readable by anyone who fetches the repository's history. It has not been purged (that requires a history rewrite, out of scope for this session — see `10-findings.md` F-28-adjacent note). Rotate/replace the placeholder values before the repository goes public regardless, since a scanner will still flag the historic blob |
| Resource footprint | Runs within 1 vCPU / 1 GB RAM for a small organisation | Measured on the reference deployment | **Not gated, and never was** — documented, not checked |

### 4.2 Per-instance capacity

**One instance serves one organisation.** The design target is a single
organisation of realistic size:

| Dimension | Design target | Notes |
|---|---|---|
| Persons per instance | 10,000 | Comfortably beyond a large swim school |
| Concurrent users | 100 | Instructors during peak lesson blocks |
| Sessions per year | ~50,000 attendance-bearing sessions | Drives the largest tables |
| Retained history | 10 years of exam results, 24 months of attendance detail | Retention doubles as a growth control |

Beyond these numbers the response is measurement, not architecture: index
tuning, a materialised progress summary (D-005), table partitioning for audit
and attendance. Nothing in the design requires a second database, a cache server
or a message broker at this scale (D-020).

**Deliberately not a requirement:** any aggregate figure across organisations.
Instances are independent; "total persons across all deployments" is not a
quantity this system has.

### 4.3 Availability, RPO and RTO — operator guidance

These depend on hardware, network and operator practice that we do not control.
They are therefore stated as **recommended targets with the mechanisms we ship
to achieve them**:

| Goal | Recommended target | What we ship to make it achievable |
|---|---|---|
| Availability | 99.5% monthly | Stateless app, health and readiness endpoints, fast start, no manual migration step |
| RPO | **≤ the configured backup interval; ≤ 24 h with the shipped default** | Scheduled encrypted backups; backup-age warning on the dashboard (D-041). *Sub-hour RPO requires Postgres WAL archiving / PITR, which the operator configures at database level — we neither ship nor test it, and therefore do not claim it* |
| RTO | ≤ 4 h | One-command redeploy; restore in the setup wizard; documented drill |
| Verified recoverability | Quarterly restore drill | Shipped `restore` command; documentation stating a never-tested backup is a hypothesis |

The documentation must state plainly that meeting these is the organisation's
responsibility, and must not imply we monitor or guarantee anything.

---

## 5. User types


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The structural rule underneath all of them: **a person is not an account, and a
member is not a student.** These are three distinct concepts with three
lifecycles (`01-domain-model.md` §3.1).

| Type | Has login? | Primary need |
|---|---|---|
| **Student** | Usually not — most are children | Be registered, progress, be assessed |
| **Member** | Optional | Belong to the organisation; may or may not also be a student |
| **Parent / guardian** | Optional; portal deferred (P-04) | Consent on behalf of a minor; later, view their child's progress |
| **Instructor** | Yes | Register attendance, sign off skills, see their own groups. **The performance-critical user** |
| **Examiner** | Yes, if they record results themselves | Assess candidates and record results — possibly without being a member (§5.2) |
| **Planner / coordinator** | Yes | Schedules, groups, locations, instructor assignment |
| **Member administrator** | Yes | People, memberships, enrolments |
| **Content editor** | Yes | Public website and branding. **No access to person data** |
| **Instance administrator** | Yes, MFA required | Full control **of this installation**: settings, backups, roles |
| **Qualified assessor** | Yes | Grade a child's aftest against the criterion scheme — and, by design, *not* that child's own instructor (R-30). Reaches the student through `SESSION` participation, never a standing grant |
| **Anonymous visitor** | No | Read public pages, find courses, contact the organisation. Can reach **no** private data (D-051) |
| **API consumer** | No — scoped credential | Integrate (P-01) |
| **Lucky (AI dev agent)** | Not a product user | Develop in DEV only; no identity in the application at all (`06-delivery.md` §4) |

### 5.1 Three clarifications that shape the model

**There is no platform super administrator.** Earlier drafts carried one from the
multi-tenant design. It is removed: there is no platform. The highest authority
is the **instance administrator**, whose reach ends at their own installation.
Other organisations run entirely independent instances with no shared identity,
no shared data and no path between them.

**A person may hold several roles within one instance.** The same human can be an
instructor of two groups, a planner for one location and the parent of a student.
Their effective reach is the union of their scoped grants. What is *not*
supported — deliberately — is one identity spanning organisations: a person
working at two swim schools has two records in two independent databases, which
is the correct privacy outcome.

**"Student" is a profile, not an account type.** `StudentProfile` references
`Person`; membership is a third, separate thing. Conflating member administration
with student administration would make it impossible to register a member who
never takes lessons, or a student enrolled by a guardian who is themselves the
member.

### 5.2 External examiners

Swim diplomas are frequently assessed by an examiner who appears for one
afternoon and is not a member of the organisation.

**Decision D-052 — An examiner may exist as a `Person` with no membership. If
they log in or record results themselves, they receive an individual,
time-bounded, minimally scoped account — never a shared or generic one.**

Concretely: their own `UserAccount`, and a grant that reaches only the exam
session they are assigned to, carrying only `exams.assess` and
`exams.results.record`. The grant lapses automatically with the session window,
MFA is required as for any account that can write results, and every action is
attributed to them by name in the audit trail.

**How that grant is expressed changed during review.** D-052 originally rested
on `EXAM_SESSION` as a dedicated scope type (D-054). It now rests on
**`SESSION` participation reach** (R-31): reach follows assignment to a session
and its roster, for a bounded window. The mechanism is stated once, in
`02-security-privacy.md` §2.1, and is not restated here. The change removes an
enum member and covers strictly more real cases — the independent aftest
assessor, the substitute instructor and the receiving instructor of a make-up
lesson were all impossible under the old model, for the same structural reason:
none of them holds a standing grant over the child.

**Reason.** A shared "examiner" login destroys attribution on exactly the records
that most need it — a child's diploma outcome. A full membership over-grants for
someone present for one afternoon.
**Trade-off.** Slightly more administration per exam day. That is the correct
cost for attributable, expiring access.


---

# 01 — Functional Modules & Domain Model


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. Functional modules


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

SplashTrack is a **modular monolith**: one deployable application, internally
divided into modules that own their data, rules, API handlers, authorization
policies, UI and tests. Modules never read each other's tables directly;
cross-module operations go through published application services.

**Decision D-002 — Modular monolith, not microservices.**
**Reason.** The brief demands minimal coupling *and* minimal code *and* no
premature complexity. A modular monolith delivers the first two without the
distributed-systems tax of the third: one database, one transaction boundary,
one deployment, one set of secrets. Module boundaries are enforced by review,
lint rules on import paths, and service interfaces — not by network hops.
**Trade-off.** Boundaries are conventions, so they can be violated by a
careless import; we mitigate with an ESLint `no-restricted-imports` rule per
module. Independent scaling per module is not possible — accepted, because
nothing in the workload justifies it (`07-operations.md` §4).

### 1.1 Module map

Inherited from `WebAppTemplate` (already built, reused as-is):

```text
identity            Person, UserAccount, login sessions, MFA, passkeys
access-control      Roles, permissions, scopes, access groups, assignments
organization        The singleton organisation record, its settings and units
audit               Append-only security & privacy event trail
consent             Consent records with legal basis and authority evidence
pages               Custom pages CMS
profile-fields      Configurable person attributes
users               Account administration
api-credentials     Scoped machine credentials
email-templates     Templated transactional email
notifications       Delivery
maintenance         Scheduled jobs (retention, cleanup)
```

**Naming.** The module is `organization`, singular, and it manages **the**
organisation — its record, settings, branding and unit tree. It is not a tenant
registry, and nothing in the active design uses the word *tenant*. Likewise the
join table is `Membership`, not `OrganizationMembership`: there is only one
organisation to be a member of.

New SplashTrack domain modules (built in v1, in this order):

```text
people              Domain view over Person: relationships, guardians, tags
students            StudentProfile, lifecycle, enrolment state
groups              Group definition and membership over time
courses             Course/programme definitions, levels, enrolment
skills              Criterion catalogue and the informal per-lesson progress log
sessions            ScheduledSession — the shared scheduling primitive
attendance          Attendance events against a session  ← flagship
assessment          Award types, versioned schemes, grades, aftesten, waivers
exams               Exam sessions, candidates, assessors, results, awards
fees                Fee types, charges, payments, balances  ← tracking only
planning            Schedule construction, locations, resources, assignment
```

`assessment` and `fees` are specified in `15-assessment-and-fees.md`. `fees`
tracks money and emits no document (D-091); it is a ledger module, not a finance
system.

### 1.1.1 Removing what single-instance operation does not need

**Decision D-056 — Multi-tenant machinery inherited from the template is
*removed*, not left dormant.**

The template carries a tenant-scoping client extension, per-row tenant columns,
a platform-versus-organisation settings duality, and a platform role and
bootstrap layer. In a single-organisation installation none of it has a
function.

**Reason.** Dormant code is not free. It is attack surface — a scoping extension
that is bypassed everywhere gives a false sense of protection — plus maintenance
load, since every migration and refactor must keep it compiling, and a source of
confusion for anyone reading the codebase to learn how authorization actually
works. Dead security code is worse than absent security code, because it invites
the assumption that something is being enforced.

**Trade-off.** Extraction work up front, and a real divergence from the upstream
template that makes future cherry-picking harder. Accepted: the template is a
starting point, not a dependency we track.

Removed at extraction time: the tenant-scoping extension, tenant columns and
their composite foreign keys, `PlatformSettings` (merged into the organisation
singleton), `PlatformRoleAssignment`, and the platform permission namespace.

**Removal is incremental and test-covered.** Each removal is its own change with
the existing suites green before and after, so that reusable functionality —
authentication, authorization, GDPR tooling, audit, branding, CMS — is not
broken on the way out. Recorded as finding **F-26**.

Deliberately **not** modules: "reporting" (a read concern satisfied by queries
until proven otherwise), "invoicing" (`fees` tracks charges and payments and
stops there — `15-…` §6.5), "website" (the `pages` module plus theming already
is the website).

### 1.2 Dependency rule

Modules form a directed acyclic graph. Arrows point *downward only*:

```text
        planning        exams          fees
            \            /
        attendance   assessment
             |           |
          sessions     skills
              \        /
          groups  ·  courses
                 |
              students
                 |
               people
                 |
  identity / access-control / organization    (foundation)
```

A module may depend on modules below it, never above or sideways without an
explicit published interface. `attendance` may ask `groups` who is in a group;
`groups` may never ask `attendance` anything. Where an upward signal is needed
(e.g. "attendance was registered, update progress"), it goes through a domain
event, not a call.

`fees` sits at the top beside `exams` and depends only on `people` and
`students`. It never calls `exams`, and `exams` never calls it: the exam-fee
charge (D-089) is raised by a domain event published when a candidate reaches
`CONFIRMED`. The gate that `exams` enforces before that (D-085) likewise reads
`assessment` through its published service, never its tables.

**Decision D-057 — `ScheduledSession` is owned by its own `sessions` module.**

An earlier draft had `planning` writing the table and `attendance` reading it —
"one table, two owners", which violates this document's own isolation rule and
would have been the first boundary to erode in practice.

**Reason.** A session is a real domain concept in its own right: a time, a place,
a group, a status. Both `planning` (which creates and reschedules sessions) and
`attendance` (which records against them) are *consumers* of it. Giving it an
owner turns an implicit shared table into an explicit published service, and
makes the exam module's future need for the same primitive a reuse rather than a
duplicate.

**Trade-off.** One more module for a small table. That is the correct cost:
module count is cheap, ownership ambiguity is not.

**Decision D-003 — In-process domain events for upward/sideways signals.**
**Reason.** Keeps `attendance → skills` decoupled without a message broker.
**Trade-off.** Events are synchronous and transactional in v1, so a slow
handler slows the write. Accepted; if that becomes real, the handler moves to
the existing `maintenance` job runner without changing the publisher.

---

## 2. Domain model


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 2.1 The identity spine (inherited, unchanged)

```text
Organization ──< Membership >── Person ──0..1── UserAccount
                                  │
                                  └──< RoleAssignment >── Role ──< RolePermission >── Permission
```

- `Person` is the **canonical identity and biographical anchor**: name, date of
  birth, contact details, and the identifiers by which a human is recognised.

**Decision D-058 — `Person` is the canonical identity record, not the only place
personal data may live. Purpose-specific personal data stays in the module that
owns its purpose.**

Medical and pastoral remarks belong to `students`, not to `Person`. Attendance
belongs to `attendance`. Exam outcomes belong to `exams`.

**Reason.** Data protection is organised around *purpose*, not around tables.
Health data has a different lawful basis, a different permission, different
retention and different encryption from a name and a date of birth; storing it
on `Person` would drag all of that onto the identity record and make
least-privilege impossible — everyone who may see a class list would inherit
access to medical notes.
**Trade-off.** Personal data is spread across modules, so erasure and export
must consult a registry of contributing modules rather than one table. That
registry already exists and is test-enforced (D-014); this decision makes its
necessity explicit rather than accidental.
- `UserAccount` holds **no credentials** — Better Auth owns those. It is the
  optional bridge between a human and a login.
- There is no tenant column. Rows that a scoped role can reach carry `unitId`,
  and reach is resolved centrally by `resolveReach()`
  (`02-security-privacy.md` §2.3).

**Decision D-004 — One `Person` per human per installation. `Person`,
`Membership` and `StudentProfile` are three distinct concepts.**

An installation holds exactly one organisation, so one human is one `Person`
row — rectification and erasure then touch one place. That person may hold
several roles simultaneously (instructor, planner, parent); their reach is the
union of their scoped grants.

**Reason.** Separating the three concepts is what makes the real cases
representable: a member who never takes lessons, a student enrolled by a
guardian who is the member, an instructor who is also a parent, and an examiner
who is neither member nor student (D-052).

**Trade-off.** No continuity between organisations: someone working at two swim
schools has two records in two independent databases. That is the correct
privacy outcome — shared identity across installations would recreate exactly
the cross-organisation data path the distribution model exists to prevent.

### 2.2 The swim domain

```text
Organization
  ├──< Location
  ├──< Course ──< CourseLevel
  │       └──< Enrolment >── StudentProfile
  ├──< Group ──< GroupMembership >── StudentProfile
  │       ├──< GroupMove >── StudentProfile     (up or down, reason-carrying)
  │       └── instructor: Person (assignment, time-bounded)
  ├──< AwardType ──< AssessmentScheme ──< SchemeCriterion
  │                                          └──< SkillProgress >── StudentProfile
  ├──< Assessment ──< AssessmentCriterionResult >── SchemeCriterion
  │       └──< CriterionWaiver
  ├──< ScheduledSession ──< AttendanceEvent >── StudentProfile
  ├──< ExamSession ──< ExamCandidate >── StudentProfile
  │       ├──< ExamAssessor >── Person
  │       └──< ExamResult ──0..1── Award
  ├──< WaitlistEntry >── Person
  ├──< FeeType ──< Charge ──< Payment
  └──< CustomPage    (inherited CMS)

Person ──1──< StudentProfile        (org-scoped)
Person ──<   PersonRelationship >── Person   (guardian ↔ child)
Person ──<   PersonQualification              ("bevoegd" — see `15-…` §2.1)
```

The assessment, award and fee branches are specified in
`15-assessment-and-fees.md`; only their attachment points appear here.

### 2.3 Why these boundaries

**`StudentProfile` is separate from `Person`.** A person is a human; a student
profile is that human's enrolment identity in *one* organisation. It carries
the student number, join date, status, medical remarks and internal notes —
data that must not leak between organisations even when the same human is
known to both.

**`Group` is separate from `Course`.** A course is *what is taught* (Swimming
A, Level 3). A group is *who is taught together, when, by whom*. Conflating
them is the single most common modelling error in this domain: it makes it
impossible to move a student between groups without re-enrolling them, or to
run two groups of the same course. The prototype's `SwimGroup` already
recognised this; we keep it and generalise the name.

**`ScheduledSession` is the join point between planning and attendance.** It is
**owned by the `sessions` module** (D-057); `planning` and `attendance` are both
consumers of it. `planning` creates and reschedules sessions through the owning
service; `attendance` writes `AttendanceEvent` rows against them. The alternative
— attendance inventing its own session concept — guarantees drift, and the
alternative D-057 rejected, "one table, two owners", guarantees an eroded
boundary.

**`SkillProgress` is an event log, not a status column.** Each sign-off is an
immutable row: who signed, when, for which skill, at which session, with an
optional note. The student's "current level" is derived. This is what makes
the workflow auditable, undo-able, and legally defensible when a parent
disputes a diploma decision.

**Decision D-005 — Progress and attendance are append-only event logs.**
**Reason.** Auditability is a stated core principle; a mutable status column
destroys history and makes disputes unresolvable. Append-only rows also make
the offline-tolerance path (P-02) viable, because replaying an event is safe.
**Trade-off.** More rows and a derived-state query on every read. Mitigated
with a materialised `StudentProgressSummary` refreshed on write — added only
when a measured query is slow, not before.

---

## 3. Key entities and relations


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Only fields that carry architectural or privacy meaning are listed. `id`,
`createdAt` and `updatedAt` are implied on every entity; `unitId` is implied on
every entity that participates in unit-scoped reach.

### 3.1 People — three distinct concepts

The single most important structural rule in the domain model: **`Person`,
`Membership` and `StudentProfile` are three different things with three
different lifecycles.** Member administration is not student administration.

```text
Person            the human, and the only PII anchor
  ├─ 0..1  UserAccount      optional login
  ├─ 0..1  Membership       optional: belongs to the organisation
  ├─ 0..1  StudentProfile   optional: takes lessons here
  └─ N     PersonRelationship   guardian of / emergency contact for
```

Every combination is valid and every one occurs in practice:

| Case | Person | Membership | StudentProfile | Account |
|---|---|---|---|---|
| Child taking lessons | ✓ | — | ✓ | — |
| Adult member who also swims | ✓ | ✓ | ✓ | optional |
| Member who never takes lessons | ✓ | ✓ | — | optional |
| Parent who consents for a child | ✓ | optional | — | later (P-04) |
| Instructor | ✓ | ✓ | — | ✓ |
| External examiner (D-052) | ✓ | — | — | temporary, scoped |

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `Person` | givenName, familyName, dateOfBirth, email?, phone? | 0..1 `UserAccount`, 0..1 `Membership`, 0..1 `StudentProfile` | Canonical identity anchor (D-058). One row per human per installation |
| `Membership` | memberNumber, unitId? | 1 `Person`, N `MembershipPeriod` | **One per person, for life.** The number stays the same across gaps |
| `MembershipPeriod` | membershipId, startedAt, endedAt?, endReason? | 1 `Membership` | Belonging is a set of intervals, not a status flag |
| `StudentProfile` | studentNumber, unitId | 1 `Person`, N `StudentLifecycleEvent`, N `Enrolment`, N `GroupMembership` | **Persistent.** Created once, never duplicated on return |
| `StudentLifecycleEvent` | studentProfileId, type (`JOINED`/`PAUSED`/`LEFT`/`RETURNED`/`TRIAL_ATTENDED`), occurredAt, reason? | 1 `StudentProfile` | Append-only lifecycle history; current state is derived |
| `PersonRelationship` | type (`GUARDIAN_OF`, `EMERGENCY_CONTACT`), fromPersonId, toPersonId, authority, evidence, validFrom, validTo? | Person ↔ Person | **v1.** `authority` records whether this relationship may consent on behalf of the subject (R-04); `evidence` records *how the claim was established* and is **non-optional where `authority = true`** (D-063). Every change audited |
| `PersonQualification` | personId, type, validFrom, validTo? | 1 `Person` | *"Een leraar die bevoegd is"* — what makes someone eligible to conduct an *aftest* (`15-…` §2.1) |
| `WaitlistEntry` | personId, studentProfileId?, courseId?, requestedAt, source (`INQUIRY`/`MANUAL`), status (`WAITING`/`PLACED`/`WITHDRAWN`), note? | Person, 0..1 `Inquiry` | The front door. Placement creates the `StudentProfile`/`Enrolment`; the entry is closed, not deleted |

**Decision D-059 — Leaving and returning is modelled with periods and lifecycle
events, never by creating a second profile or flipping a status.**

One `Membership` per person with many `MembershipPeriod` rows; one persistent
`StudentProfile` with an append-only `StudentLifecycleEvent` history. Returning
creates a new period and new `Enrolment` / `GroupMembership` rows — it never
creates a second profile.

**Reason.** A returning swimmer is the same human with the same history, and that
history is the product's value: their skills, their diplomas, their previous
groups. A second profile fragments it and duplicates PII, which then has to be
merged by hand and re-erased twice. A status flag, meanwhile, silently destroys
the answer to "when were they a member?" — which matters for contributions,
insurance and retention.
**Trade-off.** Current membership and current student status are derived rather
than read from a column. A small derived-state helper covers it, and it is the
same append-only reasoning used for progress and attendance (D-005).

**Decision D-060 — Membership is never an implicit prerequisite for a role.**

Authorization comes exclusively from role assignments and their scopes
(`02-security-privacy.md` §2). An instructor, planner or examiner may hold a role
with no `Membership` at all, and holding a membership grants nothing by itself.

**Reason.** Membership is an *administrative and often financial* relationship;
authorization is a *security* concern. Conflating them means a volunteer
instructor who is not a paying member cannot be given access without inventing a
fake membership — and worse, it creates the reverse expectation that members
implicitly have rights. If an organisation genuinely wants "instructors must be
members", that is a configurable business rule they enable, checked at
assignment time, not an assumption baked into the model.
**Trade-off.** Two things to administer where a naive model has one. The UI
offers them together when adding a person, so the cost is conceptual, not
clerical.

**Decision D-053 — `Membership` and `StudentProfile` are separate tables, never
one table with a flag.**
**Reason.** They have different numbering, different lifecycles (a member can
leave while their diploma history is retained for ten years), different
retention rules and different permissions. A single table with a `isStudent`
flag would force one retention policy onto both and make "member who never
swims" awkward to represent.
**Trade-off.** Two lookups where a naive model has one, and administrators must
understand the distinction. The UI hides it: adding a person offers both
options.

**Guardian authority is a v1 requirement, not just a relationship.** Almost all
data subjects here are children who cannot legally consent. A consent record
therefore references both the **subject** person and the **consenting** person,
and is only valid if a `GUARDIAN_OF` relationship with `authority = true` existed
at the time it was given. That is why the relationship carries validity dates and
is audited: consent evidence that cannot be traced to the authority behind it is
not evidence.

### 3.2 Teaching structure

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `Course` | name, description, active | N `CourseLevel`, N `Enrolment` | What is taught |
| `CourseLevel` | name, sequence, awardTypeId? | 0..1 `AwardType` | E.g. Diploma A → B → C. `awardTypeId` says what the level prepares for; the requirements themselves live on that award's scheme (`15-…` §2.6) |
| `Enrolment` | studentProfileId, courseId, status (incl. `TRIAL`), startedAt, endedAt? | Student ↔ Course | Status is a lifecycle, not a payment state (P-03 and D-093). `TRIAL` marks a *proefzwemmer* — a prospective pupil attending once |
| `Group` | name, courseLevelId?, capacity?, active | N `GroupMembership`, N `ScheduledSession` | Who is taught together |
| `GroupMembership` | studentProfileId, groupId, fromDate, toDate? | | **Time-bounded** — moving groups is a new row, not an update |
| `GroupMove` | studentProfileId, fromGroupId?, toGroupId, direction (`UP`/`DOWN`/`LATERAL`), reason, decidedByPersonId, occurredAt | N `GroupMembership` | The *action* behind the two membership rows. Both directions are ordinary history — see D-108 |
| `SessionRosterEntry` | sessionId, studentProfileId, source (`GROUP`/`GUEST`), reason? | 1 `ScheduledSession` | The roster of a session is derived from the group **plus** any explicitly added guests. A make-up lesson is a `GUEST` entry; nothing else about it is modelled |
| `InstructorAssignment` | personId, groupId \| sessionId, role, fromDate, toDate? | | Instructors change; history is preserved |
| `Location` | name, address?, capacity? | N `ScheduledSession` | Pools, halls |

**Decision D-108 — Moving a child to another group is recorded as a `GroupMove`
carrying a direction and a reason, and moving *down* is ordinary history, not a
correction.**

Progress in this domain is per individual, not per group: a faster child moves
up mid-block, and a child who is struggling moves back down. The domain expert
described both as normal.

**Reason.** `GroupMembership` already carries the *data* — two time-bounded rows.
What is missing is the *act*: who decided, when, and why. Without it, a move down
is indistinguishable from an administrative error, and the screen that renders
the child's history will present it as one. A parent reading "moved from Group 4
to Group 3" with no reason attached draws the worst conclusion available; the
same row with *"meer tijd nodig voor de schoolslagbeenslag"* is a teaching
decision. Recording the direction explicitly, rather than deriving it from level
sequence, also keeps a lateral move (a different evening, the same level) from
being reported as a demotion.

**Trade-off.** One more row per move, and a required reason on an action
administrators would rather do in two clicks. Accepted: the reason is the entire
value of the record.

**Decision D-109 — Trial lessons, waiting lists and make-up lessons are
*modelled*; no workflow is built for them in v1.**

What exists: `Enrolment.status = TRIAL`, `StudentLifecycleEvent.TRIAL_ATTENDED`,
`WaitlistEntry` with a placement action from an `Inquiry`, and
`SessionRosterEntry` accepting a student who is not a member of the session's
group. What does not exist: a trial-booking flow, a conversion funnel, a
shortened onboarding path, a make-up entitlement counter, a "this child is owed
two lessons" ledger, or a slot-booking screen.

**Reason.** The waiting list is in daily use and gets its placement action. The
other two the domain expert explicitly asked to *"houd rekening met"* while
saying **his own school does not run them** — so a workflow would be built for a
customer who does not exist, which is precisely the charge this review levelled
at the rest of the design. The data shape, though, is genuinely expensive to
retrofit: attendance for a child who is not in the session's group touches the
roster, reach resolution and the attendance aggregate at once. Model now, build
never or build on request.

**Trade-off.** A school that does run trials and make-ups administers them by
hand — a guest added to a roster, a note in the reason field. That is a worse
experience than a designed flow and a better outcome than a designed flow nobody
opens.

### 3.3 Skills and progress

**The criterion catalogue lives in `15-assessment-and-fees.md` §2, not here.**
An earlier draft carried `Skill` and `SkillRequirement` — "criteria per level,
assessed per student" — alongside the versioned `SchemeCriterion` that the
assessment model needs. They are the same concept with a different result type,
and D-084 collapses them into one: `SchemeCriterion` is the single catalogue.
This *removes* a table and a seed catalogue rather than adding one.

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `SchemeCriterion` | schemeId, code, name, sequence, minimumGradeId? | 1 `AssessmentScheme` | The single criterion catalogue. Versioned and source-labelled — `15-…` §2.1, D-081, D-083 |
| `SkillProgress` | studentProfileId, criterionId, state, assessedByPersonId, assessedAt, sessionId?, note? | 1 `SchemeCriterion` | **Append-only**, and **informal**: the per-lesson teaching log. `state` ∈ {INTRODUCED, PRACTISING, ACHIEVED, REVOKED} |
| `AssessmentCriterionResult` | assessmentId, criterionId, gradeValueId, remark? | 1 `Assessment`, 1 `SchemeCriterion` | The **formal** graded observation, made during an *aftest* or an exam. `15-…` §2.1 |

`SkillProgress` is what an instructor writes at the poolside; it decides nothing.
`AssessmentCriterionResult` is what a qualified assessor writes during an
*aftest*; it decides whether a child sits an exam. Keeping both, against one
catalogue, is deliberate — the informal log is the product's daily value and the
formal result is its evidential one.

### 3.4 Attendance

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `ScheduledSession` | groupId, locationId, startsAt, endsAt, status | N `SessionRosterEntry`, N `AttendanceEvent` | **Owned by `sessions`** (D-057); `planning` and `attendance` are both consumers |
| `AttendanceEvent` | sessionId, studentProfileId, state, recordedByPersonId, recordedAt, `clientEventId`, `supersedesEventId?`, note? | | **Append-only.** `state` ∈ {PRESENT, ABSENT, EXCUSED, LATE}. A correction is a *new* event pointing at the one it replaces — the superseded row is never modified. `clientEventId` is a client-generated UUID making the write idempotent (P-02) |
| *(derived)* `AttendanceStatus` | sessionId, studentProfileId → effective state | | The current answer per student per session: the latest event not superseded by another. Materialised only if measurement demands it |

**Decision D-061 — Attendance is an append-only event log; a correction never
mutates an existing row.**

An instructor who marked a child absent and then finds them in the water writes
a *new* event carrying `supersedesEventId`. The effective status is derived: the
latest event for that student and session that nothing supersedes.

**Reason.** "Append-only" was previously asserted while the model still allowed
an in-place update, which would have quietly destroyed exactly the history the
claim promises. Attendance is evidence — for absence policy, for parental
disputes, and occasionally for safeguarding. Who said a child was present, and
when they changed their mind, is precisely what must survive.
**Trade-off.** Reads need a derived-state resolution instead of a direct column,
and the table grows with corrections. Both are cheap; a `(sessionId,
studentProfileId, recordedAt)` index answers the derivation directly.

**`clientEventId` is the single most important forward-looking field in the
schema.** It costs one indexed column now and is what makes offline-tolerant
attendance a feature addition rather than a rewrite. A retry, a double-tap or a
replayed offline queue all collapse to the same event.

### 3.5 Exams

| Entity | Key fields | Relations | Notes |
|---|---|---|---|
| `ExamSession` | courseLevelId, locationId, scheduledAt, status | N `ExamCandidate`, N `ExamAssessor` | |
| `ExamCandidate` | examSessionId, studentProfileId, status | **0..N** `ExamResult` | A candidate may have several results over time: an original, a correction, an appeal outcome. Reaching `CONFIRMED` requires a passed independent *aftest* — D-085, `15-…` §3 |
| `ExamAssessor` | examSessionId, personId, role | | Records **who assessed** this session — an attribution fact, not an access grant. Access comes from an `EXAM_SESSION`-scoped role assignment (D-054). Supports the external examiner with no membership (D-052) |
| `ExamResult` | candidateId, outcome, recordedByPersonId, recordedAt, `supersedesResultId?`, reason?, remarks?, assessmentId? | 0..1 `Award` | **Append-only.** A correction is a new row pointing at the one it replaces. The **effective result** is the latest non-superseded row; exactly one exists per candidate at any time. `assessmentId` points at the exam-day per-criterion detail where it was recorded |
| `Award` | resultId, awardTypeId, number, issuedAt, revokedAt?, revokeReason? | 1 `AwardType` | The issued document. Issued against a *specific* result; correcting a result revokes the award and issues a new one — never edits it. **Renamed from `Certificate` (D-082)**, because in this domain a *certificaat* is a different kind of award, not the proof of a diploma |

**Decision D-062 — A candidate has 0..N results, not 0..1.**
**Reason.** A single-result model forces a correction to overwrite the original,
destroying the record of what was first decided and by whom — on a diploma
outcome, the one thing that must stay reconstructable. Appeals and
administrative corrections are normal in this domain, not exceptional.
**Trade-off.** Every read resolves the effective result rather than following a
single relation. One indexed lookup, and it is the same derivation pattern used
for attendance (D-061) and skill progress (D-005) — one concept, not three.

### 3.6 Scoping invariant

There is no tenant column. Instead, every entity that can be *reached* by a
scoped role resolves to a position in the organisational unit tree. `Group`
carries `unitId`; `ScheduledSession` inherits its unit from its group;
`StudentProfile` carries its home `unitId`. Reach resolution (§2.3 of
`02-security-privacy.md`) walks that tree, and every list query is filtered by
it.

**Decision D-006 (withdrawn) — `organizationId` is *not* carried on domain
rows.**
**Reason.** With one organisation per database the column is a constant. It
would be dead weight on ~20 tables, and a constant column gives no protection
while implying one, which is worse than absent. Domain rows instead carry
`unitId` where the organisational unit is meaningful — that is the column that
actually constrains access now (`02-security-privacy.md` §2).
**Trade-off.** Consolidating instances into a shared database later would
require adding the column and a backfill. Accepted deliberately; the brief
rules out multi-tenancy, and designing for a rejected model is exactly the
premature complexity the brief warns against.

---

## 4. Aggregate and transaction boundaries


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| Aggregate | Root | Transactionally consistent with |
|---|---|---|
| Person + account | `Person` | Its `UserAccount`, its memberships |
| Student | `StudentProfile` | Its enrolments and group memberships |
| Session attendance | `ScheduledSession` | All its `AttendanceEvent` rows — **one transaction per group registration** |
| Assessment | `Assessment` | All its `AssessmentCriterionResult` and `CriterionWaiver` rows, and the computed outcome (`15-…` §2) |
| Exam | `ExamSession` | Candidates, assessors, results |
| Charge | `Charge` | Its `Payment` rows and the derived balance (`15-…` §6) |
| Organisation config | `Organization` | Branding, settings, pages |

Registering attendance for a group writes all records in **one transaction**.
Partial attendance is not a valid state — an instructor who saves must know it
either all landed or none did.

---

## 5. Data ownership


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

"Ownership" answers four questions per data class: which module may write it,
who may reach it, on what lawful basis it is held, and what happens when that
basis expires.

**All retention below is a *default proposal*, not a rule we impose.** Each is a
`RetentionPolicy` the organisation confirms or changes, with `onExpiry` being
`DELETE`, `ANONYMISE` or `REVIEW` (`02-security-privacy.md` §5.6, D-065).

**Decision D-110 — The retention table records a lawful basis per data class.**
The column existed in the prose describing this table ("on what lawful basis it
is held") and not in the table itself, so the one question an organisation must
answer to defend a default was the one the defaults did not state. A proposed
basis can be argued with; a blank cannot. Where the entry reads *unresolved*, it
is unresolved and must be settled before that default ships (F-128).

| Data class | Writing module | Reach | Lawful basis (proposed) | Trigger | Default retention | On expiry |
|---|---|---|---|---|---|---|
| Person identity | `identity` | Instance-wide | Contract / legitimate interest | Last relationship of any kind ends (§5.1) | 24 months | `REVIEW` → delete |
| Login credentials | Better Auth | Instance-wide | Contract | Account closed | Immediate | `DELETE` |
| Membership periods | `people` | Unit | Contract; legal obligation where a fiscal record depends on it | Last period ends | 7 years (financial/administrative, if applicable) | `REVIEW` |
| Student profile | `students` | Unit | Contract | Last enrolment ends | 24 months | `REVIEW` |
| Medical / pastoral notes | `students` | Unit + `students.medical.read` | **Explicit consent** (Art. 9) | Last enrolment ends | 12 months | **`DELETE`** — never anonymise |
| Assessment remarks | `assessment` | Group + `students.notes.read` | Legitimate interest (teaching) | Assessment date | 12 months | **`DELETE`** (D-087) |
| Attendance events | `attendance` | Group | Contract | Session date | 24 months | **`DELETE`** — see §5.3 |
| Skill progress | `skills` | Group | Contract | Achievement date | 7 years | `REVIEW` |
| Assessment results (formal) | `assessment` | Course / instance | Contract; legal claims where a ground applies | Assessment date | 7 years | `REVIEW` |
| Exam results & awards | `exams` | Course / instance | *Unresolved* — a ground must be identified per organisation (§5.2) | Award issue | 10 years **only where a retention ground applies** | `REVIEW` (§5.2) |
| Charges | `fees` | `fees.read` | Legal obligation — fiscal administration | Charge due date | 7 years | **`PSEUDONYMISE`** (D-092) |
| Payments | `fees` | `fees.read` | Legal obligation — fiscal administration | Received date | 7 years | **`PSEUDONYMISE`** (D-092) |
| Consent records | `consent` | Instance-wide | Legal obligation — accountability (Art. 5(2)) | Withdrawal or expiry of purpose | As long as needed to demonstrate compliance | `REVIEW` |
| Audit events | `audit` | `audit.read` | Legitimate interest — security, and Art. 5(2) accountability | Event date | **To be reconciled — see note below.** Floor 12 months (D-149/D-150); shipped default currently 24 months | `DELETE` |
| Inquiries (public forms) | `pages` | Instance-wide | Legitimate interest — responding to a request | Submission | 6 months | `DELETE` |
| Waitlist entries | `students` | Unit | Legitimate interest — placing a request | Placement or withdrawal | 12 months | `DELETE` |
| **Pre-migration backups** | `maintenance` | Operators | Legitimate interest — recoverability | Migration run (D-044) | **Deleted after the next successful start; at most 3 retained** | `DELETE` |
| Public page content | `pages` | Instance-wide | — (no personal data) | — | Until deleted | — |
| Organisation settings & branding | `organization` | Singleton | — (no personal data) | — | Indefinite | — |
| Operational logs | `lib/logging` | Operators — **no PII** | Legitimate interest — operations | Write | 30 days | `DELETE` |

**Note on the audit row (F-133).** Audit events must be retained *at least as
long as the longest-retained data class whose changes they evidence*. Exam
results and awards are kept up to 10 years while the record of **who** entered
an outcome would expire at 24 months — eight years before the outcome it
attributes, in a design that justifies append-only results with "a parent
disputes a diploma decision". The shipped default must be reconciled with the
7–10 year classes above. If reconciliation is rejected on volume grounds, the
consequence is stated in the privacy screen as an explicit limit on what the
organisation can reconstruct, rather than left implicit.

**On the pre-migration backup row.** D-044's automatic backup before a migration
is the right behaviour and it had **no retention policy at all** — meaning a full
copy of the database, including medical notes, accumulated once per upgrade and
outlived every rule in this table. A backup taken as a safety net is only needed
until the thing it protects against has not happened: delete it after the next
successful start, and keep at most three so that a bad migration discovered late
is still recoverable. Recorded as **F-49**.

### 5.1 People with no membership are not an edge case

The most common person in the database — a child taking lessons — has **no
membership at all**. Neither do guardians, external examiners, or former
students. A retention rule keyed on "active membership" would therefore miss the
majority of data subjects, silently retaining them forever.

**Decision D-066 — Person retention is triggered by the end of the person's
*last relationship of any kind*, not by membership.**

Relationships that hold a `Person`: an active `MembershipPeriod`; an active
`StudentProfile` enrolment; a role assignment (instructor, planner, examiner —
including an expired-but-within-retention exam assessment); a guardian
relationship to a person still held; an unexpired consent record; or a legal
retention ground on a record referencing them.

When the last one lapses, the person enters `REVIEW` and, after the configured
period, is deleted or genuinely anonymised. A guardian is held only while the
child they are guardian *of* is held — which follows automatically from the
rule rather than needing a special case.

**Reason.** Every person category must be covered by construction, because the
one that is forgotten is the one that accumulates indefinitely.
**Trade-off.** "Last relationship" is a computed condition over several modules
rather than a column, so it belongs to the same registry that erasure uses
(D-014) and is covered by the same test that asserts every `Person`-referencing
table is registered.

### 5.2 Awards and the right to erasure — honestly

An erasure request does **not** automatically lose to a diploma register.

The organisation must identify an actual ground for retention — a legal
obligation, or the establishment or defence of legal claims. Many swim schools
will have none, in which case the award record is deleted or genuinely
anonymised like anything else. Where a ground does exist, the record is retained
**with that ground recorded against it**, the data subject is told which records
were kept and why, and the retention is revisited when the ground expires.

And where an award number remains looked-up-able, the honest statement is that
the record is **pseudonymised, not anonymous** — it is still personal data
(D-065). Telling a parent otherwise would be wrong, and the privacy notice must
not do so. Finding **F-06 (revised)**.

### 5.3 Attendance does not "anonymise to aggregate"

**Decision D-111 — Expired attendance events are **deleted**, not anonymised.**
What may be kept is a genuinely aggregate counter that no longer references a
student — and it is kept because it was computed, not because a row was stripped.

The previous default said `ANONYMISE` to aggregate. Stripping the student
reference from an attendance event does not produce anonymous data here. A group
holds around twelve children, `GroupMembership` is retained and time-bounded, and
session dates are known. Anyone with both tables can re-identify a large share of
the stripped rows by a join and a counting argument — twelve memberships, eleven
present, one absent, and the absent child is whoever the roster says was not
counted. That fails the mechanical test for anonymisation being written into
`02-security-privacy.md`, and calling it anonymisation in a privacy notice would
be the same false comfort D-065 exists to prevent.

**Reason.** Anonymisation claims must survive the joins the same database makes
trivial. If a row can be re-identified from data the application itself retains,
it was pseudonymised, and pseudonymised data is still personal data with the same
obligations — so nothing was gained by not deleting it.

**Trade-off.** Attendance-rate history beyond the retention window is lost unless
someone deliberately computes and stores an aggregate first. That is the correct
order: decide what statistic is worth keeping, compute it, keep that — rather
than keeping the raw rows and calling them anonymous. Recorded as **F-48**.


---

# 02 — Security & Privacy Architecture


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Security is not a section of this design; it is the constraint the rest of the
design was shaped around. This document states the rules that any
implementation must satisfy.

## 1. Security architecture — foundations


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 1.1 Non-negotiable rules

1. **All security decisions are enforced server-side.** Hiding a button is not
   authorization. UI gating and authorization are separate code paths with
   separate functions (`hasPermission` for UI, `requirePermission` for the act).
2. **Deny by default.** Missing arguments, absent membership, missing
   permission, or *any unexpected failure including the database being
   unreachable* result in denial. Nothing ambiguous becomes an allow.
3. **Route handlers are thin:** authenticate → validate → authorize → call
   service → standardized response. Business logic never lives in a handler,
   so the portal and a future API cannot diverge in their security behaviour.
4. **Never trust any client** — browser, tablet, API consumer or Lucky.

### 1.2 Authentication

Inherited from the template (Better Auth), unchanged:

- Secure, HTTP-only, `SameSite` cookies; session rotation after sensitive
  events; protection against session fixation.
- Defined **idle and absolute** session timeouts. For SplashTrack the idle
  timeout matters unusually much: tablets are shared at the poolside and left
  unlocked. Proposal: idle 30 min for instructor roles, 15 min for admin roles,
  absolute 12 h. See open decision OD-6.
- **MFA is mandatory, bound to permissions rather than to role names (D-130).**
  Any principal holding any permission in the **high-risk set** —
  `organization.settings.manage`, `identity.providers.manage`, `roles.assign`,
  `roles.manage`, `accessgroups.assign`, `privacy.*`, `audit.read`,
  `backup.*`, `students.medical.*` — at **any** scope must have a verified
  second factor. Enforced twice: at login, and **at grant time**, so granting a
  high-risk permission to an account with no factor fails rather than creating
  an unprotected administrator. The earlier text named `platform.super_admin`
  and "organisation administrator roles"; the first does not exist (D-056) and
  the second is not a checkable predicate, because roles are user-definable.
  Passkeys are supported and preferred — they are also the best answer to "wet
  hands, shared tablet, hostile to typing passwords".
- **The MFA mandate is not a setting.** It is an *invariant* in the settings
  classification of §4.1: not editable in the UI, not clearable by
  `settings:reset`, no override flag. A mandate that ships as a checkbox is a
  default, and the account that can clear it is the account it protects.
- Sessions invalidate immediately when an account is disabled. That is a
  consequence of disabling, **not** a containment control — bulk revocation is
  a breach-response capability and lives in `07-operations.md` §1.4 (D-128).
- Step-up re-authentication for: role changes, API credential creation, MFA
  reset, bulk export, erasure, certificate revocation. **Step-up is a freshness
  control, not an authorization control** — it proves the person at the keyboard
  is the account holder, and it is worth nothing against an actor who *is* the
  account holder. Every place this document leans on step-up alone against an
  insider threat is a place that also needs an anti-amplification rule (§2.6),
  an audit event, or a notification to a second administrator.

**Decision D-008 (reaffirmed, with the alternative examined) — Use Better Auth
as a self-hosted library for identity and sessions; do not write our own
authentication system. It is never the authorization layer.**

**On the "third party" concern.** Better Auth is a **library**, not a service.
It runs inside our own process, writes to our own PostgreSQL, and maps onto our
own `UserAccount` / `Account` tables — verified in `WebAppTemplate`'s
`src/lib/auth/auth.ts`. No request leaves the deployment, no vendor holds any
data, and there is no account to cancel. This is categorically different from
Auth0, Clerk or Cognito, which *are* third-party services and would be
unacceptable for this product.

**Reason for not building our own.** Authentication is a large, high-consequence
surface with zero product differentiation. Writing it means owning, forever and
correctly: password hashing and policy, session issuance/rotation/revocation,
CSRF, secure-cookie semantics, TOTP enrolment and verification, WebAuthn
registration and assertion ceremonies, OAuth 2.0 / OIDC clients with PKCE and
issuer validation, token refresh, account linking, email verification, password
reset tokens, brute-force throttling and step-up flows. Every one of those has
a well-known way to get subtly wrong. In an **open-source** product the source
is public, so an attacker reads our implementation rather than guessing at it,
and the data at risk is health information about children. This is the clearest
"do not roll your own" case in the entire design.

**Trade-off — stated honestly.** We take a dependency on a young ecosystem
library for a critical function. Mitigations, all real: it is MIT-licensed and
self-hosted, so it cannot be taken away; the schema is **ours**, so the data
survives any replacement; and all of it sits behind our own `identity` module
boundary, so swapping the implementation is a contained refactor rather than a
rewrite. Recorded as finding **F-22**.

### 1.2.1 Identity providers are configured in the application, not in env vars

**Decision D-035 — A database-backed identity-provider registry, administered
in-app, supporting local accounts plus any OAuth 2.0 / OIDC provider.**

**Reason.** A self-hosted operator (D-012 final) must be able to connect their
own identity provider — Microsoft Entra, Google Workspace, Keycloak, Authentik,
Okta — **without editing environment variables, rebuilding an image or
restarting a container**. Requiring env-var configuration for something an
administrator legitimately changes would be a usability failure for exactly the
audience the product is built for.

This is not speculative: `WebAppTemplate` already proves the pattern for one
provider (ADR-022). The Entra configuration lives in the database with the
client secret **encrypted at rest**, is edited through a permission-guarded
admin screen that never returns the secret to any client, and is loaded by
Better Auth at context init. SplashTrack generalises that from a single
hardcoded provider to a registry of N providers, using Better Auth's
`genericOAuth` plugin — which supports any OAuth 2.0/OIDC provider with PKCE
and issuer validation enabled by default.

Per provider the registry stores: display name, protocol, issuer/discovery URL,
client id, encrypted client secret, scopes, claim→field mapping, and whether
just-in-time account creation is allowed.

**Status: out of v1** (D-120, `00-overview.md` §3.5.1). The first and only
operator for the next year runs no Entra, no Google Workspace and no Keycloak,
and a provider registry is purely additive. D-035 is retained on paper. The
hardening below is therefore **not** a v1 build item — it is the set of
preconditions that must be satisfied *before* the registry is built, recorded
now because the registry as originally specified was an account-takeover
primitive and would have been built that way.

**Trade-off.** Storing secrets in the database makes key management a
first-class operational concern (answered since OD-7 was written: D-112's
`SECRET_KEY_FILE` and D-114's two-level envelope).

#### D-035 is not safe as originally specified

The registry as first written let anyone holding `organization.settings.manage`
add an identity provider they control, map its `email` claim onto an existing
account, pass the mandatory "test connection" against their own IdP, and sign in
as the instance administrator. MFA on the local account is not touched, because
the local method is never used. A second path: edit only the *token endpoint* of
an existing provider and leave the stored secret in place — on the next login the
application posts that client secret to an attacker-controlled endpoint. The
promise that the secret is "never returned to any client" is true and irrelevant;
a control that hides a secret from reads while allowing a redirect of where it is
*sent* is not a control. Finding **F-110**.

**Decision D-140 — Identity-provider administration is a separate, high-risk
permission; external identities link on `(issuer, sub)` only; JIT creates
nothing.** Every clause is a precondition for building the registry:

| Rule | Why |
|---|---|
| `identity.providers.manage` is its own permission, never implied by `organization.settings.manage`, in the high-risk set that compels MFA (§1.2) | "Office manager can edit settings" must not mean "office manager can mint administrators" |
| Create / enable / edit of a provider requires step-up **and** raises a high-severity audit event **and** notifies every `ORGANIZATION`-scoped administrator | The threat is an authorised insider, so step-up alone is worth nothing (§1.2). A second pair of eyes is the control |
| An external identity is bound to a `UserAccount` **only** by `(issuer, sub)`, established either by a link ceremony performed while already authenticated locally, or by an administrator naming the external subject explicitly | The email claim is attacker-chosen in the attack above. `(issuer, sub)` is the only pair an attacker cannot assert about *someone else's* IdP |
| Email is never a linking key. If it is ever used to *suggest* a link, it requires `email_verified = true` **and** an administrator-approved domain allow-list, and still requires confirmation | Same reason, stated so nobody re-adds it as a convenience |
| **JIT provisioning creates nothing.** The "which role a JIT account receives" field is deleted, not defaulted to none | A field whose only safe value is "none" should not exist; the next person to read it will treat it as a feature. OD-8's own recommendation, promoted from recommendation to rule |
| Changing the issuer, token or userinfo endpoint **clears the stored client secret** and forces re-entry | Kills the exfiltration-by-redirect path structurally rather than by review |
| An account holding any `ORGANIZATION`-scoped grant may not authenticate through an external provider unless that account is explicitly opted in, per account | The highest-value accounts do not get their authentication delegated by an administrator's settings change |
| Provider destinations are fetched through the egress-controlled client of §1.2.2 | Discovery URLs are admin-supplied and server-fetched (B-17) |

**Reason.** Every one of these is cheap while the registry is on paper and
expensive once it exists. Recording them here means the registry cannot be
built from D-035 alone.
**Trade-off.** Linking on `(issuer, sub)` means an organisation migrating IdPs
must re-link accounts rather than relying on stable email addresses. That is the
correct friction: an email address is an identifier the organisation does not
control.

#### The lockout safeguard as written cannot be enforced

The original trade-off named two "mandatory mitigations": *local administrator
login can never be disabled while it is the only working method*, and *a
provider must survive a test connection before it can be enabled*. Neither
works, and both were load-bearing:

- **Trivially bypassed.** Configure a second provider — including one the
  attacker controls — and local login is no longer "the only" method. Every
  check passes at every step.
- **"Working" is not decidable.** A provider that passed a test at 14:00 stops
  working at 14:05: certificate expiry, a tenant policy change, an admin removed
  from an Entra group, a discovery endpoint the *application* can reach and
  *users* cannot. The application cannot observe any of that. It is a
  point-in-time assertion sold as a continuous invariant.
- The test-connection gate has the same shape: it proves the application can
  reach the IdP once, not that a human can log in through it.

**Decision D-141 — The recovery path from an authentication misconfiguration is
the break-glass CLI, stated plainly; the enforceable invariant is a local
administrator with a verified second factor, checked at the database.**

- The documentation says, in the words an operator needs: *"Misconfiguring SSO
  can lock you out of your own instance. Recovery is `splashtrack
  admin:grant-admin` from the host. Do not enable SSO on an instance you cannot
  reach a shell on."* The break-glass CLI (`13-configuration-and-setup.md` §7)
  is genuinely sound because it depends on host access rather than on a
  network-reachable secret — so it, not the deleted claim, is the control.
- At least one **local** `ORGANIZATION`-scoped account with a **verified** MFA
  factor must exist at all times. Enforced as a database-level invariant, and
  re-evaluated on every change to authentication settings, on every role
  revocation and on every account disable — not only at the moment SSO is
  switched on.
- The test-connection gate is kept, and demoted honestly: it catches typos. It
  is not a safety net.

**Reason.** An unenforceable safeguard is worse than an absent one, because the
design stops looking for the real control. Finding **F-111**.
**Trade-off.** The honest statement is less reassuring than the deleted claim.
It is also the one an operator can act on.

### 1.2.2 Admin-supplied URLs are fetched through one egress-controlled client

Four surfaces let an administrator name a destination the *server* then
connects to: the OIDC discovery/issuer URL (§1.2.1), the SMTP test-send
(`13-configuration-and-setup.md` §7), the backup destination endpoint when one
ever exists (`14-…` §3.2, out of v1 per D-103) and the version check
(`03-deployment-model.md` §2.1). The words SSRF and egress appeared nowhere in
the design set. Finding **F-118**.

**Decision D-142 — Every outbound request to an administrator-configured
destination goes through one shared client with a deny-by-default egress
policy.**

- Deny RFC1918, loopback, link-local (including `169.254.169.254`), and the
  IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped forms), unless
  an explicit, audited **"allow private networks"** setting is enabled — which
  a self-hoster running an internal Keycloak or an internal SMTP relay
  legitimately needs, and which is exactly why it must be a deliberate,
  recorded act rather than the default.
- **Resolve, then pin the resolved address** for the life of the request, so a
  name that resolves publicly on validation and privately on connection (DNS
  rebinding) does not slip through.
- No redirect following. Hard connect and total timeouts. A response size cap.
- **Never return the response body, status line or a distinguishing error to
  the client.** The UI says "test failed"; the detail goes to the server log.
  An error message that differs between "connection refused" and "connection
  timed out" is a port scanner.

**Reason.** The instance is typically the only thing the organisation has
exposed, and three of these four surfaces exist specifically so an administrator
can point the server at an address they choose. Without this, the settings page
is a proxy into the operator's LAN and, on a cloud host, a path to the
instance-metadata service.
**Trade-off.** A self-hoster whose IdP or mail relay is on the same private
network must find and enable one setting before the test succeeds, and the
error will not tell them why. The setting's help text says so; the alternative
is a scanner shipped by default.

### 1.3 Session security at the poolside — what replaced `SHARED_DEVICE`

The instructor workflow runs on a shared device in a wet, public environment.
That threat is real and the generic template does not address it. The *control*
originally proposed for it does not survive contact with the environment.

**Decision D-009 — (Superseded by D-143 and D-120.) A session could be marked
`SHARED_DEVICE`, shortening idle timeout, suppressing PII, blocking export and
admin routes, and requiring step-up to leave the attendance context.** Retained
here as history because three of its four behaviours are kept — by simpler
means.

**Why it did not survive.** It was **opt-in by the party it restricts.** "A
session *may be marked* `SHARED_DEVICE`" never said by whom. If the instructor
chooses at login it is voluntary, and the one of its four behaviours they meet
first — the shortened idle timeout, on a wet tablet, with a queue of children —
is the one they will turn off. If it is a device cookie, whoever holds the
tablet clears it. If it is a network heuristic, that was never stated. And it
was cited as *the* mitigation for two separate High risks and for FM-13, so the
strongest control in the poolside threat model was a self-declaration.
Finding **F-127**.

**Decision D-143 — Device mode is a property of an administrator-enrolled
device or of the role, never of the session holder. In v1 it is not built at
all; its effect is obtained from the permission set and the idle timeout.**

What v1 actually ships (D-120, `00-overview.md` §3.5.1):

- The **Instructor role holds no export, no bulk-operation and no
  administration permission at any scope.** This is behaviour (c), obtained
  structurally, and it holds whether the instructor is on the pool deck, at
  home, or on a stolen tablet. It cannot be un-marked because there is nothing
  to mark.
- A **short idle timeout** for instructor sessions (OD-6), applied by role.
- Nothing else. No second dimension in `requirePermission`, no context deny-list.

If a device mode returns later, these are its terms: an administrator **enrols**
a poolside tablet, and every session originating from that device is in shared
mode with no way for the session holder to leave it. Alternatively it binds to
the role — instructor sessions are shared-mode unless on an admin-enrolled
personal device. Either way the party restricted is not the party who sets it.

**On suppressing PII, which was stated backwards.** D-009 suppressed "PII
beyond **first name + photo**". For a child a photograph is far more identifying
than a surname — that is why it is on the class list at all. Suppressing the
name while displaying the face is not minimisation, it is minimisation
theatre. §4 states a third rule again ("suppressed only for non-assigned
groups"), so the design disagreed with itself in two places. **The rule, stated
once, is §4's photograph paragraph**, corrected there: first name and surname
initial on shared surfaces, **photograph revealed per student on explicit tap**,
that reveal audited. This section does not restate it.

**Reason.** Least privilege applied to *context* was the right instinct and the
wrong mechanism. Applying it to the *role* gets three of the four behaviours
with no new axis in the security-critical path, and gets them
non-negotiably.
**Trade-off.** An instructor who legitimately needs an export must ask an
administrator, or hold a second grant. Given that the poolside export is the
exfiltration path this control exists to close, that is the intended outcome.

**A standing constraint on everything in this chapter.** Poolside is a wet
iPad, possibly with no wifi, replacing pen and paper. **A security control that
adds friction to the poolside moment loses to paper** — and when it loses, the
instructor stops using the application entirely and the organisation gets no
audit trail, no attendance data and no controls at all. Where a control in this
document would be unrealistic there, this chapter says so rather than
specifying it and letting the build discover it. Concretely: no step-up at the
poolside, no re-authentication between students, no per-record confirmations in
the attendance flow, and no control whose failure mode is "the lesson stops".

---

## 2. Authorization — permissions × scope


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

With tenancy gone, authorization carries the full weight of "who may see and do
what". Inside one organisation that is a harder and more interesting problem
than a tenant boundary would have been, and it is where the brief's *"met
scoping alle rechten granulair"* requirement lands.

### 2.1 The model

A grant is not a permission. **A grant is a permission plus a scope.**

```text
Person ──< RoleAssignment >── Role ──< RolePermission >── Permission
              │
              └── scope: { type, id }        ← the granular axis
```

```text
RoleAssignment(personId, roleId, scopeType, scopeId,
               validFrom, validUntil?, grantedByPersonId)
```

where `scopeType` is one of:

| Scope type | Meaning | Example |
|---|---|---|
| `ORGANIZATION` | The whole instance | Organisation administrator |
| `UNIT` | One `OrganizationUnit`, **flat — no descendant walk in v1** (D-121) | "Planner for Locatie Zuidbad" |
| `GROUP` | One specific group | "Instructor of Groep A1" |
| `COURSE` | One course across groups | "Examiner for Diploma B" |
| `SESSION` | **Participation in one scheduled session (lesson, aftest or exam session) and its roster, for a bounded window** | "Independent aftest assessor, Groep A1's Thursday aftest" · "Substitute instructor, one evening" · "External examiner, Saturday 14 March" |
| `SELF` | The holder's own records | Every authenticated person, implicitly |

**`RELATED` is not in this enum.** OD-5 (`08-open-decisions.md`) decided on
2026-09-01 to remove it entirely rather than reserve it unimplemented: it was
simultaneously mandated for v1 (R-14), deferred to the guardian portal (P-04),
and *granted* by the starter-role catalogue below — an administrator could
assign a scope whose enforcement nobody had written, and it would look like it
worked. A guardian's consent authority in v1 is expressed through the `consent`
module and `PersonRelationship` (§5.4), not through an authorization scope. The
enum member returns with the portal that needs it.

The same person may hold several assignments simultaneously: instructor of two
groups, planner for one location, and a member of the organisation. Their
effective reach is the **union** of their grants — which is why the *narrowing*
rules in §2.2 have to be part of coverage itself: a union can never be made
smaller by adding a rule elsewhere.

**Decision D-144 — A grant carries its own validity, and validity is evaluated
inside the guard.** `validFrom`, an optional `validUntil`, and
`grantedByPersonId` are part of the tuple, not conventions.

- `validUntil` is **mandatory for `SESSION` scope** — schema-level, not
  documentation-level. D-068 already says the grant "carries its own
  `validFrom`/`validTo`"; §2.4 already says External examiner is "always with an
  expiry" and Internal examiner "time-bounded". None of that was expressible in
  the tuple as written.
- Expiry is enforced in `requirePermission` and `resolveReach`, **not** by a
  cleanup job. A job that has not run yet is an open grant; a predicate cannot
  be behind schedule.
- `grantedByPersonId` is what makes §2.6's anti-amplification rule auditable
  after the fact rather than only preventable in the moment.
- Expiring and expired grants are surfaced in the administration UI, and staff
  grants default to a bounded `validUntil` rather than an open one.

**The deprovisioning gap this partly covers, stated rather than papered over.**
SCIM is deferred (`00-overview.md` §3.3) and the IdP registry is out of v1, so
when an organisation eventually connects one, an instructor removed from the
corporate directory on their last day keeps their SplashTrack `UserAccount`,
their local password if set, their passkey and their `GROUP`-scoped access to
children's records until an administrator notices. Three responses, none of
which is SCIM: the documentation carries an **offboarding checklist** as a named
operator duty; the administration area ships an **"accounts that have not
authenticated in N days"** report; and expiry is the *default* for staff grants
rather than the exception, which converts an unbounded oversight into a bounded
one.

**Reason.** Without validity fields, the external examiner who assessed one
Saturday in March keeps `exams.assess` and `exams.results.record` on that
session **forever** — and because results are append-only (D-062) an amendment
they make years later becomes the effective result. Nobody at the swim school
has any reason to look at that assignment again. Finding **F-113**.
**Trade-off.** Two more columns on the tuple every guard reads, and an
administrator must choose an end date for grants that feel permanent. Instructor
and administrator grants may leave `validUntil` null; the scopes where a
bounded window is the whole point cannot.

### 2.2 The authorization question

Every protected operation asks one question:

```text
requirePermission(session, 'attendance.record', { group: groupId })
```

Resolution: does the caller hold *any* grant whose permission includes
`attendance.record` **and** whose scope covers the referenced resource?

Coverage is defined per scope type, once, and nowhere else:

| Scope type | Covers |
|---|---|
| `ORGANIZATION` | Every resource in the installation |
| `UNIT` | **That unit only** — every group, session, student and exam session directly beneath it. No descendant walk (D-121). A student's *profile* is governed by their **home unit** only (D-145) |
| `GROUP` | That group, its scheduled sessions, and — while the membership **and** the holder's instructor assignment are both **currently active** — the *group-scoped relations* of the students in it. Not the whole student record (D-145) |
| `COURSE` | That course, its levels, its enrolments, and **all** its exam sessions |
| `SESSION` | **That one session's roster only** — the students on it, for the window the grant is valid, and (for an exam or aftest session) the assessment/results being recorded there. Nothing else, not the course, not the students' other records |
| `SELF` | Records whose subject is the holder, for the enumerated permission set of D-146 — never by implication |

**Decision D-145 — Coverage is per *relation*, not per entity, and every
membership-derived coverage is evaluated live.**

The table above previously read: `GROUP` covers "the students in it *for the
period of their membership*". That sentence is ambiguous in the way that
matters. Does it mean the instructor's access lasts only *during* the
membership, or that the instructor may see records *dated within* that period?
In a union-of-grants model over an append-only membership table that D-059
deliberately keeps for life, the natural implementation is the second — and it
means **every instructor who has ever taught a child retains read access to that
child's complete record permanently.** Finding **F-114**.

Two rules, stated so the implementation cannot land on the wrong reading:

1. **Live evaluation.** `GROUP` coverage requires an `GroupMembership` that is
   active *at query time* **and** an `InstructorAssignment` for the holder that
   is active *at query time*. A lapsed membership row and a past assignment
   grant nothing. The same holds for `SESSION` (already the case, D-068 resolves
   from the roster at check time) and for `UNIT` via the group's current unit.
2. **Per-relation coverage.** Scope covers relations, not the `Person` node. A
   `GROUP`-scoped `students.read` returns identity basics plus **this group's**
   progress and attendance. It does **not** return the student's other groups,
   attendance at other locations, other enrolments, exam history, or guardian
   relationships. Those need `COURSE`, `UNIT` or `ORGANIZATION`. The
   scope-escape tests assert on the **fields returned**, not only on whether the
   row was reachable (`06-delivery.md` §2.1).

**And the cross-unit case, which the union makes silently permissive.**
`StudentProfile` carries a *home* `unitId`; `Group` carries its own; sessions
inherit from the group. A child registered at Zuidbad who attends a summer
course at Noordbad is otherwise reachable in full by the Location Manager of
both, and because effective reach is a union the broader answer always wins.
Cross-location courses and shared facilities are normal in this domain, not an
edge case. **The rule: the home unit governs the student's profile; the group's
unit governs that group's attendance and progress only.** This composes with
rule 2 above rather than being a special case.

**Reason.** An instructor teaching Sanne on Tuesdays needs Sanne's first name,
her medical flag if they hold it, and this group's progress. Handing them her
failed exam attempts at another location, three years after they last taught
her, is not a bug an audit trail fixes afterwards. This is the *primary internal
threat* named in §6.2, and per-entity coverage is how it happens.
**Trade-off.** Coverage becomes a per-relation matrix rather than one sentence,
and the student-detail screen must render partially for a `GROUP`-scoped
instructor. Both were going to be true the first time anyone asked why an
instructor could read a diploma history.

**Decision D-146 — `SELF` is an explicit, seeded role assignment with an
enumerated permission set, never an implicit scope match.**

The table above previously granted `SELF` to "every authenticated person,
**implicitly**". An implicit scope match means
`requirePermission('students.medical.read', { student: self })` can succeed for
an authenticated person **holding no grant at all** — deny-by-default (§1.1
rule 2) defeated by a rule in the same document. Finding **F-124**.

- `SELF` is a seeded `Role` assigned at account creation like any other, subject
  to §2.6 and visible in the administration UI.
- Its permission set is closed and enumerated: `people.read` on one's own
  `Person`, `students.read` on one's own `StudentProfile`, own skill progress,
  own attendance, own awards, own consent records. **Never** `students.medical.*`,
  never `students.notes.*`, never anything about another person — a guardian
  reading a child's record is not `SELF` and has no scope in v1 (D-122).
- Adding a permission to the `SELF` set is a security-relevant change requiring
  review, in the same class as adding one to the high-risk set of §1.2.

**Decision D-121 — `UNIT` is a flat scope in v1: it covers the unit itself, not
a tree of descendant units.** There is one pool (`00-overview.md` §3.5.1). A
recursive descendant walk is the highest-risk code path a scoped query can
contain — it fails open, silently, at whatever depth the bug sits — and
building it now would be for a location hierarchy nobody operates. Adding the
walk later is additive: the scope type does not change, only its resolution.
No scope type walks a tree in v1.

**Decision D-054 — (Superseded by D-068) `EXAM_SESSION` was a first-class scope
type covering only exam sessions.** Retained here as history: the reasoning —
that a special case must not live outside the scope enum — is what D-068
generalises.

**Decision D-068 — `SESSION` is a first-class scope type: reach follows
assignment to a specific session's roster, for a bounded window, and replaces
`EXAM_SESSION`.**
**Reason.** Four real cases share one shape, and the design had modelled only
one of them: an independent *aftest* assessor is by definition **not** the
child's instructor and therefore holds no `GROUP` grant covering that child
(F-41); a substitute instructor covering one evening is in the same position; the
receiving instructor of a make-up lesson (`SessionRosterEntry`,
`01-domain-model.md` §3.2) needs to read a guest student for one session; and an
external examiner attends one exam session, which is the case D-054 already
solved narrowly. `COURSE` scope over-grants every one of these — an assessor
would gain every future aftest and exam of that course, past and future, on
exactly the records that matter most: a child's diploma outcome. One scope type
generalises all four rather than adding three more special cases, and every
grant in the system stays expressible as `(permission, scopeType, scopeId)`
with no exceptions.

Coverage is resolved from `SessionRosterEntry` / the exam session's candidate
list at the time of the check, not cached at grant time, so a student added to
or removed from the roster changes reach immediately. The grant itself carries
its own `validFrom`/`validTo` — typically the session's date, occasionally a
short window around it for preparation and follow-up.

**Trade-off.** One more scope type to implement and test, evaluated against a
roster rather than a static membership — a small amount of extra resolution
logic reach checks for every other scope avoid. `ExamAssessor`
(`01-domain-model.md` §3.5) and its aftest equivalent become projections of a
role assignment rather than an independent access mechanism — they record *who
assessed*, not *who may*. **Blocks D-085** (`15-assessment-and-fees.md` §3):
the four-eyes gate on exam candidacy cannot ship without this.

**The visiting NRZ delegate is the fifth case, and v1 answers it with paper.**
A delegate needs to see one exam session's candidate list and nothing else,
which is precisely a `SESSION` grant — so the scope type *covers* them, and if
a delegate is ever given an account this is the grant they get, with a
`validUntil` on the session's date (D-144). v1 does not give them one: D-094
(`15-…` §7) hands them a **printed** candidate list, because the requirement is
that a person beside the pool can read twelve names, and paper achieves that
with no account lifecycle, no credential and no stranger authenticating against
a database of children's records. The scope type exists for the four cases that
genuinely need an account; the delegate is not one of them.

**Decision D-030 — Authorization is always resource-referenced; a bare
permission check is not sufficient.**
**Reason.** `hasPermission('students.read')` is meaningless in a scoped world —
the honest question is always *"this student?"*. Allowing an unscoped check
would let an instructor's group-scoped permission read the entire organisation,
which is exactly the class of bug tenancy checks used to catch. Making the
resource reference a required argument means the compiler enforces that the
question is asked properly.
**Trade-off.** Every call site must know which resource it is acting on, which
is more verbose than a role check and occasionally awkward for list endpoints.
List endpoints instead ask for the caller's **reach** (§2.3) and filter by it.

### 2.3 Reach — the read side

For lists and searches, the inverse question is asked once and turned into a
filter:

```text
resolveReach(session, 'students.read') → Reach
```

Repositories accept a `Reach` and constrain the query with it. A single helper,
used everywhere, means there is one place to get list filtering right — which is
the boundary that actually exists in a single-organisation installation.

**Decision D-031 — Reach resolution is centralised and repositories cannot be
called without it.**
**Reason.** Scoping bugs in list endpoints are the most likely remaining data
exposure, because a missed filter silently returns everything. Making reach a
required repository argument turns a silent over-fetch into a type error.
**Trade-off.** Repository signatures are noisier. Worth it — this is now the
highest-risk code path in the application.

**Decision D-147 — `Reach` is an opaque type covering every scope type, and it
is constructible only by `resolveReach`.**

The earlier signature returned `{ units, groups, all }`. The scope enum has six
members; that object represented two of them plus a boolean. An internal
examiner (`COURSE`) or an aftest assessor (`SESSION`) resolved to
`{units: [], groups: [], all: false}` — empty reach, every list denies them, and
the candidate list they are physically standing there to assess is blank. The
developer fixing that at 17:00 on an exam Saturday widens the object ad hoc or
passes `{all: true}`, on the code path D-031 calls the highest-risk in the
application. Finding **F-112**.

```text
type Reach =                                    // discriminated union, one variant per scope type
  | { kind: 'ORGANIZATION' }                    // producible only from an ORGANIZATION grant
  | { kind: 'UNITS';    unitIds:    Id[] }
  | { kind: 'GROUPS';   groupIds:   Id[] }
  | { kind: 'COURSES';  courseIds:  Id[] }
  | { kind: 'SESSIONS'; sessionIds: Id[]; window: DateRange }
  | { kind: 'SELF';     personId:   Id }
  | { kind: 'NONE' }                            // the honest result of holding no grant
  | { kind: 'UNION';    of: Reach[] }           // effective reach is a union of grants (§2.1)
```

- **Opaque.** The type carries a private brand (a non-exported unique symbol
  field) and exports no constructor. A literal cannot be written at a call site,
  in a test helper, or in a hurry. D-031 claimed a required argument "turns a
  silent over-fetch into a type error"; a required argument enforces *presence*,
  and `{units: [], groups: [], all: true}` was a valid literal TypeScript would
  accept anywhere a reach was required. The compiler was checking that the
  question was asked, not that it was answered by the authority.
- **No `all: boolean`.** Organisation-wide reach is a variant that only an
  `ORGANIZATION`-scoped grant can produce, so "everything" is a resolution
  outcome rather than a field anyone can set.
- **`NONE` is explicit**, so "this principal reaches nothing" is distinguishable
  from "reach was never resolved" in both code and logs.
- Repositories translate each variant into a `where` clause; a repository that
  does not handle a variant fails to compile rather than returning unfiltered
  rows.
- `06-delivery.md` §2.1's scope-escape gate already requires asserting that a
  `Reach` **cannot be constructed outside `resolveReach()`**; this is the shape
  that makes that assertion possible. Its per-module cases must include a
  `COURSE`-scoped and a `SESSION`-scoped principal specifically — the two the
  old shape could not express at all.

**A note on the reviewer's framing.** The finding that raised this called
`all: false` a "default-open shape". It is not: `false` is default-*closed*, and
a forgotten field would deny rather than over-return. The real defect is the two
above — incomplete coverage of the scope enum, and forgeability — and they are
sufficient on their own.
**Trade-off.** A union type is more work per repository than an object with
three fields, and a genuinely new scope type becomes a compile error in every
repository at once. That is the intended cost: the alternative is a repository
that silently ignores a variant it does not know about.

### 2.4 Starter roles

| Role | Typical scope | Purpose |
|---|---|---|
| Instance Administrator | `ORGANIZATION` | Full control **of this installation**: settings, identity providers, backups, roles. MFA required. This is the highest authority that exists |
| Location Manager | `UNIT` | Everything within one location and below |
| Planner | `UNIT` or `ORGANIZATION` | Schedules, groups, locations, instructor assignment |
| Instructor | `GROUP` (one per group taught) | Attendance, skill sign-off, read student basics |
| Internal examiner | `COURSE`, time-bounded | Assesses any exam session of that course |
| External examiner | `SESSION`, always with an expiry | One exam session only. A `Person` with no membership (D-052) |
| Independent aftest assessor | `SESSION`, always with an expiry | Grades one *aftest*, held by an instructor who is not the student's own (D-085, `15-assessment-and-fees.md` §3) |
| Member Administrator | `UNIT` or `ORGANIZATION` | People, **memberships** and student administration, enrolments — three distinct concepts (`01-domain-model.md` §3.1) |
| Content Editor | `ORGANIZATION` | Public pages and branding. **No person data — and explicitly no `inquiries.read`** (§2.5). Inquiries arrive through the website and the `Inquiry` table lives in the `pages` module, so the natural bundle would have violated this role's own guarantee by module layout alone |
| Read-only Viewer | `UNIT` | Oversight and reporting |

**Every starter role above is a *starting point*, not a fixed object.** Roles
are user-definable, which is why no normative rule in this design binds to a
role name (D-130): the MFA mandate, the alert rules and the high-risk set all
bind to permissions.

**No Guardian role in v1.** A guardian's authority to consent on a child's
behalf is a `PersonRelationship` fact (§5.4), not an authorization grant — there
is no `RELATED` scope to hold one (OD-5, above). A guardian who is also a
member has whatever role that membership carries; a guardian who is not gets no
account. This returns with the guardian portal.

**There is no platform super administrator, and no platform.** The instance
administrator is the highest authority and their reach ends at this
installation. There is no account, credential or code path that can reach a
second organisation — other organisations run entirely independent deployments
(`03-deployment-model.md` §1).

### 2.5 Permission catalogue

Every key is evaluated against a scope. **This is the catalogue; a permission
referenced anywhere in the design set and absent here is a defect, not a
shorthand.** That is how `roles.assign` came to be cited as a high-risk
permission in `07-operations.md` §1.3 while existing nowhere (F-109), and how
several others below were referenced by chapters 07, 13, 14 and 15 without ever
being defined.

```text
people.read            people.create         people.update
people.delete          people.export

students.read          students.create       students.update
students.archive       students.notes.read   students.notes.write
students.medical.read  students.medical.write    (special category — separately gated)

groups.read            groups.manage         groups.assign_members
courses.read           courses.manage        enrolments.manage

skills.read            skills.manage_catalogue
skills.assess          skills.revoke

attendance.read        attendance.record     attendance.amend

exams.read             exams.manage          exams.assess
exams.results.record   exams.candidacy.override
certificates.issue     certificates.revoke

planning.read          planning.manage

fees.read              fees.manage           fees.export

pages.read             pages.manage          branding.manage
inquiries.read         inquiries.manage

roles.read             roles.assign          roles.manage
accessgroups.read      accessgroups.assign   accessgroups.manage

identity.providers.read      identity.providers.manage
sessions.read                sessions.revoke

backup.run             backup.download       backup.restore
backup.settings.manage

organization.settings.manage                 audit.read
audit.report           diagnostics.read
privacy.export         privacy.erase
```

**The additions, and what each closes:**

| Key(s) | Closes |
|---|---|
| `roles.read` / `roles.assign` / `roles.manage`, `accessgroups.*` | **F-109.** Role assignment is the highest-privilege operation in the product and had no permission at all. `roles.assign` grants an existing role; `roles.manage` edits *which permissions a role carries*, which is strictly stronger and must not be bundled with assignment |
| `identity.providers.read` / `.manage` | D-140 — separated from `organization.settings.manage` so "can edit settings" does not mean "can mint administrators" |
| `sessions.read` / `sessions.revoke` | The active-session inventory and global revocation that `07-operations.md` §1.4 (D-128) ships for Article 33 containment. Revocation is an emergency power and is separately grantable |
| `audit.report` | The "what did this account do" report (D-128). Distinct from `audit.read`: reading events is oversight, compiling a per-actor dossier is an investigation |
| `backup.run` / `.download` / `.restore` / `.settings.manage` | `07-operations.md` §1.3 already binds alerts to "the backup permissions" and `14-…` §3.3 (D-042) calls the download "the single most dangerous UI element". Four separate keys because taking a backup, exfiltrating one, overwriting the database with one, and redirecting where they go are four different powers |
| `diagnostics.read` | **F-125.** `13-configuration-and-setup.md` §8's page names no permission. It reveals version, migration state, backup posture and *whether a newer release with a security advisory exists* — a machine-readable answer to "is this instance exploitable?" if it is ever reachable unauthenticated. `ORGANIZATION`-scoped, authenticated always. Its "safe to paste into a public issue" property (no secrets, no PII) is good and is kept: pasteability and authentication are independent properties |
| `inquiries.read` / `inquiries.manage` | **F-115.** Public inquiry free text routinely contains health data about a named child (§5.3) and was reachable through `pages.manage` |
| `fees.read` / `.manage` / `.export` | Referenced by `01-domain-model.md` §5's reach column and by `15-assessment-and-fees.md` §6; never defined |
| `exams.candidacy.override` | D-085's four-eyes gate is "overridable only with an explicit permission". This is it. The override rate is a number a chair can act on, which is the whole trade in D-085 |

**Decision D-156 — The diagnostics page requires `diagnostics.read` at
`ORGANIZATION` scope and is never served unauthenticated.** Its "safe to paste
into a public issue" property is about *content* — no secrets, no personal data
(F-20) — and is independent of who may open it. `13-configuration-and-setup.md`
§8 currently names no permission at all, which is the actual defect: whether the
page is authenticated was never stated either way, and the natural
implementation of "a diagnostics page for support" is that it is not.
**Trade-off.** One more permission to grant before a volunteer can produce the
artefact a support issue asks for. Cheaper than a scanner learning which
instances are running a version with an open advisory.

**Decision D-010 (unchanged) — Medical/pastoral notes have their own permission
pair and their own audit event type.**
**Reason.** GDPR special-category data must be least-privilege by default. An
instructor with `students.read` scoped to their group still should not
automatically see a child's medical history; that requires
`students.medical.read`, and every read of it is audited.
**Trade-off.** An extra permission to administer and a UI that must degrade
gracefully when the field is unreadable. This is the highest-risk data in the
product; the cost is justified.

**Decision D-148 — There is one *protected free text* class, and everything in
it is encrypted, audited on read, and excluded from exports by default —
regardless of which of the two permission pairs gates it.**

D-010 says "medical/pastoral notes have their own permission **pair**" —
singular. The catalogue defines **two** pairs, and §5.3 names only medical
remarks as special category. The gap between them is where pastoral notes fell:
gated by `students.notes.*`, which reads like an ordinary teaching permission a
Location Manager hands out without thinking, and therefore plausibly
unencrypted, unaudited and present in every export and every backup in plain
text. Finding **F-115**.

Pastoral free text in this domain is *"moeder zit in de opvang"*, *"via
jeugdzorg aangemeld"*, *"mag niet opgehaald worden door vader"*. That is more
sensitive than an allergy, and it may be special category by inference — health,
family situation, or criminal-adjacent. The same is true of assessment remarks
(D-087, `15-…` §5) and of public inquiry free text (§5.3).

**The class, stated once:**

| Field | Gated by | Rationale |
|---|---|---|
| Medical remarks, allergies, physical limitations | `students.medical.*` | Special category, Art. 9 |
| Pastoral / safeguarding notes | `students.notes.*` | Special category by inference; safeguarding-adjacent |
| Assessment remarks (`AssessmentCriterionResult`) | `students.notes.*` | D-087: a developmental observation about a minor's body |
| `Inquiry` free text | `inquiries.read` | Unauthenticated public input that routinely volunteers a child's health (§5.3) |

Everything in the class is: **column-encrypted** under the D-096 envelope
(`v1:<keyId>:<nonce>:<ct>` with AAD binding table, column, primary key and key
id); **audited on read**, not only on write; **excluded from exports unless
explicitly requested** by a requester who holds the gating permission, with the
fail-loudly rule of D-153; and **never written to operational logs** (§5.7).

**Two pairs are kept rather than folded into one**, against the reviewer's
recommendation. The recommendation — fold pastoral into `students.medical.*` —
would mean the instructor who must know a child has epilepsy also reads the note
about the family's situation. Those are different needs held by different people,
and collapsing them would *reduce* least privilege in the name of protecting it.
What was actually wrong was that protection tracked the *permission pair* rather
than the *data*. Now it tracks the data, and the pairs stay separate.

**And a control at the capture point, which matters more than either.** The real
risk in a free-text field is what staff type into it. Every field in this class
carries a short, non-dismissable line at the point of entry: what this field is
for, that it is visible to anyone holding the permission, that it is retained
for a stated period, and that it is not the place for a diagnosis or a
third-party allegation. This is the cheapest control in the chapter and the only
one that reduces the *amount* of special-category data rather than guarding it
after the fact.

### 2.6 No amplification, no scope escape by grant

**Decision D-139 — A granter may grant only permissions they themselves hold,
only at or below their own scope, and only for a validity window within their
own. Enforced in the grant service, not in the UI.**

Three invariants, checked on every path that creates or modifies a
`RoleAssignment`, an `AccessGroup` assignment, or a `Role`'s permission set:

1. **No amplification.** The set of permissions being granted must be a subset
   of the permissions the granter holds. A Planner cannot grant
   `students.medical.read` because they do not hold it.
2. **Scope confinement.** The scope of the grant must be at or below the scope
   at which the granter holds that same permission. A `UNIT`-scoped Location
   Manager cannot grant anything `ORGANIZATION`-scoped, and cannot grant at a
   unit that is not theirs — which under D-121's flat `UNIT` means their own
   unit and nothing else.
3. **Window confinement.** `validFrom`/`validUntil` must fall inside the
   granter's own window for that permission. A `SESSION`-scoped assessor cannot
   issue a grant that outlives their own.

The same three apply to `Role` editing (`roles.manage`) — adding a permission to
a role is a grant to everyone holding it — and to `AccessGroup`s (§2.7), which
bundle *permissions plus scopes* into one assignable object and would otherwise
be a clean bypass of all three.

**Reason.** Without this, every other control in this chapter is decorative.
A Location Manager opens People & roles, assigns themselves an
`ORGANIZATION`-scoped administrator role or an access group containing
`students.medical.read`, and holds every medical note in the swim school. Step-up
is no obstacle — it is their own password and their own second factor (§1.2) —
and the audit event records a role change that looks entirely legitimate.
Finding **F-109**.
**Trade-off.** An administrator who genuinely needs to delegate something they
do not hold must first be granted it themselves, visibly. Bootstrap is the
obvious edge: the first administrator is created by the setup wizard
(`13-…` §6.3) or the break-glass CLI, both of which are outside the grant
service and both of which are host-access-proven. There is no in-application
path that produces a permission from nothing.

**Both invariants are scope-escape test cases**, per module, under D-032: a
granter attempting to grant a permission they lack, and a granter attempting to
grant at a wider scope, are both denied — asserted at the service, because the
UI hiding the option is not authorization (§1.1 rule 1).

### 2.7 Access groups

For organisations that need bundles rather than per-resource assignments, the
inherited `AccessGroup` primitive (ADR-018/019) groups permissions and scopes
into a named, reusable set — "Zwemles-instructeur Zuidbad" — assigned in one
action. This is convenience over the model above, never a bypass of it.

"Never a bypass" is now a rule rather than an intention. An `AccessGroup`
bundles *permissions plus scopes* into one assignable object, which makes it the
most convenient possible amplification primitive: assign one named thing, gain a
permission at a scope the granter never held. So:

- Assigning an access group requires `accessgroups.assign`; **defining or
  editing one** requires `accessgroups.manage`, which is strictly stronger and
  separately granted.
- §2.6's three invariants are evaluated against the **expanded** contents of the
  group — every (permission, scope) pair it contains — both when the group is
  edited and when it is assigned. Editing a group is a grant to everyone
  currently holding it, so the check runs against the editor at edit time and
  the group's membership is re-evaluated.
- An access group is a **projection**, never a second source of truth: it
  produces ordinary `RoleAssignment` rows subject to D-144's validity, and
  `requirePermission` never consults it directly.

---

## 3. Defence in depth without tenancy


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The old design leaned on three tenancy layers. Two of them are gone; what
replaces them is narrower but still layered:

1. **Deployment isolation.** Separate process, database, storage and domain per
   organisation. This is now the outermost and strongest boundary, and it is
   enforced by infrastructure rather than by code.
2. **Scope enforcement.** `requirePermission(..., resourceRef)` for writes and
   single-resource reads; `resolveReach()` for lists. Deny by default, including
   on unexpected failure.
3. **Scope-escape tests.** Every module ships tests asserting that a
   `GROUP`-scoped instructor cannot read, write or list outside their groups;
   that a `UNIT`-scoped role cannot reach another unit (`UNIT` is **flat** in
   v1, D-121, so "escape its subtree" no longer describes anything); that a
   `SESSION`-scoped principal cannot reach outside their session **or its
   window**; that a `Reach` cannot be constructed outside `resolveReach`
   (D-147); and that neither grant invariant of §2.6 can be violated. These
   replace the deleted tenancy suite and are **non-optional for Definition of
   Done**. Their minimum content is stated once, in `06-delivery.md` §2.1.

**Decision D-032 — Scope-escape tests are mandatory per module.**
**Reason.** The old isolation suite existed because query-predicate tenancy is
easy to get wrong. Scope filtering has the identical failure mode — a missed
`where` returns too much — so it needs the identical discipline. Deleting the
tenancy tests without replacing them would trade a tested boundary for an
untested one.
**Trade-off.** Test-writing effort per module. Unavoidable; this is the
boundary that now protects a child's records from a colleague who should not
see them.

### 3.1 Raw SQL

`$queryRaw` / `$executeRaw` bypass reach filtering, which is the boundary that
matters here — **and they bypass the audit trail's append-only property, which
is the boundary that matters after an incident.** The lint rule that flags them
was justified only by the first. They require an explicit reviewer sign-off and
are flagged by a lint rule.

### 3.2 Audit integrity — what "append-only" rests on

"Append-only. Never updated, never deleted by application code"
(`07-operations.md` §1.2) is a statement about *intent*. The template makes it
partly structural: `AuditEvent` is a **tamper-evident hash chain** — each row
hashes its content plus the previous row's hash — so deletion or modification is
detectable by a verification pass (`05-technical.md` §5). Two gaps remain, and
they are the ones that matter to a compromised administrator (FM-7's own
scenario). Finding **F-116**.

**Decision D-149 — Audit integrity has three parts: the chain, a database role
that cannot delete, and a retention floor the settings layer refuses to cross.**

1. **The chain is verified, and the verification is somewhere a human sees it.**
   A `splashtrack audit:verify` command plus a chain-status line on the
   diagnostics page (`13-…` §8). A tamper-evident record nobody ever checks is
   tamper-*evident* in the same way an unwatched camera is.
2. **A separate database role with `INSERT`-only grant on `AuditEvent`**,
   `UPDATE` and `DELETE` revoked. The application writes audit events as that
   role and everything else as its ordinary role. This composes with D-116 (the
   application's role is not a superuser) — without D-116 the separation is
   decorative, because a superuser can grant itself back. Deletion by the
   retention job runs as a third, narrowly-scoped path with its own audit event.
3. **A hard retention floor.** Audit retention is an organisation-configurable
   policy under D-065, so the cheapest way to destroy the evidence of an
   exfiltration is to set audit retention to one day and let the maintenance job
   do it legitimately. The settings layer refuses any value below the floor
   (§4.1), and lowering audit retention at all is a high-severity audit event.

**And the retention mismatch it exposes.** Audit is retained 24 months while
exam results are retained up to 10 years (`01-domain-model.md` §5). The record
of *who* recorded a diploma outcome is therefore destroyed eight years before
the outcome it evidences — in a design that justifies append-only results with
"a parent disputes a diploma decision". **Audit events evidencing a data class
are retained at least as long as that class**, or the mismatch is stated in the
privacy screen as a limit on what the organisation can reconstruct. This is a
hand-off to `01-domain-model.md` §5 and `07-operations.md` §1.2, not settled
here.

**Reason.** The three questions a breach requires (D-128) are all answered from
the audit trail. If the actor who caused the breach can also edit it, the
Article 33 assessment is built on evidence the suspect controls.
**Trade-off.** A second database connection with different grants, and an
operator pointing `DATABASE_URL` at a managed database must create two roles
rather than one. The documentation gives the exact statements, as it already
must for D-116.

## 4. Application security controls


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| Control | Approach |
|---|---|
| Input validation | Zod schemas at every boundary; validation is a module concern, colocated with the service |
| Output encoding | React escaping by default; CMS content is sanitised server-side against an allow-list |
| CSRF | Better Auth cookie protections + `SameSite`; Server Actions carry framework protection |
| Rate limiting | `RateLimitCounter` (inherited), **with lockout**, on: login, password reset, export, public forms, **MFA/TOTP verification**, **setup-token submission** (D-101), **recovery-token entry at restore** (D-115), and the signed backup-download link (D-042). See below |
| Secrets | Never in the repository. One bootstrap secret via `SECRET_KEY_FILE`, everything else derived — stated once in `13-configuration-and-setup.md` §3.1.1 (D-112), not restated here. GitHub Environments hold deploy secrets; secret scanning + push protection block accidents |
| Server-side requests | All administrator-configured destinations go through one egress-controlled client: private ranges denied by default, resolve-and-pin, no redirects, no response detail returned to the client (§1.2.2, D-142) |
| Encryption in transit | TLS everywhere, HSTS, no mixed content. Internal service-to-database traffic is TLS as well |
| Encryption at rest | Full-disk/volume encryption plus **column-level encryption for the protected free-text class** — medical remarks, pastoral notes, assessment remarks and inquiry free text (D-013 as extended by D-148), under the D-096 envelope |
| File uploads | `UploadedAsset` (inherited): type allow-list, size limits, served through an authorising route — never a public bucket path. **EXIF stripped from photos** |
| Dependency security | Dependabot + `npm audit` gate; high/critical blocks merge |
| Headers | CSP (nonce-based), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Abuse | Public forms behind rate limits and a bot check; no user enumeration in any error message |

**On rate limiting, and what was missing.** The list previously covered login,
password reset, export and public forms. It did **not** cover MFA verification —
a 6-digit TOTP without throttling is brute-forceable, and MFA is the stated
compensating control for the highest-privilege accounts in the product (§1.2,
FM-7). Nor the setup token, nor the recovery token at restore, both of which sit
on the **unauthenticated** setup surface and both of which are bearer
credentials over the whole database. Rate limiting alone is insufficient for
these three: they need **lockout with an audited failure event**, because an
attacker who is merely slowed down still gets there overnight. Finding
**F-117**.

**Decision D-013 — Column-level encryption for the protected free-text class
only** (extended by D-148 from "medical/pastoral notes" to the four fields
listed there).
**Reason.** Encrypting everything at column level breaks search and sorting for
no proportionate benefit when the volume is already encrypted at rest.
Encrypting the highest-risk columns means a database dump or a backup leak does
not expose health data about children.
**Trade-off.** Those fields become unsearchable and key management becomes a
real operational duty (rotation, escrow, restore). We accept unsearchability —
nobody needs to full-text search medical remarks. **OD-7 is answered** and
should be closed against D-112 (`SECRET_KEY_FILE` as the single root), D-114
(two-level envelope: a random master key wrapped by Argon2id over the printed
recovery token, per-archive data keys) and D-096 (`v1:<keyId>:<nonce>:<ct>` with
AAD). Cloud KMS is not needed and would contradict D-064's self-hosted premise.

### 4.1 Security-critical settings are invariant or bounded

`13-configuration-and-setup.md` §3.2 puts "password policy, session timeouts,
rate limits" in a live-editable Authentication/Security settings category. That
is right for most of them and wrong for a few, and the design never said which
few. Is "MFA mandatory for the high-risk permission set" one of those settings?
If yes, the mandate is a checkbox that anyone reaching
`organization.settings.manage` — or `splashtrack settings:reset` — can clear. If
no, that was stated nowhere. Finding **F-117**.

**Decision D-150 — Every setting is classified `free`, `bounded` or
`invariant`, and the classification is part of the setting's schema, not a
convention.**

| Class | Meaning | Examples |
|---|---|---|
| `free` | Edit at will. The overwhelming majority | branding, email templates, feature toggles, lesson defaults |
| `bounded` | Editable within a hard floor/ceiling enforced by the setting's own schema, which `settings:reset` also respects | session idle ≤ 8 h and absolute ≤ 12 h; rate limits ≥ a stated minimum; audit retention ≥ 12 months (§3.2); any retention ≤ the platform maximum; backup retention ≤ the shortest special-category retention, or a diagnostics warning (D-104) |
| `invariant` | Not editable in the UI at all, not clearable by `settings:reset`, no override flag | MFA required for the high-risk permission set (§1.2); reach filtering; audit append-only; the `SELF` permission set; the egress deny-list's *existence* (its allow-private-networks flag is `free` and audited) |

Changing a `bounded` setting to its floor, and any attempt to change an
`invariant`, is a high-severity audit event. `13-configuration-and-setup.md`
§3.2 already says the settings registry "is the single source of truth for
validation" — this is where that claim earns its keep, and it is a hand-off to
that chapter.

**Reason.** A security control that ships as a default is a suggestion. The
distinction between "we chose 30 minutes" and "you may not choose 30 days" is
the entire difference between a policy and a control.
**Trade-off.** An operator with a legitimate reason to exceed a bound must
change code rather than a setting. For a self-hosted product that is a real
cost, and it is the correct one for a list this short.

**Photographs deserve explicit mention, and the rule for them is stated here
and nowhere else.** Swim schools photograph children for identification on class
lists. A photo of a minor is personal data, arguably biometric-adjacent, and is
the field most likely to be added casually. It is therefore: consent-gated
(`consent` module), EXIF-stripped, served through an authorising route, deleted
on erasure **and on withdrawal of photo consent** (D-152), and — on any surface
visible to people who are not the child's own instructor — **not rendered by
default**.

The earlier rule, in the deleted D-009, suppressed "PII beyond first name **+
photo**". That is backwards: for a child a photograph is far more identifying
than a surname, which is exactly why it is on the class list. Suppressing the
name while displaying the face is not minimisation. §1.3 stated one rule and
this section stated another ("suppressed only for non-assigned groups"), so the
design disagreed with itself. **The rule:** list views show first name and
surname initial; **the photograph is revealed per student on an explicit tap,
and that reveal is audited.** One tap is affordable at the poolside — it is one
tap the instructor already makes to open the child — and the class list stops
being a face book of every child in the building for anyone holding the tablet.
Finding **F-04**.

---

## 5. GDPR / privacy model


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 5.1 Roles under the GDPR

**Decision D-064 — The organisation is the controller. Publishing self-hosted
software does not make the SplashTrack project a processor.**

- The **organisation** running the installation is the *controller*: it decides
  the purposes and means of processing.
- The **SplashTrack project** publishes software. It processes no personal data
  on anyone's behalf and is therefore **not** a processor by virtue of
  publishing. Stated as fact rather than as a conclusion about anyone's
  obligations: *the project receives no personal data from your installation and
  performs no processing on your behalf. Whether any agreement is required
  between you and any party is your assessment to make with your own advisor.*
  The earlier phrasing — and `10-findings.md` F-05's "**no DPA is needed**
  between us" — states a legal conclusion about the reader's obligations, in a
  document whose own trade-off paragraph says it "states the roles and points to
  the questions; it does not answer them for anyone". Finding **F-126**; the
  F-05 sentence is a hand-off to `10-findings.md`.
- A **third party** may still be a processor **depending on the deployment**: a
  hosting provider, a managed-database vendor, an email relay, or a consultant
  operating the instance for the organisation. Those relationships need their
  own agreements, and the organisation — not us — is responsible for them.
- If the project (or anyone else) ever *operates* an instance on an
  organisation's behalf, that specific relationship makes the operator a
  processor. That is a deployment fact, not a property of the software (OD-14).

**Reason.** The earlier text called the project a processor, which was simply
wrong: a processor processes personal data on the controller's instructions, and
we never receive any. Getting this right matters because it determines who owes
which documents to whom, and overclaiming would create obligations we cannot
fulfil while understating a hosting provider's role would leave a real gap.
**Trade-off.** The documentation must explain a distinction most self-hosters
have not thought about, without drifting into legal advice. It states the roles
and points to the questions; it does not answer them for anyone.

**Consequence for the design:** every privacy control must work with no outside
help. Retention, export, erasure and consent are features the organisation
operates itself, not services anyone performs for them.

### 5.2 Data minimisation by default

Before a field is added, its owner must answer: why is it required, what is
the purpose, who may access it, how long is it retained, can it be corrected /
exported / deleted, is it special category, must access be audited. A field
without answers is not added. The inherited `profile-fields` module lets an
organisation add its own attributes without a schema change — with the same
questionnaire applied per field, including a consent text (`ProfileFieldConsentText`).

**Privacy by default** in practice: new organisations start with the minimum
field set; photos off; notes off; public directory off; analytics off.
An organisation opts *in* to collecting more, never out.

### 5.3 Special-category data

The special-category data SplashTrack collects is **health-related**: medical
remarks, allergies, physical limitations relevant to water safety. It is
collected in three places, not one — and only the first was ever designed for:

1. The `students` medical fields, on a registered child.
2. Pastoral notes and assessment remarks, which are special category *by
   inference* and are treated as such (D-148).
3. **Public inquiry free text**, which nobody specified as special category and
   which routinely is.

**On inquiries — the one that was invisible.** The `Inquiry` table takes free
text from an unauthenticated public form. In this domain the first message a
parent sends is very often *"mijn zoon heeft epilepsie en is bang in het water —
is dat een probleem voor de lessen?"*. As originally designed, `Inquiry` reach
was instance-wide, D-013's encryption covered `students` columns only, D-010's
audit rules covered `students.medical.*` reads only, and the table lives in the
`pages` module — so the Content Editor, whose role catalogue entry says in bold
"**No person data**", would plausibly have been given access to health data about
named children by module layout alone. Finding **F-115**.

Inquiry free text is therefore in the protected class (D-148): encrypted under
the same envelope, gated by `inquiries.read` and **never** by `pages.manage`,
audited on read, excluded from the Content Editor bundle explicitly, and
retained 6 months by default. In addition, and more usefully than any of that:
the public form carries a plain line asking people **not** to include medical
information, with the structured *"zijn er medische bijzonderheden?"* field
appearing only after registration, where it is gated and encrypted. Reducing the
collection beats protecting the collection.

Rules for the whole class: separate permission pairs (D-010, D-148);
column-encrypted (D-013); every read audited; excluded from all exports unless
the export explicitly requests it and the requester holds the gating permission
— **and if they do not, the export refuses rather than silently omitting**
(D-153); hard-deleted (not anonymised) from **live storage** at 12 months after
enrolment ends; never present in logs, ever.

**The 12-month figure is a live-storage promise, not a total one.** A deleted
row can still be present in an already-taken encrypted backup until that
backup ages out (D-042, `14-backup-restore-upgrade.md` §3.2/§5.2) — up to the
backup retention window plus, for pre-migration backups, three further
upgrades. The organisation's own privacy notice must state both figures and
the resulting **backup horizon** (the latest date at which a deleted note can
still exist, encrypted, in a backup archive) rather than implying that "hard
deleted" means gone everywhere the moment the row is removed. Finding **F-104**.

### 5.4 Consent

**Decision D-063 — A consent record captures subject, actor, purpose, legal
basis, authority evidence, timestamp and withdrawal. Guardian authority is
*evidence of a claim*, never automatic legal validity.**

```text
Consent
  subjectPersonId      whose data this is
  actorPersonId        who actually gave it
  purpose              photographs · publication of results · marketing · <field>
  legalBasis           CONSENT | LEGITIMATE_INTEREST | CONTRACT | LEGAL_OBLIGATION
  consentType          SELF | ON_BEHALF_OF
  authorityEvidenceId? → PersonRelationship, when consentType = ON_BEHALF_OF
  textVersionId        exactly which wording was agreed to
  givenAt              timestamp
  withdrawnAt?         withdrawal is a first-class event, never a deletion
  withdrawnByPersonId?
```

**Self-consent and consent on behalf of another are separately representable.**
An adult member consenting to their own photograph is `SELF`. A parent
consenting for their child is `ON_BEHALF_OF`, and must point at the
`PersonRelationship` that was the claimed basis for that authority, valid at the
moment consent was given.

**Why authority is evidence, not proof.** The application cannot verify that
someone is legally a child's guardian. It can only record what the organisation
was told, by whom, when, and — through `PersonRelationship.evidence` — how that
claim was established (a registration form, an identity check, a court document
reference). Treating a database row as legal validity would give false comfort
to a school facing a custody dispute. What SplashTrack guarantees is an
**auditable trail of the basis on which the organisation acted**, which is what
accountability under Article 5(2) actually requires.

**Reason.** Consent without a recorded purpose and legal basis cannot be
demonstrated, and consent recorded without the authority behind it cannot be
defended. Both are ordinary demands on any system holding data about minors.
**Trade-off.** More fields at capture time and a UI that has to ask who is
consenting on whose behalf. That question is unavoidable — a system that does not
ask it simply gets the answer wrong silently.

**Not everything is consent.** Attendance and progress records are processed to
perform the teaching agreement, not on consent; recording them under `CONSENT`
would imply they can be withdrawn, which would break the organisation's own
records. `legalBasis` exists precisely so the distinction is explicit per
purpose.

**Decision D-152 — `Consent` records consent and nothing else; withdrawal is
valid only where `legalBasis = CONSENT`; and every consent purpose declares its
withdrawal cascade.**

The model as written permits a row with `legalBasis = CONTRACT` **and** a
populated `withdrawnAt` — which the paragraph above spends its length arguing
must not happen. The UI and the retention job would then either treat withdrawal
of a contractual basis as if it were withdrawal of consent, or ignore it; both
are wrong and neither is detectable. Finding **F-120**.

- `withdrawnAt` / `withdrawnByPersonId` are valid **only** where
  `legalBasis = CONSENT`. Enforced as a schema constraint, not a UI rule.
- **Objection** to processing under legitimate interest (Art. 21) is a
  different event with a different outcome — it is assessed, and may be
  refused — and is recorded as its own `ProcessingObjection`, never as a
  withdrawal.
- The **register of lawful bases per purpose and data class already exists**:
  it is the `lawfulBasis` column of `01-domain-model.md` §5 (D-110), which feeds
  `RetentionPolicy.lawfulBasis`. So the reviewer's proposed third table — a
  separate `ProcessingBasis` register — is **not adopted**: it would be a second
  home for a fact already recorded, and D-134 exists to stop exactly that. What
  is adopted is the constraint above, which is the part that was actually
  missing.
- **Every consent purpose declares its withdrawal cascade**, in the same place
  the purpose is defined, because withdrawal with no stated consequence is
  theatre. Photo consent withdrawn ⇒ the photograph and every published
  derivative are deleted, audited, and the class list falls back to initials.
  Publication-of-results consent withdrawn ⇒ the published item is unpublished.
  Marketing consent withdrawn ⇒ suppression, not deletion of the person. F-04
  said photos are deleted "on erasure"; withdrawal of photo consent is the far
  more common event and had no consequence at all.

**Decision D-151 — Guardian authority expires by operation of law at the age of
digital consent, and the system computes that rather than waiting for someone to
set a `validTo`.**

A swim school's eight-year-olds become sixteen-year-olds well inside the
retention window. Parental authority to consent lapses on a birthday, not on an
administrator remembering. As written, the `ON_BEHALF_OF` consent record stays
apparently valid indefinitely. Finding **F-119**.

- Authority expiry is **derived** from `Person.dateOfBirth` — a column the model
  already holds — against a configurable age-of-consent setting (NL: 16), and is
  evaluated at read time like every other validity in this chapter (D-144).
- Consents whose authority has lapsed are marked **requiring re-consent**, not
  silently invalid and not silently valid, and appear in the privacy admin
  queue with the child's own contact route.
- The same computation flags the adjacent lifecycle change: a member who reaches
  the age of consent may exercise their own rights, so `SELF` reach and the
  guardian's practical access diverge on that date.

**Reason.** It is a computed condition over one column and a date — the cheapest
control in this section — and it is the single most predictable consent failure
in this domain.
**Trade-off.** The organisation acquires a queue of re-consent tasks it did not
have on paper. It had the obligation on paper; it simply could not see it.

### 5.5 Data subject rights

| Right | Mechanism | Who can run it |
|---|---|---|
| Access / inzage | Generates a structured export (JSON + human-readable PDF) of everything about one Person within one org | Org admin with `privacy.export`, step-up required |
| Rectification | Ordinary edit on `Person` / profile; all edits audited | Member administrator |
| Erasure | `person-erasure` transaction: anonymise `Person`, sever pointers, hard-delete special-category data, retain pseudonymised legal records with their ground stated (D-065) | Org admin with `privacy.erase`, step-up, and a confirmation naming the retained records |
| Portability | Same export as access, machine-readable | As access |
| Restriction | `Person` flagged; writes blocked, reads audited | Org admin |
| Objection | Marketing/consent withdrawal is self-service where an account exists | Data subject or guardian |

The template already implements the erasure transaction and knows where the
sharp edges are (its `OrganizationBranding.updatedByPersonId` comment
documents a real Article 17 rollback incident). SplashTrack extends the same
transaction with the domain tables rather than inventing a parallel path.

**Access/inzage — the specification F-88 staged for this chapter.** The export
discloses more than the requesting organisation may realise: guardian details,
instructor names on sign-offs, staff-authored notes and audit actor ids are
other people's personal data, with no preview or redaction pass, while erasure
next door requires one. Separately, medical data is included only when the
*requester* — the staff member running the export — holds
`students.medical.read`, but the entitled party in an Article 15 request is the
**data subject**, so a member administrator without that permission produces an
export that looks complete, is delivered as the organisation's Article 15
response, and is silently missing the health data. The mechanism converts a
permission boundary into a compliance failure with no signal. Finding **F-121**.

**Decision D-153 — The Article 15 export refuses rather than omits, redacts
third parties by default, and ships a generated annex.** Four parts:

1. **Fail loudly.** If any data class in scope is unreadable by the requester,
   the export **refuses to generate**, naming the missing permission and the
   number of withheld records: *"This export omits N special-category records
   and cannot be used as an Article 15 response. It requires
   `students.medical.read`."* There is no "export anyway" button. Fulfilling an
   Article 15 request therefore requires an `ORGANIZATION`-scoped principal
   holding both `privacy.export` and the gating permissions — which is the
   honest description of who can answer one.
2. **Third-party redaction by default.** Other people's personal data is
   redacted unless it is *inseparable from the subject's own record*, and the
   distinction is made per relation, not per field: a guardian relationship is
   the subject's data *and* the guardian's, and is included with the guardian's
   contact details removed; an instructor's name on a sign-off is included
   (a subject is entitled to know who assessed them); a staff-authored note
   about the subject is included, with any named third party redacted; audit
   actor ids are rendered as a role and a date, not a name.
3. **The erasure preview pattern, reused.** Before anything is generated, the
   operator sees what will be disclosed, split into "about the subject" and
   "**about other people**". `04-ux.md` §4.6 already carries this requirement
   for the screen; this is the rule it implements.
4. **A generated annex.** Article 15 requires stating the **recipients**, the
   **retention period** and the **source** of the data, and the export was
   specified as records only. All three are derivable: retention from the
   `RetentionPolicy` table (D-065/D-110), source from the record's own
   provenance (self-registration, staff entry, import), recipients from the
   organisation's configured processors plus a standing statement that the
   project is not one (D-064). The annex is generated, not typed, so it cannot
   drift from the policy table it describes.

**Reason.** An export that quietly omits the most sensitive category is worse
than no export: the organisation believes it has complied and the subject
believes they have seen everything.
**Trade-off.** A member administrator can no longer fulfil a subject access
request alone. That is not a regression — they could not fulfil one correctly
before either; the difference is that now they find out.

**Decision D-014 — Erasure is a single transaction with an explicit table
registry.**
**Reason.** A per-module "clean yourself up" hook silently fails when someone
forgets to register a new table. A central registry with a test asserting that
*every* table referencing `Person` appears in it makes forgetting impossible to
merge.
**Trade-off.** The registry is a shared file that every module edits — mild
coupling, deliberately accepted for a compliance-critical path.
(The registry and its bidirectional test already exist in the template —
`person-reference-classification.ts` + `person-reference-sync.test.ts`, D-135 —
and are adopted rather than rebuilt.)

**Decision D-154 — `AuditEvent` is an *enumerated, justified exemption* in the
erasure registry, not an absence from it.**

D-014's registry must contain **every** table referencing `Person`, with a test
asserting completeness. `AuditEvent` records an actor person id and a target id;
it references `Person`. It is simultaneously declared append-only, never updated
and never deleted by application code (`07-operations.md` §1.2). Both cannot
hold. Either erasure nullifies actor and target ids — destroying the
accountability record the product thesis rests on, and mutating an append-only
table — or `AuditEvent` is silently exempted from the registry whose
completeness test is the entire mechanism preventing forgotten tables. As
specified, the test would **fail on a correct implementation**. Finding
**F-122**.

The registry therefore has two kinds of entry, and every table has one:

| Entry | Behaviour on erasure |
|---|---|
| `erase` | The default: anonymise or delete per D-065 |
| `exempt(ground, until)` | Retained, with a **named lawful ground recorded in the registry file itself** and an expiry |

`AuditEvent` is `exempt`, on the ground of the controller's Article 5(2)
accountability obligation — supported, where a specific dispute exists, by
Art. 17(3)(e) (legal claims). The exemption is **visible in the registry and
enumerated in the erasure report given to the data subject**, rather than being
an absence nobody can see. The completeness test asserts every `Person`-
referencing table has *an* entry, of either kind, which is a check that can pass
on a correct implementation.

The same shape already applies to `Charge` and `Payment` (D-092, financial
retention ground, pseudonymised rather than deleted), so this generalises an
exemption the design had already accepted as a special case.

**Reason.** An exemption that is invisible is indistinguishable from an
omission, and the difference matters precisely when someone is auditing whether
the erasure was complete.
**Trade-off.** The erasure report becomes longer and less satisfying to read:
the subject is told what was kept and why. That is the requirement, not a
concession.

### 5.6 Retention and erasure — policy-driven

**Decision D-065 (replaces D-007) — Retention and erasure are driven by an
explicit, per-purpose policy stating the lawful basis and its expiry. Nothing is
retained because a record happens to exist.**

The earlier design said erasure "severs identity and keeps the pseudonymised
diploma", justified by a ten-year retention. That reasoning was wrong in two
ways, and both matter:

**Pseudonymisation is not anonymisation.** A pseudonymised record remains
personal data under the GDPR while re-identification is reasonably possible —
including by joining it against other data the organisation still holds. Calling
it "no longer identifiable" does not make it so. Only genuine anonymisation, or
deletion, ends the obligation.

**A diploma does not by itself create an Article 17 exception.** An erasure
request may be refused only where a specific ground applies — a legal obligation
to retain, or the establishment/exercise/defence of legal claims. That ground
must be *identified and recorded*, not assumed from the fact that a certificate
exists. Many swim schools will have no statutory retention duty at all.

**The policy model:**

```text
RetentionPolicy
  dataClass          person identity · attendance · progress · exam result ·
                     certificate · medical note · audit event · inquiry
  purpose            why it is kept
  lawfulBasis        and, where retention is claimed, the specific ground
  retainFor          duration, relative to a defined trigger
  trigger            end of enrolment · end of last membership period ·
                     certificate issue · record creation
  onExpiry           DELETE | ANONYMISE | REVIEW
```

Each policy is configurable by the organisation within a platform maximum, is
shown in the privacy admin area, and is executed by the `maintenance` module
with a dry run and a report before anything is removed.

**On erasure:** an erasure request evaluates every data class against its policy.
Classes with no live retention ground are **deleted or genuinely anonymised** —
not merely stripped of a name. Where a ground does apply, the record is retained
*with its ground recorded*, the requester is told which records were kept and
why, and the retention is revisited when the ground expires. Where genuine
anonymisation of a certificate register is not achievable (a certificate number
that can be looked up is, by design, re-identifiable), that must be stated
honestly to the data subject rather than described as anonymisation.

**Reason.** The previous rule optimised for keeping a tidy diploma register and
back-filled a legal justification. This one starts from the basis and lets the
data follow, which is both correct and simpler to defend.
**Trade-off.** The organisation must actually decide its retention grounds
rather than inherit ours; the setup wizard and documentation therefore ship
sensible defaults **as proposals**, clearly marked as requiring the
organisation's own confirmation. Finding **F-27**.

**Decision D-155 — `ANONYMISE` has one mechanical definition, and a data class
that cannot meet it may only be `DELETE` or `REVIEW`.**

This section spends a page arguing that pseudonymisation is not anonymisation.
The retention table then prescribed `ANONYMISE` for attendance — strip
`studentProfileId`, keep `sessionId` and timestamps — while `GroupMembership` is
time-bounded and retained and session dates are known. A group holds around
twelve children: re-identification of a large share of the stripped rows is a
join and a counting argument. The design had re-created the exact error it had
just refuted, one document away, and would then have told a parent their child's
attendance was "anonymised". Finding **F-123**.

**The definition, and the only one this design uses:** `ANONYMISE` means
**destroying the row-level record and retaining only a pre-computed aggregate,
at a granularity that cannot be reduced to an individual** — no identifier, no
foreign key, no timestamp finer than the aggregation window, and suppression of
any cell below a small-count threshold. An aggregate is kept because it was
**computed and stored**, never because a row was stripped. If a class cannot
meet that bar, its only honest options are `DELETE` or `REVIEW`.

This has already been applied where it bit hardest: attendance is now `DELETE`
(D-111, `01-domain-model.md` §5.3), and §5.2's reasoning about certificate
registers — a certificate number that can be looked up is, by design,
re-identifiable — is the same test reached independently. The rule is stated
here so the next data class is not decided by intuition.

**On `REVIEW`, and what the shipped default actually does.** Seven of the
retention classes default to `onExpiry: REVIEW`, and `REVIEW` means *nothing
happens automatically*. A volunteer administrator who has never opened the
privacy screen performs no reviews, so the shipped default behaviour of a
privacy-by-default product is: retain every person, every profile, every diploma
and every consent record indefinitely, behind a queue nobody reads. Two things
are true at once and both belong in the record:

- The **honest part**: v1 does not ship the policy engine (D-120 moved it out;
  R-25 ships retention constants, one scheduled job and the D-014 erasure
  transaction). So `REVIEW` in v1 is a documented "we do not delete this
  automatically", not a queue. Saying so is better than shipping a queue nobody
  opens and calling it a mechanic.
- The **required part**: where a `lawfulBasis` is unresolved it prints as
  *unresolved* (D-110), and the diagnostics page and the privacy screen name the
  count of unresolved bases and overdue reviews. Visible and slightly annoying
  beats silent.

**One reviewer proposal is not adopted:** blocking completion of the setup
wizard until every data class's lawful basis is confirmed. A volunteer
configuring a swim school on a Sunday evening will click through thirteen legal
questions to reach the thing they came for, and the design would then have
*recorded confirmations* that are worth less than the honest blanks it started
with — false comfort of exactly the kind D-063 and D-065 exist to prevent. The
`unresolved` marker plus a persistent, countable warning gets the visibility
without manufacturing the consent.

### 5.7 Logging without personal data

Operational logs (pino) carry: request id, org id, person id (**opaque id
only**), route, outcome, duration. Never names, emails, notes, or request
bodies. The audit trail is the place where "who did what to whom" is recorded,
with access control on top of it — logs and audit are different systems with
different retention and different readers.

---

## 6. Trust boundaries


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

```text
┌─────────────────────────────────────────────────────────────────┐
│ BOUNDARY 0 — Deployment isolation  (strongest, infrastructural) │
│   Org A instance │ Org B instance │ Org C instance              │
│   separate process · database · storage · domain · secrets      │
│   NO shared runtime, NO shared data, NO control plane (D-029)   │
└─────────────────────────────────────────────────────────────────┘
        each instance internally:
┌─────────────────────────────────────────────────────────────────┐
│ INTERNET (untrusted)                                            │
│   anonymous visitors · authenticated users · API consumers      │
└───────────────┬─────────────────────────────────────────────────┘
                │  TLS · rate limit · CSP
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 1 — Application edge (Next.js middleware)              │
│   session resolution · CSRF · headers · public vs portal split  │
└───────────────┬─────────────────────────────────────────────────┘
                │  requirePermission(perm, resourceRef)  /  resolveReach()
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 2 — Scope enforcement  (the boundary that now matters) │
│   ORGANIZATION ▸ UNIT ▸ GROUP ▸ COURSE ▸ SESSION ▸ SELF         │
│   deny by default · scope-escape tests per module (D-032)       │
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 3 — Special-category data                              │
│   separate permissions · column encryption · audited reads      │
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 4 — Environment separation                             │
│   DEV  ──promote──▶  UAT  ──promote──▶  PROD (per instance)     │
│   synthetic data      synthetic data      real data             │
│   Lucky: full         Lucky: read-only    Lucky: NO ACCESS      │
└─────────────────────────────────────────────────────────────────┘
```

### 6.1 The boundaries stated as rules

| Boundary | Rule | Enforced by |
|---|---|---|
| Org A → Org B | **No shared anything.** Separate deployment, database, storage, domain, secrets | Infrastructure, not application code (D-012 revised) |
| Internet → App | No trust in any client input | Validation at every entry point |
| App → Data (write / single read) | Every protected operation calls `requirePermission(perm, resourceRef)` | Lint rule requiring the guard; code review |
| App → Data (lists) | Every list query is constrained by `resolveReach()` | Reach is a required repository argument (D-031) |
| Scope → wider scope | A `GROUP`-scoped role cannot reach the unit; a `UNIT`-scoped role cannot reach another unit (`UNIT` is flat, D-121); a `SESSION`-scoped role cannot reach outside its roster or its window | Scope-escape tests per module (D-032); `Reach` constructible only by `resolveReach` (D-147) |
| Grant → wider grant | No actor may grant a permission they do not hold, at a scope wider than their own, or for a window longer than their own | Enforced in the grant service, not the UI (D-139); scope-escape test cases per module |
| Ordinary → protected free text | Medical, pastoral, assessment and inquiry free text: separate permission, audited **read**, encrypted with AAD | D-010, D-013, D-148, D-096 |
| App → an administrator-named destination | Private ranges denied, address pinned after resolution, no redirects, no response detail returned | One shared egress-controlled client (D-142) |
| Ordinary → special-category | Separate permission, audited, encrypted | D-010, D-013 |
| DEV → UAT → PROD | Artifacts promote; data never does | CI/CD design (`06-delivery.md`) |
| Lucky → PROD | **No path exists.** Not "restricted" — absent | No credentials issued (`06-delivery.md` §4) |
| CI → an instance | Per-instance deploy credentials, short-lived OIDC | GitHub Environments, one per instance |
| Instance → instance | No operator credential grants access to a second instance | Per-instance secrets (D-029) |

### 6.2 Abuse scenarios considered

| Scenario | Mitigation |
|---|---|
| Instructor tablet stolen from pool deck | Short idle timeout by role; the Instructor role holds no export, bulk or admin permission at any scope (D-143); session revocation from the breach-response inventory (D-128) |
| **Instructor browses students they don't teach** | `GROUP`-scoped grants; reach-filtered lists; **per-relation coverage evaluated live** (D-145); scope-escape tests on the fields returned. **This is now the primary internal threat** |
| **Instructor retains access to a child they taught two years ago** | Coverage requires an *active* membership and an *active* instructor assignment at query time (D-145) — the append-only membership history grants nothing |
| Location manager reads another location's records | `UNIT` is **flat** (D-121) — it covers that unit only, never a descendant, never sideways, never up. A student who crosses units is governed by their **home** unit for their profile (D-145) |
| **Location manager grants themselves an organisation-scoped role** | No amplification, scope confinement, window confinement — enforced in the grant service (D-139), tested per module. `roles.assign` exists and is in the MFA-compelling high-risk set |
| **Settings administrator adds their own identity provider and logs in as instance administrator** | `identity.providers.manage` is separate and high-risk; linking is `(issuer, sub)` only, never email; JIT creates nothing; `ORGANIZATION`-scoped accounts are opt-in for external authentication (D-140). The registry is also out of v1 |
| Org admin exports the whole member base and leaves | Export requires step-up, is rate-limited, raises a high-severity audit event. **Step-up is not a control against this actor** (§1.2) — the audit event, the notification and the grant expiry are |
| **Administrator deletes the audit rows recording what they did**, or lowers audit retention to one day | Hash-chained events with a verification pass surfaced on diagnostics; `INSERT`-only database role on `AuditEvent`; audit retention is a `bounded` setting with a 12-month floor (D-149, D-150) |
| **Settings page used to scan the operator's internal network**, or to reach cloud instance metadata | One egress-controlled outbound client: private ranges denied by default, resolve-and-pin against DNS rebinding, no redirects, no response detail returned (D-142) |
| **Content editor reads health data about a named child** via the website inquiry inbox | `inquiries.read` is its own permission, never implied by `pages.manage`; inquiry free text is encrypted and audited; the public form asks people not to send medical detail (D-148, §5.3) |
| **A populated database is put back into unauthenticated setup mode** by deleting one row | Setup mode requires zero `UserAccount`, `Person` and `RoleAssignment` rows as well as no bootstrap record; data without the record is `TAMPERED` — refuse to serve (D-099) |
| Parent guesses another child's record via ID | Opaque non-sequential IDs; scope check on every fetch; no enumeration |
| Public site used to enumerate members | Public surface never queries person tables (`03-deployment-model.md` §5.1) |
| Malicious/compromised dependency | Lockfile, Dependabot, audit gate, no post-install scripts from new deps without review |
| Compromised Lucky / prompt injection via issue text | No PROD path, no real data, no secret access; all output arrives as a reviewed PR (`06-delivery.md` §4.3) |
| Backup exfiltration | Backups encrypted per instance under a per-archive data key (D-114); protected free-text columns separately encrypted; v1 writes to a mounted volume only, with no remote destination to redirect (D-103) |
| **Restoring an archive someone else supplied** | A `.stbak` from any source other than the operator's own instance is untrusted input; the export is a structured logical export the application reads itself, and the database role is not a superuser (D-095, D-116) |
| **Compromise of one customer's instance** | Blast radius is one organisation. No shared credentials, no control plane, no lateral path (D-029) |

The table previously ended with a row for an **"operator with fleet deploy
rights"**, called "the genuinely dangerous principal now" and pointing at F-14.
That row is deleted: the fleet model is gone (`03-deployment-model.md` §1.1) and
F-14 is closed, so it described a principal that does not exist — in a table an
implementer reads as a to-do list. `07-operations.md` FM-6 carries the same
stale assumption and is flagged for that chapter.


---

# 03 — Distribution Model, Theming & Public Website

> **Revised twice.** Multi-tenant → single-tenant → **self-hosted open source**.
> See `11-revision-single-tenant.md` and `12-revision-open-source.md`.


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. Distribution model — open-source, self-hosted container


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**Decision D-012 (final) — SplashTrack is an open-source application shipped as
a Docker image. Each organisation downloads it and runs it on infrastructure it
owns and controls. We operate nothing.**

```text
  we publish            they run
  ──────────            ────────
  ghcr.io/…/splashtrack:1.4.0  ──▶  organisation's own server
  docker-compose.yml           ──▶  their Docker + their Postgres
  documentation                ──▶  their domain, their TLS, their backups
  source code (public repo)    ──▶  auditable, forkable, self-supportable
```

**Reason.** The organisation is then the sole controller *and* the operator of
its own data. There is no processor relationship, no data processing agreement,
no third party holding health data about children, and no cross-customer path
of any kind. Open source additionally makes the security and privacy claims in
this design **verifiable** rather than asserted — which is worth more to a
school board than any certification we could buy.

**Trade-off.** We lose all operational control. We cannot patch a vulnerable
instance, cannot see that one is failing, and cannot guarantee anyone runs a
current version. Our influence is limited to what we ship: safe defaults, easy
upgrades, honest release notes and a loud version check. Support becomes
documentation and issue triage rather than intervention. Finding **F-13
(revised)**.

### 1.1 What this deletes — again

| Removed | Why |
|---|---|
| Fleet manifest, waved rollouts, version-skew monitoring | We have no fleet |
| Provisioning script for customer instances (D-028) | The operator runs `docker compose up`; first-run setup happens in-app |
| Per-instance deploy credentials and GitHub Environments per customer | We deploy nothing but our own dev/demo |
| Fleet-operator threat model (F-14) | No principal has access to any customer instance |
| Per-customer cost floor (F-16) | Hosting cost is the organisation's, not ours |
| Data processing agreement per customer (F-05) | We never process their data |

Combined with the single-tenant revision, **the entire operational half of the
original design is gone.** What remains is a product and a release process.

### 1.2 What the artifact must be

**Decision D-033 — One application image, plus a reference `docker-compose.yml`
that includes PostgreSQL.**
**Reason.** "Complete application" must mean *works after one command*, or
self-hosting fails for exactly the small organisations that most need it.
Bundling Postgres *inside* the app image would be an anti-pattern (no clean
upgrades, no backup story, data trapped in a container), so the image stays
app-only and the compose file supplies the database, a volume and sane
defaults.
**Trade-off.** Two containers rather than one; operators wanting a managed
database point `DATABASE_URL` elsewhere. Acceptable and expected.

#### Target properties of the image — and what is actually true today

An earlier draft of this section listed six "non-negotiable properties of the
image" as though they described the artifact we have. They do not. Verified
against the repository: the Dockerfile is a self-described *"development/Sprint-0
image"* — single-stage, `FROM node:22-alpine` with no digest pin, `npm ci`
including devDependencies, the full source tree in the final layer, and the
process running as root. `postgresql-client` is not installed, although
`14-backup-restore-upgrade.md` §3.1 previously claimed the client tooling ships
in the image. Two further bullets in that list were not merely unmet but *wrong*:
"all configuration via environment variables" inverts the whole of chapter 13,
and "secrets are generated on first run and written to the data volume" is
incompatible with restore (the archive would then contain its own key — F-96).

The list below is therefore stated as **targets with their current status**, not
as a description. An implementer must be able to tell which of these they have
to build. Finding **F-102**.

| Property | Status | Where it is specified |
|---|---|---|
| **No default credentials, ever.** The app refuses to start on a placeholder value. Bootstrap key material is operator-supplied via `SECRET_KEY_FILE`; the application never writes key material to the data volume | **To build** | `13-…` §3.1.1 (D-112) |
| **Bootstrap secrets only in the environment.** All runtime configuration is database-backed and edited in-app | **To build** | `13-…` §3 (D-036/D-037) |
| **First-run setup wizard in-app** — first administrator, forced MFA, organisation name, branding. Replaces D-028's script | **To build** | `13-…` §6.3 (D-039) |
| **Migrations never run against a database whose state is unknown.** The entrypoint detects state first; migration is a consequence of that state | **To build** | `13-…` §6 (D-055, D-098) |
| **The application's database role is not a superuser** — owner of its own schema only, `NOSUPERUSER NOCREATEROLE`, created that way by the reference compose | **To build** | `14-…` §4.2 (D-116) |
| **Runs as non-root**, read-only root filesystem, multi-stage build, no build tools or devDependencies in the final layer, digest-pinned base image, published SBOM | **None of this holds today.** Single-stage, root, undigested, devDeps present | Phase 1 of the build |
| **`postgresql-client` present** for dump/restore tooling | **Absent today** | `14-…` §3.1 |
| **Health and readiness endpoints** so an operator's own monitoring works | **To build** | — |
| **Backup and restore commands shipped with the image**, because a self-hoster who cannot restore has no backups | **To build** | `14-…` §3, §4 |

**D-095** (stated in `14-…` §3.1, not restated here) makes the backup a
structured logical export the application writes and reads itself rather than a
raw SQL dump. It is named here only because it changes what the image must
contain.

The lifecycle of `SECRET_KEY` is stated **once**, authoritatively, in
`13-configuration-and-setup.md` §3.1.1. This chapter does not restate it, and
neither does `14-backup-restore-upgrade.md`; both point at it. Finding **F-95**.

### 1.3 Structure inside an instance

Unchanged from the single-tenant revision. `Organization` is an enforced
singleton (D-027); `OrganizationUnit` provides the internal hierarchy that the
scoped authorization model (`02-security-privacy.md` §2) scopes against. `UNIT`
is flat in v1 and no scope type walks a tree (D-121).

---

## 2. Release and upgrade model


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

This replaces fleet management entirely. Our obligations shift from *operating*
to *shipping responsibly*.

| Concern | Approach |
|---|---|
| **Versioning** | Semantic versioning, strictly. Operators upgrade on their own schedule and must be able to trust the contract |
| **Upgrade path** | Any version upgrades to any later version within a major. Migrations are forward-only, idempotent, and tested against a populated database in CI |
| **Skipped versions** | Explicitly supported — a self-hoster who upgrades once a year must not be stranded. Migration chains are never squashed within a major version |
| **Release notes** | Every release states: security fixes, breaking changes, migration duration risk, and required operator action. Written for an IT generalist, not for us |
| **Security advisories** | GitHub Security Advisories + a published `SECURITY.md` with a disclosure address and response commitment |
| **Version check** | The app checks for newer releases and **warns the administrator in-app when running a version with a known advisory**. Opt-out, no personal data sent, documented exactly (§2.1) |
| **Backups** | We ship the commands and document the policy; executing it is the operator's duty (`07-operations.md` §2) |
| **Support** | GitHub issues, documentation, and the source itself. No SLA is promised |

### 2.1 Telemetry — the honest position

**Decision D-034 — No telemetry. The only outbound call is an opt-out version
check that sends nothing but the version it is checking.**
**Reason.** A privacy-first product that phones home about a school's usage
would be self-contradicting, and the code is public so any such call would be
found and resented. The version check earns its exception because unpatched
self-hosted instances are the single biggest residual security risk (F-17), and
it can be implemented as a plain fetch of a static advisories file — no
identifiers, no counters, no server-side logging we control.
**Trade-off.** We learn nothing about adoption, usage or which features matter.
Accepted; that information is not ours.

**What the request nevertheless discloses.** "Sends nothing" is not exact and
the design's credibility rests on claims like this being exact. Every HTTPS
request necessarily discloses your server's IP address and a User-Agent to the
host serving the file, and therefore that this organisation runs SplashTrack, at
this address. The application fetches the **complete** advisories file rather
than querying per version, so the request reveals nothing about which version is
running, and "no server-side logging we control" concedes rather than answers
the point. It is disabled with `update.check.enabled = false`. The default stays
**on**: F-17 names unpatched instances as the single biggest residual risk.
Finding **F-131**.

---

## 3. Open-source considerations


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| Concern | Position |
|---|---|
| **Licence** | **AGPL-3.0** (D-067, closes OD-13). Chosen over the GPL-3.0 the repository already carried because GPL copyleft triggers on distribution, not network use — and SplashTrack is software that is *run as a service*. AGPL §13 is what stops a competitor hosting a modified SplashTrack for swim schools while publishing nothing |
| **Security by design, not obscurity** | The source is public, so every control in this design must hold against an attacker who has read it. Nothing here relies on secrecy — which was already true, and is now enforced |
| **Supply chain** | Pinned dependencies, lockfile, Dependabot, `npm audit` gate, signed images, published SBOM, provenance attestation. A compromised dependency now ships to every self-hoster (F-18) |
| **Secrets** | No secret may ever be committed. Push protection and secret scanning are mandatory, and a leaked secret in history is permanent in a public repo |
| **Contributions** | `CONTRIBUTING.md` with a **DCO sign-off** requirement (F-28), and a rule that security-relevant changes require maintainer review regardless of author. The DCO must be in place before the first genuine external contribution: after that point, relicensing needs every contributor's agreement — the constraint that nearly cost us D-067 |
| **Issue hygiene** | Public issues may contain a self-hoster's logs or screenshots. The template must warn against pasting personal data, and maintainers redact |
| **Documentation is a feature** | For a self-hosted product, install and upgrade documentation is as load-bearing as the code. It ships in the repo and is versioned with it |

## 4. Theming architecture


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Simplified: exactly one branding configuration per instance, so
`PlatformSettings` and `OrganizationBranding` collapse into a single `Branding`
singleton.

The mechanism is unchanged and inherited (ADR-007/010/017): **design tokens
emitted as CSS custom properties**, resolved server-side per request.

```text
Built-in defaults  →  Branding (singleton)  →  CSS custom properties
     (code)               (database)                (per request)
```

Bootstrap and all components consume those variables. No stylesheet is edited,
no custom CSS is stored or executed, and theming never requires a source-code
change — the brief's hard requirement.

**Decision D-016 (unchanged) — Tokens are a closed, validated set; never
arbitrary CSS.**
**Reason.** Even within one organisation, admin-supplied CSS is a stored-XSS
vector against that organisation's own users, and it turns every future UI
change into a per-customer regression risk across the fleet.
**Trade-off.** No arbitrary visual design. The brief's full list — name, logo,
favicon, colours, typography, navigation style, images, homepage, footer,
contact details, public pages, custom content — is fully expressible within the
token set.

Contrast is validated at **save time** against WCAG 2.2 AA; failing
combinations are rejected with the nearest passing shade offered. Fonts are
self-hosted from a curated set — no third-party font CDN, which would leak
visitor IP addresses.

---

## 5. Public website architecture


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 5.1 Three surfaces, one deployment

| Surface | Route group | Auth | Data reach |
|---|---|---|---|
| Public website | `(public)` | None | Published content + branding **only** |
| User portal | `(portal)` | Session | Own data + scoped reach |
| Administration | `(portal)/admin` | Session + permission + MFA | Full instance scope |

**Decision D-017 (unchanged, and now carrying more weight) — the public surface
has its own read model and may not touch person tables.**
**Reason.** Single-tenancy removed the cross-organisation leak. It did *not*
remove the worst plausible incident: a public page exposing this organisation's
own children. If the public renderer has no code path to `Person`,
`StudentProfile`, `Attendance` or `Exam*`, no CMS bug can expose them.
**Trade-off.** Publishing anything person-derived requires an explicit opt-in
that copies approved fields into a published content record. That friction is
where consent belongs.

### 5.2 CMS scope — deliberately small

Inherited `pages` module: slug, title, body, draft/published status, navigation
placement. SplashTrack adds a small block set: rich text, image, call-to-action,
contact form, opening hours, course overview (public catalogue only, never
enrolments), FAQ.

Out of scope: arbitrary HTML/JS, plugins, drag-and-drop page building, per-page
CSS, e-commerce. Rich text is stored structured (TipTap) and sanitised
server-side **on save and again on render**.

### 5.3 Public forms

Contact and course-interest forms are the only public write paths:
rate-limited, bot-checked, no user enumeration, writing to an `Inquiry` table —
never to `Person`. Converting an inquiry into a person is a deliberate
administrative act.

### 5.4 Caching

Public pages are cached (ISR or equivalent). The tenant-in-cache-key hazard
(previously FM-6) is reduced by single-tenancy, not eliminated: any public page
rendering session-dependent chrome — a "logged in as…" nav — would cache one
visitor's view for every other visitor. Therefore **public pages are rendered
with no session read at all**, which is what makes D-017's structural claim true
at the rendering layer and not only at the data layer. Portal pages are never
cached across users. Finding **F-132**.


---

# 04 — UX, Information Architecture & Design System


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. Information architecture


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Three surfaces, three distinct information architectures, one design language.

```text
PUBLIC (anonymous)
  Courses (catalogue) · Contact (inquiry form)
  — that is the whole public surface in v1 (00-overview.md §3.5.1).
    The general CMS is out of scope; the school has a website.

PORTAL (authenticated — what you see depends on your roles)
  Today            ← the landing surface. Not a dashboard of charts
  My groups        ← instructor
  Students         ← member admin, instructor (scoped)
  Courses
  Planning
  Assessments      ← aftesten: schemes, sittings, results (R-30)
  Exams
  Fees             ← balances, charges, payments (R-32)
  Waiting list     ← inquiries and placements (R-33)
  Reports
  My profile

ADMIN (permission-gated)
  Organisation     name, contact, policies, retention constants
  Branding         logo, colours, typography, navigation style
  Course catalogue page
  People & roles   accounts, role assignment, access groups
  Criterion schemes  ← versioned; NRZ-sourced schemes are labelled and forked, not edited
  Locations & resources
  Fee types
  Privacy          exports, erasure requests, consent texts
  Audit log        ← including the "what did this account do" report (R-37)
  Sessions         ← active-session inventory and global revocation (R-37)
  Settings         ← one plain page, ~15 settings (R-17)
```

**Decision D-018 — The portal landing page is "Today", not a dashboard.**
**Reason.** The dominant user is an instructor arriving five minutes before a
lesson. What they need is *this session, this group, these students, one tap to
register*. A KPI dashboard serves the administrator, who is a much rarer
visitor with much more time. Optimise the landing surface for frequency, not
for seniority.
**Trade-off.** Administrators need one extra click to reach an overview. That
is the right cost distribution.

"Today" shows: your next/current session with a primary action, your groups,
anything requiring attention (unregistered past sessions, pending exam results,
open privacy requests — filtered by permission). For an administrator with no
sessions, it degrades into the organisational overview.

---

## 2. Navigation structure


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

- **Single portal shell** with persistent navigation and a content area. New
  sections are nav entries and route groups, never parallel shells.
- **Desktop:** persistent left sidebar, collapsible.
- **Tablet (primary operational device):** bottom tab bar for the four most
  frequent destinations; large touch targets; sidebar available but not needed
  for the core loop.
- **Phone:** bottom tab bar, single column, progressive disclosure.
- **Navigation style** (sidebar vs top bar) is a branding token the organisation
  may set — one of the brief's requirements, satisfied within the closed token
  set (D-016).
- Nav entries are **permission-filtered**, and a denied section is *visibly*
  denied rather than silently hidden where the template's ADR-024/027 pattern
  applies — hiding everything makes support conversations impossible. Hiding is
  never the authorization; the layout is the gate.

---

## 3. Page hierarchy


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

```text
Portal
 └ Today
 └ Groups
    └ Group detail
       └ Session detail  →  ATTENDANCE REGISTRATION (the hot path)
       └ Group students  →  BULK SKILL SIGN-OFF (the second hot path)
 └ Students
    └ Student detail
       └ Progress · Attendance · Enrolments · Exams · Notes · Privacy
 └ Courses → Course detail → Levels → Criteria (the single catalogue)
 └ Planning → Calendar → Session detail
 └ Assessments → Sitting → Candidate → Criterion grades   ← R-30
 └ Exams → Exam session → Candidates → Results → Award
 └ Fees → Payer balance → Charge → Payments               ← R-32
 └ Waiting list → Entry → Place into group                ← R-33
```

Depth is capped at four levels. Anything that would need a fifth is a filter or
a panel, not a page.

---

## 4. Key user workflows


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 4.0 The incumbent is pen and paper

Everything in this chapter was written against an implicit competitor: another
system. There is none. The thing SplashTrack has to beat is a clipboard, and
that changes the calculus in **both** directions — some things become much more
serious, others become apparatus.

**1. Print fallback is minimum viable parity, not a nice-to-have.** Paper never
has a zero-percent day. A wet sheet is still legible. A forgotten sheet is
reconstructed from memory at the end of the lesson. A broken pen is replaced by
another pen. An application that will not load shows *nothing at all*, and the
instructor standing at the poolside has no move. A **"print tonight's class
lists"** button therefore belongs in the first release (R-35), and P-02
(*"offline prepared, not built"*) is defensible **only** because it exists.

**2. A first-lesson failure is permanent.** When paper fails, the instructor
blames the rain. When the app fails, they go back to paper and never come back.
Reliability across the first three lessons outweighs any feature in the backlog.

**3. Keep the thirty-second target; stop letting it justify apparatus.** The
target produces a better interface and it stays. But the win actually described
is *"stop losing the paper"* — and that is satisfied by entering attendance from
the sheet, on a phone, after the lesson. **A v1 used post-hoc from paper is a
legitimate, winning v1**, and designing as though real-time poolside entry were
the only success condition is what bought the apparatus below. Removed
accordingly:

- **`SHARED_DEVICE` mode (D-009)** — gone. The device is a personal phone with a
  biometric lock, or an iPad the school owns. Replaced by a short idle timeout
  and an instructor role that holds no export and no admin permission at all.
- **Poolside step-up re-authentication** — gone. **Any mid-lesson
  re-authentication is a defect against a clipboard.** MFA is kept **at login**
  for the high-risk permission set (R-13) — once a week, on a personal phone,
  entirely reasonable. Step-up survives only where it guards a deliberate,
  seated action: issuing an award, running an export, executing an erasure.

**4. Passkeys survive, and the objection to them evaporates.** The criticism was
valid only under the shared-tablet assumption — every instructor enrolling a
passkey on one communal iPad. On a personal phone a passkey is Face ID, which is
genuinely the best wet-hands answer available and needs no typing at all.

**5. The WebAuthn RP-ID lockout is a live trap, and this is the expected path.**
Jack will start on something like `http://nas.local:3000` and move to a real
domain later. Changing `APP_URL` changes the relying-party id and **invalidates
every passkey**. So: set the RP ID **deliberately at setup** rather than
deriving it silently, warn loudly and name the consequence on change, and
**always retain a password + TOTP fallback per account**. Cheap now; a
total-lockout incident otherwise (`07-operations.md` FM-15).

**6. Procurement beats engineering, and it belongs in the documentation.** A
phone has cellular. A WiFi-only iPad in an RF-hostile tiled pool hall does not.
**If the school buys an iPad, buy the cellular model.** That one sentence in the
deployment documentation is worth more than a week of offline-queue engineering,
and it should be written down before anyone estimates offline sync.

### 4.1 Register attendance — the flagship

**Target: under 30 seconds for a group of 30, on a tablet, with wet hands.**
(Thirty is the size used by the product thesis, the latency NFR and the skill
matrix — `00-overview.md` §4.1. This chapter previously said "~12", which is a
materially different screen.)

```text
Today  →  [Start session]  →  student list, all pre-marked PRESENT
          tap a student = ABSENT · long-press = EXCUSED/LATE + note
          [Save]  →  confirmation, back to Today
```

Design rules that follow from the target:

1. **Default to present.** Absence is the exception; make the exception the tap.
   A list defaulting to "unmarked" doubles the interactions.
2. **Two taps minimum path.** Start → Save. Everything else is optional.
3. **Touch targets ≥ 48 px**, generous spacing, no hover-dependent affordance.
4. **One transaction.** All records save together or none do (§4 of the domain
   model). The UI must never show a partial success.
5. **Idempotent writes.** Every save carries a `clientEventId`; a retry after a
   flaky pool-side WiFi connection cannot double-write.
6. **Optimistic UI with honest failure.** Show success immediately, but if the
   write fails, say so loudly and keep the data on screen — never silently drop
   an instructor's work.
7. **Offline path prepared, not built (P-02).** Because writes are idempotent
   events against a known session id, a future queue is additive. **The
   fallback that ships instead is paper** — the printed class list (§4.0, R-35).
8. **One audit event per group registration, not per student.** Audit appends
   serialize on a Postgres advisory lock; thirty chained rows for one save would
   contend globally against every other audit writer
   (`05-technical.md` §5 rule 6).

### 4.2 Sign off skills for a group

```text
Group  →  Skills  →  matrix: students × skills for the current level
          tap a cell to mark ACHIEVED · tap again to undo (within the session)
          [Save]  →  one transaction, one audit event per sign-off
```

The matrix is the correct form because instructors assess *one skill across the
group*, not one student across skills. Column-first interaction; the column
header signs off the whole column with a confirmation.

Revoking an already-achieved skill is a **separate, permissioned action**
(`skills.revoke`) with a mandatory reason — it affects a child's diploma path
and must never be a mis-tap.

**The undo boundary needs a third state, and it will bite weekly without one.**
As written there are exactly two: free undo *before* Save, and a permissioned
revoke *after* it. A fat-fingered achievement on a 30 × 40 grid with wet hands
therefore requires an administrator, because a `GROUP`-scoped instructor does
not hold `skills.revoke`. That is a guaranteed weekly interruption caused by
correct-looking design.

**Give the instructor a bounded self-correction window.** For a short period
after Save — long enough to notice, short enough not to be a back door; a
setting, defaulting to the end of the session — the *signing instructor* may
withdraw their *own* sign-off from that session. It writes a superseding event
with a reason like any other correction (D-061's discipline), it is audited, and
it never touches a sign-off made by someone else or in an earlier session.
Beyond the window, `skills.revoke` applies unchanged.

### 4.3 Find a student

Global search, keyboard-first on desktop, always reachable. Searches name and
student number within the caller's reach only. Results show only what the
caller may see — reach-filtered, so an instructor finds only students in their
own groups. Other organisations run separate installations and are not
reachable by any query.

### 4.4 Record exam results

```text
Exam session  →  candidate list  →  per candidate: PASS/FAIL + remarks
                 [Record results]  →  step-up when issuing awards
                 → award records generated, audit events written
```

Results are append-only (D-062): a correction writes a **new** result carrying
`supersedesResultId`, and the award is revoked and reissued rather than edited.
The candidate list shows the effective result and a link to its history.

**A candidate cannot reach this screen without a passed aftest.** The gate is a
domain invariant, not a UI check, and the screen simply reflects it: a candidate
who has no non-superseded passing aftest from a *qualified assessor who is not
their own instructor* cannot be confirmed. It is overridable with an explicit
permission and a recorded reason — in a club with four instructors there will be
a week when no independent assessor exists, and an un-overridable rule just gets
worked around by logging in as someone else (`15-assessment-and-fees.md`).

### 4.5 Onboard a new student

```text
Admin → Students → New
  → search existing Person first (prevents duplicate PII)
  → create or link Person → create StudentProfile → enrol in course
  → optionally: guardian relationship, consent capture, group assignment
```

Person search is deliberately the first step, and is scoped to the current
organisation.

### 4.6 Fulfil a GDPR request

```text
Admin → Privacy → New request → type (access/erasure/rectification)
  → subject selection → preview of what will be exported/erased
  → step-up authentication → execute → receipt + audit event
```

The **preview before execution** is non-negotiable for erasure: the operator
must see exactly which records will be deleted, which will be retained, and
**under which stated ground** — per the policy evaluation in
`02-security-privacy.md` §5.6 (**D-065**). This previously read "which
pseudonymised records will be retained (D-007)". D-065 replaces D-007
explicitly, on the grounds that pseudonymisation is not anonymisation and does
not end the obligation; no active chapter may cite D-007 as an instruction.

**Reuse the preview for the Article 15 export.** The erasure flow's preview is
the best privacy pattern in this design and the export currently has nothing
like it — it discloses guardian details, instructor names on sign-offs,
staff-authored notes and audit actor ids, which are **other people's personal
data**, to whoever requested it. The export screen therefore gets the same
shape: a preview of what will be disclosed, including what is disclosed *about
third parties*, before anything is generated. And it must **fail loudly** rather
than quietly omitting: an operator holding `privacy.export` but not
`students.medical.read` currently produces an export that looks complete and is
delivered as the organisation's Article 15 response with the health data
silently missing.

### 4.7 Assess an aftest

```text
Assessments → new sitting → scheme (pinned version) → candidates
  → per candidate: every criterion, DEFAULT UNSET
     [set whole column ▾] with confirmation, for the criterion the group just did
  → per-criterion remark (behind the notes permission, not general read)
  → waiver, with a reason, where a criterion is not applicable
  → [Record]  →  pass computed from the scheme, never typed
```

**This screen does not inherit the thirty-second doctrine, and that is
deliberate.** The design's answer to everything else is "default the common
value and make the exception the tap". **Applying it here would destroy the
control the feature exists to provide.** Pre-filling *voldoende* on the
assessment that decides whether a child may sit an exam manufactures
rubber-stamping, and the four-eyes gate becomes ceremony.

So: **default unset**; allow set-whole-column *with* a confirmation, because
grading one criterion across the group is the real interaction; and **accept
that an aftest takes ten minutes.** One qualified instructor grading twelve
children across twenty criteria is 240 ordinal values in one sitting, and it is
the most consequential data entry in the product. Full detail:
`15-assessment-and-fees.md`.

### 4.8 The remaining v1 screens

| Screen | Shape | Note |
|---|---|---|
| **Balance** (R-32) | Per payer and per student: open charges, recorded payments, running balance. *"Sanne de Vries — contributie Q3 €67,50 open · examengeld Diploma A €12,50 open."* Plus a CSV export | **Administration surface only.** A payment flag never appears on the poolside class list: that puts a family's finances in front of a volunteer instructor. P-03's clean seam is re-affirmed here rather than drifted through |
| **Waiting list** (R-33) | A list of `WaitlistEntry` rows with a **place** action that carries the person straight from `Inquiry` into a group | The front door. It is where a school loses prospects today |
| **Group move** (R-34) | From the group or the student: choose the target group, **give a reason**, confirm. Works in both directions | Moving a child *back down* is the case people forget to build and the case that most needs a recorded reason |
| **Printable class list** (R-35) | One button on Today and on the group: a clean sheet with names, the session, and space to write | §4.0(1). Design it as a *sheet an instructor can write on*, not as a screenshot of a table |
| **Printable exam candidate list** (R-35, R-36) | Name, date of birth, award type, date | Handed to the NRZ delegate at the pool. **Not** a guest login, not a share link, not a read-only visitor account — no stranger touches a device holding children's records, and it takes half a day |

---

## 5. Design system


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 5.1 Foundation

Inherited: Bootstrap themed through CSS custom properties, so branding
overrides require no stylesheet edits. The template's `ui-primitives.md`
documents the existing component vocabulary; SplashTrack extends it rather
than replacing it.

**Decision D-019 — Keep Bootstrap; do not migrate to Tailwind or a headless
component library.**
**Reason.** It works, it is already themed through tokens, the team knows it,
and the brief demands minimal code and no complexity without concrete need. A
migration would be weeks of work delivering zero user-visible value.
**Trade-off.** Bootstrap's default look is recognisable, so achieving a
"graphically high-quality, modern" result depends on disciplined use of the
token system (spacing, radius, typography, density) rather than on the
framework. That discipline is where the visual design effort should go.

### 5.2 Component layers

```text
Tokens        colour · spacing · radius · typography · elevation · density
Primitives    Button · Input · Select · Checkbox · Badge · Avatar · Card · Modal
Patterns      DataTable · FilterBar · EmptyState · ConfirmDialog · StepUpPrompt
Domain        StudentCard · AttendanceRow · SkillMatrix · SessionHeader · ProgressBadge
Layouts       PublicShell · PortalShell · AdminShell
```

Domain components are owned by their module; primitives and patterns are
shared. A module never reaches into another module's domain components.

### 5.3 Interaction and accessibility baseline

- WCAG 2.2 AA, verified with axe in E2E, contrast validated against org brand
  colours at save time (§4 of `03-deployment-model.md`).
- Skip-to-content, labelled controls, visible focus, full keyboard operability.
- Motion respects `prefers-reduced-motion`.
- Every destructive action: confirmation naming the specific object.
- Every list: a designed empty state and a designed error state.
- All text through next-intl; NL default, EN available. No hardcoded strings.

### 5.4 What "graphically high-quality" means here

Concretely, and in priority order: generous whitespace and a consistent 8-point
spacing rhythm; one typographic scale used consistently; colour carrying
meaning (status, not decoration); real empty and loading states rather than
spinners over blank pages; and instant-feeling interactions on the hot paths.
Clarity first — the brief says functionality and clarity have priority, and a
beautiful interface that slows down a poolside sign-off has failed.

### 5.5 Deliverables before UI code

Per the brief, in this order: information architecture (§1) → navigation (§2) →
page hierarchy (§3) → workflows (§4) → component inventory (§5.2) → wireframes
for the hot paths (§4.1–4.5, §4.7) → token specification. **Wireframes for the
attendance, skill-matrix and aftest screens are the highest-value artefact in
the whole design phase** and should be reviewed before any component is written.
The aftest screen is the second flagship and pulls in the opposite direction
from the first (§4.7) — reviewing them together is the point.

**And one artefact that is not a wireframe:** the printed class list (R-35).
Design it deliberately, on paper, at the same time. It is the only surface that
works when nothing else does.


---

# 05 — High-level Technical Architecture


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. Architecture overview


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

```text
  ONE INSTANCE = ONE ORGANISATION (see 03-deployment-model.md)

                     ┌──────────────────────────────┐
  Browser / tablet ──▶│ Reverse proxy (TLS)          │
  Phone            ──▶│  rate limit · security hdrs  │
                     └──────────────┬───────────────┘
                                    │
                     ┌──────────────▼───────────────┐
                     │ Next.js (App Router, Node)   │
                     │  middleware: session + scope  │
                     │   ├ (public)  catalogue + form │
                     │   └ (portal)  portal + admin  │
                     │  modules/ (domain services)   │
                     │  lib/ auth · security · db    │
                     └───┬──────────────┬───────────┘
                         │              │
              ┌──────────▼───┐   ┌──────▼────────┐
              │ PostgreSQL   │   │ Mounted volume│
              │ (single DB)  │   │ (assets)      │
              └──────────────┘   └───────────────┘
                         │
                   ┌─────▼──────┐
                   │ SMTP relay │
                   └────────────┘
```

One deployable application. Stateless processes — no in-process session store,
no in-process cache holding personal data — so horizontal scaling is a
configuration change (P-08).

**Object storage is out of v1, and this diagram previously implied otherwise.**
The template's `blob-storage.ts` supports only `"local"` and throws on anything
else; there is no S3 client in `package.json`. Assets live on a mounted
filesystem path and are captured inside the encrypted backup archive
(`07-operations.md` §2, `14-…` §3.1). Scoping S3 out is not just honesty about
the code: a scheduled push to a bucket would be an exfiltration channel holding
children's data with none of D-042's controls, plus a set of long-lived
credentials in the settings store. Less code, fewer secrets, one fewer thing to
get wrong.

## 2. Technology stack


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript everywhere | Team stack; one language across app, tests, tooling |
| Framework | Next.js App Router on Node | Inherited; Server Components + Route Handlers give one codebase for site, portal and API |
| Database | PostgreSQL, one per instance | Inherited (ADR-002). Relational domain, strong constraints, mature |
| ORM | Prisma, single ORM | Inherited (ADR-005). Migrations, typed client |
| Auth | Better Auth (+ passkeys, MFA, Entra) | Inherited (ADR-003). Identity/sessions only |
| Styling | Bootstrap + CSS custom properties | Inherited; token-driven theming (D-019) |
| i18n | next-intl, cookie-based locale | Inherited (ADR-006). NL default |
| Validation | Zod | **To be added.** This row previously read "already present in both repos". It is in neither — no `zod` in `package.json`, no imports, no `src/lib/validation/`. Cheap, but load-bearing: the settings design and every module's `validation/` folder assume it. Add it in repo hygiene, before any module |
| Logging | pino, structured, PII-free | Inherited |
| Testing | Vitest (unit/integration) + Playwright (E2E) | Inherited, already wired in CI |
| Packaging | Docker, Docker Compose | Inherited. Kubernetes explicitly out of scope until needed |
| Rich text | TipTap, sanitised server-side | Inherited |

**Decision D-020 — No message broker, no cache server, no search engine in v1.**
**Reason.** Postgres does queuing (the `maintenance` job table), caching
(Next's own cache) and search (trigram/full-text) adequately at the stated
scale. Each additional service is another thing to secure, back up, monitor and
pay for.
**Trade-off.** Some operations that would be async are synchronous. Revisit
when a measured problem exists, and record it as an ADR.

## 3. Repository structure


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**Decision D-021 (revised) — Single repository, single application, **flat
root**.**

**What the earlier version got wrong.** D-021 read: *"`apps/web` layout
retained … the existing SplashTrack repo already uses `apps/web` and the extra
nesting costs nothing."* The first clause is true of the **prototype**; the
second is false of the **template**, which is what we are actually building
from. The template is **flat-root**: `src/`, with `@/*` mapped to `./src/*`.

Adopting `apps/web` therefore does not cost nothing. It means moving the whole
tree and rewriting `tsconfig.json`, **both** vitest project globs,
`playwright.config.ts`, `prisma.config.ts`, the Dockerfile and two compose
files — before a single line of domain code exists, to buy room for a second
artefact nobody has asked for.

**Reason.** One deployable, one version, one CI pipeline. The flat root is what
the foundation already is, and every path in it already works.
**Trade-off.** If a worker or a docs site is ever added, the move happens then,
with a reason. **If the `apps/web` layout is adopted anyway, it must be the
literal first commit** — done once, cleanly, before anything depends on the
paths. Doing it halfway through is the expensive version.

The layout below is stated at the flat root. The `apps/web/` prefix appears in
this design set only where it names the **prototype**'s location on `main`
(`00-overview.md` §2.2).

```text
SplashTrack/
  src/
    app/
      (public)/              course catalogue + inquiry form (R-12, reduced)
      (portal)/              authenticated portal
        admin/               administration
    modules/
      identity/  access-control/  organization/  audit/  consent/
      profile-fields/  users/  email-templates/  notifications/  maintenance/
      people/  students/  groups/  courses/  skills/
      sessions/  attendance/  assessment/  exams/  planning/  fees/
        ├ application/       services — the business logic
        ├ domain/            types, invariants
        ├ infrastructure/    repositories + the module's Prisma client (§3.1)
        ├ ui/                module-owned components
        ├ validation/        Zod schemas
        ├ permissions/       permission definitions
        └ tests/
    components/              layout · forms · navigation · feedback
    lib/                     auth · api · crypto · database · errors · logging · security · validation
  prisma/
    schema.prisma
    migrations/
  tests/
    unit/                    incl. migration-safety, migration-history-append-only
    integration/
    e2e/
  messages/                  nl.json · en.json
  docs/
    design/                  this design set
    decisions/               ADRs
    architecture.md          authoritative living spec
    security.md  privacy.md  database.md  ci-cd.md
  infra/
    docker/
    environments/
      dev/  prd/
  .github/
    workflows/
    ISSUE_TEMPLATE/
    pull_request_template.md
  AGENTS.md                  instructions for Lucky
  CLAUDE.md                  ditto, Claude Code entry point
```

Three things are absent from this tree that earlier drafts had: `app/api/v1/`
and `openapi/` (P-01 is out of v1, §4), `pages/` and `api-credentials/` as
active modules (the CMS is reduced and the API surface is unbuilt), and
`environments/uat/` (§3.5.1 of `00-overview.md`). `assessment/` and `fees/` are
new (R-30, R-32).

### 3.1 Module isolation is enforced, not just documented

An ESLint `no-restricted-imports` rule forbids importing
`modules/<a>/…` from `modules/<b>/…` except through a module's published
`index.ts`. This turns the dependency rule (`01-domain-model.md` §1.2) from a
convention into a build failure.

**That rule does not catch the violation it was written to prevent, and this is
worth being blunt about.** The boundary this design cares most about is
ownership of a *table* — D-057 exists because "one table, two owners" would have
been the first boundary to erode. But `no-restricted-imports` catches
cross-module **imports**, and the actual violation looks like this:

```ts
// inside modules/planning/… — imports nothing from modules/sessions/
await prisma.scheduledSession.create({ data: … })
```

No cross-module import, no lint error, boundary gone. The rule is checking the
wrong noun.

**Fix — a per-module Prisma client wrapper.** Each module's
`infrastructure/` exports a client narrowed to the models that module owns, and
a second lint rule forbids importing the root `prisma` client anywhere under
`modules/`. `planning` then physically cannot reach `scheduledSession`; it calls
`sessions`' published service, which is what D-057 says. A blunt-instrument
alternative — a rule banning `prisma.<model>` identifiers outside their owning
module — is worse but still better than nothing, and can ship first.

## 4. API architecture


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**There is no public API surface in v1.** `/api/v1`, the generated OpenAPI
document and the Swagger UI are out of scope (`00-overview.md` §3.5.1). This
section previously conceded that the v1 surface was "health/ready, organisations
(read), and one worked example" — which is not an API, and shipping the
versioning, the document and the browsable UI around it is scaffolding for
integrations nobody has requested.

What is kept is the **discipline**, which is the whole of P-01's preparation and
costs nothing:

- Route handlers stay thin: authenticate → validate → authorize → service →
  standardized response. The portal (Server Actions/Components) and any future
  API call **the same services**, so they cannot diverge in behaviour or
  security. This is the property that makes adding the API later additive.
- `/api/health` and `/api/ready` ship (they are operational endpoints, not a
  product API).
- `error.code` is a stable machine-readable field from the first handler.
- Scoped `ApiCredential`s are inherited from the template and stay in place,
  unused. When an integration exists, it authenticates with one — never with a
  user's session token.

## 5. Data access rules


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

1. Single-resource reads and all writes go through
   `requirePermission(perm, resourceRef)`; list queries take a `Reach` object
   from `resolveReach()` as a **required** repository argument (D-030, D-031).
2. `$queryRaw` / `$executeRaw` bypass reach filtering; they require an explicit
   reviewer sign-off and are flagged by a lint rule.
3. Repositories live in `modules/<m>/infrastructure/`; no module queries another
   module's tables.
4. Migrations are forward-only, reviewed, and tested against a **populated**
   database in CI (the template already does this — it is one of its best
   features and must be kept).
5. Every migration that touches personal data states its retention and erasure
   impact in the PR description.
6. **One audit event per aggregate write, not per row.** The template's
   `AuditEvent` is a tamper-evident hash chain whose appends serialize on a
   **Postgres advisory lock**. The domain model requires one transaction per
   group registration; at 30 students that is 30 attendance events and, naively,
   30 chained audit rows taken one at a time against a lock contended by every
   other audit writer in the instance. So: **write one audit event for the group
   registration**, or batch the chain append. This must be decided before the
   load test is written — the p95 target in `00-overview.md` §4.1 was set
   without knowing the lock exists.

### 5.1 Two template capabilities to adopt, not re-invent

The design describes both of these as things to build. They already exist,
tested, and adopting them is free:

| Capability | What it already does | What the design said |
|---|---|---|
| `tests/unit/migration-safety.test.ts` | Blocks the unsafe `ADD COLUMN … NOT NULL` without a default | Nothing. This is exactly the class of migration that strands a self-hoster mid-upgrade, and it is already gated |
| `person-reference-classification.ts` + `person-reference-sync.test.ts` | **Is** D-014's *"registry with a test asserting every `Person`-referencing table appears in it"* — already built, and checked **bidirectionally** | Described it as something to create |

The second one has a consequence worth stating as a rule rather than a
surprise: **the build goes red the moment a domain model adds a `Person`
reference without a registry entry.** That is the desired forcing function, and
it belongs in the Definition of Done (`06-delivery.md` §4.4) so it is not
discovered in CI by whoever happens to add the column.


---

# 06 — Environments, CI/CD, GitHub Workflow & Lucky


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. DEV / PROD model


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**UAT as a separate environment is out of v1** (`00-overview.md` §3.5.1). One
person is author, reviewer and acceptor; a third environment between him and
himself buys a handover that does not happen. The decision is retained on paper
and the environment is added the day a second acceptor exists.

| | DEV | PROD (per instance) |
|---|---|---|
| URL | `dev.splashtrack.sysadminheaven.com` | The organisation's own |
| Purpose | Lucky develops, tests, breaks things | **The school's live instance**, plus our own demo/reference copy. Other self-hosters run copies we never touch |
| Data | **Synthetic only** — seeded, never real | Real personal data |
| Deploys on | Every merge to `main` | Tagged release, **manual approval** — and the same tag publishes the public image |
| Lucky access | Full lifecycle | **None** |
| Jack access | Full | Full |
| Config | **Bootstrap environment variables only; every runtime setting is database-backed** (D-036, D-037 — stated once in `13-…` §3.1) | Same |
| Reset | Anytime, scripted | Never |

The Config row previously read *"env vars per environment"*, which contradicts
the entire configuration architecture in the table an implementer uses to set
the environments up.

**Decision D-022 (revised) — The same container image is promoted DEV → every
production instance.**
**Reason.** An image built once and promoted is the only way to know that what
was accepted is what runs. Rebuilding per environment means testing something
you never ship.
**Trade-off.** All environment *and per-deployment* differences must be
expressible as runtime configuration and secrets — no build-time flags, and no
per-deployment branches or images, ever. This is a hard discipline constraint on
every future feature, and it is what makes an instance we cannot see
supportable.

**Note on existing behaviour.** `deploy-uat.yml` in the template runs
`docker compose build` **on the target host** — it builds at deploy time rather
than promoting an image, which is the direct inversion of this decision. That
workflow is **replaced**, not extended. With UAT out of v1 it is deleted
outright, and the release workflow publishes the image the tag built.

**Decision D-023 (kept as policy) — no environment below production ever
receives a copy of production data.** The environment is gone; the rule is not,
because it costs nothing and it is the most common way GDPR compliance is lost
in practice. DEV gets a rich synthetic dataset from a seed script.

```text
  merge to main
        │
        ▼
   build image  ──▶ ghcr.io/jackldam/splashtrack:<sha>
        │
        ├──▶ deploy DEV        (automatic)
        │
        └──▶ tag v1.2.0 ──────▶ promote the same image + release notes
                                    ghcr.io/…/splashtrack:1.2.0
                                    signed · SBOM · provenance
                                    + restore fixture as a release asset
                                    → deploy to PROD on manual approval
                                    → self-hosters upgrade on their own schedule
```

**The restore fixture ships from v1.0 even though the restore matrix does not.**
D-047's matrix is out of v1 — there are zero prior releases, so it would be
green while protecting nothing. But **fixture generation must ship with v1.0 or
v1.0 is permanently untestable as a restore source.** The release workflow's
final step boots the just-built image against a scratch Postgres, seeds a
deterministic fixture, backs it up under a **fixed public test key** (no
credential ever goes into a fixture, F-19), and uploads it as a GitHub Release
asset — not a git commit. Adding the matrix at v1.3 is then a job that reads the
Releases API, and D-048 (never squash) is what keeps the migrations those
fixtures need.

## 2. CI/CD strategy


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 2.1 Required checks (block merge)

**First, a correction.** This section previously opened *"The template's CI
already implements most of this."* It does not. `.github/workflows/ci.yml` has
**three jobs** — `verify` (format, lint, typecheck, seed smoke, Vitest, build),
`e2e` (Playwright) and `migrate-populated`. There is **no container build, no
`npm audit` gate, no CodeQL, no secret-scanning job, and no axe assertion
anywhere in `tests/`** — grep finds axe only in prose. Of the fifteen checks
this table used to require, seven existed. Everything else was a plan described
in the present tense.

**v1 ships eight blocking checks** (`00-overview.md` §3.5.1). The rest are
listed below the line with the honest status, so nobody reads a plan as a gate.

| Check | Blocking in v1 | Notes |
|---|---|---|
| Format (Prettier) | Yes | Inherited |
| Lint (ESLint, incl. module-boundary rules) | Yes | Inherited. Extended: the second rule that stops a module reaching another module's Prisma models (`05-technical.md` §3.1), and the D-051 rule that `(public)` never imports a person repository |
| Typecheck | Yes | Inherited |
| Unit tests (Vitest) | Yes | Inherited. **Includes** `migration-safety` (inherited), `migration-history-append-only` (new, §2.2), `person-reference-sync` (inherited) |
| Integration tests | Yes | Inherited. Against a real Postgres service container |
| **Scope-escape tests** | Yes | **New, and the most important gate in this table.** See below |
| **Migration against populated DB** | Yes | Inherited: applies base migrations, populates rows, then applies the PR's migrations. Catches destructive migrations before they reach data |
| Secret scanning | Yes | **New.** Plus push protection at the repository level — and note that `apps/web/.env` is currently **tracked** and in history, which must be resolved before the repository is public, not after |
| E2E (Playwright) | Yes | Inherited. Axe accessibility assertions are a **required addition** — they do not exist |

Below the line — required additions, not currently gated by anything, and named
here so `00-overview.md` §4.1 and this table cannot drift apart again:
container build validation, `npm audit` / Dependabot on high and critical,
CodeQL, the attendance load test, the skill-matrix query-count assertion, the
Playwright trace budget, the i18n missing-key check, and the browser matrix.

**Out of v1:** the restore-from-every-supported-release matrix (D-047). Zero
prior releases exist; the fixture that makes it possible ships anyway (§1).

#### The scope-escape gate — named for the concept that exists

This check was previously called **"Organisation isolation tests"**. That is the
name of the *old tenancy suite* — the one D-032 exists to replace. It is not a
stale label: a team building the gate from this chapter writes cross-organisation
isolation tests, which in a single-organisation instance are **vacuous and pass
forever**, and never writes the suite that is the primary internal control. The
findings chapter calls scope escape the highest-severity internal risk in the
product, so the gate backing it must not be satisfiable by a trivial assertion.

Renamed, and its minimum content specified so "a module has scope-escape tests"
means something. **Per module**, all of the following:

| Case | Assertion |
|---|---|
| A `GROUP`-scoped principal | attempting **read**, **write** and **list** outside their group is denied on all three |
| A `UNIT`-scoped principal | the same three, outside their unit — and `UNIT` is **flat** in v1, so a child unit is outside it |
| A `SESSION`-scoped principal | the same three, outside the session they are assigned to **and outside its time window** |
| Reach construction | a `Reach` **cannot be constructed outside `resolveReach()`** — asserted structurally, not by convention |

The **list** case is the one that must never be dropped. Read and write are
usually guarded explicitly; a list query silently returning too much is the
exact failure mode tenancy filtering had, one level down (F-15), and it is what
`Reach`-as-a-required-repository-argument (D-031) exists to make impossible.

A module without this suite fails Definition of Done.

**Decision D-024 — Deployment is impossible from a branch; only from a tag on
`main` through an environment with required reviewers.**
**Reason.** The brief demands it. GitHub Environments with protection rules
enforce it at the platform level rather than by convention.
**Trade-off.** Hotfixes take one extra step (branch → PR → merge → tag).
Accepted; a hotfix path that bypasses tests is how outages get worse.

### 2.2 D-048 is enforced by nothing — the test that fixes that

D-048 says migration chains are never squashed within a major version. It is
kept in v1 precisely because it is free and because it is what makes D-047
addable later. But as written it is a sentence in a document, and squashing
*feels like tidying* — it is the kind of rule that gets broken by someone being
helpful on a Friday, and the damage is invisible until a self-hoster's old
backup will not restore.

Ship **`tests/unit/migration-history-append-only.test.ts`**, in the style the
template already uses for `migration-safety`:

1. Assert the set of migration names at the **last release tag** is a **subset**
   of the set at `HEAD` — nothing may disappear.
2. Assert **no applied migration's SQL content hash has changed**, against a
   committed `prisma/migrations/.lockfile.json`.

Squashing or editing an applied migration is then a red build rather than a
discovery two years later. Adding a migration updates the lockfile in the same
commit, so the diff shows exactly what was added — which is also a useful review
artefact in its own right.

### 2.3 Secrets and cloud access

- Deploy credentials live in **GitHub Environments** for our own dev/demo
  instances only. We hold no credentials to any customer deployment (D-012
  final).
- The **release workflow** — which signs and publishes the public image — is the
  most security-critical automation in the repository. It runs only from a tag
  on `main`, and no contributor (including Lucky) may modify `.github/` (F-18).
- Prefer **OIDC federation** over long-lived cloud keys.
- PROD secrets are never readable by CI jobs triggered from a fork or from a
  pull request — only from a tag build on `main`.
- No secret is ever in the repository, in an image layer, or in a log line.

## 3. GitHub workflow


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 3.1 Traceability rule

**Every change traces to an issue.** Branch names carry the issue number, PRs
link it with a closing keyword, and the PR template requires a "change reason".
A PR with no linked issue does not merge.

```text
main            protected · no direct pushes · linear history
  └ feat/123-attendance-registration
  └ fix/145-session-timeout
  └ chore/150-dependency-bump
  └ docs/151-adr-audit-chain-checkpointing
```

### 3.2 Issues

Templates for: **bug report**, **feature request**, **security finding**
(private reporting enabled), **ADR proposal**, **chore**.

Labels: `type:*` (bug/feature/chore/docs/security), `module:*` (attendance,
skills, exams, …), `priority:*`, `env:*` (dev/prod), `needs:decision`,
`blocked`, `good-first-slice`.

Milestones track vertical slices, not layers — "Attendance registration
end-to-end", never "Attendance backend".

### 3.3 Pull requests

Required in the PR body: linked issue; what changed and why; security impact; **upgrade impact for self-hosters** (breaking change? migration duration? operator action needed?);
**privacy impact** (does this touch personal data? retention? erasure?);
migration impact; test evidence; screenshots for UI changes.

Reviews: at least one human approval — **Jack's** — on every PR. Lucky may
open and update PRs; Lucky may never approve or merge one.

### 3.4 Releases

Semantic versioning. `-rc.N` tags publish a release candidate image and deploy
nowhere; clean tags publish the public image and deploy to PROD after approval. Release notes generated from linked issues, so the changelog is
a by-product of the traceability rule rather than extra work.

## 4. Lucky — AI development agent permissions and boundaries


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 4.1 The governing principle

**Lucky has no identity inside the SplashTrack application.** Lucky is not a
user, not a role, not a service account in the product. Lucky is a developer
with access to a development environment and a GitHub account — nothing more.
This removes an entire category of risk: there is no permission to escalate,
because there is no principal.

### 4.2 What Lucky may do

| Environment | Lucky's capability |
|---|---|
| **Local / DEV** | Full lifecycle: edit code, create branches, write and run tests, build containers, run migrations, deploy to DEV, read DEV logs, analyse failures, work issues, open PRs, update docs |
| **GitHub** | Create branches, push, open/update PRs, comment, triage issues, apply labels. **Cannot** approve PRs, merge, push to `main`, change branch protection, edit workflow permissions, or manage secrets |
| **PROD / any deployed instance** | **Nothing, and nothing exists to have.** No deployment — the school's, ours, or a self-hoster's — is reachable by anyone here (D-012 final) |
| **Secrets** | None. DEV uses generated throwaway values; PROD secrets live in GitHub Environments Lucky cannot read |
| **Real personal data** | Never. DEV contains synthetic data only (D-023) |

### 4.3 Prompt injection and untrusted input

Lucky reads GitHub issues, which are attacker-influenceable when the repository
is public or accepts outside reports. The mitigations are structural rather
than behavioural:

1. Lucky's only output channel is a **pull request that a human reviews**.
2. Lucky holds no secrets and no production path, so a successful injection
   cannot exfiltrate or destroy anything of value.
3. Workflow files, branch protection and CODEOWNERS are **excluded from
   Lucky's write scope** — a PR touching `.github/workflows/` requires explicit
   human authorship. This prevents the classic "convince the agent to weaken
   its own CI" escalation.
4. Content from issues is treated as data, never as instructions that expand
   Lucky's own permissions.

**Decision D-025 — Lucky's boundary is enforced by absent credentials, not by
instructions.**
**Reason.** An instruction telling an agent not to touch production is a
suggestion; a missing credential is a wall. Every boundary above is a fact
about what Lucky *has*, not a rule Lucky is asked to follow.
**Trade-off.** Lucky cannot help diagnose a production incident directly and
must work from exported, sanitised evidence. Correct trade for a system holding
data about children.

### 4.4 Definition of Done for a Lucky-authored slice

A slice is done when: data model → service → UI → tests → docs are all present;
**scope-escape tests exist** for the module (§2.1 — the old wording said
"isolation tests", which is the deleted concept); every new `Person` reference
has a `person-reference-classification.ts` entry, so the inherited sync test
stays green; the privacy questionnaire in the PR template is answered; CI is
green; and Jack has approved. Backend without UI is not a slice. Partial
functionality is never presented as complete.

## 5. Build order


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Sequencing matters more than usual here because three of the highest-value
mechanisms are the ones that are most expensive to retrofit. Ranked by **cost of
doing it late**:

| # | Item | Why this rank |
|---|---|---|
| 1 | **Encryption envelope and key derivation** | Every encrypted byte written before the envelope exists has to be found and re-wrapped, and the key split decides whether a restore preserves MFA enrolments. Nothing that stores a secret may be written first |
| 2 | **Audit chain-aware rotation and checkpointing** | The chain is append-only at the database level. Deciding rotation after two years of events means retroactively rewriting a tamper-evidence claim |
| 3 | **The scope model** | It changes the signature of the guard **every module calls**. Any domain module built first has to be rewritten — and worse, its scope-escape tests were written against the wrong question |
| 4 | **Append-only event models** with `clientEventId` / `supersedes*Id` | Converting a mutable column into an event log after data exists means inventing the history you destroyed |
| 5 | **Settings** | Every feature that reads configuration before the settings page exists reads it another way, and must be ported |
| 6 | **Consent extension** | Same retrofit-hostility as (4): a consent captured under the current shape has no recoverable actor, and consent on behalf of a minor is the majority case |
| 7 | **Restore-fixture generation** | Must ship *with* v1.0 or v1.0 is permanently untestable as a restore source (§1) |
| 8 | **Erasure registry entries** | Cheap individually, but the inherited sync test fails the build the moment a domain model adds a `Person` reference — so it belongs in the DoD, not in a surprise |

**Phases.**

- **Phase 0 — repository hygiene (days).** Resolve the tracked `.env` and its
  history, and rotate what it contains, before the repository is public. Confirm
  the layout (flat root, `05-technical.md` §3). Add Zod. Write the glossary
  (OD-10 — cheap, and it blocks every schema name after it).
- **Phase 1 — foundation, no domain code.** Crypto envelope and golden vectors →
  boot state machine including the **`FAILED`** state → settings → production
  Dockerfile → backup, restore and the recovery token → the eight CI checks,
  including image **promotion** rather than a build on the target host.
- **Phase 2 — removals and reshaping.** D-056's removals, incrementally, tests
  green at each step — including the platform-super-admin branch inside
  `requirePermission`, which is real code and not just prose → the scope model,
  `coversResource()`, reach as a required repository argument, and the
  scope-escape **test harness** so every later module inherits it → consent
  extension → setup wizard on top of all of it.
- **Phase 3 — domain modules, in DAG order.**
  `people → students → groups → courses → skills → sessions → attendance →
  assessment → exams → planning → fees`.
  **Attendance is the flagship and it sits on five modules. Resist starting
  there.** The instinct to build the demo first is exactly what produces a
  flagship screen resting on stubs.
- **Phase 4 — surfaces.** Course catalogue and inquiry form, branding,
  diagnostics, print fallbacks, the waiting list and the breach-response tools.


---

# 07 — Logging, Auditing, Observability, Backup, Failure Modes & Scalability


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. Logging, auditing and observability


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Three distinct systems with different readers, retention and access control.
Conflating them is a common and expensive mistake.

| System | Question it answers | Contains PII? | Reader | Retention |
|---|---|---|---|---|
| **Operational logs** (pino) | "Is the system healthy? Why did this request fail?" | **No** — ids only | Operators | 30 days |
| **Audit trail** (`AuditEvent`) | "Who did what to whom, when?" | Yes, by design | Holders of `audit.read` in this installation | ≥ 24 months |
| **Metrics** | "How is it behaving over time?" | No | Operators | 13 months |

### 1.1 Operational logging rules

Structured JSON. Every line carries: request id, organisation id, person id
(opaque), route, outcome, duration. Never names, emails, notes, request bodies
or query parameters that could carry personal data. A log line containing PII
is a bug, and a CI check greps for obvious offenders (email patterns) in test
output.

### 1.2 Audit trail

Append-only. Never updated, never deleted by application code — only rotated by
a reviewed retention job.

Events that **must** be audited:

- Authentication: login success/failure, MFA enrolment/reset, password reset,
  session revocation, step-up challenges.
- **Recovery-token re-display** — high severity. The recovery token is the key
  that opens every backup; a request to show it again is indistinguishable from
  an exfiltration attempt until someone looks. It gets the same treatment as the
  backup download (D-042): step-up, rate limit, high-severity audit event.
- **Backup destination or destination-credential change** — high severity,
  notifies every `ORGANIZATION`-scoped administrator (D-103). An unaudited
  destination change is a silent, recurring exfiltration path next to a
  tightly-guarded download button.
- **Break-glass CLI invocation** (lockout recovery, MFA reset, settings reset,
  setup-token reissue) and **failed restore-token attempts** at the setup
  endpoint (D-101) — both bypass or attack the normal authenticated surface and
  must be visible even when no application session exists to attribute them to.
- Authorization: every denial; every use of an instance-administrator override
  (at `warn`).
- Personal data: read of medical/pastoral notes (D-010); create/update/delete of
  a Person or StudentProfile; export; erasure; consent given/withdrawn.
- Domain-significant: skill sign-off and revocation; exam result recorded or
  corrected; certificate issued or revoked; attendance amended after the fact.
- Configuration: role assignment changes, branding changes, retention policy
  changes, API credential lifecycle, organisation lifecycle.

Each event records: timestamp, actor person id, actor session/credential,
organisation, action, target type + id, outcome, and a minimal detail payload —
**never a full before/after dump of personal data**.

**CLI-originated events carry a `system:cli` actor**, not a null one: host user,
container id, invocation timestamp and the exact subcommand. A null actor is
indistinguishable from a bug in the audit writer, and the events that most need
attribution are the ones with no session.

Every break-glass invocation additionally **notifies every `ORGANIZATION`-scoped
administrator by the delivery channel of §1.4**, and raises a persistent
dashboard banner that must be dismissed by a *different* administrator than the
one who ran it. The command is a legitimate recovery path and an equally
legitimate attack; the difference is only ever visible to a second person.
Finding **F-130**.

**Decision D-026 — Organisations can read their own audit trail.**
**Reason.** They are the GDPR controller; accountability is their obligation,
and they cannot demonstrate it if only the processor can see the evidence.
**Trade-off.** The audit UI becomes a product surface with its own performance
and authorization requirements, and audit events must be written carefully
enough to be readable by non-engineers.

### 1.3 Observability

- `/api/health` (liveness) and `/api/ready` (readiness incl. database).
- Metrics: request rate/latency/error by route, database pool saturation, job
  queue depth and failures, login failure rate, authorization denial rate.
- **Alert on security signals, not just uptime.** The list below previously
  included *"any `platform.super_admin` use"*. That principal was removed with
  the platform (D-056, `00-overview.md` §5.1), so the alert could never fire —
  it was not a stale name but a **monitoring rule that provided assurance about
  nothing**. The rules are now bound to **permissions**, which exist and are
  checkable, rather than to a role or namespace, which are user-definable:

  | Signal | Rule |
  |---|---|
  | Privilege use | Any use of a permission in the high-risk set (`organization.settings.manage`, `privacy.*`, `roles.assign`, `audit.read`, the backup permissions, `students.medical.*`) — the same set that compels MFA (`02-security-privacy.md` §1.2) |
  | Privilege change | Any grant *of* a high-risk permission, and any change to a role that carries one |
  | Authorization | A spike in denials, at any scope |
  | Authentication | Repeated failed logins for one account; repeated failed MFA challenges |
  | Data movement | Unusual export volume; a backup download; a **recovery-token re-display** (§1.2) |

- Tracing is deferred (D-020 rationale); request ids propagated through logs
  are sufficient for a single-service application.

### 1.4 Breach response — an operational capability, not a paragraph

The design previously shipped an audit trail and a metrics list and stopped.
That is not enough for this data class. The controller must be able to assess
and, where required, notify within 72 hours (Article 33) and notify the data
subjects themselves for high-risk breaches (Article 34) — and this is **health
data about children**, so the Article 34 high-risk threshold is met by default
rather than argued about. The intended reader is a swim school with no security
staff.

A breach requires answering three questions. v1 ships the tool for each
(**R-37**):

| Question | What ships |
|---|---|
| *Which records did this account touch?* | A **"what did this account do" report** over the audit trail: filterable by actor and date range, exportable. This is the Article 33 assessment tool, and without it the audit trail is evidence nobody can read under time pressure |
| *Which sessions are live, and how do I kill them all?* | An **active-session inventory** with per-session revocation and one **"revoke everything and force re-authentication"** action. "Sessions invalidate when an account is disabled" is not a containment control |
| *Whose data was in the artefact that leaked?* | The backup manifest records **row counts per table**, not data subjects. Stated plainly as a limitation: a leaked archive must be treated as covering **every** subject in the instance at that timestamp. Restoring a backup to enumerate its subjects is itself a processing decision the operator must take deliberately |

Two more pieces, both cheap and both currently absent:

- **Delivery for high-severity events.** The signals in §1.3 are defined and
  nothing carries them anywhere. v1 ships email and webhook delivery for the
  high-severity set. An alert nobody receives is a log line.
- **An incident checklist in the documentation**, framed as *"the deadlines that
  apply to you"* — not as advice on whether they apply. The organisation is the
  controller (D-064); the clock is theirs, and it starts at awareness, not at
  certainty.

## 2. Backup and restore

> **See `14-backup-restore-upgrade.md`** for the full design: the encrypted
> Recovery Kit (backup file + token), restore via the setup wizard, automatic
> pre-migration backups, and the upgrade flow. This section states policy; that
> document states mechanism.



> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| | Policy |
|---|---|
| Database | **The operator's responsibility.** We ship `backup` and `restore` commands plus a scheduler. Shipped and tested recovery path: **scheduled encrypted logical backups, RPO ≤ the configured interval (default daily)**. WAL archiving / point-in-time recovery is a Postgres-level option the operator may add for a lower RPO; it is documented as such and is **not** part of the tested path |
| Uploaded assets | **Included in the encrypted backup archive** (`14-…` §3.1); volume-level redundancy is the operator's choice. This row previously read "object storage: versioned, replicated" — a managed-cloud assumption stated as *our* policy. The shipped artefact is one application image plus Postgres; assets live on a filesystem path. **S3 is out of v1 entirely** (`05-technical.md` §1): `blob-storage.ts` supports only `"local"`, there is no S3 client in `package.json`, and a scheduled push to a bucket would be an exfiltration channel with none of D-042's controls |
| Retention of backups | 30 days rolling, plus one monthly for 12 months |
| Encryption | Backups encrypted at rest with keys separate from the database host; special-category columns remain independently encrypted (D-013) |
| Access | The operator's own control. We provide the audit event, not the policy |
| **Restore drill** | Documented as a quarterly operator duty. A self-hoster who has never restored has no backups — the documentation must say exactly that, and the shipped `restore` command must make the drill cheap |
| RTO | ≤ 4 hours |

**Backups contain personal data and are therefore in scope for GDPR.** Two
consequences that are easy to miss: (a) an erasure request cannot practically
reach into historical backups, so the privacy notice must state that erased
data persists in backups until they age out — and that those backups are only
ever restored wholesale, never mined; (b) backup retention (12 months) must not
silently exceed the data retention policy in a way that is never resolved.
Finding **F-07**.

## 3. Failure modes


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| # | Failure | Impact | Design response |
|---|---|---|---|
| FM-1 | **Poolside WiFi drops mid-registration** | Instructor loses work; attendance unrecorded | Idempotent `clientEventId` writes; optimistic UI with honest failure; work retained on screen; offline queue prepared (P-02) |
| FM-2 | Database unavailable | Total outage | Deny-by-default means failures become 403/503, never accidental allows; readiness probe removes the instance |
| FM-3 | **Scope-escape bug** (missed reach filter on a list query) | Serious — one organisation's staff see records they should not, e.g. another location's students | Reach is a required repository argument (D-031); scope-escape tests per module (D-032). Cross-*organisation* exposure is impossible by deployment (D-012 revised) |
| FM-4 | Destructive migration | Data loss | Migration-against-populated-database CI job; forward-only; reviewed; restore drill validated |
| FM-5 | Brand colours break contrast | Unusable UI, accessibility failure | Contrast validated at save time, not at render |
| FM-6 | **A migration fails on an unattended upgrade** | The instance will not start; with Prisma the failed migration stays recorded and blocks every later one, so a restart does not clear it | Automatic pre-migration backup before any migration runs (D-044); the boot state machine detects a failed migration as an explicit **`FAILED`** state, refuses to continue, and names the pre-migration backup by path in the failure message (D-055, `13-…` §6). The operator restores and retries rather than debugging Prisma state at 22:00 |
| FM-7 | Compromised org admin account | Full org data exposure | MFA mandatory; export requires step-up and is rate-limited and alerted; audit visible to the org |
| FM-8 | Compromised Lucky / prompt injection | Malicious PR | No secrets, no PROD path, workflows outside write scope, human approval required (D-025) |
| FM-9 | Leaked backup | Personal data exposure **for one organisation only** | Per-instance encrypted backups + separate column encryption for health data |
| FM-10 | Retention job deletes too much | Irreversible data loss | Dry-run and report before execution; deletions audited; restorable within backup window |
| FM-11 | Email delivery fails | Password resets and invitations lost | Queued with retry; failures visible in admin; not on the critical path for attendance |
| FM-12 | Award issued in error | Legal/reputational | Awards are revoked and reissued, never edited; every action audited |
| FM-13 | Device left unlocked | Unauthorised access to student data | A short idle timeout, and an instructor role that holds **no export and no admin permission at all**. `SHARED_DEVICE` mode (D-009) is out of v1: it was opt-in by the party it restricted, and its most valuable sub-behaviour is achieved by not granting the permission in the first place (`00-overview.md` §3.5.1) |
| FM-14 | **The application will not load at the poolside** | The instructor has no move; paper always had one | The printed class list (R-35). This is the failure the design most needs an answer to and had none: paper never has a zero-percent day, and a first-lesson failure is permanent — when paper fails the instructor blames the rain, when the app fails they go back to paper and do not return (`04-ux.md` §4.0) |
| FM-15 | **`APP_URL` changes and every passkey stops working** | Total lockout of every account that authenticates only with a passkey | The WebAuthn RP ID is set deliberately at setup, not derived silently; changing it warns loudly and names the consequence; **every account retains a password + TOTP fallback**. Moving from `http://nas.local:3000` to a real domain is the *expected* path for this deployment, not an edge case (`04-ux.md` §4.0) |

## 4. Scalability risks


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**Scalability is defined per independent installation** (`00-overview.md` §4.2):
one organisation, up to ~10,000 persons, ~100 concurrent users, ~50,000
attendance-bearing sessions per year, ten years of retained exam results. There
is no aggregate figure across organisations — instances are independent and we
operate none of them.

At that scale a single modest Postgres is comfortable. The risks below are the
ones that would bite first *within one installation*, in the order they would
bite.

| Risk | When it bites | Prepared response |
|---|---|---|
| **Derived progress queries** — "current level" computed from an append-only log | A student with years of history, or a group matrix view over 30 students × 40 skills | `StudentProgressSummary` materialised on write. **Prepared, not built** (D-005) |
| **Audit table growth** | Fastest-growing table; audit UI queries slow first | Time-based partitioning + retention rotation; index on (org, timestamp, actor) |
| **Attendance table growth** | ~50,000 attendance-bearing sessions/year in a large organisation | Partition by period; aggregate + anonymise at 24 months — the retention policy doubles as a growth control |
| **Seasonal peak** | Enrolment season and exam periods concentrate load | Stateless processes scale horizontally; no in-process state anywhere (P-08) |
| **Single Postgres instance per organisation** | Write saturation within one organisation — unlikely at swim-school scale | Read replica for reporting first. **Sharding does not arise:** one installation holds one organisation's data, so there is nothing to partition across. (This row previously read "the fleet is already partitioned by organisation" — there is no fleet; we operate nothing, F-14 is closed) |
| **Audit-chain contention on group writes** | The flagship path, immediately | Audit appends serialize on a Postgres advisory lock. One audit event per **group registration**, not per student — 30 attendance events plus 30 chained audit rows would contend globally against every other audit writer in the instance (`05-technical.md` §5 rule 6) |
| **Ten years of retained exam history** | The one table that never shrinks, by legal necessity | Small rows, indexed by candidate; a diploma register is naturally append-only and read-rarely |
| **Public site traffic spikes** | A newsletter or news item | ISR caching; the public surface has no person-table access so it cannot cascade into the portal (D-017). A spike affects one organisation only |
| **N+1 queries in the group matrix** | The hot path, immediately | Explicit repository methods returning the full matrix in one query; a performance test on a seeded 30×40 matrix in CI |

**The honest summary:** none of these justify architectural complexity today.
Each has a named, cheap response that the current design leaves room for. That
is what "scalability without premature complexity" means in practice — knowing
the answer, not building it.


---

# 08 — Open Architecture Decisions


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

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


---

# 09 — Decision Register


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Every architectural decision in this design, in one table. Format required by
the brief: **Decision · Reason · Trade-off**. Full rationale lives in the
referenced document.

| ID | Decision | Reason | Trade-off | Where |
|---|---|---|---|---|
| D-001 | Build SplashTrack v2 from `WebAppTemplate`; port the swim domain as concepts, not code | The template already implements ~70% of the brief's non-domain requirements (Person/UserAccount split, RBAC, org scoping, branding, CMS, consent, audit, GDPR erasure) with tests and 30 ADRs. The prototype implements none of them | Existing prototype code and migration history are discarded; any live data needs export/import | `00-overview.md` §2.3 |
| D-002 | Modular monolith, not microservices | Delivers minimal coupling and minimal code without distributed-systems cost; one DB, one transaction boundary, one deployment | Boundaries are conventions enforced by lint and review, not by network; no independent scaling per module | `01-domain-model.md` §1 |
| D-003 | In-process domain events for upward/sideways module signals | Decouples `attendance → skills` without a broker | Synchronous in v1; a slow handler slows the write | `01-domain-model.md` §1.2 |
| D-004 | One `Person` per human per installation; `Person`, `Membership` and `StudentProfile` are three distinct concepts | Separating them is what makes the real cases representable: a member who never takes lessons, a student enrolled by a guardian who is the member, an instructor who is also a parent. One row per human keeps rectification and erasure in one place | No continuity between organisations — someone working at two schools has two records in two independent databases. Correct privacy outcome | `01-domain-model.md` §2.1, §3.1 |
| D-005 | Progress and attendance are append-only event logs | Auditability; disputes over a diploma need history; makes offline replay safe | More rows, derived-state queries; may need a materialised summary later | `01-domain-model.md` §2.3 |
| D-006 | **(Withdrawn)** `organizationId` is *not* carried on domain rows | With one organisation per database the column is constant — dead weight on ~20 tables, and a constant column implies protection it does not give | Consolidating instances later would need the column plus a backfill. Accepted; designing for a rejected model is premature complexity | `01-domain-model.md` §3.6 |
| D-007 | **(Superseded by D-065)** Erasure severs identity; retained records survive pseudonymised | Rested on two errors: pseudonymisation does not end the GDPR obligation, and a diploma does not itself create an Article 17 exception | — | `10-findings.md` F-06 |
| D-008 | **(Reaffirmed)** Better Auth as a self-hosted *library* for identity and sessions; never the authorization layer; do not write our own auth | It runs in our process, writes our tables, sends nothing anywhere — not a third-party service. Building our own would mean owning password hashing, sessions, CSRF, TOTP, WebAuthn, OAuth/OIDC clients, PKCE, token refresh, account linking and throttling, correctly, forever, in public source, guarding children's health data | A dependency on a young library for a critical function. Mitigated: MIT, self-hosted, our schema, behind our own module boundary (F-22) | `02-security-privacy.md` §1.2 |
| D-009 | `SHARED_DEVICE` session mode for poolside tablets | Least privilege applied to *context*: an instructor on the pool deck doesn't need member administration, so that session shouldn't reach it | A second dimension in a security-critical path; implemented as one central deny-list | `02-security-privacy.md` §1.3 |
| D-010 | Medical/pastoral notes get their own permission pair and audit event type | Special-category data must be least-privilege by default; folding it into `students.read` grants it to everyone who can see a class list | Extra permission to administer; UI must degrade when unreadable | `02-security-privacy.md` §2.3 |
| D-011 | **(Withdrawn — this row is the authoritative text; see D-133)** No platform-support role restriction needed | There is no platform holding tenant data. Each instance has its own operator whose reach ends at that deployment | Support across customers requires per-instance access grants rather than one support role | *No active section — withdrawn decision, recorded here in full (D-133). History only in `11-revision-single-tenant.md`* |
| D-012 | **(Final)** Open-source, self-hosted: one Docker image per organisation, run on their own infrastructure | The organisation becomes sole controller and operator — no processor relationship, no third party holding children's health data, no cross-customer path. Open source makes the privacy claims verifiable rather than asserted | We can patch nothing and see nothing. Influence is limited to safe defaults, easy upgrades and honest advisories (F-13, F-17) | `03-deployment-model.md` §1 |
| D-013 | Column-level encryption for special-category data only | A backup or dump leak must not expose children's health data; encrypting everything breaks search for no proportionate gain | Those fields become unsearchable; introduces key management as a real duty (OD-7) | `02-security-privacy.md` §4 |
| D-014 | Erasure is one transaction with an explicit table registry | Per-module cleanup hooks fail silently when someone forgets to register a table; a registry + test makes forgetting unmergeable | A shared file every module edits — deliberate coupling on a compliance path | `02-security-privacy.md` §5.5 |
| D-015 | **(Withdrawn — this row is the authoritative text; see D-133)** No subdomain tenant resolution | Each instance has its own domain; there is no tenant to resolve. Wildcard DNS and wildcard TLS are no longer required | Per-instance DNS and certificate provisioning instead — automated by D-028 | *No active section — withdrawn decision, recorded here in full (D-133). History only in `11-revision-single-tenant.md`* |
| D-016 | Theming is a closed, validated token set — never arbitrary CSS | Even within one organisation, admin-supplied CSS is a stored-XSS vector against its own users, and makes every UI change a per-customer regression risk across the fleet | No arbitrary visual design; the brief's full branding list still fits | `03-deployment-model.md` §4 |
| D-017 | The public surface has its own read model and may not touch person tables | Single-tenancy removed the cross-organisation leak but not the worst incident: a public page exposing this organisation's own children | Publishing person-derived content needs an explicit opt-in that copies approved fields — intentional friction where consent belongs | `03-deployment-model.md` §5.1 |
| D-018 | Portal landing page is "Today", not a dashboard | The dominant user is an instructor arriving five minutes before a lesson; optimise for frequency, not seniority | Administrators need one extra click for an overview | `04-ux.md` §1 |
| D-019 | Keep Bootstrap; do not migrate to Tailwind or headless components | It works, it's already token-themed, the team knows it; migration is weeks of work for zero user value | Achieving a "modern" look depends on disciplined token use rather than the framework | `04-ux.md` §5.1 |
| D-020 | No message broker, cache server or search engine in v1 | Postgres covers queuing, caching and search adequately at this scale; each service is more to secure, back up, monitor and pay for | Some operations stay synchronous; revisit on measurement | `05-technical.md` §2 |
| D-021 | Single repository, single application, `apps/web` layout | One deployable, one version, one pipeline; leaves room for a worker later without restructuring | Slight path indirection | `05-technical.md` §3 |
| D-022 | The same container image is promoted DEV → UAT → PROD | The only way to know that what was accepted is what ships | Every environment difference must be runtime configuration — a permanent discipline constraint | `06-delivery.md` §1 |
| D-023 | UAT never receives production data | Copying production data down is the most common practical way GDPR compliance is lost, and would put children's health data in a weaker environment | Volume/shape bugs are harder to catch; mitigated with production-shaped synthetic data | `06-delivery.md` §1 |
| D-024 | Deployment only from a tag on `main` via a protected environment | Enforced by GitHub Environments at platform level, not by convention | Hotfixes take one extra step | `06-delivery.md` §2.1 |
| D-025 | Lucky's boundary is enforced by absent credentials, not instructions | An instruction not to touch production is a suggestion; a missing credential is a wall | Lucky can't directly diagnose production incidents and must work from sanitised evidence | `06-delivery.md` §4.3 |
| D-026 | Organisations can read their own audit trail | They are the GDPR controller; they cannot demonstrate accountability on evidence only the processor can see | The audit UI becomes a real product surface with its own performance and authorization needs | `07-operations.md` §1.2 |
| D-027 | Keep `Organization` as an enforced singleton, not a settings blob | Domain objects legitimately reference "the organisation" — a certificate is issued by one, an audit event names one. A named entity keeps those references honest | A foreign key that always points at the same row | `03-deployment-model.md` §1.3 |
| D-028 | **(Revised — this row is the authoritative text; see D-133)** No provisioning script; first-run setup happens in-app | The operator runs `docker compose up`. A setup wizard creating the first administrator and forcing MFA is the only onboarding we control | We cannot guarantee a correct install; documentation carries the weight | `03-deployment-model.md` §1.1, §1.2 (cited, not restated) |
| D-029 | **(Reaffirmed — this row is the authoritative text; see D-133)** No control plane, ever | We now have no access to any instance by construction. Adding one later would betray the model the product is sold on | No cross-instance visibility of any kind — including for support | *No active section — reaffirmed decision, recorded here in full (D-133). History only in `11-revision-single-tenant.md`* |
| D-030 | Authorization is always resource-referenced; a bare permission check is insufficient | `hasPermission('students.read')` is meaningless when grants are scoped — the honest question is always "this student?". An unscoped check would let a group-scoped grant read the whole organisation | Every call site must know the resource it acts on; more verbose than a role check | `02-security-privacy.md` §2.2 |
| D-031 | Reach resolution is centralised and required by every repository list call | A missed filter on a list endpoint silently returns everything — the most likely remaining data exposure. A required argument turns that into a type error | Noisier repository signatures | `02-security-privacy.md` §2.3 |
| D-032 | Scope-escape tests are mandatory per module | Scope filtering has the identical failure mode as the tenancy predicates it replaces. Deleting the tenancy suite without replacing it would trade a tested boundary for an untested one | Test effort per module; unavoidable for the boundary that now protects records from colleagues who should not see them | `02-security-privacy.md` §3 |
| D-033 | One app image plus a reference `docker-compose.yml` that includes PostgreSQL | "Complete application" must mean it works after one command, or self-hosting fails for the small organisations that need it most. Bundling Postgres *inside* the image would trap data and break upgrades | Two containers instead of one; operators with a managed database repoint `DATABASE_URL` | `03-deployment-model.md` §1.2 |
| D-034 | No telemetry; only an opt-out version check that sends nothing but the version | A privacy-first product phoning home about a school's usage is self-contradicting, and in public code it would be found and resented. The exception earns itself because unpatched instances are the biggest residual risk | We learn nothing about adoption or which features matter. That information is not ours | `03-deployment-model.md` §2.1 |
| D-035 | Database-backed identity-provider registry, administered in-app: local accounts plus any OAuth 2.0/OIDC provider (Entra, Google, Keycloak, Okta) | A self-hosted operator must connect their own IdP without editing env vars, rebuilding or restarting. `WebAppTemplate` already proves the pattern for Entra (ADR-022): DB-stored, secret encrypted at rest, permission-guarded admin screen, loaded at auth init. Generalised via Better Auth's `genericOAuth` (PKCE + issuer validation by default) | A misconfiguration can lock an organisation out. Mandatory: local admin login cannot be disabled while it is the only working method, and a provider must pass a test connection before it can be enabled. Makes the encryption key a first-class concern (OD-7) | `02-security-privacy.md` §1.2.1 |
| D-036 | Configuration lives in the database, administered in-app behind normal authentication — not in a file, not behind a shared admin token | Inherits backup, transactions, audit and access control for free. Vaultwarden's closest-comparable `config.json` + `ADMIN_TOKEN` model has non-revocable sessions and a shared secret as password, and the project itself does not recommend the file | Settings cannot be read before the database is reachable, forcing a small bootstrap layer | `13-configuration-and-setup.md` §2 |
| D-037 | Environment holds only what must be known before the database is readable, or what selects where state lives; adding a variable requires an ADR. **No numeric cap.** Runtime/platform variables (`TZ`, `NODE_ENV`, proxy, CA path) are not application configuration | A hard numeric cap would be an arbitrary rule that could later block necessary pre-database or platform configuration (TLS trust store, proxy, read-only paths). The criterion is what matters: if a value can be read from the database, it must be | Requires judgement rather than counting, so the ADR gate keeps it honest. Conventional env settings (SMTP host, log level) move into the database | `13-configuration-and-setup.md` §3.1 |
| D-038 | Every setting is live or explicitly rebuild-scoped; "restart the container" is never the answer for a runtime setting. **Amended by D-106:** identity providers are the one named exception, pending a spike | It is the stated requirement, and it forbids capturing settings in module-level constants at import time — a common stale-config bug source | Settings must be read through a service rather than a constant; needs a lint rule | `13-configuration-and-setup.md` §4 |
| D-039 | The setup wizard is the only unauthenticated administrative surface, and it self-destructs once the first administrator exists. **Amended by D-099 and D-101:** self-destruction is keyed on a set of rows, not one, and the setup token no longer goes to the container logs | First run is the one moment no account can exist. Bounding it removes the permanent unauthenticated admin surface that a shared-token model keeps open forever | A race between container start and the operator reaching `/setup`; mitigated by a one-time setup token, now filesystem-delivered (D-101) | `13-configuration-and-setup.md` §6 |
| D-040 | Recovery is two artefacts: an encrypted backup file **and** a recovery token (the wrapped `SECRET_KEY`), shown once and printable | A backup here is a complete copy of children's personal and health data; an unencrypted dump on a NAS is the most likely breach in the product. Encrypting makes the file inert alone, so it is safe to store casually — the safe path becomes the easy path | Lose the token and the backup is permanently unrecoverable. Obliges print-at-setup, explicit acknowledgement, step-up re-display, and a diagnostics check (F-24) | `14-backup-restore-upgrade.md` §2 |
| D-041 | Last-successful-backup age is surfaced on the dashboard and in diagnostics | Backups fail quietly; an operator who wrongly believes they have backups is worse off than one who knows they have none | A nagging UI element | `14-backup-restore-upgrade.md` §3.2 |
| D-042 | Backup download requires step-up auth, is rate-limited, high-severity audited, and served via a short-lived single-use signed link | The download button is by construction a one-click complete personal-data exfiltration primitive — the most dangerous UI element in the application | Friction for legitimate administrators; correct friction (F-23) | `14-backup-restore-upgrade.md` §3.3 |
| D-043 | Restoring a newer backup into an older image is refused; the app refuses to start against a schema newer than itself | Forward-only migrations make an older app on a newer schema undefined behaviour that silently corrupts. Refusing to start is recoverable in seconds; corruption may surface months later | An operator who pulls an older tag gets a container that will not start — with a message naming the version they need | `14-backup-restore-upgrade.md` §4.3 |
| D-044 | **(Amended by D-104)** An automatic pre-migration backup is taken whenever a start would apply migrations; D-104 adds the retention cap this decision originally left unstated — deleted after the next successful start, at most three retained | The most dangerous moment in this product's life is a migration against real data during an unattended upgrade. A snapshot at exactly that moment separates a five-minute rollback from a lost swim school | Slower upgrade start and disk usage; both trivially cheaper than the alternative | `14-backup-restore-upgrade.md` §5.2 |
| D-045 | The application prepares and verifies upgrades but never performs them; the operator runs one documented command | A container replacing its own image would be a remote-code-execution path into every self-hosted instance (F-18). Everything *around* the command is one-click instead | Not literally one-click; operators wanting automation use Watchtower or a compose cron, which works unchanged | `14-backup-restore-upgrade.md` §6 |
| D-046 | Restore writes the old schema first, then migrates forward — order is restore → migrate, never the reverse | The dump carries its own schema *and* Prisma's `_prisma_migrations` table, so "this backup is v1.0 and I am v2.4" is a fact the database states rather than a version string we guess. The migration runner then does exactly what it does on any upgrade — no special restore-migration path to keep correct | Restore must precede the entrypoint's normal start-up migration, so the setup wizard controls the sequence via a distinct start-up mode | `14-backup-restore-upgrade.md` §4.3 |
| D-047 | **(Out of v1, `00-overview.md` §3.5.1; fixture generation kept)** CI tests restore from every supported release — every release at or above `minimumRestorableVersion` (D-048) — into `HEAD`, not just the previous one. **D-105 specifies the fixture this decision never did:** source, generator, encryption key and storage, plus two assertions this decision omitted (every encrypted column decrypts, an enrolled TOTP still verifies) | "Skipped versions are supported" is worthless as prose; it is only true if a machine checks it on every pull request. A migration that breaks restoring from v1.3 then fails the build the day it is written, not years later on a stranger's server | The matrix grows with each release and needs eventual pruning; seeded backup fixtures live in the repo | `14-backup-restore-upgrade.md` §4.3.1 |
| D-048 | Migration chains are never squashed within a major version; every release declares a `minimumRestorableVersion` | Squashing feels like tidying and silently strands everyone whose data predates it. Collapsing may happen only at a major boundary, with the floor raised and stated in the release notes | The migrations folder grows monotonically and looks untidy. Untidy is not a problem; unrestorable data is | `14-backup-restore-upgrade.md` §4.3.1 |
| D-049 | Encrypted values carry a format version; decryptors for every previously shipped format are retained. **Extended by D-096 and D-097:** the format now carries a key id and AAD binding, and the decryptor registry is backed by a committed golden-vector test | A backup contains ciphertext. If the scheme is ever changed, a new version must still read old ciphertext — otherwise the restore "succeeds" and the contents are quietly unreadable, which no schema test would catch | Permanently retained legacy crypto code and a re-encryption obligation at each major boundary | `14-backup-restore-upgrade.md` §4.3.1 |
| D-050 | v1 is designed for the swimming-lesson domain, not a generic education platform | A generic platform built before a second domain exists is speculation, and it is what makes products vague and slow. Generic core entities (`Person`, `Group`, `Course`, `Skill`) keep an adjacent domain possible without abstracting now | Adapting to a materially different domain later is real work rather than configuration | `00-overview.md` §1.1 |
| D-051 | The public surface may not read any person, student, member, group, attendance, progress or exam record, nor expose any endpoint from which their existence can be inferred | The worst plausible incident is a public page exposing data about children. Structural impossibility beats careful coding | Naturally public-feeling features need a deliberate publishing step — which is where consent belongs | `00-overview.md` §3.4 |
| D-052 | An examiner may exist as a `Person` with no membership; if they log in or record results they get an individual, time-bounded, minimally scoped account — never a shared one | A shared "examiner" login destroys attribution on exactly the records that most need it: a child's diploma outcome. Full membership over-grants for someone present one afternoon | Slightly more administration per exam day — the correct cost for attributable, expiring access | `00-overview.md` §5.2 |
| D-053 | `Membership` and `StudentProfile` are separate tables, never one table with a flag | Different numbering, lifecycles, retention (a member may leave while diploma history is kept ten years) and permissions. One table with a flag forces one retention policy onto both | Two lookups where a naive model has one; administrators must understand the distinction, so the UI hides it | `01-domain-model.md` §3.1 |
| D-054 | **(Superseded by D-068)** `EXAM_SESSION` is a first-class scope type; no access mechanism lives outside the scope enum | An external examiner attends one session. `COURSE` scope would grant every exam session of that course, past and future — over-granting on a child's diploma outcome. One extra enum member beats a special case for examiners; every grant stays expressible as `(permission, scopeType, scopeId)` | One more scope type to implement and test. `ExamAssessor` becomes an attribution record, not an access mechanism | `02-security-privacy.md` §2.2 (retained as history in the same section) |
| D-055 | The container never migrates a database whose purpose is not yet known; state is detected first (EMPTY / PARTIAL / EXISTING / CURRENT / AHEAD) and migration follows from it | An empty database is ambiguous — fresh install, or the first minute of a restore. Migrating immediately resolves it wrongly: the operator gets a migrated empty schema and a backup that no longer restores cleanly into it | The entrypoint carries a data-critical state machine instead of `migrate deploy && start`; covered by a test matrix with one case per state | `13-configuration-and-setup.md` §6 |
| D-056 | The template's reusable parts are retained; its multi-tenant-specific models, middleware, authorization paths and schema elements are **actively removed during extraction**, incrementally and covered by tests | Dead security code is worse than absent security code: a bypassed scoping extension is attack surface, maintenance load, and a false signal to the next reader that something is enforced. Nothing is preserved merely because it already exists | Extraction work up front and real divergence from upstream, making cherry-picking harder | `00-overview.md` §2.1, `01-domain-model.md` §1.1.1 |
| D-057 | `ScheduledSession` is owned by its own `sessions` module | "One table, two owners" violated the design's own isolation rule and would have been the first boundary to erode. A session is a domain concept in its own right; planning and attendance are both consumers | One more module for a small table — module count is cheap, ownership ambiguity is not | `01-domain-model.md` §1.2 |
| D-058 | `Person` is the canonical identity anchor, **not** the only place personal data may live; purpose-specific PII stays in its owning module | Data protection is organised around purpose, not tables. Health data has a different basis, permission, retention and encryption from a name; putting it on `Person` would make least privilege impossible | Personal data spans modules, so erasure and export consult a test-enforced registry rather than one table | `01-domain-model.md` §2.1 |
| D-059 | Leaving and returning uses `MembershipPeriod` rows and `StudentLifecycleEvent`s — never a second profile or a status flag | A returning swimmer is the same human with the same history, and that history is the product's value. A second profile fragments and duplicates PII; a status flag destroys the answer to "when were they a member?" | Current membership and student status are derived rather than read from a column | `01-domain-model.md` §3.1 |
| D-060 | Membership is never an implicit prerequisite for a role | Membership is an administrative/financial relationship; authorization is a security concern. Conflating them forces fake memberships for volunteers and implies members have rights they were never granted | Two things to administer where a naive model has one; the UI offers them together | `01-domain-model.md` §3.1 |
| D-061 | Attendance is an append-only event log; a correction writes a new event with `supersedesEventId` and never mutates a row | "Append-only" was previously asserted while the model still allowed in-place updates, which would have destroyed exactly the history the claim promises. Attendance is evidence for absence policy, disputes and occasionally safeguarding | Reads resolve derived state instead of a column, and the table grows with corrections | `01-domain-model.md` §3.4 |
| D-062 | An `ExamCandidate` has 0..N results with `supersedesResultId`, one effective | A single-result model forces corrections to overwrite the original, destroying what was first decided and by whom — on a diploma outcome, the one thing that must stay reconstructable | Reads must resolve the effective result; same derivation pattern as D-061 and D-005 | `01-domain-model.md` §3.5 |
| D-063 | Consent records subject, actor, purpose, lawful basis, authority evidence, timestamp and withdrawal; guardian authority is evidence of a claim, not automatic legal validity | The application cannot verify guardianship — it can only record what it was told, by whom and how the claim was established. Treating a row as legal validity would give false comfort in a custody dispute | More fields at capture and a UI that must ask who consents on whose behalf — an unavoidable question | `02-security-privacy.md` §5.4 |
| D-064 | The organisation is the controller; publishing self-hosted software does not make the project a processor. A hosting or service provider may be, depending on deployment | A processor processes data on the controller's instructions; we never receive any. Overclaiming creates obligations we cannot fulfil, understating a hosting provider's role leaves a real gap | Documentation must explain a distinction most self-hosters have not considered, without drifting into legal advice | `02-security-privacy.md` §5.1 |
| D-065 | Retention and erasure are policy-driven per data class: purpose, lawful basis, trigger, expiry action (`DELETE`/`ANONYMISE`/`REVIEW`) | Replaces D-007. Pseudonymisation does not end the obligation, and a diploma does not itself create an Article 17 exception — the ground must be identified and recorded, not assumed | The organisation must decide its own grounds; defaults ship as proposals requiring confirmation (F-27) | `02-security-privacy.md` §5.6 |
| D-066 | Person retention is triggered by the end of the person's **last relationship of any kind**, not by membership | The most common person in the database — a child taking lessons — has no membership, and neither do guardians or external examiners. A membership-keyed rule would silently retain the majority forever | "Last relationship" is a computed condition across modules, covered by the same registry and test as erasure (D-014) | `01-domain-model.md` §5.1 |
| D-067 | The licence is **AGPL-3.0**, replacing the GPL-3.0 the repository already carried. OD-13 is closed | SplashTrack is software that is *run as a service* by whoever deploys it. GPL-3.0 copyleft is triggered by distribution, not network use, so a competitor could run a modified hosted SplashTrack for swim schools and publish nothing — the exact outcome the licence was supposed to prevent. AGPL-3.0 §13 closes that gap. Possible only because every commit traces to a single rightsholder; one genuine external contribution would have blocked it | Some procurement policies refuse AGPL outright, costing a class of institutional adopters. Accepted deliberately in exchange for reciprocity. A DCO is now needed before the next external contribution (F-28) | `08-open-decisions.md` OD-13, `03-deployment-model.md` §4 |
| D-068 | `SESSION` is a first-class scope type: reach follows assignment to a specific session's roster, for a bounded window, and replaces `EXAM_SESSION` (D-054) | Four real cases share one shape: the independent aftest assessor, a substitute instructor, the receiving instructor of a make-up lesson, and an external examiner — none holds a standing `GROUP` grant over the child. `COURSE` scope over-grants every one of them. One scope type generalises all four rather than adding three more special cases | One more scope type to implement and test, resolved against a roster rather than a static membership. **Blocks D-085** until it ships | `02-security-privacy.md` §2.1–2.2 |
| D-080 | The assessment pass rule is one data-driven function over scheme rows: every criterion needs a result whose grade rank ≥ `criterion.minimumGrade ?? scheme.passFloor`, or a recorded waiver. No award type is branched on anywhere in the codebase | *"Alles minimaal voldoende"* is `passFloor = VOLDOENDE` with every override NULL; *"certificaten hebben afgezwakte eisen"* is a different `AwardType` with its own scheme. The alternative — a global floor plus hardcoded exceptions — survives only until a third award variant, and every school eventually has one | The rule is no longer readable from code alone; the screen renders the effective threshold beside each criterion | `15-assessment-and-fees.md` §2.2 |
| D-081 | `Assessment.schemeId` pins a specific immutable scheme version. An `ACTIVE` scheme is never edited — editing produces version *n+1* and stamps `effectiveTo` on *n*. The scheme is never resolved from the assessment date | Date resolution breaks twice: on backdated entries, and whenever the NRZ revision date differs from the school's adoption date, which it always does | A scheme version can never be corrected in place; a typo in a criterion name requires a new version | `15-assessment-and-fees.md` §2.3 |
| D-082 | The existing `Certificate` entity is renamed `Award`; `AwardType.kind ∈ {DIPLOMA, CERTIFICATE}` carries the distinction | `Certificate` meant "the physical proof of a diploma", but a *certificaat* is a different award with weaker requirements. Free today as a rename; a migration through every issued diploma row later | "Award" is less familiar to a Dutch administrator than "certificaat"; the UI keeps saying *diploma*/*certificaat* | `15-assessment-and-fees.md` §2.4, `01-domain-model.md` §3.5 |
| D-083 | NRZ-derived schemes ship seeded and source-labelled (`source = NRZ`), org-editable, but editing one produces an org-owned **fork** rather than an in-place change | Without the fork a well-meaning administrator lowering one threshold quietly weakens a national diploma requirement, with nothing recording the divergence | More scheme rows; adopting a minor NRZ correction means a new version rather than a patch | `15-assessment-and-fees.md` §2.5 |
| D-084 | `SchemeCriterion` is the single criterion catalogue; `SkillRequirement` and `Skill` are collapsed into it and removed. `SkillProgress` survives as the informal per-lesson log; `AssessmentCriterionResult` is the formal graded observation | Two catalogues covering the same concept diverge by accident, not decision, once a criterion is added to whichever screen writes it. This **reduces** scope: one catalogue to seed, import, export and render | `SkillProgress` now references a versioned criterion — correct, the same pin as D-081 | `15-assessment-and-fees.md` §2.6, `01-domain-model.md` §3.3 |
| D-085 | An `ExamCandidate` may not reach `CONFIRMED` without a non-superseded `AFTEST` `Assessment` with `outcome = PASS`, graded by a `PersonQualification` holder who is not an `InstructorAssignment` holder for that student's group. Overridable only with an explicit permission and a recorded, audited reason | This is the control the domain runs on — a different qualified instructor decides whether a child may sit the exam — enforced today by nothing but habit. The override exists because an un-overridable rule, in a week with no independent assessor, produces someone logging in as a colleague: the control is then gone *and* the audit trail is a lie | The gate's strength is reporting rather than prevention. An override rate is a number a chair can act on; a workaround is not | `15-assessment-and-fees.md` §3 |
| D-086 | On the assessment screen every criterion starts **unset**. No default grade, no unconfirmed "mark all voldoende", no outcome computed over unset criteria. Set-whole-column is allowed behind an explicit confirmation | Pre-filling *voldoende* on the assessment deciding exam candidacy manufactures rubber-stamping and makes the four-eyes control ceremonial. This is a deliberate exception to the product's 30-second thesis, which governs the poolside operational moment, not a scheduled deliberate assessment | The slowest screen in the product. An aftest takes ten minutes and that is the correct number | `04-ux.md` §4.7, `15-assessment-and-fees.md` §4 |
| D-087 | Assessment remarks sit behind `students.notes.read`/`students.notes.write`, not general `students.read`, and attach primarily at `AssessmentCriterionResult` | A pedagogical remark about a child's body and movement is at least as sensitive as a medical note (D-010 gates medical notes but said nothing about assessment remarks) | An assessor without the notes permission sees grades without the reasoning. *Forward note: when the guardian portal (P-04) ships, parent-facing visibility of a remark is a separate setting from this instructor-facing permission — not the same toggle* | `15-assessment-and-fees.md` §5 |
| D-088 | Fee tracking is three tables (`FeeType`, `Charge`, `Payment`), one idempotent generation job, one balance view and one CSV export. The payer is a `Person`, never the child; `Charge.amount` is copied at creation, not joined at read time | The product owner's verb is *bijgehouden* — tracked, not invoiced. Copying the amount stops next year's contribution silently restating last year's open charges | The treasurer still produces actual invoices elsewhere, from the CSV | `15-assessment-and-fees.md` §6.1–6.2 |
| D-089 | An exam-fee `Charge` is created by the event of an `ExamCandidate` reaching `CONFIRMED`, and at no other time | Encodes *"dit gebeurt dus ook alleen als ze echt examen gaan doen"* as an invariant. Composes with D-085: no aftest pass → no confirmed candidate → no charge | Cancelling a candidacy must cancel or waive the charge rather than delete it | `15-assessment-and-fees.md` §6.3 |
| D-090 | There is no `Household`. Charges group by `Charge.payerPersonId` at render time; the payer is derived from `PersonRelationship(GUARDIAN_OF)` at creation and stored on the charge, with a per-charge override | A household is a fourth identity concept alongside `Person`, `Membership` and `StudentProfile` (D-004), wrong within a year for divorced parents, split payment, a grandparent paying for one child | No place to hang a household-level discount; "the family overview" is a query, not a row | `15-assessment-and-fees.md` §6.4 |
| D-091 | v1 emits no invoice. Out of scope: payment providers, SEPA incasso, VAT calculation, sequential numbering, credit notes, dunning, accounting export, pro-rata credit — and any document headed *Factuur* | A PDF carrying an amount, the organisation's details and a parent's name is arguably a *factuur* under Dutch rules, inheriting gapless numbering, mandatory fields, BTW treatment and a seven-year obligation on a record the app now **authored** | Unpopular within a term; the treasurer invoices from the CSV elsewhere | `15-assessment-and-fees.md` §6.5 |
| D-092 | `Charge` and `Payment` are registered in the D-014 erasure registry with a financial retention ground, and erasure **pseudonymises** the charge rather than deleting it | D-066 defaults person retention to 24 months after the last relationship; Dutch fiscal law wants seven years. Without this the first erasure request either destroys the bookkeeping or silently skips it | Financial rows outlive the people they refer to; the erasure report must state the retained ground | `15-assessment-and-fees.md` §6.7, `01-domain-model.md` §5 |
| D-093 | Arrears never appear on the poolside surface. `Enrolment.status` remains a lifecycle, never a payment state | Once money is in the same database as the class list, someone asks why the class list doesn't flag it — which would put a family's finances in front of a volunteer instructor at the poolside, in front of the child | An administrator cannot use the app to have an instructor quietly chase a parent — the intended outcome | `15-assessment-and-fees.md` §6.8 |
| D-094 | NRZ notification is an export (candidates, date of birth, award type, date); the visiting delegate receives a **printed** candidate list — no guest login, no share link, no visitor account | The domain expert asked for a report, not an integration. Paper answers "a person beside the pool can read twelve names" with no stranger touching a device holding children's records | A printed list cannot be revoked once handed over — neither can a photo of a screen, and paper persists no credential | `15-assessment-and-fees.md` §7 |
| D-095 | The database export is a structured logical export the application writes and reads itself, not a raw `pg_dump` replayed by the database | Deletes the arbitrary-SQL-execution restore class entirely rather than filtering it; loses nothing D-046 relies on (the manifest carries the `_prisma_migrations` trick as a field) | We own the export/import code for every column type and schema change | `14-backup-restore-upgrade.md` §3.1 |
| D-096 | Every encrypted value is `v1:<keyId>:<nonce>:<ct>`, authenticated with AAD binding `(table, column, primary key, keyId)` | D-049 versioned the ciphertext format but not the key, and bound nothing to its location. Without a key id, an interrupted rotation is indistinguishable from corruption; without AAD, a ciphertext blob is portable between rows | Longer envelopes; every read site must pass its own `(table, column, pk)` | `13-configuration-and-setup.md` §5.1 |
| D-097 | One `src/lib/crypto/envelope.ts` with a `DECRYPTORS` registry keyed by format version and a `CURRENT_FORMAT`, backed by a committed golden-vector test with one entry per format ever shipped | The template's decryptor throws on any format mismatch, so shipping a new format makes every old value unreadable — exactly what D-049 exists to prevent | Permanently retained legacy crypto code; a vector file that only grows | `13-configuration-and-setup.md` §5.2 |
| D-098 | The boot states are six ordered predicates evaluated against one connection — `EMPTY`, `AHEAD`, `FAILED`, `PARTIAL`/`TAMPERED`, `EXISTING`, `CURRENT` — replacing `migrate status` exit codes | D-055 named states with no predicates for code the design calls security- and data-critical. `FAILED` exists because a failed Prisma migration stays recorded and blocks every later one, so the container would otherwise crash-loop with no indication the fix is `migrate resolve` plus the named backup | Six states rather than five; the entrypoint reads a Prisma-internal table (already true of D-046) | `13-configuration-and-setup.md` §6.1 |
| D-099 | Setup mode requires **all** of: no bootstrap record, zero `UserAccount`, zero `Person` and zero `RoleAssignment` rows. Data present with the bootstrap record missing is `TAMPERED`: refuse to serve, log loudly, break-glass CLI only | The gate on the only unauthenticated administrative surface was one deletable row — SQL injection, a compromised low-privilege credential, a botched restore or an erasure bug could all put a populated database into unauthenticated setup mode | An operator resetting a populated instance genuinely must do it from the host | `13-configuration-and-setup.md` §6.2 |
| D-100 | The first-run record is `InstallationBootstrap`, not `PlatformBootstrap` | Kept the `Platform` prefix D-056 deletes, on the model the boot state machine reads on every start — the worst place for a stale name | One more rename during extraction | `13-configuration-and-setup.md` §6.3 |
| D-101 | The setup token is written to `$DATA_DIR/setup-token`, mode 0600; only its path is printed to logs. Single use, ≤60-minute expiry, reissued only via `splashtrack setup:token --new` | D-039's mitigation printed a bearer credential to logs the design itself assumes self-hosters paste into public issues, in a public repository | The operator needs filesystem access to the data volume — one more command, of the class break-glass already needs | `13-configuration-and-setup.md` §6.3 |
| D-102 | The archive uses a framed AEAD construction (per-chunk sequence numbers, explicit final-chunk marker); the manifest is a separate AEAD message verified before any parsing; nonces are random per archive and never reused | Plain AES-256-GCM is not a streaming construction: buffering the whole archive or encrypting chunks independently both allow truncation, reordering or splicing to verify. Parsing an unauthenticated manifest acts on attacker-controlled data | A named external construction (libsodium `secretstream`/`age`) rather than raw primitives | `14-backup-restore-upgrade.md` §3.1 |
| D-103 | v1 writes backups to a mounted volume only — no S3 destination. A change of destination or its credentials is equal in severity to a download: step-up, high-severity audit, notification to every administrator, and a 24-hour delay before the first backup reaches a new destination | `blob-storage.ts` supports only `"local"` and there is no S3 client in the repository. An unguarded destination setting is a complete nightly exfiltration channel behind a text field, next to the tightly-guarded download button | Off-site backup is the operator's own job in v1 (`rclone`/`restic`/NAS) | `14-backup-restore-upgrade.md` §3.2 |
| D-104 | Pre-migration backups are deleted after the next successful start, at most three retained. Backup retention may not exceed the shortest special-category retention, or the mismatch is a diagnostics warning naming both figures | "Retained for a configurable number of upgrades" had no maximum and no expiry trigger, set against an unqualified promise that special-category data is hard-deleted at 12 months — a full copy including medical notes accumulated once per upgrade | An operator wanting a long backup history against a short erasure period must choose one and record why | `14-backup-restore-upgrade.md` §5.2 |
| D-105 | The release workflow boots the just-built image against scratch Postgres, seeds a deterministic fixture, backs it up under a fixed public test key and uploads it as a GitHub Release asset; the matrix asserts migration state, row counts, **every encrypted column decrypting to known plaintext**, **an enrolled TOTP still verifying**, and the audit chain verifying | D-047 named no fixture source, generator, key or storage, and at v1.0 there are zero prior releases; fixture generation must still ship in v1.0 or v1.1 can never test restoring from it. The two bolded assertions are the case F-25 called nastiest and had previously been omitted | Fixtures live outside the git tree; restoring an old release depends on the Releases API | `14-backup-restore-upgrade.md` §4.3.1 |
| D-106 | D-038 stands for every setting except identity providers, marked *requires a spike before being treated as decided*: a versioned `getAuth()` against a `settings_version` counter | The template's own source comment states Entra configuration is read once at auth-context construction and applies only on the next restart — `export const auth = betterAuth({...})` is a module-level singleton, and `genericOAuth` takes a static provider array | One decision stays open into the build; if the spike fails, identity providers become the one named exception to the no-restart rule | `13-configuration-and-setup.md` §4.1 |
| D-107 | The backup schedule is `intervalHours` plus a run window, not a cron expression | `MaintenanceJob` is interval-based and there is no cron parser or dependency in the repository. Adding one to a data-critical path buys expressiveness nobody asked for | "Every Sunday at 03:00" is not directly expressible; `intervalHours: 24` with a night window is what operators actually mean | `14-backup-restore-upgrade.md` §7 |
| D-108 | Moving a child between groups is recorded as a `GroupMove` carrying direction (`UP`/`DOWN`/`LATERAL`), a reason and the deciding person. Moving **down** is ordinary history, not a correction | Progress is per individual, not per group; both directions are normal. Without a required reason, a move down is indistinguishable from an administrative error, and a parent reading it draws the worst available conclusion | One more row per move and a required reason on an action administrators would rather do in two clicks | `01-domain-model.md` §3.2 |
| D-109 | Trial lessons, waiting lists and make-up lessons are **modelled**, and no workflow is built: `Enrolment.status = TRIAL`, `StudentLifecycleEvent.TRIAL_ATTENDED`, `WaitlistEntry` with placement from `Inquiry`, and `SessionRosterEntry` accepting a non-member guest. No booking flow, conversion funnel or entitlement counter | The waiting list is in daily use and gets its placement action. Trials and make-ups the domain expert asked to allow for while stating his own school does not run them — a workflow would be built for a customer who does not exist. The data shape is expensive to retrofit later; the workflow is not | A school that runs trials/make-ups administers them by hand — worse than a designed flow, better than one nobody opens | `01-domain-model.md` §3.2, R-38 |
| D-110 | The retention table records a **lawful basis** per data class, and unresolved bases are printed as *unresolved* rather than left blank | The prose promised to answer "on what basis is it held" and the table carried no such column — the one question a defence of a default requires was the one it did not state | Some cells read *unresolved* in a published document — the honest state, and it makes the gap visible where the defaults are read | `01-domain-model.md` §5 |
| D-111 | Expired attendance events are **deleted**, not anonymised. Any aggregate kept is kept because it was computed, not because a row was stripped. Pre-migration backups gain a cap: deleted after the next successful start, at most 3 retained | A group of twelve, retained time-bounded `GroupMembership` rows and known session dates re-identify a large share of "anonymised" rows by a join and a counting argument — pseudonymised data carries the same obligations, so nothing was gained by not deleting | Attendance-rate history beyond the window is lost unless an aggregate is deliberately computed and stored first | `01-domain-model.md` §5.3 |
| D-112 | There is exactly one bootstrap secret, `SECRET_KEY`, supplied via `SECRET_KEY_FILE`. Every application key, including the Better Auth signing secret, is derived by HKDF with a purpose label; the application never generates it into `DATA_DIR` | The design gave four mutually exclusive accounts of this key's lifecycle, and the template has no `SECRET_KEY` at all — a shared value with `BETTER_AUTH_SECRET` prints a session-forging key on paper; a different value silently kills every TOTP enrolment on restore while MFA is mandatory | Compromise of `SECRET_KEY` compromises everything derived from it; a deprecated plain env-var fallback avoids bricking existing installs | `13-configuration-and-setup.md` §3.1.1 |
| D-113 | Key material is never inside a backup archive; the writer excludes the key-material path explicitly and CI asserts no shipped fixture contains it | With key material under `DATA_DIR` and assets captured as a directory tree, the archive would contain its own decryption key, and every "inert without the token" claim would collapse silently | The exclusion is a deny-list, backed by a test that greps fixtures for both key bytes and file name | `13-configuration-and-setup.md` §3.1.1, `14-backup-restore-upgrade.md` §3.1 |
| D-114 | Two-level key envelope: a random 256-bit master key wrapped by Argon2id over the printed recovery token; a per-archive random data key wrapped by the master key. Rotation re-wraps the master key | The token being the key meant one non-revocable secret forever for archives, medical columns and every stored credential, and rotation could not reach `.stbak` files already written | Two unwrap steps and a deliberate KDF delay on every restore; losing the token still loses the data (F-24 unchanged) | `14-backup-restore-upgrade.md` §2 |
| D-115 | The recovery token carries ≥128 bits of entropy, Crockford base32 with a check character. Every re-display is a high-severity audit event and notifies all administrators; the restore endpoint is rate-limited with lockout | A token with no stated entropy floor invites shortening — silently catastrophic for key material. The restore endpoint sits in the unauthenticated setup wizard and had no stated limit | A longer token to transcribe; administrators are notified of a colleague's legitimate re-display | `14-backup-restore-upgrade.md` §2.2 |
| D-116 | The application's database role is not a superuser — owner of its own schema only, `NOSUPERUSER NOCREATEROLE` — created that way by the reference compose | "Superuser" and "least-privilege database role" appeared nowhere in fifteen chapters, and the role bounds every SQL-injection class in the product, not only restore | Operators pointing `DATABASE_URL` at a managed database must create the role themselves | `14-backup-restore-upgrade.md` §4.2.1, `03-deployment-model.md` §1.3 |
| D-120 | The v1 scope is re-cut: the self-hosting *product* moves out (IdP registry, restore matrix, settings registry, UAT environment, retention engine, CMS, `/api/v1`, the 15-check CI) and the assessment domain moves in (aftesten, `SESSION` reach, billing-lite, waiting list, group moves, print, NRZ export, breach response) | ~45% of specified effort went into a product for a self-hosting stranger while six weekly-named capabilities were absent entirely. OD-2's closure — the first and only operator for the next year is the author, at his own school — makes that spend provably speculative | ~18–20 engineer-weeks against ~60–75 as specified; every deferred item is additive, none structural | `00-overview.md` §3.5 |
| D-121 | `UNIT` is a **flat** scope in v1; the recursive descendant walk is not built | One pool. A recursive tree walk is the highest-risk code path in the application — it fails open, silently, at depth — written for a federation that does not exist | A future federation needs the walk added, plus tests | `00-overview.md` §3.5.1, `02-security-privacy.md` §2.2 |
| D-122 | `RELATED` is removed from the scope enum entirely until the guardian portal ships | It was in three states at once: mandated for v1 (R-14), deferred to the portal (P-04/OD-5), and *granted* by the v1 starter Guardian role — an administrator could assign a scope whose enforcement nobody wrote, and it would look like it worked | The Guardian role's consent authority is expressed without a scope axis in v1; the enum member returns with the portal | `08-open-decisions.md` OD-5, `02-security-privacy.md` §2.1 |
| D-123 | Repository layout is flat root (revises D-021) | D-021 rested on the *prototype's* `apps/web` layout; the *template* — the actual technical base (D-001) — is flat-root with `@/*` → `./src/*`. Adopting `apps/web` means moving the whole tree for a second artefact nobody has asked for | Adding a worker or docs site later means doing the move then, with a reason | `05-technical.md` §3 |
| D-124 | D-048 is enforced by `tests/unit/migration-history-append-only.test.ts`: the migration-name set at the last release tag is a subset of HEAD's, and no applied migration's SQL content hash has changed | "Never squash" was a sentence in a document, and squashing feels like tidying — the damage is invisible until a self-hoster's old backup will not restore | Every migration commit updates a lockfile — also a useful review artefact | `06-delivery.md` §2.2 |
| D-125 | Module boundaries are enforced on **Prisma model access**, not only on imports: each module exports a client narrowed to the models it owns, and a lint rule forbids the root client under `modules/` | `no-restricted-imports` catches cross-module imports; `prisma.scheduledSession.create()` called from inside another module imports nothing and passes, which is the exact violation D-057 exists to prevent | A wrapper per module and one more lint rule; a cruder rule banning `prisma.<model>` outside its owning module can ship first | `05-technical.md` §3.1 |
| D-126 | One audit event per aggregate write, not per row — one event for a group attendance registration, not thirty | `AuditEvent` is a hash chain whose appends serialize on a Postgres advisory lock; thirty chained rows per registration would contend globally against every other audit writer, which the p95 target was set without knowing | Per-student attribution comes from the attendance events themselves, which already carry the actor | `05-technical.md` §5, `00-overview.md` §4.1 |
| D-127 | Object storage is out of v1. Assets live on a mounted filesystem path and are captured inside the encrypted backup archive; volume-level redundancy is the operator's choice | `blob-storage.ts` supports only `"local"`; there is no S3 client in the repository. "Versioned, replicated" was a managed-cloud assumption stated as policy, and a scheduled push to a bucket would be an exfiltration channel with none of D-042's controls | An operator wanting off-host redundancy syncs the volume themselves | `07-operations.md` §2, `05-technical.md` §1 |
| D-128 | Breach response is a v1 capability: a "what did this account do" audit report, an active-session inventory with global revocation, delivery for high-severity events, and an incident checklist | The controller must assess and notify within 72 hours (Art. 33) and notify subjects for high-risk breaches (Art. 34); this is health data about children, so the Art. 34 threshold is met by default. The design shipped an audit trail and a metrics list and stopped | Development time for a capability nobody wants to use — the alternative is a swim school improvising under a legal deadline | `07-operations.md` §1.4, R-37 |
| D-129 | Print fallbacks (class list, exam candidate list) ship in v1 as minimum viable parity, not a convenience | The incumbent is paper, and paper never has a zero-percent day. An app that will not load shows nothing, and the instructor has no move; P-02's "prepared, not built" is defensible only because this exists | Half a week that buys no new capability — it buys the failure mode | `04-ux.md` §4.0, R-35 |
| D-130 | The MFA mandate and the security alert rules bind to **permissions**, never to role names | `platform.super_admin` does not exist (D-056), so an alert on it never fires; "organisation administrator roles" is not a checkable predicate either, since roles are user-definable | The named high-risk permission set must be maintained as permissions are added | `07-operations.md` §1.3, `02-security-privacy.md` §1.2 |
| D-131 | An instructor holds a bounded self-correction window on their own sign-offs from the current session; beyond it, `skills.revoke` applies unchanged | Two states existed — free undo before Save, permissioned revoke after — so a mis-tap on a 30×40 grid with wet hands required an administrator, a guaranteed weekly interruption | A narrow window in which a sign-off can be withdrawn without the revoke permission; audited, writes a superseding event, cannot touch another person's sign-off | `04-ux.md` §4.2 |
| D-132 | The WebAuthn RP ID is set deliberately at setup, changing it warns loudly, and every account retains a password + TOTP fallback | Starting on `http://nas.local:3000` and moving to a real domain is the **expected** path for this deployment, and changing `APP_URL` invalidates every passkey at once | A fallback factor per account to enrol and protect; total lockout is worse | `04-ux.md` §4.0, `07-operations.md` FM-15 |
| D-133 | For a withdrawn or superseded decision, the register row **is** the authoritative text, and says so instead of pointing at a chapter | D-011, D-015, D-027, D-028 and D-029 had no decision statement in any active chapter, and three of their "Where" pointers named the wrong section. A reader following the register landed in a chapter (11/12) that forbids citing it | Withdrawn decisions are terser than live ones — the correct asymmetry | `09-decision-register.md` (this document), `08-open-decisions.md` |
| D-134 | A normative rule is stated **once**, in one section; every other mention points at it and says so | D-037's rule was stated authoritatively in three places and agreed only because all three were edited at once — the same three-place duplication existed for D-047/D-048 and D-040 | A reader wanting the rule follows one pointer, cheaper than three copies drifting | `00-overview.md` §3.1 |
| D-135 | Adopt `tests/unit/migration-safety.test.ts` and `person-reference-classification.ts` + `person-reference-sync.test.ts` as they are, rather than re-inventing them | The first already blocks the unsafe `ADD COLUMN … NOT NULL` without a default; the second **is** D-014's registry-with-a-test, already built and bidirectionally checked, which the design described as something to create | The sync test goes red the moment a domain model adds a `Person` reference without a registry entry — the desired forcing function | `05-technical.md` §5.1 |
| D-136 | UAT as a separate environment is out of v1 (revises D-022); D-023's rule is kept as free policy — no environment below production ever receives a copy of production data | One person is author, reviewer and acceptor; a third environment between him and himself buys a handover that does not happen. The template's `deploy-uat.yml`, which builds on the target host — the direct inversion of D-022 — is deleted rather than extended | Bugs that only appear on a production-shaped deployment surface in production; mitigated by a synthetic generator | `06-delivery.md` §1 |
| D-138 | The v1 build order is fixed by cost of doing it late: crypto envelope → audit chain rotation → scope model → append-only event models → settings → consent → restore fixtures → erasure registry; then repo hygiene → foundation → removals and reshaping → domain modules in DAG order → surfaces | The most retrofit-hostile mechanisms go first: every encrypted byte written before the envelope must be re-wrapped, the scope model changes the signature of every module's guard call, and converting a mutable column into an event log after data exists means inventing the history that was destroyed | The flagship attendance screen is built late — it rests on five modules, and building the demo first would leave it resting on stubs | `06-delivery.md` §5 |
| D-139 | A granter may grant only permissions they themselves hold, only at or below their own scope, and only for a validity window inside their own. Enforced in the grant service, applied identically to `Role` editing and to `AccessGroup` assignment | Role assignment is the highest-privilege operation in the product and had **no permission and no invariant** — `roles.assign` was cited as high-risk in `07-…` §1.3 and existed nowhere. A `UNIT`-scoped Location Manager could assign themselves an `ORGANIZATION`-scoped administrator role, or an access group carrying `students.medical.read`, and hold every medical note in the school. Step-up is no obstacle: it is their own password and their own second factor | An administrator delegating something they do not hold must first be granted it themselves, visibly. Bootstrap (setup wizard, break-glass CLI) sits outside the grant service and is host-access-proven | `02-security-privacy.md` §2.6 |
| D-140 | Identity-provider administration is its own high-risk permission; external identities link on `(issuer, sub)` only, never on an email claim; JIT provisioning creates nothing and the JIT-role field is deleted; changing issuer/token/userinfo endpoints clears the stored client secret; `ORGANIZATION`-scoped accounts are opt-in per account for external authentication | D-035 as written was an account-takeover primitive: anyone with `organization.settings.manage` adds a Keycloak tenant they control, maps `email` onto the administrator's account, passes the mandatory test connection against their own IdP, and signs in as instance administrator — MFA on the local account never touched. Second path: edit only the token endpoint of an existing provider and the app posts the stored client secret to the attacker. "The secret is never returned to any client" hides a secret from reads while allowing a redirect of where it is *sent* | Linking on `(issuer, sub)` means an IdP migration requires re-linking accounts rather than matching on email. Correct friction: an email address is an identifier the organisation does not control | `02-…` §1.2.1 |
| D-141 | The recovery path from an authentication misconfiguration is the break-glass CLI, stated plainly in the documentation. The enforceable invariant is: at least one **local** `ORGANIZATION`-scoped account with a **verified** MFA factor exists at all times, checked at the database and re-evaluated on every authentication-settings change, role revocation and account disable | "Local admin cannot be disabled while it is the only working method" was one of two *mandatory mitigations* justifying runtime-configurable IdPs, and cannot work: configure any second provider and local login is no longer "the only" one; and "working" is not decidable — a provider that passed a test at 14:00 fails at 14:05 on a certificate, a tenant policy or a group membership the application cannot observe. A point-in-time assertion was sold as a continuous invariant | The honest statement ("misconfiguring SSO can lock you out; recovery needs host access") is less reassuring than the deleted claim, and is the one an operator can act on | `02-…` §1.2.1 |
| D-142 | Every outbound request to an administrator-configured destination goes through one shared client: RFC1918/loopback/link-local/IPv6-equivalents denied by default behind an explicit audited "allow private networks" setting, resolve-then-pin against DNS rebinding, no redirects, hard timeouts, response size cap, and **no response body, status or distinguishing error returned to the client** | Four admin-controlled server-side fetch surfaces exist — OIDC discovery, SMTP test-send, backup destination endpoint, version check — and the words SSRF and egress appear nowhere in fifteen chapters. The settings page is otherwise an internal port scanner from inside the operator's network, and on a cloud host a path to `169.254.169.254` | A self-hoster with an internal Keycloak or SMTP relay must find and enable one setting, and the error will not say why. The setting's help text does; the alternative is a scanner enabled by default | `02-…` §1.2.2 |
| D-143 | Device mode is a property of an administrator-enrolled device or of the role, never of the session holder. v1 builds none of it: its effect comes from the Instructor role holding no export, bulk or administration permission at any scope, plus a short role-based idle timeout | D-009 was **opt-in by the party it restricts** — "a session *may be marked* `SHARED_DEVICE`" never said by whom — and the behaviour an instructor meets first, the shortened timeout on a wet tablet, is the one they disable. It was cited as *the* mitigation for two High risks and FM-13, so the strongest control in the poolside threat model was a self-declaration. `00-overview.md` §3.5.1 already cut it from v1; chapter 02 still specified it as active | An instructor who legitimately needs an export must ask an administrator. Since the poolside export is the exfiltration path the control exists to close, that is the intended outcome | `02-…` §1.3 |
| D-144 | `RoleAssignment` carries `validFrom`, `validUntil?` and `grantedByPersonId`; `validUntil` is schema-mandatory for `SESSION` scope; expiry is evaluated inside `requirePermission` and `resolveReach`, never by a cleanup job | Two decisions already depended on expiry that the tuple could not express: D-052 requires "a mandatory expiry after which it lapses", §2.4 lists the external examiner as "always with an expiry". As specified, the examiner who assessed one Saturday in March keeps `exams.assess` and `exams.results.record` on that session forever — and because results are append-only (D-062), an amendment years later becomes the effective result | Two more columns on the tuple every guard reads, and an end date must be chosen for grants that feel permanent. Instructor and administrator grants may leave it null; the bounded-window scopes cannot | `02-…` §2.1 |
| D-145 | Coverage is per **relation**, not per entity, and every membership-derived coverage is evaluated live: `GROUP` requires an active `GroupMembership` **and** an active `InstructorAssignment` at query time, and returns identity basics plus *that group's* progress and attendance only. A student's profile is governed by their **home** unit; a group's unit governs that group's records only | "The students in it *for the period of their membership*" is ambiguous exactly where it matters, and in a union-of-grants model over an append-only membership table (D-059 keeps those rows for life) the natural implementation means every instructor who ever taught a child keeps read access to their complete record permanently. Separately, a child registered at Zuidbad attending a summer course at Noordbad was fully reachable by both Location Managers, because a union always takes the broader answer | Coverage becomes a per-relation matrix rather than one sentence, and the student-detail screen renders partially for a `GROUP`-scoped instructor. Both were inevitable the first time anyone asked why an instructor could read a diploma history | `02-…` §2.2 |
| D-146 | `SELF` is an explicit seeded role assignment with a closed, enumerated permission set — own person, own student profile, own progress, own attendance, own awards, own consents. Never medical, never notes, never anything about another person | `SELF` was granted "to every authenticated person, **implicitly**". An implicit scope match means `requirePermission('students.medical.read', {student: self})` can pass for an authenticated person holding no grant at all — deny-by-default defeated by a rule in the same document | Account creation seeds a role assignment. Adding to the `SELF` set becomes a reviewed security change, like adding to the high-risk set | `02-…` §2.2 |
| D-147 | `Reach` is an opaque branded discriminated union with one variant per scope type plus `NONE` and `UNION`, constructible only by `resolveReach`; `all: boolean` is removed in favour of an `ORGANIZATION` variant only an organisation-scoped grant can produce | The old shape `{units, groups, all}` represented two of six scope types. A `COURSE`-scoped internal examiner or a `SESSION`-scoped aftest assessor resolved to empty reach, so the candidate list they are standing there to assess is blank — and the fix at 17:00 on an exam Saturday is `{all: true}`, on the path D-031 calls the highest-risk in the application. D-031's claim that a required argument "turns a silent over-fetch into a type error" enforced *presence*, not provenance: the literal was writable anywhere | A genuinely new scope type becomes a compile error in every repository at once. That is the point: the alternative is a repository silently ignoring a variant it does not know | `02-…` §2.3 |
| D-148 | One **protected free-text class** — medical remarks, pastoral/safeguarding notes, assessment remarks and `Inquiry` free text — all encrypted under the D-096 envelope, audited on **read**, excluded from exports by default and never logged, regardless of which permission pair gates each one. Two pairs are kept, not folded into one. Every field in the class carries a non-dismissable purpose/retention line at the capture point | D-010 says medical/pastoral notes have "their own permission **pair**", singular; the catalogue defines **two**, and §5.3 named only medical remarks as special category. Pastoral notes fell in the gap: gated by an ordinary-looking `students.notes.*` a Location Manager hands out without thought, plausibly unencrypted, unaudited, in every export and every backup. *"Moeder zit in de opvang"* is more sensitive than an allergy | Folding pastoral into `students.medical.*` (the reviewer's recommendation) would mean the instructor who must know about a child's epilepsy also reads the note about the family — a *reduction* in least privilege. Protection now tracks the data, not the permission pair, and the pairs stay separate | `02-…` §2.5 |
| D-149 | Audit integrity has three parts: chain verification exposed via `audit:verify` and the diagnostics page; a separate database role with `INSERT`-only grant on `AuditEvent` and `UPDATE`/`DELETE` revoked; and a hard retention floor the settings layer refuses to cross, with any lowering audited at high severity | "Append-only, never deleted by application code" is a statement about intent. The template's hash chain makes tampering *detectable* — nobody was checking — and one database role served everything, so a compromised administrator exports the member base and deletes the four rows recording it, or lowers audit retention to one day and lets the maintenance job do it legitimately. The three Article 33 questions (D-128) are all answered from this trail | A second connection with different grants; an operator on a managed database creates two roles rather than one. The documentation already owes exact statements for D-116 | `02-…` §3.2 |
| D-150 | Every setting is classified `free`, `bounded` or `invariant` in its own schema. `bounded` carries hard floors/ceilings that `settings:reset` also respects (session idle ≤ 8 h, audit retention ≥ 12 months, rate limits ≥ a minimum, backup retention ≤ the shortest special-category retention). `invariant` is not editable at all and has no override flag — the MFA mandate, reach filtering, audit append-only, the `SELF` permission set | `13-…` §3.2 puts "password policy, session timeouts, rate limits" in a live-editable Security category and never said which are load-bearing. If "MFA mandatory for the high-risk set" is one of them, the mandate is a checkbox the account it protects can clear; if it is not, that was stated nowhere. R-13 calls MFA "not optional" and nothing enforced that | An operator with a legitimate reason to exceed a bound changes code, not a setting. A real cost for a self-hosted product, and correct for a list this short | `02-…` §4.1 |
| D-151 | Guardian authority expires at the age of digital consent, derived from `Person.dateOfBirth` against a configurable setting (NL: 16) and evaluated at read time. Affected consents are marked **requiring re-consent** and surface in the privacy queue | A swim school's eight-year-olds become sixteen inside the retention window. Parental authority lapses by operation of law, not by a `validTo` someone remembered to set, so the `ON_BEHALF_OF` record stays apparently valid indefinitely. It is a computed condition over one column and a date — the cheapest control in the section and the most predictable consent failure in this domain | The organisation acquires a re-consent queue it did not have on paper. It had the obligation on paper; it could not see it | `02-…` §5.4 |
| D-152 | `withdrawnAt`/`withdrawnByPersonId` are valid only where `legalBasis = CONSENT`, enforced as a schema constraint. Objection under Art. 21 is a separate `ProcessingObjection` event. Every consent purpose declares its **withdrawal cascade** where the purpose is defined | The model permitted `legalBasis = CONTRACT` with a populated `withdrawnAt` — the exact thing §5.4 spends its length arguing must not happen — and the retention logic would either treat it as consent withdrawal or ignore it, undetectably. And withdrawal had no stated consequence anywhere: F-04 deletes photos "on erasure", while withdrawal of photo consent is the far more common event | The reviewer's third table (a separate `ProcessingBasis` register) is **not adopted**: `01-domain-model.md` §5's `lawfulBasis` column (D-110) already is that register, and D-134 forbids a second home for one fact | `02-…` §5.4 |
| D-153 | The Article 15 export **refuses** rather than omits when any in-scope class is unreadable by the requester; redacts third parties by default, per relation; reuses the erasure preview showing "about the subject" and "about other people" separately; and ships a generated annex of recipients, retention periods and source | Medical data was omitted unless the *requester* held `students.medical.read`, but the entitled party is the **data subject** — so a member administrator produced an export that looked complete, was delivered as the organisation's Article 15 response, and silently lacked the health data. The export also disclosed guardian details, instructor names and audit actor ids with no preview, while erasure next door mandates one. Art. 15's recipients/retention/source requirements were unaddressed and are all derivable from the `RetentionPolicy` table | A member administrator can no longer fulfil a subject access request alone. Not a regression — they could not fulfil one correctly before; now they find out | `02-…` §5.5 |
| D-154 | `AuditEvent` is an **enumerated, justified exemption** in the D-014 erasure registry, not an absence from it. The registry gains two entry kinds — `erase` and `exempt(ground, until)` — and the completeness test asserts every `Person`-referencing table has one of them | D-014 requires every table referencing `Person` in the registry with a completeness test; `AuditEvent` references `Person` and is simultaneously append-only and never deleted. Both cannot hold: either erasure mutates the append-only accountability record, or the table is silently exempted from the mechanism that exists to prevent forgotten tables — and **the test as described would fail on a correct implementation**. The ground is Art. 5(2) accountability, supported by Art. 17(3)(e) where a dispute exists | The erasure report gets longer and less satisfying: the subject is told what was kept and why. That is the requirement | `02-…` §5.5 |
| D-155 | `ANONYMISE` means destroying the row-level record and retaining only a **pre-computed aggregate** at a granularity that cannot be reduced to an individual — no identifier, no foreign key, no timestamp finer than the window, small counts suppressed. A class that cannot meet this may only be `DELETE` or `REVIEW` | §5.6 argues at length that pseudonymisation is not anonymisation, and the retention table two chapters away then prescribed `ANONYMISE` for attendance: strip `studentProfileId`, keep `sessionId` and timestamps, against twelve-child groups with retained time-bounded memberships and known session dates. Re-identification is a join and a counting argument. The design re-created the error it had just refuted and would have told a parent their child's attendance was anonymised | Some classes lose the option that sounded like a compromise. Attendance already moved to `DELETE` (D-111) on this reasoning, independently | `02-…` §5.6 |
| D-156 | `diagnostics.read` exists, is `ORGANIZATION`-scoped, and the diagnostics page is authenticated always. Its "safe to paste into a public issue" property (no secrets, no PII) is kept — pasteability and authentication are independent properties | The page names no permission and the catalogue had no key. It reports version, migration state, backup posture and *whether a newer release with a security advisory exists* — a machine-readable answer to "is this instance exploitable?" for anyone scanning for instances, and F-17 already names unpatched instances as the biggest residual risk. Whether it is reachable unauthenticated was never stated either way, which is the actual defect | One more permission to grant before a volunteer can produce the artefact a support issue asks for | `02-…` §2.5 |


---

# 10 — Findings: Gaps, Inconsistencies, Security Risks, Scalability Problems


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The brief explicitly asks for these. Each finding states what is missing or
wrong, why it matters, and what this design does about it.

## Missing requirements


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### F-01 — ~~`Person` is cross-organisation~~ **(dissolved by single-tenancy)**
**Status: closed.** This was the highest-severity finding in the original
design: `Person` spanned organisations and therefore could not use the
automatic tenant-scoping extension. With one instance per organisation
(D-012 revised) a person exists in exactly one database and the hole is gone.
The `assertPersonReachable` guard is no longer needed.

**Replaced by F-15** — the same *shape* of risk now lives one level down, in
unit- and group-scoped reach filtering.

### F-02 — **(Resolved into v1)** Consent for minors was not specified
**Severity: high.** The brief mentions consent but not that the overwhelming
majority of data subjects are children who cannot legally consent. A consent
record that only names the subject is useless for a minor.
**Response.** R-04: `PersonRelationship` carries an `authority` flag and validity
dates, every consent record references both subject and consenting person, and a
consent is valid only if the authority existed when it was given. Changes to the
relationship are audited. The guardian *portal* is deferred (P-04); the guardian
*authority model* is v1.

### F-03 — **(Resolved)** External examiners were not modelled
**Severity: medium.** Swim diplomas are frequently assessed by an examiner who
appears for one afternoon and is not a member of the organisation. A model
where assessment requires org membership either blocks the real workflow or
forces over-granting.
**Response.** D-052: `ExamAssessor` references a `Person` directly. If the
examiner records results themselves they receive an individual, expiring account
scoped to `exams.assess` / `exams.results.record` only — never a shared login,
because attribution on a child's diploma outcome is exactly what must not be
lost.

### F-04 — Photographs of minors were not called out
**Severity: high.** "Afbeeldingen" appears in the branding list, but the real
risk is class-list photos of children: personal data, biometric-adjacent, and
the field most likely to be added casually.
**Response.** Consent-gated; EXIF stripped; served through an authorising
route, never a public bucket path; suppressed in `SHARED_DEVICE` sessions for
non-assigned groups; deleted on erasure.

### F-05 — **(Closed)** No Data Processing Agreement is mentioned
Self-hosting removes the processor relationship: the organisation is both
controller and operator, and we never touch their data. The formulation now used
in `02-security-privacy.md` §5.1 replaces the earlier flat claim that no DPA is
needed: *"The project receives no personal data from your installation and
performs no processing on your behalf. Whether any agreement is required between
you and any party is your assessment to make with your own advisor."* Stating
the conclusion was itself the legal advice F-27 forbids (F-126). The
organisation still needs its own privacy notice and, where it
uses sub-processors (hosting, email), its own agreements — which the
documentation should point out without pretending to be legal advice.

### F-06 — **(Revised)** Retention and erasure conflict was resolved wrongly
**Severity: high.** Exam results are retained ~10 years; a data subject may
demand erasure. Both cannot be satisfied literally.
**Original response was wrong, twice.** It treated pseudonymisation as if it
ended the obligation — it does not, a pseudonymised record is still personal
data while re-identification is reasonably possible — and it assumed the
existence of a diploma creates an Article 17 exception, which it does not.
**Correct response.** D-065: retention is policy-driven, per data class, with an
explicit lawful basis and expiry action. An erasure request deletes or genuinely
anonymises everything with no live retention ground; where a ground exists the
record is kept *with that ground recorded* and the data subject is told what was
kept and why. Where a certificate number remains looked-up-able, the privacy
notice must say **pseudonymised, not anonymous**.

### F-07 — Backups are in GDPR scope and were not addressed
**Severity: medium.** Erasure cannot practically reach historical backups, and
a 12-month backup retention can silently outlive a shorter data retention
policy.
**Response.** Documented in `07-operations.md` §2: privacy notices state that
erased data persists in backups until they age out, backups are only restored
wholesale and never mined, and backup retention is reviewed against the data
retention policy.

### F-08 — No specified behaviour for a student who leaves and returns
**Severity: low-medium.** Common in practice; ambiguous in the brief. Reuse the
old `StudentProfile` (keeping history) or create a new one (clean slate)?
**Response.** Reuse the profile. The gap is modelled with `MembershipPeriod`
rows and a `StudentLifecycleEvent` (D-059), never a `leftAt` column or a second
profile: history is the product's value, a status flag destroys the answer to
"when were they a member?", and a second profile would fragment history and
duplicate PII.

## Inconsistencies in the brief


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### F-09 — "API-first where logical" vs "minimal amount of code"
Building a full REST API alongside a Server-Component portal means writing
every operation's surface twice.
**Response.** Resolved by making **application services** the API-first layer.
The portal and any future HTTP API call the same services, so behaviour and
security cannot diverge, and no HTTP endpoint is written until an integration
needs it (P-01). "API-first" becomes an internal design property rather than a
speculative endpoint inventory.

### F-10 — "Publieke website" vs "privacy by default"
A public site and a database of children's data in one application is inherent
tension, and single-tenancy does not reduce it — the public site and the
student records now live in the *same* database by definition.
**Response.** D-017 — the public surface has no code path to person tables. The
tension is resolved structurally rather than by care.

### F-11 — "Lucky develops autonomously" vs "least privilege"
An agent with full development-lifecycle rights is a powerful principal.
**Response.** D-025 — the boundary is *absent credentials*, not instructions.
Lucky has no production path, no secrets, no real data, and workflow files are
outside its write scope so it cannot weaken its own CI.

### F-12 — The existing SplashTrack repo contradicts the brief's own requirement
The brief demands a Person/Account separation; the prototype has a single
`User` model plus `Student`. This is one of the concrete reasons D-001 rebuilds
from the template rather than evolving the prototype.

## Security risks


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| Risk | Severity | Mitigation |
|---|---|---|
| **Scope escape on a list query** (instructor sees students outside their groups) | High | Reach is a required repository argument (D-031); scope-escape tests per module (D-032). *This replaces cross-tenant read as the top internal risk* |
| Public page leaks person data | High | D-017 — no code path exists |
| **Release-pipeline or dependency compromise** | High | F-18 — pinned deps, audit gate, signed images, SBOM, provenance, tag-only release workflow |
| Stored XSS via CMS content | High | Closed token set (D-016); server-side sanitisation on save *and* render; no arbitrary HTML/JS |
| Shared tablet left unlocked | High | `SHARED_DEVICE` mode (D-009) |
| Health data in a backup leak | High | Column encryption (D-013) + encrypted backups |
| Org admin bulk-exports and leaves | Medium | Step-up, rate limit, high-severity audit event visible to the org |
| Operator runs an unpatched version | High | F-17 — advisories, in-app version warning, never-stranded upgrade path |
| Prompt injection via GitHub issue text | Medium | D-025; human-reviewed PR is the only output channel |
| Raw SQL bypassing reach filtering | Medium | Lint flag on `$queryRaw`/`$executeRaw`, explicit reviewer sign-off |
| Third-party font/CDN leaking visitor IPs | Low-medium | Self-hosted curated fonts only |
| User enumeration on public forms | Low-medium | Uniform responses, rate limits, writes go to `Inquiry` not `Person` |

### F-13 — **(Revised)** We cannot patch what we do not operate
**Severity: high, and unfixable by design.** Self-hosting means a vulnerable
instance stays vulnerable until its operator upgrades. We have no fleet to
patch — that was the point — but the residual risk is real and lands on
schools with limited IT capacity.
**Response.** Everything we can control, we do: safe defaults, no default
credentials, automatic migrations, one-command upgrades, plain-language release
notes, published security advisories, and an in-app warning when the running
version has a known advisory (D-034). Beyond that it is the operator's duty,
and the documentation must say so plainly rather than implying we have their
back.

### F-14 — **(Closed)** Fleet-operator threat model
No principal has access to any customer instance, because no such access
exists. Closed by D-012 (final).

### F-15 — Scope filtering has the same failure mode tenancy did
**Severity: high — the highest-severity internal risk in the product.** The
isolation problem did not disappear when multi-tenancy did; it moved down a
level. An instructor must not browse another location's students, another
group's students, or a student outside the session they are assigned to. That
is now enforced by **scope filtering**, which has *exactly* the same failure
mode tenant filtering had: a missed `where` clause silently returns too much.
It fails open, it fails quietly, and no user reports it because nothing looks
broken.
**Response.** The tenancy tests are not simply deleted — they are **replaced**:
reach is a required repository argument (D-031), reach may only be constructed
by `resolveReach()` (D-030), and scope-escape tests are mandatory per module
(D-032). The minimum content of that suite — including the **list** case,
which is the one that must never be dropped — is specified in
`06-delivery.md` §2.1.

### F-16 — **(Closed)** Per-customer cost floor
Hosting cost is the organisation's own. Closed. It reappears only if a hosted
offering is ever added (OD-14).

### F-17 — Outdated self-hosted instances are the biggest residual risk
**Severity: high.** The realistic failure is not a clever attack; it is a swim
school running version 1.0 three years later, unpatched, on a server nobody
maintains, holding children's health data.
**Response.** The version check with advisory warning (D-034); an upgrade path
that never strands a skipped version; migrations that survive long gaps; and
documentation that treats upgrading as a routine operational duty rather than a
project. Consider an explicit end-of-life policy per major version.

### F-18 — Supply-chain compromise now ships to every operator
**Severity: high.** A malicious dependency or a compromised release pipeline
propagates to every organisation that pulls the image, and they trust it
because it is the official artifact.
**Response.** Pinned dependencies and lockfile; Dependabot with a blocking
audit gate; multi-stage builds with a minimal final layer; signed images with
provenance attestation; published SBOM; releases built only from a tag on
`main` by a workflow no contributor — including Lucky — can modify.

### F-19 — A public repository makes leaked secrets permanent
**Severity: medium-high.** In a private repo a committed secret is a rotation
task. In a public one it is scraped within minutes and lives in forks and
mirrors forever.
**Response.** Secret scanning with push protection enabled before the repo goes
public; no real credentials in seeds, fixtures, examples or documentation; the
image generates its own secrets on first run so no example value is ever
plausible as a real one.

### F-20 — Public issues will contain other people's personal data
**Severity: medium.** Self-hosters debugging a problem paste logs, screenshots
and database rows. Those will contain student names.
**Response.** Issue templates warn explicitly and ask for redaction;
maintainers redact on sight; the application's own logs are PII-free by design
(`07-operations.md` §1.1), which makes an accidental paste far less damaging.

### F-21 — "Open source" is not yet a licence decision
**Severity: medium (commercial).** The brief says fully open source so any
party can download and use it. That is a direction, not a licence. Permissive
(MIT/Apache-2.0) allows a competitor to run a paid hosted SplashTrack;
copyleft (AGPL-3.0) requires them to publish modifications.
**Response.** Flagged as OD-13 — a commercial decision, not a technical one,
and expensive to change after third-party contributions arrive.

### F-22 — Better Auth is a young dependency on a critical path
**Severity: medium.** Authentication is the one component where a maintenance
lapse or an unfixed vulnerability is immediately serious, and Better Auth is a
comparatively young project.
**Response.** Accepted deliberately, with three structural mitigations rather
than optimism: it is MIT-licensed and self-hosted, so it cannot be withdrawn or
paywalled; the database schema is **ours** (`UserAccount`, `Account`, `Session`
are our tables, not a vendor's), so data survives any replacement; and every
call site goes through our own `identity` module, so substituting the
implementation is a contained refactor. Additionally: pin the version, watch its
advisories explicitly, and treat an auth dependency bump as a security-reviewed
change rather than a routine one.

**The alternative was examined and rejected** — see D-008. Writing our own
authentication would trade a bounded dependency risk for an unbounded
implementation risk, in public source, on data about minors.

### F-23 — The backup download is a complete exfiltration primitive
**Severity: high.** One click produces a file containing every person, every
medical note and every exam result in the organisation. It is more dangerous
than any individual data screen, and it is easy to treat as a mundane admin
convenience.
**Response.** D-042 — step-up re-authentication, rate limiting, high-severity
audit event, short-lived single-use signed link, and the archive encrypted at
rest so the artefact is inert without the recovery token (D-040).

### F-24 — Losing the recovery token makes backups permanently useless
**Severity: high (operational).** The token is `SECRET_KEY`. Without it the
backup cannot be decrypted and the encrypted columns inside it cannot be read.
There is no reset — that is the point of encryption, but it is a foot-gun aimed
directly at a volunteer administrator.
**Response.** Shown once at setup with an explicit print step and a required
"I have stored this" acknowledgement; re-displayable later under step-up
authentication; surfaced in diagnostics as an acknowledged/not-acknowledged
check; and stated plainly in the installation documentation next to the backup
instructions rather than buried in a security appendix.

### F-25 — "Old backups still restore" fails silently and late
**Severity: high.** This is the promise most likely to be broken by accident,
because breaking it produces no symptom at development time. Someone squashes
migrations to tidy up, or strengthens the encryption scheme, and nothing fails —
until an operator restores a two-year-old backup and either gets an error they
cannot act on, or worse, a database that restores cleanly with unreadable
contents.
**Response.** Three structural commitments rather than vigilance: D-047 (CI
restores every supported release into `HEAD` on every PR), D-048 (never squash
within a major; declare `minimumRestorableVersion`), D-049 (versioned encryption
envelopes with retained legacy decryptors). The encryption case is the nastiest,
because it passes every schema check — it is called out separately for that
reason.

### F-26 — Unused multi-tenant machinery would have been left dormant
**Severity: medium.** The plan was to simply not use the template's tenant
scoping, platform settings and platform roles. Dormant security code is worse
than absent security code: it is attack surface, it must be kept compiling
through every migration, and it teaches the next reader that something is being
enforced when nothing is.
**Response.** D-056 — it is removed at extraction time, not disabled. Accepting
the resulting divergence from the upstream template is the cost.

### F-27 — Retention defaults must not masquerade as legal advice
**Severity: medium.** Shipping retention periods that look authoritative invites
an organisation to adopt them without deciding anything, which leaves them
unable to justify their own processing under Article 5(2).
**Response.** Every default is presented as a **proposal requiring confirmation**
in the setup wizard and the privacy admin area, with the lawful basis field
empty until the organisation fills it. The documentation states the roles
(D-064) and the questions, and explicitly declines to answer them.

### F-28 — The relicensing window closes at the first external contribution
**Severity: high, and time-bounded rather than technical.** The licence was
changed from GPL-3.0 to AGPL-3.0 on 2026-09-01 (D-067). That was only possible
because every commit in the repository traced to a single rightsholder. **The
moment one genuine third-party contribution is merged, the licence is frozen**
unless that person agrees to a change — and in practice contributors disappear,
so "frozen" means permanent.

The design had treated the licence as an open question (OD-13) while the
repository had in fact been carrying GPL-3.0 the whole time, and had already
accepted pull requests. The gap between "we will decide this later" and "this is
already decided, wrongly, and is about to become unchangeable" was invisible
because nobody looked at the repository root.

**Response.**
1. `CONTRIBUTING.md` ships with a **DCO sign-off** requirement (`Signed-off-by:`
   on every commit), enforced by a CI check, **before** the repository invites
   contributions. The DCO does not permit relicensing on its own — it records
   provenance and the right to contribute. It is what makes the contributor
   history auditable if a future licence question ever arises.
2. The `AGPL-3.0` header and the licence file are treated as part of the release
   artefact and checked in CI, so a future refactor cannot quietly drop them.
3. **Generalised lesson, worth more than this instance:** a design document that
   opens a decision must first check whether the decision has already been made
   somewhere in the repository. Several other entries in `08-open-decisions.md`
   deserve the same test — an open decision that is silently already implemented
   is more dangerous than an unmade one, because nobody is looking for it.

## Scalability problems


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Covered in full in `07-operations.md` §4. Scale is defined **per installation**
(`00-overview.md` §4.2), not across organisations. Two risks bite first:

1. **Derived progress state.** The group skill matrix (30 students × 40 skills)
   computed from an append-only log is still the first query that will be
   measurably slow, even in a small instance. The materialised summary is
   designed but deliberately not built (D-005).
2. **Audit and attendance table growth.** The two fastest-growing tables within
   an installation. Partitioning plus retention rotation is the answer, and the
   retention policy doubles as the growth control.

Neither justifies added complexity today. Knowing the answer is the deliverable
at this stage; building it would be exactly the premature complexity the brief
warns against.

## Assessment, fees and the v1 re-cut


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Raised while closing the gap between the design and what the domain expert
actually described (`15-assessment-and-fees.md`, `00-overview.md` §3.5).

### F-40 — *Aftesten* — the four-eyes gate on exam entry — was absent from the design entirely
**Severity: high.** The word *aftest* did not appear once in `docs/design/`,
and neither did *NRZ*. The entire assessment budget went to the exam (D-052,
D-054, D-062, `ExamAssessor`, `Certificate`, `04-ux.md` §4.4), but in the
process actually used the exam is the formality: a child reaches it only
because a **second, qualified instructor who is not their own** graded every
requirement and found all of them at least *voldoende*. `ExamResult.outcome` +
`remarks?` was the only assessment detail in the schema.
**Response.** `15-assessment-and-fees.md` §2–§3: a versioned criterion
catalogue, an ordinal grade scale, graded per-criterion results, recorded
waivers, `PersonQualification`, and D-085 making the gate a domain invariant
on `ExamCandidate → CONFIRMED` — overridable only with an explicit permission
and a recorded reason.

### F-41 — The independent assessor cannot read the student under the current authorization model
**Severity: high.** The assessor conducting an *aftest* is by definition not
the child's instructor and therefore holds no `GROUP` grant covering them.
Under D-030/D-031 they cannot read the student at all, which makes D-085
unimplementable as the security model stood. The same hole blocked a
substitute instructor, the receiving instructor of a make-up lesson and the
visiting delegate.
**Response.** Resolved in `02-security-privacy.md` §2.1–2.2 as `SESSION`
participation reach (D-068), replacing the `EXAM_SESSION` scope of D-054.

### F-42 — Two criterion catalogues were being specified for the same concept
**Severity: medium.** `Skill`/`SkillRequirement` (`01-domain-model.md` §3.3)
is "criteria per level, assessed per student"; `SchemeCriterion` is the same
thing with an ordinal grade instead of a four-state enum. Shipping both
guarantees divergence — not by anyone's decision, but because a criterion gets
added to whichever catalogue the current screen writes — after which "what
does Diploma A require?" has two answers and two seed catalogues to maintain.
**Response.** D-084 collapses them: `SchemeCriterion` is the single catalogue,
`SkillProgress` is the informal per-lesson log referencing a criterion, and
`AssessmentCriterionResult` is the formal graded observation. This **reduces**
the `skills` module rather than doubling it.

### F-43 — `Certificate` named two different things in the same domain
**Severity: medium.** The schema's `Certificate` means "the physical proof of
a diploma". In this domain a *certificaat* is a **different award with weaker
requirements** — a distinct thing a child is assessed for. One word, two
meanings, one of them already modelled.
**Response.** D-082: rename to `Award`; `AwardType.kind ∈ {DIPLOMA,
CERTIFICATE}` carries the distinction. A rename in a design document today;
after the first release, a migration through every issued diploma row.

### F-44 — The NRZ criteria and thresholds are unverified, and blocking
**Severity: medium, and blocking for one deliverable.** Chapter 15 specifies
the *shape* of the scheme catalogue. Its **contents** — the concrete NRZ
criteria, codes and thresholds — are not confirmed, and were not verifiable in
the sessions that produced this design.
**Response.** No catalogue may be seeded until the criteria are confirmed with
the domain expert. A seed containing invented swimming requirements would be
worse than an empty one, because it would look authoritative and would be
assessed against. `AssessmentScheme.source` and D-083's fork rule exist so
that the provenance of whatever is eventually seeded stays visible.

### F-45 — Fee tracking's first regret is reconciliation, and it is deliberately not in v1
**Severity: medium.** What kills a tracked-billing feature is not the absence
of a payment provider; it is someone marking 180 charges `PAID` by hand each
quarter from a bank statement in another window. That is worse than the
spreadsheet the school has today.
**Response.** Named in advance rather than discovered. The specific missing
piece is **CAMT.053 / MT940 import with reference matching** — one uploaded
bank file, automatic matching on a structured reference in the charge, the
remainder queued for review. No payment provider, no PSD2, no bank API,
roughly a week. It is out of v1 and it is the **first** thing added after the
first full billing period.

### F-46 — Financial retention conflicts with person retention
**Severity: high.** D-066 defaults person retention to 24 months after the
last relationship ends; Dutch fiscal law wants administration kept seven
years. Adding `Charge`/`Payment` puts both rules on the same rows.
**Response.** D-092: register both tables in the D-014 erasure registry with
a financial retention ground, and **pseudonymise** rather than delete on
erasure. Without this the first erasure request either destroys the
bookkeeping or silently skips it, and which one is not discovered until an
accountant asks.

### F-47 — Adding money raises the value of a breach without changing the controls
**Severity: medium.** The database now holds children's health notes **and**
who owes money. Nothing about D-040 (encrypted backups) or D-042 (the export
as an exfiltration primitive) becomes wrong; both become more load-bearing.
**Response.** Recorded rather than mitigated, deliberately — the correct
controls were already chosen. This finding exists so that the change in stake
is stated when the money tables land, rather than discovered in an incident
report.

### F-48 — "Anonymise attendance to aggregate" was not anonymisation
**Severity: medium.** The retention default for attendance events was
`ANONYMISE` to aggregate. Stripping the student reference does not anonymise
here: a group holds around twelve children, `GroupMembership` is retained and
time-bounded, and session dates are known — so a join and a counting argument
re-identify a large share of the stripped rows. That fails the mechanical
anonymisation test in `02-security-privacy.md`, and describing it as
anonymisation in a privacy notice would be the false comfort D-065 exists to
prevent.
**Response.** D-111: delete expired attendance events. An aggregate may be
kept because it was **computed and stored**, never because a row was
stripped.

### F-49 — Pre-migration backups had no retention policy at all
**Severity: medium.** D-044 takes an automatic backup before every
migration — the right behaviour — and no rule anywhere said what happens to
it. A full copy of the database, including medical notes, therefore
accumulated once per upgrade and outlived every rule in the retention table.
**Response.** D-104/D-111 add it to `01-domain-model.md` §5 as a data class
with a real trigger and cap: deleted after the next successful start, at most
three retained, so that a bad migration discovered late is still recoverable.

### F-71 — `PersonRelationship` was defined twice with different fields, and consent validity depended on the difference
**Severity: high.** One definition carried `evidence?` and no `authority`;
the other carried `authority` and no `evidence`, sitting as a stray row in
prose outside any table. **Both fields are load-bearing** — D-063 requires
`authorityEvidenceId → PersonRelationship`, F-02 requires the `authority`
flag. An implementer picking the second definition never builds `evidence`,
and in a custody dispute the school can show a flag saying someone was
authorised and nothing recording how that was established — precisely the
false comfort D-063 exists to prevent.
**Response.** Merged into one row —
`type, fromPersonId, toPersonId, authority, evidence, validFrom, validTo?` —
with `evidence` **non-optional where `authority = true`**. The duplicate is
deleted.

### F-72 — The attendance entity had two names, and the aggregate boundary used the wrong one
**Severity: medium.** D-061 makes append-only superseding *events* a
data-integrity requirement, but the ER diagram, the §3.4 session row and the
§4 aggregate table all still said `AttendanceRecord` — the superseded,
mutable name, and exactly the three places a schema author copies from.
**Response.** All occurrences renamed to `AttendanceEvent`.

### F-74 — F-08's resolution contradicted D-059 in the sentence that resolved it
**Severity: medium.** F-08's response read "model the gap with `leftAt`" —
exactly the status column D-059 forbids, and for exactly the reason D-059
gives: a flag silently destroys the answer to "when were they a member?".
The text was written before D-059 existed and was never updated.
**Response.** D-059 wins; F-08 above now reads `MembershipPeriod` +
`StudentLifecycleEvent` and no `leftAt` appears anywhere in
`01-domain-model.md`.

### F-73 — Chapter 01 contradicted D-057 twice, in the same chapter
**Severity: medium.** §2.3 asserted *"One table, two module owners — planning
writes it, attendance reads it… This is the only shared table in the design
and it is deliberate"*, and §3.4's Notes column repeated it, while D-057 four
sections earlier says `sessions` owns `ScheduledSession`. The contradicted
text was the part a reader trusts, because it explains itself.
**Response.** Both rewritten to "owned by `sessions`; `planning` and
`attendance` are both consumers". The paragraph defending the shared table as
*deliberate* is deleted rather than softened.

## Platform hardening: secrets, crypto, backup and boot


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Raised while specifying `13-configuration-and-setup.md` and
`14-backup-restore-upgrade.md` in detail. Numbered F-95 onward to avoid
colliding with the F-40s above — both sets were drafted concurrently against
the same then-empty part of the register.

### F-95 — `SECRET_KEY` had four lifecycles and does not exist in the template
**Severity: critical.** Different sections of the design gave four mutually
exclusive accounts of the bootstrap secret's lifecycle — operator-supplied
env var, generated on first run, displayed by the wizard, and simultaneously
*being* and *wrapping* the recovery token — on the key that gates every backup
restore and every encrypted medical column. The template has no `SECRET_KEY`
at all: at-rest encryption derives from `BETTER_AUTH_SECRET`, which also
signs sessions and encrypts TOTP secrets, so identifying the two prints a
session-forging key on paper, and separating them silently kills every
restored TOTP enrolment while MFA is mandatory.
**Response.** D-112 states the lifecycle once, in `13-…` §3.1.1: one
bootstrap secret via `SECRET_KEY_FILE`, every other key derived by HKDF with a
purpose label, including the Better Auth signing secret so restore reproduces
it identically.

### F-96 — The backup archive could contain its own decryption key
**Severity: critical.** If key material lived under `DATA_DIR` and assets
were captured as a directory tree, the archive would ship with the key that
decrypts it — every claim that the file is "inert without the token, and
therefore safe to store casually" would be false, with nothing in CI to
detect it.
**Response.** D-113: the application never writes key material to the data
volume, the backup writer excludes the key-material path explicitly, and a CI
test asserts no shipped fixture contains it, by key bytes and by file name.

### F-97 — Restoring a `.stbak` from anywhere else is arbitrary SQL execution
**Severity: critical.** Restore replayed a `pg_dump` produced elsewhere,
against a database role that was conventionally the superuser, with no stated
least-privilege role or restore allow-list anywhere in fifteen chapters. The
attack is the documented recovery path itself: a stranger supplies a
"known-good starter backup" whose dump contains `CREATE FUNCTION` /
`COPY … FROM PROGRAM` / `ALTER ROLE`, and the verification step checked the
archive was *intact*, not *benign* — both the checksum and the manifest came
from the same attacker-supplied file.
**Response.** D-095 makes the v1 export a structured logical export the
application writes and reads itself, deleting the class rather than filtering
it. D-116 makes the database role non-superuser regardless. The chapter now
states plainly that an archive from any source other than the operator's own
instance is untrusted input.

### F-98 — Setup mode was keyed on one deletable row
**Severity: critical.** Setup mode resumed whenever the bootstrap record was
absent, and "New installation" then created an `ORGANIZATION`-scoped
administrator. Any primitive that deletes one row — SQL injection, a
compromised low-privilege credential, a botched restore, a bug in the erasure
transaction — put a populated production database holding thousands of
children's records into an unauthenticated administrative surface.
**Response.** D-099: setup mode requires no bootstrap record **and** zero
`UserAccount`, `Person` and `RoleAssignment` rows. Data with the bootstrap
record missing is `TAMPERED` — refuse to serve, log loudly, break-glass CLI
only.

### F-99 — The setup token went to the logs the design tells operators to publish
**Severity: critical.** The one-time setup token was printed to the container
logs, while the design elsewhere states as an assumption that self-hosters
debugging a problem paste logs into public issues — in a public repository.
Variants: Portainer/Synology/Unraid log panes visible to a household;
centralised log shipping to a third party; log rotation destroying the token
before setup finishes.
**Response.** D-101: write the token to `$DATA_DIR/setup-token` mode 0600 and
print only its path; single use, ≤60-minute expiry, reissued only from the
host; rate-limited with lockout and audited failures.

### F-100 — One key, forever, printed on paper, with rotation that made things worse
**Severity: high.** The recovery token *being* `SECRET_KEY` meant a single
non-revocable secret protecting the backup archive, every medical column and
every stored credential — re-displayable in the UI. Rotation was worse than
useless: re-encryption cannot reach `.stbak` files already written, so
afterwards the operator holds two permanently critical secrets and every
historical archive stays unprotected by the new key. No entropy floor was
stated, and the restore endpoint had no rate limit.
**Response.** D-114 (two-level envelope: an Argon2id passphrase over a master
key, per-archive data keys, rotation = re-wrap) and D-115 (≥128 bits,
Crockford base32 with a check character, re-display audited at high severity
and notified to all administrators, restore endpoint rate-limited and
audited).

### F-101 — The `v1:` envelope had no key id and no AAD, and GCM was assumed to stream
**Severity: high.** Three defects with the same root — the crypto was
described rather than specified. No key id: an interrupted rotation leaves two
keys in one column with no discriminator, every failed decrypt
indistinguishable from corruption. No AAD: a ciphertext blob is portable, so
any careless write can move child A's encrypted allergy note into child B's
row, where it decrypts and authenticates perfectly. Streaming: plain
AES-256-GCM over a multi-gigabyte archive either buffers the whole thing or
encrypts chunks independently, in which case truncation, reordering and
splicing all verify, and the manifest was parsed before the archive was
authenticated.
**Response.** D-096 (`v1:<keyId>:<nonce>:<ct>` with AAD over
`(table, column, pk, keyId)`), D-097 (one envelope module with a decryptor
registry plus committed golden vectors), D-102 (framed AEAD with
sequence-bound chunks and a final-chunk marker; manifest authenticated as its
own message before any parsing).

### F-102 — Chapter 03's "non-negotiable properties of the image" were false
**Severity: high.** The stated list inverted chapter 13 ("all configuration
via environment variables") and contradicted D-055/D-044 ("migrations run
automatically on start"), and none of the six claimed image properties held
against the actual Dockerfile: single-stage, undigested base image, dev
dependencies and full source tree in the final layer, running as root;
`pg_dump` absent although claimed present.
**Response.** The list is rewritten as target properties with current status
stated honestly. The configuration bullet now reads "bootstrap secrets only;
all runtime configuration is database-backed" (D-036/D-037); the migration
bullet points at D-055/D-098; D-116's non-superuser role is added alongside
"runs as non-root".

### F-103 — Scheduled remote backup was an unguarded exfiltration channel
**Severity: high.** D-042 wraps the backup **download** button in step-up,
rate limiting, high-severity audit and a single-use signed link — while a
backup **destination** setting sat beside it as an ordinary text field. A
departing administrator never touches the guarded button: pointing the
destination at their own bucket ships a complete copy of every person, every
medical note and every exam result, nightly. The destination did not even
exist in the codebase (`blob-storage.ts` supports only `"local"`).
**Response.** D-103: S3 destinations are out of v1 — mounted volume only.
When a remote destination arrives it carries the download's controls in full,
plus a 24-hour delay or second-administrator approval before the first backup
reaches a new destination, shown permanently on the dashboard.

### F-104 — Backup retention contradicts the erasure promise
**Severity: high.** `02-security-privacy.md` §5.3 commits, without
qualification, that special-category data is "hard-deleted, never
anonymised" at 12 months, while backup retention kept rolling and
pre-migration copies indefinitely on the same volume under the same
never-rotated key. A parent requests erasure, the school reports the medical
note deleted, and it is present in up to a dozen archives plus an unbounded
snapshot set.
**Response.** D-104: cap pre-migration backups (delete after the next
successful start, keep at most three); require backup retention ≤ the
shortest special-category retention or surface the mismatch as a diagnostics
warning; publish a computed **backup horizon** the organisation can quote in
its privacy notice, shown at the moment of erasure. §5.3's promise needs the
qualifier "from live storage; persists in encrypted backups until they age
out" — flagged for that chapter, not edited here.

### F-105 — D-038's worked example asserted the opposite of what the template does
**Severity: high.** The design claimed the template "already loads Entra
configuration at auth-context init, so changing a provider rebuilds the auth
context rather than the container". The template's own source comment says
the opposite: configuration is read once at construction and applies only on
the next restart, because `auth` is a module-level singleton across worker
processes and the OAuth plugin takes a static provider array.
**Response.** The claim is corrected, the mechanism that would actually work
is specified (a versioned `getAuth()` against a `settings_version` counter),
and D-106 marks the identity-provider case as **requiring a spike** before
D-038's no-restart promise is trusted for it.

### F-106 — Key rotation would silently un-enrol every administrator's second factor
**Severity: high.** The re-encryption command could re-wrap the application's
own envelopes but not Better Auth's internal TwoFactor secrets, which the
template encrypts with `BETTER_AUTH_SECRET` directly — rotating the key would
destroy every administrator's TOTP enrolment at once, while MFA is mandatory
for administrators, locking out exactly the accounts that could fix it.
**Response.** D-112's HKDF split brings TOTP secrets under the same root, so
rotation covers them, and D-105 adds a restore-matrix invariant asserting an
enrolled TOTP still verifies after a restore with the same token.

### F-107 — The restore matrix was unimplementable, empty at v1.0, and omitted the case F-25 called worst
**Severity: high.** D-047 named no fixture source, generator, key or storage,
and at v1.0 there are zero prior releases, so the matrix would ship green
while protecting nothing — yet fixture generation must ship in v1.0 or v1.1
can never test restoring from it. F-25 named the encryption case "the
nastiest" and it was the one left out of the test meant to cover it.
**Response.** D-105: the release workflow generates a fixture (boot the
just-built image, seed deterministically, back it up under a fixed public
test key, upload as a GitHub Release asset) and the matrix asserts, among
other things, every encrypted column decrypting to known plaintext and an
enrolled TOTP still verifying.

### F-108 — `zod` is not present in either repository
**Severity: medium.** The settings-registry design ("one Zod schema per
setting") and `05-technical.md`'s module template both assume the dependency
is inherited. It is in neither `package.json`, and there are no imports of it
anywhere.
**Response.** Stated plainly in `13-…` §3.2 as a build task rather than an
existing capability.

## The v1 re-cut: mis-scope, not over-scope


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Raised while closing the six-capability gap named in `00-overview.md` §3.5.

### F-80 — v1 was mis-scoped, not over-scoped
**Severity: high.** About 45% of specified effort went into a self-hosting
*product* — an identity-provider registry, a restore-from-every-release CI
matrix, a settings registry with a generated UI, a separate UAT environment,
a retention engine, a CMS, a versioned public API and a fifteen-check
pipeline — for an operator who does not exist. Meanwhile six capabilities
named as weekly needs were absent from the documents entirely, one of them
the single most consequential control in the domain.
**Response.** D-120. Both estimates are recorded, not just the new one
(`00-overview.md` §3.5.3). OD-2's closure is what makes the cut safe rather
than a gamble.

### F-81 — No breach-response capability at all
**Severity: high.** The controller must assess and notify within 72 hours
(Article 33) and notify data subjects for high-risk breaches (Article 34).
This is health data about children, so the Article 34 threshold is met by
default. The design shipped an audit trail and a list of metrics and stopped.
**Response.** D-128, R-37, `07-operations.md` §1.4. The third question — whose
data was in a leaked artefact — is answered honestly rather than solved: the
backup manifest holds row counts, not data subjects, so a leaked archive is
treated as covering **every** subject in the instance at that timestamp.

### F-82 — The design asserted CI capabilities that do not exist
**Severity: high.** The design claimed the template's CI "already runs …
container build, and a migration-against-populated-database job". The actual
`ci.yml` has three jobs — `verify`, `e2e`, `migrate-populated` — with no
container build, no `npm audit` gate, no CodeQL, no secret-scanning job and no
axe assertion anywhere in `tests/`. Of fifteen required checks, seven
existed. Compounding it, `deploy-uat.yml` builds at deploy time on the target
host — the direct inversion of D-022.
**Response.** Both chapters corrected in place (D-136). v1 ships eight
blocking checks, listed in one place so the two chapters cannot drift apart
again.

### F-83 — An application that will not load has no equivalent of a wet sheet
**Severity: high.** The design measured itself against another system; there
is none — the incumbent is a clipboard. Paper never has a zero-percent day. An
app that will not load shows nothing and the instructor has no move, and the
failure is not recoverable in the usual sense: when paper fails the
instructor blames the rain, when the app fails they go back to paper and do
not come back.
**Response.** D-129 — print fallbacks in the first release, and P-02's
"prepared, not built" is now explicitly conditional on them.

### F-84 — The attendance latency target was set without knowing about a lock
**Severity: medium.** `AuditEvent` is a hash chain whose appends serialize on
a Postgres advisory lock. Thirty attendance events plus thirty naively
chained audit rows per group registration serialize against a lock contended
by every other audit writer, under a p95 target written before the lock was
known about.
**Response.** D-126: one audit event per group registration, decided before
the load test is written, not after it fails.

### F-85 — The module-boundary lint rule does not catch the violation it exists to prevent
**Severity: medium.** `no-restricted-imports` catches cross-module *imports*.
The violation D-057 was written to prevent — a direct Prisma call into
another module's table — imports nothing and passes cleanly.
**Response.** D-125: boundaries enforced on Prisma model access, not only on
imports.

### F-86 — The WebAuthn RP-ID lockout sits on the expected deployment path
**Severity: medium.** Starting on something like `http://nas.local:3000` and
moving to a real domain later is the **expected** sequence for this
deployment, not an edge case, and passkeys — the design's best wet-hands
answer — are exactly the credential a domain change invalidates.
**Response.** D-132: RP ID set deliberately at setup, loud warning on change,
password + TOTP fallback retained per account.

### F-87 — The skill-matrix undo boundary requires an administrator for a mis-tap
**Severity: medium.** Two states existed: free undo before Save, and a
permissioned `skills.revoke` with a mandatory reason after it. A
`GROUP`-scoped instructor holds no `skills.revoke`, so a fat-fingered
achievement on a 30×40 grid with wet hands becomes an administrator's job,
weekly, by construction.
**Response.** D-131 — a bounded self-correction window on the instructor's
own sign-offs from the current session.

### F-88 — The Article 15 export discloses third parties and can silently omit health data
**Severity: medium.** Two defects in one surface: the export includes
guardian details, instructor names and staff-authored notes with no preview
and no redaction pass, while the erasure flow next door has a mandatory
preview; and medical data is omitted unless the *requester* holds
`students.medical.read`, when the entitled party in an Article 15 request is
the **data subject**, not the operator running the export — so a member
administrator can produce an export that looks complete and is silently
missing the health data.
**Response.** Reuse the erasure preview pattern for export, including what is
disclosed about third parties, and make the export fail loudly rather than
quietly omit (`04-ux.md` §4.6). The redaction pass and the
retention/recipients/source annex remain to be specified in
`02-security-privacy.md`.

### F-89 — Five decisions have no statement in any active chapter
**Severity: medium.** D-011, D-015, D-027, D-028 and D-029 existed only as
register rows, with their full text in chapters 11 and 12 — whose banners
forbid citing them as requirements — and three of the register's own "Where"
pointers named the wrong section.
**Response.** D-133: for a withdrawn or superseded decision the register row
is the authoritative text and says so. The register's pointers are corrected
at the same time.

### F-90 — Whether a digital pupil list exists has never been checked
**Severity: medium — and the cheapest open question in the set.** CSV import
has been described as what makes a pilot possible at all, but the incumbent
is pen and paper — if the school genuinely runs on paper there may be no
digital list to import at all.
**Response.** OD-16. A different question from OD-1: if both answers are
"nothing", R-29 and the import path leave v1 together.

### F-91 — D-048 was enforced by nothing
**Severity: medium.** "Migration chains are never squashed within a major
version" is the policy that keeps every self-hoster's old backup restorable,
and it was a sentence in a document with no test behind it.
**Response.** D-124: `tests/unit/migration-history-append-only.test.ts`.

### F-109 — No permission existed for assigning roles, and no anti-amplification rule
**Severity: critical.** (Reviewer A-1.) Grepping the active set, `roles.assign`
appeared only in `07-operations.md` §1.3's high-risk permission list and existed
in no catalogue. Role assignment is the highest-privilege operation in the
product, and `AccessGroup` (§2.7) bundles *permissions plus scopes* into one
assignable object. A `UNIT`-scoped Location Manager opens People & roles —
listed in `04-ux.md` §1 as an admin screen with no permission named — and
assigns themselves or an accomplice an `ORGANIZATION`-scoped role, or an access
group containing `students.medical.read`. They hold every medical note in the
school. Step-up re-authentication is required for role changes and is no
obstacle whatsoever: it is their own password and their own second factor. The
audit event records a legitimate-looking role change.
**Response.** D-139 (three invariants: no amplification, scope confinement,
window confinement — in the grant service, not the UI, tested per module) and
the catalogue additions in `02-…` §2.5: `roles.read/assign/manage`,
`accessgroups.read/assign/manage`. `roles.manage` is separated from
`roles.assign` because editing which permissions a role carries is strictly
stronger than assigning it.

### F-110 — An admin-configurable OIDC provider is an account-takeover primitive
**Severity: critical.** (Reviewer A-2.) The registry stores per provider an
issuer URL, a client id, an encrypted secret, a **claim→field mapping**, a JIT
toggle and a JIT role — guarded by "a permission-guarded admin screen" whose
only candidate permission was `organization.settings.manage`. Nothing stated how
an external identity binds to an existing `UserAccount`. A Planner or office
manager holding that one permission adds a free Keycloak tenant they control,
maps `email` onto the administrator's address, passes the mandatory test
connection against their own IdP, and signs in as instance administrator. MFA on
the local account is irrelevant — the local method is never used. Second attack:
edit only the token endpoint of an *existing* provider, leaving the secret in
place, and the application posts that client secret to the attacker on the next
login. A control that hides a secret from reads while allowing a redirect of
where it is sent is not a control.
**Response.** D-140, recorded as **preconditions** rather than v1 build items —
the registry is out of v1 (D-120), which is why the hardening is cheap now and
expensive later. Every clause is structural rather than procedural: link on
`(issuer, sub)` only, delete the JIT-role field rather than defaulting it to
none, clear the secret on any endpoint change, opt-in per account for
`ORGANIZATION`-scoped principals.

### F-111 — The lockout safeguard justifying runtime IdPs cannot be enforced
**Severity: high.** (Reviewer B-5.) "Local administrator login can never be
disabled while it is the only working method" was presented as one of two
*mandatory mitigations* for D-035. It is bypassed by configuring any second
provider — including the attacker's, per F-110 — after which local login is not
"the only" one and every check passes. And "working" is not decidable: a
provider that passed a test at 14:00 stops working at 14:05 through certificate
expiry, a tenant policy change, an admin removed from a group, or a discovery
endpoint the application can reach and users cannot. The test-connection gate
has the same shape — it proves the app reached the IdP once, not that a human
can log in through it.
**Response.** D-141. The claim is deleted, not softened. The real control is
already in the design and was not being credited: the break-glass CLI (§7 of
`13-…`), which depends on host access rather than a network-reachable secret.
The enforceable invariant that replaces it — at least one local
`ORGANIZATION`-scoped account with a verified MFA factor, checked at the
database — is re-evaluated on role revocation and account disable, not only when
SSO is switched on.

### F-112 — `resolveReach` had no shape for four of six scope types
**Severity: high.** (Reviewer B-6.) The signature returned
`{units, groups, all: false}`. An internal examiner (`COURSE`) and an aftest
assessor or external examiner (`SESSION`) both resolve to empty reach: every
list denies them and the candidate list they are physically present to assess is
blank. D-031 calls list filtering "the highest-risk code path in the
application", and the fix under time pressure is `{all: true}`. Separately,
D-031's claim that a required argument "turns a silent over-fetch into a type
error" was overstated: the compiler enforced *presence*, and
`{units: [], groups: [], all: true}` was a literal writable at any call site or
test helper.
**Response.** D-147 — an opaque branded discriminated union covering every scope
type, `NONE` explicit, `UNION` explicit, no `all` field, constructible only by
`resolveReach`. `06-delivery.md` §2.1 already requires asserting that a `Reach`
cannot be constructed outside the resolver; this is the shape that makes the
assertion possible. **One part of the reviewer's framing is rejected:**
`all: false` is default-*closed*, not "a default-open shape" — a forgotten field
denies. The two real defects (incomplete coverage, forgeability) are sufficient.

### F-113 — `RoleAssignment` could not express the expiry two decisions depend on
**Severity: high.** (Reviewer B-7.) The tuple was
`(personId, roleId, scopeType, scopeId)` with no validity fields, while D-052
requires "a mandatory expiry after which it lapses automatically", §2.4 lists
External examiner as "always with an expiry" and Internal examiner as
"time-bounded", and D-068 says the `SESSION` grant "carries its own
`validFrom`/`validTo`". As specified, the external examiner who assessed one
Saturday in March 2026 retains `exams.assess` and `exams.results.record` on that
session **forever**, and because D-062 makes results append-only, an amendment
they make years later becomes the effective result. Nobody at the school has any
reason to look at that assignment again.
**Response.** D-144. Note the enforcement detail: expiry is a predicate inside
`requirePermission` and `resolveReach`, **not** a cleanup job — a job that has
not run yet is an open grant, and a predicate cannot be behind schedule.

### F-114 — `GROUP` coverage was per-entity, permanent, and ambiguous in the sentence that defines it
**Severity: high.** (Reviewer B-8 and C-15, which are one defect.) Coverage read
"the students in it *for the period of their membership*" — which can mean the
instructor's access lasts during the membership, or that they may see records
dated within it. In a union-of-grants model over an append-only membership table
that D-059 keeps for life, the natural implementation is the second: **every
instructor who has ever taught a child retains read access to that child's
complete record permanently.** And because scope covers an *entity*, one
`students.read` opens `Progress · Attendance · Enrolments · Exams · Notes ·
Privacy` — every group she has been in, attendance at other locations, failed
exam attempts, guardian relationships. None of it is needed to teach a Tuesday
lesson. The cross-unit case compounds it: a child registered at Zuidbad
attending a summer course at Noordbad is fully reachable by both Location
Managers, because effective reach is a union and the broader answer always wins.
**Response.** D-145: live evaluation of both membership and instructor
assignment at query time; per-relation coverage with scope-escape tests
asserting on the **fields returned**, not only on row reachability; and the
home-unit rule for profiles versus the group-unit rule for that group's records.

### F-115 — Pastoral notes and public inquiry free text sat outside the protected class
**Severity: high.** (Reviewer B-9 and B-10, which share one root: protection
tracked the permission pair rather than the data.) D-010 promises medical and
pastoral notes "their own permission **pair**", singular; the catalogue defines
**two**, and §5.3 named only medical remarks as special category — so pastoral
notes were gated by `students.notes.*`, an ordinary-looking teaching permission,
plausibly unencrypted, unaudited and present in every export and every backup.
*"Moeder zit in de opvang"*, *"via jeugdzorg aangemeld"*, *"mag niet opgehaald
worden door vader"* is more sensitive than an allergy and may be special
category by inference. Separately and worse, `Inquiry` takes free text from an
**unauthenticated public form**, and in this domain the first message a parent
sends is very often *"mijn zoon heeft epilepsie…"*. Inquiry reach was
instance-wide, D-013 covered `students` columns only, D-010's audit rules
covered `students.medical.*` reads only, and the table lives in the `pages`
module — so the Content Editor, whose catalogue entry says in bold "**No person
data**", would have been given health data about named children by module layout
alone.
**Response.** D-148 defines one protected free-text class over four fields
(medical, pastoral, assessment remarks, inquiry text), all encrypted under the
D-096 envelope, audited on read, export-excluded by default. `inquiries.read`
and `inquiries.manage` are added to the catalogue and explicitly excluded from
the Content Editor bundle. **The reviewer's recommended fold of pastoral into
`students.medical.*` is rejected with reasoning** (see §3). The most valuable
part is the cheapest: a purpose-and-retention line at the capture point, because
the real risk in a free-text field is what staff type into it.

### F-116 — Audit tamper-evidence rested on intent and one database role
**Severity: high.** (Reviewer B-13, partly overtaken.) "Append-only. Never
updated, never deleted by application code" is a statement about intent. Two of
the reviewer's three sub-claims were already answered by a later pass — the
template's `AuditEvent` **is** a hash chain (`05-technical.md` §5, D-126) — but
two gaps remained and both belong to the actor the trail exists to catch. One
database role serves the whole application, so a compromised administrator
exports the member base and deletes the four rows recording it, undetectably in
practice because nobody runs a verification pass. Alternatively they lower audit
retention to one day — audit retention is an organisation-configurable policy
under D-065 — and the maintenance job destroys the evidence legitimately.
**Response.** D-149: verification surfaced where a human sees it
(`audit:verify` plus a diagnostics line); an `INSERT`-only database role on
`AuditEvent`, which only means anything because D-116 already makes the
application role a non-superuser; and a retention floor enforced by the settings
classification (D-150). The related retention *mismatch* — audit at 24 months
against exam results at 10 years, so the record of who recorded a diploma
outcome dies eight years before the outcome — is a hand-off to `01-…` §5 and
`07-…` §1.2 (§4 below).

### F-117 — MFA verification was unthrottled, and the MFA mandate may have been a checkbox
**Severity: high.** (Reviewer B-16.) Rate limiting covered login, password reset,
export and public forms. It did **not** cover MFA/TOTP verification — a 6-digit
code without throttling is brute-forceable, and MFA is the stated compensating
control for the highest-privilege accounts in the product (R-13, FM-7) — nor
setup-token submission, recovery-token entry at restore, or the signed backup
link. Compounding it, `13-…` §3.2 puts "password policy, session timeouts, rate
limits" in a live-editable Security settings category without saying which
entries are load-bearing. If "MFA mandatory for administrators" is one of them,
the mandate is a checkbox that `organization.settings.manage` or
`splashtrack settings:reset` can clear; if it is not, that was stated nowhere.
**Response.** The §4 controls table now names all four endpoints and requires
**lockout with an audited failure event**, not merely rate limiting — an
attacker who is only slowed down still gets there overnight. D-150 classifies
every setting `free`/`bounded`/`invariant`, puts the MFA mandate in `invariant`
with no override flag, and gives `bounded` entries hard floors that
`settings:reset` also respects.

### F-118 — Four admin-controlled server-side fetch surfaces, no SSRF consideration anywhere
**Severity: high.** (Reviewer B-17.) OIDC discovery URL, SMTP test-send to an
arbitrary host:port, backup destination endpoint, version check. The words SSRF
and egress appear nowhere in fifteen chapters. A user with
`organization.settings.manage` points discovery at
`http://169.254.169.254/latest/meta-data/iam/…` and reads the error, or at
`http://10.0.0.5:9200/` — and the SMTP test turns the settings page into an
internal port scanner from inside the operator's network. The instance is
typically the only thing the school has exposed.
**Response.** D-142. The clause that matters most is the last one: never return
the response body, status or a distinguishing error to the client. An error
message that differs between "connection refused" and "timed out" is a scanner
regardless of what else is blocked.

### F-119 — Nothing handled a child reaching the age of digital consent
**Severity: medium.** (Reviewer C-2.) Guardian authority is recorded with
validity dates and nothing re-evaluates it when the subject comes of age. A swim
school's eight-year-olds become sixteen-year-olds inside the retention window;
parental authority to consent lapses by operation of law, not by a `validTo`
someone remembered to set, so the `ON_BEHALF_OF` record stays apparently valid
indefinitely.
**Response.** D-151 — derived from `Person.dateOfBirth`, which the model already
holds, against a configurable age-of-consent setting, evaluated at read time
like every other validity in the chapter. This is the cheapest control in §5 and
the most predictable consent failure in the domain.

### F-120 — Consent and lawful-basis registration were one table, so withdrawal and objection were conflated
**Severity: medium.** (Reviewer C-3.) `Consent.legalBasis` ranges over four
values with a `withdrawnAt` field, so the model permits
`legalBasis = CONTRACT` with a populated `withdrawnAt` — the exact combination
§5.4 spends its length arguing must not exist. The retention logic and UI would
either treat withdrawal of a contractual basis as consent withdrawal or ignore
it, and neither is detectable. Also missing: withdrawal had no stated
*consequence* anywhere. F-04 says photos are deleted "on erasure", while
withdrawal of photo consent is the far more common event.
**Response.** D-152: a schema constraint rather than a UI rule; objection as its
own event; and a declared withdrawal cascade per purpose. **The reviewer's
proposed third table is rejected** — see §3.

### F-121 — The Article 15 export could silently omit health data and disclosed third parties
**Severity: medium — extends F-88, which staged this for chapter 02.**
(Reviewer C-4.) Medical data is included only when the *requester* holds
`students.medical.read`, but the entitled party in an Article 15 request is the
**data subject**: a member administrator with `privacy.export` produces an
export that looks complete, is delivered as the organisation's Article 15
response, and is silently missing the health data. The mechanism converts a
permission boundary into a compliance failure with no signal. It also discloses
guardian details, instructor names on sign-offs, staff-authored notes and audit
actor ids — other people's personal data — with no preview and no redaction,
while the erasure flow next door mandates a preview. And Article 15's
requirements to state recipients, retention periods and the source of the data
were unaddressed.
**Response.** D-153. All three of the missing Article 15 elements are derivable
from data the design already holds, so the annex is **generated** rather than
typed and cannot drift from the `RetentionPolicy` table it describes.

### F-122 — Erasure versus the audit trail was unresolved on a compliance-critical path
**Severity: high.** (Reviewer B-12.) D-014 requires a registry containing every
table referencing `Person`, with a test asserting completeness. `AuditEvent`
records an actor person id and a target id — it references `Person` — and is
simultaneously declared append-only, never updated, never deleted. These cannot
both hold: either erasure nullifies the ids, destroying the accountability
record D-026 and the product thesis depend on while mutating an append-only
table, or `AuditEvent` is silently exempted from the registry whose completeness
test is the entire mechanism preventing forgotten tables. **The test as
described would fail on a correct implementation**, which is how this would have
been discovered.
**Response.** D-154 — two entry kinds in the registry, `erase` and
`exempt(ground, until)`, with the ground named in the registry file and
enumerated in the erasure report to the data subject. This generalises a shape
the design had already accepted as a one-off for `Charge`/`Payment` (D-092).

### F-123 — `ANONYMISE` was prescribed where genuine anonymisation is not achievable
**Severity: medium — and already half-corrected.** (Reviewer B-19.) §5.6 argues
correctly and at length that pseudonymisation is not anonymisation; the
retention table two chapters earlier then set attendance to `ANONYMISE` "to
aggregate" at 24 months, while student profiles, group memberships and session
records are retained for 24 months or longer. Strip `studentProfileId`, keep
`sessionId` and timestamps: a group holds twelve children, `GroupMembership` is
time-bounded and retained, session dates are known. Re-identification is a join
and a counting argument, and the school would then tell a parent their child's
attendance was anonymised.
**Response.** The attendance row was already corrected to `DELETE` by the domain
pass, on the same reasoning, as D-111/F-48 — the two passes reached it
independently, which is a useful signal about the argument. What was still
missing was the **rule**, so the next data class is not decided by intuition:
D-155 gives `ANONYMISE` one mechanical definition and restricts classes that
cannot meet it to `DELETE` or `REVIEW`.

### F-124 — `SELF` was an implicit universal grant, which D-030 forbids
**Severity: medium.** (Reviewer C-7.) The scope table granted `SELF` to "every
authenticated person, **implicitly**", and never said which permissions the
implicit grant carries. If `SELF` is evaluated as a scope match without an
explicit `RoleAssignment`, then `requirePermission('students.medical.read',
{student: self})` may pass for any authenticated person holding no grant at
all — deny-by-default (§1.1 rule 2) defeated by an implicit rule in the same
document.
**Response.** D-146: a seeded role assignment with a closed enumerated
permission set, subject to §2.6 like every other grant and visible in the admin
UI. The reviewer's related point about `RELATED` is **already resolved** — OD-5
removed it from the enum entirely on 2026-09-01 (D-122), which is the reviewer's
own recommendation, reached before the review landed.

### F-125 — The diagnostics page had no permission and ranks instances by exploitability
**Severity: medium.** (Reviewer C-6.) `13-…` §8 shows version, migration state,
DB connectivity, storage writability, backup age, effective config with
provenance — and *"whether a newer release with a security advisory exists"*. No
permission is named and no catalogue entry existed. An attacker scanning for
SplashTrack instances would get a machine-readable answer to "is this one
exploitable?" plus its backup posture. F-17 already names unpatched instances as
the biggest residual risk; this page ranks them.
**Response.** D-156. **A note on the reviewer's framing:** the chapter never
says the page is unauthenticated — the reviewer assumed the natural
implementation of "a diagnostics page for support". The assumption is fair and
the defect is real, but it is a *missing statement*, not a stated mistake, and
the fix is the same either way. The "safe to paste into a public issue" property
is good and is kept; pasteability and authentication are independent.

### F-126 — "No DPA is needed between us" is a legal conclusion in a document that promises not to give one
**Severity: low.** (Reviewer C-16.) D-064 is the best-reasoned GDPR passage in
the set and gets the controller/processor position right, including that a
hosting provider or a consultant operating the instance *may* be a processor.
Its own trade-off paragraph says the design "states the roles and points to the
questions; it does not answer them for anyone" — and then `10-findings.md` F-05
states flatly "**No DPA is needed** between us", and D-064's bullet said a DPA
does not arise. Both are conclusions about the reader's obligations.
**Response.** `02-…` §5.1 restates it as fact — *the project receives no
personal data from your installation and performs no processing on your behalf;
whether any agreement is required between you and any party is your assessment
to make with your own advisor.* The F-05 sentence itself is a hand-off (§4).

### F-127 — `SHARED_DEVICE` remained normative in chapter 02 after v1 cut it
**Severity: medium.** (Reviewer B-15, and a live inconsistency.) D-009 was
**opt-in by the party it restricts**: "a session *may be marked*
`SHARED_DEVICE`" never said by whom, and the behaviour an instructor meets first
— a shortened idle timeout on a wet tablet with a queue of children — is the one
they turn off. If it is a device cookie, whoever holds the tablet clears it; if
it is a network heuristic, that was never stated. It was cited as *the*
mitigation for two separate High risks and for FM-13, so the strongest control
in the poolside threat model was a self-declaration. `00-overview.md` §3.5.1
already moved it out of v1 on exactly this reasoning; chapter 02 still specified
it as an active decision, and §1.3 and §4 stated two different rules for
photograph suppression. Separately, D-009's "suppress PII beyond first name +
photo" is backwards: for a child a photograph is far more identifying than a
surname.
**Response.** D-143 supersedes D-009 and records what v1 actually ships — three
of the four behaviours obtained from the Instructor role holding no export, bulk
or admin permission, plus a role-based idle timeout, with nothing to un-mark.
The photograph rule is now stated **once**, in §4: first name and surname
initial on shared surfaces, photograph revealed per student on explicit tap,
that reveal audited. One tap is affordable poolside; a face book of every child
in the building for anyone holding the tablet is not.

---

### F-128 — The retention table stated no lawful basis
**Severity: medium.** The prose introducing the table promised to answer "on what
lawful basis it is held" for each data class. The table had no such column, so
the one question an organisation must answer in order to defend or change a
default was the question the defaults did not state.
**Response.** D-097 adds a `lawfulBasis` column with proposed bases, and prints
*unresolved* where the basis genuinely is — most visibly on exam results and
awards, where §5.2 already says the ground must be identified per organisation
rather than assumed.

### F-129 — F-08's resolution contradicts D-059 in the sentence that resolves it
**Severity: medium.** (Raised as **M-11**.) F-08's response reads "model the gap
with `leftAt`" — exactly the status column D-059 forbids, and for exactly the
reason D-059 gives: a flag silently destroys the answer to "when were they a
member?". F-08 is stale text written before D-059 existed.
**Response.** D-059 wins. The domain chapter now implies nothing otherwise — no
`leftAt` appears anywhere in `01-domain-model.md`. **The F-08 text itself is in
`10-findings.md` and was not edited by this agent** — see §3 below.

### F-130 — Break-glass CLI events had no actor and notified nobody
**Severity: high.** `07-operations.md` §1.2 requires every audit event to record
an actor person id and an actor session or credential. A CLI invocation has
neither, and the chapter listed break-glass invocation as auditable "even when
no application session exists to attribute them to" — naming the gap without
closing it. Someone with brief host access (a contractor, an ex-sysadmin whose
key was never removed, anyone in the `docker` group) runs `admin:grant-admin`
and holds a standing Instance Administrator account, traced only by one row, in
a UI nobody opens, attributed to nobody.
**Response.** CLI events carry a `system:cli` actor with host user, container
id, timestamp and subcommand; every invocation notifies all `ORGANIZATION`-scoped
administrators and raises a banner a *different* administrator must dismiss;
`admin:grant-admin` issues a 24-hour grant rather than a permanent one
(`07-…` §1.2, `13-…` §7).

### F-131 — "The version check sends nothing" was not exact
**Severity: low — on the list because the design's credibility rests on claims
like this being exact.** D-034 said the only outbound call "sends nothing but
the version it is checking… no identifiers, no counters". Every HTTPS request
discloses a source IP and a User-Agent to infrastructure someone logs, and for a
school instance it also reveals that this organisation runs SplashTrack, at this
address, at this version.
**Response.** State the disclosure plainly, fetch the **complete** advisories
file rather than querying per version so the request reveals nothing about the
running version, keep the default on (F-17 justifies it), and name the
`update.check.enabled = false` opt-out in the same paragraph
(`03-deployment-model.md` §2.1).

### F-132 — ISR caching was declared safe because tenancy was removed
**Severity: medium.** `03-…` §5.4 declared the cache-key hazard "gone" with
tenancy. It is reduced, not gone: any public page rendering session-dependent
chrome — a "logged in as…" nav — caches one visitor's view for every other
visitor, single-tenant or not.
**Response.** Public pages are rendered with **no session read at all**, which
is also what makes D-017's structural claim true at the rendering layer rather
than only at the data layer (`03-deployment-model.md` §5.4).

### F-133 — Audit retention outlived nothing it evidences
**Severity: high.** Audit events were retained 24 months; exam results and
awards up to 10 years. The record of *who* recorded a diploma outcome would be
destroyed eight years before the outcome, in a design that justifies append-only
results with "a parent disputes a diploma decision".
**Response.** The audit row in `01-domain-model.md` §5 now states that audit
retention must be at least as long as the longest-retained class whose changes
it evidences, with a 12-month floor (D-149/D-150) and the shipped default
flagged for reconciliation rather than silently left at 24 months. If
reconciliation is rejected on volume grounds, the consequence is stated in the
privacy screen as a limit on what the organisation can reconstruct.

### F-134 — No DPIA material existed for processing that plainly triggers Article 35
**Severity: high.** Large-scale processing of special-category data concerning
children, with new technology, meets the Article 35 criteria several times over.
The word DPIA appeared nowhere in fifteen chapters. F-27 is right that the
project cannot give legal advice — but a **template** is not advice: it is a
list of the processing operations the software actually performs, which only the
project can enumerate accurately, and which every controller would otherwise
reconstruct by reading the source.
**Response.** `docs/privacy/dpia-template.md` and `docs/privacy/privacy-notice-skeleton.md`:
data classes and where they live, purposes and lawful bases, retention defaults
and the backup horizon (D-104), recipients, security measures, and the residual
risks the design already names (F-07, F-17, F-23). Necessity, proportionality
and risk acceptance are left blank for the controller.


---

# 13 — Configuration, Setup & Administration

> Added 2026-08-31 after Jack's requirement: *"een organisatie moet een simpele
> manier hebben om met deze app te werken — een setup-pagina waar je alles kunt
> instellen zonder dat je Docker steeds hoeft te herstarten. Ook de configuratie
> moet volledig in de webapp te beheren zijn."*


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. The requirement, stated precisely


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

A self-hosted operator (D-012 final) must be able to install and fully
administer SplashTrack **through its own web interface**. Editing environment
variables, rebuilding an image or restarting a container must not be part of
normal administration.

This is a product requirement, not a convenience: the audience is a swim school
with limited IT capacity. If configuring email or SSO requires SSH and a
`docker compose down`, they will either not do it or do it wrong.

---

## 2. Prior art — how Vaultwarden does it, and what to take from it


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Vaultwarden is the closest comparable: a self-hosted, open-source, single-org
application distributed as a container, aimed at operators who are not
full-time sysadmins. Its approach, verified from the project wiki:

| Aspect | Vaultwarden's approach |
|---|---|
| Admin surface | A separate `/admin` page, disabled unless an `ADMIN_TOKEN` is set |
| Admin authentication | The `ADMIN_TOKEN` itself **is** the password. A single shared secret, no user account |
| Session | Exchanging the token yields a JWT, default lifetime 20 minutes |
| Session revocation | **Not possible** — changing or removing the token does not invalidate issued JWTs. Only deleting `rsa_key.pem` invalidates them |
| Settings storage | Env vars, an env file, **or** a `data/config.json` written by the admin page |
| Live changes | Settings edited in the admin page apply without a restart |
| Project's own advice | **`config.json` is explicitly *not* recommended**; environment variables are the recommended method |

### 2.1 What to copy, and what to reject

**Copy the user experience.** A settings page inside the application, changes
applying immediately, and a diagnostics page showing effective values and where
each came from. That is exactly right and it is why Vaultwarden is pleasant to
self-host.

**Reject the authentication model, entirely.** A shared bearer token as the
admin password, in an environment variable, with non-revocable sessions, would
be a significant regression for SplashTrack — and unacceptable for an
application holding health data about children. We already have real user
accounts, MFA, passkeys, per-permission authorization, step-up re-authentication
and an audit trail. The settings page belongs behind *those*, not beside them.

**Reject the file-based store.** Vaultwarden writes `config.json` to a data
volume and then advises against using it — a telling contradiction. A file
inside a container needs a writable volume, drifts out of sync with the env
vars it overrides, is invisible to backups that only cover the database, and
has no transactional or audit story. **We have PostgreSQL.** Settings belong in
it: backed up with everything else, transactional, auditable, and readable by
the same code that reads everything else.

**Decision D-036 — Configuration lives in the database and is administered
in-app behind normal authentication; not in a file, not behind a shared token.**
**Reason.** As above: it inherits backup, transactions, audit and access control
for free, and avoids the shared-secret admin pattern that the closest comparable
project demonstrates the weaknesses of.
**Trade-off.** Settings cannot be read before the database is reachable, which
forces the small bootstrap layer described in §3. Accepted — that layer is
irreducible anyway.

---

## 3. The three configuration layers


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The honest position is that **not everything can be in the database**, and
pretending otherwise produces a chicken-and-egg failure. Three layers, and the
first is kept deliberately tiny.

### 3.1 Layer 1 — Bootstrap (environment, restart required)

**Application-owned bootstrap variables** — the values the application must know
*before* it can read its own database, or that select where its own state lives:

```text
DATABASE_URL      where the database is
APP_URL           the public origin (also the WebAuthn relying-party origin)
SECRET_KEY_FILE   path to the file holding the bootstrap secret (§3.1.1)
DATA_DIR          uploads/assets path (optional, sane default)
PORT              listen port (optional, sane default)
```

That is the current set, not a quota. It may grow when a value genuinely meets
the criterion below, and it should stay small because few values do.

#### 3.1.1 `SECRET_KEY` — the single authoritative statement

**This subsection is the only place in the design that defines the lifecycle of
the bootstrap secret.** `03-deployment-model.md` §1.2 and
`14-backup-restore-upgrade.md` §2 point here and do not restate it. An earlier
draft gave four mutually exclusive accounts — an operator-supplied environment
variable (here), a value "generated on first run and written to the data volume"
(`03` §1.2), a value *displayed* by the wizard (§6.3 step 4), and the recovery
token itself (`14` §2, whose own diagram said it *wrapped* the key rather than
being it). Four descriptions, four failure modes. Finding **F-95**.

Worse, the design asserted a template capability that does not exist. Verified
against `WebAppTemplate`: **there is no `SECRET_KEY`.** At-rest encryption
derives its key from **`BETTER_AUTH_SECRET`** via HKDF-SHA256 with a per-module
`info` label (`src/modules/identity/infrastructure/secret-crypto.ts`, plus a
near-duplicate in `notifications` carrying a *different* label), and
`BETTER_AUTH_SECRET` **also signs sessions and encrypts TOTP secrets**. Both
readings of "is `SECRET_KEY` that value?" fail:

- **Same value** → the Recovery Kit prints the session-signing key on paper. A
  printed artefact that forges administrator sessions.
- **Different values** → a restore supplies `SECRET_KEY` while the fresh
  container holds a *new* `BETTER_AUTH_SECRET`, so every TOTP enrolment and
  every Better Auth-encrypted value in the restored dump is silently dead. MFA
  is mandatory for administrators, so the Recovery Kit fails at precisely the
  moment it exists for.

**Decision D-112 — There is exactly one bootstrap secret, `SECRET_KEY`. It is
the root of every key the application uses, including the Better Auth signing
secret, which is derived from it rather than configured separately.**

```text
SECRET_KEY  (32 random bytes, operator-held, supplied via SECRET_KEY_FILE)
   │
   ├─ HKDF-SHA256(info="auth-signing-v1")   → Better Auth signing secret
   ├─ HKDF-SHA256(info="totp-v1")           → TOTP secret encryption
   ├─ HKDF-SHA256(info="settings-secret-v1")→ SMTP / OAuth / registry secrets
   ├─ HKDF-SHA256(info="medical-v1")        → special-category column encryption
   └─ HKDF-SHA256(info="backup-master-v1")  → backup master key (14 §2, D-114)
```

Every application envelope uses `HKDF(SECRET_KEY, info=<purpose>)` and records
the purpose in the envelope itself (§5.1, D-096). Deriving the auth signing
secret means restore reproduces it **identically**, so sessions, TOTP enrolments
and Better Auth-encrypted values survive a restore — and it is not a second
variable an operator can get out of step.

**Reason.** One root, one thing to keep, one thing to lose. The alternatives
were a second secret nobody would keep in sync, or reusing the session-signing
key as a printable artefact.
**Trade-off.** Compromise of `SECRET_KEY` compromises everything derived from
it. That is already true of `BETTER_AUTH_SECRET` today; making the derivation
explicit at least makes the blast radius stateable, and the purpose labels mean
a future scheme can rotate one branch without touching the others.

**Supplied as a file, not an environment variable.** `SECRET_KEY_FILE` names a
mounted file or Docker secret; the application reads it at start and never logs
it. An environment variable is readable via `docker inspect`,
`/proc/<pid>/environ`, crash dumps and — most commonly — the operator's own
`docker-compose.yml` committed to a repository. A plain `SECRET_KEY` variable is
accepted as a deprecated fallback so an existing install is not bricked, and its
use raises a diagnostics warning.

**Generation.** The application never generates the bootstrap secret into
`DATA_DIR`. If `SECRET_KEY_FILE` is absent the container **refuses to start**
and prints the command that generates one:

```bash
docker compose run --rm app splashtrack secret:init --out ./secrets/secret_key
```

**Decision D-113 — Key material is never inside a backup archive. The backup
writer excludes the key-material path explicitly, and CI asserts it.**
**Reason.** `14-…` §3.1 captures the uploaded assets from `DATA_DIR`. If key
material also lived under `DATA_DIR` and assets were captured as a directory
tree, **the archive would contain its own decryption key** — and every claim
that the encrypted file is inert without the token collapses silently, with
nothing failing. That is why the "generated on first run and written to the data
volume" sentence is deleted from `03` §1.2 rather than softened. Finding
**F-96**.
**Trade-off.** The exclusion is a deny-list entry, which is the weaker shape; it
is backed by a test that greps every shipped `.stbak` fixture for the key bytes
and for the file name, so the check does not depend on remembering.

**Decision D-037 — Environment holds only what must be known before
the database is readable, or what selects where state lives. Everything else
belongs in the settings registry. Adding a variable requires an ADR stating why
it cannot live in the database.**

**Reason.** A hard numeric cap would be an arbitrary architectural rule that
could later block genuinely necessary pre-database or platform configuration —
a TLS trust store, a proxy, a read-only-filesystem path. The *criterion* is what
matters, not the count: if a value can be read from the database, it must be. A
self-hoster should still never have to grep a two-hundred-entry `.env.template`
to find why email is failing.

**Trade-off.** The rule requires judgement rather than counting, so it needs the
ADR gate to stay honest. Settings that conventionally live in environment
variables (SMTP host, log level) move into the database and therefore cannot be
changed while it is unreachable — acceptable, because if the database is down,
those are not the settings being fixed.

Separately, and **not** application-owned: standard runtime and platform
variables an operator may need (`TZ`, `NODE_ENV`, proxy settings, a custom CA
bundle, container resource limits). We document them where relevant but do not
own or invent them.

### 3.2 Layer 2 — Runtime settings (database, in-app, live)

Everything else. A typed registry defines each setting once:

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

**The `class` field is where the registry's "single source of truth for
validation" claim earns its keep** (D-150). `free` settings take any value the
Zod schema accepts. `bounded` settings carry hard floors and ceilings the schema
enforces and which `settings:reset` also respects — it clamps to the bound
rather than restoring an unbounded default (session idle ≤ 8 h, audit retention
≥ 12 months, rate limits ≥ a stated minimum, backup retention ≤ the shortest
special-category retention). `invariant` settings are not editable at all and
have no override flag: the MFA mandate, reach filtering, audit append-only and
the `SELF` permission set. The UI renders an invariant as a **stated fact**, not
a disabled control — a disabled control invites a support question whose answer
is "no".

The registry is the single source of truth: it generates the admin UI, the
validation, the API surface, the documentation table, and the diagnostics page.
Adding a setting means adding a registry entry — never touching a form, a
migration and a docs page separately.

**One correction to a stated assumption:** `zod` is **not present in either
repository** — not in `WebAppTemplate`'s `package.json`, not in SplashTrack's,
and there are no imports of it anywhere. The design has described the registry
as "one Zod schema per setting" as though the dependency were inherited. It is
not. Adding it is a one-line change, but it is a build task rather than an
existing capability, and the same correction applies to `05-technical.md`'s
module template, which lists `validation/` as Zod schemas. Finding **F-108**.

### 3.3 Layer 3 — Organisation content

Branding, pages, skill catalogues, roles: already database-backed domain data
(§4 and §5 of `03-deployment-model.md`). Mentioned only to note it is *not* part
of the settings registry — content and configuration stay separate.

The rule governing what may live in the environment is stated once, in §3.1
(D-037). It is not restated here.

---

## 4. Applying changes without a restart


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

A settings service holds a cached snapshot with a version counter. A write
bumps the version; readers revalidate on next access. No restart, no
redeployment.

**Two categories of setting, made explicit rather than glossed over:**

- **`appliesLive: true`** — the overwhelming majority. Read per request:
  session timeouts, retention periods, email templates, branding, feature
  toggles, password policy, rate limits.
- **`appliesLive: false`** — settings consumed by an object constructed once at
  startup. These are re-applied by **rebuilding that object**, not by restarting
  the process. The identity-provider registry (D-035) is the intended worked
  example, and it is the one case where the mechanism does not exist yet — see
  §4.1.

**Genuinely restart-requiring settings are only those in Layer 1**, and the UI
says so plainly where relevant — for example, changing `APP_URL` alters the
WebAuthn relying-party ID and **invalidates every existing passkey**, which must
be a loud, confirmed warning rather than a silent save.

**Decision D-038 — Every setting is either live or explicitly rebuild-scoped;
"restart the container" is never the answer for a Layer 2 setting.**
**Reason.** It is the actual requirement. It also forces a healthier
architecture: no module may capture a setting in a module-level constant at
import time, which is a common source of stale-configuration bugs.
**Trade-off.** Settings must be read through the service rather than a constant,
which is marginally more verbose and needs a lint rule to enforce.

### 4.1 The identity-provider case, corrected

An earlier draft of this section said: *"`WebAppTemplate` already loads Entra
configuration at auth-context init, so changing a provider rebuilds the auth
context rather than the container."* **That is factually inverted.** The
template's own comment at `src/lib/auth/auth.ts:507-509` says the opposite —
the Entra login configuration *"is read once at auth-context construction and so
only applies on the next restart/redeploy"*. `export const auth =
betterAuth({...})` is a module-level singleton, Next.js runs several worker
processes, and there is no rebuild mechanism at all. The `genericOAuth` plugin
the design bets on takes a **static config array at construction** and routes
callbacks on `/api/auth/callback/:providerId`, so provider ids must exist at
init for routing to work. Adding a provider at runtime is not something the
plugin does today. Finding **F-105**.

The mechanism that would actually work, and which must be built:

```text
getAuth()  →  { version, instance }        (module-level cache, per worker)
                    │
  every request (or every TTL window):
    read settings_version  (one indexed row, cheap)
    version moved?  →  reconstruct the Better Auth instance, store new version
```

A `settings_version` counter row, bumped by **every** settings write, gives
cross-process invalidation via a cheap indexed read with no IPC. The same
counter serves the settings-service cache above.

**Decision D-106 — D-038 stands for every setting except identity providers,
which are marked *requires a spike before being treated as decided*.**
**Reason.** D-038's worked example rested on a template capability that does not
exist, and `genericOAuth`'s construction-time config array may make an instance
rebuild insufficient even with `getAuth()`. The spike is narrow and decisive:
add a `genericOAuth` provider through the database and complete a sign-in
**without restarting the container**.
**Trade-off.** One decision stays open into the build. If the spike fails,
identity providers become the single named exception to the no-restart rule, the
admin UI must say so at the point of saving ("this provider becomes active after
the next container restart"), and the release notes must say so too — rather
than the operator discovering it when sign-in silently uses the old
configuration.

---

## 5. Secrets and encrypted values in the database


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

SMTP passwords, OAuth client secrets, TOTP secrets and special-category columns
are all stored encrypted under a purpose-derived key
(`HKDF(SECRET_KEY, info=<purpose>)`, §3.1.1). Decryption happens server-side
only, and values are **never returned to any client** — the admin API exposes a
`secretSet: boolean`, never the value. That last part is the one piece
`WebAppTemplate` genuinely already implements, for the Entra client secret.

### 5.1 The envelope

**Decision D-096 — Every encrypted value is stored as
`v1:<keyId>:<nonce>:<ct>`, authenticated with AAD binding
`(table, column, primary key, keyId)`.**

D-049 versioned the ciphertext *format* but not the *key*, and nothing bound a
ciphertext to its location. Both omissions are load-bearing:

- **No key id.** A rotation interrupted at 60% — container restart, OOM, an
  upgrade — leaves two keys in one column with no discriminator. Both decryptors
  are present; neither knows which applies, and every failed decrypt is
  indistinguishable from corruption. Medical notes for an arbitrary subset of
  children become permanently unreadable, and the restore matrix would not catch
  it, because it asserts schema rather than plaintext.
- **No AAD.** A `v1:` blob is then **portable**. Anyone with a SQL write
  primitive — or a careless data-migration or de-duplication script — can copy
  child A's encrypted allergy note into child B's row, where it decrypts
  perfectly and authenticates. A child with a severe nut allergy is recorded as
  having none. Column encryption is assumed to prevent exactly this and, as
  previously specified, does not.

With a key id, rotation becomes **resumable and observable**: "how many rows
remain under `keyId=1`" is a query. With AAD, a relocated ciphertext fails to
authenticate. Finding **F-101**.

**Trade-off.** Envelopes get longer and every read site must pass its own
`(table, column, pk)`. That is a small, mechanical cost, and it is paid at the
call site rather than discovered in a child's medical record.

### 5.2 One decryptor registry, and a test that enforces it

The template already stamps `FORMAT = "v1"` — good — but `decryptSecret`
**throws on any format mismatch**. There is one decryptor and no registry, so
the moment a `v2` ships every `v1` value becomes unreadable, which is precisely
the failure D-049 exists to prevent. There are also **two independent copies of
the file with different HKDF labels and separate `FORMAT` constants**
(`identity` and `notifications`), so a v2 rollout would have to happen twice,
consistently, with nothing enforcing it.

**Decision D-097 — One `src/lib/crypto/envelope.ts` holds a
`DECRYPTORS: Record<FormatVersion, Decryptor>` registry and a `CURRENT_FORMAT`.
Per-module files become thin purpose labels over it. A committed golden-vector
test carries one entry per format ever shipped.**

The golden vectors are `{format, purpose, ciphertext, expectedPlaintext}` under a
fixed **public** test key, committed to the repository. Removing or breaking a
decryptor breaks the build. That is what converts "we retain decryptors for
every previously shipped format" from a promise into a check — D-049 as written
had no enforcement mechanism at all.

**Trade-off.** A permanently growing vector file and a small amount of legacy
crypto code that can never be deleted. Both are the point.

### 5.3 What rotation actually touches

Consequences the documentation must state plainly:

- Losing `SECRET_KEY` means every encrypted value becomes unreadable and every
  secret must be re-entered. It is not recoverable from a database backup alone.
- A database backup without `SECRET_KEY` is therefore *safer* to move around,
  which is a feature.
- Rotating `SECRET_KEY` requires the re-encryption command that ships with the
  image, and the command must state **exactly** what it covers.

`splashtrack key:rotate` re-wraps, in one resumable pass per column, keyed by
`keyId`:

| Covered | Not covered |
|---|---|
| Settings-registry secrets (SMTP, OAuth client secrets) | `.stbak` archives already written — see `14-…` §2 (D-114), which is why the backup key is a *two-level* envelope and rotation there means re-wrapping the master key rather than re-encrypting archives |
| Special-category columns (D-013) | Nothing else. If a value is not in this table the command does not touch it, and the release notes must say so |
| TOTP secrets and Better Auth-encrypted values, **because §3.1.1 derives their key from `SECRET_KEY`** | — |

That last row is not a detail. Before D-112, Better Auth's internal TwoFactor
secrets were encrypted with an *independent* `BETTER_AUTH_SECRET` that our
re-encryption command could not reach — so rotating the key would have silently
un-enrolled **every administrator's second factor at once**, while MFA is
mandatory for administrators. The HKDF split is what makes rotation safe, and
the restore matrix carries an invariant asserting that an enrolled TOTP still
verifies after a restore (`14-…` §4.3.1). Finding **F-106**.

This is the same key-management question as OD-7 (special-category column
encryption); both are answered by one root key, one envelope and one documented
rotation path.

---

## 6. Start-up, setup, restore and migration — one sequence


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

This is the **authoritative boot sequence**. Chapter 14 describes backup and
restore mechanics; where the two appear to differ, this section defines the
order.

**Decision D-055 — The container never migrates a database whose purpose is not
yet known. State is detected first; migration is a consequence of that state,
never the first action.**

```text
container start
  │
  ├─ database reachable?            no → fail fast, clear error, do not retry blindly
  │
  ├─ inspect schema state
  │
  ├── EMPTY  (no tables at all)
  │     → SETUP MODE. No migrations are run yet.
  │       Every request redirects to /setup. The wizard asks the one question
  │       only the operator can answer:
  │
  │         ┌─ New installation
  │         │    → run migrations  → seed catalogue + starter roles
  │         │    → create first administrator, force MFA
  │         │    → write bootstrap record → serving
  │         │
  │         └─ Restore from backup
  │              → decrypt + verify archive (nothing written until this passes)
  │              → restore export: old schema + old data + migration history
  │              → run forward migrations from that point (D-046)
  │              → verify against manifest → serving with the original accounts
  │
  ├── PARTIAL  (no bootstrap record AND no person/account/role data)
  │     → setup was interrupted. Resume SETUP MODE; do not migrate silently.
  │
  ├── TAMPERED  (no bootstrap record, but data exists)
  │     → REFUSE TO SERVE. Log loudly. Break-glass CLI only (§7, D-099).
  │
  ├── FAILED  (a migration is recorded as unfinished or rolled back)
  │     → REFUSE TO START. Name the pre-migration backup (D-098).
  │
  ├── EXISTING  (tables + bootstrap record, schema older than app)
  │     → take automatic pre-migration backup (D-044)
  │     → run forward migrations → serving
  │
  ├── CURRENT  (schema matches app)
  │     → serving
  │
  └── AHEAD  (schema newer than app)
        → REFUSE TO START. Name the image version required (D-043).
```

**Reason.** An empty database is ambiguous: it is either a fresh installation or
the first minute of a restore. Migrating it immediately resolves that ambiguity
in the wrong direction — the operator then has a fully migrated empty schema and
a backup that no longer restores cleanly into it. Detecting state first makes the
two paths explicit and keeps restore a normal operation rather than a rescue.

**Trade-off.** The entrypoint cannot be a naive `migrate deploy && start`; it
carries a small state machine, and that state machine is security- and
data-critical code. It is therefore covered by its own test matrix, one case per
state.

### 6.1 The states, as decidable predicates

The diagram above describes intent; it does not tell an implementer how to
*decide* a state, and a state machine the design itself calls security- and
data-critical cannot be specified in prose. These predicates are evaluated **in
order, against one connection**, and the first that matches wins.

**Decision D-098 — The boot states are the following ordered predicates, and a
sixth state, `FAILED`, is added.**

| # | Predicate | State | Action |
|---|---|---|---|
| 1 | `_prisma_migrations` absent **and** zero other tables | **EMPTY** | Setup mode |
| 2 | `_prisma_migrations` holds a `migration_name` not present in the image's migrations directory | **AHEAD** | Refuse to start; name the version required (D-043) |
| 3 | Any row with `finished_at IS NULL` **or** `rolled_back_at IS NOT NULL` | **FAILED** | Refuse to start; name the pre-migration backup |
| 4 | No `InstallationBootstrap` row with `completedAt` | **PARTIAL** or **TAMPERED** — see D-099 | Setup mode, or refuse |
| 5 | An image migration is missing from `_prisma_migrations` | **EXISTING** | Pre-migration backup (D-044) → `migrate deploy` |
| 6 | Otherwise | **CURRENT** | Serve |

**`FAILED` exists because a claim in `14-backup-restore-upgrade.md` §5 was
untrue.** That section said a failed migration leaves the database "at its
pre-migration state". With Prisma it does not: the failed migration **stays
recorded** and blocks every later one — the P3009 class that the template's own
`tests/unit/migration-safety.test.ts` was written for. Without this state the
container retries `migrate deploy` on every restart, fails identically, and the
operator sees a crash loop with no indication that the fix is `migrate resolve`
plus the named backup.

**Do not rely on `prisma migrate status` exit codes.** They are not a stable
API. The predicates above read the `_prisma_migrations` table directly, which is
a documented schema.

**Trade-off.** Six states rather than five, and the entrypoint reads a
Prisma-internal table. Reading it is already the mechanism D-046 depends on for
restore, so the coupling is not new — it is now stated.

### 6.2 Setup mode requires an empty installation, not a missing row

The previous specification keyed the only unauthenticated administrative surface
in the product on the presence of a **single row**: `PARTIAL (tables exist, no
bootstrap record) → resume SETUP MODE`, and the wizard's "New installation" path
then creates a first administrator with full `ORGANIZATION` scope.

Any primitive that deletes one row — SQL injection, a compromised low-privilege
database credential, a botched restore, a support script, a bug in the erasure
transaction — therefore puts a **populated production database holding thousands
of children's records into unauthenticated setup mode**. D-039's claim that the
wizard self-destructs once the first administrator exists was false as
specified: it self-destructed once a *row* existed. Finding **F-98**.

**Decision D-099 — Setup mode requires **all** of: no bootstrap record, zero
`UserAccount` rows, zero `Person` rows and zero `RoleAssignment` rows. Data
present with the bootstrap record missing is not `PARTIAL`; it is `TAMPERED`.**

`TAMPERED` refuses to serve any request, logs at high severity, writes an audit
event, and can be cleared only from the host via the break-glass CLI (§7) — the
same host-access proof of ownership everything else in this chapter rests on.

**Reason.** The gate on an unauthenticated administrative surface must be a
property of the *installation*, not the presence of one deletable row. Four
counts and one lookup are cheap; they run once per boot.
**Trade-off.** An operator who genuinely wants to reset a populated instance to
factory state must do it deliberately from the host rather than by deleting a
row. That is the correct amount of friction. `TAMPERED` is added as a case in
D-055's test matrix alongside the six states above.

### 6.3 The setup wizard

Reachable **only** in `SETUP MODE` (states EMPTY and PARTIAL as redefined by
D-099), so it cannot be re-opened once an installation holds any data:

```text
0. New installation, or restore from backup?
1. Organisation name, locale, timezone
2. First administrator account (email, password or passkey)
3. MFA enrolment — forced, not offered
4. Recovery token shown once, with a required "I have stored this" step (D-040)
5. Email settings (optional, with a test-send button)
6. Done → bootstrap record written, /setup permanently closed
```

Step 4's recovery token is a **passphrase over the backup master key**, not the
bootstrap secret itself — see `14-backup-restore-upgrade.md` §2 (D-114). The
wizard displays the token; it never displays `SECRET_KEY`.

**Decision D-100 — The first-run record is `InstallationBootstrap`, not
`PlatformBootstrap`.** The template's enforced-singleton record is reused, but
it keeps the `Platform` prefix that D-056 deletes alongside `PlatformSettings`
and `PlatformRoleAssignment`. Leaving one `Platform*` model behind reintroduces
the namespace the extraction exists to remove — and it is the model the boot
state machine reads on every start, the worst place for a name that means
something the architecture no longer has.

**Decision D-039 (amended) — The setup wizard is the only unauthenticated
administrative surface, and it self-destructs.**
**Reason.** First-run configuration is the one moment where no account can exist
yet. Bounding that window to "before the installation holds any data" (D-099)
removes the standing unauthenticated admin surface that a permanent admin-token
model keeps open forever.
**Trade-off.** A race exists between container start and the operator reaching
`/setup` — whoever arrives first becomes administrator. It is mitigated by a
one-time setup token, which the wizard requires.

#### The setup token does not go to the logs

The original mitigation printed that token **to the container logs**. Four
chapters away, F-20 states as a design assumption that *"self-hosters debugging a
problem paste logs, screenshots and database rows"*. The mitigation and the
acknowledged behaviour are mutually exclusive, and the repository is public: an
operator whose setup fails opens an issue, pastes `docker compose logs app`, and
publishes a credential that makes a stranger the administrator of an instance the
school is about to populate. The same exposure occurs through Portainer, Synology
and Unraid log panes, and through centralised log shipping to a third party.
Finding **F-99**.

**Decision D-101 — The setup token is written to `$DATA_DIR/setup-token`, mode
0600, and only its *path* is printed. It is single-use, expires in ≤60 minutes,
and is reissued only from the host.**

```bash
docker compose exec app splashtrack setup:token --new
```

**Reason.** Host access is the proof of ownership, which is the pattern §7's
break-glass CLI already establishes for every other privileged operation. A
bearer credential does not belong in a log stream that the design elsewhere
expects to be published.
**Trade-off.** The operator needs filesystem access to the data volume rather
than a `docker logs` scroll. That is one extra command, of the same class they
already need for break-glass.

Token submission is **rate-limited with lockout**, and failed attempts are
audited — the existing rate-limiting specification covers login, password reset,
export and public forms, and did not cover this. §8's diagnostics page and the
GitHub issue template both carry a warning that container logs may contain a
setup-token *path*, and that the file itself must never be pasted.

---

## 7. Break-glass: locked out of your own instance


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

A self-hosted application must have a recovery path that does **not** depend on
a network-reachable secret. Ours requires host access, which is proof of
ownership:

```bash
docker compose exec app splashtrack admin:reset-mfa   --email …
docker compose exec app splashtrack admin:grant-admin --email …
docker compose exec app splashtrack settings:reset    --key …
docker compose exec app splashtrack settings:list
docker compose exec app splashtrack setup:token --new           (D-101)
docker compose run  --rm app splashtrack secret:init --out …    (D-112)
docker compose exec app splashtrack key:rotate                  (§5.3)
docker compose exec app splashtrack bootstrap:clear-tampered    (D-099)
```

`admin:grant-admin` issues a **time-limited grant (24 hours)**, not a permanent
one: the use case is recovery, not provisioning. The recovered administrator
makes their own standing grant through the normal path, where D-139's
anti-amplification invariants apply.

Every one of these writes an audit event, with a `system:cli` actor carrying
host user, container id, timestamp and the exact subcommand, and every
invocation notifies all `ORGANIZATION`-scoped administrators (`07-…` §1.2).
This replaces Vaultwarden's
"disable the admin token" escape hatch with something that cannot be reached
from the internet at all.

**Safety rails in the settings layer itself:**

- Local administrator login can never be disabled while it is the only working
  authentication method (D-035).
- Email and identity-provider settings must pass a **test** before they can be
  enabled.
- Every setting has a visible "restore default".
- Settings changes are audited: who, when, old → new (secrets recorded as
  `changed`, never with values).
- Configuration can be exported and imported **without secrets**, so an operator
  can reproduce an instance or hand it to a colleague.

---

## 8. Diagnostics page


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Borrowed directly from Vaultwarden, because it is genuinely good: one screen
showing effective configuration, where each value came from (default, env,
database), database connectivity, migration state, email test result, storage
writability, version, and whether a newer release with a security advisory
exists (D-034).

**The page requires `diagnostics.read` at `ORGANIZATION` scope and is never
served unauthenticated** (D-156). Its "safe to paste" property is about
*content* — no secrets, no personal data — and is independent of who may open
it. The two were previously conflated, and the page reports version, migration
state, backup posture and whether a newer release with a security advisory
exists: a machine-readable answer to "is this instance exploitable?" for anyone
scanning for instances.

It is the first thing to ask for in a support issue, and it must be safe to
paste into a public GitHub issue — so it renders **no secrets and no personal
data** (F-20).

It additionally surfaces:

- A warning that container logs and `$DATA_DIR` may contain a live **setup
  token**, with the instruction never to paste either (D-101). The same warning
  is in the issue template.
- A warning if `SECRET_KEY` is supplied as a plain environment variable rather
  than `SECRET_KEY_FILE` (§3.1.1).
- The **backup horizon**, and any mismatch between backup retention and the
  shortest special-category retention period (`14-…` §5.2, D-104).
- The current **backup destination**, permanently, beside the backup-age
  indicator (`14-…` §3.2, D-103).
- Whether any encrypted column still holds ciphertext under a superseded
  `keyId` — the resumability signal D-096 makes possible.


---

# 14 — Backup, Restore, Migration & Upgrade

> Added 2026-08-31 after Jack's requirement: *"makkelijk kunnen updaten,
> migreren, backuppen en restoren — het liefst vanuit de setup-pagina en in de
> admin-omgeving. Ik als beheerder heb een backup-file plus een token waarmee ik
> snel weer up-and-running ben."*


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. The requirement, and one hard limit


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The requirement is right and it is the difference between software people trust
and software people abandon: an administrator must be able to take a backup,
keep it somewhere safe, and get a working instance back from it without a
consultant.

**The hard limit, stated up front:** a running application cannot restore the
database it is currently reading from, and a container cannot replace its own
image from the inside. Any design claiming otherwise is lying. So the split is:

| Operation | Where it happens | Why |
|---|---|---|
| **Backup** | Admin UI, on a running instance | Reading is safe |
| **Restore** | **Setup wizard**, on a fresh/empty instance | Cannot overwrite a database in use |
| **Migrate** | Automatically on start, **once the database state is known** (§6 of `13-…`) | Deterministic, forward-only; never on an ambiguous empty database |
| **Update** | One command by the operator; the app detects, warns and prepares | A container cannot pull its own image |

This matches what Jack asked for — restore *is* in the setup page — and it is
also the only arrangement that actually works.

---

## 2. The Recovery Kit


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**Decision D-040 — Recovery is two artefacts: a backup file and a recovery
token. Both are required; neither is useful alone.**

```text
┌── splashtrack-backup-2026-08-31T0300.stbak ──┐   ┌── Recovery token ──┐
│  header: format, keyId, wrapped data key     │   │  STK1-XXXX-XXXX-…  │
│  manifest (version, schema, counts, date)    │ + │  ≥128 bits         │
│  logical export + uploaded assets            │   │  passphrase over   │
│  framed AEAD, per-archive data key           │   │  the master key    │
└───────────────────────────────────────────────┘   └────────────────────┘
```

**Reason.** A backup of this application is a complete copy of personal data
about children, including health notes. An unencrypted dump sitting on a NAS or
in a Dropbox folder is the most likely breach in the entire product. Encrypting
it means the file alone is inert — which makes it *safe to store casually*,
which in turn means operators will actually keep backups. Security that makes
the safe path the easy path.

### 2.1 The token is a passphrase, not the key

An earlier draft said "**the token is `SECRET_KEY`**", while the diagram beside
it said the token *wrapped* `SECRET_KEY`, and `13-…` §5 said secrets used a key
*derived from* it. Three schemes in two chapters. The lifecycle of `SECRET_KEY`
is now stated once, in `13-configuration-and-setup.md` §3.1.1 (D-112); this
chapter does not restate it. Finding **F-95**.

Making the token *be* the key was wrong on its own terms, independent of the
contradiction. One key, forever, would protect the backup archive, every medical
column and every stored OAuth/SMTP secret — printed on paper, re-displayable in
the UI, and with no revocation. A volunteer administrator who photographs it
during setup in 2026 and leaves in 2027 can decrypt any archive they obtain in
2029. And rotation would be **worse than useless**: re-encryption touches the
database and cannot reach `.stbak` files already written, so after a rotation the
operator must keep the *old* token for old archives and the *new* one for new
ones — two permanently critical secrets, and no protection whatsoever for the
archives the departing administrator can already read. Finding **F-100**.

**Decision D-114 — Two-level key envelope. A random 256-bit master key is
generated at setup and stored wrapped by a KDF over the printed recovery token.
Each archive carries its own random data key, wrapped by the master key and
stored in the archive header.**

```text
recovery token  ──Argon2id──▶  KEK  ──unwraps──▶  master key
                                                      │
                                                 unwraps per-archive data key
                                                      │
                                            framed AEAD over the archive body
```

- **KDF: Argon2id**, `m = 64 MiB`, `t = 3`, `p = 1`, 128-bit random salt stored
  beside the wrapped master key. Parameters are recorded in the wrapped-key
  record so they can be raised for new wraps without breaking old ones.
- **Rotation = re-wrap the master key under a new token.** Old archives stay
  readable, because their data keys are wrapped by the *same* master key. The
  token can genuinely be rotated when someone leaves, which is the entire point.
- **A leaked archive compromises one archive**, not the estate, because the data
  key is per archive.
- The master key is also derivable as `HKDF(SECRET_KEY, info="backup-master-v1")`
  for the bootstrap case (`13-…` §3.1.1), so a fresh install has a master key
  before any archive exists.

**Reason.** Every property the Recovery Kit promises — printable, storable,
revocable when a volunteer leaves, safe to keep old archives — requires the
printed artefact to be a *passphrase*, not key material. This is the standard
shape and there is no reason to invent another.
**Trade-off.** Two unwrap steps on every restore and an Argon2id cost the
operator waits through (deliberately). Losing the token still loses the data —
that has not changed, and F-24 stands.

### 2.2 Token format, entropy and handling

**Decision D-115 — The recovery token carries ≥128 bits of entropy, is encoded
in Crockford base32 with a check character and grouped for transcription, and
every re-display is a high-severity audit event that notifies all
`ORGANIZATION`-scoped administrators.**

The previous specification stated a shape (`STK1-XXXX-XXXX-…`, "human
transcribable", "printable") and no entropy floor. That is the dangerous
combination: if the token had to encode a full 256-bit key it would run past
fifty characters and nobody would transcribe it correctly, so the pressure would
be to shorten it — and shortening key material is silently catastrophic in a way
shortening a passphrase over Argon2id is not. Making it a passphrase (D-114) is
what makes a transcribable length defensible. Finding **F-100**.

Handling rules, all of which were missing:

- Re-display under step-up **and** high-severity audit **and** notification to
  every organisation-scoped administrator. Step-up alone protects nothing
  against the administrator who is the threat; `07-operations.md` §1.2's audit
  list does not currently mention token re-display at all, and it must.
- The restore endpoint lives in the **unauthenticated** setup wizard. It is
  rate-limited with lockout, and failed attempts are audited. So is
  recovery-token entry generally.
- Diagnostics keeps the "recovery token acknowledged: yes/no" check (F-24) and
  adds the date of the last re-display.

---

## 3. Backup


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 3.1 On demand, from the admin UI

`Admin → Maintenance → Backup → Create backup now` produces one `.stbak` file:
a manifest, a database export, and the uploaded assets, streamed into an
encrypted archive. The manifest records application version, schema/migration
version, creation time and row counts per table — everything a restore needs to
refuse an incompatible file *before* touching anything.

**Decision D-095 — The database export is a structured logical export the
application writes and reads itself, not a raw `pg_dump` replayed by the
database.**

Restoring a `pg_dump` produced elsewhere is arbitrary SQL execution — see §4.2
and F-97. The honest comparison is short: a logical export deletes that entire
class of failure, costs nothing the design relies on (D-046's
`_prisma_migrations` trick carries perfectly well as a **manifest field**
recording the applied-migration list), and removes the need to ship and version
`pg_dump`/`pg_restore` binaries whose output format is tied to a server version
the operator controls. It is more code than shelling out to `pg_dump`, and it
must be kept in step with the schema — which is exactly what the restore matrix
(§4.3.1) tests on every pull request anyway.

**Reason.** The v1 choice should be the one where the dangerous case cannot be
expressed, not the one where it must be filtered. Filtering an attacker-supplied
dump (§4.2) is achievable but is a permanent allow-list to maintain against a
format designed to be expressive.
**Trade-off.** We own the export/import code, including every column type and
every future schema change. If v1 nonetheless ships `pg_dump`, §4.2's
restrictions are **mandatory, not advisory**, and `postgresql-client` must
actually be in the image — it is not today (`03-…` §1.2).

**Decision D-102 — The archive uses a framed AEAD construction with per-chunk
sequence numbers and an explicit final-chunk marker; the manifest is
authenticated as a separate AEAD message before it is parsed.**

"AES-256-GCM encrypted" over a streamed multi-gigabyte archive was
under-specified in a way that reads as safe and is not. GCM is not a streaming
construction: a naive implementation either buffers the whole archive — which a
large instance cannot — or encrypts chunks independently, in which case an
attacker can truncate, reorder or splice chunks between archives and every
per-chunk tag still verifies. Finding **F-101**.

- Use a named framed construction — libsodium `secretstream` (XChaCha20-Poly1305)
  or `age` — with sequence-bound chunks and a final-chunk tag, so truncation and
  splicing fail.
- **Nonce policy:** random per archive, never reused. Per-archive data keys
  (D-114) give this for free, which is the second reason to have them.
- The manifest is a **separate AEAD message bound to the archive's data key**,
  verified **before any parsing**. Reading the manifest to drive the restore
  before the archive is authenticated is acting on attacker-controlled data, and
  it compounds §4.2 directly.

**Key material is never in the archive.** The writer excludes the key-material
path explicitly and CI asserts that no shipped `.stbak` fixture contains it
(`13-…` §3.1.1, D-113). Without that exclusion the archive would contain its own
decryption key and every "the file alone is inert" claim in this chapter would be
false with nothing failing. Finding **F-96**.

**Assets are files on a path, not an object store.** Uploaded assets live under
`DATA_DIR` (`13-…` §3.1) and are captured *inside* the encrypted archive. There
is no versioned, replicated object-storage tier in this product — that is a
managed-cloud assumption inherited from the hosted design, and `blob-storage.ts`
in the template supports only `"local"` and throws on anything else. Volume-level
redundancy is the operator's choice, and should be documented as such rather than
stated as our policy.

### 3.2 Scheduled, unattended

Configured in the settings registry, executed by the existing `maintenance` job
runner: frequency, retention count, and destination. Failures raise an admin
notification, because a silently broken backup schedule is worse than none.

**Decision D-103 — v1 writes backups to a mounted volume only. There is no
S3 destination, and a change of backup destination is treated as equal in
severity to a backup download.**

**No S3 in v1**, for two independent reasons.

The first is that it does not exist: `WebAppTemplate`'s `blob-storage.ts`
supports only `"local"` and throws on anything else, and there is no S3 client
in `package.json`. The design listed `backup.destination (volume | s3)` and
`backup.s3.*` as though a remote target were inherited. It is not. An operator
who wants off-site copies syncs the volume with the tool they already use —
`rclone`, `restic`, a NAS job — which is better software than we would write,
already has their credentials, and keeps three secrets out of our settings
registry.

The second is the reason it must *stay* out until the controls exist. D-042
correctly wraps the download button in step-up, rate limiting, high-severity
audit and a single-use signed link — and then a destination setting beside it
would have been an ordinary form. A departing administrator never touches the
download button: they point the destination at their own bucket, and every night
the instance ships a complete copy of every person, every medical note and every
exam result, encrypted with a key the same UI will re-display to them. The most
controlled path guarded, the uncontrolled path next to it a text field. Finding
**F-103**.

So when a remote destination does arrive, it carries the download's controls in
full:

- Step-up re-authentication, high-severity audit, and **mandatory notification
  to every `ORGANIZATION`-scoped administrator** on any change of destination or
  destination credentials.
- A **24-hour delay or a second administrator's approval** before the first
  backup reaches a new destination.
- The current destination shown **permanently on the dashboard**, beside the
  backup-age indicator (D-041), so a silent redirect is visible without anyone
  opening a settings page.

**Trade-off.** Off-site backup — the thing that survives the building burning
down — becomes the operator's job in v1, and we must say so plainly in the
installation documentation rather than leaving a checkbox that implies we did
it.

**Decision D-041 — The last-successful-backup age is surfaced on the dashboard
and in diagnostics.**
**Reason.** Backups fail quietly. An operator who thinks they have backups and
does not is in a worse position than one who knows they have none.
**Trade-off.** A nagging UI element. Worth it.

### 3.3 The download is a security event

**Decision D-042 — Downloading a backup requires step-up re-authentication, is
rate-limited, is audited at high severity, and is served via a short-lived
single-use signed link.**
**Reason.** The download button is, by construction, a one-click complete
personal-data exfiltration primitive. It is the single most dangerous UI element
in the application and must be treated as such rather than as a convenience.
**Trade-off.** Friction for a legitimate administrator. Correct friction.
Finding **F-23**.

---

## 4. Restore


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 4.1 Where

The **setup wizard**, on a fresh instance with an empty database — exactly where
Jack wants it. The wizard's first question becomes:

```text
   ┌─────────────────────────────────────────┐
   │  New installation                       │
   │  Restore from backup   ← file + token   │
   └─────────────────────────────────────────┘
```

### 4.2 What happens

```text
upload .stbak + paste recovery token
  → unwrap master key (Argon2id) → unwrap this archive's data key
  → authenticate the manifest as its own AEAD message   ← before any parsing
  → authenticate the archive body (framed AEAD, D-102)  (fail → stop, nothing touched)
  → parse manifest, compare versions       (see 4.3 — old backups are
                                             restored then migrated forward)
  → restore into a freshly created empty schema, allow-listed (§4.2.1)
  → run any newer migrations forward
  → verify row counts against the manifest
  → done: log in with your existing accounts
```

Nothing is written until authentication succeeds, so a wrong token or a corrupt
file costs nothing.

#### 4.2.1 A `.stbak` from anywhere else is untrusted input

**State this plainly, because the design previously did not: an archive from any
source other than the operator's own instance is untrusted input.** Restore was
specified as replaying a database dump produced elsewhere, and the reference
compose's database user is conventionally the superuser. The words "superuser",
"least-privilege database role" and "restrict dump contents" appeared nowhere in
fifteen chapters.

The attack is not exotic; it is the documented recovery path. A volunteer posts
"my instance won't start". A helpful stranger supplies a "known-good starter
backup" plus its token — the wizard's first question invites exactly this — and
the dump contains `CREATE FUNCTION`, `COPY … FROM PROGRAM` or `ALTER ROLE`,
executed as the database superuser. The result is code execution in the database
container and persistence via a trigger that survives every future migration.
The previous verification step made this worse by sounding sufficient: it checked
that the archive was *intact*, not that it was *benign*, and both the checksum
and the manifest came from the same attacker-supplied file. Finding **F-97**.

**Decision D-116 — The application's database role is not a superuser. It owns
its own schema and nothing else, `NOSUPERUSER NOCREATEROLE`, and the reference
`docker-compose.yml` creates it that way.**

This is a non-negotiable property of what we ship, stated alongside "runs as
non-root" (`03-…` §1.2). It bounds the blast radius of *every* SQL-injection
class in the product, not only this one.

**If v1 nonetheless replays a dump** rather than adopting D-095's logical export,
these restrictions are mandatory:

- `pg_restore --no-owner --no-acl --no-comments`, custom format only, into a
  **freshly created empty schema**.
- An **allow-list of object types**: tables, indexes, constraints, sequences.
  Hard rejection of functions, triggers, extensions, event triggers, and
  `COPY … FROM PROGRAM`. Anything outside the allow-list **aborts the restore**
  — it is not skipped with a warning, because a partial restore of a file we
  have just decided is hostile is not a recovery.
- The allow-list is enforced by inspecting the archive's table of contents
  before execution, not by grepping SQL text.

**Trade-off.** An operator restoring a legitimately unusual database — one
carrying an extension they added by hand — is refused and must add it
deliberately after the restore. Correct: the alternative is an allow-list with a
hole in it.

### 4.3 Restoring an OLD backup into a NEW version — the core promise

**This is a first-class, tested requirement, not a convenience.** An operator
holding a two-year-old backup must be able to pull the *current* image, restore
that file, and be running. They must never be told "first install v1.0, restore,
then upgrade to 1.1, then 1.2…". That instruction is how self-hosted products
lose people's data.

**Decision D-046 — Restore writes the old schema first, then migrates forward.
The order is restore → migrate, never migrate → restore.**

```text
fresh container (v2.4)   +   backup taken on v1.0
        │
        ├─ 1. empty database, NO migrations applied yet
        ├─ 2. restore the dump  → database is now v1.0 schema + v1.0 data
        │                         (including the _prisma_migrations table)
        ├─ 3. run `migrate deploy`
        │      Prisma reads _prisma_migrations, sees which of the ~140
        │      migrations already ran, applies only the missing ones in order
        ├─ 4. verify: schema matches v2.4, row counts match the manifest
        └─ 5. running, with the operator's original data and accounts
```

**Reason.** The dump carries its own schema *and* Prisma's `_prisma_migrations`
table. That table is what makes "I see this is v1.0 and I am v2.4" a **fact the
database states**, not a version string we have to trust or guess from. The
migration runner then does exactly what it does on any ordinary upgrade — there
is no special restore-migration path to keep correct, which is precisely why it
can be relied on.

**Trade-off.** The restore step must run before any migration, so the entrypoint
cannot be a naive `migrate deploy && start`. It carries the small state machine
in `13-configuration-and-setup.md` §6 (D-055), which is itself data-critical code
and is covered by a test matrix with one case per state.

### 4.3.1 What this obliges us to do — the actual cost

The promise is easy to state and easy to break silently. Three commitments make
it real:

**Decision D-047 — CI tests restore from **every supported release** into
`HEAD` — that is, every release at or above `minimumRestorableVersion` (D-048),
not merely the previous one.**

A matrix job: for each such version, restore a stored seeded backup of it into
the current build, apply migrations, and assert the schema and a set of domain
invariants. Releases below the floor are not tested because they are not
supported — the floor is the honest boundary of the promise, and the restore
path refuses them with a message naming the intermediate version required. A migration that breaks restoring from v1.3 fails the
build on the day it is written — not two years later on a stranger's server.

**Reason.** "Skipped versions are supported" is worthless as a sentence in a
document. It is only true if a machine checks it on every pull request.
**Trade-off.** The matrix grows with every release and eventually needs pruning
(§4.3.2). Both are cheap next to the failure they prevent.

**As previously written, D-047 was not implementable, and at v1.0 it protects
nothing.** It named no source for the fixtures, no generator, no fixture
encryption key, no storage, and no definition of "domain invariants" — and
structurally, at v1.0 there are zero prior releases, so the matrix is green while
asserting nothing. The trap is that **fixture generation must ship in v1.0 or
v1.1 can never test restore from v1.0**. Finding **F-107**.

**Decision D-105 — The release workflow generates the restore fixture; the
matrix consumes it from GitHub Release assets, not from the repository.**

*Generation — the final step of every release workflow:*

1. Boot the just-built image against a scratch PostgreSQL.
2. `seed --fixture=restore-matrix` — deterministic: same ids every time, every
   table non-empty, at least one encrypted column and one enrolled TOTP factor.
3. Take a backup with the fixed **public** `RESTORE_FIXTURE_KEY` — public
   deliberately, because F-19 forbids credentials in fixtures and a fixture key
   protects nothing worth protecting.
4. Upload the `.stbak` as a **GitHub Release asset**. Not a git commit: this
   repository already never squashes migrations (D-048), and adding a database
   dump plus assets per release, forever, to the same tree is how it becomes
   unclonable.

*The matrix job* lists releases at or above `minimumRestorableVersion` via the
Releases API, restores each into `HEAD`, migrates, and then asserts:

| Assertion | How |
|---|---|
| Migration state clean | `migrate status` reports no pending or failed migration |
| **Schema genuinely matches** | `prisma migrate diff --from-schema-datamodel --to-schema-datasource` produces **empty** output. One command; this is the real schema assertion, and it replaces the vague "assert the schema" |
| Row counts | Per table, against the manifest |
| Every `Person` readable | Full read of each row through the application's own repositories |
| Every award resolves | Each `Award` resolves to a non-superseded `ExamResult` (D-062) |
| **Every encrypted column decrypts to known plaintext** | Fixture plaintexts are known; compare (D-096) |
| **An enrolled TOTP still verifies** | Against the same recovery token — the assertion that catches `13-…` §5.3's rotation hazard |
| Audit chain verifies | Full chain walk |

The two rows in bold are the ones F-25 called "the nastiest" case and then left
out of the very test meant to cover it: a restore that succeeds while the
*contents* are unreadable passes every schema check there is.

`minimumRestorableVersion` is declared in the release manifest and compared as a
semantic version, with pre-release tags excluded from the matrix.

**Decision D-048 — Migration chains are never squashed within a major version,
and every release declares a `minimumRestorableVersion`.**

Squashing migrations is the standard way this breaks: it feels like tidying, and
it silently strands everyone whose data predates the squash. If a chain ever
*must* be collapsed, it happens only at a major-version boundary, the new
major's `minimumRestorableVersion` is raised, and the release notes say plainly:
"restoring a backup older than X requires intermediate step Y."

**Trade-off.** The migration folder grows monotonically and will look untidy.
Untidy is not a problem; unrestorable data is.

**Decision D-049 — Encrypted values carry a format version, and decryptors for
every previously shipped format are retained.**

A backup contains ciphertext: encrypted secrets, encrypted medical columns. If
the encryption scheme is ever changed or strengthened, v2.4 must still be able
to read v1.0's ciphertext — otherwise the restore "succeeds" and the data is
quietly unreadable. So every encrypted value is stored with an envelope
(`v1:…`), new writes use the current format, and old formats stay decryptable
until a major boundary re-encrypts them during migration.

**Reason.** This is the failure mode that would not surface in a schema test at
all — the tables restore perfectly and the *contents* are gone. It has to be
designed in before the first release, because retrofitting an envelope onto
existing ciphertext is far harder.
**Trade-off.** A small amount of permanently retained legacy crypto code, and a
migration obligation at each major boundary.

**D-049 is extended by D-096 and D-097** (`13-…` §5.1, §5.2), which supply the
two things it was missing. The envelope is `v1:<keyId>:<nonce>:<ct>` with AAD
binding `(table, column, primary key, keyId)` — versioning the *key* as well as
the format, and binding a ciphertext to its location so it cannot be moved
between rows. And "decryptors are retained" becomes a **committed golden-vector
test** rather than a promise: one entry per format ever shipped, under a fixed
public test key, so removing a decryptor breaks the build. As it stands the
template's `decryptSecret` throws on any format mismatch and exists in two
divergent copies, which guarantees the exact failure D-049 was written to
prevent.

### 4.3.2 Compatibility rules, stated as a table

| Backup version vs running image | Behaviour |
|---|---|
| Older, ≥ `minimumRestorableVersion` | **Restore, then migrate forward. Supported, and tested in CI (D-047)** |
| Older, < `minimumRestorableVersion` | Refuse, naming the intermediate version needed. Only possible across a major boundary |
| Same | Restore directly |
| **Newer** | **Refuse**, naming the image version required |

**Decision D-043 (restated) — the application refuses to start against a schema
newer than itself, and refuses to restore a newer backup.**
**Reason.** Forward-only migrations make an older application on a newer schema
undefined behaviour that silently corrupts data. Refusing is recoverable in
seconds; corruption may surface months later.
**Trade-off.** An operator who accidentally pulls an older tag gets a container
that will not start — with an error naming the exact version they need.

### 4.4 Restoring onto a *running* instance

Not offered in the UI. It is available deliberately and awkwardly, from the host:

```bash
docker compose down app
docker compose run --rm app splashtrack restore --file … --token …
docker compose up -d app
```

Awkwardness is the feature — this destroys live data and should require intent
and host access, not a button in a browser.

---

## 5. Migration


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

Migrations run **automatically on container start for an already-initialised
installation**, forward-only, before the application accepts traffic. The
operator never runs a migration command.

They do **not** run on an empty or partially-initialised database: that state is
ambiguous (fresh install or the first minute of a restore) and is resolved by the
setup wizard first. The authoritative boot sequence is
`13-configuration-and-setup.md` §6 (D-055); this section describes only what
happens once the state is known.

**Decision D-044 (amended by D-104) — An automatic pre-migration backup is taken
whenever a start would apply migrations.**
**Reason.** The most dangerous moment in this product's life is a migration
against real data during an unattended upgrade. A snapshot taken automatically
at exactly that moment is the difference between a five-minute rollback and a
lost swim school.
**Trade-off.** Slower start on upgrade and disk usage. Both trivially cheaper
than the alternative. It can be disabled only by an explicit setting, which the
documentation advises against.

### 5.1 What actually happens when a migration fails

The previous text said the database "is left at its pre-migration state". **That
is not true with Prisma.** A failed migration **stays recorded** in
`_prisma_migrations` and blocks every later one — the P3009 class that the
template's own `tests/unit/migration-safety.test.ts` exists for. Without naming
that state, the container simply retries on every restart and the operator sees
an unexplained crash loop.

The container stops with a clear error, names the pre-migration backup in the
log, and the entrypoint recognises the condition as the **`FAILED`** state
(`13-…` §6.1, D-098): refuse to start, name the backup, and tell the operator
that recovery is `migrate resolve` or a restore — not another restart. It never
starts in a half-migrated state.

### 5.2 Pre-migration backups have a retention policy

"Retained for a configurable number of upgrades" was **no maximum, no policy and
no expiry trigger**, on the same volume, under the same key. Set against
`02-security-privacy.md` §5.3's commitment that special-category data is
"hard-deleted, never anonymised" at twelve months — and against a backup policy
of thirty days rolling plus one monthly for twelve months — the arithmetic is
uncomfortable: a parent requests erasure, the school reports the medical note
deleted, and it is present in up to thirteen archives plus an unbounded set of
pre-migration snapshots. Finding **F-104**.

**Decision D-104 — Pre-migration backups are deleted after the next successful
start and at most three are kept. Backup retention may not exceed the shortest
special-category retention period, and the resulting "backup horizon" is
published.**

- **Cap.** A pre-migration backup exists to make the *next* start recoverable.
  Once a start succeeds, its purpose is served: delete it, keeping at most three
  for the case of an operator upgrading repeatedly while debugging.
- **Ceiling.** The registry refuses a backup retention longer than the shortest
  special-category retention, or — where an operator has a documented reason to
  exceed it — surfaces the mismatch as a **diagnostics warning** naming both
  figures. Silently allowing the mismatch is what turns an Article 15 response
  into a false statement.
- **Backup horizon.** One computed figure — *"personal data may persist in
  backups for up to N days after deletion from live storage"* — shown in
  diagnostics and in the privacy screen, so the organisation can quote it in its
  privacy notice instead of guessing. The erasure confirmation UI states it at
  the moment of erasure.

The retention table in `01-domain-model.md` §5 needs a `pre-migration backup`
data class with this trigger and cap; that chapter is not edited here, but the
requirement is stated so it is not lost.

**Trade-off.** An operator who wants a long backup history against a short
erasure period must choose one and record why. That choice is the organisation's
to make; hiding it was ours to stop doing.

---

## 6. Upgrade


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 6.1 What the application can and cannot do

**It cannot update itself.** A container cannot replace its own image from
inside, and any mechanism that could would be a remote-code-execution path into
every self-hosted instance in existence — precisely the supply-chain risk F-18
warns about. We will not build that.

**What it does instead:**

| Capability | Where |
|---|---|
| Detect a newer release; warn loudly if the running version has a security advisory | Dashboard + diagnostics (D-034) |
| Show the release notes and any required operator action, in-app | Admin → Maintenance → Updates |
| **Pre-upgrade readiness check** — disk space, backup age, database reachable, no pending failed jobs | Admin → Maintenance |
| **Take a backup now**, one click, before you upgrade | Admin → Maintenance |
| Show the exact upgrade command for this installation, copyable | Admin → Maintenance |

```bash
docker compose pull && docker compose up -d
```

**Decision D-045 — The application prepares and verifies upgrades but never
performs them; the operator runs one documented command.**
**Reason.** It keeps the trust boundary intact (nothing in the container can
change what the container *is*), it works identically on every host, and one
command is not the part that makes upgrades scary — the fear is data loss, which
D-044 and §3 address directly.
**Trade-off.** Not literally one-click. Mitigated by making everything *around*
the command one-click, and by the honest observation that operators who want
automation already run Watchtower or a compose cron — which works unchanged
with this design.

### 6.2 Never strand a self-hoster

Restated from §2 of `03-deployment-model.md` because it is a backup concern too:
migration chains are never squashed within a major version, so an instance
upgraded once a year still migrates cleanly. Skipping versions is a supported
path, and CI tests it against a populated database.

---

## 7. What this adds to the settings registry


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

```text
backup.schedule.enabled          backup.schedule.intervalHours
backup.schedule.window           (e.g. 02:00–05:00 local)
backup.retention.count           backup.retention.days
backup.premigration.enabled      (default: true)
update.check.enabled             (default: true — D-034)
```

**Decision D-107 — the schedule is `intervalHours` plus a run window, not a cron
expression.**
**Reason.** `backup.schedule.cron` was specified against a job runner that has no
cron in it: `MaintenanceJob` is interval-based (`intervalMinutes`), there is no
cron parser and no cron dependency in the repository. Adding one to a
data-critical path — where a misparsed expression means backups silently stop —
buys expressiveness nobody has asked for. An interval plus "run between 02:00
and 05:00" covers every schedule a swim school will want.
**Trade-off.** "Every Sunday at 03:00" is not directly expressible. Accepted;
`intervalHours: 24` with a night window is what operators actually mean.

`backup.destination` and `backup.s3.*` are **not** in this list: v1 writes to a
mounted volume only (D-103), and a destination setting without the download's
controls is an exfiltration channel with a text field in front of it.

All live-applied (D-038), all audited, secrets encrypted (§5 of
`13-configuration-and-setup.md`).


---

# 15 — Assessment (*Aftesten*), Awards and Fees

> Added 2026-09-01, after the product owner — himself a practising swim
> instructor — described the process the design had modelled the wrong end of:
> *"een andere leraar die bevoegd is binnen de vereniging test mijn leerlingen af
> en bepaalt of ze examen mogen zwemmen of niet."*


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

## 1. What this chapter fixes


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The design spent its entire assessment budget on the exam: D-052 (examiner
without membership), D-054 (`EXAM_SESSION` scope), D-062 (0..N results),
`ExamAssessor`, `Certificate`, `04-ux.md` §4.4. In the process actually used,
**the exam is the formality and the *aftest* is the assessment.** A child
reaches the exam only because a *second, qualified* instructor — not their own —
has already graded every requirement and found all of them at least
*voldoende*. The exam then produces PASS/FAIL and a number.

The word *aftest* did not appear once in `docs/design/`. Neither did *NRZ*.
That is the gap this chapter closes, together with the second thing the product
owner asked for and the design had deferred without deciding: **keeping track of
money** (`00-overview.md` P-03, OD-4).

Two things this chapter is careful not to do. It does not turn assessment into a
qualifications platform, and it does not turn fee tracking into accounting
software. Both boundaries are stated explicitly and defended, because both are
the kind that erode by accident.

---

## 2. The assessment model


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

### 2.1 Entities

```text
AwardType            code, name, kind ∈ {DIPLOMA, CERTIFICATE},
                     issuingBody ∈ {NRZ, ORG}

AssessmentScheme     awardTypeId, version, source, status ∈ {DRAFT, ACTIVE, RETIRED},
                     effectiveFrom, effectiveTo?, passFloorGradeId

SchemeCriterion      schemeId, code, name, sequence,
                     minimumGradeId?      ← NULL = use the scheme's pass floor;
                                            set = a per-criterion override

GradeScale           code, name                                (ordinal, org-owned)
GradeValue           scaleId, code, rank, label
                     ONVOLDOENDE=1 · MATIG=2 · VOLDOENDE=3 · GOED=4 · ZEER_GOED=5

Assessment           type ∈ {AFTEST, EXAM}, schemeId,
                     studentProfileId, assessorPersonId, assessedAt,
                     scheduledSessionId?, examSessionId?,
                     outcome ∈ {PASS, FAIL}, outcomeComputedAt,
                     supersedesAssessmentId?, remark?

AssessmentCriterionResult    assessmentId, criterionId, gradeValueId, remark?

CriterionWaiver              assessmentId, criterionId, reason, grantedByPersonId

PersonQualification          personId, type, validFrom, validTo?
```

`PersonQualification` is the model of *"een leraar die **bevoegd** is binnen de
vereniging"*. In reality a swimming qualification is a licence with renewal
requirements and a national register; one table with a type and two dates is the
correct v1 amount of it. Renewal reminders are a later conversation, not a later
schema.

`CriterionWaiver` exists so that "we let this one go" is a **row with a name and
a reason on it**, never an absence of a row. A pass computed over missing data
and a pass computed over an explicit waiver look identical afterwards unless the
waiver is recorded, and the second is defensible while the first is not.

`Assessment` is append-only in the same shape as attendance (D-061) and exam
results (D-062): a re-assessment writes a new row carrying
`supersedesAssessmentId`, and the effective assessment is the latest row nothing
supersedes. One derivation pattern across the product, not four.

### 2.2 The pass rule is data, not code

**Decision D-080 — There is one pass function, evaluated over scheme data. No
award type is branched on anywhere in the codebase.**

```text
pass(assessment) :=
  ∀ c ∈ criteria(assessment.schemeId) :
      ∃ r ∈ results(assessment, c) with rank(r.grade) ≥ rank(c.minimumGrade ?? scheme.passFloor)
      ∨ ∃ w ∈ waivers(assessment, c)
```

Both of the domain expert's statements about thresholds are satisfied by rows:

- *"Alles moet minimaal voldoende zijn"* → `scheme.passFloorGradeId = VOLDOENDE`,
  every `SchemeCriterion.minimumGradeId` NULL.
- *"Certificaten hebben afgezwakte eisen"* → the certificate is a **different
  `AwardType`, with its own `AssessmentScheme`**, whose criteria carry lower
  `minimumGradeId` overrides, or fewer criteria, or waivable ones.

`if (kind === CERTIFICATE)` therefore never gets written.

**Reason.** The obvious alternative — one global floor plus exceptions expressed
in code — survives exactly until someone asks for a third award variant, and
every Dutch swim school eventually has one: a house certificate, a survival
badge, a school-specific level between two diplomas. At that point the exceptions
are load-bearing, they are in the pass function, and they are untested for the
combination nobody anticipated. Putting the weakening in rows costs one nullable
column and makes the third variant an afternoon of data entry.

**Trade-off.** The rule is no longer readable from the code alone; answering
"why did this child pass?" means reading the scheme as well as the function. The
assessment screen therefore renders the effective threshold next to each
criterion, which is what an assessor needs to see anyway.

### 2.3 Versioning: pin the foreign key, never look up by date

**Decision D-081 — `Assessment.schemeId` references a specific, immutable scheme
version. The scheme is never resolved from the assessment date.**

An `ACTIVE` scheme is never edited. Editing produces version *n+1* in `DRAFT`,
and activating it stamps `effectiveTo` on version *n* and retires it. Rendering a
2026 assessment joins through the pinned id and gets 2026's criteria, 2026's
labels and 2026's thresholds — permanently, and without a temporal query.

Explicitly rejected: resolving the scheme with
`assessedAt BETWEEN effectiveFrom AND effectiveTo`.

**Reason.** The date lookup is the version of this pattern everyone writes first,
and it has two failure modes that both occur. It breaks on **backdated entries** —
an assessment typed in on Monday for the Saturday before an activation reads the
wrong scheme. And it breaks whenever **the NRZ revision date and the school's
adoption date differ**, which they always do, because a school finishes the
running block under the old requirements and adopts the new ones with the next
intake. `effectiveFrom`/`effectiveTo` stay on the scheme as documentation of when
it was in use; nothing joins through them.

**Trade-off.** One more foreign key, and a scheme version can never be corrected
in place — a typo in a criterion name requires a new version. Accepted: that is
the same property that makes the record reconstructable, and a criterion name is
not worth a mutable catalogue.

### 2.4 A naming collision, fixed while it is still free

`Certificate {resultId, number, issuedAt, revokedAt?}` (`01-domain-model.md`
§3.5) means *"the physical proof of a diploma"*. In this domain a **certificaat
is a different award with weaker requirements than a diploma** — a distinct
thing a child can be assessed for. Two meanings, one word, and one of them is
already in the schema.

**Decision D-082 — The existing `Certificate` entity is renamed `Award`, and the
diploma/certificate distinction is carried by `AwardType.kind`.**

`Award` keeps its D-062 behaviour unchanged: issued against a *specific* result,
revoked and reissued rather than edited.

**Reason.** The collision is currently a rename in a design document. After the
first release it is a migration through every issued diploma row, in the table
whose history the product exists to preserve.

**Trade-off.** "Award" is a less familiar word to a Dutch administrator than
"certificaat". The UI label is not the table name; the model gets the unambiguous
term and the interface keeps saying *diploma* and *certificaat*, correctly, for
the two `AwardType.kind` values.

### 2.5 Where the scheme comes from

`Skill` is documented as *"Defined by this organisation"* (`01-domain-model.md`
§3.3). The NRZ requirements are not the organisation's to author.

**Decision D-083 — NRZ-derived schemes ship seeded and source-labelled
(`source = NRZ`). They are org-editable, but editing one produces an org-owned
fork rather than an in-place change.**

The fork is a new `AssessmentScheme` with `source = ORG`, carrying a reference to
the NRZ version it was derived from. The NRZ-sourced version stays intact and
retired.

**Reason.** Without the fork, a well-meaning administrator lowering one threshold
quietly weakens a national diploma requirement, and nothing in the database
records that the school is no longer assessing to the NRZ standard. With the
fork, the divergence is a visible object with an owner.

**Trade-off.** More scheme rows, and a school that legitimately wants to track a
minor NRZ correction has to adopt a new version rather than patch one. That is
the correct direction of friction.

**Not yet verified, and blocking.** The concrete NRZ criteria, their codes and
their thresholds are **not confirmed**. Everything above is the shape of the
catalogue, not its contents. **No catalogue may be seeded until the criteria are
confirmed with the domain expert**, and a seed containing invented swimming
requirements would be worse than an empty one — it would look authoritative.
Recorded as **F-44**.

### 2.6 One criterion catalogue, not two

`SkillRequirement` (`01-domain-model.md` §3.3) already is *"criteria per level,
assessed per student"*. `SchemeCriterion` is the same thing with an ordinal grade
instead of a four-state enum. Shipping both guarantees divergence and two seed
catalogues to maintain.

**Decision D-084 — `SchemeCriterion` is the single criterion catalogue.
`SkillRequirement` is collapsed into it and removed.**

What survives, and how the three now relate:

| Concept | Entity | Nature |
|---|---|---|
| The catalogue of what is required | `SchemeCriterion` | Versioned, source-labelled (D-081, D-083) |
| The informal teaching log | `SkillProgress` | Per-lesson, append-only, references a criterion. Unchanged in behaviour |
| The formal graded observation | `AssessmentCriterionResult` | Belongs to an `Assessment`, carries a `GradeValue` |

`Skill` and `SkillCatalogue` are absorbed: a criterion *is* the skill, and the
scheme *is* the catalogue. `CourseLevel` keeps its sequence and gains an optional
`awardTypeId` so a level can point at what it prepares for.

**Reason.** Two catalogues covering the same domain concept diverge — not
because anyone decides to diverge, but because a criterion gets added to the one
the current screen writes. Then "what does Diploma A require?" has two answers.

**This reduces scope rather than adding it.** The `skills` module shrinks: one
catalogue to seed, one to import and export, one to render. The assessment work
in this chapter is partly paid for by the deletion.

**Trade-off.** `SkillProgress` rows now reference a versioned criterion, so an
informal progress note taken under scheme version 3 renders against version 3's
criterion name. That is correct and it is the same pin as D-081.

---

## 3. The four-eyes gate


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

This is the control the whole chapter exists for, and it is a domain invariant,
not a UI check.

**Decision D-085 — An `ExamCandidate` may not reach `CONFIRMED` without a passed,
independent *aftest*.**

Formally, `CONFIRMED` requires a non-superseded `Assessment` where:

- `type = AFTEST`;
- `schemeId` = the active scheme of the target `AwardType`;
- `outcome = PASS`;
- `assessorPersonId` holds a `PersonQualification` valid at `assessedAt`; **and**
- `assessorPersonId` is **not** among the `InstructorAssignment` holders for that
  student's group over the assessment window.

**Overridable — deliberately.** A person holding an explicit override permission
may confirm a candidate without a qualifying aftest, and the override records who
did it and why, as an audited event.

**Reason for the gate.** This is what the domain expert described: a different
qualified instructor decides whether a child may sit the exam. It is a four-eyes
control on a decision that costs a family an exam fee and a child a disappointing
Saturday, and it is currently enforced by nothing but habit and a clipboard.

**Reason for the override, which matters as much.** In a club with four
instructors there will be a week when no independent qualified assessor is
available. An un-overridable rule does not produce four eyes in that week; it
produces someone logging in as a colleague, and then the control is gone *and*
the audit trail is a lie. A recorded override keeps both: the exception is
visible, attributable and countable, and if it is being used every week that is
itself the finding. This is the difference between a control and a nuisance.

**Trade-off.** Confirmation is now a rule with a bypass, so the gate's real
strength is reporting rather than prevention. Accepted: an override rate is a
number a chair can act on; a workaround is not.

### 3.1 The authorization dependency — owned elsewhere

The independent assessor is, by definition, not the child's instructor, and
therefore holds no `GROUP` grant covering that child. Under D-030 and D-031
(`02-security-privacy.md` §2.2–2.3) this would leave them unable to read the
student at all, and the gate above unimplementable — the reason this chapter
originally recorded a hard dependency here.

**Resolved.** `02-security-privacy.md` §2.1–2.2 decides **D-068**: `SESSION`
participation reach — reach follows assignment to a session and its roster, for
a bounded window — replacing the `EXAM_SESSION` scope of D-054. The same
mechanism covers the substitute instructor, the make-up lesson and the
external examiner. D-085 is implementable.

That chapter owns the decision; this chapter only records that the assessment
model depended on it.

---

## 4. The aftest screen does not inherit the thirty-second doctrine


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

**Decision D-086 — On the assessment screen every criterion starts *unset*.
Nothing is pre-filled with a passing grade.**

One assessor grades roughly twelve children against roughly twenty criteria in a
sitting — about 240 ordinal values. Every instinct the design has developed so
far says: default the common value, make the exception the tap
(`04-ux.md` §4.1). That instinct is correct for attendance and **actively wrong
here.**

Pre-filling *voldoende* on the assessment that decides whether a child may sit an
exam manufactures rubber-stamping. The four-eyes control in D-085 exists to
produce a second, independent judgement; a screen that arrives already agreeing
with the first one produces a signature instead. The feature would then cost two
and a half weeks and provide the *appearance* of the control it was built to
provide, which is worse than not building it.

What is allowed: setting a whole column at once (all twelve children on one
criterion) behind an explicit confirmation, keyboard and swipe entry, and
per-criterion progress so an interrupted aftest resumes. What is not allowed: a
default grade, a "mark all voldoende" button without confirmation, and an outcome
computed over unset criteria.

**This contradicts the product thesis** in `00-overview.md`, which stakes the
design on registering a whole group in under thirty seconds. The thesis is about
the *poolside operational moment* — attendance, a skill sign-off, a wet tablet.
An aftest is not that moment: it is a scheduled, deliberate act by a qualified
person whose entire value is that they looked. **An aftest takes ten minutes and
that is the correct number.** The thesis is a constraint on the operational
screens, not a licence to make every screen fast.

**Trade-off.** The slowest screen in the product, and the one most likely to
attract "can't you just default these?" from the people using it. The answer is
in this section and should be given, not softened.

---

## 5. Assessment remarks are notes, not general student data


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The remarks the domain expert described are pedagogical observations about a
child's body and movement — *"kind vertoont een schaarslag"* — recorded because
they say what to work on, not because they decide the outcome. A child with a
scissor kick and sufficient propulsion (*stuwing*) passes; the remark still gets
written, because the next instructor needs it.

**Decision D-087 — Assessment remarks sit behind the notes permission family
(`students.notes.read` / `students.notes.write`), not general `students.read`.
They attach primarily at `AssessmentCriterionResult`.**

**Reason.** D-010 gates medical notes behind their own permission and says
nothing about assessment remarks, which are at least as sensitive to a parent
reading them. "Your child swims like this" is a developmental observation about a
minor's body and behaviour; the fact that it is written by an instructor rather
than a nurse does not change who should be able to read it.

Attaching at the criterion result, rather than only at the assessment, is where
instructors will write anyway — the remark is *about* the scissor kick, not about
the sitting — and it keeps the remark next to the grade it explains.

**Trade-off.** A permission check on a field inside a screen that is otherwise
readable, and an assessor without the notes permission sees grades without the
reasoning. Correct: an assessor who may not read notes may not read notes.

---

## 6. Fees — tracking, not invoicing

> *"Facturatie en betalingen zou handig zijn als dat ook door deze app kan worden
> **bijgehouden**. Je hebt de lidmaatschap kosten en indien een leerling klaar is
> voor examen zwemmen dan dienen ze voor het examen los te betalen. Dit gebeurt
> dus ook alleen als ze echt examen gaan doen."*


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The verb is **bijgehouden** — tracked. This section builds a ledger and stops
hard, at a line stated in §6.5.

### 6.1 Entities

**Decision D-088 — Fee tracking is three tables, one scheduled job, one screen
and one export.**

```text
FeeType    code, name, amount, currency,
           recurrence ∈ {PERIODIC, ONE_OFF}, active

Charge     payerPersonId,            ← the payer is a Person, never the child
           studentProfileId?, feeTypeId,
           periodStart?, periodEnd?, amount, dueDate,
           status ∈ {OPEN, PAID, PARTIAL, WAIVED, CANCELLED}, note?

Payment    chargeId, amount, receivedAt,
           method ∈ {BANK, CASH, OTHER}, reference?, recordedByPersonId
```

`Charge.amount` is copied from the `FeeType` at creation, not joined at read
time: changing next year's contribution must not silently restate last year's
open charges.

`studentProfileId` is optional because a membership fee can be owed by an adult
member who is not a student, and an exam fee is always about a specific child.

**Screen.** A balance view per payer and per student —
*"Sanne de Vries — contributie Q3 €67,50 open · examengeld Diploma A €12,50
open."* **Export.** A CSV of open charges and recorded payments; the treasurer
keeps whatever tool they already use.

### 6.2 Membership fees

A scheduled job in the existing `maintenance` runner generates `PERIODIC` charges
from active `MembershipPeriod` × active `Enrolment`. It is **idempotent per
(payer, feeType, period)**, using the same `clientEventId` discipline as D-061
and for the same reason: a job that runs twice, a retry, and a manual re-run must
all collapse to one charge. Double-billing a parent is the fastest way to lose
the feature.

### 6.3 The exam fee is created by an event, never in advance

**Decision D-089 — An exam fee `Charge` is created by the event of an
`ExamCandidate` reaching `CONFIRMED`, and at no other time.**

**Reason.** This encodes *"dit gebeurt dus ook alleen als ze echt examen gaan
doen"* as an invariant rather than a convention someone has to remember. It also
composes exactly with §3: no independent aftest pass → no confirmed candidate →
no charge. The rule that protects the child from an exam they are not ready for
is the same rule that protects the family from a fee they do not owe.

**Trade-off.** Cancelling a confirmed candidacy must cancel or waive the charge
rather than delete it, so a withdrawn candidate leaves a `CANCELLED` row behind.
That is the correct trace.

### 6.4 No `Household` entity

**Decision D-090 — There is no `Household`. Charges group by
`Charge.payerPersonId` at render time.**

The payer is derived from `PersonRelationship(GUARDIAN_OF)` at charge creation
and stored on the charge, with a per-charge override.

**Reason.** "One parent, one bill, three children" is a real need and a household
table is the obvious answer to it, but a household is a **fourth identity
concept** alongside `Person`, `Membership` and `StudentProfile` (D-004), and it
is wrong within a year in ways that are painful to unpick: divorced parents,
split payment between two addresses, a grandparent who pays for one child only, a
family that shares an address but not a wallet. Grouping at render time gets the
same screen and never has to be corrected — and storing the payer *on the charge*
means a later change of payer does not restate history.

**Trade-off.** No place to hang a household-level discount, and "the family
overview" is a query rather than a row. If a genuine household-level need appears,
it can be added over the top of charges that already record who owed what.

### 6.5 The line: nothing that emits a document headed *Factuur*

**Decision D-091 — v1 emits no invoice. Out of scope, explicitly: payment
providers (Mollie, Stripe, iDEAL), SEPA incasso file generation, VAT
calculation, sequential invoice numbering, credit notes and refunds, dunning and
reminder automation, accounting-package export, pro-rata credit for missed
lessons — and any rendered document headed *Factuur*.**

**The line is the document, and that is why it is drawn there.** A balance view
and a CSV are internal administration: the organisation looking at its own
records. The moment the application renders a PDF carrying an amount, the
organisation's details and a parent's name, and sends it, that document is
arguably a *factuur* under Dutch rules — and it inherits sequential numbering
without gaps, mandatory fields, BTW treatment, credit-note handling for
corrections, and a seven-year obligation on a record the application now
*authored* rather than merely tracked. That is not a feature added to this
chapter; it is a second product with its own compliance surface, and it cannot be
half-built. A ledger that is wrong is an administrative annoyance. An invoice
that is wrong is a filing.

**Trade-off.** The treasurer still produces the actual invoices somewhere else,
from the CSV. This will be unpopular within a term and it is still the right
place to stop.

### 6.6 The first regret, named in advance: reconciliation

The thing that will make this feature fail is not the absence of Mollie. It is
that **someone marks 180 charges `PAID` by hand each quarter, reading a bank
statement in another window.** That is worse than the spreadsheet the school has
today, and it is precisely where a tracked-billing feature gets quietly
abandoned.

The specific missing piece is **CAMT.053 / MT940 import with reference
matching**: one uploaded bank file, automatic matching on a structured reference
embedded in the charge, the remainder queued for manual review. It needs no
payment provider, no PSD2 and no bank API, and it is roughly a week of work.

It is **out of v1 and it is the first thing added after the first full billing
period.** Naming it here is not a promise; it is so that when the first quarter
is painful, the answer is already identified rather than being rediscovered as an
argument for a payment provider.

### 6.7 Two costs of saying yes, both absorbed here

**1. Financial retention conflicts with person retention.**

**Decision D-092 — `Charge` and `Payment` are registered in the D-014 erasure
registry with a *financial retention ground*, and erasure **pseudonymises** the
charge rather than deleting it.**

D-066 defaults person retention to 24 months after the last relationship ends.
Dutch fiscal law wants administration kept for seven years. Both are right, and
they collide on the same rows. Pseudonymisation — the charge keeps its amount,
date, fee type and period, and loses the link to the person — satisfies the
bookkeeping need without holding a name. Following D-065's honesty rule, a
pseudonymised charge is **still personal data** while the person exists elsewhere;
what it is not is a reason to keep the person.

Without this, the first erasure request either destroys the bookkeeping or
silently skips it, and nobody finds out which until an accountant asks. The
retention rows for `Charge` and `Payment` are added to `01-domain-model.md` §5.

**2. The breach becomes more valuable.** The database now holds children's health
notes *and* who owes money. This does not change any control — D-040 (encrypted
backups) and D-042 (the export as an exfiltration primitive) were already the
right answers — but it does change how seriously they deserve to be taken, and it
should be said out loud when the money tables land rather than discovered in an
incident report. Recorded as **F-47**.

### 6.8 P-03's seam, re-affirmed rather than drifted through

**Decision D-093 — Arrears never appear on the poolside surface.**

`Enrolment.status` remains a lifecycle, never a payment state
(`00-overview.md` P-03). Every school has an unwritten "no payment, no lesson"
rule, and once the money is in the same database as the class list, someone will
ask why the class list does not flag it.

**Reason.** It would put a family's finances in front of a volunteer instructor,
on a shared device, at the poolside, in front of the child. That the data is
available is not an argument that it should be shown there. Arrears live in the
administration surface, where the person who is allowed to act on them works.

**Trade-off.** An administrator who wants an instructor to quietly chase a parent
cannot use the app to do it. That is the intended outcome.

---

## 7. NRZ notification: a report, not an integration


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

The organisation must tell the NRZ who is swimming for which diploma and when.
Sometimes a delegate attends and needs to see the candidate list *at that
moment*.

**Decision D-094 — NRZ notification is an export — candidates, date of birth,
award type, date — and the visiting delegate receives a printed list.**

No integration: the domain expert said so explicitly, and an integration with a
national body is a contract, a schema owned by someone else, and a support
obligation, in exchange for saving one file upload a term.

**No guest login, no share link, no read-only visitor account for the delegate.**
A printed candidate list, handed over at the pool and taken away or destroyed, is
what the situation actually calls for. It involves no stranger touching a device
holding children's records, no account lifecycle, no expiry logic, no scope type,
and no question about what else that account could reach. It takes about half a
day to build.

**The low-tech answer is not a compromise here — it is the better design.** The
temptation is to read "the delegate needs access" as "the delegate needs an
account"; the requirement is that a person standing next to the pool can read
twelve names, and paper does that with a smaller attack surface than anything
this application could offer. This is also the same printed-list capability the
design owes as its paper fallback: a class list that prints is minimum parity
with the clipboard being replaced.

**Trade-off.** A printed list cannot be revoked once handed over. Neither can a
photograph of a screen, and the printed list at least does not persist a
credential.

---

## 8. What this chapter deliberately does not contain


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

| Not built | Why |
|---|---|
| Qualification renewal reminders, CPD tracking, a licence register | `PersonQualification` records validity. The rest is a v2 conversation, not a schema change |
| An appeals workflow for an aftest | Supersession covers a re-assessment. Nobody appeals an aftest to a lawyer; the award is where dispute machinery belongs (D-062) |
| Merging `ExamResult` into `Assessment` | They diverge on retention (years versus months), audience, revocation and erasure. `ExamResult` gains an optional `assessmentId` pointing at the exam-day detail. Two tables, one vocabulary |
| Any invoice, payment provider or bank integration | §6.5 |
| Bank reconciliation | §6.6 — first addition after v1, deliberately not in it |
| A `Household` | §6.4 |
| An NRZ API client or a delegate account | §7 |

---

## 9. Dependencies and open items


> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken
> commentaar:
>

1. **(Resolved) D-085 depended on `SESSION` participation reach.** Decided as
   **D-068** in `02-security-privacy.md` §2.1–2.2 — no longer proposed. The
   four-eyes gate is implementable.
2. **No scheme catalogue may be seeded until the NRZ criteria and thresholds are
   confirmed with the domain expert** (§2.5, F-44). Still open — a question for
   Jack, not an architecture decision.
3. **(Resolved) The `Certificate` → `Award` rename (D-082)** is applied
   throughout `01-domain-model.md` and `04-ux.md` — neither chapter uses
   `Certificate` as an entity name any longer.
4. **(Resolved) D-086's exception to the thirty-second doctrine** is now stated
   both here and where the doctrine itself lives: `04-ux.md` §4.7 and the
   product-thesis qualification in `00-overview.md` §1.
5. **(Open — OD-17, `08-open-decisions.md`)** The grade scale is assumed to be
   the five ordinal values given. Whether a school may ever define its own
   scale is supported by the model (`GradeScale` is org-owned) and unasked as a
   requirement.
