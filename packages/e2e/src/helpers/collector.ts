// collector を子プロセスとして起動・停止するヘルパー。
//
// collector の main() は起動後にサーバーを止める手段を返さないため、E2E からは
// 同一プロセス内で import せず、ビルド済みの dist/index.js を子プロセスとして
// 起動し、テスト終了時に process.kill() で確実に後片付けする（親タスクの指示）。

import { type ChildProcess, spawn } from "node:child_process";
import { WebSocket } from "ws";
import { collectorEntry, repoRoot } from "./paths.js";
import { sleep, waitFor } from "./wait.js";

export interface RunningCollector {
  port: number;
  process: ChildProcess;
  /** 標準出力・標準エラーの蓄積（失敗時の調査用）。 */
  readLogs(): string;
  stop(): Promise<void>;
}

/** WebSocket ポートが接続を受け付けられるようになったかを確認する。 */
function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const done = (ok: boolean): void => {
      ws.removeAllListeners();
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    ws.once("open", () => done(true));
    ws.once("error", () => done(false));
  });
}

/**
 * collector を指定ポートで起動し、WebSocket が接続を受け付けるまで待つ。
 * ポートは CHAINVIZ_COLLECTOR_PORT で子プロセスへ渡す（既存の dev collector と
 * 衝突しないよう既定の 4000 とは別のポートを使う）。
 */
export async function startCollector(port = 4123): Promise<RunningCollector> {
  const child = spawn(process.execPath, [collectorEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CHAINVIZ_COLLECTOR_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  const running: RunningCollector = {
    port,
    process: child,
    readLogs: () => logs,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited || child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        // SIGTERM で落ちない場合に備えて猶予後に強制終了する。
        setTimeout(() => {
          if (!exited && child.exitCode === null) child.kill("SIGKILL");
        }, 5_000);
      }),
  };

  try {
    await waitFor(
      async () => {
        if (exited) {
          throw new Error(
            `collector exited early (code ${child.exitCode}). logs:\n${logs}`,
          );
        }
        return canConnect(port);
      },
      {
        timeoutMs: 30_000,
        intervalMs: 500,
        description: `collector to listen on port ${port}`,
      },
    );
  } catch (err) {
    await running.stop();
    throw err;
  }

  // 接続受付直後は初回ポーリングがまだのことがあるので、少しだけ待つ。
  await sleep(500);
  return running;
}
