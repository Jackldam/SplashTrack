# 12 — Revision: open-source, self-hosted product

**Date:** 2026-08-31 · **Requested by:** Jack · **Supersedes the operational
half of `11-revision-single-tenant.md`.**

> *"Instances are wrong on the organizations own infrastructure. Our final
> product should be a docker container that has the complete application and
> it's fully open source so any party can download and leverage this web app."*

## The model, stated once

We publish an open-source Docker image and a reference `docker-compose.yml`.
Any organisation downloads it, runs it on infrastructure it owns, and operates
it itself. **We host nothing and hold no access to any deployment.**

## What this removes

The single-tenant revision deleted the tenancy machinery. This one deletes the
operations:

- Fleet manifest, waved rollouts, version-skew monitoring
- Per-customer provisioning script (D-028 revised — setup happens in-app)
- Per-instance deploy credentials
- The fleet-operator threat model (F-14, closed)
- Per-customer cost floor (F-16, closed)
- The processor relationship and every data processing agreement (F-05, closed)

Together the two revisions removed roughly half the original design. What is
left is a product, a release process, and documentation.

## What this adds

**Our obligation shifts from operating to shipping responsibly.** Five new
duties:

1. **The artifact must actually work** (D-033). One app image plus a compose
   file with Postgres. No default credentials — secrets generate on first run.
   In-app setup wizard. Automatic forward-only migrations. Non-root, read-only
   filesystem, SBOM.
2. **Upgrades must never strand anyone** (§2). Semantic versioning, skipped
   versions explicitly supported, migration chains never squashed within a
   major, release notes written for an IT generalist.
3. **Security advisories must reach operators** (D-034). Published advisories
   and an in-app warning when the running version has a known one. No telemetry
   beyond that — a privacy-first product does not phone home about a school.
4. **The release pipeline is now critical infrastructure** (F-18). A compromise
   ships to every operator, who trusts it because it is official. Signed images,
   provenance, pinned dependencies, tag-only release workflow that no
   contributor — Lucky included — can modify.
5. **Documentation is a feature, not an afterthought** (F-17). For self-hosted
   software, install and upgrade docs are as load-bearing as the code.

## The honest downside

**We can patch nothing and see nothing.** The realistic failure mode is not a
clever attack — it is a swim school running a three-year-old version on an
unmaintained server, holding children's health data. That risk is inherent to
the model and cannot be engineered away from our side (F-13, F-17). We can only
make upgrading easy, make advisories loud, and be honest in the documentation
that operating it is their responsibility.

Given the alternative — us holding health data about thousands of children — it
is the right trade. But it should be chosen with eyes open, not framed as pure
simplification.

## Open decisions this creates

| ID | Question |
|---|---|
| OD-13 | Which licence? **My recommendation: AGPL-3.0 + DCO.** Irreversible once contributions arrive |
| OD-14 | Will there ever be a hosted offering? Decide the licence as if yes, build as if no |
| OD-15 | Minimum operator skill level? Sets the packaging and documentation bar |

## Decisions changed

| ID | Now |
|---|---|
| D-012 | **(Final)** Open-source, self-hosted Docker image per organisation |
| D-028 | **(Revised)** No provisioning script; in-app first-run setup |
| D-029 | **(Reaffirmed)** No control plane, ever — now by construction |
| D-033 | **(New)** One app image + reference compose file including Postgres |
| D-034 | **(New)** No telemetry; opt-out version check only |
