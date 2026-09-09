I've read all 15 chapters. Report follows.

---

# Adversarial security & GDPR review — SplashTrack design (chapters 00–14)

Branch `design/architecture-phase`. Chapters 11–12 treated as non-normative. 34 findings; 5 genuinely good controls at the end.

The design is unusually literate about security and is honest in places most designs are not. That literacy is also its main risk: several controls are *described* so convincingly that nobody will check whether they are mechanically enforceable. Where I found that, I say so.

---

## A. Critical

### A-1 — CRITICAL — There is no permission for assigning roles, and no anti-amplification rule
**`02-security-privacy.md` §2.5 (permission catalogue), §2.4, §2.6**

The catalogue lists `people.*`, `students.*`, `audit.read`, `privacy.*`, `organization.settings.manage` — and **no key for role assignment, access-group assignment, or permission grants**. Grepping the whole active set: `roles.assign` does not exist anywhere. Yet role assignment is the single highest-privilege operation in the product, and `AccessGroup` (§2.6) bundles *permissions plus scopes* into one assignable object.

**Attack.** A Location Manager (`UNIT` scope) at Zuidbad opens People & roles (`04-ux.md` §1 lists it as an admin screen with no permission named). Because no permission gates the operation and no rule confines a granter to their own scope or their own permission set, they assign themselves — or an accomplice — an `ORGANIZATION`-scoped Instance Administrator role, or an AccessGroup containing `students.medical.read` at `ORGANIZATION`. They now hold every medical note in the swim school. Step-up re-authentication is required for "role changes" (§1.2) — they have their own password and MFA, so step-up is not an obstacle. The audit event records a legitimate-looking role change.

**Fix.** Add `roles.read` / `roles.assign` / `roles.manage` and `accessgroups.assign` to the catalogue. State two invariants normatively and test them per module: (1) **no amplification** — a granter may only grant permissions they themselves hold; (2) **scope confinement** — a granter may only grant at or below their own scope. Both must be enforced in the grant service, not the UI, and both need scope-escape tests under D-032.

---

### A-2 — CRITICAL — An admin-configurable OIDC provider is an account-takeover primitive
**`02-security-privacy.md` §1.2.1 (D-035); `08-open-decisions.md` OD-8**

The registry stores, per provider: issuer/discovery URL, client id, encrypted secret, **claim→field mapping**, JIT toggle, JIT role. It is guarded by "a permission-guarded admin screen" — the only candidate permission in the catalogue is `organization.settings.manage`. Nothing in the design states how an external identity is bound to an existing `UserAccount`.

**Attack (privilege escalation).** A Planner or Content Editor who has been given `organization.settings.manage` (a plausible "office manager" bundle, and the only permission that gates settings) adds a provider they control — a free Keycloak or Auth0 tenant, five minutes' work. They set the claim mapping so `email` maps to the account's email. They pass the mandatory "test connection" against their own IdP trivially. They then sign in through that provider as `admin@zwemschool.nl` and are logged in as the Instance Administrator. MFA on the local account is irrelevant — they never touched the local method.

**Second attack (client-secret exfiltration, defeating an asserted control).** §1.2.1 promises the client secret is "never returned to any client — the admin API exposes `secretSet: boolean`". True, and useless: the admin edits *only* the token endpoint / issuer URL of an existing provider, leaving the secret in place. On the next login the application sends the stored client secret to the attacker's endpoint. A control that hides a secret from reads but lets you redirect where it is *sent* is not a control.

**Fix.**
- Separate `identity.providers.manage` from `organization.settings.manage`; require MFA + step-up + high-severity audit + notification to all admins on provider create/enable/edit.
- **Never link on an email claim.** Link on `(issuer, sub)` only, established either by an explicit per-user link ceremony while already authenticated locally, or by an administrator naming the external subject. If email is used at all, require `email_verified=true` *and* an admin-approved domain allow-list.
- Adopt OD-8's own recommendation as a hard rule, not a recommendation: **JIT creates nothing**. Remove the "which role a JIT account receives" field entirely — a field whose only safe value is "none" should not exist.
- Changing issuer / token / userinfo endpoints **clears the stored secret** and forces re-entry.
- Accounts holding `ORGANIZATION`-scoped roles may not authenticate via an external provider unless explicitly opted in per account.

---

### A-3 — CRITICAL — Restoring an attacker-supplied `.stbak` is arbitrary SQL execution, plausibly RCE
**`14-backup-restore-upgrade.md` §4.2, §4.3, §4.4; `13-configuration-and-setup.md` §6**

Restore ingests a `pg_dump` produced elsewhere and replays it into the database. `03-deployment-model.md` §1.2/D-033 ships a reference compose with PostgreSQL; the app's DB user in such a compose is conventionally the superuser. Nowhere in 15 chapters do the words "superuser", "least-privilege database role" or "restrict dump contents" appear.

