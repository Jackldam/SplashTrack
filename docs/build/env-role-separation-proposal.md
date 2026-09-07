# Proposal — separate the database roles `.env` and `.env.uat` share

**Status: SUPERSEDED IN PART, AND EXECUTED — 2026-09-07.** Read §0 before
anything else. The separation was carried out, but *not* by the method proposed
below, because four of this document's load-bearing claims turned out to be
wrong when they were checked against the running cluster instead of against the
`.env*` files.

**Owned by:** whoever runs the migration (Jack). §0 records what was actually
done; §§1-8 are kept unedited as the original reasoning, including its errors.

---

## 0. What was verified on 2026-09-07, and what it changed

Jack approved the separation. Before executing, the running system was checked
rather than the files. Four corrections:

**0.1 — There is ONE Postgres cluster, not two.** §1 concludes dev and UAT "are
not the same physical instance" from the fact that their URLs name different
hosts. They do not: `localhost:5432` (from the host, via the published port)
and `postgres:5432` (from inside the compose network) are the *same container*,
`splashtrack-postgres-1`. It holds `splashtrack`, `splashtrack_uat`,
`splashtrack_test` and `splashtrack_migrationcheck`.

**0.2 — So the shared password was never a copied secret; it was one role.**
Postgres roles are cluster-wide. `splashtrack_app` was not two roles that
happened to hold the same password — it was a single role object that both
environments authenticated as. §2's hypothesis (a fresh credential written into
both files during the 2026-09-03 response) explains a coincidence that did not
need explaining.

**0.3 — Therefore §5 steps 1-2 are impossible as written.** "Rotate the UAT
password, then rotate the dev password" cannot separate anything: a role has
exactly one password, so rotating it changes both environments at once. Password
rotation was never the fix. Creating per-environment roles — §5 step 4, filed
here as optional and last — was the *only* thing that could work, and it became
step one.

**0.4 — Role renaming is not a pure config change.** §3 says "nothing hardcodes
`splashtrack_app`". That is true of the application (`role-model.ts` reads role
names out of the URLs) and false of `infra/provision-roles.sql`, which names the
three roles literally in 30 places. That file was therefore *not* used; the two
new login roles were created with a small purpose-built statement mirroring the
attributes captured from the live cluster, and `db:apply-grants` — which reads
role names from the URLs — put the ADR-0002 grants on them.

### What was executed

Per environment, two new LOGIN roles with independently generated passwords:

| Environment | Application role | Retention role | Database |
| - | - | - | - |
| dev | `splashtrack_app_dev` | `splashtrack_retention_dev` (CREATEDB) | `splashtrack` |
| uat | `splashtrack_app_uat` | `splashtrack_retention_uat` (NOCREATEDB) | `splashtrack_uat` |

`splashtrack_owner` stays shared **on purpose**: it is NOLOGIN, so it holds no
password and carries no shared-credential risk. Suffixing it would mean
re-owning the database, the schema and every object for no security gain today.
That is a deliberate narrowing of §4's table, not an oversight.

UAT retention lost `CREATEDB`, which the shared role carried only because dev's
test tooling needs it — a least-privilege gain that came free with the split.

Old `splashtrack_app` and `splashtrack_retention`: **`NOLOGIN`, not dropped.**
They still own `splashtrack_test` and `splashtrack_migrationcheck`, and a
revoked-login role is cheap rollback insurance. This also retires the credential
exposed on 2026-09-06 — it now authenticates nothing.

### Verification

- Dev: `db:apply-grants` and `audit:grants` both report `splashtrack_app_dev`
  with SELECT+INSERT on `AuditEvent`, owning nothing; "D-149 part 2 is IN FORCE".
  Full suite 677/677 after the switch.
- UAT: same report for `splashtrack_app_uat`; container healthy, HTTP 200, and
  `pg_stat_activity` shows the app connected as `splashtrack_app_uat`.
