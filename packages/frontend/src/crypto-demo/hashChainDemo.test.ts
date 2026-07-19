// hashChainDemo.ts の純粋ロジックのユニットテスト（Issue #401。UX設計
// docs/worklog/issue-401.md §8「テスト観点」）。View（React）は対象外
// （HashChainDemoView.*.test.tsx が扱う。CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  GENESIS_PARENT_HASH,
  createInitialHashChainDemoState,
  deriveBlockHash,
  isBlockValid,
  isFullyRepaired,
  relinkBlock,
  resetHashChainDemoState,
  updateBlockData,
} from "./hashChainDemo.js";

describe("createInitialHashChainDemoState", () => {
  it("creates 3 blocks numbered 1..3, all valid, chained via storedParentHash", () => {
    const state = createInitialHashChainDemoState();
    expect(state.blocks.map((b) => b.number)).toEqual([1, 2, 3]);
    expect(state.blocks[0]?.storedParentHash).toBe(GENESIS_PARENT_HASH);
    expect(state.blocks[1]?.storedParentHash).toBe(deriveBlockHash(state.blocks[0]!));
    expect(state.blocks[2]?.storedParentHash).toBe(deriveBlockHash(state.blocks[1]!));
    state.blocks.forEach((_, index) => {
      expect(isBlockValid(state.blocks, index)).toBe(true);
    });
    expect(isFullyRepaired(state.blocks)).toBe(true);
  });

  it("is reproducible: two independent calls yield equal (deep) initial states", () => {
    // 開き直したら常に同じ起点から始まる、という設計要件の裏付け。
    expect(createInitialHashChainDemoState()).toEqual(createInitialHashChainDemoState());
  });
});

describe("updateBlockData: editing invalidates only the immediate next block", () => {
  it("changes the edited block's own hash", () => {
    const before = createInitialHashChainDemoState();
    const beforeHash = deriveBlockHash(before.blocks[0]!);
    const after = updateBlockData(before, 0, "Alice → Bob: 500 ETH");
    const afterHash = deriveBlockHash(after.blocks[0]!);
    expect(afterHash).not.toBe(beforeHash);
  });

  it("invalidates only block[1] immediately, leaving block[2] still valid", () => {
    // 意図的に元の(改ざん前)状態で全ブロックが有効であることをまず確認し
    // (この後の「無効化」が本当にこの操作で起きたことだと確認できるように)、
    // 編集後に direct child だけが無効になることを確認する
    // (CLAUDE.md: 回帰テストは修正前後の両方を確認する、に準ずる)。
    const before = createInitialHashChainDemoState();
    expect(isFullyRepaired(before.blocks)).toBe(true);

    const after = updateBlockData(before, 0, "Alice → Bob: 500 ETH");
    expect(isBlockValid(after.blocks, 0)).toBe(true); // 先頭は常に有効
    expect(isBlockValid(after.blocks, 1)).toBe(false); // 直後だけ無効
    expect(isBlockValid(after.blocks, 2)).toBe(true); // その次はまだ有効のまま
    expect(isFullyRepaired(after.blocks)).toBe(false);
  });

  it("editing the last block (no child in this 3-block sandbox) invalidates nothing", () => {
    const before = createInitialHashChainDemoState();
    const after = updateBlockData(before, 2, "Carol → Alice: 999 ETH");
    expect(isFullyRepaired(after.blocks)).toBe(true);
    // ただし自身のハッシュは変わっている(黙って何も起きていないわけではない)。
    expect(deriveBlockHash(after.blocks[2]!)).not.toBe(deriveBlockHash(before.blocks[2]!));
  });

  it("does not mutate the input state (returns a new object)", () => {
    const before = createInitialHashChainDemoState();
    const originalData = before.blocks[0]!.data;
    updateBlockData(before, 0, "changed");
    expect(before.blocks[0]!.data).toBe(originalData);
  });
});

describe("relinkBlock: cascading repair, one step at a time", () => {
  it("repairs the relinked block but pushes invalidity one step further (the cascade)", () => {
    const tampered = updateBlockData(createInitialHashChainDemoState(), 0, "tampered");
    expect(isBlockValid(tampered.blocks, 1)).toBe(false);
    expect(isBlockValid(tampered.blocks, 2)).toBe(true);

    const relinked1 = relinkBlock(tampered, 1);
    expect(isBlockValid(relinked1.blocks, 1)).toBe(true); // 直したブロックは有効に戻る
    expect(isBlockValid(relinked1.blocks, 2)).toBe(false); // が、次はまだ無効(連鎖)
    expect(isFullyRepaired(relinked1.blocks)).toBe(false);

    const relinked2 = relinkBlock(relinked1, 2);
    expect(isBlockValid(relinked2.blocks, 2)).toBe(true);
    expect(isFullyRepaired(relinked2.blocks)).toBe(true); // 全部つなぎ直すと全部有効
  });

  it("is a no-op on the genesis block (index 0, no parent)", () => {
    const state = createInitialHashChainDemoState();
    const result = relinkBlock(state, 0);
    expect(result).toBe(state);
  });

  it("does not mutate the input state (returns a new object)", () => {
    const tampered = updateBlockData(createInitialHashChainDemoState(), 0, "tampered");
    const originalParentHash = tampered.blocks[1]!.storedParentHash;
    relinkBlock(tampered, 1);
    expect(tampered.blocks[1]!.storedParentHash).toBe(originalParentHash);
  });
});

describe("resetHashChainDemoState", () => {
  it("returns to a state equal to the pristine initial state after edits and relinks", () => {
    let state = createInitialHashChainDemoState();
    state = updateBlockData(state, 0, "tampered");
    state = relinkBlock(state, 1);
    expect(isFullyRepaired(state.blocks)).toBe(false);

    const reset = resetHashChainDemoState();
    expect(reset).toEqual(createInitialHashChainDemoState());
    expect(isFullyRepaired(reset.blocks)).toBe(true);
  });
});
