# Progress note — 2026-03-15 — student identity / uniqueness

## What changed

- Student uniqueness was tightened up from a raw `organizationId + firstName + lastName` constraint to a normalized `organizationId + identityKey` model.
- The new `identityKey` is derived from:
  - first name (trimmed, whitespace-collapsed, case-insensitive for matching)
  - last name (trimmed, whitespace-collapsed, case-insensitive for matching)
  - date of birth when known
  - fallback token `unknown-dob` when date of birth is missing
- Create/update flows now write the identity key explicitly.
- Seed logic now upserts demo students through the new identity key.

## Why this approach

The old model blocked any same-name students inside one organization, even if they were clearly different children.

The new approach is a pragmatic middle ground that fits the current app behavior:

- it still prevents obvious accidental duplicates
- it allows same-name students when date of birth distinguishes them
- it keeps behavior deterministic even when DOB is missing by falling back to name-only uniqueness
- it avoids relying on nullable composite unique behavior in Postgres, which would otherwise allow multiple `NULL` DOB duplicates

## Production-minded notes

- Matching is normalization-based, but display casing is preserved from user input.
- Existing write paths compute the key in app code, so new student mutations stay consistent.
- If this moves toward a real migration, the next DB step is a proper Prisma migration/backfill for existing rows before deploying to shared environments.

## Validation run

- `npm run check --workspace @splashtrack/web`

## Follow-on note after this pass

The next student-management slice landed immediately after the identity work: the student directory now supports validated server-side status filters (`all` / `active` / `inactive`) plus search across first name, last name, and swim level. That closes one of the short-term roadmap items and makes deactivation more usable in practice.

## Follow-on note after the next pass

The student detail page now includes a dedicated recent activity/history section backed by the existing audit log. It shows compact summaries for create, update, deactivate and reactivate events, plus raw metadata for debugging.

## Likely next steps

1. Convert the migration plan artifact into a real Prisma migration/backfill once the target shared database is available.
2. Add DB-backed integration coverage for duplicate create/update rejection plus lifecycle mutations when CI/test infra includes a disposable Postgres database.
3. Consider surfacing a more specific UI hint when a same-name student is rejected because DOB is blank on both records.

## Update after phase-1 hardening pass

- Delete policy is now explicit in code and docs: no hard delete in phase 1; deactivate/reactivate is the supported archive flow.
- Duplicate conflict messaging now distinguishes the missing-DOB case and explicitly warns that inactive archived students still block reuse of the same identity key.
- Student audit metadata now carries more context (`identityKey`, lifecycle-policy flags, richer before/after snapshots).
- A migration-plan artifact was added at `docs/student-identity-migration-plan.sql` for shared-environment rollout.
