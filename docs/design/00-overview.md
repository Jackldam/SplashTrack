# SplashTrack — Product Vision, Requirements & Scope

> **Status: authoritative.** This document and chapters 01–10, 13 and 14
> describe **one** architecture: an open-source, self-hosted, single-organisation
> application. There are no multi-tenant or platform-operator assumptions left in
> the active chapters.
>
> Chapters 11 and 12 are **history, not authority** — they record how the design
> arrived here and why. Nothing in them may be used as an implementation
> instruction. If they appear to contradict an active chapter, the active
> chapter is correct and the revision note is stale.

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
| 22 | DEV/UAT/PROD model | `06-delivery.md` §1 |
| 23 | CI/CD strategy | `06-delivery.md` §2 |
| 24 | GitHub workflow | `06-delivery.md` §3 |
| 25 | Lucky AI permissions & boundaries | `06-delivery.md` §4 |
| 26 | Logging, auditing, observability | `07-operations.md` §1 |
| 27 | Backup / restore | `14-backup-restore-upgrade.md` |
| 28 | Failure modes | `07-operations.md` §3 |
| 29 | Scalability | `07-operations.md` §4 |
| 30 | Open architecture decisions | `08-open-decisions.md` |
| + | Configuration, setup & administration | `13-configuration-and-setup.md` |
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

The management depth — members, courses, exams, planning, website — exists
because organisations need it, but it must never leak complexity into that
operational moment.

**Secondary thesis:** an organisation should be able to run its entire public web
presence on SplashTrack. Not as a WordPress replacement — as a small, branded,
content-managed site that shares identity, branding and course data with the
portal, so "sign up for a course" is one system rather than an integration.

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

- Not a general-purpose CMS. No plugins, no page builder, no theme marketplace.
- Not an LMS. No e-learning content, no video hosting, no SCORM.
- Not a payment or invoicing platform in v1 (OD-4).
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

CI already runs format, lint, typecheck, seed smoke-test, unit and integration
tests, Playwright E2E, container build, **and a migration-against-populated-
database job**.

**Assessment: the single most valuable asset in the project.** It answers, with
tested code, most of the non-domain requirements — the tedious,
security-critical part that is easy to get wrong. Its multi-tenant machinery is
simply not used; that *removes* work rather than adding it.

Quality signal: the schema comments document real incidents. One foreign-key
comment explains that a `Restrict` constraint once caused a GDPR Article 17
erasure to roll back entirely, and why the column is now `SetNull` as defence in
depth. That is code that has been operated, not merely written.

### 2.2 `Jackldam/SplashTrack` — the domain reference

An early prototype: 12 Prisma models, ~102 TypeScript files. Models include
`User`, `Organization`, `OrganizationWelcomePage`, `Student`, `SwimGroup`,
`GroupMembership`, `OrganizationMember`, `OrganizationMemberCapability`,
`AuditLog`.

**Assessment: valuable as domain evidence, not as a foundation.** It has no
`Person`/`UserAccount` split (which the brief explicitly requires), no branding
system, no CMS, no API layer, and no consent or retention model.

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

**Condition — not yet satisfied.** Whether the prototype's *migration history*
may be discarded depends on whether it holds data that must be migrated. That is
**OD-1, and it is blocking**: no destructive action is taken against the existing
repository or any prototype database until Jack confirms. If real data exists, a
one-time export/import path becomes a v1 requirement (R-20) rather than an
assumption.

---

## 3. Core requirements

Three categories, as the brief demands. **"Prepare"** means the architecture must
not need rework when the feature arrives — not that it is built now.

### 3.1 Build now — v1

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
| R-09 | Exams: sessions, candidates, examiners (including external), results, certificates |
| R-10 | Planning: lessons, groups, locations, instructors, resources |
| R-11 | Branding without code changes |
| R-12 | Public website / simple CMS, sharing branding and the public course catalogue |

**Platform, security and operability — all v1, none optional**

