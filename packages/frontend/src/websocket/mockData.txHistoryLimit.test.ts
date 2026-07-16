import type { WalletEntity } from "@chainviz/shared";
import { describe, expect, it, vi } from "vitest";
import { createMockClient, createMockSnapshot } from "./mockData.js";

/**
 * Issue #320: WalletPopover のスクロール対応をモックモード（オフライン）でも
 * 確認できるよう、Alice の `recentTxHashes` 保持上限を advanceTxLifecycle 内で
 * 6 → 20 件に引き上げた（`MOCK_ALICE_RECENT_TX_LIMIT`）。既存の
 * `createMockClient tx lifecycle` describe（mockData.test.ts）はこの上限自体を
 * 検証していなかったため、専用ファイルで回帰を固定する。
 */
function aliceAddress(): string {
  const snapshot = createMockSnapshot();
  const alice = snapshot.entities.find(
    (e): e is WalletEntity =>
      e.kind === "wallet" &&
      e.ownerWorkbenchId === "workbench-alice" &&
      !e.isSmartAccount,
  );
  if (!alice) throw new Error("no alice wallet in mock snapshot");
  return alice.address;
}

interface EntityUpdatedLike {
  type: string;
  id?: string;
  patch?: { recentTxHashes?: string[] };
}

/** 一連の diff 配列から、対象ウォレットの最新の recentTxHashes 更新を拾う。 */
function latestRecentTxHashes(
  diffs: EntityUpdatedLike[],
  address: string,
): string[] | undefined {
  for (let i = diffs.length - 1; i >= 0; i -= 1) {
    const d = diffs[i];
    if (d.type === "entityUpdated" && d.id === address && d.patch?.recentTxHashes) {
      return d.patch.recentTxHashes;
    }
  }
  return undefined;
}

function runTicks(onDiff: ReturnType<typeof vi.fn>, ticks: number): EntityUpdatedLike[] {
  for (let i = 0; i < ticks; i += 1) {
    vi.advanceTimersByTime(1000);
  }
  return onDiff.mock.calls.flatMap((call) => call[0] as EntityUpdatedLike[]);
}

describe("createMockClient Alice recentTxHashes retention (Issue #320)", () => {
  it("grows recentTxHashes beyond the old 6-entry cap", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    const address = aliceAddress();
    client.connect();

    // 10 tick後: 旧上限(6)のままなら常に6件で頭打ちのはずだが、新上限(20)では
    // まだ余裕があるため6件を超えて増え続ける。
    const diffs = runTicks(onDiff, 10);
    const recent = latestRecentTxHashes(diffs, address);
    expect(recent).toBeDefined();
    expect((recent as string[]).length).toBeGreaterThan(6);

    client.disconnect();
    vi.useRealTimers();
  });

  it("caps recentTxHashes at exactly 20 entries once the new limit is reached", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    const address = aliceAddress();
    client.connect();

    // 初期状態で1件(ALICE_TX1)保持済みのため、19 tick後に 1+19=20 件へ到達する。
    const diffs = runTicks(onDiff, 19);
    const recent = latestRecentTxHashes(diffs, address);
    expect(recent).toBeDefined();
    expect((recent as string[]).length).toBe(20);

    client.disconnect();
    vi.useRealTimers();
  });

  it("keeps recentTxHashes at 20 (not unbounded) and emits entityRemoved for evicted tx beyond the cap", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    const address = aliceAddress();
    client.connect();

    // 上限到達(19 tick)からさらに6 tick進め、はみ出た分が掃除されることを見る。
    const diffs = runTicks(onDiff, 25);
    const recent = latestRecentTxHashes(diffs, address);
    expect(recent).toBeDefined();
    expect((recent as string[]).length).toBe(20);

    const removedCount = diffs.filter((d) => d.type === "entityRemoved").length;
    expect(removedCount).toBeGreaterThan(0);

    client.disconnect();
    vi.useRealTimers();
  });
});
