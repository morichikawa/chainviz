import { describe, expect, it } from "vitest";
import { clientCategory } from "./clientCategory.js";

describe("clientCategory", () => {
  it("classifies reth and geth as execution", () => {
    expect(clientCategory("reth")).toBe("execution");
    expect(clientCategory("geth")).toBe("execution");
  });

  it("classifies lighthouse and prysm as consensus", () => {
    expect(clientCategory("lighthouse")).toBe("consensus");
    expect(clientCategory("prysm")).toBe("consensus");
  });

  it("is case-insensitive", () => {
    expect(clientCategory("Reth")).toBe("execution");
    expect(clientCategory("LIGHTHOUSE")).toBe("consensus");
  });

  it("matches on substring (e.g. version-qualified client strings)", () => {
    expect(clientCategory("reth-node v1.1.0")).toBe("execution");
    expect(clientCategory("lighthouse bn")).toBe("consensus");
  });

  it("returns other for unknown client types", () => {
    expect(clientCategory("foundry")).toBe("other");
    expect(clientCategory("")).toBe("other");
  });
});