| ID | Requirement |
|---|---|
| R-13 | Authentication with MFA mandatory for administrator roles |
| R-14 | Scoped permission authorization (`ORGANIZATION` / `UNIT` / `GROUP` / `COURSE` / `SELF` / `RELATED`), deny by default, enforced server-side |
| R-15 | **Configurable OAuth 2.0 / OIDC identity providers** (Microsoft Entra, Google, Keycloak, Okta, generic), administered in-app (D-035) |
| R-16 | **First-run setup wizard** — organisation, first administrator, forced MFA, optional restore (D-039) |
| R-17 | **In-app configuration** — a database-backed settings registry; at most five environment variables; no container restart for a runtime setting (D-036, D-037, D-038) |
| R-18 | **Encrypted backup and restore** — the Recovery Kit: encrypted archive plus a printable recovery token (D-040) |
| R-19 | **Recovery and break-glass** — host-level CLI for lockout, MFA reset, settings reset; all audited (`13-…` §7) |
| R-20 | **Migrations and upgrades** — automatic forward-only migration on start, automatic pre-migration backup, restore-then-migrate so an old backup runs on a new version (D-043 – D-048) |
| R-21 | **Diagnostics page** — effective configuration, value provenance, connectivity, migration state, backup age, version and advisory status; safe to paste in a public issue |
| R-22 | **Secure release artifacts** — signed images, SBOM, provenance, pinned dependencies, tag-only release workflow (F-18) |
| R-23 | Audit logging of security-, privacy- and domain-significant events, readable by the organisation |
| R-24 | GDPR rights: access, rectification, erasure, export — operated by the organisation itself |
| R-25 | Data retention policy with automated, dry-runnable enforcement |
| R-26 | Public surface cannot enumerate or expose any person, student, member, group or other private record (§3.4) |
| R-27 | DEV and UAT environments; the same tag publishes the public image |
| R-28 | CI blocking merges on failed tests, security checks, or a broken restore-from-any-release matrix |
| R-29 | *Conditional on OD-1:* one-time import path from the existing prototype |

### 3.2 Architecturally prepare — not built in v1

| ID | Requirement | Preparation |
|---|---|---|
| P-01 | Public REST API for integrations | Route handlers stay thin; application services are the shared layer; `/api/v1` versioning and scoped API credentials already exist |
| P-02 | Offline-tolerant attendance | Attendance writes are idempotent events carrying a client-generated id |
| P-03 | Payments / invoicing | Enrolment never grows a payment-state field; a seam is kept (OD-4) |
| P-04 | Guardian **portal** | The relationship and consent authority are built in v1 (R-04); only the login surface and its `RELATED` scope axis are deferred (OD-5) |
| P-05 | Multi-language content | Content tables carry a locale discriminator from day one |
| P-06 | Notifications beyond transactional email | Template's notification module stays in place |
| P-07 | Reporting / analytics | Audit, attendance and progress are append-only and queryable |
| P-08 | Larger single instances | Stateless app processes; no in-process session or cache state |
| P-09 | Portable certificates between organisations | Certificates are immutable numbered records, signable later (OD-12) |

### 3.3 Deliberately deferred

Waiting lists; resource/inventory management; staff shift planning; financial
administration; native mobile apps; e-learning content; SCIM provisioning; a
hosted "SplashTrack Cloud" (OD-14); any cross-instance data path.

**Note:** configurable SSO/OIDC was previously listed here. It is **not**
deferred — it is R-15, in v1.

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

## 4. Non-functional requirements

**Scope note.** SplashTrack is software that organisations run themselves. We
therefore state **software targets** (what the application must achieve on a
reference deployment) and **operator guidance** (what the organisation is
responsible for). *We cannot and do not offer an infrastructure SLA.*

### 4.1 Software targets — verified in CI on the reference deployment

| Area | Target | Verified by |
|---|---|---|
| Attendance write latency | p95 < 300 ms server-side for a group of 30 | Load test in CI against a seeded instance |
| Group skill matrix (30 × 40) | p95 < 500 ms, no N+1 | Query-count assertion in CI |
| Page interactive, portal on a 4G tablet | p95 < 2.5 s | Playwright trace budget |
| Cold start to serving | < 60 s including migrations | CI container test |
| Accessibility | WCAG 2.2 AA, including against configured brand colours | axe in E2E; contrast validated at save time |
| Browser support | Last 2 versions of Chrome/Edge/Safari/Firefox; iPadOS Safari first-class | Playwright matrix |
| Localisation | NL default, EN available; no hardcoded UI strings | Lint rule + missing-key check |
| Restore from any supported release | Succeeds and migrates forward | Restore matrix job (D-047) |
| Dependency risk | No known high/critical CVEs at merge | `npm audit` + Dependabot gate |
| Secret exposure | Zero secrets in the repository | Secret scanning + push protection |
| Resource footprint | Runs within 1 vCPU / 1 GB RAM for a small organisation | Documented and measured on the reference deployment |

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
| RPO | ≤ 24 h, ≤ 15 min with WAL archiving | Scheduled encrypted backups; backup-age warning on the dashboard (D-041) |
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
| **Instance administrator** | Yes, MFA required | Full control **of this installation**: settings, identity providers, backups, roles |
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

Concretely: their own `UserAccount`, a `COURSE`- or exam-session-scoped role
carrying only `exams.assess` and `exams.results.record`, a mandatory expiry date
after which the grant lapses automatically, MFA required as for any account with
write access to results, and every action attributed to them by name in the audit
trail.

**Reason.** A shared "examiner" login destroys attribution on exactly the records
that most need it — a child's diploma outcome. A full membership over-grants for
someone present for one afternoon.
**Trade-off.** Slightly more administration per exam day. That is the correct
cost for attributable, expiring access.
