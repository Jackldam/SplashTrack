import { prisma } from "@/lib/database";
import type { FeeRecurrence } from "@/generated/prisma/client";

export interface FeeTypeView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly amount: number;
  readonly currency: string;
  readonly recurrence: FeeRecurrence;
  readonly active: boolean;
}

const SELECT = {
  id: true,
  code: true,
  name: true,
  amount: true,
  currency: true,
  recurrence: true,
  active: true,
} as const;

/** The catalogue, alphabetical by name. Inactive types are included only on
 * request — the `Course`/`AwardType` `includeInactive` precedent. */
export async function listFeeTypes(
  options: { includeInactive?: boolean } = {},
): Promise<FeeTypeView[]> {
  return prisma.feeType.findMany({
    where: options.includeInactive ? {} : { active: true },
    select: SELECT,
    orderBy: { name: "asc" },
  });
}

export async function findFeeTypeById(
  feeTypeId: string,
): Promise<FeeTypeView | null> {
  return prisma.feeType.findUnique({
    where: { id: feeTypeId },
    select: SELECT,
  });
}
