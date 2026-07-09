// Issue #59: 再接続・複数クライアントの E2E テスト。既存の E2E は単一の
// WebSocket 接続を張りっぱなしで検証しており、以下の観点が未検証だった:
//   - クライアントが切断→再接続したとき、再接続後のスナップショットに切断中の
//     変更が正しく反映されるか（古い状態のまま止まらないか）
//   - 複数クライアントが同時接続しているとき、一方の操作の差分がもう一方へも
//     正しく配信されるか
//   - 接続確立直後（snapshot 受信前）に送ったコマンドが取りこぼされないか
//
// 実 collector プロセス（+ 実 Docker スタック）に対して WebSocket 越しに検証する。
//
// Issue #202（UI-ERR・UI-MULTI シナリオの Playwright 実装）で、上記のうち
// 「再接続後のスナップショット整合性」「複数クライアントへの差分配信」の2件は
// UI-MULTI-01/02（`src/ui/multi-client.spec.ts`）へ移行し、このファイルからは
// 削除した（`packages/e2e/SCENARIOS.md` §1 棚卸し表の「移行」方針どおり）。
// 残る「接続シーケンスのタイミング異常系」（PROTO-ERR-04/05）は UI から
// タイミング制御ができない検証のため、引き続きここに残す。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { setupHarness, teardownHarness, type Harness } from "./helpers/harness.js";
import { CollectorTestClient, type CommandOutcome } from "./helpers/ws-client.js";

const PROJECT = "chainviz-ethereum";
const id = (service: string): string => `${PROJECT}/${service}`;

let harness: Harness;

beforeAll(async () => {
  harness = await setupHarness();
}, 300_000);

afterAll(async () => {
  if (!harness) return;
  await teardownHarness(harness);
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
