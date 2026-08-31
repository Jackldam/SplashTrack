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
client id, encrypted client secret, scopes, claim→field mapping, whether
just-in-time account creation is allowed, and which role a JIT-created account
receives (**default: none**).

**Trade-off.** Runtime-configurable providers mean a misconfiguration can lock
an organisation out of its own instance. Two mandatory mitigations: local
administrator login can never be disabled while it is the only working method,
and a provider configuration must survive a **test connection** before it can
be enabled. Storing secrets in the database also makes the encryption key a
first-class operational concern — the same key management question as OD-7.

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
than a tenant boundary would have been, and it is where the brief's *"met
scoping alle rechten granulair"* requirement lands.

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
effective reach is the **union** of their grants.

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
| `UNIT` | **That unit only** — every group, session, student and exam session directly beneath it. No descendant walk (D-121) |
| `GROUP` | That group, its scheduled sessions, and the students in it *for the period of their membership* |
| `COURSE` | That course, its levels, its enrolments, and **all** its exam sessions |
| `SESSION` | **That one session's roster only** — the students on it, for the window the grant is valid, and (for an exam or aftest session) the assessment/results being recorded there. Nothing else, not the course, not the students' other records |
| `SELF` | Records whose subject is the holder |

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
one place to get list filtering right, which is the boundary that actually
exists in a single-organisation installation.

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
| Instance Administrator | `ORGANIZATION` | Full control **of this installation**: settings, identity providers, backups, roles. MFA required. This is the highest authority that exists |
| Location Manager | `UNIT` | Everything within one location and below |
| Planner | `UNIT` or `ORGANIZATION` | Schedules, groups, locations, instructor assignment |
| Instructor | `GROUP` (one per group taught) | Attendance, skill sign-off, read student basics |
| Internal examiner | `COURSE`, time-bounded | Assesses any exam session of that course |
| External examiner | `SESSION`, always with an expiry | One exam session only. A `Person` with no membership (D-052) |
| Independent aftest assessor | `SESSION`, always with an expiry | Grades one *aftest*, held by an instructor who is not the student's own (D-085, `15-assessment-and-fees.md` §3) |
| Member Administrator | `UNIT` or `ORGANIZATION` | People, **memberships** and student administration, enrolments — three distinct concepts (`01-domain-model.md` §3.1) |
| Content Editor | `ORGANIZATION` | Public pages and branding. **No person data** |
| Read-only Viewer | `UNIT` | Oversight and reporting |

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
   scope-escape suite is non-optional for Definition of Done.

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
matters here. They still require an explicit reviewer sign-off and
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

**Decision D-064 — The organisation is the controller. Publishing self-hosted
software does not make the SplashTrack project a processor.**

- The **organisation** running the installation is the *controller*: it decides
  the purposes and means of processing.
- The **SplashTrack project** publishes software. It processes no personal data
  on anyone's behalf and is therefore **not** a processor by virtue of
  publishing. No data processing agreement arises between the project and an
  organisation from use of the software alone.
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

The only special-category data SplashTrack collects is **health-related**:
medical remarks, allergies, physical limitations relevant to water safety.

Rules: separate permission pair (D-010); column-encrypted (D-013); every read
audited; excluded from all exports unless the export explicitly requests it and
the requester holds `students.medical.read`; hard-deleted (not anonymised) from
**live storage** at 12 months after enrolment ends; never present in logs, ever.

**The 12-month figure is a live-storage promise, not a total one.** A deleted
row can still be present in an already-taken encrypted backup until that
backup ages out (D-042, `14-backup-restore-upgrade.md` §3.2/§5.2) — up to the
backup retention window plus, for pre-migration backups, three further
upgrades. The organisation's own privacy notice must state both figures and
the resulting **backup horizon** (the latest date at which a deleted note can
still exist, encrypted, in a backup archive) rather than implying that "hard
deleted" means gone everywhere the moment the row is removed. Finding **F-59**.

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

**Access/inzage is staged, not fully specified — Finding F-88.** The export
above discloses more than the requesting organisation may realise: guardian
details, instructor names on sign-offs, staff-authored notes and audit actor
ids are other people's personal data with no preview or redaction pass, while
erasure next door requires one. Separately, medical data is included only when
the *requester* (the staff member running the export) holds
`students.medical.read` — but the entitled party in an Article 15 request is
the **data subject**, so a member administrator without that permission
produces an export that looks complete and is silently missing the health
data. **Required before this ships:** reuse the erasure preview pattern for
export, including what is disclosed about third parties, and make the export
**fail loudly** (refuse, naming the missing permission) rather than silently
omitting a category. Not designed further here.

**Decision D-014 — Erasure is a single transaction with an explicit table
registry.**
**Reason.** A per-module "clean yourself up" hook silently fails when someone
forgets to register a new table. A central registry with a test asserting that
*every* table referencing `Person` appears in it makes forgetting impossible to
merge.
**Trade-off.** The registry is a shared file that every module edits — mild
coupling, deliberately accepted for a compliance-critical path.

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
