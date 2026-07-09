// Issue #53: 操作コマンド（addNode / removeNode）のプロトコル層 E2E テスト。
// 特に最重要なのは「addNode で追加した reth が実際に既存チェーンへ追従して
// ブロック高が進む」ことを実データで確認する点。これは #44 / #46（EL 間 P2P
// 無効でブロックに追従しない）のような、ユニットテストでは検出できなかった
// 実環境特有の回帰を捕まえるための検証である。
//
// Issue #200: addNode成功時のreth+beaconペア出現・addNodeで追加したノードの
// removeNode・addWorkbench/removeWorkbenchの基本ハッピーパスはUI層
// （packages/e2e/src/ui/commands-node.spec.ts /
// commands-workbench.spec.ts）へ移行し、ここでは削除した
// （SCENARIOS.md §1 棚卸し参照）。ブロック追従テスト（PROTO-CMD-01）は
// UI層では検証できない数値判定（RPCによるブロック高比較）のためここに残すが、
// 従来は前段の「addNode成功」テストが用意したreth/beaconに相乗りしていたのを、
// このテスト自身がaddNodeを送信するよう自己完結に再構成した。

import type { NodeEntity } from "@chainviz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitForBlockCatchUp } from "./helpers/catch-up.js";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";
import { ethBlockNumber, rethRpcUrl } from "./helpers/rpc.js";

// 追加した reth が既存チェーンへ追従するのを待つテストの上限時間。実際の
// 追従は waitForBlockCatchUp が動的タイムアウト＋進捗停止検出で判定するため、
// この値はそれより十分大きい安全網として設ける（稼働時間が延びて履歴が長く
// なっても、内部の動的タイムアウト側が先に分かりやすいエラーを出せるように）。
const CATCH_UP_TEST_TIMEOUT_MS = 600_000;

const PROJECT = "chainviz-ethereum";
const id = (service: string): string => `${PROJECT}/${service}`;

let harness: Harness;

/** ブロック追従テスト（addNode を自己完結で送信）が追加した reth の ID。
 * 途中失敗時の後始末（afterAll）にのみ使う。成功時はテスト内でクリアする。 */
let addedRethId: string | undefined;

beforeAll(async () => {
  harness = await setupHarness();
}, 300_000);

afterAll(async () => {
  if (!harness) return;
  // 追加したまま残っているものがあれば後片付けする（テストが途中で失敗した場合の保険）。
  if (addedRethId) {
    await harness.client
      .sendCommand({ action: "removeNode", nodeId: addedRethId })
      .catch(() => {});
  }
  await teardownHarness(harness);
});

/** 現在観測されている reth ノードの stableId 集合。 */
function currentRethIds(): Set<string> {
  return new Set(
    harness.client
      .getEntities()
      .filter((e): e is NodeEntity => e.kind === "node" && e.clientType === "reth")
      .map((e) => e.id),
  );
}

describe("addNode", () => {
  it("最重要: 追加した reth が既存チェーンにブロック追従する（0 のままにならない）", async () => {
    // このテストが検証したいのは「追加した reth がブロック追従するか」の
    // 数値判定（RPC比較）のみなので、reth+beaconペア出現自体の検証は
    // UI-CMD-01（packages/e2e/src/ui/commands-node.spec.ts）に委ね、ここでは
    // 自分自身で addNode を送信し追加 reth の IP を得るところから始める
    // （Issue #200: 移行前は前段の「addNode成功」テストが用意した
    // reth/beaconに相乗りしていた）。
    await harness.client.waitForState(
      (client) => {
        const ids = new Set(
          client
            .getEntities()
            .filter(
              (e): e is NodeEntity =>
                e.kind === "node" && e.clientType === "reth",
            )
            .map((e) => e.id),
        );
        return ids.has(id("reth1")) && ids.has(id("reth2"));
      },
      { timeoutMs: 30_000, description: "baseline reth1 and reth2 to be observed" },
    );
    const before = currentRethIds();

    const outcome = await harness.client.sendCommand({
      action: "addNode",
      chainProfile: "ethereum",
    });
    expect(outcome.ok, outcome.error).toBe(true);

    const newReth = await harness.client.waitForState(
      (client) =>
        client
          .getEntities()
          .find(
            (e): e is NodeEntity =>
              e.kind === "node" &&
              e.clientType === "reth" &&
              !before.has(e.id),
          ),
      { timeoutMs: 30_000, description: "a newly added reth node to appear" },
    );
    addedRethId = newReth.id;
    const newRethUrl = rethRpcUrl(newReth.ip);

    // 既存ノード（reth1）の現在のブロック高を基準にする。追加ノードがここまで
    // 追いつけば、履歴バックフィル + 追従が実際に機能していることになる。
    const reth1 = harness.client
      .getEntities()
      .find((e): e is NodeEntity => e.kind === "node" && e.id === id("reth1"));
    const reth1Ip = reth1?.ip ?? "172.28.1.1";
    const target = await ethBlockNumber(rethRpcUrl(reth1Ip));
    expect(target).toBeGreaterThan(0);

    // 追加した reth のブロック高が基準に追いつくまで待つ。これが #44 / #46 の
    // 回帰検出ポイント: EL 間 P2P（--bootnodes / --trusted-peers）を壊すと、
    // 十分に進んだチェーンへ後から参加したノードは CL からオプティミスティックに
    // head を渡され、履歴を EL ピアからバックフィルできないため進捗が止まり、
    // ここで停止検出により失敗する（reth-node.sh の該当フラグを外して実際に
    // 失敗することを確認済み）。なお、チェーンが genesis 直後でごく短い場合は CL が
    // 順番にブロックを渡すため EL P2P 無しでも追従してしまう。この検証が回帰を
    // 確実に捕まえるには、既に十分進んだチェーンに対して addNode する必要がある
    // （継続稼働するスタックを再利用する本ハーネスの通常運用ではこの条件を満たす）。
    //
    // 稼働中スタックを再利用する設計上、addNode 時点でチェーンがどれだけ進んで
    // いるか（＝バックフィルすべき履歴の長さ）は毎回変わる。固定タイムアウトだと
    // 長く進んだチェーンで間に合わないため、waitForBlockCatchUp が「開始時点の
    // 高さとターゲットの差分から動的にタイムアウトを算出」しつつ「進捗が完全に
    // 停止していない限り待ち続ける（停止したら早期失敗）」ことで安定させている。
    const caughtUp = await waitForBlockCatchUp(
      () => ethBlockNumber(newRethUrl),
      target,
      {
        intervalMs: 2_000,
        description: `added reth to reach block height ${target}`,
      },
    );

    expect(caughtUp).toBeGreaterThan(0);
    expect(caughtUp).toBeGreaterThanOrEqual(target);

    // 検証し終えたので後始末する（成功したのでこの後の afterAll での
    // 二重削除を避けるため addedRethId をクリアする）。
    const removeOutcome = await harness.client.sendCommand({
      action: "removeNode",
      nodeId: addedRethId,
    });
    expect(removeOutcome.ok, removeOutcome.error).toBe(true);
    addedRethId = undefined;
  }, CATCH_UP_TEST_TIMEOUT_MS);
});

describe("removeNode", () => {
  it("compose 起動の既存ノード（reth1）の削除は ok:false で拒否される", async () => {
    const outcome = await harness.client.sendCommand({
      action: "removeNode",
      nodeId: id("reth1"),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    // reth1 は依然として観測に残っている。
    expect(currentRethIds().has(id("reth1"))).toBe(true);
  });
});
