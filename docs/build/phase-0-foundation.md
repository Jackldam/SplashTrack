# Phase 0 — Foundation

**Purpose.** Everything here is scope-independent: it does not change whichever
way the two open scope questions (medical notes in v1, contributie in season
one) are answered, and it does not depend on any chapter that is a candidate to
move to v2. It is safe to start now.

**Branch.** `build/v1-foundation`, cut from `design/architecture-phase` so the
specification travels with the code.

**Definition of done for this phase.** The application boots against a real
Postgres, a local account can sign in with MFA, one migration has run, CI is
red-or-green for real reasons, and no multi-tenant concept remains reachable.
No domain module exists yet, deliberately.

---

## 0.1 Repository hygiene

- [x] **Layout decided: one application at the repository root**, following
      `WebAppTemplate`. No workspace, no `apps/` (D-174).
- [x] **`apps/web` removed** — 126 tracked files. OD-1 closed 2026-09-02: no
      deployed instance, no real data, so D-001's trade-off is free. Its value
      was domain knowledge and that now lives in `docs/design/`. Recoverable
      from history at any time.
- [x] The single untracked file inside it — `apps/web/.env`, local dev
      credentials — was **moved aside rather than deleted**, to
      `/root/projects/.splashtrack-attic/apps-web.env.2026-09-03`. Rotate and
      discard when convenient; it is off the build tree either way.
- [x] `package.json` de-workspaced. `docker-compose.yml` keeps only `postgres`
      until a real application and Dockerfile exist — the old `web` service
      pointed at the deleted prototype and would have been rebuilt wrong.
- [ ] **`.github/workflows/deploy-prd.yml` still references `apps/web`.**
      Left untouched deliberately: `.github/workflows/` is outside my write
      scope (D-025, the production boundary). Jack fixes or deletes it.
- [ ] Confirm `.env` is untracked and `.gitignore` covers `.env`, `.env.*`
      (done 2026-08-31, verify it survived).

## 0.2 Extract the foundation from WebAppTemplate

Reference: `/root/projects/WebAppTemplate` (`7db6488`). Copy deliberately, file
by file, not wholesale — every file that arrives should be one someone decided
to keep.

- [ ] Next.js app shell, TypeScript config, ESLint, Prettier
- [ ] Prisma setup and the `Person` / `UserAccount` split
- [ ] Better Auth wiring (`src/lib/auth/`), local accounts + TOTP MFA
- [ ] Session handling — **`src/lib/auth/session.ts` and
      `src/lib/settings/config.ts` already implement live, bounded,
      admin-configurable session timeouts.** Adopt them; do not build a parallel
      mechanism (see D-158, corrected).
- [ ] Audit infrastructure (`AuditEvent`, hash chain)
- [ ] Test harness: Vitest, Playwright config
- [ ] `tests/unit/migration-safety.test.ts` and the person-reference registry +
      sync test — adopt as they are (D-135), after verifying they do what the
      design claims.

## 0.3 Remove the multi-tenant machinery

D-056: removed, not left unused. Incremental and test-covered, so reusable
functionality is not broken by accident.

- [ ] Inventory every tenant-aware model, middleware, authorization path and
      schema element
- [ ] Remove `platform.super_admin` and every platform-role concept
- [ ] `OrganizationMembership` → `Membership`; `organizations` keeps the
      singleton organisation/configuration, and stops being a tenant table
- [ ] Enforce the organisation singleton at the database, not by convention
- [ ] Each removal is its own commit with tests green before and after

## 0.4 Ground rules in place before any domain work

These are the retrofit-hostile mechanisms. **Blocked until the core-repair pass
lands** — four known defects are being fixed in the specification right now
(Recovery Kit, AAD binding on rename, audit checkpointing, logical export vs
`pg_dump`). Building against the current text would mean rebuilding.

- [ ] Crypto envelope (D-096, as repaired) — before the first encrypted byte
- [ ] Audit chain + checkpointing (D-149 + the repair) — before audit rows
      accumulate
- [ ] `requirePermission` / `resolveReach` with the opaque `Reach` type
      (D-147), including `coversResource()` which the design names and does not
      define
- [ ] Retention policy columns and the erasure registry (D-014, D-065)

## 0.5 Supporting documents

- [x] `CLAUDE.md` — build rules
- [x] `docs/glossary.md` — D-159's translation record (has open questions in it)
- [ ] ADR directory and the first ADR: repository layout
- [ ] CI: lint, typecheck, unit tests, migration-safety test

---

## Open questions that block specific items

| Question | Blocks | Asked |
|---|---|---|
| Repository layout: single app or workspace? | 0.1 | not yet |
| Medical notes in v1? | domain modules only, not this phase | 2026-09-02 |
| Contributie during season one? | domain modules only, not this phase | 2026-09-02 |
| Glossary: `Lane`, `MakeUpLesson`, `WaitingList`, the word for an aftest assessor | first domain module | 2026-09-02 |
