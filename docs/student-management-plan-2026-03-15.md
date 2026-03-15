# Student management status and plan — 2026-03-15

## Reality check

The repo is still broadly on track, but some wording in the docs was lagging behind the implementation.

What the app actually has today in `apps/web`:
- authenticated dashboard shell
- organization-aware RBAC and membership admin flows
- student directory with metrics and level spread
- student detail page
- guarded create flow
- guarded full update flow
- normalized per-organization student identity uniqueness
- guarded student lifecycle toggle: deactivate/reactivate with audit logging

What the docs previously still implied too strongly:
- student detail was still described as intentionally read-only
- richer student management was described as a future direction without clearly separating what is already done versus what is still missing

## Assessment

### Is the project on track?
Yes, with a caveat.

The implementation is progressing coherently on top of the current architecture: auth -> RBAC -> organization admin -> student management. That is the right order and the new student work still fits the architecture cleanly.

The caveat is planning/documentation drift. The code moved a bit faster than the summary docs, so the roadmap needed a refresh to avoid underselling what already exists and to make the next milestones concrete.

## Current student-management maturity

### Done
- Directory overview for the active organization
- Summary metrics for total/active/inactive students
- Active level spread breakdown
- Server-side student directory filtering (`all` / `active` / `inactive`)
- Server-side student directory search on name and swim level
- Student detail page
- Create student flow
- Edit student flow
- Deactivate/reactivate lifecycle action
- Audit logging for create/update/lifecycle mutations
- Per-organization duplicate guard via normalized identity key

### Not done yet
- true delete flow and corresponding data-retention policy
- archived/deactivated filtering in the UI
- attendance/enrollment/group assignment relations
- instructor/schedule slices
- Prisma migration/backfill for existing `identityKey` rows in shared environments
- integration/E2E coverage for server actions and protected student routes

## Recommended near-term priorities

### Milestone 1 — finish student management slice
1. Add filtering/search to the student directory (`all`, `active`, `inactive`).
2. Add a dedicated activity/history section or recent audit events on the student detail page.
3. Decide product policy for deletion:
   - likely keep hard delete disabled for now
   - document that deactivation is the supported archive behavior
4. Add DB-backed tests for duplicate rejection and lifecycle mutations.

### Milestone 2 — structure students into operational groups
1. Introduce swim groups / class groups.
2. Assign students to groups.
3. Add instructor ownership or assignment hooks.
4. Show group membership in directory/detail pages.

### Milestone 3 — attendance and progress
1. Attendance records per lesson/group.
2. Progress checkpoints per student.
3. Reporting slices on attendance and readiness for certificates.

## Decision for now

For the current architecture and data model, **deactivate/reactivate is the correct next CRUD step**.

Why:
- it adds safe lifecycle management without introducing irreversible deletes too early
- it matches the existing `isActive` model already present in Prisma and the UI
- it preserves auditability while giving staff a practical archive behavior
- it avoids premature policy decisions around hard delete, retention, and referential integrity before attendance/groups exist

## Suggested doc language going forward
- describe the student slice as **foundational CRUD with soft-archive semantics via `isActive`**
- reserve “full delete” until there is an explicit product/data-retention decision
- keep the next roadmap focused on filters, groups, attendance, and DB-backed tests
