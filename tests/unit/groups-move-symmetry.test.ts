/**
 * D-108's rule asserted as a property of the MODULE'S SHAPE, not only of its
 * behaviour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE-LEVEL TEST, AND WHY IT IS NOT PARANOIA
 *
 * *"Moving a child back down a level must be exactly as ordinary in the history
 * as moving up"* — the domain expert was explicit, and D-108 spends a paragraph
 * on why: without it a move down is indistinguishable from an administrative
 * error, and the screen rendering the child's history presents it as one to the
 * parent reading it.
 *
 * `groups-and-sessions.test.ts` proves the behaviour today. What no behavioural
 * test can catch is the change that breaks it, because it does not arrive as a
 * decision to treat `DOWN` differently. It arrives as a convenience helper
 * somebody adds six months from now — `promoteStudent`, because that is the
 * common case — and the moment one direction has a shortcut, the other one is
 * the exception. Then somebody adds a confirmation to it, then a permission,
 * then a red button.
 *
 * So this reads the module's own source and asserts the properties that make the
 * asymmetry unrepresentable:
 *
 *   - ONE exported move operation
 *   - ONE audit event type across all three directions
 *   - NO branch on the direction anywhere in the module
 *   - NO vocabulary that frames a direction as a failure
 *
 * A test that reads source is unusual and it is the right tool here: the thing
 * being protected is an absence, and an absence has no behaviour to exercise.
 * `route-guard-coverage.test.ts` does the same for the same reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertMoveIsCoherent,
  GROUP_MOVE_DIRECTIONS,
  type GroupMoveIntent,
} from "@/modules/groups";

const MODULE_DIR = path.resolve(process.cwd(), "src/modules/groups");

function sourceFiles(directory = MODULE_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...sourceFiles(absolute));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(absolute);
    }
  }
  return found;
}

/** Source with block comments stripped — the CODE, not what it says about itself. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the module has one move operation", () => {
  it("exports exactly one function that performs a move", () => {
    const barrel = readFileSync(path.join(MODULE_DIR, "index.ts"), "utf8");
    // `moveStudent` is it. Any sibling — promoteStudent, demoteStudent,
    // moveStudentDown — makes one direction the common path and the other the
    // exception, which is the whole of what D-108 refuses.
    expect(barrel).toContain("moveStudent");
    for (const forbidden of [
      "promoteStudent",
      "demoteStudent",
      "moveStudentUp",
      "moveStudentDown",
      "moveUp",
      "moveDown",
    ]) {
      expect(barrel, `${forbidden} must not exist`).not.toContain(forbidden);
    }
  });

  it("writes ONE audit event type for every direction", () => {
    // A `groups.membership.demoted` beside a `groups.membership.promoted` would
    // make a move down separately searchable, separately alertable and
    // separately explainable — an asymmetry in the accountability record rather
    // than in the code.
    //
    // The set is pinned rather than merely checked for absences, so that adding
    // a fourth membership event is a deliberate line in a diff. `.ended` is here
    // and is NOT a move: ending a placement has no target group and no
    // direction, which is why it is a different verb.
    const eventTypes = new Set<string>();
    for (const file of sourceFiles()) {
      for (const match of codeOf(file).matchAll(
        /eventType:\s*"(groups\.membership\.[a-z_]+)"/g,
      )) {
        eventTypes.add(match[1]);
      }
    }
    expect(eventTypes).toEqual(
      new Set([
        "groups.membership.placed",
        "groups.membership.moved",
        "groups.membership.ended",
      ]),
    );

    // And the property behind the pin: no event type's VERB names a direction.
    // The verb only — "groups" contains "up", which is the kind of thing that
    // makes a loose regex assert nothing while looking strict.
    for (const eventType of eventTypes) {
      const verb = eventType.split(".").pop()!;
      expect(verb).not.toMatch(/^(up|down|lateral|promot|demot)/i);
      expect(verb).not.toMatch(/(up|down|lateral|promoted|demoted)$/i);
    }
  });
});

describe("no code branches on the direction", () => {
  it("never compares `direction` against a specific value", () => {
    // The direction is written down and never read. A comparison anywhere in the
    // module is the first step toward one direction having its own rule — an
    // extra check, an extra permission, an extra confirmation.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = codeOf(file);
      // A comparison against a direction literal, in either order.
      if (
        /direction\s*[=!]==?\s*["']?(UP|DOWN|LATERAL)/.test(code) ||
        /["'](UP|DOWN|LATERAL)["']\s*[=!]==?\s*\w*[Dd]irection/.test(code) ||
        /case\s+["'](UP|DOWN|LATERAL)["']/.test(code)
      ) {
        offenders.push(path.relative(MODULE_DIR, file));
      }
    }
    expect(
      offenders,
      `${offenders.join(", ")} branches on a move direction. D-108 requires ` +
        "moving down to be exactly as ordinary as moving up, and a branch is " +
        "where that stops being true.",
    ).toEqual([]);
  });

  it("uses no vocabulary that frames a direction as a failure", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = codeOf(file);
      for (const word of [
        "demot", // demote, demotion
        "promot", // promote, promotion
        "downgrade",
        "relegat",
        "isCorrection",
        "correctionOf",
      ]) {
        if (new RegExp(word, "i").test(code)) {
          offenders.push(`${path.relative(MODULE_DIR, file)}:${word}`);
        }
      }
    }
    expect(
      offenders,
      `${offenders.join(", ")} — a move down is a teaching decision, not a ` +
        "demotion or a correction, and the identifiers are where that " +
        "framing gets fixed permanently (D-159 makes the names the record).",
    ).toEqual([]);
  });
});

describe("the domain rules are direction-blind", () => {
  function intent(
    direction: (typeof GROUP_MOVE_DIRECTIONS)[number],
    reason: string,
  ): GroupMoveIntent {
    return {
      studentProfileId: "sp_1",
      fromGroupId: "g_1",
      toGroupId: "g_2",
      direction,
      reason,
      occurredAt: new Date("2026-03-03T00:00:00Z"),
    };
  }

  it("accepts all three directions on identical terms", () => {
    for (const direction of GROUP_MOVE_DIRECTIONS) {
      expect(() =>
        assertMoveIsCoherent(intent(direction, "gewone lesbeslissing")),
      ).not.toThrow();
    }
  });

  it("refuses a blank reason for all three, identically", () => {
    for (const direction of GROUP_MOVE_DIRECTIONS) {
      expect(() => assertMoveIsCoherent(intent(direction, "   "))).toThrow(
        /reason/i,
      );
    }
  });

  it("declares exactly three directions, with DOWN among the ordinary ones", () => {
    expect([...GROUP_MOVE_DIRECTIONS]).toEqual(["UP", "DOWN", "LATERAL"]);
  });
});

describe("the Dutch copy does not colour one direction", () => {
  it("labels all three directions without a warning word", () => {
    const nl = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "messages/nl.json"), "utf8"),
    ) as { groups: { move: { directions: Record<string, string> } } };
    const labels = nl.groups.move.directions;

    expect(Object.keys(labels).sort()).toEqual(["DOWN", "LATERAL", "UP"]);
    for (const [direction, label] of Object.entries(labels)) {
      // No exclamation, no "let op", no "fout": the label is the name of a
      // teaching decision, and this is the surface a parent's question is
      // eventually answered from.
      expect(label, direction).not.toMatch(/let op|fout|waarschuw|!/i);
    }
  });
});
