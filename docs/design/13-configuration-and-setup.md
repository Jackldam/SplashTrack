# 13 — Configuration, Setup & Administration

> Added 2026-08-31 after Jack's requirement: *"een organisatie moet een simpele
> manier hebben om met deze app te werken — een setup-pagina waar je alles kunt
> instellen zonder dat je Docker steeds hoeft te herstarten. Ook de configuratie
> moet volledig in de webapp te beheren zijn."*

## 1. The requirement, stated precisely

A self-hosted operator (D-012 final) must be able to install and fully
administer SplashTrack **through its own web interface**. Editing environment
variables, rebuilding an image or restarting a container must not be part of
normal administration.

This is a product requirement, not a convenience: the audience is a swim school
with limited IT capacity. If configuring email or SSO requires SSH and a
`docker compose down`, they will either not do it or do it wrong.

---

## 2. Prior art — how Vaultwarden does it, and what to take from it

Vaultwarden is the closest comparable: a self-hosted, open-source, single-org
application distributed as a container, aimed at operators who are not
full-time sysadmins. Its approach, verified from the project wiki:

| Aspect | Vaultwarden's approach |
|---|---|
| Admin surface | A separate `/admin` page, disabled unless an `ADMIN_TOKEN` is set |
| Admin authentication | The `ADMIN_TOKEN` itself **is** the password. A single shared secret, no user account |
| Session | Exchanging the token yields a JWT, default lifetime 20 minutes |
| Session revocation | **Not possible** — changing or removing the token does not invalidate issued JWTs. Only deleting `rsa_key.pem` invalidates them |
| Settings storage | Env vars, an env file, **or** a `data/config.json` written by the admin page |
| Live changes | Settings edited in the admin page apply without a restart |
| Project's own advice | **`config.json` is explicitly *not* recommended**; environment variables are the recommended method |

### 2.1 What to copy, and what to reject

**Copy the user experience.** A settings page inside the application, changes
applying immediately, and a diagnostics page showing effective values and where
each came from. That is exactly right and it is why Vaultwarden is pleasant to
self-host.

**Reject the authentication model, entirely.** A shared bearer token as the
admin password, in an environment variable, with non-revocable sessions, would
be a significant regression for SplashTrack — and unacceptable for an
application holding health data about children. We already have real user
accounts, MFA, passkeys, per-permission authorization, step-up re-authentication
and an audit trail. The settings page belongs behind *those*, not beside them.

**Reject the file-based store.** Vaultwarden writes `config.json` to a data
volume and then advises against using it — a telling contradiction. A file
inside a container needs a writable volume, drifts out of sync with the env
vars it overrides, is invisible to backups that only cover the database, and
has no transactional or audit story. **We have PostgreSQL.** Settings belong in
it: backed up with everything else, transactional, auditable, and readable by
the same code that reads everything else.

**Decision D-036 — Configuration lives in the database and is administered
in-app behind normal authentication; not in a file, not behind a shared token.**
**Reason.** As above: it inherits backup, transactions, audit and access control
for free, and avoids the shared-secret admin pattern that the closest comparable
project demonstrates the weaknesses of.
**Trade-off.** Settings cannot be read before the database is reachable, which
forces the small bootstrap layer described in §3. Accepted — that layer is
irreducible anyway.

---

## 3. The three configuration layers

The honest position is that **not everything can be in the database**, and
pretending otherwise produces a chicken-and-egg failure. Three layers, and the
first is kept deliberately tiny.

### 3.1 Layer 1 — Bootstrap (environment, restart required)

**Application-owned bootstrap variables** — the values the application must know
*before* it can read its own database, or that select where its own state lives:

```text
DATABASE_URL      where the database is
APP_URL           the public origin (also the WebAuthn relying-party origin)
SECRET_KEY        master key for encrypting secrets at rest (§5)
DATA_DIR          uploads/assets path (optional, sane default)
PORT              listen port (optional, sane default)
```

That is the current set, not a quota. It may grow when a value genuinely meets
the criterion below, and it should stay small because few values do.

Separately, and **not** application-owned: standard runtime and platform
variables an operator may need (`TZ`, `NODE_ENV`, proxy settings, a custom CA
bundle, container resource limits). We document them where relevant but do not
own or invent them.

**Decision D-037 — Environment holds only what must be known before
the database is readable, or what selects where state lives. Everything else
belongs in the settings registry. Adding a variable requires an ADR stating why
it cannot live in the database.**

