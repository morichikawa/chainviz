// Issue #59: 再接続・複数クライアントの E2E テスト。既存の E2E は単一の
// WebSocket 接続を張りっぱなしで検証しており、以下の観点が未検証だった:
//   - クライアントが切断→再接続したとき、再接続後のスナップショットに切断中の
//     変更が正しく反映されるか（古い状態のまま止まらないか）
//   - 複数クライアントが同時接続しているとき、一方の操作の差分がもう一方へも
//     正しく配信されるか
//   - 接続確立直後（snapshot 受信前）に送ったコマンドが取りこぼされないか
//
// 実 collector プロセス（+ 実 Docker スタック）に対して WebSocket 越しに検証する。

import type { NodeEntity } from "@chainviz/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";
import { CollectorTestClient, type CommandOutcome } from "./helpers/ws-client.js";

const PROJECT = "chainviz-ethereum";
const id = (service: string): string => `${PROJECT}/${service}`;

let harness: Harness;

/** テスト中に作成したワークベンチ ID（afterAll での後片付け用）。 */
const createdWorkbenchIds: string[] = [];
/** テスト中に addNode で作成した reth ノード ID（後片付け用）。 */
let addedRethId: string | undefined;

beforeAll(async () => {
  harness = await setupHarness();
}, 300_000);

afterAll(async () => {
  if (!harness) return;
  // 途中失敗に備え、作成したまま残っているものがあれば削除する。
  for (const workbenchId of createdWorkbenchIds) {
    await harness.client
      .sendCommand({ action: "removeWorkbench", workbenchId })
      .catch(() => {});
  }
  if (addedRethId) {
    await harness.client
      .sendCommand({ action: "removeNode", nodeId: addedRethId })
      .catch(() => {});
  }
  await teardownHarness(harness);
});

/** 指定クライアントが現在観測している reth ノードの ID 集合。 */
function rethIds(client: CollectorTestClient): Set<string> {
  return new Set(
    client
      .getEntities()
      .filter(
        (e): e is NodeEntity => e.kind === "node" && e.clientType === "reth",
      )
      .map((e) => e.id),
  );
}

describe("再接続時のスナップショット整合性", () => {
  // 再接続シナリオでは操作コマンドの種類は本質ではなく（差分/スナップショットの
  // 生成経路は共通）、ワークベンチ操作を使う。addNode/removeNode 固有の実データ
  // 追従は commands.test.ts 側で検証している。
  const label = "e2e-reconnect";
  const workbenchId = id(label);

  it("切断中に追加された変更が、再接続後の新しいスナップショットに反映される", async () => {
    const client = new CollectorTestClient(harness.collector.port);
    await client.connect();

    // 切断前のスナップショットには対象ワークベンチがまだ存在しない。
    expect(
      client
        .getEntities()
        .some((e) => e.kind === "workbench" && e.id === workbenchId),
    ).toBe(false);

    // クライアント A を切断する。
    client.close();

    // 切断している間に、別経路（共有クライアント）でワークベンチを追加する。
    const outcome = await harness.client.sendCommand({
      action: "addWorkbench",
      label,
    });
    expect(outcome.ok, outcome.error).toBe(true);
    createdWorkbenchIds.push(workbenchId);

    // collector 側の store に反映される（A 層ポーリング）まで、共有クライアントで待つ。
    await harness.client.waitForState(
      (c) =>
        c.getEntities().some((e) => e.kind === "workbench" && e.id === workbenchId),
      {
        timeoutMs: 30_000,
        description: `workbench ${workbenchId} to appear in the store`,
      },
    );

    // 同じクライアントインスタンスで再接続する。
    await client.connect();

    // 再接続後のスナップショットに、切断中に追加されたワークベンチが載っている
    // （＝古いスナップショットのまま止まっていない）こと。
    expect(
      client
        .getEntities()
        .some((e) => e.kind === "workbench" && e.id === workbenchId),
    ).toBe(true);

    client.close();
  });

  it("追加したワークベンチを削除でき、観測から消える", async () => {
    const outcome = await harness.client.sendCommand({
      action: "removeWorkbench",
      workbenchId,
    });
    expect(outcome.ok, outcome.error).toBe(true);
    // afterAll での二重削除を避けるため登録から外す。
    const idx = createdWorkbenchIds.indexOf(workbenchId);
    if (idx >= 0) createdWorkbenchIds.splice(idx, 1);

    await harness.client.waitForState(
      (c) =>
        !c.getEntities().some((e) => e.kind === "workbench" && e.id === workbenchId),
      {
        timeoutMs: 30_000,
        description: `workbench ${workbenchId} to disappear`,
      },
    );
  });
});

