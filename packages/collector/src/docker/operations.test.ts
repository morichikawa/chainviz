import { describe, expect, it } from "vitest";
import { ContainerNameConflictError } from "./operations.js";

describe("ContainerNameConflictError", () => {
  it("carries the conflicting container name and a descriptive message", () => {
    const err = new ContainerNameConflictError("chainviz-ethereum-workbench-1");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ContainerNameConflictError");
    expect(err.containerName).toBe("chainviz-ethereum-workbench-1");
    expect(err.message).toContain("chainviz-ethereum-workbench-1");
  });
});