- Two integration tests failed on the dev switch and were fixed rather than
  worked around: `database-role-model.test.ts` and `attendance-append-only.test.ts`
  asserted the `REFERENCE_*_ROLE` constants, contradicting `role-model.ts`'s own
  "ROLE NAMES ARE READ, NOT ASSUMED". They now derive the role from the URL, so
  they test the separation instead of the naming convention.

### Rollback

`.env.pre-role-split` and `.env.uat.pre-role-split` hold the previous files.
Restoring one and running `ALTER ROLE splashtrack_app LOGIN;
ALTER ROLE splashtrack_retention LOGIN;` returns that environment to the shared
pair; the old roles were never dropped and their password is unchanged. Both
new roles can then be dropped, or simply left unused.

### Still open

- Secret storage: `.env*` remains what the app reads. The values are in
  Bitwarden (`openclaw/splashtrack/{dev,uat}/…`) but nothing rewires the app to
  fetch them; that is an application change, not a database one.
- `prd` was not touched — there is still no `.env.prd` to inventory.
- Dropping the two NOLOGIN roles, once a full deploy cycle has passed without
  needing them.

---

## 1. What was inventoried, and how

Role **names** are not secret and are reported below. Passwords are never
printed, quoted, or included even redacted — only whether two values are
byte-identical, checked by comparing SHA-256 hashes computed locally and never
displayed.

```
$ grep -oE '^[A-Z_][A-Z0-9_]*=' .env      # key names only
$ grep -oE '^[A-Z_][A-Z0-9_]*=' .env.uat  # key names only
```

Both files define the same nine keys: `BETTER_AUTH_URL`,
`DATABASE_MAINTENANCE_URL`, `DATABASE_URL`, `LOG_LEVEL`, `POSTGRES_PASSWORD`,
`SECRET_KEY_FILE`, `SPLASHTRACK_APP_PASSWORD`, `SPLASHTRACK_PROVISION_CREATEDB`,
`SPLASHTRACK_RETENTION_PASSWORD` (`.env.uat` additionally sets `APP_PORT`).

Extracting only the **username** from each connection URL (never the password,
never the full string):

| Variable | `.env` (dev) | `.env.uat` |
|---|---|---|
| `DATABASE_URL` role | `splashtrack_app` | `splashtrack_app` |
| `DATABASE_MAINTENANCE_URL` role | `splashtrack_retention` | `splashtrack_retention` |
| host/db (no credentials) | `localhost:5432/splashtrack` | `postgres:5432/splashtrack_uat` |

So dev and UAT point at **different database hosts and different database
names** — they are not the same physical instance — but authenticate as
**identically-named roles**.

**A second, more urgent finding, found while checking whether the two
environments merely share names or share secrets:** `SPLASHTRACK_APP_PASSWORD`,
`SPLASHTRACK_RETENTION_PASSWORD` and `POSTGRES_PASSWORD` hash identically
between `.env` and `.env.uat`. The role names are not just conventionally the
same — **the credential values are currently the same secret, reused across
two environments.** This was checked with a local hash comparison only; no
value was read into this report.

```
$ sha256sum(<val from .env>) == sha256sum(<val from .env.uat>) for all three
```

## 2. Why this state exists (hypothesis, labelled as such)

Not verified by inspecting a log or a commit — both files are gitignored and
carry no history (`git log` on them returns nothing) — but consistent with the
documented timeline:

- `docs/build/incident-2026-09-03-exposed-postgres.md` §"Response" step 3
  states a **fresh credential was generated into `.env` and `.env.uat` in the
  same remediation step** on 2026-09-03. That is the most likely origin of the
  shared value: one password, written to both files at once, because the
  incident response needed *a* safe credential fast, not yet a distinct one per
  environment.
- `scripts/rotate-uat-db-credentials.py`, dated 2026-09-06, exists specifically
  to rotate *only* the UAT pair after a credential leaked into a subagent
  transcript that day. **No `.env.uat.pre-rotation` backup file exists**, which
  is the file that script creates before it changes anything — so, as far as
  can be told from the filesystem, that rotation has **not yet been run**. This
  is an operational observation, not part of the requested proposal, and is
  flagged here only because it explains why the shared-value finding above is
  still current.

