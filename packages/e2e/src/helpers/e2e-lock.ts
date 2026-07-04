// pnpm test:e2e の同時実行を防ぐホスト単位の排他ロック。
//
// 背景（Issue #64）: 同一ホスト上で複数の worktree/ブランチから test:e2e を
// 同時実行すると、collector の待ち受けポートと docker compose スタック
// （profiles/ethereum）を奪い合い、片方が相手の collector に誤接続したり、
// 相手のスタック停止に巻き込まれたりする紛らわしい不安定挙動を引き起こす。
// collector.ts 側の起動判定修正（自プロセスのログだけを根拠にする）だけでは、
// 「2つの test:e2e が同時に docker compose を触り合う」問題までは防げない
// ため、実行そのものを排他制御する。
//
// ロックファイルは os.tmpdir() 配下の固定パスに置く。worktree ごとに
// リポジトリの絶対パスは異なるが、同一ホスト・同一ユーザーであれば
// os.tmpdir() は共通なので、worktree をまたいで排他できる。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** ロックファイルの既定パス（テストからは差し替え可能）。 */
export const DEFAULT_LOCK_PATH = path.join(
  os.tmpdir(),
  "chainviz-test-e2e.lock",
);

/** ロックファイルに書き込む内容。 */
export interface LockInfo {
  pid: number;
  host: string;
  /** ロック取得時刻（ISO 8601）。 */
  startedAt: string;
}

/** ロックファイルの中身を解析する。壊れている・想定外の形式なら null。 */
export function parseLockInfo(content: string): LockInfo | null {
  try {
    const data = JSON.parse(content) as Partial<LockInfo>;
    if (
      typeof data.pid === "number" &&
      typeof data.host === "string" &&
      typeof data.startedAt === "string"
    ) {
      return { pid: data.pid, host: data.host, startedAt: data.startedAt };
    }
    return null;
  } catch {
    return null;
  }
}

/** 既存ロック保持者が判明している場合の衝突エラーメッセージ。 */
export function formatLockConflictError(
  info: LockInfo,
  lockPath: string,
): string {
  return (
    `別の pnpm test:e2e 実行（PID ${info.pid}, host ${info.host}, ` +
    `開始 ${info.startedAt}）がロック(${lockPath})を保持しています。` +
    `test:e2e は同時に複数実行できません（別 worktree・別ブランチからの` +
    `実行を含む）。先行実行の終了を待ってから再実行してください。` +
    `先行プロセスが実際には終了しているのにロックが残っている場合は、` +
    `${lockPath} を手動で削除してから再実行してください。`
  );
}

/** ロックファイルの中身が解析できない場合の衝突エラーメッセージ。 */
export function formatUnparsableLockError(lockPath: string): string {
  return (
    `ロックファイル(${lockPath})が存在しますが内容を解析できませんでした。` +
    `他の test:e2e 実行が同時にロックを操作している可能性があります。` +
    `解消しない場合は ${lockPath} を手動で削除してから再実行してください。`
  );
}

/** stale ロックの回収を上限まで試みても取得できなかった場合のエラーメッセージ。 */
export function formatStaleRetryExhaustedError(lockPath: string): string {
  return (
    `ロックファイル(${lockPath})の回収を規定回数試みましたが取得できませんでした。` +
    `他の test:e2e 実行が同時にロックを操作している可能性があります。` +
    `解消しない場合は ${lockPath} を手動で削除してから再実行してください。`
  );
}

/** pid のプロセスが生きているかを判定する（シグナル 0 送信による確認）。 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM は「存在するが権限がなくシグナル送信できない」= 生きている。
    // ESRCH 等は存在しない = 死んでいる。
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface E2eLock {
  /** ロックを解放する（複数回呼んでも安全）。 */
  release(): void;
}

export interface AcquireE2eLockOptions {
  lockPath?: string;
  /** テスト用に差し替え可能なプロセス生死判定。 */
  isAlive?: (pid: number) => boolean;
  /** 既存ロックが stale だった場合の再取得の最大試行回数。 */
  maxRetries?: number;
}

/**
 * ホスト単位の排他ロックを取得する。
 *
 * - ロックファイルが存在せず取得できた場合はそのまま返す。
 * - 既に存在し、保持プロセスが生きている場合は明確なエラーを投げる
 *   （即座に失敗させる。ポーリングでタイムアウトを待たせない）。
 * - 既に存在するが保持プロセスが死んでいる（stale）場合は、安全とみなして
 *   削除のうえ取得し直す。
 */
export function acquireE2eLock(
  options: AcquireE2eLockOptions = {},
): E2eLock {
  const { lockPath = DEFAULT_LOCK_PATH, isAlive = isProcessAlive, maxRetries = 3 } =
    options;

  const writeLock = (): void => {
    const fd = fs.openSync(lockPath, "wx");
    try {
      fs.writeSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          host: os.hostname(),
          startedAt: new Date().toISOString(),
        } satisfies LockInfo),
      );
    } finally {
      fs.closeSync(fd);
    }
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      writeLock();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      const existing = parseLockInfo(readIfExists(lockPath));
      if (existing && isAlive(existing.pid)) {
        throw new Error(formatLockConflictError(existing, lockPath));
      }
      if (!existing) {
        // ファイルが存在するのに内容が読めない場合は、他プロセスが同時に
        // 書き込み中の可能性がある。解析できない状態が続くのは異常なので、
        // 試行回数を使い切ったら安全側（衝突扱い）に倒す。
        if (attempt >= maxRetries) {
          throw new Error(formatUnparsableLockError(lockPath));
        }
        continue;
      }

      // stale ロック: 保持プロセスは既に死んでいるので削除して取得し直す。
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // 他プロセスが同時に削除済みの可能性。無視して再試行する。
      }
      if (attempt >= maxRetries) {
        throw new Error(formatStaleRetryExhaustedError(lockPath));
      }
    }
  }

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // 既に削除済みなら何もしない。
      }
    },
  };
}

function readIfExists(lockPath: string): string {
  try {
    return fs.readFileSync(lockPath, "utf8");
  } catch {
    return "";
  }
}
