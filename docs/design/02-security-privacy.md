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

## 2. Authorization — permissions × scope

With tenancy gone, authorization carries the full weight of "who may see and do
what". Inside one organisation that is a harder and more interesting problem
than tenant isolation was, and it is where the brief's *"met scoping alle
rechten granulair"* requirement lands.

### 2.1 The model

A grant is not a permission. **A grant is a permission plus a scope.**

```text
Person ──< RoleAssignment >── Role ──< RolePermission >── Permission
              │
              └── scope: { type, id }        ← the granular axis
```

`RoleAssignment(personId, roleId, scopeType, scopeId)` where `scopeType` is one
of:

| Scope type | Meaning | Example |
|---|---|---|
| `ORGANIZATION` | The whole instance | Organisation administrator |
| `UNIT` | One `OrganizationUnit` **and its descendants** | "Planner for Locatie Zuidbad" |
| `GROUP` | One specific group | "Instructor of Groep A1" |
| `COURSE` | One course across groups | "Examiner for Diploma B" |
| `SELF` | The holder's own records | Every authenticated person, implicitly |
| `RELATED` | Persons the holder is related to | Guardian → their children (v2 portal, table exists in v1) |

The same person may hold several assignments simultaneously: instructor of two
groups, planner for one location, and a member of the organisation. Their
effective reach is the **union** of their grants.

### 2.2 The authorization question

Every protected operation asks one question:

```text
requirePermission(session, 'attendance.record', { group: groupId })
```

Resolution: does the caller hold *any* grant whose permission includes
`attendance.record` **and** whose scope covers the referenced resource? Scope
coverage walks the unit tree upward — a grant on `Locatie Zuidbad` covers
`Groep A1` beneath it.

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
resolveReach(session, 'students.read') → { units: [...], groups: [...], all: false }
```

Repositories accept a reach object and constrain the query with it. A single
helper, used everywhere, means there is one place to get list filtering right —
the same architectural benefit a central tenant-scoping extension would have
provided, applied to the boundary that still exists.

**Decision D-031 — Reach resolution is centralised and repositories cannot be
called without it.**
**Reason.** Scoping bugs in list endpoints are the most likely remaining data
exposure, because a missed filter silently returns everything. Making reach a
required repository argument turns a silent over-fetch into a type error.
**Trade-off.** Repository signatures are noisier. Worth it — this is now the
highest-risk code path in the application.

### 2.4 Starter roles

| Role | Typical scope | Purpose |
|---|---|---|
| Organisation Administrator | `ORGANIZATION` | Full control. MFA required |
| Location Manager | `UNIT` | Everything within one location and below |
| Planner | `UNIT` or `ORGANIZATION` | Schedules, groups, locations, instructor assignment |
| Instructor | `GROUP` (one per group taught) | Attendance, skill sign-off, read student basics |
| Examiner | `COURSE` or a single exam session, time-bounded | Exam results only |
| Member Administrator | `UNIT` or `ORGANIZATION` | People and student administration, enrolments |
| Content Editor | `ORGANIZATION` | Public pages and branding. **No person data** |
| Read-only Viewer | `UNIT` | Oversight and reporting |
| Instance Operator | `ORGANIZATION` | Bootstrap, integrations, technical settings. MFA required |

Note there is no platform-wide super administrator any more: there is no
platform. Each instance has its own operator, and that operator's reach ends at
their own deployment (§1 of `03-deployment-model.md`).

### 2.5 Permission catalogue

Unchanged in content from the earlier design, but every key is now evaluated
against a scope. Domain additions:

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
exams.results.record   certificates.issue    certificates.revoke

planning.read          planning.manage

pages.read             pages.manage          branding.manage
organization.settings.manage                 audit.read
privacy.export         privacy.erase
```

