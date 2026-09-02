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
  the tuple as written. **Mandatory is not the same as bounded**, and as first
  written nothing constrained the *value*: the ceilings for `SESSION` and
  `COURSE`, and the rule for a null granter window, are stated once in §2.6.1
  (D-170).
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
2. **Scope confinement — by resource containment, never by type ranking**
   (D-170). The set of resources the proposed grant would cover must be a
   **subset** of the set the granter's own grant of that same permission covers,
   computed through §2.2's coverage rules and evaluated live (D-145). A
   `UNIT`-scoped Location Manager cannot grant anything `ORGANIZATION`-scoped,
   and cannot grant at a unit that is not theirs — which under D-121's flat
   `UNIT` means their own unit and nothing else.
3. **Window confinement.** `validFrom`/`validUntil` must fall inside the
   granter's own window for that permission — and where the granter's own window
   is null, inside their **maximum grantable window** rather than inside
   infinity (D-170). A `SESSION`-scoped assessor cannot issue a grant that
   outlives their own.

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

**All three invariants are scope-escape test cases**, per module, under D-032: a
granter attempting to grant a permission they lack, a granter attempting to
grant over resources their own grant does not cover, and a granter attempting to
issue a window wider than their own — all denied, asserted at the service,
because the UI hiding the option is not authorization (§1.1 rule 1).

#### 2.6.1 What "at or below" means, and what bounds the window

Invariants 2 and 3 were stated in terms an implementer cannot execute, and both
gaps fail *open* in the direction that matters.

**Invariant 2 rested on an ordering no chapter defines.** "At or below" appeared
in this decision and nowhere else; there is no partial order over
`{ORGANIZATION, UNIT, GROUP, COURSE, SESSION, SELF}` anywhere in the design set,
and only the two unambiguous examples were given. The obvious implementation is
a breadth ranking — `ORGANIZATION > UNIT > COURSE > GROUP > SESSION > SELF`,
because a course names fewer resources than a unit — and §2.1's own table places
`COURSE` **across** units: *"One course across groups"*, with §2.2 coverage of
*"that course, its levels, its enrolments, and **all** its exam sessions"*. So a
`UNIT`-scoped Location Manager at Zuidbad, holding `exams.manage` and
`roles.assign` there, grants themselves `exams.results.record` at
`COURSE = Diploma B`; `COURSE` ranks "below" `UNIT`, every check passes, and
reach now covers Diploma B's exam sessions **at Noordbad**, where D-062 makes
their amendment the effective result. The mirror failure is equally available:
an implementer who ranks `UNIT > GROUP` and has no slot for `SESSION` denies
every legitimate delegation to an aftest assessor, and the fix at 17:00 on an
exam Saturday is a special case in the grant service. `SELF` is a third
instance — it is in the enum, D-146 seeds it *"subject to §2.6"*, and it is not
comparable to `GROUP` or `COURSE` under any breadth ordering at all.

**Invariant 3 was vacuous for exactly the granters who matter.** D-144 permits a
null `validUntil` for instructor and administrator grants — that is, for every
`ORGANIZATION`-scoped administrator and every standing Planner, the principals
who actually issue examiner grants. A null window contains every window, so the
check passes for `2099-12-31`, which is what a mandatory date field with no
ceiling collects on a form filled in under time pressure. D-144 changed the
shape of the tuple and left B-7's outcome intact: the examiner who assessed one
Saturday in March holds `exams.assess` and `exams.results.record` on that
session for seventy-three years. Finding **F-139**.

**Decision D-170 — Scope confinement is **resource containment**, computed
through the §2.2 coverage rules; there is no ordering over scope types. And
every bounded-window scope carries a schema-enforced ceiling, with a null
granter window read as the granter's maximum grantable window rather than as
unbounded.**

**Containment, concretely.** `coversResource()` and `resolveReach()` already
compute, for a `(permission, scopeType, scopeId)` grant, the set of resources it
reaches. The grant service asks one question: is `cover(proposed) ⊆
cover(granter's own grant of that permission)`, evaluated live? Consequences fall
out rather than needing rules:

