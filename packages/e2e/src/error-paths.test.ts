// Issue #58: 操作コマンドとプロトコルの異常系 E2E テスト。既存の commands.test.ts
// がハッピーパス（正しいコマンドが成功し、実データに反映される）を検証するのに対し、
// こちらは「不正な入力に対して collector が正しく ok:false を返し、コンテナを一切
// 作らず、クラッシュもしない」ことを実 Docker + 実 collector で確認する。
//
// これらは CommandHandler / EthereumNodeLifecycle / WebSocket サーバーのユニット
// テストでも部分的に覆えるが、ここでは「実際に collector プロセスへ WebSocket 越しに
// 不正メッセージを流し込んでも接続が切れず、後続の正常なコマンドを処理し続ける」
// という、プロセス境界をまたいだ実挙動を検証する点に価値がある。

import type { WorkbenchEntity } from "@chainviz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countProjectContainers } from "./helpers/docker.js";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";

const PROJECT = "chainviz-ethereum";
const id = (service: string): string => `${PROJECT}/${service}`;

let harness: Harness;

/** テスト中に作成したワークベンチ ID（afterAll での後片付け用）。 */
const createdWorkbenchIds: string[] = [];

beforeAll(async () => {
  harness = await setupHarness();
}, 300_000);

afterAll(async () => {
  if (!harness) return;
  // 途中失敗に備え、作成したワークベンチが残っていれば削除する。
  for (const workbenchId of createdWorkbenchIds) {
    await harness.client
      .sendCommand({ action: "removeWorkbench", workbenchId })
      .catch(() => {});
  }
  await teardownHarness(harness);
});

describe("addNode の異常系", () => {
  it("未対応の chainProfile は ok:false で拒否され、コンテナを一切作らない", async () => {
    const before = await countProjectContainers();

    const outcome = await harness.client.sendCommand({
      action: "addNode",
      chainProfile: "bitcoin",
    });
    expect(outcome.ok).toBe(false);
    // 汎用メッセージにすり替えず、拒否理由（プロファイル名を含む）が伝わること。
    expect(outcome.error).toBeTruthy();
    expect(outcome.error).toMatch(/bitcoin/);

    // 拒否は起動前に行われるため、プロジェクトのコンテナ数は変化しない。
    // commandResult は CommandHandler が addNode の完了を await した後に
    // 返るため、ここで数え直せば起動処理は済んでおり、待機は不要。
    const after = await countProjectContainers();
    expect(after).toBe(before);
  });
});

describe("removeNode の異常系", () => {
  it("存在しない nodeId の削除は ok:false を返す", async () => {
    const outcome = await harness.client.sendCommand({
      action: "removeNode",
      nodeId: id("does-not-exist"),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
  });
});

describe("removeWorkbench の異常系", () => {
  it("存在しない workbenchId の削除は ok:false を返す", async () => {
    const outcome = await harness.client.sendCommand({
      action: "removeWorkbench",
      workbenchId: id("no-such-workbench"),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
  });
});

describe("addWorkbench のラベル重複", () => {
  // 実装（EthereumNodeLifecycle.uniqueWorkbenchService）は、同じラベルが既に
  // 管理下にある場合 -2, -3... を付けて一意化する。つまり重複ラベルは拒否では
  // なく「一意化されて成功」する。この実挙動に合わせて検証する。
  const label = "e2e-dup";
  const firstId = id(label);
  const secondId = id(`${label}-2`);

  it("同じラベルで 2 回追加すると、2 つ目は一意化された ID で成功する", async () => {
    const first = await harness.client.sendCommand({
      action: "addWorkbench",
      label,
    });
    expect(first.ok, first.error).toBe(true);
    createdWorkbenchIds.push(firstId);

    await harness.client.waitForState(
      (client) =>
        client
          .getEntities()
          .find(
            (e): e is WorkbenchEntity =>
              e.kind === "workbench" && e.id === firstId,
          ),
      { timeoutMs: 30_000, description: `workbench ${firstId} to appear` },
    );

    const second = await harness.client.sendCommand({
      action: "addWorkbench",
      label,
    });
    expect(second.ok, second.error).toBe(true);
    createdWorkbenchIds.push(secondId);

    // 2 つ目は元のラベルと衝突しないよう -2 が付いた別 ID で出現する。
    await harness.client.waitForState(
      (client) =>
        client
          .getEntities()
          .find(
            (e): e is WorkbenchEntity =>
              e.kind === "workbench" && e.id === secondId,
          ),
      { timeoutMs: 30_000, description: `workbench ${secondId} to appear` },
    );

    // 両方が別々の ID で共存していること。
    const ids = new Set(
      harness.client
        .getEntities()
        .filter((e) => e.kind === "workbench")
        .map((e) => (e as WorkbenchEntity).id),
    );
    expect(ids.has(firstId)).toBe(true);
    expect(ids.has(secondId)).toBe(true);
  });

  it("重複で作成した 2 つのワークベンチはどちらも削除できる", async () => {
    for (const workbenchId of [firstId, secondId]) {
      const outcome = await harness.client.sendCommand({
        action: "removeWorkbench",
        workbenchId,
      });
      expect(outcome.ok, outcome.error).toBe(true);
    }
    // afterAll での二重削除を避けるため、登録から外す。
    createdWorkbenchIds.length = 0;

    await harness.client.waitForState(
      (client) =>
        !client
          .getEntities()
          .some(
            (e) =>
              e.kind === "workbench" &&
              (e.id === firstId || e.id === secondId),
          ),
      {
        timeoutMs: 30_000,
        description: `workbenches ${firstId} / ${secondId} to disappear`,
      },
    );
  });
});

describe("不正な WebSocket メッセージ", () => {
  // collector は不正 JSON・type 欠落・未知の type を受け取っても返信せず、
  // 接続を切らず、プロセスも落とさない（websocket-server.ts onMessage の仕様）。
  // ここでは「不正メッセージを流し込んだ後も、同じ接続で正常なコマンドを処理
  // できる」ことを確認し、握りつぶしによる無反応化やクラッシュが無いことを示す。

  it("不正 JSON / type 欠落 / 未知 type を送っても接続が切れず、後続コマンドを処理できる", async () => {
    expect(harness.client.isOpen).toBe(true);

    // 1) パースできない不正 JSON。
    harness.client.sendRaw("this is not valid json {{{");
    // 2) JSON だが type フィールドが無い。
    harness.client.sendRaw(JSON.stringify({ commandId: "x", foo: "bar" }));
    // 3) JSON だが type が未知の値。
    harness.client.sendRaw(JSON.stringify({ type: "totally-unknown" }));
    // 4) type は command だが command 本体が空（action 欠落）。
    //    これは onMessage → CommandHandler の default 分岐に入り、
    //    commandResult(ok:false) が返る正当な経路。
    harness.client.sendRaw(
      JSON.stringify({ type: "command", commandId: "bad-cmd", command: {} }),
    );

    // 不正フレーム送信後も接続は開いたまま。
    expect(harness.client.isOpen).toBe(true);

    // 同じ接続で正常なコマンドを送り、commandResult が返ることを確認する。
    // （不正フレーム処理で無反応化・クラッシュしていれば、ここでタイムアウトする）
    const outcome = await harness.client.sendCommand({
      action: "removeNode",
      nodeId: id("still-alive-check"),
    });
    // 存在しないノードなので ok:false だが、返信が返ってくること自体が
    // 「サーバーが生きていて後続コマンドを処理できる」証拠になる。
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();

    // collector 子プロセスが落ちていないこと。
    expect(harness.collector.process.exitCode).toBeNull();
  });
});
