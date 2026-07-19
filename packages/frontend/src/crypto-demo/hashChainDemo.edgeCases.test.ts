// hashChainDemo.ts の純粋ロジックの異常系・境界値・全ブロック一貫性の
// 補強テスト（Issue #401 テスト強化）。ハッピーパス中心の基本ケースは
// hashChainDemo.test.ts が扱う。ここは以下を重点的に検証する:
//   - 3ブロックすべて（先頭・中間・末尾）を編集した場合の遷移の一貫性
//   - 改ざん→元に戻す往復・同値編集の無害性（ハッシュは中身から決まる性質）
//   - 範囲外 index の防御的挙動
//   - relink の冪等性・複数同時編集
// （CLAUDE.md の1ファイル1責務。基本テストの肥大化を避けるため分割）。
import { describe, expect, it } from "vitest";
import {
  createInitialHashChainDemoState,
  deriveBlockHash,
  isBlockValid,
  isFullyRepaired,
  relinkBlock,
  resetHashChainDemoState,
  updateBlockData,
} from "./hashChainDemo.js";

const SEED = ["Alice → Bob: 5 ETH", "Bob → Carol: 2 ETH", "Carol → Alice: 1 ETH"];

describe("editing consistency across all three blocks", () => {
  // 編集したブロックの「直後の1ブロックだけ」が無効になる（末尾は子がなく無害）
  // という性質が、先頭・中間・末尾のいずれを編集しても一貫することを確認する。
  it.each([
    { edited: 0, expectInvalid: 1 },
    { edited: 1, expectInvalid: 2 },
  ])(
    "editing block[$edited] invalidates exactly block[$expectInvalid] and nothing else",
    ({ edited, expectInvalid }) => {
      const before = createInitialHashChainDemoState();
      expect(isFullyRepaired(before.blocks)).toBe(true);

      const after = updateBlockData(before, edited, "TAMPERED");
      after.blocks.forEach((_, index) => {
        expect(isBlockValid(after.blocks, index)).toBe(index !== expectInvalid);
      });
      expect(isFullyRepaired(after.blocks)).toBe(false);
    },
  );

  it("editing the middle block leaves the head untouched and repairs fully after one relink", () => {
    const before = createInitialHashChainDemoState();
    const after = updateBlockData(before, 1, "TAMPERED");
    expect(isBlockValid(after.blocks, 0)).toBe(true); // 先頭は無関係
    expect(isBlockValid(after.blocks, 1)).toBe(true); // 編集した本人は親と無関係なので有効のまま
    expect(isBlockValid(after.blocks, 2)).toBe(false); // 直後だけ無効

    const relinked = relinkBlock(after, 2);
    expect(isFullyRepaired(relinked.blocks)).toBe(true); // #3が末尾なので1回で完了
  });

  it("editing the last block (no child) invalidates nothing but does change its own hash", () => {
    const before = createInitialHashChainDemoState();
    const after = updateBlockData(before, 2, "TAMPERED");
    expect(isFullyRepaired(after.blocks)).toBe(true);
    expect(deriveBlockHash(after.blocks[2]!)).not.toBe(deriveBlockHash(before.blocks[2]!));
  });
});

describe("hash is a fingerprint of content: reversible / value-based, not history-based", () => {
  it("restoring the original data re-validates the child without any relink", () => {
    let state = createInitialHashChainDemoState();
    state = updateBlockData(state, 0, "TAMPERED");
    expect(isBlockValid(state.blocks, 1)).toBe(false);

    // relink せずに元の文字列へ戻すだけで有効に戻る（ハッシュは中身から決まり、
    // 「一度改ざんした履歴」を覚えているわけではない）。
    state = updateBlockData(state, 0, SEED[0]!);
    expect(isBlockValid(state.blocks, 1)).toBe(true);
    expect(isFullyRepaired(state.blocks)).toBe(true);
  });

  it("editing to the identical value is a harmless no-op for validity", () => {
    const before = createInitialHashChainDemoState();
    const after = updateBlockData(before, 0, SEED[0]!);
    expect(deriveBlockHash(after.blocks[0]!)).toBe(deriveBlockHash(before.blocks[0]!));
    expect(isFullyRepaired(after.blocks)).toBe(true);
  });

  it("two independent edits invalidate two children at once", () => {
    let state = createInitialHashChainDemoState();
    state = updateBlockData(state, 0, "TAMPERED-A");
    state = updateBlockData(state, 1, "TAMPERED-B");
    expect(isBlockValid(state.blocks, 0)).toBe(true);
    expect(isBlockValid(state.blocks, 1)).toBe(false); // 親(#1)のハッシュとずれた
    expect(isBlockValid(state.blocks, 2)).toBe(false); // #2のハッシュが変わってずれた
  });
});

