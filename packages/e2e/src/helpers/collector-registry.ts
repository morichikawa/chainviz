// UI 層 E2E（Playwright）が「現在動いている collector」の所在（PID/ポート）を
// プロセスをまたいで共有するための小さな受け渡し機構。
//
// Playwright の globalSetup/globalTeardown は「メインプロセス」で実行され、
// 実際にテストを走らせる「ワーカープロセス」とは別の OS プロセスになる
// （`playwright.config.ts` の `workers: 1` でも同様。globalSetup はテスト
// 実行そのものとは別プロセスで一度だけ動く）。そのため、globalSetup が
// メモリ上に保持する `RunningCollector` の参照は、ワーカープロセス側の
// テストコード（`ui/connection-errors.spec.ts`）からは触れない。
// connection-errors.spec.ts は UI-ERR-01/02 の検証のため実際に collector
// プロセスを停止・再起動する必要があり、globalTeardown は「その時点で最後に
// 生きている collector プロセス」を確実に後始末できなければならない
// （さもないと、テストが再起動した子プロセスを誰も止められず、孤児プロセス
// としてポートを掴んだまま残ってしまう）。
//
// この2つの要求を満たすため、プロセス間で共有できるファイル（os.tmpdir()
// 配下の固定パス。`e2e-lock.ts` の排他ロックファイルと同じ考え方。UI層E2Eは
// `acquireE2eLock()` により同時に1本しか走らない前提のため、固定パスで
// 衝突しない）へ「現在の collector の PID/ポート」を書き込み、各プロセスは
// このファイル経由で最新の状態を読み書きする（docs/worklog/issue-202.md
// 設計メモ参照）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isProcessAlive } from "./e2e-lock.js";
import { sleep } from "./wait.js";
import type { RunningCollector } from "./collector.js";

/** 受け渡しファイルの固定パス。 */
export const COLLECTOR_HANDOFF_PATH = path.join(
  os.tmpdir(),
  "chainviz-ui-e2e-collector.json",
);

interface CollectorHandoff {
  pid: number;
  port: number;
}

function parseHandoff(content: string): CollectorHandoff | null {
  try {
    const data = JSON.parse(content) as Partial<CollectorHandoff>;
    if (typeof data.pid === "number" && typeof data.port === "number") {
      return { pid: data.pid, port: data.port };
    }
    return null;
  } catch {
    return null;
  }
}

/** 「現在の collector」を受け渡しファイルへ書き込む（既存があれば上書き）。 */
export function registerCollector(
  collector: RunningCollector,
  handoffPath: string = COLLECTOR_HANDOFF_PATH,
): void {
  const pid = collector.process.pid;
  if (pid === undefined) {
    throw new Error("collector.process.pid is undefined; cannot register it");
  }
  const handoff: CollectorHandoff = { pid, port: collector.port };
  fs.writeFileSync(handoffPath, JSON.stringify(handoff));
}

/** 現在登録されている collector の所在を読む。未登録・破損なら null。 */
export function readRegisteredCollector(
  handoffPath: string = COLLECTOR_HANDOFF_PATH,
): CollectorHandoff | null {
  try {
    return parseHandoff(fs.readFileSync(handoffPath, "utf8"));
  } catch {
    return null;
  }
}

/** 受け渡しファイルを削除する（テスト実行全体の終了時）。 */
export function clearRegisteredCollector(
  handoffPath: string = COLLECTOR_HANDOFF_PATH,
): void {
  try {
    fs.unlinkSync(handoffPath);
  } catch {
    // 既に無ければ何もしない。
  }
}

/** 登録済み collector が今も生きているか（PID ベース）。 */
export function isRegisteredCollectorAlive(
  handoffPath: string = COLLECTOR_HANDOFF_PATH,
): boolean {
  const registered = readRegisteredCollector(handoffPath);
  return registered !== null && isProcessAlive(registered.pid);
}

export interface StopRegisteredCollectorOptions {
  handoffPath?: string;
  /** SIGTERM 後、SIGKILL へ切り替えるまでの猶予（ms）。 */
  waitMs?: number;
  /** テスト用に差し替え可能なプロセス生死判定（既定は e2e-lock.ts と共通）。 */
  isAlive?: (pid: number) => boolean;
  /** テスト用に差し替え可能な kill 呼び出し（既定は process.kill）。 */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

/**
 * 登録済み collector を SIGTERM で停止し、実際にプロセスが終了するまで待つ
 * （最大 waitMs。反応が無ければ SIGKILL へ切り替える）。ワーカープロセスは
 * 別プロセスが起動した ChildProcess の参照を直接持てないため、PID ベースの
 * 生死確認（`isProcessAlive`。`e2e-lock.ts` と同じ関数を再利用）でポーリング
 * する（`collector.ts` の `RunningCollector.stop()` と同じ「SIGTERM→猶予後
 * SIGKILL」という考え方を、PID 経由でも実現する）。
 */
export async function stopRegisteredCollector(
  options: StopRegisteredCollectorOptions = {},
): Promise<void> {
  const {
    handoffPath = COLLECTOR_HANDOFF_PATH,
    waitMs = 10_000,
    isAlive = isProcessAlive,
    kill = (pid, signal) => process.kill(pid, signal),
  } = options;

  const registered = readRegisteredCollector(handoffPath);
  if (!registered || !isAlive(registered.pid)) return;

  kill(registered.pid, "SIGTERM");
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!isAlive(registered.pid)) return;
    await sleep(200);
  }
  if (isAlive(registered.pid)) {
    kill(registered.pid, "SIGKILL");
  }
}
