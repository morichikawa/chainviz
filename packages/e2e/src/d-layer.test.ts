// Issue #191: D層（ノード内部）のプロトコル層 E2E テスト（SCENARIOS.md
// PROTO-D-01）。実 Docker スタック + 実 collector に対し、
// NodeEntity.drivesNodeId / NodeEntity.internals の反映と、駆動リンク上の
// 内部 API 呼び出し活動（nodeLinkActivity）の配信を検証する。
//
// UI 層（UI-D-*）はノードカード・内部リンクエッジの見た目を検証するのに対し、
// こちらはワールドステートのスキーマそのもの（フィールドの中身・イベントの
// 到達）を検証する。UI からは「反映されているかどうか」は見えても、
// フィールドの生の値までは検証できないため、この観点はプロトコル層に残す
// （docs/ARCHITECTURE.md §8.1）。

import type { NodeEntity } from "@chainviz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";

const PROJECT = "chainviz-ethereum";
const id = (service: string): string => `${PROJECT}/${service}`;

// profiles/ethereum の compose 定義（Issue #186 実装時点）では beacon1 が
// reth1 を、beacon2 が reth2 を Engine API で駆動する（EXECUTION_ENDPOINT が
// 対のノードを指す固定ペアリング）。ペアが変わる場合はこの対応も見直すこと。
const DRIVING_BEACON = "beacon1";
const DRIVEN_RETH = "reth1";

// D層のノード内部メトリクスは NODE_INTERNALS_POLL_INTERVAL_MS（既定 3000ms。
// packages/collector/src/adapters/ethereum/reth-metrics-tracker.ts）間隔で
// ポーリングされる。SLOT_DURATION_IN_SECONDS（profiles/ethereum/values.env、
// 現実の Ethereum に合わせ 12 秒）ごとに Engine API 呼び出し
// （newPayload/forkchoiceUpdated）が発生する。slot 時間がスクレイプ間隔より
// 長いため、Engine API 呼び出しの増分は毎スクレイプではなく slot ごとに
// （＝数回に1回のスクレイプで）増分として乗る。ここで待つのは「初回反映」で
// あり、待ち上限（60 秒）の中で必ず複数 slot 分が経過するため、この増分間隔
// でも初回観測は十分間に合う。値は他の A/D 層テストと同じ桁数（数十秒）に、
// ネットワーク・スクレイプの揺らぎ分の余裕を足したもの。
const INTERNALS_TIMEOUT_MS = 60_000;
const LINK_ACTIVITY_TIMEOUT_MS = 60_000;

let harness: Harness;

beforeAll(async () => {
  harness = await setupHarness();
}, 300_000);

afterAll(async () => {
  if (harness) await teardownHarness(harness);
});

/** 指定 stableId の NodeEntity を待って返す。 */
async function waitForNode(
  service: string,
  predicate: (node: NodeEntity) => boolean,
  opts: { timeoutMs: number; description: string },
): Promise<NodeEntity> {
  return harness.client.waitForState(
    (client) =>
      client
        .getEntities()
        .find(
          (e): e is NodeEntity =>
            e.kind === "node" && e.id === id(service) && predicate(e),
        ),
    opts,
  );
}

describe("D層: 駆動リンク（drivesNodeId）", () => {
  it("beacon1 の drivesNodeId が対の reth1 を指す", async () => {
    const beacon = await waitForNode(
      DRIVING_BEACON,
      (node) => node.drivesNodeId !== undefined,
      {
        timeoutMs: INTERNALS_TIMEOUT_MS,
        description: `${DRIVING_BEACON} to have drivesNodeId resolved`,
      },
    );
    expect(beacon.drivesNodeId).toBe(id(DRIVEN_RETH));
  });
});

describe("D層: ノード内部状態（internals）", () => {
  it("reth1 の internals に同期ステージと mempool 内訳が反映される", async () => {
    const reth = await waitForNode(
      DRIVEN_RETH,
      (node) => node.internals !== undefined,
      {
        timeoutMs: INTERNALS_TIMEOUT_MS,
        description: `${DRIVEN_RETH} to have internals observed`,
      },
    );

    expect(reth.internals).toBeDefined();
    // syncStages / mempool のどちらも reth が常時公開しているメトリクスに
    // 由来するため、稼働中のスタックでは両方観測できる想定（省略は「情報なし」
    // であって「稼働中は出ない」ではない。観測できなければここで検知する）。
    expect(reth.internals?.syncStages).toBeDefined();
    expect(reth.internals?.syncStages?.length).toBeGreaterThan(0);
    for (const stage of reth.internals?.syncStages ?? []) {
      expect(typeof stage.stage).toBe("string");
      expect(stage.stage.length).toBeGreaterThan(0);
      expect(typeof stage.checkpoint).toBe("number");
      expect(stage.checkpoint).toBeGreaterThanOrEqual(0);
    }

    expect(reth.internals?.mempool).toBeDefined();
    expect(reth.internals?.mempool?.pending).toBeGreaterThanOrEqual(0);
    expect(reth.internals?.mempool?.queued).toBeGreaterThanOrEqual(0);
  });
});

describe("D層: 内部リンク活動（nodeLinkActivity）", () => {
  it("beacon1 → reth1 の Engine API 呼び出し活動が観測される", async () => {
    const activity = await harness.client.waitForState(
      (client) =>
        client
          .getLinkActivities()
          .find(
            (a) =>
              a.fromNodeId === id(DRIVING_BEACON) &&
              a.toNodeId === id(DRIVEN_RETH) &&
              a.calls.length > 0,
          ),
      {
        timeoutMs: LINK_ACTIVITY_TIMEOUT_MS,
        description: `nodeLinkActivity from ${DRIVING_BEACON} to ${DRIVEN_RETH}`,
      },
    );

    expect(activity.calls.length).toBeGreaterThan(0);
    for (const call of activity.calls) {
      expect(typeof call.method).toBe("string");
      expect(call.method.length).toBeGreaterThan(0);
      // 増分ゼロの種類は含めない契約（NodeLinkActivity 定義）。
      expect(call.count).toBeGreaterThan(0);
    }
    expect(activity.observedAt).toBeGreaterThan(0);
  });
});