describe("deriveBlockHash depends on every field", () => {
  it("changing number, storedParentHash, or data each produces a different hash", () => {
    const base = { number: 1, storedParentHash: "0xaa", data: "x" };
    const baseHash = deriveBlockHash(base);
    expect(deriveBlockHash({ ...base, number: 2 })).not.toBe(baseHash);
    expect(deriveBlockHash({ ...base, storedParentHash: "0xab" })).not.toBe(baseHash);
    expect(deriveBlockHash({ ...base, data: "y" })).not.toBe(baseHash);
  });
});

describe("relink idempotency and no-op semantics", () => {
  it("relinking an already-valid block does not change validity anywhere", () => {
    const state = createInitialHashChainDemoState();
    const relinked = relinkBlock(state, 2);
    expect(relinked.blocks[2]!.storedParentHash).toBe(state.blocks[2]!.storedParentHash);
    expect(isFullyRepaired(relinked.blocks)).toBe(true);
  });

  it("relinking twice is idempotent (second relink changes nothing)", () => {
    const tampered = updateBlockData(createInitialHashChainDemoState(), 0, "TAMPERED");
    const once = relinkBlock(tampered, 1);
    const twice = relinkBlock(once, 1);
    expect(twice.blocks[1]!.storedParentHash).toBe(once.blocks[1]!.storedParentHash);
    expect(isBlockValid(twice.blocks, 1)).toBe(true);
  });
});

describe("defensive handling of out-of-range indices", () => {
  it("isBlockValid returns true (never false) for negative, past-end, and empty inputs", () => {
    const { blocks } = createInitialHashChainDemoState();
    expect(isBlockValid(blocks, -1)).toBe(true);
    expect(isBlockValid(blocks, 3)).toBe(true);
    expect(isBlockValid(blocks, 99)).toBe(true);
    expect(isBlockValid([], 0)).toBe(true);
    expect(isBlockValid([], 5)).toBe(true);
  });

  it("isFullyRepaired is vacuously true for an empty block list", () => {
    expect(isFullyRepaired([])).toBe(true);
  });

  it("updateBlockData with an out-of-range index does not throw and changes nothing", () => {
    const before = createInitialHashChainDemoState();
    const after = updateBlockData(before, 99, "ignored");
    expect(after.blocks.map((b) => b.data)).toEqual(before.blocks.map((b) => b.data));
    expect(isFullyRepaired(after.blocks)).toBe(true);
  });

  it("relinkBlock with a past-end index returns the same state reference (no-op)", () => {
    const before = createInitialHashChainDemoState();
    expect(relinkBlock(before, 99)).toBe(before);
    expect(relinkBlock(before, -5)).toBe(before);
  });
});

describe("reset after a middle-block tamper restores the pristine state", () => {
  it("resets data and validity for every block", () => {
    let state = createInitialHashChainDemoState();
    state = updateBlockData(state, 1, "TAMPERED");
    state = relinkBlock(state, 2);
    // 前提: reset 前は改ざん内容が残り、pristine とは異なる状態になっている。
    expect(state.blocks[1]!.data).toBe("TAMPERED");
    expect(state).not.toEqual(createInitialHashChainDemoState());

    const reset = resetHashChainDemoState();
    expect(reset).toEqual(createInitialHashChainDemoState());
    expect(reset.blocks.map((b) => b.data)).toEqual(SEED);
    expect(isFullyRepaired(reset.blocks)).toBe(true);
  });
});
