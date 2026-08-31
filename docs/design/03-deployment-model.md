# 03 — Deployment Model, Theming & Public Website

> **Revised.** This document replaces the earlier multi-tenant design. See
> `11-revision-single-tenant.md` for what changed and why.

## 1. Deployment model — one instance per organisation

**Decision D-012 (revised) — SplashTrack is a single-tenant application. Every
organisation runs its own isolated deployment: its own application instance,
its own database, its own storage, its own domain.**

```text
zwemschool-a.nl        →  instance A  →  database A  →  storage A
zwemschool-b.nl        →  instance B  →  database B  →  storage B
zwemvereniging-c.nl    →  instance C  →  database C  →  storage C

              no shared runtime · no shared database
              no shared cache   · no shared storage
```

**Reason.** Isolation by deployment is categorically stronger than isolation by
query predicate. A row-level tenancy bug is a class of vulnerability that
cannot exist here — there is no other organisation's data in the process, in
the database, or in the cache to leak. Given that the data includes health
information about minors, removing an entire vulnerability class outweighs the
efficiency of shared hosting. It also deletes a large amount of code: no
scoping extension, no `organizationId` on ~20 tables, no composite tenant
foreign keys, no cross-tenant test suite, no tenant cache keys. A direct win
against the brief's *"minimale hoeveelheid code"*.

**Trade-off.** Operational multiplicity: N instances to deploy, migrate, back
up, monitor, patch and pay for. Fleet management becomes the dominant
operational concern and must be automated from day one, not later (§3, finding
**F-13**). A dedicated database per customer also sets a cost floor, and
therefore a minimum viable price per organisation.

### 1.1 What this deletes from the design

| Removed | Why it is now unnecessary |
|---|---|
| `forOrganization()` scoping extension | Nothing to scope — the database holds one organisation |
| `organizationId` on every org-scoped table | Constant value; dead weight |
| Composite tenant foreign keys (D-006) | No cross-tenant write is representable |
| Cross-tenant isolation test suite | The attack has no target |
| Tenant-keyed public page cache (FM-6) | One instance, one cache |
| Cross-organisation `Person` (D-004) and its reachability guard (F-01) | A person exists in exactly one instance |
| Subdomain tenant resolution (D-015) | Each instance has its own domain |
| "Platform Support cannot read tenant PII" (D-011) | No tenant data exists platform-side at all |

**This is the largest simplification in the design.** Roughly a third of the
security architecture existed to defend a boundary that no longer exists.

### 1.2 What remains of `Organization`

`Organization` survives as an **enforced singleton** — one row per instance,
using the template's existing `PlatformBootstrap`/`PlatformSettings` pattern.
It holds name, contact details, branding, policies and retention settings. It
is configuration, not a tenant discriminator.

**Decision D-027 — Keep `Organization` as an enforced singleton rather than
dissolving it into a settings table.**
**Reason.** Domain objects legitimately reference "the organisation": a
certificate is issued by one, an audit event names one, an export is labelled
with one. A named entity keeps those references honest and keeps consolidation
possible later without a schema rewrite.
**Trade-off.** A foreign key that always points at the same row — mild
redundancy accepted for referential clarity.

### 1.3 Structure *inside* an instance

Isolation between organisations is now a deployment property. Structure *within*
an organisation becomes the interesting problem, and it is real: a swim school
with three pools needs an instructor at location A to be unable to browse
location B's students.

`OrganizationUnit` (inherited, ADR-021) provides a hierarchy with reach:

```text
Zwemschool Noord              (root)
 ├─ Locatie Zuidbad
 │   ├─ Groep A1
 │   └─ Groep A2
 ├─ Locatie Noorderpark
 └─ Afdeling Wedstrijdzwemmen
```

This tree is the primary scoping axis of the revised authorization model
(`02-security-privacy.md` §2).

---

## 2. Provisioning a new organisation

Because every customer is a deployment, onboarding must be a **scripted,
repeatable operation** rather than a manual checklist. This is the biggest new
requirement created by single-tenancy.

```text
provision <org-slug> <domain>
  ├─ create database + credentials
  ├─ create storage bucket + credentials
  ├─ register DNS + issue TLS certificate
  ├─ deploy the current released image (identical artifact fleet-wide)
  ├─ run migrations
  ├─ seed permission catalogue, starter roles, default skill catalogue
  ├─ first-run bootstrap → create first administrator, force MFA enrolment
  ├─ register in the fleet manifest
  └─ enable monitoring + backup schedule
```

**Decision D-028 — Provisioning is code in the repository, not a runbook.**
**Reason.** A manual procedure drifts immediately, and drift across instances
is precisely what makes fleet upgrades dangerous. Scripted provisioning also
makes DEV and UAT genuinely production-shaped, because the same script builds
them.
**Trade-off.** Upfront investment before the first customer. Accepted — the
alternative is paying it repeatedly and inconsistently.

The template's `PlatformBootstrap` (enforced singleton recording the one-time
first-run setup) is exactly the right primitive and is reused unchanged.

---

## 3. Fleet management

| Concern | Approach |
|---|---|
| **Inventory** | A machine-readable fleet manifest in the ops repository: instance → domain → version → database → backup schedule → contact. Source of truth for every fleet operation |
| **Upgrades** | The same image rolls out in waves: internal → early adopters → the rest. Never all at once |
| **Version skew** | Explicitly allowed and bounded — at most one minor version behind. The manifest reports drift; exceeding the bound raises an alert |
| **Migrations** | Run per instance during rollout, with the populated-database CI job as the safety net. A failure halts the wave |
| **Backups** | Per instance (`07-operations.md` §2). Restore drills rotate across instances so all get exercised over time |
| **Monitoring** | Per-instance health plus a fleet dashboard: which instances are down, behind, erroring, or near storage limits |
| **Secrets** | Per instance, never shared. One instance's credentials must not reach another |
| **Cost** | Tracked per instance — it is the unit economics of the product |

**Decision D-029 — No shared control plane in v1.**
**Reason.** A central service able to reach every instance would reintroduce
exactly the cross-organisation attack surface single-tenancy just removed, and
would hold credentials to every customer's data. Fleet operations run from CI
against the manifest, with per-instance deploy credentials in GitHub
Environments.
**Trade-off.** No live cross-instance view inside the product; fleet visibility
comes from monitoring and CI. Revisit only on measured need — and if it ever
happens it should be read-only telemetry, never data access.

---

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