## 3. Why shared role names *and* shared secrets are both worth fixing, separately

**Shared secret values (the more urgent one).** Whatever compromises the UAT
app or retention credential today also authenticates against dev, and vice
versa, regardless of role naming. This is independent of everything else in
this document and is the one to act on first — see §5.

**Shared role *names* (the naming/least-privilege question this task asked
about).** Even after passwords differ, identical names across environments
mean:

- A connection string, log line, or error message naming `splashtrack_app`
  does not by itself say *which* environment it came from — an operator
  reading a leaked or logged identifier has to cross-reference the host to know
  the blast radius.
- `infra/provision-roles.sql` and `src/lib/database/role-model.ts` already
  argue at length (D-182, ADR-0002) that **the identity a connection
  authenticates as should say exactly what it may do and where** — that is the
  whole reason `splashtrack_owner`/`_app`/`_retention` are three roles instead
  of one. The same argument extends across environments: today nothing in a
  role's *name* distinguishes "the role a compromised UAT box can reach" from
  "the role a compromised dev laptop can reach," which matters the moment
  either environment is ever pointed at a shared or managed Postgres cluster
  rather than its own container.
- `role-model.ts`'s own stated design ("ROLE NAMES ARE READ, NOT ASSUMED") is
  built to make this cheap to fix: nothing hardcodes `splashtrack_app`, so an
  operator who provisions `splashtrack_app_uat` and points `.env.uat` at it
  needs zero code changes — the application reads the username out of the URL.

## 4. Proposed separation

Per environment (`dev`, `uat`, `prd`), provision role names suffixed by
environment, each with its own password, generated independently:

| Role | dev | uat | prd |
|---|---|---|---|
| owner (NOLOGIN) | `splashtrack_owner_dev` | `splashtrack_owner_uat` | `splashtrack_owner_prd` |
| app (`DATABASE_URL`) | `splashtrack_app_dev` | `splashtrack_app_uat` | `splashtrack_app_prd` |
| retention (`DATABASE_MAINTENANCE_URL`) | `splashtrack_retention_dev` | `splashtrack_retention_uat` | `splashtrack_retention_prd` |

This is additive to ADR-0002/D-182, not a replacement: the three-role
separation *within* one environment (owner/app/retention) stays exactly as
designed. This proposal only adds a per-environment suffix so the three roles
in one environment can never be confused with, or share a secret with, the
three roles in another.

