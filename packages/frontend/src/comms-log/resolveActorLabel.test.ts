import { describe, expect, it } from "vitest";
import { resolveActorLabel } from "./resolveActorLabel.js";
import { testNode, testWorkbench } from "./testFixtures.js";

describe("resolveActorLabel", () => {
  it("resolves a node to its containerName", () => {
    const entities = { "reth-1": testNode({ id: "reth-1", containerName: "chainviz-reth-1" }) };
    expect(resolveActorLabel(entities, "reth-1")).toBe("chainviz-reth-1");
  });

  it("resolves a workbench to its human label, not containerName", () => {
    const entities = {
      "wb-1": testWorkbench({ id: "wb-1", containerName: "chainviz-wb-1", label: "Alice" }),
    };
    expect(resolveActorLabel(entities, "wb-1")).toBe("Alice");
  });

  it("falls back to the raw id when the entity is unknown", () => {
    expect(resolveActorLabel({}, "ghost-id")).toBe("ghost-id");
  });
});
