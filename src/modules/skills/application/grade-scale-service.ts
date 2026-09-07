/**
 * `GradeScale`/`GradeValue` — READ-ONLY in this phase's surface (D-160, OD-17
 * resolved). Seeded by `seedInstallation()`, never authored: see
 * `src/lib/boot/seed.ts` and the schema comment above `model GradeScale`.
 *
 * `{ organization: true }`, on the same reasoning `award-type-service.ts`
 * gives at length — there is no narrower `ResourceRef` kind for a catalogue
 * row.
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";

import {
  listGradeScales,
  type GradeScaleView,
} from "../infrastructure/catalogue-repository";

export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

export async function listGradeScalesForPrincipal(
  actor: ActorContext,
): Promise<GradeScaleView[]> {
  const at = actor.at ?? new Date();
  await requirePermission(
    actor.principal,
    "skills.read",
    { organization: true },
    { at },
  );
  return listGradeScales();
}
