# 02 — Security & Privacy Architecture

Security is not a section of this design; it is the constraint the rest of the
design was shaped around. This document states the rules that any
implementation must satisfy.

## 1. Security architecture — foundations

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
- **MFA is mandatory** for `platform.super_admin` and organisation
  administrator roles. Passkeys are supported and preferred — they are also the
  best answer to "wet hands, shared tablet, hostile to typing passwords".
- Sessions invalidate immediately when an account is disabled.
- Step-up re-authentication for: role changes, API credential creation, MFA
  reset, bulk export, erasure, certificate revocation.

**Decision D-008 — Better Auth handles identity and sessions only; it is never
the authorization layer.**
**Reason.** Authorization depends on organisation scope, membership state and
resource ownership, which are application concerns. Conflating them is how
tenant leaks happen.
**Trade-off.** Two systems to reason about instead of one. Accepted — the
separation is the point.

### 1.3 Session security at the poolside — a domain-specific control

The instructor workflow runs on a shared device in a wet, public environment.
This is a genuine threat the generic template does not address.

**Decision D-009 — Introduce a "session device mode" for shared tablets.**
A session may be marked `SHARED_DEVICE`, which (a) shortens idle timeout,
(b) suppresses PII beyond first name + photo in list views, (c) blocks export,
bulk operations and all admin routes outright, and (d) requires step-up to
leave the attendance/skills context.
**Reason.** Least privilege applied to *context*, not just role. An instructor
does not need the member administration on the pool deck, so the pool-deck
session should not be able to reach it even though the role technically could.
**Trade-off.** A second dimension in authorization checks, which adds
complexity to a security-critical path. Mitigated by implementing it as a
single deny-list evaluated in `requirePermission`, not scattered per route.

---

## 2. Roles and authorization model

### 2.1 Mechanism

Permission-based, never role-name-based. Business logic asks
`requirePermission(session, orgId, 'attendance.record')`, never
`if (role === 'instructor')`.

```text
Person ──< RoleAssignment (org-scoped) >── Role ──< RolePermission >── Permission
Person ──< PlatformRoleAssignment >────── Role      (the explicit exception path)
Person ──< AccessGroup membership >────── narrower resource reach
```

Membership and permission are checked **together**. A permission check without
a membership check would let a permission held in Organisation A read
Organisation B's data — the template documents this explicitly and we keep it.

### 2.2 Starter roles for SplashTrack

| Role | Scope | Purpose |
|---|---|---|
| Platform Super Administrator | Platform | Operate SplashTrack. Assigned to no one by seed. MFA required |
| Platform Support | Platform | Read-only diagnostics, **no PII access** — see D-011 |
| Organisation Administrator | Org | Full control within one organisation. MFA required |
| Planner | Org | Schedules, groups, locations, instructor assignment |
| Instructor | Org | Own groups: attendance, skills sign-off, read student basics |
| Examiner | Org (may be time-bounded) | Exam sessions and results only |
| Member Administrator | Org | People and student administration, enrolments |
| Content Editor | Org | Public pages, branding assets. **No access to person data** |
| Read-only Viewer | Org | Reporting and oversight |

### 2.3 Permission catalogue (domain additions)

Added to the template's catalogue, following its naming convention:

```text
people.read            people.create         people.update
people.delete          people.export

students.read          students.create       students.update
students.archive       students.notes.read   students.notes.write
students.medical.read  students.medical.write     (special category — separately gated)

groups.read            groups.manage         groups.assign_members
courses.read           courses.manage        enrolments.manage

skills.read            skills.manage_catalogue
skills.assess                                (sign-off — the instructor's core act)
skills.revoke                                (undo an achieved skill — privileged)

attendance.read        attendance.record     attendance.amend
                                             (amend = change a past record; separately gated)

exams.read             exams.manage          exams.assess
exams.results.record   certificates.issue    certificates.revoke

planning.read          planning.manage

pages.read             pages.manage
branding.manage
organization.settings.manage
audit.read
privacy.export         privacy.erase         (GDPR operations — always step-up + audited)
```

**Decision D-010 — Medical/pastoral notes have their own permission pair and
their own audit event type.**
**Reason.** GDPR special-category data must be least-privilege by default; a
planner or content editor never needs it, and reading it should leave a trace
even for those who may. Folding it into `students.read` would grant it to
everyone who can see a class list.
**Trade-off.** An extra permission to administer, and a UI that must degrade
gracefully when the field is not readable. Worth it — this is the highest-risk
data in the product.

**Decision D-011 — Platform Support cannot read tenant personal data.**
**Reason.** "Least privilege" is meaningless if the operator role can read
every child's medical note. Support diagnoses with audit metadata, IDs and
aggregate counts. Reading tenant PII requires `platform.super_admin`, step-up
auth, and emits a `warn`-level audit event visible to the organisation.
**Trade-off.** Some support cases become harder and need customer cooperation.
That is the correct trade for a system holding data about minors.

