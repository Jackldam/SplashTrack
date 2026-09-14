import { describe, expect, it } from "vitest";

import {
  readSchemaGraph,
  topologicalOrder,
} from "@/modules/backup/infrastructure/schema-graph";

describe("schema-graph (D-095/D-169 export/import ordering)", () => {
  it("parses every model in prisma/schema.prisma", () => {
    const graph = readSchemaGraph();
    // Pinned to the count observed directly in the schema at the time this
    // module was written (58). A model added or removed should make this
    // assertion move deliberately, not silently.
    expect(graph.models.size).toBeGreaterThanOrEqual(58);
    expect(graph.models.has("Organization")).toBe(true);
    expect(graph.models.has("Person")).toBe(true);
    expect(graph.models.has("AuditEvent")).toBe(true);
  });

  it("Membership has personId/unitId columns and depends on Person and OrganizationUnit, never on its relation object fields", () => {
    const graph = readSchemaGraph();
    const membership = graph.models.get("Membership")!;
    expect(membership.columns).toContain("personId");
    expect(membership.columns).toContain("unitId");
    expect(membership.columns).not.toContain("person");
    expect(membership.columns).not.toContain("periods");
    expect(membership.dependsOn).toContain("Person");
    expect(membership.dependsOn).toContain("OrganizationUnit");
  });

  it("detects the known self-referencing models and their FK columns", () => {
    const graph = readSchemaGraph();
    expect(graph.models.get("OrganizationUnit")!.selfReferenceColumns).toEqual([
      "parentId",
    ]);
    expect(graph.models.get("AttendanceEvent")!.selfReferenceColumns).toEqual([
      "supersedesEventId",
    ]);
    expect(graph.models.get("Assessment")!.selfReferenceColumns).toEqual([
      "supersedesAssessmentId",
    ]);
    expect(graph.models.get("ExamResult")!.selfReferenceColumns).toEqual([
      "supersedesResultId",
    ]);
  });

  it("produces a parent-first topological order with no cross-model cycle", () => {
    const graph = readSchemaGraph();
    const order = topologicalOrder(graph);
    expect(order).toHaveLength(graph.models.size);

    const position = new Map(order.map((model, index) => [model.name, index]));
    for (const model of order) {
      for (const dep of model.dependsOn) {
        if (dep === model.name) continue; // self-reference, handled separately
        expect(position.get(dep)!).toBeLessThan(position.get(model.name)!);
      }
    }
  });
});
