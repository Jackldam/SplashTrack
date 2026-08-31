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

Non-negotiable properties of the image:

- **No default credentials, ever.** Secrets are generated on first run and
  written to the data volume; the app refuses to start with a placeholder value.
- **First-run setup wizard in-app** — create the first administrator, force MFA
  enrolment, set organisation name and branding. Replaces D-028's script.
- **Migrations run automatically on start**, forward-only, logged, and safe to
  interrupt.
- **All configuration via environment variables**, documented in one place. No
  configuration file editing required for a standard install.
- **Runs as non-root**, read-only root filesystem, no build tools in the final
  layer, multi-stage build, pinned base image, published SBOM.
- **Health and readiness endpoints** so an operator's own monitoring works.
- **Backup and restore commands shipped with the image**, because a self-hoster
  who cannot restore has no backups (§2).

### 1.3 Structure inside an instance

Unchanged from the single-tenant revision. `Organization` is an enforced
singleton (D-027); `OrganizationUnit` provides the internal hierarchy that the
scoped authorization model (`02-security-privacy.md` §2) walks.

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
(previously FM-6) is gone. Portal pages are never cached across users.