- A `UNIT` granter may grant at `COURSE` **only when every group in that course
  sits in their unit** — checkable, and it is exactly the cross-unit case a type
  ranking waves through.
- A `GROUP`-scoped instructor may grant at `SESSION` for a session on their own
  group's roster, which is D-068's aftest case and which a ranking either
  permits by accident or forbids by accident.
- `SELF` needs no ordering: its cover is the holder's own records, which is a
  subset of any grant that includes them.
- `ORGANIZATION` remains grantable only by an `ORGANIZATION` holder, because
  nothing else covers everything.

The cross-unit `COURSE` case is added to D-032's per-module scope-escape set
explicitly, **named as the case a type-ranking implementation passes**, so the
test fails on the wrong implementation rather than on nothing.

**The window ceiling.**

| Scope | `validUntil` |
|---|---|
| `SESSION` | **Derived, not accepted.** Defaults to the session's date; extendable only to session date **+ 7 days**, enforced in the schema beside the not-null constraint (D-144). This is D-068's *"a short window around it for preparation and follow-up"* made numeric |
| `COURSE` | Mandatory and bounded: §2.4 already calls it time-bounded. Ceiling is the course's own end date + 7 days |
| `GROUP`, `UNIT`, `ORGANIZATION`, `SELF` | May be null, as D-144 states. These are standing relationships, and a mandatory date on them produces a fake one |

A **null granter window** is read, for invariant 3, as the maximum window that
granter could themselves be issued for the scope being granted — so an
`ORGANIZATION` administrator with no expiry still cannot issue a `SESSION` grant
beyond session date + 7 days. Without this clause the ceiling would apply to the
schema and not to the check, and the one principal who issues these grants would
be the one it does not bind.

**Trade-off.** Containment costs a reach computation on the grant path where a
ranking costs an integer comparison — on a path that runs when an administrator
edits a role, not in a loop. And a genuinely long-running examiner arrangement
now needs re-granting rather than one date entry. That is D-052's stated intent
("individual, time-bounded, minimally scoped, never shared") finally enforced by
something other than the person typing the date.

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
   **The floor is computed, not typed — see §3.2.1 (D-168).**

**Reason.** The three questions a breach requires (D-128) are all answered from
the audit trail. If the actor who caused the breach can also edit it, the
Article 33 assessment is built on evidence the suspect controls.
**Trade-off.** A second database connection with different grants, and an
operator pointing `DATABASE_URL` at a managed database must create two roles
rather than one. The documentation gives the exact statements, as it already
must for D-116.

**One thing part 2 does not do, stated so nobody reads it as more than it is.**
The retention path holds `DELETE` on `AuditEvent` and runs in the same process,
in a code base where §3.1 permits `$executeRaw` behind a reviewer sign-off. The
`INSERT`-only role is therefore a control against an *external* SQL primitive —
injection, a stolen `DATABASE_URL`, a careless script — and not against the
compromised-administrator scenario FM-7 and this decision name. The control that
reaches that actor is the checkpoint MAC in §3.2.1, and its limit is stated
there too.

### 3.2.1 The chain must survive its own retention policy

