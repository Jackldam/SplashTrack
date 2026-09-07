/**
 * Moving a pupil between groups (D-108).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS TO HOLD: DOWN IS ORDINARY
 *
 * The domain expert was explicit — *progress in this domain is per individual*:
 * a faster child moves up mid-block, and a child who is struggling moves back
 * down. **Both are normal.** A model that only reads forward turns a normal
 * teaching event into a correction, and the screen that renders the child's
 * history then presents it as one to the parent reading it.
 *
 * So this module has ONE move operation. There is no `demote`, no
 * `moveDownWithApproval`, no extra permission on one direction and not the
 * other, no `isCorrection` flag, and no separate audit event type. `UP`, `DOWN`
 * and `LATERAL` are three values of one field that travel down the same code
 * path with the same mandatory reason — and `groups-move-symmetry.test.ts`
 * asserts exactly that, because the asymmetry this warns about is the kind that
 * arrives later, in a convenience helper somebody adds for the common case.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DIRECTION IS SUPPLIED AND NOT DERIVED
 *
 * D-108: *"Recording the direction explicitly, rather than deriving it from
 * level sequence, also keeps a lateral move — a different evening, the same
 * level — from being reported as a demotion."*
 *
 * Phase 1.6 noted a second reason: `Group` carried no `courseLevelId`, so there
 * was no sequence to compare. **That reason is gone as of phase 2.0** — the
 * column is real and `CourseLevel.sequence` is a number sitting right there —
 * and the rule is unchanged, which is why it is worth writing down. D-108's
 * argument was never about what was available; it is about what a derived
 * direction would SAY. A move to a different evening at the same level derives
 * as `LATERAL` only by luck, and two groups at one level whose sequences differ
 * would derive as a promotion nobody made.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE REASON IS MANDATORY
 *
 * D-108 accepts the cost in as many words: *"a required reason on an action
 * administrators would rather do in two clicks. Accepted: the reason is the
 * entire value of the record."* A parent reading *"moved from Group 4 to Group
 * 3"* with nothing attached draws the worst conclusion available; the same row
 * with *"meer tijd nodig voor de schoolslagbeenslag"* is a teaching decision.
 */

/** D-108's three directions. Equal in every way that this module treats them. */
export const GROUP_MOVE_DIRECTIONS = ["UP", "DOWN", "LATERAL"] as const;

export type GroupMoveDirectionValue = (typeof GROUP_MOVE_DIRECTIONS)[number];

/**
 * A move as the caller describes it, before any row exists.
 *
 * `fromGroupId` is null for a FIRST placement — the child was in no group and
 * now is. That is a real move worth recording rather than a non-event: it is
 * when they joined a group, and the history reads wrong without it.
 */
export interface GroupMoveIntent {
  readonly studentProfileId: string;
  readonly fromGroupId: string | null;
  readonly toGroupId: string;
  readonly direction: GroupMoveDirectionValue;
  readonly reason: string;
  readonly occurredAt: Date;
}

export class GroupMoveError extends Error {
  constructor(
    public readonly reason: "sameGroup" | "reasonRequired" | "notInSourceGroup",
    message: string,
  ) {
    super(message);
    this.name = "GroupMoveError";
  }
}

/**
 * The refusals that are the same whichever way the child is moving.
 *
 * Note what is NOT here: nothing checks the direction. A `DOWN` passes exactly
 * the tests an `UP` does, which is the point — see the file comment.
 */
export function assertMoveIsCoherent(intent: GroupMoveIntent): void {
  if (intent.fromGroupId !== null && intent.fromGroupId === intent.toGroupId) {
    throw new GroupMoveError(
      "sameGroup",
      "A move from a group to itself is not a move. It would render in the " +
        "pupil's history as an event saying something happened when nothing " +
        "did.",
    );
  }
  if (intent.reason.trim().length === 0) {
    throw new GroupMoveError(
      "reasonRequired",
      "A group move needs a reason. It is the entire value of the record " +
        "(D-108): without it, a move is indistinguishable from an " +
        "administrative error to whoever reads the pupil's history next.",
    );
  }
}
