# SplashTrack — Design & Architecture Phase

> Status: **Draft for review.** No application code is written in this phase.
> Every numbered deliverable from the assignment is covered; the index below
> maps assignment item → document section.

## Document set

| # | Deliverable | Where |
|---|---|---|
| 1 | Product vision | `00-overview.md` §1 |
| 2 | Core requirements | `00-overview.md` §3 |
| 3 | Non-functional requirements | `00-overview.md` §4 |
| 4 | User types | `00-overview.md` §5 |
| 5 | Roles & authorization model (scoping) | `02-security-privacy.md` §2 |
| 6 | Functional modules | `01-domain-model.md` §1 |
| 7 | Domain model | `01-domain-model.md` §2 |
| 8 | Entities & relations | `01-domain-model.md` §3 |
| 9 | Data ownership | `01-domain-model.md` §5 |
| 10 | GDPR / privacy model | `02-security-privacy.md` §5 |
| 11 | Trust boundaries | `02-security-privacy.md` §6 |
| 12 | Security architecture | `02-security-privacy.md` §1–4 |
| 13 | Deployment / isolation architecture | `03-deployment-model.md` §1 |
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
| 27 | Backup / restore | `07-operations.md` §2 |
| 28 | Failure modes | `07-operations.md` §3 |
| 29 | Scalability risks | `07-operations.md` §4 |
| 30 | Open architecture decisions | `08-open-decisions.md` |

Revision: `11-revision-single-tenant.md` records the move from a multi-tenant
to a single-tenant design (2026-08-31) and what it changed.

Cross-cutting: `09-decision-register.md` lists every **Decision / Reason /
Trade-off** in one table. `10-findings.md` lists gaps, inconsistencies,
security risks and scalability problems found while analysing the brief and
the two existing repositories.

---

## 1. Product vision

SplashTrack is a web application for organisations that teach, assess and
certify people — deployed as **one isolated instance per organisation**
(`03-deployment-model.md`) — starting with **swim schools** (the existing
`SplashTrack` repository is explicitly *"a custom solution for swim schools"*,
and the name, the skills/exam model and the poolside workflows all follow from
that).

The product thesis is a single sentence:

> **An instructor standing at the poolside with wet hands should be able to
> register attendance and sign off a skill for a whole group in under thirty
> seconds, on a tablet, without training — and the organisation behind them
> should get a compliant, auditable record of everything that happened.**

Everything else in this design serves that sentence. The management depth
(members, courses, exams, planning, CMS) exists because organisations need it,
but it must never leak complexity into the operational moment.

**Secondary thesis:** an organisation should be able to run its entire public
web presence on SplashTrack. Not as a WordPress replacement — as a small,
branded, content-managed site that shares identity, branding and data with the
portal so that "sign up for a course" is one system, not an integration.

### 1.1 What SplashTrack is not

Naming the non-goals now prevents scope creep later:

- Not a general-purpose CMS. No plugins, no page builder, no themes marketplace.
- Not an LMS. No e-learning content, no video hosting, no SCORM.
- Not a payment/invoicing platform in v1. Financial data is the single largest
  regulatory and complexity multiplier; see `08-open-decisions.md` OD-4.
- Not an HR system. Instructors are people with roles, not employees with
  contracts and payroll.
- Not offline-first as a v1 guarantee — but the attendance workflow is designed
  so that adding offline tolerance later does not require re-architecture
  (see `04-ux.md` §4.1).

---

## 2. Starting position — analysis of the existing repositories

This design is not greenfield. Two repositories exist and were analysed before
any decision below was taken.

### 2.1 `Jackldam/WebAppTemplate` (TypeScript, updated 2026-08-10)

A deliberately extracted, **mature** multi-tenant foundation. Not a scaffold.
SplashTrack runs it single-tenant, which *removes* work rather than adding it:
the tenancy machinery is dropped, everything else is reused.

- **~35 Prisma models**, 30 ADRs, an 862-line authoritative `Architecture.md`,
  and focused docs for security, privacy, database, API, branding, consent.
- Stack: Next.js App Router on Node, PostgreSQL, Prisma, Better Auth,
  Bootstrap themed via CSS custom properties, next-intl (NL + EN), Docker
  Compose, Playwright + Vitest, pino logging.
- Already implements, working: `Person` / `UserAccount` separation, org
  membership, roles + permissions + access groups + organisational units,
  platform vs organisation branding (`PlatformSettings`,
  `OrganizationBranding`, `UploadedAsset`), a custom-pages CMS (`CustomPage`,
  ADR-015/029), consent records (ADR-014/023), audit events, API credentials
  with scopes, MFA, passkeys, Microsoft Entra sign-in, email templates,
  maintenance jobs, rate-limit counters, GDPR person-erasure.
