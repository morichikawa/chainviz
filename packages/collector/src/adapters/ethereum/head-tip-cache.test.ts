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

  it("drops every stale entry in a single prune (guards against Map growth)", () => {
    // 対象外になった複数ノードを 1 回の prune で全て破棄し、Map に亡霊が
    // 溜まらないことを固定する（`pollInfra` の毎サイクル呼び出しでの
    // Map 肥大化防止）。
    const cache = new HeadTipCache();
    for (let i = 1; i <= 5; i++) {
      cache.recordHead([`chainviz-ethereum/reth${i}`], `0xblock${i}`);
    }
    // reth3 だけが現在の観測対象。残り 4 件は破棄される。
    cache.prune(new Set(["chainviz-ethereum/reth3"]));
    for (let i = 1; i <= 5; i++) {
      const id = `chainviz-ethereum/reth${i}`;
      if (i === 3) expect(cache.resolve(id)).toBe("0xblock3");
      else expect(cache.resolve(id)).toBeUndefined();
    }
  });

  it("prune with an empty current set clears the whole cache", () => {
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock1");
    cache.recordHead(["chainviz-ethereum/reth2"], "0xblock2");
    cache.prune(new Set());
    expect(cache.resolve("chainviz-ethereum/reth1")).toBeUndefined();
    expect(cache.resolve("chainviz-ethereum/reth2")).toBeUndefined();
  });

  it("recordHead with an empty key list is a no-op (no target keys resolved)", () => {
    // executionTargets が receivedAtKeys を空で渡す構成上のケースは無いが、
    // 空配列を渡しても既存エントリを壊さず、新規エントリも作らないことを
    // 防御的に固定する。
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xkeep");
    cache.recordHead([], "0xignored");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xkeep");
  });

  it("keeps two beacon/execution pairs from cross-contaminating each other", () => {
    // reth1/beacon1 と reth2/beacon2 の 2 群を別々の tip で記録したとき、
    // beacon エイリアスが取り違えられず各群に閉じることを固定する
    // （receivedAtKeys のノード群キー分離の取り違え防止）。
    const cache = new HeadTipCache();
    cache.recordHead(
      ["chainviz-ethereum/beacon1", "chainviz-ethereum/reth1"],
      "0xgroup1",
    );
    cache.recordHead(
      ["chainviz-ethereum/beacon2", "chainviz-ethereum/reth2"],
      "0xgroup2",
    );
    expect(cache.resolve("chainviz-ethereum/beacon1")).toBe("0xgroup1");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xgroup1");
    expect(cache.resolve("chainviz-ethereum/beacon2")).toBe("0xgroup2");
    expect(cache.resolve("chainviz-ethereum/reth2")).toBe("0xgroup2");
  });

  it("is last-write-wins regardless of block ordering (reorg to a lower head is intended)", () => {
    // 設計上、キャッシュはブロック番号を比較せず「最後に受信した newHeads =
    // 現在の正準ヘッド」をそのまま採用する（head-tip-cache.ts / worklog
    // issue-296 の設計メモ）。reorg ではヘッドがより低い番号のブロックへ
    // 差し替わることがあり、番号ガードを入れるとその追従を壊すため、
    // 「後から来た方が勝つ」ことを意図された契約として固定する。
    // これはバグではなく設計判断であることに注意。
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xhigh");
    cache.recordHead(["chainviz-ethereum/reth1"], "0xlow-after-reorg");
    expect(cache.resolve("chainviz-ethereum/reth1")).toBe("0xlow-after-reorg");
  });

  it("reset (Issue #357) forgets every node's tip", () => {
    const cache = new HeadTipCache();
    cache.recordHead(["chainviz-ethereum/reth1"], "0xblock1");
    cache.recordHead(["chainviz-ethereum/reth2"], "0xblock2");

    cache.reset();

    expect(cache.resolve("chainviz-ethereum/reth1")).toBeUndefined();
    expect(cache.resolve("chainviz-ethereum/reth2")).toBeUndefined();
  });
});
