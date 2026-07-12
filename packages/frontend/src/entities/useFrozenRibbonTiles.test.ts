import type { BlockEntity } from "@chainviz/shared";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChainRibbonTile } from "./chainRibbon.js";
import { useFrozenRibbonTiles } from "./useFrozenRibbonTiles.js";

afterEach(cleanup);

function tile(hash: string, number: number): ChainRibbonTile {
  const block: BlockEntity = {
    kind: "block",
    hash,
    number,
    parentHash: `0xparent${number}`,
    timestamp: 0,
    receivedAt: {},
  };
  return { block, connectedToPrevious: number > 0 };
}

describe("useFrozenRibbonTiles", () => {
  it("passes liveTiles through unchanged while not frozen", () => {
    const tilesA = [tile("0x1", 1)];
    const tilesB = [tile("0x1", 1), tile("0x2", 2)];
    const { result, rerender } = renderHook(
      ({ tiles, frozen }: { tiles: ChainRibbonTile[]; frozen: boolean }) =>
        useFrozenRibbonTiles(tiles, frozen),
      { initialProps: { tiles: tilesA, frozen: false } },
    );
    expect(result.current).toBe(tilesA);

    rerender({ tiles: tilesB, frozen: false });
    expect(result.current).toBe(tilesB);
  });

  it("keeps returning the snapshot taken at the moment freezing started, ignoring later liveTiles updates", () => {
    const initial = [tile("0x1", 1), tile("0x2", 2)];
    const { result, rerender } = renderHook(
      ({ tiles, frozen }: { tiles: ChainRibbonTile[]; frozen: boolean }) =>
        useFrozenRibbonTiles(tiles, frozen),
      { initialProps: { tiles: initial, frozen: false } },
    );

    // 凍結開始。この瞬間の initial がスナップショットになる。
    rerender({ tiles: initial, frozen: true });
    expect(result.current).toBe(initial);

    // 凍結中に窓が前進しても(最古が流出・新規が追加)、返る参照は変わらない。
    const advanced = [tile("0x2", 2), tile("0x3", 3)];
    rerender({ tiles: advanced, frozen: true });
    expect(result.current).toBe(initial);
    expect(result.current.map((t) => t.block.hash)).toEqual(["0x1", "0x2"]);
  });

  it("resumes following liveTiles once unfrozen", () => {
    const initial = [tile("0x1", 1)];
    const { result, rerender } = renderHook(
      ({ tiles, frozen }: { tiles: ChainRibbonTile[]; frozen: boolean }) =>
        useFrozenRibbonTiles(tiles, frozen),
      { initialProps: { tiles: initial, frozen: false } },
    );

    rerender({ tiles: initial, frozen: true });
    const advanced = [tile("0x2", 2)];
    rerender({ tiles: advanced, frozen: true });
    expect(result.current).toBe(initial); // まだ凍結中

    rerender({ tiles: advanced, frozen: false });
    expect(result.current).toBe(advanced); // 解除後は最新へ追従
  });

  it("captures a fresh snapshot on each new freeze cycle (unfreeze then re-freeze)", () => {
    const first = [tile("0x1", 1)];
    const { result, rerender } = renderHook(
      ({ tiles, frozen }: { tiles: ChainRibbonTile[]; frozen: boolean }) =>
        useFrozenRibbonTiles(tiles, frozen),
      { initialProps: { tiles: first, frozen: false } },
    );

    rerender({ tiles: first, frozen: true });
    rerender({ tiles: first, frozen: false }); // 一旦解除
    const second = [tile("0x2", 2)];
    rerender({ tiles: second, frozen: false });
    expect(result.current).toBe(second);

    rerender({ tiles: second, frozen: true }); // 再度凍結: この時点の second を捕捉
    const third = [tile("0x3", 3)];
    rerender({ tiles: third, frozen: true });
    expect(result.current).toBe(second);
  });

  it("does not throw when frozen starts true on first render", () => {
    const initial = [tile("0x1", 1)];
    const { result } = renderHook(
      ({ tiles, frozen }: { tiles: ChainRibbonTile[]; frozen: boolean }) =>
        useFrozenRibbonTiles(tiles, frozen),
      { initialProps: { tiles: initial, frozen: true } },
    );
    expect(result.current).toBe(initial);
  });
});
