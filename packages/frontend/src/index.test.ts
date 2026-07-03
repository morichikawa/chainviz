import { describe, expect, it } from "vitest";
import { describeSnapshot } from "./index.js";

describe("describeSnapshot", () => {
  it("summarizes a shared WorldStateSnapshot", () => {
    const summary = describeSnapshot({
      chainType: "ethereum",
      timestamp: 0,
      entities: [],
      edges: [],
    });
    expect(summary).toBe("ethereum: 0 entities");
  });
});
