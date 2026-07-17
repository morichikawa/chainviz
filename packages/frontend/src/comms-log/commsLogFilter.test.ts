import { describe, expect, it } from "vitest";
import {
  applyCommsLogFilter,
  defaultCommsLogFilterState,
  toggleCommsLogCategory,
} from "./commsLogFilter.js";
import type { CommsLogEntry } from "./commsLogEntry.js";

function entry(overrides: Partial<CommsLogEntry> & Pick<CommsLogEntry, "category">): CommsLogEntry {
  return {
    id: "id-1",
    timestamp: 1_000,
    actorIds: [],
    ...overrides,
  } as CommsLogEntry;
}

describe("defaultCommsLogFilterState", () => {
  it("enables every category and sets nodeId to null (all)", () => {
    const filters = defaultCommsLogFilterState();
    expect(filters.nodeId).toBeNull();
    expect(Object.values(filters.categories).every(Boolean)).toBe(true);
    expect(Object.keys(filters.categories).sort()).toEqual(
      ["block", "environment", "internal", "operation", "peer", "tx"].sort(),
    );
  });
});

describe("toggleCommsLogCategory", () => {
  it("flips only the targeted category, leaving the rest untouched", () => {
    const before = defaultCommsLogFilterState();
    const after = toggleCommsLogCategory(before, "internal");
    expect(after.categories.internal).toBe(false);
    expect(after.categories.operation).toBe(true);
    // 元のオブジェクトはイミュータブルに保つ
    expect(before.categories.internal).toBe(true);
  });

  it("toggling twice returns to the original value", () => {
    const state = toggleCommsLogCategory(toggleCommsLogCategory(defaultCommsLogFilterState(), "tx"), "tx");
    expect(state.categories.tx).toBe(true);
  });
});

describe("applyCommsLogFilter", () => {
  it("excludes entries whose category is toggled off", () => {
    const entries = [entry({ category: "operation" }), entry({ category: "block" })];
    const filters = toggleCommsLogCategory(defaultCommsLogFilterState(), "block");
    expect(applyCommsLogFilter(entries, filters)).toEqual([entries[0]]);
  });

  it("with nodeId set, keeps only entries whose actorIds include it", () => {
    const entries = [
      entry({ category: "peer", actorIds: ["reth-1", "reth-2"] }),
      entry({ category: "peer", actorIds: ["reth-3", "reth-4"] }),
    ];
    const filters = { ...defaultCommsLogFilterState(), nodeId: "reth-1" };
    expect(applyCommsLogFilter(entries, filters)).toEqual([entries[0]]);
  });

  it("with nodeId set, excludes entries with no actors at all (tx/collector events)", () => {
    const entries = [entry({ category: "tx", actorIds: [] })];
    const filters = { ...defaultCommsLogFilterState(), nodeId: "reth-1" };
    expect(applyCommsLogFilter(entries, filters)).toEqual([]);
  });

  it("with nodeId null (all), keeps entries regardless of actorIds", () => {
    const entries = [entry({ category: "tx", actorIds: [] })];
    expect(applyCommsLogFilter(entries, defaultCommsLogFilterState())).toEqual(entries);
  });
});
