import { describe, expect, it } from "vitest";
import { HeadTipCache } from "./head-tip-cache.js";

describe("HeadTipCache", () => {
  it("returns undefined for a node that has never received a newHeads notification", () => {
    const cache = new HeadTipCache();
    expect(cache.resolve("chainviz-ethereum/reth1")).toBeUndefined();
  });

  it("records a single-key newHeads receipt (no matching beacon)", () => {
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock1");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xblock1");
  });

  it("records the same tip under every key of a receivedAtKeys pair (execution + aliased beacon, Issue #141)", () => {
    const cache = new HeadTipCache();
    cache.recordHead(
      ["chainviz-ethereum/beacon1", "chainviz-ethereum/reth1"],
      "0xblock1",
    );
    expect(cache.resolve("chainviz-ethereum/beacon1")).toBe("0xblock1");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xblock1");
  });

  it("overwrites the previous tip when a newer head arrives (reorg / normal progression)", () => {
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock1");
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock2");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xblock2");
  });

  it("keeps each node's tip independent", () => {
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock1");
    cache.recordHead(["chainviz-ethereum/reth2"], "0xblock9");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xblock1");
    expect(cache.resolve("chainviz-ethereum/reth2")).toBe("0xblock9");
  });

  it("removes entries not present in the current observed set on prune", () => {
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock1");
    cache.recordHead(["chainviz-ethereum/reth2"], "0xblock2");
    cache.prune(new Set(["chainviz-ethereum/reth2"]));
    expect(cache.resolve("chainviz-ethereum/reth1")).toBeUndefined();
    expect(cache.resolve("chainviz-ethereum/reth2")).toBe("0xblock2");
  });

  it("does not leak a stale tip across a removeNode -> addNode cycle with the same stableId", () => {
    // ノードが観測から消えて（prune）から再び現れた場合、前回の tip が
    // 残らず、次の newHeads 受信で改めて埋まることを固定する。
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xstale");
    cache.prune(new Set());
    expect(cache.resolve("chainviz-ethereum/reth1")).toBeUndefined();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xfresh");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xfresh");
  });

  it("is a no-op prune when the current set already contains every known node", () => {
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock1");
    cache.prune(new Set(["chainviz-ethereum/reth1", "chainviz-ethereum/reth2"]));
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xblock1");
  });
});
