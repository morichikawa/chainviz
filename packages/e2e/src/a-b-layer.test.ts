// Issue #52: B 層（ブロック伝播）の E2E テスト。実 Docker スタック + 実
// collector に対し、ブロック伝播タイミングの記録を検証する（PROTO-B-01）。
// A 層スナップショット・B 層ピア接続の検証は UI-A-01 / UI-B-01
// （packages/e2e/src/ui/infra-display.spec.ts /
// packages/e2e/src/ui/p2p-graph.spec.ts）へ移行済み（Issue #228）。

import type { BlockEntity } from "@chainviz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";

let harness: Harness;

beforeAll(async () => {
  harness = await setupHarness();
}, 300_000);

afterAll(async () => {
  if (harness) await teardownHarness(harness);
});

describe("B 層: ブロック伝播タイミング", () => {
  it("あるブロックの receivedAt に複数ノードの受信時刻が意味のある差で載る", async () => {
    // しばらく待ち、複数のビーコンノードで受信時刻が記録され、かつ 0 でない
    // 時間差を持つブロックが少なくとも 1 つ現れることを確認する。
    const block = await harness.client.waitForState(
      (client) => {
        const blocks = client
          .getEntities()
          .filter((e): e is BlockEntity => e.kind === "block");
        return blocks.find((b) => {
          const times = Object.values(b.receivedAt);
          if (times.length < 2) return false;
          const spread = Math.max(...times) - Math.min(...times);
          return spread > 0;
        });
      },
      {
        timeoutMs: 90_000,
        intervalMs: 1_000,
        description: "a block received by 2+ nodes with a non-zero time spread",
      },
    );

    const receivers = Object.keys(block.receivedAt);
    const times = Object.values(block.receivedAt);
    const spread = Math.max(...times) - Math.min(...times);

    expect(receivers.length).toBeGreaterThanOrEqual(2);
    expect(spread).toBeGreaterThan(0);
    // 実データの伝播差なので現実的な上限（数秒）に収まるはず。
    expect(spread).toBeLessThan(10_000);
  });
});