**Decision D-010 (unchanged) — Medical/pastoral notes have their own permission
pair and their own audit event type.**
**Reason.** GDPR special-category data must be least-privilege by default. An
instructor with `students.read` scoped to their group still should not
automatically see a child's medical history; that requires
`students.medical.read`, and every read of it is audited.
**Trade-off.** An extra permission to administer and a UI that must degrade
gracefully when the field is unreadable. This is the highest-risk data in the
product; the cost is justified.

### 2.6 Access groups

For organisations that need bundles rather than per-resource assignments, the
inherited `AccessGroup` primitive (ADR-018/019) groups permissions and scopes
into a named, reusable set — "Zwemles-instructeur Zuidbad" — assigned in one
action. This is convenience over the model above, never a bypass of it.

---

## 3. Defence in depth without tenancy

The old design leaned on three tenancy layers. Two of them are gone; what
replaces them is narrower but still layered:

1. **Deployment isolation.** Separate process, database, storage and domain per
   organisation. This is now the outermost and strongest boundary, and it is
   enforced by infrastructure rather than by code.
2. **Scope enforcement.** `requirePermission(..., resourceRef)` for writes and
   single-resource reads; `resolveReach()` for lists. Deny by default, including
   on unexpected failure.
3. **Scope tests.** Every module ships tests asserting that a `GROUP`-scoped
   instructor cannot read, write, or list outside their groups, and that a
   `UNIT`-scoped role cannot escape its subtree. These replace the old
   isolation suite the multi-tenant design would have needed, and are equally
   non-optional for Definition of Done.

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

`$queryRaw` / `$executeRaw` no longer risk cross-tenant leaks, but they *do*
bypass reach filtering. They still require an explicit reviewer sign-off and
are flagged by a lint rule.

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
│   ORGANIZATION ▸ UNIT ▸ GROUP ▸ COURSE ▸ SELF ▸ RELATED         │
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
| Scope → wider scope | A `GROUP`-scoped role cannot reach the unit; a `UNIT`-scoped role cannot escape its subtree | Scope-escape tests per module (D-032) |
| Ordinary → special-category | Separate permission, audited, encrypted | D-010, D-013 |
| DEV → UAT → PROD | Artifacts promote; data never does | CI/CD design (`06-delivery.md`) |
| Lucky → PROD | **No path exists.** Not "restricted" — absent | No credentials issued (`06-delivery.md` §4) |
| CI → an instance | Per-instance deploy credentials, short-lived OIDC | GitHub Environments, one per instance |
| Instance → instance | No operator credential grants access to a second instance | Per-instance secrets (D-029) |

### 6.2 Abuse scenarios considered

| Scenario | Mitigation |
|---|---|
| Instructor tablet stolen from pool deck | `SHARED_DEVICE` mode, short idle timeout, no export, remote session revocation |
| **Instructor browses students they don't teach** | `GROUP`-scoped grants; reach-filtered lists; scope-escape tests. **This is now the primary internal threat** |
| Location manager reads another location's records | `UNIT` scope walks down the tree only, never sideways or up |
| Org admin exports the whole member base and leaves | Export requires step-up, is rate-limited, raises a high-severity audit event |
| Parent guesses another child's record via ID | Opaque non-sequential IDs; scope check on every fetch; no enumeration |
| Public site used to enumerate members | Public surface never queries person tables (`03-deployment-model.md` §5.1) |
| Malicious/compromised dependency | Lockfile, Dependabot, audit gate, no post-install scripts from new deps without review |
| Compromised Lucky / prompt injection via issue text | No PROD path, no real data, no secret access; all output arrives as a reviewed PR (`06-delivery.md` §4.3) |
| Backup exfiltration | Backups encrypted per instance; special-category columns separately encrypted |
| **Compromise of one customer's instance** | Blast radius is one organisation. No shared credentials, no control plane, no lateral path (D-029) |
| **Operator with fleet deploy rights** | The genuinely dangerous principal now. Per-instance credentials in protected environments, required reviewers, all deploys audited — finding **F-14** |