- CI already runs format, lint, typecheck, seed smoke-test, unit tests, build,
  Playwright E2E, **and a migrate-on-populated-database job** that replays this
  PR's migrations against a database populated at the base commit.

**Assessment: this is the single most valuable asset in the project.** It
answers, with tested code, roughly 70% of the assignment's non-domain
requirements — the exact 70% that is tedious, security-critical and easy to get
wrong.

Quality signal worth recording: the schema comments document *real* incidents.
`OrganizationBranding.updatedByPersonId` carries a long comment explaining that
a `Restrict` foreign key once caused a GDPR Article 17 erasure to roll back
entirely, and why the column is now `SetNull` as defence in depth. That is a
codebase that has been operated, not just written.

### 2.2 `Jackldam/SplashTrack` (TypeScript, updated 2026-07-13)

An **early prototype**, roughly one order of magnitude less developed.

- 12 Prisma models, ~102 TypeScript files, dependencies limited to Next, React,
  Better Auth, Prisma, Zod.
- Models: `User`, `Session`, `Account`, `Verification`, `Organization`,
  `OrganizationWelcomePage`, `Student`, `SwimGroup`, `GroupMembership`,
  `OrganizationMember`, `OrganizationMemberCapability`, `AuditLog`.
- Confirms the domain: swim groups, students, per-org welcome page,
  capability-based org membership.

**Assessment: valuable as domain evidence, not as a foundation.** It has no
`Person`/`UserAccount` split (the assignment explicitly requires one), no
branding system, no CMS, no API layer, no consent or retention model, and no
organisational scoping primitive.

### 2.3 The first and most consequential decision

**Decision D-001 — Build SplashTrack v2 from `WebAppTemplate`; port the swim
domain as concepts, not as code.**

**Reason.** The assignment's own priorities — security first, GDPR by design,
privacy by default, least privilege, auditability, minimal code, modular
design — are precisely the properties the template already has and the
prototype lacks. Rebuilding those from the prototype would mean re-deriving
`Person`/`UserAccount`, org scoping, RBAC, branding, consent and audit from
scratch, which contradicts *"minimale hoeveelheid code"*. Meanwhile the
prototype's genuinely valuable output is knowledge — that the domain needs
swim groups, that org members carry capabilities, that orgs want a welcome
page — and knowledge ports for free.

**Trade-off.** The existing SplashTrack code and its migration history are
discarded, including work someone spent real time on. Any live prototype data
requires a one-time export/import rather than a migration chain. We accept
this because the prototype has no production users to protect (to be confirmed
— see `08-open-decisions.md` OD-1), and because carrying its schema forward
would import the exact technical debt the brief warns against.

**Explicitly rejected alternative:** evolving the prototype and back-porting
template features. Rejected because it inverts the effort — it is far cheaper
to add ~10 domain models to a hardened foundation than to add a hardened
foundation to ~10 domain models.

---

## 3. Core requirements

Split by the three categories the assignment demands. **"Prepare"** means the
architecture must not need rework when the feature arrives; it does not mean
building it now.

### 3.1 Build now (v1)

| ID | Requirement |
|---|---|
| R-01 | Single-tenant deployment per organisation; scripted provisioning |
| R-02 | `Person` exists independently of `UserAccount`; a student may have no login |
| R-03 | Authentication with MFA mandatory for privileged roles |
| R-04 | Scoped permission authorization (org/unit/group/course/self), deny by default, server-side |
| R-05 | Member/people administration (the PII anchor) |
| R-06 | Student profiles: the swim-domain view of a Person |
| R-07 | Groups (`SwimGroup` successor) with membership over time |
| R-08 | Courses / training programmes and enrolment |
| R-09 | Skills catalogue, per-student progress, sign-off by an instructor |
| R-10 | Attendance registration — the flagship operational workflow |
| R-11 | Exams: sessions, candidates, examiners, results, history |
| R-12 | Planning: lessons, groups, locations, instructors, resources |
| R-13 | Branding without code changes |
| R-14 | Simple public website / CMS per organisation |
| R-15 | Audit logging of security- and privacy-relevant events |
| R-16 | GDPR rights: access, rectification, erasure, export |
| R-17 | Data retention policy with automated enforcement |
| R-18 | DEV and UAT environments with promotable artifacts; fleet rollout automation |
| R-19 | CI blocking merges on failed tests or security checks |

### 3.2 Architecturally prepare (not built in v1)

