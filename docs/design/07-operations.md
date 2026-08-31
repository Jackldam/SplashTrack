# 07 — Logging, Auditing, Observability, Backup, Failure Modes & Scalability

## 1. Logging, auditing and observability

Three distinct systems with different readers, retention and access control.
Conflating them is a common and expensive mistake.

| System | Question it answers | Contains PII? | Reader | Retention |
|---|---|---|---|---|
| **Operational logs** (pino) | "Is the system healthy? Why did this request fail?" | **No** — ids only | Operators | 30 days |
| **Audit trail** (`AuditEvent`) | "Who did what to whom, when?" | Yes, by design | Org admins with `audit.read`; platform super admin | ≥ 24 months |
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
- Authorization: every denial; every use of `platform.super_admin` (at `warn`).
- Personal data: read of medical/pastoral notes (D-010); create/update/delete of
  a Person or StudentProfile; export; erasure; consent given/withdrawn.
- Domain-significant: skill sign-off and revocation; exam result recorded or
  corrected; certificate issued or revoked; attendance amended after the fact.
- Configuration: role assignment changes, branding changes, retention policy
  changes, API credential lifecycle, organisation lifecycle.

Each event records: timestamp, actor person id, actor session/credential,
organisation, action, target type + id, outcome, and a minimal detail payload —
**never a full before/after dump of personal data**.

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
- **Alert on security signals, not just uptime:** a spike in authorization
  denials, any `platform.super_admin` use, repeated failed logins for one
  account, an unusual export volume.
- Tracing is deferred (D-020 rationale); request ids propagated through logs
  are sufficient for a single-service application.

## 2. Backup and restore

| | Policy |
|---|---|
| Database | **Per instance:** automated daily full + continuous WAL archiving. RPO ≤ 24 h, target ≤ 15 min via WAL |
| Object storage | Versioned, replicated |
| Retention of backups | 30 days rolling, plus one monthly for 12 months |
| Encryption | Backups encrypted at rest with keys separate from the database host; special-category columns remain independently encrypted (D-013) |
| Access | Restore requires two-person authorisation and is audited |
| **Restore drill** | **Quarterly, into an isolated environment, timed, documented, rotating across instances** so every instance is exercised over time. A backup that has never been restored is a hypothesis |
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
| FM-6 | **Fleet version skew / migration fails mid-rollout** | Some instances on the old version; one instance broken | Waves, bounded skew, halt-on-failure, per-instance restore (F-13) |
| FM-7 | Compromised org admin account | Full org data exposure | MFA mandatory; export requires step-up and is rate-limited and alerted; audit visible to the org |
| FM-8 | Compromised Lucky / prompt injection | Malicious PR | No secrets, no PROD path, workflows outside write scope, human approval required (D-025) |
| FM-9 | Leaked backup | Personal data exposure **for one organisation only** | Per-instance encrypted backups + separate column encryption for health data |
| FM-10 | Retention job deletes too much | Irreversible data loss | Dry-run and report before execution; deletions audited; restorable within backup window |
| FM-11 | Email delivery fails | Password resets and invitations lost | Queued with retry; failures visible in admin; not on the critical path for attendance |
| FM-12 | Certificate issued in error | Legal/reputational | Certificates are revoked and reissued, never edited; every action audited |
| FM-13 | Shared tablet left unlocked | Unauthorised access to student data | `SHARED_DEVICE` mode: short idle timeout, reduced PII, no export, no admin (D-009) |

## 4. Scalability risks

Stated scale: ~100 organisations. Under single-tenancy that is ~100 modest
deployments rather than one large one — each holding perhaps a few thousand
persons. Per-instance load is trivial; **fleet size is the scaling problem.** The risks below are the ones that would bite
first, in the order they would bite.

| Risk | When it bites | Prepared response |
|---|---|---|
| **Derived progress queries** — "current level" computed from an append-only log | A student with years of history, or a group matrix view over 30 students × 40 skills | `StudentProgressSummary` materialised on write. **Prepared, not built** (D-005) |
| **Audit table growth** | Fastest-growing table; audit UI queries slow first | Time-based partitioning + retention rotation; index on (org, timestamp, actor) |
| **Attendance table growth** | ~50k persons × weekly sessions ≈ millions of rows/year | Partition by period; aggregate + anonymise at 24 months (retention policy doubles as a scalability control) |
| **Seasonal peak** | Enrolment season and exam periods concentrate load | Stateless processes scale horizontally; no in-process state anywhere (P-08) |
| **Single Postgres instance per organisation** | Write saturation within one organisation — unlikely at swim-school scale | Read replica for reporting first. Sharding is moot: the fleet is already partitioned by organisation |
| **Fleet size** | The real scaling axis is now *number of instances*, not rows. 100 organisations = 100 deployments, databases, backup schedules and upgrade targets | Scripted provisioning (D-028), waved rollouts, fleet manifest, per-instance monitoring. **This is the dominant operational cost** — F-13 |
| **Public site traffic spikes** | A newsletter or news item | ISR caching; the public surface has no person-table access so it cannot cascade into the portal (D-017). A spike affects one organisation only |
| **N+1 queries in the group matrix** | The hot path, immediately | Explicit repository methods returning the full matrix in one query; a performance test on a seeded 30×40 matrix in CI |

**The honest summary:** none of these justify architectural complexity today.
Each has a named, cheap response that the current design leaves room for. That
is what "scalability without premature complexity" means in practice — knowing
the answer, not building it.
