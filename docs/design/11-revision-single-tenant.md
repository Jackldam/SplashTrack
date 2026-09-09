# 11 — Revision: from multi-tenant to single-tenant

> ## ⚠️ HISTORY — NOT AN IMPLEMENTATION SOURCE
> This chapter records **how the design changed** (multi-tenant → single-tenant) and why.
> It is kept for traceability of reasoning only. **Do not implement from
> it and do not cite it as a requirement.** The active chapters (00–10, 13,
> 14) are consolidated and authoritative; if this note appears to
> contradict them, they are right and this note is stale.

**Date:** 2026-08-31 · **Requested by:** Jack · **Status:** applied to the whole
design set.

> *"Belangrijk is dat dit project dus niet multi org moet zijn, elke org moet
> z'n eigen omgeving draaien. Daarbij komt dat we met scoping alle rechten
> granulair kunnen zetten."*

## What changed

Two instructions, one structural and one about authorization.

**1. Single-tenant deployment.** Every organisation runs its own instance:
own application process, own database, own storage, own domain. There is no
shared runtime and no shared data anywhere.

**2. Granular scoping.** Rights are set per scope. Authorization is now
`permission × scope`, where scope is `ORGANIZATION`, `UNIT`, `GROUP`, `COURSE`,
`SELF` or `RELATED`.

## Why this is a better design, honestly assessed

**It removes a whole vulnerability class.** Row-level tenancy protects data
with a `where` clause. Every query is one forgotten predicate away from a
cross-customer leak, forever, on every feature anyone ever writes. Deployment
isolation removes the possibility rather than defending against it. For a
system holding health data about children, that is the right trade.

**It deletes a lot of code.** Gone: the scoping extension, `organizationId` on
~20 tables, composite tenant foreign keys, the cross-tenant test suite, tenant
cache keys, subdomain tenant resolution, and the platform-support PII
restriction. Roughly a third of the original security architecture existed to
defend a boundary that no longer exists. That is a direct win against the
brief's *"minimale hoeveelheid code"*.

**It simplifies GDPR.** Each organisation's data is physically separate. The
controller/processor split is cleaner, a data processing agreement maps to a
deployment, and an erasure request touches one database.

## What it costs — stated plainly

**Fleet operations become the dominant problem.** 100 customers means 100
databases, 100 backup schedules, 100 migration targets, 100 certificates. Done
by hand this collapses at around the fifth customer. Provisioning must be
scripted (D-028), rollouts must be waved and halt on failure, and version skew
must be bounded and monitored. **This work has to exist before the second
customer, not after.** Finding F-13.

**The dangerous principal moved.** There is no platform super administrator any
more — but whoever can deploy can reach every instance. Per-instance
credentials, required reviewers and audited deploys are now load-bearing
controls. Finding F-14.

**A per-customer cost floor appears.** Dedicated database, storage, certificate
and monitoring per organisation. This constrains pricing and may make very
small clubs unprofitable. Commercial decision, flagged as OD-11.

**Cross-organisation features become impossible by design.** A swimmer moving
between schools cannot carry their history through the database. If that is
ever needed it must be a signed, portable certificate artefact — cheap to
design now, awkward later. OD-12.

**The isolation problem did not disappear; it moved down a level.** An
instructor must not browse another location's students. That is now enforced by
scope filtering, which has *exactly* the same failure mode as tenant filtering:
a missed `where` silently returns too much. So the tenancy tests are not simply
deleted — they are replaced by mandatory scope-escape tests (D-032), and reach
becomes a required repository argument (D-031). Finding F-15.

## Decision changes

| ID | Before | After |
|---|---|---|
| D-004 | `Person` spans organisations | One `Person` per human per instance |
| D-006 | Denormalise `organizationId` everywhere | **Withdrawn** — constant column, dead weight |
| D-011 | Platform support cannot read tenant PII | **Withdrawn** — no platform holds tenant data |
| D-012 | Single DB, shared schema, row-level tenancy | **Revised** — one instance per organisation |
| D-015 | Subdomain tenant resolution | **Withdrawn** — each instance has its own domain |
| D-016 | Closed theming token set | Unchanged, same reasoning |
| D-017 | Public surface cannot touch person tables | Unchanged, and now carrying more weight |

## New decisions

| ID | Decision |
|---|---|
| D-027 | `Organization` survives as an enforced singleton |
| D-028 | Provisioning is code in the repository, not a runbook |
| D-029 | No shared control plane in v1 |
| D-030 | Authorization is always resource-referenced |
| D-031 | Reach resolution is centralised and required by repositories |
| D-032 | Scope-escape tests are mandatory per module |

## New findings

| ID | Finding |
|---|---|
| F-01 | **Closed** — cross-organisation `Person` hole dissolved |
| F-13 | Fleet operations are the dominant risk, and were not in the brief |
| F-14 | The fleet operator is the new most-dangerous principal |
| F-15 | Scope filtering has the same failure mode tenancy did |
| F-16 | Per-customer cost floor was not considered |

## New open decisions

- **OD-3 (expanded)** — hosting target *and* who operates a customer's instance
- **OD-11** — per-customer cost floor and minimum viable price
- **OD-12** — is cross-instance functionality ever required?
