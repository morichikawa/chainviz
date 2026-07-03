import { describe, expect, it } from "vitest";
import {
  applySnapshot,
  createChainvizClient,
  entitiesToFlowNodes,
  parseGlossaryYaml,
} from "./index.js";

describe("public barrel", () => {
  it("re-exports the core logic API", () => {
    expect(typeof applySnapshot).toBe("function");
    expect(typeof entitiesToFlowNodes).toBe("function");
    expect(typeof parseGlossaryYaml).toBe("function");
    expect(typeof createChainvizClient).toBe("function");
  });
});
