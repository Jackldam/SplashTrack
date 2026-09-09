/**
 * The reach-narrowed pupil picker read — who may this caller CHOOSE from,
 * by name (phase 2.2's guest picker; see `student-candidate-filter.ts` for
 * the scope story).
 *
 * IDENTITY BASICS ONLY, DELIBERATELY. D-145 rule 2 is a field-level rule, and
 * a picker needs exactly a name and the number an instructor cross-checks
 * against a card — never the profile's unit, notes, or anything the detail
 * screen guards separately. The select below is the whole contract.
 *
 * SERVER-ONLY.
 */
import { type Reach } from "@/lib/authorization";
import { prisma } from "@/lib/database";

import { studentCandidateFilterForReach } from "./student-candidate-filter";

/** One pickable pupil: the id a form submits, and the name a person reads. */
export interface StudentCandidate {
  readonly studentProfileId: string;
  readonly studentNumber: string;
  readonly givenName: string;
  readonly familyName: string;
}

/**
 * Thrown when a reach covers no pupil at all — a denial, never an empty list
 * (the `ReachCoversNoPersonError` reasoning, one entity over).
 */
export class ReachCoversNoStudentError extends Error {
  constructor() {
    super(
      "This reach covers no StudentProfile. Returning an empty list would " +
        "be indistinguishable from a club with no pupils; the caller " +
        "converts this into a denial (06-delivery.md §2.1, the list case).",
    );
    this.name = "ReachCoversNoStudentError";
  }
}

/** Hard ceiling on one answer — a picker, never an export. */
const CANDIDATE_LIMIT = 20;

/**
 * Pupils this reach covers whose name or number matches `query`, at most
 * {@link CANDIDATE_LIMIT}, in reading order.
 */
export async function findStudentCandidates(
  reach: Reach,
  at: Date,
  query: string | null,
): Promise<StudentCandidate[]> {
  const filter = studentCandidateFilterForReach(reach, at);
  if (filter.kind === "DENIED") throw new ReachCoversNoStudentError();

  const search = query?.trim();
  const searchWhere = search
    ? {
        OR: [
          {
            person: {
              is: {
                givenName: { contains: search, mode: "insensitive" as const },
              },
            },
          },
          {
            person: {
              is: {
                familyName: { contains: search, mode: "insensitive" as const },
              },
            },
          },
          { studentNumber: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const rows = await prisma.studentProfile.findMany({
    where: {
      AND: [filter.kind === "ALL" ? {} : filter.where, searchWhere],
    },
    orderBy: [
      { person: { familyName: "asc" } },
      { person: { givenName: "asc" } },
    ],
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      studentNumber: true,
      person: { select: { givenName: true, familyName: true } },
    },
  });

  return rows.map((row) => ({
    studentProfileId: row.id,
    studentNumber: row.studentNumber,
    givenName: row.person.givenName,
    familyName: row.person.familyName,
  }));
}
