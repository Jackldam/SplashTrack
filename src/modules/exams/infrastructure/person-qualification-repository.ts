/**
 * Reads and writes over `PersonQualification` — *"een leraar die bevoegd is
 * binnen de vereniging"* (`15-…` §2.1).
 *
 * NOT append-only — see the model comment. `grant`/`end` are ordinary
 * mutations, the `MembershipPeriod` shape.
 *
 * SERVER-ONLY.
 */
import { prisma } from "@/lib/database";

/**
 * The closed vocabulary, mirrored from `prisma/schema.prisma`'s
 * `PersonQualificationType` enum as its own literal union — the
 * `ExamResultOutcomeValue`/`domain/exam-result.ts` precedent, kept separate
 * from the generated Prisma type so application code never imports
 * `@/generated/prisma` directly.
 */
export type PersonQualificationTypeValue =
  "INDEPENDENT_ASSESSOR" | "EXTERNAL_EXAMINER";

export interface PersonQualificationView {
  readonly id: string;
  readonly personId: string;
  readonly type: PersonQualificationTypeValue;
  readonly validFrom: Date;
  readonly validTo: Date | null;
  readonly grantedByPersonId: string | null;
  readonly createdAt: Date;
}

const SELECT = {
  id: true,
  personId: true,
  type: true,
  validFrom: true,
  validTo: true,
  grantedByPersonId: true,
  createdAt: true,
} as const;

/** Every qualification this person holds, current and lapsed alike. */
export async function findQualificationsForPerson(
  personId: string,
): Promise<PersonQualificationView[]> {
  return prisma.personQualification.findMany({
    where: { personId },
    orderBy: [{ validFrom: "desc" }],
    select: SELECT,
  });
}

/**
 * D-085's own check, resolved directly at the database rather than by
 * fetching every row and filtering in memory — the caller (the exam
 * candidate confirmation service) needs only the boolean.
 */
export async function hasValidQualification(
  personId: string,
  at: Date,
): Promise<boolean> {
  const row = await prisma.personQualification.findFirst({
    where: {
      personId,
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    select: { id: true },
  });
  return row !== null;
}

export async function findQualificationById(
  id: string,
): Promise<PersonQualificationView | null> {
  return prisma.personQualification.findUnique({
    where: { id },
    select: SELECT,
  });
}
