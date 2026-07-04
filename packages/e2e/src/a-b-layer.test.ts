// Issue #52: A 層（インフラ）・B 層（P2P / ブロック伝播）の E2E テスト。
// 実 Docker スタック + 実 collector に対し、接続時スナップショットの内容、
// ビーコン間のピアエッジ、ブロック伝播タイミングの記録を検証する。

import type {
  BlockEntity,
  NodeEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";

const PROJECT = "chainviz-ethereum";
const id = (service: string): string => `${PROJECT}/${service}`;

let harness: Harness;

beforeAll(async () => {
  harness = await setupHarness();
}, 300_000);

afterAll(async () => {
  if (harness) await teardownHarness(harness);
});

/** 指定 stableId のノード/ワークベンチが観測に載るまで待って返す。 */
async function waitForInfra(
  service: string,
): Promise<NodeEntity | WorkbenchEntity> {
  return harness.client.waitForState(
    (client) =>
      client
        .getEntities()
        .find(
          (e): e is NodeEntity | WorkbenchEntity =>
            (e.kind === "node" || e.kind === "workbench") && e.id === id(service),
        ),
    {
      timeoutMs: 30_000,
      description: `infra entity ${id(service)} to appear`,
    },
  );
}

describe("A 層: 接続時スナップショット", () => {
  it("compose の 6 ノード + ワークベンチが正しい kind / clientType で載る", async () => {
    // A 層のポーリングは 3 秒間隔なので、初回反映を待ってから確認する。
    const cases: Array<{
      service: string;
      kind: "node" | "workbench";
      clientType?: string;
    }> = [
      { service: "reth1", kind: "node", clientType: "reth" },
      { service: "reth2", kind: "node", clientType: "reth" },
      { service: "beacon1", kind: "node", clientType: "lighthouse" },
      { service: "beacon2", kind: "node", clientType: "lighthouse" },
      { service: "validator1", kind: "node", clientType: "lighthouse" },
      { service: "validator2", kind: "node", clientType: "lighthouse" },
      { service: "workbench", kind: "workbench" },
    ];

    for (const expected of cases) {
      const entity = await waitForInfra(expected.service);
      expect(entity.kind, `${expected.service} kind`).toBe(expected.kind);
      if (expected.kind === "node") {
        expect(
          (entity as NodeEntity).clientType,
          `${expected.service} clientType`,
        ).toBe(expected.clientType);
      }
    }
  });
});

describe("B 層: ピア接続", () => {
  it("beacon1 と beacon2 のあいだに PeerEdge が張られる", async () => {
    const edge = await harness.client.waitForState(
      (client) =>
        client
          .getEdges()
          .find(
            (e) =>
              (e.fromNodeId === id("beacon1") && e.toNodeId === id("beacon2")) ||
              (e.fromNodeId === id("beacon2") && e.toNodeId === id("beacon1")),
          ),
      {
        timeoutMs: 60_000,
        description: "peer edge between beacon1 and beacon2",
      },
    );
    expect(edge.kind).toBe("peer");
  });
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
