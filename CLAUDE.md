# CLAUDE.md — SplashTrack build rules

Rules for anyone (human or agent) writing code in this repository. They come from
`docs/design/`, which is the specification. Where this file and the design set
disagree, the design set wins and this file is wrong — fix it.

`AGENTS.md` covers agent conduct. This file covers what the code must look like.

---

## 1. What is being built, and for whom

**v1 targets exactly one deployment: the author's own swim club, operated by its
author** (D-162). Public release — third parties downloading, deploying and
operating SplashTrack — is v2. The licence (AGPL-3.0) and the public repository
are unchanged; what is deferred is the obligation to be *deployable by
strangers*.

Practical consequence: do not build setup wizards, one-click installers,
operator documentation, release provenance or multi-IdP registries in v1. Do
build the thing that runs a Tuesday evening at the poolside.

**The competitor is pen and paper.** Attendance registration must be faster than
a clipboard, on a tablet, with wet hands, and must degrade honestly when the
hall wifi drops. An interaction that is slower than paper is a defect, not a
trade-off.

---

## 2. The five rules that are not negotiable

These are retrofit-hostile: adding them after data exists means rewriting that
data. D-165 keeps them in v1 whatever else is cut.

1. **Encryption envelope before the first encrypted byte.** Every protected
   value is written through the D-096 envelope. A byte written without it must
   be re-wrapped later, by hand, from a backup.
2. **Audit chain, append-only.** `AuditEvent` is written by an insert-only
   database role. Application code never updates or deletes it (D-149).
3. **Scope/reach model before the first guard.** Every read of person data goes
   through `requirePermission` + `resolveReach` (D-147). `Reach` is opaque and
   constructible only by `resolveReach` — never hand-build one, never widen one
   "temporarily".
4. **Append-only history.** Attendance and exam results are event logs with
   superseding events (D-061, D-062). Never `UPDATE` a record to correct it.
5. **Consent, lawful basis and retention are columns, not a later feature.**
   Every personal-data table carries its retention policy from the day it is
   created (D-065, D-014).

If a task seems to require breaking one of these, stop and ask. It is always
cheaper than the migration that follows.

---

## 3. Language and naming

- **Schema identifiers, column names, API field names and code are English.
  No exceptions** (D-159). No Dutch identifiers, not even for domain terms with
  no clean translation.
- **`docs/glossary.md` is the translation record.** Before introducing a domain
  concept, add it there with its Dutch term. If the English word could mislead,
  the glossary carries the definition.
- **UI language is Dutch by default.** This rule is about identifiers, not about
  what an instructor reads at the poolside.

---

## 4. Boundaries

- **One organisation per installation.** There is no tenant id, no control
  plane, and no platform super administrator. Multi-tenant machinery inherited
  from `WebAppTemplate` is **removed**, not left unused (D-056).
- **No integration with any external system in v1** (D-163). The only ingress
  from another system is a one-time bulk CSV import. No adapters, no scheduled
  synchronisation, no push. SportLink is explicitly out (OD-19) and gets no stub
  column.
- **Modules own their tables.** A module never reads another module's tables
  directly; it calls an application service. `ScheduledSession` is owned by
  `sessions` (D-057).
- **A normative rule is stated once** (D-134). This applies to code too: one
  home per rule, everything else points at it.

---

## 5. Environment configuration

An application-owned environment variable is permitted **only** when the value
must be known before the database can be read, or when it determines where
persistent state lives (D-037). Everything else is a database-backed setting.
Adding one requires an ADR. There is no numeric limit and no quota.

`TZ`, `NODE_ENV`, proxy settings, CA paths and container runtime settings are
platform variables, not SplashTrack configuration.

---

## 6. Where things are

| What | Where |
|---|---|
| Specification | `docs/design/00..10`, `13`, `14`, `15` |
| Decisions (D-) | `docs/design/09-decision-register.md` |
| Findings (F-) | `docs/design/10-findings.md` |
| Open decisions (OD-) | `docs/design/08-open-decisions.md` |
| Review reports | `docs/design/review/agent-reports/` |
| Glossary | `docs/glossary.md` |
| Build tasks | `docs/build/` |

**Chapters 11 and 12 are history.** They carry a banner and must never be cited
as a requirement. If an active chapter contradicts them, the active chapter is
correct.

---

## 7. Working method

- **Verify before you assert.** Claims about `WebAppTemplate` are checked
  against its source, not remembered. Two design claims about the template were
  found false by reading the code; both had been written confidently.
- **Cite the decision.** A change that implements or contradicts a `D-` number
  says so in the commit message.
- **Small, reviewed changes.** Removal of inherited multi-tenant code is
  incremental and test-covered, so that reusable functionality is not broken by
  accident.
- **If in doubt, ask.** The project owner is a swim instructor as well as an
  engineer, and domain questions have real answers. Guessing about lesson flow,
  assessment or poolside practice is how this design acquired its worst errors.
