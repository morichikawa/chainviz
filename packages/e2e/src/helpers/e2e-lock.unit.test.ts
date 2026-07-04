// e2e-lock.ts のユニットテスト。ロックファイルの読み書きは実 fs を使うが、
// docker やネットワークには一切依存しないので vitest.unit.config.ts 側
// （pnpm test）で高速に回る。テストごとに一意の一時パスを使い、実際の
// test:e2e 実行が使うロックパス（os.tmpdir() 固定パス）には触れない。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireE2eLock,
  formatLockConflictError,
  formatStaleRetryExhaustedError,
  formatUnparsableLockError,
  parseLockInfo,
} from "./e2e-lock.js";

describe("parseLockInfo", () => {
  it("正しい形式の JSON を解析できる", () => {
    const info = parseLockInfo(
      JSON.stringify({ pid: 123, host: "myhost", startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(info).toEqual({ pid: 123, host: "myhost", startedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("壊れた JSON は null を返す", () => {
    expect(parseLockInfo("not json")).toBeNull();
  });

  it("必須フィールドが欠けていれば null を返す", () => {
    expect(parseLockInfo(JSON.stringify({ pid: 123 }))).toBeNull();
  });
});

describe("formatLockConflictError / formatUnparsableLockError", () => {
  it("保持プロセスの PID・host・開始時刻・ロックパスを含む", () => {
    const msg = formatLockConflictError(
      { pid: 999, host: "otherhost", startedAt: "2026-01-01T00:00:00.000Z" },
      "/tmp/lock",
    );
    expect(msg).toContain("999");
    expect(msg).toContain("otherhost");
    expect(msg).toContain("/tmp/lock");
    expect(msg).toContain("同時に複数実行");
  });

  it("解析不能な場合のメッセージはロックパスと手動削除の案内を含む", () => {
    const msg = formatUnparsableLockError("/tmp/lock");
    expect(msg).toContain("/tmp/lock");
    expect(msg).toContain("解析");
  });

  it("stale 回収上限到達のメッセージは回収失敗の旨とロックパスを含み、解析不能とは別文言", () => {
    const msg = formatStaleRetryExhaustedError("/tmp/lock");
    expect(msg).toContain("/tmp/lock");
    expect(msg).toContain("回収");
    // 解析はできている経路なので「解析できませんでした」の文言は含まない。
    expect(msg).not.toContain("解析できませんでした");
  });
});

describe("acquireE2eLock", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chainviz-e2e-lock-test-"));
    lockPath = path.join(dir, "test.lock");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ロックが存在しなければ取得でき、ファイルが作成される", () => {
    const lock = acquireE2eLock({ lockPath });
    expect(fs.existsSync(lockPath)).toBe(true);
    lock.release();
  });

  it("release すると再度取得できる（ロックファイルが消える）", () => {
    const lock = acquireE2eLock({ lockPath });
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
    const lock2 = acquireE2eLock({ lockPath });
    lock2.release();
  });

  it("release を複数回呼んでも安全（2 回目は何もしない）", () => {
    const lock = acquireE2eLock({ lockPath });
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });

  it("生きているプロセスが保持するロックがあれば即座に明確なエラーで失敗する", () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 424242, host: "otherhost", startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(() =>
      acquireE2eLock({ lockPath, isAlive: () => true }),
    ).toThrow(/otherhost/);
    // 衝突時は既存ロックを壊さない。
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("保持プロセスが既に死んでいる（stale）場合は削除して取得し直す", () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 424242, host: "otherhost", startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const lock = acquireE2eLock({ lockPath, isAlive: () => false });
    const content = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid: number };
    expect(content.pid).toBe(process.pid);
    lock.release();
  });

  it("解析できない内容が残り続ける場合は衝突エラーで失敗する", () => {
    fs.writeFileSync(lockPath, "not json");
    expect(() => acquireE2eLock({ lockPath, maxRetries: 1 })).toThrow(
      /解析/,
    );
  });
});
