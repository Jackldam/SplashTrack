# 07 — Logging, Auditing, Observability, Backup, Failure Modes & Scalability

## 1. Logging, auditing and observability

Three distinct systems with different readers, retention and access control.
Conflating them is a common and expensive mistake.

| System | Question it answers | Contains PII? | Reader | Retention |
|---|---|---|---|---|
| **Operational logs** (pino) | "Is the system healthy? Why did this request fail?" | **No** — ids only | Operators | 30 days |
| **Audit trail** (`AuditEvent`) | "Who did what to whom, when?" | Yes, by design | Holders of `audit.read` in this installation | **Computed floor — stated once in `02-security-privacy.md` §3.2.1 (D-168)**, not a flat number here |
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
subjects themselves for high-risk breaches (Article 34). The intended reader is
a swim school with no security staff.

**Stated as a design premise, not as a legal conclusion** (F-144). This
installation holds health data about children, so we have designed for the case
where Article 34 notification **is** required — the capability exists if your
assessment concludes it does. Whether it is required for a given breach is that
assessment, made on the facts, and Article 34(3) may bear on it: 34(3)(a)
exempts data rendered unintelligible by encryption, and this product encrypts
both the protected free-text class and its archives, so the exemption is not
hypothetical here. An earlier version of this paragraph said the threshold was
*"met by default rather than argued about"*, which answers in the project's
voice exactly the question D-064/F-126 says the project does not answer for its
reader — and in the more consequential direction, since it instructs a volunteer
to notify every parent without the assessment the Article requires. The
engineering consequence is unchanged, which is the point: the capability never
needed the legal conclusion to justify it. The checklist below keeps the framing
it already had — *the deadlines that apply to you*, not advice on whether they
apply.

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
| **Audit table growth** | Fastest-growing table; audit UI queries slow first | Time-based partitioning + **checkpointed prefix rotation (D-168)**; index on (org, timestamp, actor). Chain verification is paged by `sequence`, never a full-table read — the inherited `readAuditChain()` materialises every row and is unrunnable at this size |
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
