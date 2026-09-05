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

## Review status

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
`08-open-decisions.md`, *Register integrity*. **The register and findings are
the live record and this sentence does not restate their extent** — a range
written into prose is stale the next time either grows, and this one was: it
said D-001–D-138 and F-01–F-108 while the register had reached D-189 and the
findings F-145. Count them where they live (D-134). The domain input in `15-assessment-and-fees.md`
(aftesten, examengeld, contributie, wachtlijst, proeflessen, inhaallessen,
group moves, NRZ export, poolside/papieren fallback) is fully incorporated;
the two questions from that input that were still open at the time — the NRZ
criterion catalogue contents (F-44) and whether a school will ever define its
own grade scale (OD-17) — are now both closed. **(Resolved) F-44** dissolved
rather than answered: an administrator authors the catalogue in the
application instead of seeding it from NRZ source (D-164), through a form
editor and an equivalent JSON document over the same model (D-188).
**(Resolved) OD-17** was confirmed by the domain expert: *onvoldoende / matig
/ voldoende / goed / zeer goed* is the scale, and the only one seeded (D-160).

## Document set

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
and the design branch sits on top of it.

**OD-1 closed on 2026-09-02: there is no deployed prototype instance and no
prototype data.** The constraint this section previously carried — "no
destructive action against the existing repository until OD-1 closes" — is
therefore lifted. `apps/web` may be replaced as part of the v1 build, as an
ordinary reviewed change on a branch. Its migration history may be discarded
(D-001's trade-off column, now free).

Models include `User`, `Organization`, `OrganizationWelcomePage`, `Student`,
`SwimGroup`, `GroupMembership`, `OrganizationMember`,
`OrganizationMemberCapability`, `AuditLog`.

**Assessment: valuable as domain evidence, not as a foundation.** It has no
`Person`/`UserAccount` split (which the brief explicitly requires), no branding
system, no CMS, no API layer, and no consent or retention model.

**There is no import from the prototype** (OD-1: nothing is deployed, so there
is nothing to import). The import path in v1 has a different source: the club's
**commercial membership administration system**, which offers export (OD-16).
Its column shapes are unknown until a sample export is supplied, so no mapping
is specified here — **D-157** forbids specifying one in advance.

**Three constraints that survive the change of source**, because they are
properties of the target rather than of the source:

1. **Authority is never inferred.** Whatever the source calls a role,
   capability or permission level maps to a SplashTrack role assignment
   explicitly, and the import **refuses on any unmapped value** rather than
   silently dropping — or silently granting — authority.
2. **`dateOfBirth` is never synthesised.** A missing or unparseable date is a
   row rejection in the import report, never a placeholder — D-151 derives
   guardian-authority expiry from that column, and a placeholder either floods
   the re-consent queue on day one or empties it forever, undetectably. Where a
   record must be imported without one, the unknown date makes authority
   **lapsed**, so it surfaces in the queue rather than passing silently
   (`02-security-privacy.md` §5.4.1, D-172).
3. **Consent cannot be imported.** A membership system's photo permission,
   medical note or marketing flag arrives with no recorded lawful basis, into a
   system whose privacy model (D-063, D-065, F-27) rests on having one. The
   importer writes **zero** `Consent` rows, leaves every consent-gated feature
   off, and emits a report of what could not be carried over. That is the
   difference between an import that improves the school's compliance position
   and one that launders a gap.

The import is **lossy by construction** wherever the source carries status
rather than history: such records start with one synthetic
`StudentLifecycleEvent(JOINED)` and one `MembershipPeriod`, marked
`origin: IMPORTED_LEGACY` so nobody later reads an import artefact as evidence
in a dispute.

**Whether the incumbent is then retired is OD-18, and it is open.** If it stays
authoritative for membership, the `Membership` half of chapter 15 becomes a
read-only projection rather than a system of record.

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

**The condition on this trade-off is discharged.** It depended on whether the
prototype held data that must be migrated, which was OD-1. **Answered
2026-09-02: no deployed instance exists, so no prototype data exists.**
Discarding `apps/web` and its four migrations costs nothing, and the
export/import path that would have been conditional on a "yes" is not needed
for this source.

**R-29 survives with a different source.** It is a v1 requirement — import of
the existing pupil/member list — but from the commercial membership system
(OD-16, D-157), not from the prototype. It remains distinct from R-20, which is
migrations and upgrades.

---

## 3. Core requirements

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
| R-29 | **One-time bulk CSV import** of the existing pupil/member list, exported from the incumbent membership system (OD-16), after which that system is switched off and SplashTrack is the record (OD-18, D-163). Mapping specified against a real sample file only, unmapped columns reported not dropped, zero `Consent` rows written (D-157, §2.2). **No integration, no recurring feed, no re-import to catch up** |
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