**Reason.** A hard numeric cap would be an arbitrary architectural rule that
could later block genuinely necessary pre-database or platform configuration —
a TLS trust store, a proxy, a read-only-filesystem path. The *criterion* is what
matters, not the count: if a value can be read from the database, it must be. A
self-hoster should still never have to grep a two-hundred-entry `.env.template`
to find why email is failing.

**Trade-off.** The rule requires judgement rather than counting, so it needs the
ADR gate to stay honest. Settings that conventionally live in environment
variables (SMTP host, log level) move into the database and therefore cannot be
changed while it is unreachable — acceptable, because if the database is down,
those are not the settings being fixed.

### 3.2 Layer 2 — Runtime settings (database, in-app, live)

Everything else. A typed registry defines each setting once:

```text
key            organization.name
category       Organisation | Email | Authentication | Security | Privacy |
               Appearance | Website | Integrations | Maintenance
type           string | number | boolean | enum | json | secret
default        the built-in value
validation     Zod schema
scope          instance-wide
appliesLive    true | false  (see §4)
permission     which permission may change it
sensitive      whether the value is encrypted and masked
```

The registry is the single source of truth: it generates the admin UI, the
validation, the API surface, the documentation table, and the diagnostics page.
Adding a setting means adding a registry entry — never touching a form, a
migration and a docs page separately.

### 3.3 Layer 3 — Organisation content

Branding, pages, skill catalogues, roles: already database-backed domain data
(§4 and §5 of `03-deployment-model.md`). Mentioned only to note it is *not* part
of the settings registry — content and configuration stay separate.

The rule governing what may live in the environment is stated once, in §3.1
(D-037). It is not restated here.

---

## 4. Applying changes without a restart

A settings service holds a cached snapshot with a version counter. A write
bumps the version; readers revalidate on next access. No restart, no
redeployment.

**Two categories of setting, made explicit rather than glossed over:**

- **`appliesLive: true`** — the overwhelming majority. Read per request:
  session timeouts, retention periods, email templates, branding, feature
  toggles, password policy, rate limits.
- **`appliesLive: false`** — settings consumed by an object constructed once at
  startup. These are re-applied by **rebuilding that object**, not by restarting
  the process. The identity-provider registry (D-035) is the worked example:
  `WebAppTemplate` already loads Entra configuration at auth-context init, so
  changing a provider rebuilds the auth context rather than the container.

**Genuinely restart-requiring settings are only those in Layer 1**, and the UI
says so plainly where relevant — for example, changing `APP_URL` alters the
WebAuthn relying-party ID and **invalidates every existing passkey**, which must
be a loud, confirmed warning rather than a silent save.

**Decision D-038 — Every setting is either live or explicitly rebuild-scoped;
"restart the container" is never the answer for a Layer 2 setting.**
**Reason.** It is the actual requirement. It also forces a healthier
architecture: no module may capture a setting in a module-level constant at
import time, which is a common source of stale-configuration bugs.
**Trade-off.** Settings must be read through the service rather than a constant,
which is marginally more verbose and needs a lint rule to enforce.

---

## 5. Secrets in the database

SMTP passwords, OAuth client secrets and the like are stored encrypted with a
key derived from `SECRET_KEY`, using the pattern `WebAppTemplate` already
implements for the Entra client secret: encrypted at rest, decrypted
server-side only for use, and **never returned to any client** — the admin API
exposes a `secretSet: boolean`, never the value.

Consequences the documentation must state plainly:

- Losing `SECRET_KEY` means every stored secret becomes unreadable and must be
  re-entered. It is not recoverable from a database backup alone.
- A database backup without `SECRET_KEY` is therefore *safer* to move around,
  which is a feature.
- Rotating `SECRET_KEY` requires a re-encryption command, which ships with the
  image.

This is the same key-management question as OD-7 (special-category column
encryption); both are answered by one key and one documented rotation path.

---

## 6. Start-up, setup, restore and migration — one sequence

This is the **authoritative boot sequence**. Chapter 14 describes backup and
restore mechanics; where the two appear to differ, this section defines the
order.

**Decision D-055 — The container never migrates a database whose purpose is not
yet known. State is detected first; migration is a consequence of that state,
never the first action.**