Where each environment already runs its own Postgres container (true today for
dev and UAT, per §1's host/db table), the suffix is a naming/clarity
improvement layered on top of an already-real isolation boundary. It becomes a
*security* boundary, not just clarity, the day any environment is pointed at a
shared or managed server — which is exactly the situation `infra/provision-
roles.sql` §2 already anticipates for a "managed database (RDS, Cloud SQL...)".

## 5. Migration order

Ordered so the most urgent, lowest-effort fix (distinct passwords) ships
first, independently of the larger, optional fix (distinct role names), which
needs no code change but does need a provisioning run per environment.

1. **UAT password rotation — do this first, on its own.** The tooling already
   exists (`scripts/rotate-uat-db-credentials.py`) and appears not to have been
   run yet (§2). This alone removes the shared-secret finding for UAT and
   needs no schema change, no role rename, no code change. Verify afterward
   with `splashtrack db:apply-grants` / `audit:grants` against UAT.
2. **Dev password rotation.** Same shape as step 1 but against `.env`
   (`localhost:5432/splashtrack`). No such script exists yet for dev; the UAT
   script is close to a template but hardcodes the UAT container name
   (`splashtrack-postgres-1`) and env path — generalise it to take those as
   parameters rather than duplicating it.
3. **PRD password rotation**, once `environments/prd` has an actual configured
   instance (its README is currently a placeholder — no `.env.prd` was found
   to inventory). Do this during a maintenance window; it is the only step
   here with real user data behind it.
4. **Role renaming (optional, do only once 1–3 are done and stable).** Per
   environment:
   1. Run `infra/provision-roles.sql` with the suffixed names to create the
      three new roles (additive — does not touch the existing ones).
   2. Run `splashtrack db:apply-grants` against the new app/retention roles so
      they receive exactly the same grants the current roles hold (the
      statements in `role-model.ts` are already parameterised by role name,
      so this is a config change, not a code change).
   3. Update that environment's `DATABASE_URL` / `DATABASE_MAINTENANCE_URL` to
      the new username **and** a freshly generated password, in one atomic
      file replace (mirroring the existing rotation script's temp-file +
      `os.replace` pattern).
   4. Restart the app process for that environment so it picks up the new
      connection strings.
   5. Verify: `splashtrack db:apply-grants` reports the new role owning
      nothing and holding the expected grants; `audit:grants` still reports
      "D-149 part 2 is IN FORCE"; run the integration suite against that
      environment's database if a non-prod one.
   6. Only after verification, revoke login from the old role
      (`ALTER ROLE ... NOLOGIN`) rather than dropping it immediately — a
      revoked-login role is cheap insurance against a rollback and owns
      nothing, so it is not a privilege escalation risk left lying around.
      Drop it in a later, separate pass once nobody has needed it for a full
      deploy cycle.

## 6. Impact

- **No schema/DDL change** in steps 1–3. Postgres role passwords are set with
  `ALTER ROLE ... WITH PASSWORD`, which does not touch table ownership or
  grants (`provision-roles.sql` already documents this distinction for the
  owner role).
- **Brief reconnect required** after any credential change — the running app
  process holds a connection pool authenticated as the old password and must
  be restarted (or must re-read `DATABASE_URL` on next connection, depending
  on the pool's retry behaviour). Treat each rotation as a deploy, not a
  live hot-swap.
- **Step 4 (renaming) touches `.env*` files and CI/deploy secrets** wherever
  the current role names are referenced outside the app's own config reading
  (e.g. any deploy script or `docker-compose.yml` comment that names
  `splashtrack_app` literally) — grep for the literal name before renaming,
  since `role-model.ts` reads names from the URL but a human-maintained script
  might not.
- **No impact on `splashtrack_owner`'s NOLOGIN property or the retention role's
  non-inheriting membership** — those are per-instance properties this
  proposal does not change, only the name and the credential attached to each
  copy of them.

## 7. Rollback

- **Password rotation (steps 1–3):** keep the pre-rotation `.env*` file
  (the existing script's `.pre-rotation` convention) until the new credential
  is confirmed working end-to-end. Rollback is `ALTER ROLE ... WITH PASSWORD`
  back to the value in the retained backup file, then restore that file as the
  active one. Postgres only ever holds the *current* password for a role —
  there is no built-in history — so the backup file is the only way back, and
  must exist before the `ALTER ROLE` runs, not after.
- **Role renaming (step 4):** additive by construction — the old role is
  never dropped until §5 step 4.6, so rollback is simply pointing
  `DATABASE_URL`/`DATABASE_MAINTENANCE_URL` back at the old username and
  password (both still valid, since the old role was only had its login
  revoked, not dropped, until the final cleanup pass). This is why step 4.6
  defers the `DROP ROLE` to a separate, later pass rather than folding it into
  the same change.

## 8. What this proposal deliberately does not decide

- Whether `prd` gets its own physical Postgres instance or a database on a
  shared managed server — that decision determines whether §4's renaming is
  merely clarifying or actually security-load-bearing (§3), and is an
  infrastructure decision outside this inventory's scope.
- Secret storage going forward (a secrets manager vs. gitignored `.env` files
  per environment) — out of scope; this proposal only separates the
  *identities*, not the storage mechanism.
