-- D-005 — the skill-progress exception, as SQL (phase 2.2 decision round).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- YOU ALMOST CERTAINLY DO NOT NEED TO RUN THIS.
--
-- `splashtrack db:apply-grants` applies exactly these statements, after every
-- migration, beside the audit and attendance exceptions. The whole model —
-- ownership first, why REVOKE ALL, what this defends against and what it does
-- not — is explained once, in `infra/audit-database-role.sql`; read that
-- first.
--
-- `tests/unit/skill-progress-grant-sql-sync.test.ts` fails if this file and
-- `src/lib/database/role-model.ts` (`skillProgressGrantStatements`) ever
-- disagree, so reading this is the same as reading what runs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY SKILL PROGRESS, AND WHY ONLY NOW
--
-- `00-overview.md` P-07: *"audit, attendance and progress are append-only and
-- queryable."* Phase 2.1 shipped `SkillProgress` append-only in module code
-- only; phase 2.2 built the database-level carve-out for `AttendanceEvent`
-- and flagged the asymmetry as an open item. Jack's decision round closed it:
-- the teaching log gets the same treatment.
--
-- WHY THE RETENTION ROLE GETS `UPDATE` HERE, WHICH ATTENDANCE WITHHOLDS.
-- `SkillProgress.assessedByPersonId` is severed (`SET NULL`) when its
-- recorder is erased. The FK's own referential action covers a `Person`
-- DELETE; an explicit application-level sever — the future R-25
-- `erasePersonData` — cannot run as the runtime role any more, so the
-- retention role carries the `UPDATE` it needs. `DELETE` is for the
-- retention path (`SKILL_PROGRESS` is `REVIEW` at 7 years). Attendance needs
-- neither: its expiry is a pure prune and its sever is FK-only.
--
-- WHY ERASURE OF A PUPIL STILL WORKS: `SkillProgress.studentProfileId` is
-- `ON DELETE CASCADE` from `StudentProfile`, and referential actions run with
-- the OWNER's privileges.
--
-- Run as the OWNER (a member of it may `SET ROLE splashtrack_owner` first).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The runtime role: append-only on the teaching log ───────────────────────

REVOKE ALL ON TABLE "SkillProgress" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "SkillProgress" TO "splashtrack_app";

-- ── The retention role: the only UPDATE (sever) and DELETE (retention) ──────

REVOKE ALL ON TABLE "SkillProgress" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "SkillProgress" TO "splashtrack_retention";
