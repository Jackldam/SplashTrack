import { describe, expect, it } from "vitest";

import {
  resolveLastRelationshipEnd,
  type RelationshipSource,
  type RelationshipStatus,
} from "@/lib/retention/last-relationship";

/**
 * D-066: "A guardian is held only while the child they are guardian of is
 * held — which follows automatically from the rule rather than needing a
 * special case."
 *
 * That is a claim about COMPOSABILITY, and it is what this file proves: a
 * "guardian of" source does not store or compute its own end date. It asks
 * for the CHILD's `resolveLastRelationshipEnd` and reports that verbatim. As
 * long as the child is held by anything, the guardian is held too, with no
 * special-cased guardian logic anywhere.
 *
 * There is no `PersonRelationship` table yet (`people` module, not built in
 * phase 0.4b — see `last-relationship.ts`'s doc comment), so this is proven
 * against a FAKE stand-in source rather than a real one. What is real and
 * under test is `resolveLastRelationshipEnd`'s aggregation rule itself, which
 * the eventual real "guardian of" source will plug into unchanged.
 */

function fakeSource(
  name: string,
  answers: Record<string, RelationshipStatus>,
): RelationshipSource {
  return {
    name,
    async resolve(personId) {
      return answers[personId];
    },
  };
}

/**
 * A stand-in "guardian of" source: for a guardian, asks the CHILD's own
 * last-relationship-end (over `childSources`) and reports that unchanged. This
 * is the composability the design describes — no guardian-specific end date is
 * ever stored.
 */
function guardianOfSource(
  guardianToChild: Record<string, string>,
  childSources: readonly RelationshipSource[],
): RelationshipSource {
  return {
    name: "fake-guardian-of (stand-in for the future PersonRelationship source)",
    async resolve(personId) {
      const childId = guardianToChild[personId];
      if (!childId) return undefined;
      return resolveLastRelationshipEnd(childId, childSources);
    },
  };
}

const GUARDIAN_ID = "guardian_1";
const CHILD_ID = "child_1";

describe("resolveLastRelationshipEnd — the aggregation rule (D-066)", () => {
  it("reports undefined when no source has ever held the person", async () => {
    await expect(
      resolveLastRelationshipEnd("nobody", [fakeSource("empty", {})]),
    ).resolves.toBeUndefined();
  });

  it("is held if ANY source is held, even if others have ended", async () => {
    const ended = fakeSource("ended", {
      p1: { held: false, endedAt: new Date("2024-01-01") },
    });
    const ongoing = fakeSource("ongoing", { p1: { held: true } });
    await expect(
      resolveLastRelationshipEnd("p1", [ended, ongoing]),
    ).resolves.toEqual({ held: true });
  });

  it("once every source has ended, reports the LATEST end — the LAST relationship, not the first", async () => {
    const earlier = fakeSource("earlier", {
      p1: { held: false, endedAt: new Date("2024-01-01") },
    });
    const later = fakeSource("later", {
      p1: { held: false, endedAt: new Date("2024-06-01") },
    });
    await expect(
      resolveLastRelationshipEnd("p1", [earlier, later]),
    ).resolves.toEqual({ held: false, endedAt: new Date("2024-06-01") });
  });

  it("ignores a source that has no record of the person at all", async () => {
    const irrelevant = fakeSource("irrelevant", {});
    const held = fakeSource("held", { p1: { held: true } });
    await expect(
      resolveLastRelationshipEnd("p1", [irrelevant, held]),
    ).resolves.toEqual({ held: true });
  });
});

describe("D-066: a guardian is held only while the child is held", () => {
  it("the guardian is HELD while the child's own relationship is ongoing", async () => {
    const childStillEnrolled = fakeSource("child-membership", {
      [CHILD_ID]: { held: true },
    });
    const guardianSource = guardianOfSource({ [GUARDIAN_ID]: CHILD_ID }, [
      childStillEnrolled,
    ]);

    await expect(
      resolveLastRelationshipEnd(GUARDIAN_ID, [guardianSource]),
    ).resolves.toEqual({ held: true });
  });

  it("the guardian's clock starts ONLY once the child's last relationship ends — same date, no special case", async () => {
    const childEnded = fakeSource("child-membership-ended", {
      [CHILD_ID]: { held: false, endedAt: new Date("2026-01-01") },
    });
    const guardianSource = guardianOfSource({ [GUARDIAN_ID]: CHILD_ID }, [
      childEnded,
    ]);

    await expect(
      resolveLastRelationshipEnd(GUARDIAN_ID, [guardianSource]),
    ).resolves.toEqual({ held: false, endedAt: new Date("2026-01-01") });
  });

  it("a guardian of TWO children is held until the LAST child's relationship ends", async () => {
    const CHILD_A = "child_a";
    const CHILD_B = "child_b";
    const childA = fakeSource("child-a", {
      [CHILD_A]: { held: false, endedAt: new Date("2024-01-01") },
    });
    const childB = fakeSource("child-b", {
      [CHILD_B]: { held: false, endedAt: new Date("2026-01-01") },
    });

    // Two independent "guardian of" facts, one per child, exactly as a real
    // PersonRelationship source would produce one row per relationship.
    const guardianOfA = guardianOfSource({ [GUARDIAN_ID]: CHILD_A }, [childA]);
    const guardianOfB = guardianOfSource({ [GUARDIAN_ID]: CHILD_B }, [childB]);

    await expect(
      resolveLastRelationshipEnd(GUARDIAN_ID, [guardianOfA, guardianOfB]),
    ).resolves.toEqual({ held: false, endedAt: new Date("2026-01-01") });
  });

  it("a guardian with no guardian-of relationship at all falls through to their OWN other sources", async () => {
    const notAGuardian = guardianOfSource({}, []);
    const ownMembership = fakeSource("own-membership", {
      [GUARDIAN_ID]: { held: true },
    });

    await expect(
      resolveLastRelationshipEnd(GUARDIAN_ID, [notAGuardian, ownMembership]),
    ).resolves.toEqual({ held: true });
  });
});
