/**
 * The `ScopeRelations` this module OWNS. Registered with the authorization
 * layer by `./registrations`, which is the module's single registration entry
 * point — this file only says WHAT the answers are.
 *
 * The authorization layer declares the live domain facts coverage needs and owns
 * none of them; each module supplies its own (D-145, D-057). Three of the
 * thirteen belong here, because this module owns the tables they read:
 *
 *   - `unitOfPerson`      → `Membership.unitId`
 *   - `homeUnitOfStudent` → `StudentProfile.unitId`
 *   - `personOfStudent`   → `StudentProfile.personId`
 *
 * The other ten stay on the throwing default until `groups`, `sessions` and
 * `courses` arrive — which is correct rather than incomplete: an unsupplied
 * relation DENIES loudly, and only the grants that depend on it.
 */
import type { ScopeRelations } from "@/lib/authorization";
import { prisma } from "@/lib/database";

export const peopleScopeRelations: Partial<ScopeRelations> = {
  /**
   * The unit a person's MEMBERSHIP sits in — the referent for `UNIT` coverage
   * of a bare `{ person }`.
   *
   * Null for a person with no membership, which DENIES. That is the documented
   * reading, not a gap: a child taking lessons has no membership (§5.1) and is
   * addressed as `{ student }` instead, which `UNIT` covers through their home
   * unit. `unitOfPerson`'s own doc comment in the authorization layer records
   * the same decision from the other side.
   */
  async unitOfPerson(personId: string): Promise<string | null> {
    const row = await prisma.membership.findUnique({
      where: { personId },
      select: { unitId: true },
    });
    return row?.unitId ?? null;
  },

  /**
   * The pupil's HOME unit, which governs their PROFILE whatever other units
   * they attend in (D-145's cross-unit rule): a child registered at Zuidbad
   * attending a summer course at Noordbad is not reachable as a profile by
   * Noordbad's Location Manager.
   *
   * Null when the profile does not exist, and equally when it exists with no
   * unit — v1 creates no `OrganizationUnit` rows, so an unassigned home unit is
   * the ordinary case today. Both DENY, which is the safe direction.
   */
  async homeUnitOfStudent(studentProfileId: string): Promise<string | null> {
    const row = await prisma.studentProfile.findUnique({
      where: { id: studentProfileId },
      select: { unitId: true },
    });
    return row?.unitId ?? null;
  },

  /**
   * The `Person` behind a `StudentProfile`, so `SELF` reach covers a student
   * reference to one's own record (D-146: `students.read` on one's own profile).
   */
  async personOfStudent(studentProfileId: string): Promise<string | null> {
    const row = await prisma.studentProfile.findUnique({
      where: { id: studentProfileId },
      select: { personId: true },
    });
    return row?.personId ?? null;
  },
};