**Attack.** A swim-school volunteer posts "my instance won't start" in a GitHub issue. A helpful stranger (or the project's own forum) supplies a "known-good starter backup" plus its token. The operator uses it — this is the *documented, encouraged* recovery path, and the wizard's first question invites it. The dump contains `CREATE FUNCTION`/`COPY … FROM PROGRAM`/`ALTER ROLE`, executed as the database superuser. Result: code execution in the database container, persistence via a trigger that survives every future migration, and a poisoned instance that passes every schema check the design specifies. The same primitive is reachable by anyone who gets to `/setup` (see A-4).

The design's verification step — "decrypt and verify checksum … verify row counts against the manifest" — verifies the archive is *intact*, not that it is *benign*. Both the checksum and the manifest come from the same attacker-supplied file.

**Fix.**
- The application's database role must be **non-superuser**, owner of its own schema only, with `NOSUPERUSER NOCREATEROLE`, and the reference compose must create it that way. Document this as a non-negotiable image property alongside "runs as non-root".
- Restore custom-format dumps via `pg_restore --no-owner --no-acl --no-comments --schema=public`, into a freshly created empty schema, with an allow-list of object types (tables, indexes, constraints, sequences) and a **hard rejection of functions, triggers, extensions, event triggers and `COPY … FROM PROGRAM`**. Anything outside the allow-list aborts the restore.
- Better still for v1: make the backup a **structured logical export** the application writes and reads itself, not a raw SQL dump. You lose nothing (D-046's `_prisma_migrations` trick can be carried as a manifest field) and you delete this entire class.
- State explicitly that a `.stbak` from any source other than the operator's own instance is untrusted input.

---

### A-4 — CRITICAL — `SETUP MODE` is keyed on one deletable row, and the wizard does not check for existing data
**`13-configuration-and-setup.md` §6, §6.1 (D-055, D-039)**

State detection: `PARTIAL (tables exist, no bootstrap record) → resume SETUP MODE`. The gate on the only unauthenticated administrative surface in the product is the presence of a single `PlatformBootstrap` row. The wizard's "New installation" path then creates a first administrator with full `ORGANIZATION` scope.

**Attack.** Any primitive that deletes one row — SQL injection anywhere in the app, a compromised low-privilege DB credential, a botched restore, a support script, or a bug in the erasure transaction's "explicit table registry" — puts a **fully populated production database holding 10,000 people's records into unauthenticated setup mode**. The next request to `/` redirects to `/setup`; whoever arrives creates a new Instance Administrator over existing children's health data. D-039's claim that the wizard "self-destructs once the first administrator exists" is false as specified: it self-destructs once a *row* exists.

**Fix.** Setup mode requires **all** of: no bootstrap record, **zero `UserAccount` rows, zero `Person` rows**, and no `RoleAssignment` rows. If tables contain data but the bootstrap record is missing, that is not `PARTIAL` — it is a tamper/corruption state: refuse to serve, log loudly, and require the break-glass CLI. Add this as a case in D-055's test matrix.

---

### A-5 — CRITICAL — The setup token is printed to logs, and the same design tells operators to paste logs into public issues
**`13-configuration-and-setup.md` §6.1 (D-039 trade-off); `10-findings.md` F-20**

D-039's race mitigation: "printing a one-time setup token to the container logs, which the wizard requires: the operator can read their own logs, a stranger on the internet cannot." F-20, four chapters away, states the opposite as a design assumption: *"Self-hosters debugging a problem paste logs, screenshots and database rows."* The mitigation and the acknowledged operator behaviour are mutually exclusive.

**Attack.** Operator's setup fails (email misconfigured, DB flake — the state machine explicitly resumes SETUP MODE). They open a GitHub issue, paste `docker compose logs app`. The setup token is in it. The repository is public. An attacker watching new issues for a project holding children's health data reaches `/setup` before the operator retries and becomes Instance Administrator of an instance the school then populates. Variants: Portainer/Synology/Unraid log panes visible to any household member; centralised log shipping to a third-party SaaS; log rotation destroying the token so the operator *can't* finish setup.

**Fix.** Do not put a bearer credential in a log stream.
- Write the token to a file on the data volume (`$DATA_DIR/setup-token`, mode 0600) and print only its *path* to the logs. Host access is the proof of ownership; the CLI already establishes that pattern in §7.
- Bind it: single use, ≤60-minute expiry, refreshable only via `docker compose exec app splashtrack setup:token --new`.
- Rate-limit and lock out `/setup` token submission (currently rate limiting covers "login, password reset, export, public forms" — not this).
- Add to the diagnostics page and F-20's issue template a mandatory warning that logs may contain a setup token.

---

## B. High

### B-1 — HIGH — Scheduled S3 backup is an exfiltration channel with none of D-042's controls
**`14-backup-restore-upgrade.md` §3.2, §7; contrast §3.3 (D-042)**

D-042 correctly identifies the download button as "the single most dangerous UI element" and wraps it in step-up, rate limiting, high-severity audit and a single-use signed link. Then §7 adds `backup.destination (volume | s3)` and `backup.s3.*` as ordinary settings, "all live-applied, all audited, secrets encrypted".

**Attack.** A compromised or departing administrator does not touch the download button. They change `backup.destination` to `s3` and point `backup.s3.endpoint` at a bucket they control. Every night the instance ships a complete copy of every person, every medical note and every exam result to the attacker — encrypted with a key the same UI will re-display to them under step-up (§2). No step-up, no rate limit, no high-severity audit event, no notification. The most controlled path is guarded; the uncontrolled path next to it is a settings form.

**Fix.** Treat a change of backup destination or S3 credentials as *equal in severity to a download*: step-up, high-severity audit, mandatory notification to every `ORGANIZATION`-scoped administrator, and a 24-hour delay or second-administrator approval before the first backup goes to a new destination. Show the current destination permanently on the dashboard next to the backup-age indicator (D-041) so a silent redirect is visible.

---

### B-2 — HIGH — Recovery token = `SECRET_KEY` means one key, forever, for everything, non-revocable
**`14-backup-restore-upgrade.md` §2 (D-040); `13-configuration-and-setup.md` §5**

The same key encrypts: the backup archive, every medical column, every stored OAuth/SMTP/S3 secret. It is printed on paper at setup and re-displayable in the UI. The two chapters also contradict each other on what it *is*: §5 of 13 says secrets use "a key **derived from** `SECRET_KEY`"; §2 of 14 says "the token **is** `SECRET_KEY`", while the diagram says it "**wraps** `SECRET_KEY`". Three different schemes.

**Attacks.**
1. A volunteer administrator photographs the printed token during setup in 2026 and leaves in 2027. In 2029 they obtain any backup by any means — an old NAS, a decommissioned drive, an S3 bucket, a leak — and decrypt it. There is no revocation, because the key is the same one that has been in use since day one.
2. Rotation is worse than useless. 13 §5 says rotation "requires a re-encryption command". Re-encryption touches the *database*; it cannot reach `.stbak` files already written. After rotation the operator must keep the *old* token to read old backups and the *new* token to read new ones — so rotation after an admin departs provides no protection for the historical backups that departing admin can already decrypt, while adding a second permanently-critical secret. The design nowhere addresses this and F-24 does not mention it.
3. Restore-time key reuse: restoring the same backup onto three test instances yields three instances all keyed identically to production.

**Fix.** Two-level envelope, which also fixes rotation for free:
- Random 256-bit **master key** generated at setup, stored wrapped by a KDF (Argon2id) over the printed recovery token. The token is a passphrase, not the key.
- Per-archive random **data key**, wrapped by the master key and stored in the archive header. A leaked archive then compromises one archive.
- Rotation = re-wrap the master key under a new token. Old archives stay readable; the token can genuinely be rotated when a person leaves.
- Every re-display of the recovery token is a high-severity audit event **and** notifies all administrators. Currently §2 requires only step-up, and 07 §1.2's authoritative audit list does not mention it at all.

---

### B-3 — HIGH — Chapter 03 says the master key is written to the data volume; the backup contains the data volume
**`03-deployment-model.md` §1.2 vs `13-configuration-and-setup.md` §3.1, §5 and `14` §2**

03 §1.2, in the "non-negotiable properties of the image": *"Secrets are generated on first run and **written to the data volume**."* 13 §3.1 makes `SECRET_KEY` an environment variable supplied by the operator. 13 §6.1 step 4 shows the wizard *displaying* a recovery token, implying the app generated it. Three chapters, three origins.

**Failure.** Implemented as 03 states it: `SECRET_KEY` lives in `$DATA_DIR`. §3.1 of chapter 14 says the archive contains "the uploaded assets" from `DATA_DIR`. If the assets are captured as a directory tree, **the archive contains its own decryption key**. Every claim in the design that the encrypted file is "inert" without the token — the entire justification for D-040, F-23 and "safe to store casually" — collapses silently, and nothing in CI would detect it.

**Fix.** Pick one origin and state it once, authoritatively (13 §3.1 is the right home). Recommended: operator-supplied `SECRET_KEY_FILE` (Docker secret / mounted file) rather than an env var — an env var is readable via `docker inspect`, `/proc/<pid>/environ`, crash dumps, and the operator's own committed compose file. Whatever the choice, the backup writer must **explicitly exclude** the key material path, and a CI test must assert that no shipped `.stbak` fixture contains it.

---

### B-4 — HIGH — The `v1:` envelope has no key id and no AAD: health records can be silently swapped between children
**`14-backup-restore-upgrade.md` §4.3.1 (D-049); `02-security-privacy.md` §4 (D-013)**

D-049 versions the *ciphertext format*. It does not version the *key*, and no chapter mentions binding ciphertext to its location.

**Failure 1 (availability, forward compatibility — the question asked).** Rotation re-encrypts column by column. It is interrupted at 60% (container restart, OOM, upgrade). The table now holds ciphertext under two keys with no discriminator. Both decryptors are present; neither knows which to use. Every failed decrypt is indistinguishable from corruption. Medical notes for an arbitrary subset of children are permanently unreadable, and the CI restore matrix (D-047) would not catch it because it asserts "schema and a set of domain invariants" — not plaintext.

**Failure 2 (integrity — the interesting one).** With no additional authenticated data, a `v1:` blob is portable. Anyone with a SQL write primitive, or any careless data migration or de-duplication script, can copy child A's encrypted allergy note into child B's row. It decrypts perfectly and is authenticated by GCM. A child with a severe nut allergy is recorded as having none. Column-level encryption is assumed to prevent exactly this and, as specified, does not.

**Fix.** Envelope = `v1:<keyId>:<nonce>:<ct>` with AAD binding `(table, column, primary key, keyId)`. Rotation becomes resumable and observable. Add to D-047's matrix a case that **decrypts a medical note and a stored OAuth secret from every supported release's fixture and compares plaintext** — F-25 names the crypto case as "the nastiest" and then leaves it out of the test that is supposed to cover it.

---

### B-5 — HIGH — "Local admin cannot be disabled while it is the only working method" is unenforceable, and it is load-bearing
**`02-security-privacy.md` §1.2.1 (D-035 trade-off); `13-configuration-and-setup.md` §7**

This is presented as one of "two mandatory mitigations" justifying runtime-configurable IdPs. It cannot work:

- **Trivially bypassed.** Configure any second method (an IdP you control, per A-2), which makes local admin no longer "the only" method, then disable local login. The check passes at every step.
- **"Working" is not decidable.** A provider that passed a test connection at 14:00 stops working at 14:05 — certificate expiry, tenant policy change, the admin removed from an Entra group, a discovery endpoint behind a firewall the app can reach but users cannot. The application cannot know this. The safeguard is a point-in-time assertion sold as a continuous invariant.
- The "test connection before enable" gate has the same shape: it proves the app can reach the IdP once, not that a human can log in through it.

**Fix.** Delete the claim, or demote it honestly. The *actual* control is the break-glass CLI (§7), which is genuinely sound because it depends on host access rather than a network-reachable secret. Say that: "IdP misconfiguration can lock you out; recovery is `splashtrack admin:grant-admin` from the host; you must have host access before you enable SSO." Additionally: require at least one local `ORGANIZATION`-scoped account with a verified MFA factor to exist at all times, enforced as a database-level invariant, and re-verify it on every change to authentication settings.

---

### B-6 — HIGH — `resolveReach` has no shape for `COURSE`, `EXAM_SESSION`, `SELF` or `RELATED`
**`02-security-privacy.md` §2.3 (D-031)**

```
resolveReach(session, 'students.read') → { units: [...], groups: [...], all: false }
```

The scope enum has seven members. The reach object represents two of them plus a global boolean.

**Consequence.** An internal examiner (`COURSE` scope) or an external examiner (`EXAM_SESSION`) resolves to `{units: [], groups: [], all: false}` — empty reach, every list denies them, the candidate list they are there to assess is blank. The developer fixing that ticket at 17:00 on an exam Saturday either widens the object ad hoc or passes `{all: true}`. D-031 calls list filtering "the highest-risk code path in the application", and its signature does not cover four of seven scope types.

Worse, `all: false` is a **default-open shape**. D-031 claims a required argument "turns a silent over-fetch into a type error" — but `{units: [], groups: [], all: true}` is a perfectly valid literal that TypeScript will accept anywhere a `Reach` is required. The compiler enforces *presence*, not *provenance*. The claimed wall is a speed bump.

**Fix.** Make `Reach` an opaque/branded type constructible **only** by `resolveReach` (private symbol field, no exported constructor), covering all seven scope types as a discriminated union. Remove `all: boolean` in favour of an explicit `{ kind: 'ORGANIZATION' }` variant that only an organisation-scoped grant can produce. Add a scope-escape test per module for a `COURSE`- and an `EXAM_SESSION`-scoped principal specifically — the two the current shape cannot express.

---

### B-7 — HIGH — `RoleAssignment` cannot express the expiry that two decisions depend on
**`02-security-privacy.md` §2.1 vs §2.4 and `00-overview.md` §5.2 (D-052)**

The tuple is stated as `RoleAssignment(personId, roleId, scopeType, scopeId)`. No validity fields. D-052 requires "a mandatory expiry after which it lapses automatically"; §2.4 lists External examiner as "`EXAM_SESSION`, **always with an expiry**" and Internal examiner as "`COURSE`, **time-bounded**".

**Attack.** As specified, the external examiner who assessed one Saturday in March 2026 retains `exams.assess` and `exams.results.record` on that session **forever**. They can amend a child's diploma outcome years later — and because D-062 makes results append-only, their amendment becomes the effective result. Nobody at the swim school has any reason to look at that assignment again.

**Fix.** `RoleAssignment(personId, roleId, scopeType, scopeId, validFrom, validUntil?, grantedByPersonId)`. Expiry enforced in `requirePermission` and `resolveReach`, not by a cleanup job. Make `validUntil` mandatory (not merely conventional) for `EXAM_SESSION` scope. Surface expiring and expired grants in the admin UI.

---

### B-8 — HIGH — `GROUP` scope grants the whole student record, forever
**`02-security-privacy.md` §2.2 coverage table; `04-ux.md` §3**

Coverage: `GROUP` covers "the students in it *for the period of their membership*". The UX page hierarchy then gives `Student detail → Progress · Attendance · Enrolments · Exams · Notes · Privacy`. Scope covers an *entity*; there is no notion of partial-record reach.

**Attack.** An instructor teaches Sanne for one term in 2026. Via `students.read` they open her full profile: every group she has ever been in, her attendance history at other locations, her failed exam attempts, her enrolments, her guardian relationships. None of it is needed to teach a Tuesday lesson. Add `students.notes.read` (see B-9) and they read staff commentary about her family.

And the phrase is ambiguous in the way that matters: does "for the period of their membership" mean *the instructor's access lasts only during the membership*, or *the instructor may see records dated within that period*? If a past `GroupMembership` row satisfies coverage — the natural reading of a union-of-grants model over an append-only membership table — **every instructor who ever taught a child retains read access to that child's complete record permanently**. D-059 deliberately keeps those rows for life.

**Fix.** State the rule explicitly and pick the restrictive reading: `GROUP` coverage requires an *active* `GroupMembership` **and** an *active* `InstructorAssignment`, both evaluated at query time. Define per-relation coverage, not per-entity: a `GROUP`-scoped `students.read` returns identity basics and this group's progress/attendance only; exam results, other groups' attendance and other enrolments require `COURSE` or `UNIT`. Write the scope-escape test for the *fields*, not just the row.

---

### B-9 — HIGH — Two note permissions, one encrypted, unclear which is special-category
**`02-security-privacy.md` §2.5 vs D-010 (§2.5), D-013 (§4), §5.3**

D-010 says "Medical/pastoral notes have their own **permission pair** and their own audit event type". D-013 encrypts "medical/pastoral notes". The catalogue then defines **two** pairs: `students.notes.read/write` and `students.medical.read/write`. §5.3 says the only special-category data is "medical remarks, allergies, physical limitations".

So pastoral notes sit under the weaker `students.notes.*`, plausibly unencrypted and un-audited — while D-010 and D-013 both explicitly name them as belonging in the protected class. Pastoral notes about a child ("mother is in a shelter", "referred by youth care", "cannot be collected by father") are more sensitive than an allergy and may be special-category by inference (health, sex life, or criminal-adjacent).

**Attack.** An instructor with `students.notes.read` (an ordinary-looking grant a Location Manager would hand out without thought) reads safeguarding-adjacent free text about children, unencrypted in the database and in every backup, with no audit trail. If they later dispute it, there is no record they ever read it.

**Fix.** Either fold pastoral into `students.medical.*` (recommended — one pair, as D-010 actually says), or make `students.notes.*` equally encrypted, equally audited, and equally excluded from exports. State which of the two is authoritative in one place. Also add a free-text warning at the capture point: the field's real risk is what staff type into it.

---

### B-10 — HIGH — Public inquiry forms collect health data about minors, unencrypted and instance-wide readable
**`03-deployment-model.md` §5.3; `00-overview.md` §3.4; `01-domain-model.md` §5 (Inquiries row)**

The `Inquiry` table takes free text from an unauthenticated public form. In this domain the first message a parent sends is very often: *"My son has epilepsy and is afraid of water — is that a problem for lessons?"*

As designed: `Inquiry` reach is **instance-wide**; retention 6 months, `DELETE`; column encryption (D-013) covers `students` medical columns only, so inquiries are plaintext in the database and in every `.stbak`; the audit rules (D-010) cover reads of `students.medical.*`, not inquiries; consent and lawful basis are unaddressed for a record the data subject's guardian volunteered before any relationship exists.

**Attack.** A Content Editor — whose role is explicitly documented as "**No person data**" (§2.4) — plausibly gets inquiry access, because inquiries arrive through the website and the `Inquiry` table lives in the `pages` module. They read health data about named children. The role catalogue's own guarantee is violated by the module layout.

**Fix.** Treat inquiry free text as potentially special-category by construction: encrypt it with the same envelope as medical columns; gate it behind its own permission (`inquiries.read`), never `pages.manage`; audit reads; exclude it from the Content Editor bundle explicitly; shorten default retention; and put a line on the public form asking people **not** to include health information, with a structured "any medical circumstances?" field that only appears after registration.

---

### B-11 — HIGH — "Hard-deleted, never anonymised" is false for at least 12 months, and pre-migration backups have no retention policy at all
**`02-security-privacy.md` §5.3; `07-operations.md` §2; `14-backup-restore-upgrade.md` §5 (D-044); `10-findings.md` F-07**

§5.3 commits: special-category data is "hard-deleted (not anonymised) at 12 months after enrolment ends; never present in logs, ever." Meanwhile backup retention is "30 days rolling, plus one monthly for 12 months", and D-044 adds automatic pre-migration backups "retained for a configurable number of upgrades" — **no maximum, no policy, no expiry trigger**, sitting on the same volume, encrypted with the same never-rotated key (B-2).

F-07 acknowledges the general backup problem but §5.3's commitment on children's health data is stated without qualification, and pre-migration backups appear in no retention table anywhere in chapter 01 §5.

**Failure.** A parent requests erasure. The organisation reports the medical note hard-deleted. It is present in up to 13 backup archives and an unbounded set of pre-migration snapshots, decryptable with a key on a piece of paper in the office. If the school later says "deleted" in an Article 15 response, that statement is wrong.

**Fix.** Add `pre-migration backup` as a data class in 01 §5 with a real trigger and cap (e.g. delete after the next successful start, keep max 3). Rephrase §5.3 to "hard-deleted from live storage; persists in encrypted backups until they age out" and require backup retention ≤ the shortest special-category retention, or make the mismatch a warning on the diagnostics page. Add a documented "backup horizon" figure the organisation can quote in its privacy notice.

---

### B-12 — HIGH — Erasure vs the audit trail is unresolved on a compliance-critical path
**`02-security-privacy.md` §5.5 (D-014), §5.7; `07-operations.md` §1.2**

D-014 requires a registry containing **every table referencing `Person`**, with a test asserting completeness. `AuditEvent` records "actor person id … target type + id" — it references `Person`. The audit trail is simultaneously declared "append-only, never updated, never deleted by application code".

These cannot both hold. Either erasure nullifies actor/target ids — destroying the accountability record that D-026 and the product thesis depend on, and mutating an append-only table — or `AuditEvent` is silently exempted from a registry whose completeness test is the entire mechanism preventing forgotten tables. The design never says which, and the test as described would *fail* on a correct implementation.

**Fix.** Decide and state it: audit events are retained under a named lawful basis (Art. 17(3)(e) / legal claims, or the controller's Art. 5(2) accountability obligation), listed as an explicit, justified exemption in the erasure registry, with the exemption itself enumerated in the registry file so it is visible rather than absent. Then reconcile audit retention with the classes it evidences — currently audit is 24 months / `DELETE` while exam results are retained 10 years, so the record of *who* recorded a diploma outcome is destroyed eight years before the outcome. For a design that justifies append-only results by "a parent disputes a diploma decision", that is self-defeating.

---

### B-13 — HIGH — The audit trail has no tamper-evidence and shares one database role with everything else
**`07-operations.md` §1.2; `02-security-privacy.md` §3.1**

"Append-only. Never updated, never deleted by application code" is a statement about *intent*. One database role serves the whole application. `$queryRaw`/`$executeRaw` are permitted with reviewer sign-off, and the lint rule that flags them is justified as protecting *reach filtering*, not audit integrity.

**Attack.** A compromised administrator (FM-7's own scenario), or anyone with a SQL primitive, exports the member base, then deletes the four audit rows recording it. The organisation's only evidence of the breach — the evidence they need for an Article 33 notification — is gone, and its absence is undetectable. Alternatively they lower the audit `RetentionPolicy` to 1 day (audit retention is an organisation-configurable policy per D-065) and let the maintenance job do it for them, legitimately.

**Fix.** Cheap and proportionate: a `prevHash`/`hash` chain per audit row (each row hashes its content plus the previous row's hash) makes deletion and modification detectable by a single verification pass, surfaced on the diagnostics page. Additionally: a separate database role with `INSERT`-only grant on `AuditEvent`, revoked `UPDATE`/`DELETE`; and a hard floor on audit retention that the settings registry refuses to go below.

---

### B-14 — HIGH — No breach-response capability at all
**Whole set; `00-overview.md` R-23; `07-operations.md` §1**

The controller must be able to assess and, where required, notify within 72 hours (Art. 33) and notify data subjects for high-risk breaches (Art. 34) — and this is health data about children, so the high-risk threshold is met by default. The design ships an audit trail and a metrics list, and stops.

There is no way for a swim school to answer the three questions a breach requires: *which records did this account access?* (no per-subject access report; audit is per-event with no query surface described beyond "an audit UI"), *which sessions are active and how do I kill them all?* (no session inventory, no bulk revocation; only "sessions invalidate when an account is disabled"), *whose data was in the backup that leaked?* (no manifest of data subjects per archive — the manifest holds row counts). §1.3's "alert on security signals" names signals but no delivery mechanism; there is no shipped alerting, and the intended reader is an operator with no security staff.

**Fix.** This is a v1 requirement for this data class, not a nice-to-have. Ship: (a) a **"what did this account do"** report over the audit trail, filterable by actor and date range, exportable — this is the Article 33 assessment tool; (b) an active-session inventory with per-session and global revocation, plus "revoke everything and force re-authentication" as one button; (c) email/webhook notification for the high-severity events already defined; (d) an incident checklist in the docs stating plainly what the *organisation* must do and by when, framed as "the deadlines that apply to you", not as advice on whether they apply.

---

### B-15 — HIGH — `SHARED_DEVICE` is opt-in by the party it restricts
**`02-security-privacy.md` §1.3 (D-009); `07-operations.md` FM-13**

"A session **may be marked** `SHARED_DEVICE`". By whom, and what stops it being unmarked? If the instructor chooses at login, the control is voluntary. If it is a device cookie, the attacker who has the tablet clears it. If it is a network/IP heuristic, that is unstated. D-009 is cited as the mitigation for two separate High risks (stolen tablet, shared tablet left unlocked) and for FM-13.

Separately, §1.3(b) "suppresses PII beyond **first name + photo**" is backwards: for a child, a photograph is far more identifying than a surname. Suppressing the name while displaying the face is not minimisation. (§4 states a different rule again — photos suppressed "only for non-assigned groups" — so the two passages disagree.)

**Fix.** Make it a property of the *registered device or the account*, set by an administrator, not by the session holder: an admin enrols a poolside tablet, and any session from that device is `SHARED_DEVICE` with no way to opt out. Alternatively make it a role property (Instructor sessions are always shared-device unless on an admin-enrolled personal device). And reverse the PII rule: on a shared device show first name **and no photo**, with photo revealed on explicit per-student tap, audited.

---

### B-16 — HIGH — MFA is not rate-limited, and it may be a setting an administrator can switch off
**`02-security-privacy.md` §1.2, §4 (rate limiting row); `13-configuration-and-setup.md` §3.2, §7**

Rate limiting is specified for "login, password reset, export, public forms". Not for: **MFA/TOTP verification**, setup-token submission, recovery-token entry at restore, or the signed backup link. A 6-digit TOTP without throttling is brute-forceable; MFA is the stated compensating control for the highest-privilege accounts in the product (R-13, FM-7).

Compounding it: the settings registry has an `Authentication`/`Security` category with "password policy, session timeouts, rate limits" as live-editable database values. Is "MFA mandatory for administrator roles" (R-13, stated as **not optional**) one of those settings? If yes, the mandate is a checkbox an administrator — or anyone who reaches `organization.settings.manage`, or `splashtrack settings:reset` — can clear. If no, it is not stated anywhere.

**Fix.** Add explicit rate limiting and lockout to MFA verification, setup-token, recovery-token and signed-link endpoints. Then classify settings: mark security-critical entries as **invariant** (not editable at all: MFA-required-for-admin) or **bounded** (hard floors/ceilings enforced by the registry's own Zod schema: session idle ≤ 8h, rate limits ≥ some minimum, audit retention ≥ 12 months, retention ≤ platform maximum). `settings:reset` must refuse invariants. The registry already claims to be the single source of truth for validation — this is where it earns that.

---

### B-17 — HIGH — Admin-supplied URLs are fetched server-side with no SSRF consideration anywhere
**`02-security-privacy.md` §1.2.1 ("test connection"); `13-configuration-and-setup.md` §7, §8; `14` §7 (`backup.s3.endpoint`); `03` §2.1 (version check)**

Four admin-controlled outbound-request surfaces: OIDC discovery URL, SMTP test-send (arbitrary host:port), S3 endpoint, version check. The words SSRF and egress appear nowhere in fifteen chapters.

**Attack.** A user with `organization.settings.manage` sets the OIDC discovery URL to `http://169.254.169.254/latest/meta-data/iam/…` (cloud metadata → credentials for the operator's whole cloud account) or to `http://10.0.0.5:9200/` and reads the error message. The SMTP test connects to arbitrary internal host:ports, turning the settings page into an internal port scanner from inside the operator's network. The instance is typically the only thing the swim school has exposed, and it now proxies into their LAN.

**Fix.** One shared outbound HTTP/TCP client for all admin-configured destinations: deny RFC1918, loopback, link-local and IPv6 equivalents by default (with an explicit, audited "allow private networks" setting for operators running an internal Keycloak); resolve-then-pin the IP to defeat DNS rebinding; disallow redirects; hard timeouts; and **never return the response body or a distinguishing error to the client** — return "test failed" and log details server-side.

---

### B-18 — HIGH — Retention defaults ship with no lawful basis and `REVIEW` on almost everything, so the default behaviour is "keep forever"
**`01-domain-model.md` §5; `02-security-privacy.md` §5.6 (D-065); `10-findings.md` F-27**

F-27 is right that shipping authoritative-looking periods is dangerous, and the response — defaults as proposals, `lawfulBasis` empty until the organisation fills it — is the right instinct. But look at what that produces in practice:

- The retention table in 01 §5 has *no lawful basis column*. Seven of thirteen classes default to `onExpiry: REVIEW`, including person identity, membership, student profile, skill progress, exam results and consent records.
- `REVIEW` means **nothing happens automatically**. A volunteer administrator who has never opened the privacy screen performs no reviews. So the shipped default behaviour of a "privacy by default" product is: retain every person, every profile, every diploma and every consent record indefinitely, with a queue nobody reads.
- What does the retention job do when `lawfulBasis` is empty — the state F-27 mandates as the shipping state? Undefined. Nothing blocks processing while it is unset.

**Fix.** Make the unconfirmed state *visible and costly* rather than silent: block completion of the setup wizard until each data class's basis is either confirmed or explicitly deferred; surface "N retention policies unconfirmed / N reviews overdue by M days" on the dashboard, in diagnostics, and as an escalating banner. Give `REVIEW` a real mechanic — an actionable queue with per-record accept/delete, a default deadline, and a report. And add the `lawfulBasis` column to the 01 §5 table so the gap is visible where the defaults are read.

---

### B-19 — HIGH — `ANONYMISE` is prescribed where genuine anonymisation is not achievable
**`01-domain-model.md` §5 (attendance row); `02-security-privacy.md` §5.6**

§5.6 argues correctly and at length that pseudonymisation is not anonymisation. The table two chapters earlier then sets attendance to `ANONYMISE` "to aggregate" at 24 months — while the student profile, group memberships and session records are retained for 24 months or longer.

**Failure.** Strip `studentProfileId` from attendance rows and keep `sessionId` + timestamps: a group has 12 members, `GroupMembership` is time-bounded and retained, session dates are known. Re-identification for most rows is a join and a counting argument. The design has re-created the exact error it spent a page refuting, one document away — and would then tell a parent their child's attendance was "anonymised".

**Fix.** Define `ANONYMISE` mechanically, once, and hold the definition to §5.6's own standard: it means **destroying the row-level record and retaining only pre-aggregated counts at a granularity that cannot be reduced to an individual** (e.g. per-group, per-month totals, with suppression below a small-count threshold). If that is not achievable for a data class, its only honest options are `DELETE` or `REVIEW`. Apply the same test to certificate registers — §5.2 already reaches the right answer there; reuse the reasoning.

---

### B-20 — HIGH — Chapter 03 still mandates env-var configuration, contradicting the entire premise of chapter 13
**`03-deployment-model.md` §1.2 vs `13-configuration-and-setup.md` §3 (D-036, D-037)**

03 §1.2, in a list headed "**Non-negotiable properties of the image**": *"**All configuration via environment variables**, documented in one place. No configuration file editing required for a standard install."* Chapter 13 exists specifically to reject this. Same list, next bullets: *"Migrations run automatically on start … and safe to interrupt"* — contradicting D-055 (never migrate an ambiguous database) and D-044 (pre-migration backup).

Chapter 03 is an **active, authoritative** chapter, and it states these as non-negotiable. An implementer who reads chapters in order builds env-var configuration and a naive `migrate deploy && start` entrypoint before reaching chapter 13. Given that D-055's state machine is described in the design's own words as "security- and data-critical code", this is not a cosmetic inconsistency.

**Fix.** Rewrite those three bullets in 03 §1.2 to point at D-036/D-037/D-055, or delete them and cross-reference chapter 13 as authoritative.

---

## C. Medium

### C-1 — MEDIUM — `PersonRelationship` is defined twice, with different fields, and consent validity depends on the difference
**`01-domain-model.md` §3.1, line 295 vs line 331**

Definition 1: `type, fromPersonId, toPersonId, validFrom, validTo?, **evidence?**`.
Definition 2 (26 lines later, in the middle of D-060): `type, fromPersonId, toPersonId, **authority**, validFrom, validTo?`.

One has `evidence` and no `authority`; the other has `authority` and no `evidence`. The consent rule (§3.1, and D-063 in `02` §5.4) requires **both**: valid only if a `GUARDIAN_OF` relationship "with `authority = true`" existed at the time, and `02` §5.4 points `authorityEvidenceId` at the relationship and cites `PersonRelationship.evidence` as how the claim was established.

**Failure.** An implementer picks definition 2. `evidence` is never built. In a custody dispute the school can show a database flag saying someone was authorised, but nothing recording *how* that was established — which is precisely the "false comfort" D-063 says it exists to prevent. The most legally sensitive record in the product has two contradictory schemas in one section.

**Fix.** One definition: `type, fromPersonId, toPersonId, authority: boolean, evidence: EvidenceRef, validFrom, validTo?`. Delete the duplicate row. Make `evidence` non-optional where `authority = true`.

### C-2 — MEDIUM — Nothing handles a child reaching the age of digital consent
**`02-security-privacy.md` §5.4 (D-063); `01-domain-model.md` §3.1**

Guardian authority is recorded with validity dates, but nothing re-evaluates it when the subject comes of age. A swim school's 8-year-olds become 16-year-olds inside the retention window; parental authority to consent lapses by operation of law, not by a `validTo` someone remembered to set. The consent record stays `ON_BEHALF_OF`, apparently valid, indefinitely.

**Fix.** Derive authority expiry from `Person.dateOfBirth` (which the model already holds) against a configurable age-of-consent setting (NL: 16); mark affected consents as **requiring re-consent** and surface them in the privacy admin queue. This is a computed condition over one column and a date — cheap, and it is the single most predictable consent failure in this domain.

### C-3 — MEDIUM — Consent and lawful-basis registration are one table, so withdrawal and objection are conflated
**`02-security-privacy.md` §5.4**

`Consent.legalBasis ∈ {CONSENT, LEGITIMATE_INTEREST, CONTRACT, LEGAL_OBLIGATION}` with a `withdrawnAt` field. §5.4 then correctly argues that attendance is contract-based and "recording them under `CONSENT` would imply they can be withdrawn". But the model permits exactly that: a row with `legalBasis = CONTRACT` and a populated `withdrawnAt`. The UI and the retention logic will treat withdrawal of a contract basis as if it were withdrawal of consent, or ignore it.

Also missing: consent withdrawal has no stated *consequence*. F-04 says photos are "deleted on erasure" — not on withdrawal of photo consent, which is the far more common event.

**Fix.** Split the concepts: a `ProcessingBasis` register (per purpose, per data class — this is what feeds `RetentionPolicy.lawfulBasis`) and a `Consent` record that only ever carries `legalBasis = CONSENT` and supports withdrawal. Objection to legitimate interest is a third, separate event. And define withdrawal cascades explicitly: withdrawing photo consent deletes the photo and any published derivative, audited.

### C-4 — MEDIUM — The Article 15 export is gated on a permission the requester may not hold, and discloses third parties
**`02-security-privacy.md` §5.5, §5.3**

Two problems in one mechanism.

(a) Medical data is "excluded from all exports unless the export explicitly requests it **and the requester holds `students.medical.read`**". For an Article 15 request the entitled party is the *data subject*, not the operator running the export. A member administrator with `privacy.export` but not `students.medical.read` produces an export that looks complete, is delivered as the organisation's Article 15 response, and silently omits health data. The mechanism converts a permission boundary into a compliance failure without any signal.

(b) "Everything about one Person" includes guardian details, instructor names on sign-offs, staff-authored notes and audit actor ids — other people's personal data, handed to whoever requested the export.

Also absent: Article 15 requires stating recipients, retention periods and the source of data. The export is described as records only.

**Fix.** (a) Either require an `ORGANIZATION`-scoped principal holding both permissions to fulfil an Article 15 request, or make the export **fail loudly** ("this export omits N special-category records; it cannot be used as an Article 15 response") rather than quietly omitting. (b) Add a third-party redaction pass, and a preview showing what will be disclosed about others — the erasure flow already has a mandatory preview (`04-ux.md` §4.6); export needs the same. (c) Include a generated retention/recipients/source annex from the `RetentionPolicy` table — you already have the data.

### C-5 — MEDIUM — Break-glass has no actor, no notification, and can silently grant standing admin
**`13-configuration-and-setup.md` §7; `07-operations.md` §1.2**

The CLI writes an audit event, but 07 §1.2 requires every event to record "actor person id, actor session/credential" — a CLI invocation has neither. Undefined. And nothing notifies anyone.

**Attack.** Someone with brief host access (a contractor, an ex-sysadmin whose SSH key was never removed, anyone in the `docker` group) runs `admin:grant-admin --email attacker@…`. The only trace is one audit row, in a UI nobody opens, attributed to nobody. They hold a standing Instance Administrator account. `admin:reset-mfa` is the same story against an existing account.

**Fix.** Define a `system:cli` actor type carrying host user, container id and timestamp. Every break-glass invocation: high-severity audit, **email to all `ORGANIZATION`-scoped administrators**, and a persistent dashboard banner that must be explicitly dismissed by a different administrator. Consider making `grant-admin` produce a *time-limited* grant (24h) rather than a permanent one — recovery is the use case, not provisioning.

### C-6 — MEDIUM — The diagnostics page has no stated permission and reveals exploitation-relevant state
**`13-configuration-and-setup.md` §8**

The page shows version, migration state, DB connectivity, storage writability, backup age, recovery-token acknowledgement, effective config with provenance — and *"whether a newer release with a security advisory exists"*. No permission is named. No catalogue entry (`diagnostics.read`) exists. It is described as "the first thing to ask for in a support issue" and "safe to paste into a public GitHub issue".

**Attack.** If reachable unauthenticated (the natural implementation of "a diagnostics page for support"), an attacker scanning for SplashTrack instances gets a machine-readable answer to *"is this instance running a version with a known advisory?"* plus its backup posture. That is target selection handed over for free. F-17 already names unpatched instances as the biggest residual risk; this page ranks them.

**Fix.** Add `diagnostics.read` to the catalogue, `ORGANIZATION`-scoped, authenticated always. Keep the "safe to paste" property (no secrets, no PII) — that part is good — but authentication and pasteability are independent properties.

### C-7 — MEDIUM — `SELF` is an implicit universal grant, which is what D-030 forbids
**`02-security-privacy.md` §2.1, §2.2**

`SELF` — "The holder's own records" — "Every authenticated person, **implicitly**". Which permissions does this implicit grant carry? Unstated. If `SELF` is evaluated as a scope match without an explicit `RoleAssignment`, then `requirePermission('students.medical.read', {student: self})` may pass for any authenticated person with no grant at all. Deny-by-default (§1.1 rule 2) is violated by an implicit rule in the same document.

Related: `RELATED` is in the enum and the coverage table but the portal that uses it is deferred to v2 ("table exists in v1"). A scope type implemented but unreachable is exactly the dormant security code D-056 spends a page condemning.

**Fix.** Make `SELF` an explicit, seeded role assignment with a named, minimal permission set (`people.read` on own `Person`, own progress, own certificates — enumerate it). Never medical, never notes, without an explicit grant. Either implement `RELATED` enforcement in v1 or remove it from the enum until the portal ships, per D-056's own logic.

### C-8 — MEDIUM — No IdP deprovisioning path, so removal from the corporate directory grants nothing
**`02-security-privacy.md` §1.2, §1.2.1; `00-overview.md` §3.3 (SCIM deferred)**

"Sessions invalidate immediately when an account is disabled" — but nothing disables the account. With SCIM explicitly deferred and JIT linking on, an instructor removed from Entra on their last day keeps their SplashTrack `UserAccount`, their local password (if set), their passkey, and their `GROUP`-scoped access to children's records until an administrator manually notices.

**Fix.** For v1 without SCIM: state the gap in the documentation as an operator duty (offboarding checklist), add an "accounts that have not authenticated in N days" report to the admin area, and make role assignment expiry (B-7) the default for staff grants rather than the exception.

### C-9 — MEDIUM — GCM over a streamed multi-gigabyte archive, with the manifest read before authentication
**`14-backup-restore-upgrade.md` §2, §3.1, §4.2**

"AES-256-GCM encrypted", "streamed into an encrypted archive", then "decrypt and verify checksum → **read manifest** → restore". Unspecified: nonce management, chunk framing, sequence binding. GCM is not a streaming construction; a naive implementation either buffers the entire archive (impossible for a large instance) or encrypts chunks independently — in which case an attacker can truncate, reorder or splice chunks between two archives and the per-chunk tags still verify.

Also: if the manifest is read to drive the restore before the *whole* archive is authenticated, you are acting on unauthenticated attacker-controlled data — which combines badly with A-3.

**Fix.** Name a framed AEAD construction (libsodium `secretstream`, or `age`) with per-chunk sequence numbers and an explicit final-chunk marker. Authenticate the manifest as a separate AEAD message bound to the archive's data key, and verify it before any parsing. State the nonce policy (random per archive, never reused across archives — which per-archive data keys in B-2 give you automatically).

### C-10 — MEDIUM — Recovery-token entropy and restore brute-force are unspecified
**`14-backup-restore-upgrade.md` §2, §4.1**

Format `STK1-XXXX-XXXX-…`, "human-transcribable", "printable". If it encodes a full 256-bit key it is ~50+ characters and nobody will transcribe it correctly; the pressure to shorten it for usability is exactly what makes this dangerous. No minimum entropy is stated, and the restore endpoint (which lives in the unauthenticated setup wizard) has no stated rate limit or lockout.

**Fix.** State a floor: ≥128 bits, Crockford base32 with a check character, grouped for transcription. If the token becomes a passphrase over a KDF (B-2), use Argon2id with stated parameters so a shorter token is defensible. Rate-limit and lock out the restore endpoint; audit failed attempts.

### C-11 — MEDIUM — The public/person separation has no enforcement mechanism, unlike module boundaries
**`03-deployment-model.md` §5.1 (D-017); `00-overview.md` §3.4 (D-051); `05-technical.md` §3.1**

D-017/D-051 are the strongest ideas in the design and are justified as *structural*: "If the public renderer has no code path to `Person`… no CMS bug can expose them." But the enforcement listed for module boundaries — an ESLint `no-restricted-imports` rule, "a build failure" — is never applied to the `(public)` route group. Public and portal share one process, one Prisma client, one database. The boundary is a convention with a strong sentence attached.

**Fix.** Extend the existing lint rule: `app/(public)/**` may not import `modules/{people,students,groups,attendance,exams,skills,consent,identity}/**`. Add a CI test that walks the public route tree and asserts no query against person-owning tables is reachable. This is a half-day of work that converts the design's best claim from asserted to enforced — exactly the standard the design sets for itself elsewhere.

### C-12 — MEDIUM — MFA mandate is bound to a role name that does not exist
**`02-security-privacy.md` §1.2; `07-operations.md` §1.3**

"**MFA is mandatory** for `platform.super_admin` and organisation administrator roles" — but `00-overview.md` §5.1 and `02` §2.4 both state emphatically that there is no platform super administrator and no platform namespace, and D-056 removes it. `07-operations.md` §1.3 then lists "any `platform.super_admin` use" as a security alert — an alert on a principal that cannot exist will never fire, giving false assurance in the monitoring section.

More than a stale name: it means the normative statement of *which principals must have MFA* was never re-derived after the architecture changed. "Organisation administrator roles" is not a checkable predicate either — roles are user-definable.

**Fix.** Bind the MFA mandate to **permissions**, not role names: any principal holding any of a named high-risk set (`organization.settings.manage`, `privacy.*`, `roles.assign`, `audit.read`, backup permissions, `students.medical.*`) at any scope must have MFA enrolled, enforced at login and at grant time. Remove `platform.super_admin` from both chapters.

### C-13 — MEDIUM — The CI gate that backs the top internal risk is named for a deleted concept
**`06-delivery.md` §2.1 vs `02-security-privacy.md` §3 (D-032)**

Required blocking check: "**Organisation isolation tests** — Dedicated suite; a module without them fails DoD". The organisation-isolation/tenancy suite was deleted (D-056, F-01); the replacement is *scope-escape* tests (D-032), which the findings chapter calls the mitigation for the highest-severity internal risk in the product. A gate named after the removed concept will be satisfied by whatever someone writes under that name — plausibly a trivial single-organisation assertion that passes forever.

**Fix.** Rename the check to "Scope-escape tests" and specify its minimum content per module: a `GROUP`-scoped, a `UNIT`-scoped, a `COURSE`-scoped and an `EXAM_SESSION`-scoped principal each attempting read, write and **list** outside their scope, plus a case asserting a `Reach` cannot be constructed outside `resolveReach`.

### C-14 — MEDIUM — Chapter 01 §2.3 contradicts D-057 in the same chapter
**`01-domain-model.md` §2.3 vs §1.2 (D-057)**

§2.3: *"One table, two module owners — `planning` writes it, `attendance` reads it… **This is the only shared table in the design and it is deliberate**."* D-057, 100 lines earlier in the same document, exists specifically to reject that: *"An earlier draft had `planning` writing the table and `attendance` reading it — 'one table, two owners', which violates this document's own isolation rule."* §3.4's table repeats the rejected version ("Written by `planning`, read by `attendance`").

Module ownership is a security-relevant boundary here — it determines which module's authorization policy governs writes to `ScheduledSession`, and sessions are what `GROUP` scope coverage hangs on.

**Fix.** Update §2.3 and the §3.4 note to reflect D-057 (`sessions` owns it; both others are consumers).

### C-15 — MEDIUM — `UNIT` reach is ambiguous for a student who crosses units
**`01-domain-model.md` §3.6; `02-security-privacy.md` §2.2**

`StudentProfile` carries a *home* `unitId`; `Group` carries its own `unitId`; sessions inherit from the group. A child registered at Zuidbad who attends a summer course at Noordbad is reachable by the Location Manager of *both* — and because effective reach is the **union** of grants, the broader answer always wins and the narrower one never constrains. Shared facilities and cross-location courses are normal in this domain.

**Fix.** State the rule explicitly: which unit governs a `StudentProfile` read — home unit only, or any unit where an active group membership exists? Recommend: home unit governs the *profile*; the group's unit governs *that group's* attendance and progress only (this composes correctly with B-8's per-relation coverage). Write the test.

### C-16 — MEDIUM — "No DPA is needed between us" is a legal conclusion in a document that promises not to give legal advice
**`10-findings.md` F-05; `02-security-privacy.md` §5.1 (D-064)**

D-064 itself is the best-reasoned GDPR passage in the set and gets the controller/processor position right — including the point that a hosting provider or a consultant operating the instance *may* be a processor. But F-05 states flatly: "**No DPA is needed** between us." That is a legal conclusion about the reader's obligations, stated in a document whose own trade-off paragraph says it "states the roles and points to the questions; it does not answer them for anyone."

**Fix.** Restate as fact rather than conclusion: "The project receives no personal data from your installation and performs no processing on your behalf. Whether any agreement is required between you and any party is your assessment to make with your own advisor." Same treatment for the D-064 bullet "No data processing agreement arises…".

### C-17 — MEDIUM — The version check is not quite "sends nothing"
**`03-deployment-model.md` §2.1 (D-034)**

"No telemetry. The only outbound call is an opt-out version check that **sends nothing but the version it is checking**… no identifiers, no counters, no server-side logging we control."

Every HTTPS request sends a source IP address and a User-Agent, and arrives at infrastructure someone logs — GitHub, a CDN, whoever hosts the advisories file. An IP address is personal data. "No server-side logging we control" is accurate and also concedes the point: the logging exists, it is simply someone else's. For a self-hosted school instance, the request pattern also reveals that this organisation runs SplashTrack, at this address, at this version.

This is minor in impact and notable only because the design's credibility rests on claims like this being exact.

**Fix.** Say it precisely: "the request necessarily discloses your server's IP address and the version string to <host>; it is disabled with `update.check.enabled = false`." Prefer fetching a *complete* advisories file rather than querying per-version, so the request reveals nothing about which version is running. Default it **on** (F-17 justifies that) but state the trade honestly.

### C-18 — MEDIUM — No DPIA template ships with a product whose core processing almost certainly requires one
**Whole set**

Large-scale processing of special-category data concerning children, using new technology — the Article 35 criteria are met several times over. The word DPIA does not appear in the design. F-27 correctly refuses to give legal advice, but a **template** is not advice: it is a document listing the processing operations the software actually performs, which only the project can enumerate accurately.

**Fix.** Ship `docs/privacy/dpia-template.md` pre-populated with the factual half the project uniquely knows: data classes and where they live, purposes, retention defaults, recipients, security measures, the residual risks this design already names (F-07 backups, F-13 unpatched instances, F-23 export). Leave the necessity/proportionality/risk-acceptance sections blank for the controller. Same for a privacy-notice skeleton. This is the highest-leverage compliance artefact available, and it is cheap.

---

## D. Low

- **D-1 — LOW — `AttendanceRecord` vs `AttendanceEvent`.** `01` §2.2, §3.4, §4 use `AttendanceRecord`; §3.4's entity table defines `AttendanceEvent` with `supersedesEventId`. The append-only guarantee (D-061) attaches to one name; three references use the other. The §4 aggregate row ("All its `AttendanceRecord` rows — one transaction") is the one that governs transaction boundaries.
- **D-2 — LOW — F-08 contradicts D-059.** F-08's response says "model the gap with `leftAt`" — a status field D-059 explicitly rejects in favour of `MembershipPeriod` + `StudentLifecycleEvent`.
- **D-3 — LOW — Stale D-007 references in active chapters.** `02` §5.5 (erasure row: "retain pseudonymised legal records (D-007)"), `04` §4.6 ("which pseudonymised records will be retained (D-007)"), `08` OD-12. `04` §4.6 is worst: it re-installs the *rejected* pseudonymisation framing in the erasure confirmation UI, which is the exact screen where D-065 requires the honest statement.
- **D-4 — LOW — Stale fleet references in active chapters.** `02` §6.2 lists "Operator with fleet deploy rights — **the genuinely dangerous principal now** … finding F-14" as a live abuse scenario; F-14 is closed and the fleet model is deleted (`03` §1.1). `07` FM-6 likewise prescribes "Waves, bounded skew, halt-on-failure" for a fleet that does not exist. Both sit in tables an implementer reads as a to-do list.
- **D-5 — LOW — `EXAM_SESSION` missing from the trust-boundary diagram.** `02` §6, Boundary 2 lists `ORGANIZATION ▸ UNIT ▸ GROUP ▸ COURSE ▸ SELF ▸ RELATED` — omitting the scope type D-054 makes first-class, on the data class the design says matters most.
- **D-6 — LOW — Broken normative sentence.** `02` §3, item 3: *"These replace the old scope-escape suite is non-optional for Definition of Done."* Two merged sentences in the statement of a mandatory CI gate.
- **D-7 — LOW — `00` §2.3 cites R-20 for the prototype import path; the requirements table assigns that to R-29** (R-20 is migrations/upgrades). `01` §3 preamble lists "`id`, `id`, `createdAt`".
- **D-8 — LOW — ISR caching and session-dependent content.** `03` §5.4 declares the cache-key hazard "gone" with tenancy. It is reduced, not gone: any public page rendering session-dependent chrome (a "logged in as…" nav) under ISR caches one user's view for all visitors. Worth one line: public pages must be rendered with no session read at all.

---

## Controls that are genuinely well designed

Only five, and only where they hold up.

1. **D-055 — state detection before migration, with restore *before* migrate (D-046).** Recognising that an empty database is ambiguous, and that `migrate deploy && start` destroys the restore path, is a subtle failure mode that most self-hosted products discover from a stranger's data loss. The `_prisma_migrations`-carries-its-own-version insight is correct and means there is no bespoke restore-migration path to keep right. This is the best engineering in the document set.

2. **D-047/D-048 — CI restores every supported release into `HEAD`, and `minimumRestorableVersion` is declared.** "Skipped versions are supported" is a promise almost every self-hosted project makes and none tests. Turning it into a blocking matrix job, and naming an honest floor rather than pretending the promise is unlimited, is the right shape. (It needs B-4's decryption assertion to actually cover the failure F-25 identifies as worst.)

3. **D-051/D-017 — the public surface has no read model for person tables.** Choosing structural impossibility over careful coding, for the single worst plausible incident, is correct, and the accepted friction (publishing person-derived content requires an explicit copy step) is placed exactly where consent belongs. It needs the lint rule in C-11 to be true rather than intended.

4. **D-010 + D-013 — special-category data behind its own permission pair, column-encrypted, with every read audited.** Refusing to let `students.read` imply medical access is the right default for a class list that half the staff can open, and auditing reads rather than just writes is the part most designs skip.

5. **D-064 — the controller/processor correction.** Recognising that the earlier text was simply wrong, that publishing software does not create a processor relationship, and that a hosting provider or consultant *may* nonetheless be one, is unusually careful reasoning. It is spoiled only by F-05's "no DPA is needed" (C-16) — fix that sentence and this is the strongest GDPR passage in the set.

---

## The five things I would fix before writing any code

1. **A-1** — add `roles.assign`, no-amplification and scope-confinement. Everything else in the authorization model is defeated without it.
2. **A-2** — the IdP registry as specified is an account-takeover primitive. Link on `(issuer, sub)`, never email; separate permission; no JIT roles.
3. **A-3 + A-4 + A-5** — the setup/restore path is one connected hole: an unauthenticated surface, gated on a deletable row, whose token goes to a log the design tells operators to publish, that ingests an untrusted SQL dump as database superuser.
4. **B-2 + B-3 + B-4** — one key for everything, three contradictory accounts of where it lives, no key id, no AAD. Decide the scheme once, in one chapter, before anything encrypts anything.
5. **B-14** — a product holding children's health data must let its controller answer "what did this account access" and "revoke everything now". There is currently nothing.