| ID | Requirement | Preparation required |
|---|---|---|
| P-01 | Public REST API for integrations | Route handlers stay thin; services are the shared layer; `/api/v1` versioning and API credentials already exist in the template |
| P-02 | Offline-tolerant attendance | Attendance writes modelled as idempotent, client-generated-id events |
| P-03 | Payments / invoicing | Never couple enrolment to a payment state field; keep a seam |
| P-04 | Parent/guardian portal | `Person`↔`Person` relationship table exists from day one |
| P-05 | Multi-language content | Content tables carry a locale discriminator from day one |
| P-06 | Notifications (email/push) | Template's notification + email-template modules stay in place |
| P-07 | Reporting / analytics | Audit and attendance are append-only and queryable |
| P-08 | Horizontal scaling | Stateless app processes; no in-process session or cache state |

### 3.3 Deliberately deferred

Waiting lists; resource/inventory management; shift planning for staff;
financial administration; mobile native apps; SSO per organisation (the
template has Entra for the platform, per-tenant IdP is a later ADR);
e-learning content; a public API marketplace; SCIM provisioning.

---

## 4. Non-functional requirements

| Area | Target | How it is verified |
|---|---|---|
| Attendance write latency | p95 < 300 ms server-side for a full group | Load test in CI on a seeded 30-student group |
| Page interactive (portal, 4G tablet) | p95 < 2.5 s | Playwright trace budget |
| Availability (PROD, once live) | 99.5% monthly | Uptime probe on `/api/ready` |
| RPO / RTO | RPO ≤ 24 h, RTO ≤ 4 h | Quarterly restore drill (`07-operations.md` §2) |
| Concurrent orgs | 100 orgs / 50k persons on one Postgres instance | Seeded volume test before PROD |
| Accessibility | WCAG 2.2 AA on portal + public site | axe checks in E2E, contrast validated against org brand colours |
| Browser support | Last 2 versions of Chrome/Edge/Safari/Firefox; iPadOS Safari is a first-class target | Playwright matrix |
| Localisation | NL default, EN available; no hardcoded UI strings | Lint rule + missing-key check in CI |
| Test coverage | Every vertical slice ships data model → service → UI → tests | Definition of Done, enforced in review |
| Dependency risk | No known high/critical CVEs at merge | `npm audit` + Dependabot gate |
| Secret exposure | Zero secrets in the repository | Secret scanning gate, push protection on |

**Deliberate non-target:** SplashTrack does not aim for sub-second global
latency or multi-region deployment. Its users are geographically concentrated
per organisation; a single well-placed region is correct until proven otherwise.

---

## 5. User types

The assignment's most important structural rule is that **a person is not an
account**. These are two different tables, two different lifecycles, and two
different privacy postures. The user types below are therefore expressed as
*roles a Person may hold*, not as account types.

| Type | Has login? | Primary need | Notes |
|---|---|---|---|
| **Student / member** | Usually not (children); optionally yes (adults) | Be registered, progress, be assessed | The dominant population. Most have **no account at all** — they exist only as administrative records |
| **Parent / guardian** | Optional, v2 | See their child's progress and attendance | Modelled as a `PersonRelationship` from day one (P-04), portal deferred |
| **Instructor / teacher** | Yes | Register attendance, sign off skills, see their groups | The performance-critical user. Optimise for them |
| **Examiner** | Yes | Assess exam candidates, record results | Often an instructor with an extra role; sometimes external and temporary |
| **Planner / coordinator** | Yes | Build schedules, assign instructors and locations | Desktop-first user |
| **Organisation administrator** | Yes, MFA required | Manage people, roles, branding, content, policies | Full control **within one organisation only** |
| **Content editor** | Yes | Maintain the public website | Deliberately separable from org admin (least privilege) |
| **Platform super administrator** | Yes, MFA required | Operate SplashTrack itself, create organisations | Cross-organisation. The one dangerous role; every use logged at `warn` |
| **Anonymous visitor** | No | Read public pages, find courses, contact the org | Must never be able to enumerate persons or organisations |
| **API consumer** | No (credential) | Integrate | Scoped API credential, not a user session (P-01) |
| **Lucky (AI dev agent)** | Not a product user | Develop within DEV | Has **no identity in the application at all** — see `06-delivery.md` §4 |

### 5.1 Two clarifications that change the model

**A student is not a user type — it is a profile on a Person.** The same human
may be a student in one organisation and an instructor in another. Modelling
"student" as an account type would make that impossible and would force
duplicate PII. Consequently `StudentProfile` is an org-scoped table referencing
`Person`, exactly as the template's Architecture.md §8 prescribes for domain
profiles.

**An examiner is not necessarily a member of the organisation.** Swim diplomas
are frequently assessed by an external examiner who appears for one afternoon.
This is a real requirement the brief does not state and is easy to design out
of by accident. The model must allow an `ExamSession` to reference an examiner
`Person` who holds a narrowly-scoped, time-bounded role — not full org
membership. Recorded as finding **F-03** in `10-findings.md`.
