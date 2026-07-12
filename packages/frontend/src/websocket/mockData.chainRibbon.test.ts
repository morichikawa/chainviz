import type { BlockEntity, DiffEvent } from "@chainviz/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFreshBlock } from "../entities/blockPulse.js";
import { deriveRibbonTiles } from "../entities/chainRibbon.js";
import { createMockClient, createMockSnapshot } from "./mockData.js";

afterEach(() => {
  vi.useRealTimers();
});

function blocksOf(snapshot: ReturnType<typeof createMockSnapshot>): BlockEntity[] {
  return snapshot.entities.filter(
    (e): e is BlockEntity => e.kind === "block",
  );
}

describe("createMockSnapshot chain ribbon blocks (Issue #298)", () => {
  it("includes 5 blocks chained by parentHash, ending at blockHeight 128", () => {
    const blocks = blocksOf(createMockSnapshot());
    expect(blocks).toHaveLength(5);
    const byNumber = new Map(blocks.map((b) => [b.number, b]));
    expect([...byNumber.keys()].sort((a, b) => a - b)).toEqual([124, 125, 126, 127, 128]);
    for (const b of blocks) {
      if (b.number === 124) continue;
      expect(b.parentHash).toBe(byNumber.get(b.number - 1)?.hash);
    }
  });

  it("is stale enough that it does not trigger the ribbon landing / pulse freshness guard", () => {
    const blocks = blocksOf(createMockSnapshot());
    const now = Date.now();
    for (const b of blocks) {
      expect(isFreshBlock(b, now)).toBe(false);
    }
  });

  it("produces a tile set via deriveRibbonTiles with the expected connectedToPrevious chain", () => {
    const tiles = deriveRibbonTiles(blocksOf(createMockSnapshot()));
    expect(tiles.map((t) => t.block.number)).toEqual([124, 125, 126, 127, 128]);
    expect(tiles[0].connectedToPrevious).toBe(false);
    expect(tiles.slice(1).every((t) => t.connectedToPrevious)).toBe(true);
  });
});

function entityAddedBlocks(diffs: DiffEvent[]): BlockEntity[] {
  return diffs
    .filter((d): d is Extract<DiffEvent, { type: "entityAdded" }> => d.type === "entityAdded")
    .map((d) => d.entity)
    .filter((e): e is BlockEntity => e.kind === "block");
}

/** ブロックハッシュ形式(`0x` + 8桁16進。blockHashFor と同じ書式)の
 * entityRemoved id だけを拾う。同じ tick で tx の recentTxHashes 溢れ分の
 * entityRemoved（64桁の tx hash）も流れるため、形式で絞り込む。 */
const BLOCK_HASH_PATTERN = /^0x[0-9a-f]{8}$/i;

function removedBlockIds(diffs: DiffEvent[]): string[] {
  return diffs
    .filter((d): d is Extract<DiffEvent, { type: "entityRemoved" }> => d.type === "entityRemoved")
    .map((d) => d.id)
    .filter((id) => BLOCK_HASH_PATTERN.test(id));
}

describe("createMockClient chain ribbon ticking (Issue #298)", () => {
  it("adds one new chained block per tick, continuing from blockHeight 128", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);

    const added = entityAddedBlocks(onDiff.mock.calls[0][0]);
    expect(added).toHaveLength(1);
    expect(added[0].number).toBe(129);
    expect(added[0].parentHash).toBe("0x00000080"); // initial block 128's hash
    client.disconnect();
  });

  it("chains consecutive ticks' blocks by parentHash", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    const firstTick = entityAddedBlocks(onDiff.mock.calls[0][0])[0];
    const secondTick = entityAddedBlocks(onDiff.mock.calls[1][0])[0];
    expect(secondTick.number).toBe(firstTick.number + 1);
    expect(secondTick.parentHash).toBe(firstTick.hash);
    client.disconnect();
  });

  it("follows up each new block with a receivedAt entityUpdated staggering CL before EL", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);

    const diffs = onDiff.mock.calls[0][0] as DiffEvent[];
    const added = entityAddedBlocks(diffs)[0];
    const update = diffs.find(
      (d): d is Extract<DiffEvent, { type: "entityUpdated" }> =>
        d.type === "entityUpdated" && d.id === added.hash,
    );
    expect(update).toBeTruthy();
    const receivedAt = (update?.patch as Partial<BlockEntity>).receivedAt ?? {};
    expect(receivedAt["lighthouse-1"]).toBeLessThan(receivedAt["reth-node-1"] ?? Infinity);
    expect(receivedAt["reth-node-1"]).toBeLessThan(receivedAt["reth-node-2"] ?? Infinity);
    client.disconnect();
  });

  it("evicts the oldest live block once MOCK_BLOCK_RETENTION is exceeded", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();

    // 初期スナップショットは5件（124-128）保持済み。MOCK_BLOCK_RETENTION(12)を
    // 超えるまで（8 tick 目で13件目 = 12件超過の1つ目の evict）進める。
    let sawRemoval = false;
    for (let i = 0; i < 8; i += 1) {
      vi.advanceTimersByTime(1000);
      const diffs = onDiff.mock.calls[i][0] as DiffEvent[];
      if (removedBlockIds(diffs).length > 0) sawRemoval = true;
    }
    expect(sawRemoval).toBe(true);
    client.disconnect();
  });

  it("evicts blocks oldest-number-first (FIFO by number, not by hash)", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();

    const removedInOrder: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(1000);
      const diffs = onDiff.mock.calls[i][0] as DiffEvent[];
      removedInOrder.push(...removedBlockIds(diffs));
    }
    // 最初に消えるのは初期スナップショットの最古(number 124, hash 0x0000007c)。
    expect(removedInOrder[0]).toBe("0x0000007c");
    client.disconnect();
  });
});
