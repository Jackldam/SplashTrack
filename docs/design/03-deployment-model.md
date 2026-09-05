# 03 — Distribution Model, Theming & Public Website

> **Revised twice.** Multi-tenant → single-tenant → **self-hosted open source**.
> See `11-revision-single-tenant.md` and `12-revision-open-source.md`.

## 1. Distribution model — open-source, self-hosted container

**Decision D-012 (final) — SplashTrack is an open-source application shipped as
a Docker image. Each organisation downloads it and runs it on infrastructure it
owns and controls. We operate nothing.**

```text
  we publish            they run
  ──────────            ────────
  ghcr.io/…/splashtrack:1.4.0  ──▶  organisation's own server
  docker-compose.yml           ──▶  their Docker + their Postgres
  documentation                ──▶  their domain, their TLS, their backups
  source code (public repo)    ──▶  auditable, forkable, self-supportable
```

**Reason.** The organisation is then the sole controller *and* the operator of
its own data. There is no processor relationship, no data processing agreement,
no third party holding health data about children, and no cross-customer path
of any kind. Open source additionally makes the security and privacy claims in
this design **verifiable** rather than asserted — which is worth more to a
school board than any certification we could buy.

**Trade-off.** We lose all operational control. We cannot patch a vulnerable
instance, cannot see that one is failing, and cannot guarantee anyone runs a
current version. Our influence is limited to what we ship: safe defaults, easy
upgrades, honest release notes and a loud version check. Support becomes
documentation and issue triage rather than intervention. Finding **F-13
(revised)**.

### 1.1 What this deletes — again

| Removed | Why |
|---|---|
| Fleet manifest, waved rollouts, version-skew monitoring | We have no fleet |
| Provisioning script for customer instances (D-028) | The operator runs `docker compose up`; first-run setup happens in-app |
| Per-instance deploy credentials and GitHub Environments per customer | We deploy nothing but our own dev/demo |
| Fleet-operator threat model (F-14) | No principal has access to any customer instance |
| Per-customer cost floor (F-16) | Hosting cost is the organisation's, not ours |
| Data processing agreement per customer (F-05) | We never process their data |

Combined with the single-tenant revision, **the entire operational half of the
original design is gone.** What remains is a product and a release process.

### 1.2 What the artifact must be

**Decision D-033 — One application image, plus a reference `docker-compose.yml`
that includes PostgreSQL.**
**Reason.** "Complete application" must mean *works after one command*, or
self-hosting fails for exactly the small organisations that most need it.
Bundling Postgres *inside* the app image would be an anti-pattern (no clean
upgrades, no backup story, data trapped in a container), so the image stays
app-only and the compose file supplies the database, a volume and sane
defaults.
**Trade-off.** Two containers rather than one; operators wanting a managed
database point `DATABASE_URL` elsewhere. Acceptable and expected.

#### Target properties of the image — and what is actually true today

An earlier draft of this section listed six "non-negotiable properties of the
image" as though they described the artifact we have. At the time they did not:
the Dockerfile was a self-described *"development/Sprint-0 image"* — single-stage,
`FROM node:22-alpine` with no digest pin, `npm ci` including devDependencies, the
full source tree in the final layer, and the process running as root. Two further
bullets in that list were not merely unmet but *wrong*: "all configuration via
environment variables" inverts the whole of chapter 13, and "secrets are
generated on first run and written to the data volume" is incompatible with
restore (the archive would then contain its own key — F-96).

Phase 1.0 built most of it. The list below is therefore stated as **targets with
their current status**, not as a description, and the status is dated — an
implementer must be able to tell which of these they still have to build, and a
row that says "to build" against built work is how work gets done twice. Finding
**F-102**.