D-149 part 1 requires `audit:verify` and a chain-status line a human sees.
D-149 part 3 makes retention configurable, and `01-domain-model.md` §5 gives the
audit row `onExpiry: DELETE`. **These cannot both hold as written.** A hash
chain in which each row carries the previous row's hash is verifiable from a
known anchor forward; the template's verification walks from genesis
(`src/modules/audit/application/audit-service.ts:107`, `previousHash =
AUDIT_GENESIS_HASH`, over `readAuditChain()`'s full ascending walk). Delete the
oldest rows and the anchor is gone. On the **first legitimate retention run** —
month 12 to 24 of the first instance — `audit:verify` reports a discontinuity,
permanently, and the diagnostics chain-status line goes red and stays red.

That is worse than not having the control. The single thing D-149 exists to
provide is that a compromised administrator who exports the member base and
deletes the four rows recording it is *detectable*; on any instance past its
retention window the detector is already alarming for a benign reason, and the
volunteer reading diagnostics has been trained by a year of red to ignore it. A
tamper-evidence mechanism whose false-positive rate is 100% after month twelve
gives D-128's Article 33 assessment no discriminating power at all.

`06-delivery.md` §5 ranks *"audit chain-aware rotation and checkpointing"* as
the **number-two** most retrofit-hostile mechanism in the product. Before this
decision the word `checkpoint` appeared in the design set exactly twice: in that
ranking row, and in an example branch name on the same page. No decision, no
specification, no phase. Finding **F-137**.

**Decision D-168 — Audit retention prunes a contiguous prefix and never a
sparse subset; before it deletes anything it writes a signed `AuditCheckpoint`
that becomes the new verification anchor; `audit:verify` walks segment by
segment in chunks and reports "intact across N pruned segments"; and the audit
retention floor is computed from the classes the events evidence rather than
typed by an operator.**

**The record.**

```text
AuditCheckpoint
  sequence              last SURVIVING AuditEvent.sequence at this checkpoint
  chainHash             that row's hash — the anchor verification restarts from
  prunedFromSequence    first deleted sequence      ┐ what this checkpoint
  prunedToSequence      last deleted sequence       │ accounts for, so a gap
  prunedCount           rows deleted                │ is a stated fact rather
  prunedFrom / prunedTo occurredAt range deleted    ┘ than an unexplained hole
  previousCheckpointHash   checkpoints are themselves chained
  createdAt
  mac                   HMAC-SHA256 under HKDF(SECRET_KEY, info="audit-anchor-v1")
```

**The rules.**

1. **Deletion happens only through the checkpointing path.** The retention job
   writes the checkpoint and deletes the rows it accounts for **in one
   transaction**. A deletion without a checkpoint is the tampering signal; there
   is no other legitimate producer of a gap.
2. **Prefix only.** An event is deletable only if every event at or below its
   sequence is deletable. This is what keeps segments contiguous and
   verification cheap, and it is the reason the floor below is a single
   instance-wide value rather than a per-event-class one — per-class expiry
   would delete a *sparse* interior subset, which no anchor can describe.
3. **Checkpoints are never deleted.** They are small, one per retention run, and
   they are the record of what the trail no longer contains.
4. **`audit:verify` verifies segments, in chunks.** For each checkpoint: verify
   its MAC, verify its `previousCheckpointHash` linkage, then walk the events
   from that checkpoint's `sequence` forward — **paged by sequence**, never
   materialising the table. `07-operations.md` §2 calls `AuditEvent` the
   fastest-growing table, and `readAuditChain()` as inherited reads every row
   into memory; on a two-year instance verification is otherwise unrunnable,
   which is the same work as checkpointing and is why it is one item.
   The result is `valid` with `prunedSegments: N`, and a removed row *inside* a
   live segment still breaks that segment against its anchor.
5. **The genesis constant is ours and is decided now.**
   `AUDIT_GENESIS_HASH = "genesis:splashtrack:audit:v1"`, set in the first commit
   that writes an audit event and never changed afterwards — changing it
   invalidates every chain written before the change. The inherited value is the
   literal `"genesis:webapp-template:audit:v1"`
   (`src/modules/audit/domain/audit-event.ts:93`), which would otherwise ship as
   the tamper-evidence root of a product that is not the template. Genesis is
   treated as checkpoint zero, so verification has exactly one shape.
6. **The retention floor is computed.** Audit retention is one instance-wide
   `bounded` value, and its floor is
   `max(12 months, the longest configured retention among the data classes whose
   changes audit events evidence)`. With exam results and awards at 7–10 years
   (`01-domain-model.md` §5) the floor is that, not twelve months. The settings
   layer computes and displays it rather than asking an operator to keep two
   numbers in step, and lowering audit retention remains a high-severity audit
   event. This settles the hand-off F-133 opened; `01-…` §5's audit row and
   `07-…` §1's table point here rather than restating a number.

**What the MAC does and does not do.** It binds each anchor to the instance's
own key material, so an attacker with **database write access only** — the
`$executeRaw` path, a stolen `DATABASE_URL`, an injection — cannot delete
interior rows and forge a covering checkpoint, which is the gap the template's
own module README concedes when it calls the chain unkeyed and notes that tail
truncation still verifies. An attacker with **host access** holds `SECRET_KEY`
and can forge a checkpoint; nothing in an application can prevent that, and host
access is already the boundary `13-…` §7 treats as proof of ownership. Saying so
is the point: the control is real against the actor it names and it is not
magic.

**Phase.** This is Phase 1, beside the crypto envelope, and
`06-delivery.md` §5's phase list is corrected to say so — it is ranked #2 by
cost of doing it late and was in no phase at all.

**Trade-off.** One more table, one more command path, and a retention job that
can no longer be a single `DELETE … WHERE occurredAt < ?`. Against that: the
alternative is a diagnostics light that turns red on schedule in month twelve
and is never green again.

## 4. Application security controls

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
| `bounded` | Editable within a hard floor/ceiling enforced by the setting's own schema, which `settings:reset` also respects. **A ceiling that can be exceeded with a documented reason is not a bound; that setting is `free` with a warning** (§4.1.1) | session idle and absolute lifetime — bounds stated once in §4.1.1 (D-173); rate limits ≥ a stated minimum; audit retention ≥ the computed floor (§3.2.1, D-168); any retention ≤ the platform maximum |
| `invariant` | Not editable in the UI at all, not clearable by `settings:reset`, no override flag | MFA required for the high-risk permission set (§1.2); the egress deny-list's *existence* (its allow-private-networks flag is `free` and audited). **Nothing else** — see §4.1.1 for what was removed from this list and where those properties are actually enforced |

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

#### 4.1.1 What the registry can actually protect

D-150's classification is the right mechanism, and its `invariant` column named
four things of which **one** was a setting.

- *"Reach filtering"* and *"audit append-only"* are properties of code and of a
  database grant. There is no registry key to mark, no value to refuse, and
  `settings:reset` cannot clear what it cannot reach. Marking them produced two
  rows that do nothing and — worse — implied that the settings layer is where
  those properties are enforced, when D-147 (the opaque `Reach`) and
  D-149/D-168 (the `INSERT`-only role, the checkpointed chain) are. **They are
  removed from the class and stated where they are enforced.** An `invariant`
  list containing things the registry cannot see devalues the entry it can.
- The **`SELF` permission set** is the one that matters, because it *is* a
  mutable object and the registry is the wrong guard for it. D-146 makes `SELF`
  a seeded `Role` row, and a `Role`'s permission set is edited through
  `roles.manage` in the roles module (§2.5), not through the settings registry.
  An `ORGANIZATION`-scoped administrator holding `roles.manage` opens People &
  roles, selects the seeded `SELF` role and adds a permission — passing §2.6's
  invariants, because they hold everything — and nothing in the roles module
  knows the settings registry called that role `invariant`. D-146's own guard
  (*"adding a permission to the `SELF` set is a security-relevant change
  requiring review"*) is a statement about a code review; the object here is a
  database row edited through a UI at runtime. Finding **F-141**.

**And one `bounded` entry was not bounded.** D-104 lets backup retention exceed
the shortest special-category retention *"where an operator has a documented
reason"*, surfacing a diagnostics warning instead, while D-150's table and
`13-…` §3.2 both listed the same ceiling as hard. A ceiling with a
documented-reason escape is a warning, and a class that sometimes means "cannot"
and sometimes means "should not" is not a classification.

**Decision D-171 — `invariant` covers only objects the settings registry can
refuse a write to. The `SELF` role is protected at its own boundary instead: the
seeded row carries `system: true` and the roles module refuses edits to system
roles, backed by a test. Backup retention is `free` with a mandatory diagnostics
warning, not `bounded`.**

- `system: true` on a `Role` means the roles module rejects any change to its
  permission set, at the service and not in the UI — exactly the refusal D-150
  wants from `settings:reset`, at the boundary that owns the object. `SELF` is
  the only such row in v1; seeding a second is a reviewed security change, which
  is the guard D-146 intended and could not reach from where it was written.
- Backup retention keeps every control D-104 gives it: the warning naming both
  figures, the published **backup horizon**, and the erasure UI stating that
  horizon at the moment of erasure. What it loses is a claim to be a hard
  ceiling, which it never was. `bounded` now means exactly one thing — a value
  that cannot be exceeded.

**Reason.** An invariant asserted in one mechanism and enforceable only in
another is the precise defect this section exists to remove, reproduced by the
fix for it.
**Trade-off.** `invariant` shrinks to two entries, which reads thinner and is
true; and `system: true` is one more flag that a future "just let me edit it"
will push against — the test is what holds it.

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

#### 5.4.1 What the derivation reads, and who acts on what it produces

D-151 is correct as a rule and it has two open ends, in opposite directions:
what happens when its input is missing, and who exercises the right its output
creates.

**The input.** `dateOfBirth` is non-optional in `01-…` §3.1, and D-157 fills it
for the entire existing pupil population from an export whose shape is unknown
by construction. If some rows carry no usable date — plausible for guardians,
former members, and anything entered before the incumbent made the field
mandatory — the importer either rejects those rows or writes a placeholder. A
placeholder in the past marks every affected consent as requiring re-consent on
day one, burying the queue the control exists to populate; a recent one marks
none of them, ever. Neither is detectable: a computed condition has no failure
state to log, it just returns a boolean, and §1.1's deny-by-default rule does
not reach it because there is no permission check here to deny.

**The output.** §5.5's rights table says objection and consent withdrawal are
*"self-service where an account exists"*, exercisable by *"data subject or
guardian"*. In v1 a guardian who is not a member **gets no account** (§2.4) and
the guardian portal is v2 (D-161); the child has no account either unless the
school made one, and D-146's `SELF` set grants *read* of own consent records,
not withdrawal. So the table states a right whose only named exercisers have no
v1 surface — while D-151 newly guarantees a steady supply of consents needing
exactly that action. This is the v1/v2 seam D-161 warns about, arriving in the
direction it did not anticipate. Finding **F-142**.

**Decision D-172 — `dateOfBirth` is never synthesised: a missing or
unparseable value is a row rejection in the importer's report, and where the
column must accept null for an imported record, unknown date ⇒ **authority
treated as lapsed** ⇒ the consent appears in the re-consent queue. And in v1
consent withdrawal and objection are **staff-operated** actions in the privacy
admin area; self-service arrives with the portal.**

- Failing to *lapsed* is the safe direction and, more importantly, the
  **visible** one: an unknown date produces a queue item a human resolves,
  rather than a silent boolean nobody can audit. A placeholder date is forbidden
  outright — it is indistinguishable from a real one the moment it is written.
- The staff-operated path is not a downgrade; it is what v1 actually has. The
  privacy admin area already runs the re-consent queue, the erasure preview and
  the Article 15 export, and a withdrawal recorded there carries the same
  `withdrawnAt`/`withdrawnByPersonId` and triggers the same cascades (D-152) as
  a self-service one would. What changes is that §5.5 stops promising a surface
  the release does not ship.
- D-161's constraint is respected rather than dented: recording the actor as
  *the person who withdrew* and the operator as *who entered it* is exactly the
  shape the portal needs, so the portal adds a caller and not a data model.

**Trade-off.** A parent must phone or email the school to withdraw photo
consent, and someone at the school must action it within a working week. That is
the same process they have on paper today, and it is honest; the alternative was
a table row describing a button nobody will build until v2.

### 5.5 Data subject rights

| Right | Mechanism | Who can run it |
|---|---|---|
| Access / inzage | Generates a structured export (JSON + human-readable PDF) of everything about one Person within one org | Org admin with `privacy.export`, step-up required |
| Rectification | Ordinary edit on `Person` / profile; all edits audited | Member administrator |
| Erasure | `person-erasure` transaction: anonymise `Person`, sever pointers, hard-delete special-category data, retain pseudonymised legal records with their ground stated (D-065) | Org admin with `privacy.erase`, step-up, and a confirmation naming the retained records |
| Portability | Same export as access, machine-readable | As access |
| Restriction | `Person` flagged; writes blocked, reads audited | Org admin |
| Objection | **v1: staff-operated in the privacy admin area** (D-172). Self-service arrives with the guardian portal in v2 (D-161) — in v1 a non-member guardian has no account (§2.4) and `SELF` grants read of own consents, not withdrawal | Data subject or guardian, via the school |

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
