-- D-005/D-085/D-087 — the assessment exception, as SQL (phase 2.3).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- YOU ALMOST CERTAINLY DO NOT NEED TO RUN THIS.
--
-- `splashtrack db:apply-grants` applies exactly these statements, after every
-- migration, beside the audit, attendance and skill-progress exceptions. The
-- whole model — ownership first, why REVOKE ALL, what this defends against
-- and what it does not — is explained once, in `infra/audit-database-role.sql`;
-- read that first.
--
-- `tests/unit/assessment-grant-sql-sync.test.ts` fails if this file and
-- `src/lib/database/role-model.ts` (`assessmentGrantStatements`) ever
-- disagree, so reading this is the same as reading what runs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY ASSESSMENT, AND WHY FROM THE START RATHER THAN RETROFITTED
--
-- `00-overview.md` P-07: *"audit, attendance and progress are append-only and
-- queryable."* `Assessment` is the most evidential record this schema has
-- written yet — the basis on which a child was or was not admitted to an
-- exam (D-085) — and CLAUDE.md names append-only history as one of the five
-- rules that is retrofit-hostile. Phase 2.1 shipped `SkillProgress`
-- append-only in code only and had to retrofit the database-level carve-out
-- a phase later; this module does not repeat that.
--
-- WHY THE RETENTION ROLE GETS `UPDATE` HERE, ON THE SKILL-PROGRESS PRECEDENT.
-- `Assessment.assessorPersonId` and `CriterionWaiver.grantedByPersonId` are
-- severed (`SET NULL`) when the person who assessed or granted a waiver is
-- erased. The FK's own referential action covers a `Person` DELETE; an
-- explicit application-level sever — the future R-25 `erasePersonData` —
-- cannot run as the runtime role any more, so the retention role carries the
-- `UPDATE` it needs. `DELETE` is provisioned for a future retention prune
-- (`ASSESSMENT_REMARKS` at 12 months, `ASSESSMENT_RESULTS` at 7 years — v1
-- ships no automated job for either, D-120, but the capability is granted
-- ahead of it rather than after, the same ordering CLAUDE.md rule 1 states
-- for the encryption envelope).
--
-- WHY ERASURE OF A PUPIL STILL WORKS: `Assessment.studentProfileId` is
-- `ON DELETE CASCADE` from `StudentProfile`, and `AssessmentCriterionResult`/
-- `CriterionWaiver` cascade from `Assessment` in turn — all three run with
-- the OWNER's privileges, the exact `SkillProgress`/`AttendanceEvent`
-- reasoning.
--
-- Run as the OWNER (a member of it may `SET ROLE splashtrack_owner` first).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The runtime role: append-only on the aftest record ──────────────────────

REVOKE ALL ON TABLE "Assessment" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "Assessment" TO "splashtrack_app";

-- ── The retention role: the only UPDATE (sever) and DELETE (retention) ──────

REVOKE ALL ON TABLE "Assessment" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "Assessment" TO "splashtrack_retention";

-- ── The runtime role: append-only on the graded criterion results ───────────

REVOKE ALL ON TABLE "AssessmentCriterionResult" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "AssessmentCriterionResult" TO "splashtrack_app";

-- ── The retention role: the only UPDATE (sever) and DELETE (retention) ──────

REVOKE ALL ON TABLE "AssessmentCriterionResult" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "AssessmentCriterionResult" TO "splashtrack_retention";

-- ── The runtime role: append-only on waivers ─────────────────────────────────

REVOKE ALL ON TABLE "CriterionWaiver" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "CriterionWaiver" TO "splashtrack_app";

-- ── The retention role: the only UPDATE (sever) and DELETE (retention) ──────

REVOKE ALL ON TABLE "CriterionWaiver" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "CriterionWaiver" TO "splashtrack_retention";