| Property | Status | Where it is specified |
|---|---|---|
| **No default credentials, ever.** The app refuses to start on a placeholder value. Bootstrap key material is operator-supplied via `SECRET_KEY_FILE`; the application never writes key material to the data volume | **Built** — `src/lib/crypto/secret-key.ts` | `13-…` §3.1.1 (D-112) |
| **Bootstrap secrets only in the environment.** All runtime configuration is database-backed and edited in-app | **Partly built** — the two credentials and `SECRET_KEY_FILE` are environment-only; the in-app settings surface is not built | `13-…` §3 (D-036/D-037) |
| **First-run setup wizard in-app** — first administrator, forced MFA, organisation name, branding. Replaces D-028's script | **Built** — three steps; branding and the steps behind the export and mail engines are not, and `13-…` §6.3 says which | `13-…` §6.3 (D-039, D-185, D-187) |
| **Migrations never run against a database whose state is unknown.** The entrypoint detects state first; migration is a consequence of that state | **Built** — `src/lib/boot/state.ts`, eight states | `13-…` §6 (D-055, D-098, D-186) |
| **The runtime database role is not a superuser and owns nothing** — a separate non-connecting owner role owns the schema; the runtime role holds `USAGE` plus DML. Stated where it is decided, not restated here (D-134) | **Built** — `infra/provision-roles.sql`, `src/lib/database/role-model.ts`, phase 1.2 | `14-…` §4.2.1 (D-116 as amended by **D-182**), `docs/adr/0002-database-roles-and-least-privilege.md` §7 |
| **Runs as non-root**, multi-stage build, no build tools or devDependencies in the final layer, digest-pinned base image | **Built** — four stages, `USER splashtrack` (`Dockerfile:179`), `node:22-alpine@sha256:c610fcdf…` (`:57`), `npm ci --omit=dev` (`:117`) | Phase 1.0 |
| **Read-only root filesystem and a published SBOM** | **To build.** `Dockerfile:31-32` names both as deliberately not done here: the SBOM is a CI concern, the read-only rootfs a compose concern | Phase 1.0 report, "not done here" |
| **`postgresql-client` deliberately ABSENT** — `pg_dump`/`pg_restore` are out of scope, not a fallback (D-169), so shipping the client would ship tooling for a mechanism this version does not have | **Absent, and that is the target** — `Dockerfile:48` | `14-…` §4.2.1 (D-169) |
| **Health and readiness endpoints** so an operator's own monitoring works | **Built** — `src/app/api/health/route.ts`, `src/app/api/ready/route.ts` | — |
| **Backup and restore commands shipped with the image**, because a self-hoster who cannot restore has no backups | **To build** — the export/restore engine is unbuilt, which is also why the wizard has no restore branch | `14-…` §3, §4 |

**Status column re-run against the tree on 2026-09-05** (rev8 D-12/D-13). The
column above had gone stale in the direction that costs the most: it described
built work as *"to build"* and named `postgresql-client`'s absence as a gap when
D-169 makes that absence the target. Evidence is
`docs/build/phase-1.0-deployment-and-breakglass-report.md` and the files cited in
each row. **Re-run this column against the repository before trusting it**; a
status table is a claim about a moment, and this one is dated on purpose.

**D-095** (stated in `14-…` §3.1, not restated here) makes the backup a
structured logical export the application writes and reads itself rather than a
raw SQL dump. It is named here only because it changes what the image must
contain.

The lifecycle of `SECRET_KEY` is stated **once**, authoritatively, in
`13-configuration-and-setup.md` §3.1.1. This chapter does not restate it, and
neither does `14-backup-restore-upgrade.md`; both point at it. Finding **F-95**.

### 1.3 Structure inside an instance

Unchanged from the single-tenant revision. `Organization` is an enforced
singleton (D-027); `OrganizationUnit` provides the internal hierarchy that the
scoped authorization model (`02-security-privacy.md` §2) scopes against. `UNIT`
is flat in v1 and no scope type walks a tree (D-121).

---

## 2. Release and upgrade model

This replaces fleet management entirely. Our obligations shift from *operating*
to *shipping responsibly*.

| Concern | Approach |
|---|---|
| **Versioning** | Semantic versioning, strictly. Operators upgrade on their own schedule and must be able to trust the contract |
| **Upgrade path** | Any version upgrades to any later version within a major. Migrations are forward-only, idempotent, and tested against a populated database in CI |
| **Skipped versions** | Explicitly supported — a self-hoster who upgrades once a year must not be stranded. Migration chains are never squashed within a major version |
| **Release notes** | Every release states: security fixes, breaking changes, migration duration risk, and required operator action. Written for an IT generalist, not for us |
| **Security advisories** | GitHub Security Advisories + a published `SECURITY.md` with a disclosure address and response commitment |
| **Version check** | The app checks for newer releases and **warns the administrator in-app when running a version with a known advisory**. Opt-out, no personal data sent, documented exactly (§2.1) |
| **Backups** | We ship the commands and document the policy; executing it is the operator's duty (`07-operations.md` §2) |
| **Support** | GitHub issues, documentation, and the source itself. No SLA is promised |

### 2.1 Telemetry — the honest position

**Decision D-034 — No telemetry. The only outbound call is an opt-out version
check that sends nothing but the version it is checking.**
**Reason.** A privacy-first product that phones home about a school's usage
would be self-contradicting, and the code is public so any such call would be
found and resented. The version check earns its exception because unpatched
self-hosted instances are the single biggest residual security risk (F-17), and
it can be implemented as a plain fetch of a static advisories file — no
identifiers, no counters, no server-side logging we control.
**Trade-off.** We learn nothing about adoption, usage or which features matter.
Accepted; that information is not ours.

**What the request nevertheless discloses.** "Sends nothing" is not exact and
the design's credibility rests on claims like this being exact. Every HTTPS
request necessarily discloses your server's IP address and a User-Agent to the
host serving the file, and therefore that this organisation runs SplashTrack, at
this address. The application fetches the **complete** advisories file rather
than querying per version, so the request reveals nothing about which version is
running, and "no server-side logging we control" concedes rather than answers
the point. It is disabled with `update.check.enabled = false`. The default stays
**on**: F-17 names unpatched instances as the single biggest residual risk.
Finding **F-131**.

