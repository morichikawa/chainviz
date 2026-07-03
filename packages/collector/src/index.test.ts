import { describe, expect, it } from "vitest";
import { createEmptySnapshot } from "./index.js";

describe("createEmptySnapshot", () => {
  it("builds a snapshot using the shared WorldStateSnapshot type", () => {
    const snapshot = createEmptySnapshot();
    expect(snapshot.chainType).toBe("ethereum");
    expect(snapshot.entities).toEqual([]);
  });
});