describe("複数クライアント同時接続時の差分配信", () => {
  it("一方が送った addNode / removeNode の差分が、もう一方のクライアントにも配信される", async () => {
    const clientA = new CollectorTestClient(harness.collector.port);
    const clientB = new CollectorTestClient(harness.collector.port);
    await clientA.connect();
    await clientB.connect();

    try {
      // ベースライン: compose 起動の reth1/reth2 が両クライアントに載るまで待つ。
      await clientA.waitForState(
        (c) => {
          const ids = rethIds(c);
          return ids.has(id("reth1")) && ids.has(id("reth2"));
        },
        { timeoutMs: 30_000, description: "baseline reth1/reth2 on client A" },
      );
      const before = rethIds(clientA);

      // クライアント A が addNode を送る。
      const add = await clientA.sendCommand({
        action: "addNode",
        chainProfile: "ethereum",
      });
      expect(add.ok, add.error).toBe(true);

      // A 層ポーリングの entityAdded 差分が A・B の両方に配信され、新しい reth が
      // 両クライアントに見えること。B にも見えることがブロードキャスト配信の検証。
      const findNew = (
        c: CollectorTestClient,
      ): NodeEntity | undefined =>
        c
          .getEntities()
          .find(
            (e): e is NodeEntity =>
              e.kind === "node" &&
              e.clientType === "reth" &&
              !before.has(e.id),
          );
      const newOnA = await clientA.waitForState(findNew, {
        timeoutMs: 30_000,
        description: "a newly added reth to appear on client A",
      });
      const newOnB = await clientB.waitForState(findNew, {
        timeoutMs: 30_000,
        description: "the same new reth to appear on client B via broadcast",
      });
      expect(newOnB.id).toBe(newOnA.id);

      addedRethId = newOnA.id;
      const index = addedRethId.split("/")[1].replace(/^reth/, "");
      const beaconId = id(`beacon${index}`);

      // クライアント B（追加を送ったのとは別のクライアント）が removeNode を送る。
      const remove = await clientB.sendCommand({
        action: "removeNode",
        nodeId: addedRethId,
      });
      expect(remove.ok, remove.error).toBe(true);

      // entityRemoved 差分が A・B 両方に配信され、reth と対の beacon が消えること。
      const gone = (c: CollectorTestClient): boolean => {
        const ids = new Set(
          c
            .getEntities()
            .filter((e) => e.kind === "node")
            .map((e) => (e as NodeEntity).id),
        );
        return !ids.has(addedRethId!) && !ids.has(beaconId);
      };
      await clientA.waitForState(gone, {
        timeoutMs: 30_000,
        description: "removed node to disappear on client A",
      });
      await clientB.waitForState(gone, {
        timeoutMs: 30_000,
        description: "removed node to disappear on client B via broadcast",
      });
      addedRethId = undefined;
    } finally {
      clientA.close();
      clientB.close();
    }
  }, 120_000);
});

describe("接続シーケンスのタイミング異常系", () => {
  it("接続確立直後（snapshot 受信を待たず）に送ったコマンドも取りこぼされず処理される", async () => {
    const { port } = harness.collector;
    const result = await new Promise<CommandOutcome>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timed out waiting for commandResult"));
      }, 15_000);
      ws.on("open", () => {
        // open 直後、サーバーからの snapshot を待たずに最初のフレームとして
        // コマンドを送る。collector が message ハンドラを接続時に同期的に
        // 張っていれば、この最初のフレームも取りこぼさず処理されるはず。
        ws.send(
          JSON.stringify({
            type: "command",
            commandId: "race-first-frame",
            command: { action: "removeNode", nodeId: id("no-such-node") },
          }),
        );
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as {
          type: string;
          commandId?: string;
          ok?: boolean;
          error?: string;
        };
        // 先に snapshot が届くが無視し、対応する commandResult だけを拾う。
        if (msg.type === "commandResult" && msg.commandId === "race-first-frame") {
          clearTimeout(timer);
          ws.close();
          resolve({ ok: msg.ok ?? false, error: msg.error });
        }
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // 存在しないノードなので ok:false になるが、返信が返ること自体が
    // 「接続直後のコマンドを取りこぼしていない」証拠になる。
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("未接続のクライアントへの sendCommand はサイレントに無視されず即座に拒否される", async () => {
    // connect() を呼んでいない（WebSocket が open していない）クライアント。
    const client = new CollectorTestClient(harness.collector.port);
    await expect(
      client.sendCommand({ action: "removeNode", nodeId: id("x") }),
    ).rejects.toThrow(/not open/);
  });
});
