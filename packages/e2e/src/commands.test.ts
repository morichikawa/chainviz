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
import { waitForMinBlockProgress } from "./helpers/catch-up.js";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";
import { ethBlockNumber, rethRpcUrl } from "./helpers/rpc.js";

// 追加した reth が既存チェーンへ追従するのを待つテストの上限時間。実際の
// 追従は waitForMinBlockProgress が動的タイムアウト＋進捗停止検出で判定する
// ため、この値はそれより十分大きい安全網として設ける。
const CATCH_UP_TEST_TIMEOUT_MS = 600_000;

// PROTO-CMD-01 の合格条件（Issue #229）: 「既存ノードの head への完全追従」
// ではなく「開始高さから MIN_PROGRESS_BLOCKS 以上、停滞なく進行すること」に
// する。稼働中スタックを再利用するこのハーネスでは、テスト実行時点でチェーン
// がどれだけ進行しているか（＝バックフィルすべき履歴の長さ）が稼働時間に
// 比例して伸びる。head への完全追従を条件にすると、テストの所要時間もそれに
// 比例して伸び、固定の安全網（vitest の it タイムアウト等）と構造的に矛盾する
// （詳細は docs/worklog/issue-229.md の調査記録）。
//
// この値（300）が成立する前提:
//   - 想定バックフィル速度は保守的に 5 ブロック/秒（waitForMinBlockProgress
//     の既定 ratePerSec）。300 ブロックなら動的タイムアウトは
//     30_000ms（base）+ 300/5*1000 = 60_000ms → 下限 120_000ms（2分）に
//     収まり、CATCH_UP_TEST_TIMEOUT_MS（10分）を大きく下回る
//   - EL 間 P2P（履歴バックフィル）の回帰（#44/#46）が起きた場合、追加ノード
//     の高さはごく低い値のまま完全に停止するため、300 ブロックに到達するまで
//     待つまでもなく stall 検出（既定 45 秒）で先に失敗する。したがって
//     MIN_PROGRESS_BLOCKS の大小は回帰の検出力そのものには影響しない
//   - チェーンが head まで既に十分に育っている（head までの距離が
//     MIN_PROGRESS_BLOCKS 以上ある）ことは、下記の目標高さ算出
//     （resolveCatchUpTarget 相当。ここでは waitForMinBlockProgress 内部）に
//     より、育っていない場合は目標が head 到達にフォールバックするため必須
//     ではないが、その場合は下のコメントのとおりこの検証が本来捕まえたい
//     回帰を捕まえられない
const MIN_PROGRESS_BLOCKS = 300;

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

    // 既存ノード（reth1）の現在のブロック高を head の目安にする。
    const reth1 = harness.client
      .getEntities()
      .find((e): e is NodeEntity => e.kind === "node" && e.id === id("reth1"));
    const reth1Ip = reth1?.ip ?? "172.28.1.1";
    const headHeight = await ethBlockNumber(rethRpcUrl(reth1Ip));
    expect(headHeight).toBeGreaterThan(0);

    // 追加した reth のブロック高が「開始高さから MIN_PROGRESS_BLOCKS 以上、
    // 停滞なく進行する」まで待つ（Issue #229: head への完全追従を条件にすると
    // 稼働時間に比例してテスト時間が伸びるため、head 到達ではなく固定の進行量
    // を条件にした。MIN_PROGRESS_BLOCKS の前提はファイル冒頭のコメント参照）。
    //
    // これが #44 / #46 の回帰検出ポイントである点は変わらない: EL 間 P2P
    // （--bootnodes / --trusted-peers）を壊すと、十分に進んだチェーンへ後から
    // 参加したノードは CL からオプティミスティックに head を渡され、履歴を
    // EL ピアからバックフィルできないため進捗が止まり、目標がどこであっても
    // 停止検出（stall）により失敗する（reth-node.sh の該当フラグを外して実際に
    // 失敗することを確認済み）。なお、チェーンが genesis 直後でごく短い場合は
    // CL が順番にブロックを渡すため EL P2P 無しでも追従してしまう。この検証が
    // 回帰を確実に捕まえるには、既に十分進んだチェーンに対して addNode する
    // 必要がある（継続稼働するスタックを再利用する本ハーネスの通常運用では
    // この条件を満たす）。head までの距離が MIN_PROGRESS_BLOCKS 未満の場合は
    // waitForMinBlockProgress が目標を head 到達にフォールバックする
    // （resolveCatchUpTarget 参照）。
    const caughtUp = await waitForMinBlockProgress(
      () => ethBlockNumber(newRethUrl),
      {
        minProgressBlocks: MIN_PROGRESS_BLOCKS,
        headHeight,
        intervalMs: 2_000,
        description: `added reth to progress at least ${MIN_PROGRESS_BLOCKS} blocks`,
      },
    );

    expect(caughtUp).toBeGreaterThan(0);

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