---

## 3. Open-source considerations

| Concern | Position |
|---|---|
| **Licence** | **AGPL-3.0** (D-067, closes OD-13). Chosen over the GPL-3.0 the repository already carried because GPL copyleft triggers on distribution, not network use — and SplashTrack is software that is *run as a service*. AGPL §13 is what stops a competitor hosting a modified SplashTrack for swim schools while publishing nothing |
| **Security by design, not obscurity** | The source is public, so every control in this design must hold against an attacker who has read it. Nothing here relies on secrecy — which was already true, and is now enforced |
| **Supply chain** | Pinned dependencies, lockfile, Dependabot, `npm audit` gate, signed images, published SBOM, provenance attestation. A compromised dependency now ships to every self-hoster (F-18) |
| **Secrets** | No secret may ever be committed. Push protection and secret scanning are mandatory, and a leaked secret in history is permanent in a public repo |
| **Contributions** | `CONTRIBUTING.md` with a **DCO sign-off** requirement (F-28), and a rule that security-relevant changes require maintainer review regardless of author. The DCO must be in place before the first genuine external contribution: after that point, relicensing needs every contributor's agreement — the constraint that nearly cost us D-067 |
| **Issue hygiene** | Public issues may contain a self-hoster's logs or screenshots. The template must warn against pasting personal data, and maintainers redact |
| **Documentation is a feature** | For a self-hosted product, install and upgrade documentation is as load-bearing as the code. It ships in the repo and is versioned with it |

## 4. Theming architecture

Simplified: exactly one branding configuration per instance, so
`PlatformSettings` and `OrganizationBranding` collapse into a single `Branding`
singleton.

The mechanism is unchanged and inherited (ADR-007/010/017): **design tokens
emitted as CSS custom properties**, resolved server-side per request.

```text
Built-in defaults  →  Branding (singleton)  →  CSS custom properties
     (code)               (database)                (per request)
```

Bootstrap and all components consume those variables. No stylesheet is edited,
no custom CSS is stored or executed, and theming never requires a source-code
change — the brief's hard requirement.

**Decision D-016 (unchanged) — Tokens are a closed, validated set; never
arbitrary CSS.**
**Reason.** Even within one organisation, admin-supplied CSS is a stored-XSS
vector against that organisation's own users, and it turns every future UI
change into a per-customer regression risk across the fleet.
**Trade-off.** No arbitrary visual design. The brief's full list — name, logo,
favicon, colours, typography, navigation style, images, homepage, footer,
contact details, public pages, custom content — is fully expressible within the
token set.

Contrast is validated at **save time** against WCAG 2.2 AA; failing
combinations are rejected with the nearest passing shade offered. Fonts are
self-hosted from a curated set — no third-party font CDN, which would leak
visitor IP addresses.

---

## 5. Public website architecture

### 5.1 Three surfaces, one deployment

| Surface | Route group | Auth | Data reach |
|---|---|---|---|
| Public website | `(public)` | None | Published content + branding **only** |
| User portal | `(portal)` | Session | Own data + scoped reach |
| Administration | `(portal)/admin` | Session + permission + MFA | Full instance scope |

**Decision D-017 (unchanged, and now carrying more weight) — the public surface
has its own read model and may not touch person tables.**
**Reason.** Single-tenancy removed the cross-organisation leak. It did *not*
remove the worst plausible incident: a public page exposing this organisation's
own children. If the public renderer has no code path to `Person`,
`StudentProfile`, `Attendance` or `Exam*`, no CMS bug can expose them.
**Trade-off.** Publishing anything person-derived requires an explicit opt-in
that copies approved fields into a published content record. That friction is
where consent belongs.

### 5.2 CMS scope — deliberately small

Inherited `pages` module: slug, title, body, draft/published status, navigation
placement. SplashTrack adds a small block set: rich text, image, call-to-action,
contact form, opening hours, course overview (public catalogue only, never
enrolments), FAQ.

Out of scope: arbitrary HTML/JS, plugins, drag-and-drop page building, per-page
CSS, e-commerce. Rich text is stored structured (TipTap) and sanitised
server-side **on save and again on render**.

### 5.3 Public forms

Contact and course-interest forms are the only public write paths:
rate-limited, bot-checked, no user enumeration, writing to an `Inquiry` table —
never to `Person`. Converting an inquiry into a person is a deliberate
administrative act.

### 5.4 Caching

Public pages are cached (ISR or equivalent). The tenant-in-cache-key hazard
(previously FM-6) is reduced by single-tenancy, not eliminated: any public page
rendering session-dependent chrome — a "logged in as…" nav — would cache one
visitor's view for every other visitor. Therefore **public pages are rendered
with no session read at all**, which is what makes D-017's structural claim true
at the rendering layer and not only at the data layer. Portal pages are never
cached across users. Finding **F-132**.