---

## 3. Organisation isolation

Isolation is defence in depth, three layers, and the design assumes each layer
will eventually fail:

1. **Query scoping.** `forOrganization(orgId)` — a Prisma client extension
   injecting `organizationId` into `where`/`data` centrally. Does **not** cover
   `$queryRaw`/`$executeRaw`; those must be scoped by hand and are flagged in
   review.
2. **Composite foreign keys.** A child row's `organizationId` must match its
   parent's, enforced by the database (D-006). A cross-tenant write is rejected
   by Postgres even if the application logic is wrong.
3. **Isolation tests.** Every module ships tests that attempt cross-tenant
   reads and writes and assert 403/empty. These are not optional; a module
   without them fails Definition of Done.

**Decision D-012 — Single database, shared schema, row-level tenancy.**
**Reason.** Schema-per-tenant multiplies migration risk by the tenant count and
makes cross-org platform operations painful; database-per-tenant multiplies
operational cost. Row-level scoping with the three layers above is the KISS
answer at the stated scale (100 orgs / 50k persons).
**Trade-off.** A single catastrophic scoping bug affects all tenants rather
than one. Accepted because the layered mitigations make a single bug
insufficient to cause a leak — and because "prepare, don't build" applies: if a
tenant ever contractually requires physical isolation, the org-scoped design
allows extraction of that tenant without a rewrite.

---

## 4. Application security controls

| Control | Approach |
|---|---|
| Input validation | Zod schemas at every boundary; validation is a module concern, colocated with the service |
| Output encoding | React escaping by default; CMS content is sanitised server-side against an allow-list |
| CSRF | Better Auth cookie protections + `SameSite`; Server Actions carry framework protection |
| Rate limiting | `RateLimitCounter` (inherited) on login, password reset, export, public forms |
| Secrets | Never in the repository. Environment-injected; GitHub Environments hold deploy secrets; secret scanning + push protection block accidents |
| Encryption in transit | TLS everywhere, HSTS, no mixed content. Internal service-to-database traffic is TLS as well |
| Encryption at rest | Full-disk/volume encryption plus **column-level encryption for medical/pastoral notes** (D-013) |
| File uploads | `UploadedAsset` (inherited): type allow-list, size limits, served through an authorising route — never a public bucket path. **EXIF stripped from photos** |
| Dependency security | Dependabot + `npm audit` gate; high/critical blocks merge |
| Headers | CSP (nonce-based), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Abuse | Public forms behind rate limits and a bot check; no user enumeration in any error message |

**Decision D-013 — Column-level encryption for special-category data only.**
**Reason.** Encrypting everything at column level breaks search and sorting for
no proportionate benefit when the volume is already encrypted at rest.
Encrypting the two highest-risk columns (medical/pastoral notes) means a
database dump or a backup leak does not expose health data about children.
**Trade-off.** Those fields become unsearchable and key management becomes a
real operational duty (rotation, escrow, restore). We accept unsearchability —
nobody needs to full-text search medical remarks — and OD-7 tracks the key
management decision.

**Photographs deserve explicit mention.** Swim schools photograph children for
identification on class lists. A photo of a minor is personal data, arguably
biometric-adjacent, and is the field most likely to be added casually. It is
therefore: consent-gated (`consent` module), suppressed in `SHARED_DEVICE`
sessions only for non-assigned groups, EXIF-stripped, served through an
authorising route, and deleted on erasure. Finding **F-04**.

---

## 5. GDPR / privacy model

### 5.1 Roles under the GDPR

- Each **organisation** is the *controller* for the personal data it manages.
- **SplashTrack (the operator)** is the *processor*, and the controller only
  for platform-level data (organisation records, platform admin accounts).
- This split must be reflected in a **Data Processing Agreement** per
  organisation. That is a document, not code — but the product must not
  contradict it. Finding **F-05**.

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

The only special-category data SplashTrack collects is **health-related**:
medical remarks, allergies, physical limitations relevant to water safety.

Rules: separate permission pair (D-010); column-encrypted (D-013); every read
audited; excluded from all exports unless the export explicitly requests it and
the requester holds `students.medical.read`; hard-deleted (not anonymised) at
12 months after enrolment ends; never present in logs, ever.

### 5.4 Consent

The inherited `consent` module records consent as first-class evidence: what
was consented to, which version of which text, by whom, when, and how it was
withdrawn. SplashTrack needs consent for: photographs, publication of results
in a public list, marketing email, and any org-defined profile field.

**Consent for a minor is given by a guardian.** The `PersonRelationship` table
(v1) is what makes this recordable — the consent points at the consenting
`Person` (the guardian) *and* the subject `Person` (the child). Designing this
in later would mean rewriting every existing consent row. Finding **F-02**.

### 5.5 Data subject rights

