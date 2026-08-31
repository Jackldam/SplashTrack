# 03 — Multi-organisation, Theming & Public Website

## 1. Multi-organisation architecture

### 1.1 Tenancy model

One application, one database, row-level tenancy (D-012). `Organization` is the
tenant boundary; every org-scoped row carries `organizationId` directly (D-006).

### 1.2 How an organisation is addressed

**Decision D-015 — Per-organisation subdomain, with custom domains prepared.**

```text
splashtrack.example/            → platform marketing + org directory (optional)
<org>.splashtrack.example/      → org public website
<org>.splashtrack.example/portal → authenticated portal for that org
<org>.splashtrack.example/admin  → org administration
www.zwemschool-x.nl             → later: custom domain, same org (P-ready)
```

**Reason.** A subdomain resolves the tenant *before* authentication, which is
what makes a fully branded public website and a per-tenant login page possible.
Path-based tenancy (`/org/<id>/…`) cannot brand the login screen, because the
tenant is unknown until after routing, and it makes custom domains a rewrite.
**Trade-off.** Wildcard DNS and a wildcard TLS certificate are required from
day one, and local development needs a wildcard-capable host entry. That is a
few hours of setup versus a structural limitation — an easy trade.

The template currently uses org-scoped paths (`(portal)/org/[organizationId]`,
ADR-013/029). Subdomain resolution is therefore an **additive** middleware step
that resolves `Organization` from the `Host` header and injects it as the org
context the existing code already expects. This is the main deliberate
divergence from the template and is recorded as an ADR in the new repository.

### 1.3 Organisation lifecycle

`PENDING → ACTIVE → SUSPENDED → CLOSED`. Only a platform super administrator
creates organisations. Closing an organisation blocks logins and public pages
immediately but retains data for the contractual retention window before a
reviewed hard delete. Nothing about an organisation is cascade-deleted —
`onDelete: Restrict` on person and org references means deletion is always a
deliberate, scripted, audited operation.

### 1.4 Cross-organisation people

A `Person` may belong to several organisations. The **guarantee** is that
organisation B learns nothing about organisation A: no shared profile, no
"you already have an account here" hint, no cross-org search. When the same
human is added twice, the system may deduplicate **only** when the person
proves control of the identity (verified email), and even then the profile
data stays separate. Finding **F-01** covers the guard this requires.

---

## 2. Theming architecture

**Requirement: theming must never require source-code changes.** The template
already satisfies this (ADR-007, ADR-010, ADR-017): `PlatformSettings` and
`OrganizationBranding` hold display name, logos (light/dark), favicon, app
icon, primary/secondary/accent colours and a `themeConfig` JSON blob; nulls
fall through to built-in defaults.

### 2.1 Mechanism — design tokens over CSS custom properties

```text
Built-in defaults  →  PlatformSettings  →  OrganizationBranding  →  rendered CSS vars
     (code)              (platform row)        (per-org row)          (per request)
```

The server resolves the token set for the current organisation and emits it as
CSS custom properties on the document root. Bootstrap and all components
consume those variables; no stylesheet is ever edited per tenant, and no
tenant-specific CSS is stored or executed.

**Decision D-016 — Tokens are a closed, validated set; not arbitrary CSS.**
**Reason.** Letting organisations supply CSS is a stored-XSS vector and makes
every future UI change a per-tenant regression risk. A closed token set
(colours, typography choice from a curated list, radius, density, navigation
style) delivers the branding requirement without handing over the renderer.
**Trade-off.** An organisation cannot achieve *arbitrary* visual design. This
is the correct limit for a product that must stay maintainable, and the brief's
list (name, logo, favicon, colours, typography, navigation style, images,
homepage, footer, contact, public pages, custom content) is fully expressible
within it.

### 2.2 Contrast is a security-adjacent requirement

Admin-chosen brand colours can destroy accessibility. The branding editor
**validates contrast** (WCAG 2.2 AA) on save and refuses combinations that fail,
offering the nearest passing shade. The template's Architecture.md §4.3 already
requires contrast "including against admin-customized brand colors"; we make it
a hard save-time gate rather than a guideline.

### 2.3 Typography and assets

Fonts come from a curated, self-hosted set — no third-party font CDN, because
that leaks visitor IPs to a third party and undermines the privacy posture.
Images and logos go through `UploadedAsset`: type allow-list, size limit, EXIF
stripped, served via an authorising route.

---

## 3. Public website architecture

### 3.1 The three surfaces

| Surface | Route group | Auth | Data reach |
|---|---|---|---|
| Public website | `(public)` | None | Published `CustomPage` content + org branding **only** |
| User portal | `(portal)` | Session required | Own data + assigned groups |
| Administration | `(portal)/admin` | Session + permission + MFA for privileged | Full org scope |

They share one deployment, one design system and one branding source — which is
the point, because an organisation gets a coherent site and portal for free.
They do **not** share data access paths.

**Decision D-017 — The public surface has its own read model and may not touch
person tables.**
**Reason.** This is the strongest available structural defence against the
worst plausible incident: a public page leaking data about children. If the
public renderer has no code path to `Person`, `StudentProfile`, `Attendance` or
`Exam*`, then no template bug, no CMS injection and no misconfigured page can
expose them.
**Trade-off.** Features that would want public person data — a public
instructor page with photos, a published exam result list — need an explicit,
separately reviewed opt-in that copies approved fields into a published
content record. That friction is intentional and is exactly where consent
belongs.

### 3.2 CMS scope — deliberately small

The inherited `pages` module (ADR-015, ADR-029) provides: pages with slug,
title, body, status (draft/published), navigation placement, and org-scoped
path routing. SplashTrack adds only a small set of **content blocks**: rich
text, image, call-to-action, contact form, opening hours, course overview
(reads the public course catalogue, not enrolments), and an FAQ.

Explicitly out of scope: arbitrary HTML/JS injection, plugins, a drag-and-drop
page builder, per-page custom CSS, e-commerce. The brief says it: SplashTrack
is not a WordPress replacement.

Rich text is stored as a structured document (the template already uses
TipTap) and sanitised **server-side on save and again on render** against an
allow-list. Never `dangerouslySetInnerHTML` on unsanitised input.

### 3.3 Public forms

A contact form and a course-interest form are the only public write paths. They
are rate-limited, bot-checked, never reveal whether an email is known, and
write to a `Lead`/`Inquiry` table — **not** to `Person`. Converting an inquiry
into a person is a deliberate act by an administrator. This prevents the public
form from becoming an unauthenticated person-creation endpoint.

### 3.4 Performance and caching

Public pages are cached (ISR or equivalent) **keyed by organisation**, with the
cache key including the tenant. A cache key that omits the tenant is the classic
way to serve organisation A's homepage to organisation B; a test asserts the key
composition. Portal pages are never cached across users.
