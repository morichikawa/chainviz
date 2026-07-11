// collector を子プロセスとして起動・停止するヘルパー。
//
// collector の main() は起動後にサーバーを止める手段を返さないため、E2E からは
// 同一プロセス内で import せず、ビルド済みの dist/index.js を子プロセスとして
// 起動し、テスト終了時に process.kill() で確実に後片付けする（親タスクの指示）。

import { type ChildProcess, spawn } from "node:child_process";
import {
  crashedMessage,
  detectLaunchStatus,
  portInUseMessage,
} from "./collector-launch.js";
import { collectorEntry, repoRoot } from "./paths.js";
import { sleep } from "./wait.js";

export interface RunningCollector {
  port: number;
  /** ロギングプロキシの待ち受けポート（Issue #254）。 */
  proxyPort: number;
  process: ChildProcess;
  /** 標準出力・標準エラーの蓄積（失敗時の調査用）。 */
  readLogs(): string;
  stop(): Promise<void>;
}

/**
 * 子プロセス自身が WebSocket サーバー・ロギングプロキシの両方で listen し
 * 終えるまで待つ。
 *
 * WebSocket 接続を試みる方式（旧実装）だと、別プロセス（別 worktree の
 * test:e2e など）が同じポートで既に listen している場合に、自分の子プロセスが
 * EADDRINUSE で即死していても誤って「起動できた」と判定してしまう
 * （Issue #64）。そのため、必ず「自分が起動したこの子プロセスのログ」だけを
 * 根拠に判定する。
 *
 * collector は WebSocket サーバーとロギングプロキシという独立した 2 つの
 * listen を順番に行う（WS が先）。WS の listening ログだけを根拠にすると、
 * その直後にロギングプロキシ側が（ポート衝突などで）失敗しても検知できない
 * （Issue #254）。そのため両方の listening ログが揃うまで判定を確定させない。
 */
function waitForOwnProcessToListen(
  child: ChildProcess,
  port: number,
  proxyPort: number,
  getLogs: () => string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off("data", check);
      child.stderr?.off("data", check);
      child.off("close", check);
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const check = (): void => {
      const status = detectLaunchStatus({
        logs: getLogs(),
        port,
        proxyPort,
        exited: child.exitCode !== null || child.signalCode !== null,
        exitCode: child.exitCode,
      });
      switch (status.kind) {
        case "listening":
          settle(resolve);
          return;
        case "portInUse":
          settle(() =>
            reject(new Error(portInUseMessage(port, proxyPort, getLogs()))),
          );
          return;
        case "crashed":
          settle(() =>
            reject(new Error(crashedMessage(status.exitCode, getLogs()))),
          );
          return;
        case "pending":
          return;
      }
    };

    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for collector to log ` +
              `"listening on port ${port}" and "listening on port ` +
              `${proxyPort}". logs:\n${getLogs()}`,
          ),
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", check);
    child.stderr?.on("data", check);
    // "close" は stdio がすべて閉じてから発火するため、"exit" と違って
    // EADDRINUSE 等の stderr がログに反映済みであることを保証できる
    // （"exit" だと flush 前に発火してログ不完全のまま crashed 誤判定しうる）。
    child.on("close", check);
    // 呼び出し前に既にログ出力・終了が済んでいる可能性（イベントの取りこぼし）
    // に備えて、リスナー登録直後に一度だけ即座にも判定しておく。
    check();
  });
}

/**
 * collector を指定ポートで起動し、WebSocket・ロギングプロキシの両方が
 * 接続を受け付けるまで待つ。
 *
 * WebSocket ポートは CHAINVIZ_COLLECTOR_PORT で、ロギングプロキシのポートは
 * CHAINVIZ_PROXY_PORT で子プロセスへ渡す。どちらも既定の dev collector
 * （4000 / 4001）とは別のポートを使う。ロギングプロキシの既定値を
 * `port + 1` にしているのは、本番の既定値（WS:4000 / proxy:4001）と同じ
 * 「+1」の関係を踏襲したもので、既存の e2e 専用 WS ポート（4123 / 4125 /
 * 4199 等）どうしでも重複しない（Issue #254。従来は CHAINVIZ_PROXY_PORT を
 * 渡していなかったため、子プロセスは常に既定のロギングプロキシポート
 * （4001）を使おうとし、dev collector 稼働中はそこで衝突していた）。
 */
export async function startCollector(
  port = 4123,
  proxyPort = port + 1,
): Promise<RunningCollector> {
  const child = spawn(process.execPath, [collectorEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CHAINVIZ_COLLECTOR_PORT: String(port),
      CHAINVIZ_PROXY_PORT: String(proxyPort),
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
    proxyPort,
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
    await waitForOwnProcessToListen(child, port, proxyPort, () => logs, 30_000);
  } catch (err) {
    await running.stop();
    throw err;
  }

  // 接続受付直後は初回ポーリングがまだのことがあるので、少しだけ待つ。
  await sleep(500);
  return running;
}