| Right | Mechanism | Who can run it |
|---|---|---|
| Access / inzage | Generates a structured export (JSON + human-readable PDF) of everything about one Person within one org | Org admin with `privacy.export`, step-up required |
| Rectification | Ordinary edit on `Person` / profile; all edits audited | Member administrator |
| Erasure | `person-erasure` transaction: anonymise `Person`, sever pointers, hard-delete special-category data, retain pseudonymised legal records (D-007) | Org admin with `privacy.erase`, step-up, and a confirmation naming the retained records |
| Portability | Same export as access, machine-readable | As access |
| Restriction | `Person` flagged; writes blocked, reads audited | Org admin |
| Objection | Marketing/consent withdrawal is self-service where an account exists | Data subject or guardian |

The template already implements the erasure transaction and knows where the
sharp edges are (its `OrganizationBranding.updatedByPersonId` comment
documents a real Article 17 rollback incident). SplashTrack extends the same
transaction with the domain tables rather than inventing a parallel path.

**Decision D-014 — Erasure is a single transaction with an explicit table
registry.**
**Reason.** A per-module "clean yourself up" hook silently fails when someone
forgets to register a new table. A central registry with a test asserting that
*every* table referencing `Person` appears in it makes forgetting impossible to
merge.
**Trade-off.** The registry is a shared file that every module edits — mild
coupling, deliberately accepted for a compliance-critical path.

### 5.6 Retention

Retention rules live in the `maintenance` module as scheduled jobs, with a
dry-run mode and a report before anything is deleted. Defaults are stated in
`01-domain-model.md` §5. Each organisation may **shorten** a retention period,
never lengthen it beyond the platform maximum.

### 5.7 Logging without personal data

Operational logs (pino) carry: request id, org id, person id (**opaque id
only**), route, outcome, duration. Never names, emails, notes, or request
bodies. The audit trail is the place where "who did what to whom" is recorded,
with access control on top of it — logs and audit are different systems with
different retention and different readers.

---

## 6. Trust boundaries

```text
┌─────────────────────────────────────────────────────────────────┐
│ INTERNET (untrusted)                                            │
│   anonymous visitors · authenticated users · API consumers      │
└───────────────┬─────────────────────────────────────────────────┘
                │  TLS · WAF/rate limit · CSP
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 1 — Application edge (Next.js middleware)              │
│   session resolution · CSRF · headers · public vs portal split  │
└───────────────┬─────────────────────────────────────────────────┘
                │  requirePermission() — the ONLY authorization gate
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 2 — Organisation isolation                             │
│   forOrganization() · composite FKs · isolation tests           │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│   │   Org A     │  │   Org B     │  │   Org C     │             │
│   └─────────────┘  └─────────────┘  └─────────────┘             │
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 3 — Special-category data                              │
│   separate permissions · column encryption · audited reads      │
└───────────────┬─────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│ BOUNDARY 4 — Environment separation                             │
│   DEV  ──promote──▶  UAT  ──promote──▶  PROD                    │
│   synthetic data      synthetic data      real data             │
│   Lucky: full         Lucky: read-only    Lucky: NO ACCESS      │
└─────────────────────────────────────────────────────────────────┘
```

### 6.1 The boundaries stated as rules

| Boundary | Rule | Enforced by |
|---|---|---|
| Internet → App | No trust in any client input | Validation at every entry point |
| App → Data | Every protected operation calls `requirePermission` | Code review + a lint rule requiring the guard in route handlers |
| Org A → Org B | No read or write crosses a tenant | Scoping extension, composite FKs, isolation tests |
| Ordinary → special-category | Separate permission, audited, encrypted | D-010, D-013 |
| DEV → UAT → PROD | Artifacts promote; data never does | CI/CD design (`06-delivery.md`) |
| Lucky → PROD | **No path exists.** Not "restricted" — absent | No credentials issued; see `06-delivery.md` §4 |
| CI → Cloud | Short-lived OIDC tokens, no long-lived cloud keys | GitHub Environments + OIDC |

### 6.2 Abuse scenarios considered

| Scenario | Mitigation |
|---|---|
| Instructor tablet stolen from pool deck | `SHARED_DEVICE` mode, short idle timeout, no export, remote session revocation |
| Instructor browses students they don't teach | Instructor permissions scoped to assigned groups via access groups; out-of-scope reads audited |
| Org admin exports the whole member base and leaves | Export requires step-up, is rate-limited, and raises a high-severity audit event |
| Parent guesses another child's record via ID | Opaque non-sequential IDs; authorization on every fetch; no enumeration |
| Public site used to enumerate members | Public surface never queries person tables (`03-multi-org.md` §3.2) |
| Malicious/compromised dependency | Lockfile, Dependabot, audit gate, no post-install scripts from new deps without review |
| Compromised Lucky / prompt injection via issue text | Lucky has no PROD path, no real data, no secret access; all output arrives as a reviewed PR (`06-delivery.md` §4.3) |
| Backup exfiltration | Backups encrypted; special-category columns separately encrypted; restore drills audited |
| Support engineer curiosity | D-011 — platform support cannot read tenant PII |