```text
container start
  │
  ├─ database reachable?            no → fail fast, clear error, do not retry blindly
  │
  ├─ inspect schema state
  │
  ├── EMPTY  (no tables at all)
  │     → SETUP MODE. No migrations are run yet.
  │       Every request redirects to /setup. The wizard asks the one question
  │       only the operator can answer:
  │
  │         ┌─ New installation
  │         │    → run migrations  → seed catalogue + starter roles
  │         │    → create first administrator, force MFA
  │         │    → write bootstrap record → serving
  │         │
  │         └─ Restore from backup
  │              → decrypt + verify archive (nothing written until this passes)
  │              → restore dump: old schema + old data + _prisma_migrations
  │              → run forward migrations from that point (D-046)
  │              → verify against manifest → serving with the original accounts
  │
  ├── PARTIAL  (tables exist, no bootstrap record)
  │     → setup was interrupted. Resume SETUP MODE; do not migrate silently.
  │
  ├── EXISTING  (tables + bootstrap record, schema older than app)
  │     → take automatic pre-migration backup (D-044)
  │     → run forward migrations → serving
  │
  ├── CURRENT  (schema matches app)
  │     → serving
  │
  └── AHEAD  (schema newer than app)
        → REFUSE TO START. Name the image version required (D-043).
```

**Reason.** An empty database is ambiguous: it is either a fresh installation or
the first minute of a restore. Migrating it immediately resolves that ambiguity
in the wrong direction — the operator then has a fully migrated empty schema and
a backup that no longer restores cleanly into it. Detecting state first makes the
two paths explicit and keeps restore a normal operation rather than a rescue.

**Trade-off.** The entrypoint cannot be a naive `migrate deploy && start`; it
carries a small state machine, and that state machine is security- and
data-critical code. It is therefore covered by its own test matrix, one case per
state above.

### 6.1 The setup wizard

Reachable **only** in `SETUP MODE` (states EMPTY and PARTIAL), so it cannot be
re-opened once an administrator exists:

```text
0. New installation, or restore from backup?
1. Organisation name, locale, timezone
2. First administrator account (email, password or passkey)
3. MFA enrolment — forced, not offered
4. Recovery token shown once, with a required "I have stored this" step (D-040)
5. Email settings (optional, with a test-send button)
6. Done → bootstrap record written, /setup permanently closed
```

`PlatformBootstrap` is the template's existing enforced-singleton first-run
record, reused unchanged.

**Decision D-039 — The setup wizard is the only unauthenticated administrative
surface, and it self-destructs.**
**Reason.** First-run configuration is the one moment where no account can exist
yet. Bounding that window to "before the first administrator exists" removes the
standing unauthenticated admin surface that a permanent admin-token model keeps
open forever.
**Trade-off.** A race exists between container start and the operator reaching
`/setup` — whoever arrives first becomes administrator. Mitigated by printing a
one-time setup token to the container logs, which the wizard requires: the
operator can read their own logs, a stranger on the internet cannot.

---

## 7. Break-glass: locked out of your own instance

A self-hosted application must have a recovery path that does **not** depend on
a network-reachable secret. Ours requires host access, which is proof of
ownership:

```bash
docker compose exec app splashtrack admin:reset-mfa   --email …
docker compose exec app splashtrack admin:grant-admin --email …
docker compose exec app splashtrack settings:reset    --key …
docker compose exec app splashtrack settings:list
```

Every one of these writes an audit event. This replaces Vaultwarden's
"disable the admin token" escape hatch with something that cannot be reached
from the internet at all.

**Safety rails in the settings layer itself:**

- Local administrator login can never be disabled while it is the only working
  authentication method (D-035).
- Email and identity-provider settings must pass a **test** before they can be
  enabled.
- Every setting has a visible "restore default".
- Settings changes are audited: who, when, old → new (secrets recorded as
  `changed`, never with values).
- Configuration can be exported and imported **without secrets**, so an operator
  can reproduce an instance or hand it to a colleague.

---

## 8. Diagnostics page

Borrowed directly from Vaultwarden, because it is genuinely good: one screen
showing effective configuration, where each value came from (default, env,
database), database connectivity, migration state, email test result, storage
writability, version, and whether a newer release with a security advisory
exists (D-034).

It is the first thing to ask for in a support issue, and it must be safe to
paste into a public GitHub issue — so it renders **no secrets and no personal
data** (F-20).
