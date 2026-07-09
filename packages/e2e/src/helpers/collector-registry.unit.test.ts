// collector-registry.ts のユニットテスト。受け渡しファイルの読み書きは実 fs を
// 使うが、docker やネットワークには一切依存しないので vitest.unit.config.ts 側
// （pnpm test）で高速に回る。テストごとに一意の一時パスを使い、実際の
// test:e2e:ui 実行が使う受け渡しパス（os.tmpdir() 固定パス）には触れない
// （e2e-lock.unit.test.ts と同じ方針）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunningCollector } from "./collector.js";
import {
  clearRegisteredCollector,
  readRegisteredCollector,
  registerCollector,
  stopRegisteredCollector,
} from "./collector-registry.js";

let handoffPath: string;

function makeCollector(pid: number, port: number): RunningCollector {
  return {
    port,
    process: { pid } as RunningCollector["process"],
    readLogs: () => "",
    stop: async () => {},
  };
}

beforeEach(() => {
  handoffPath = path.join(
    os.tmpdir(),
    `chainviz-collector-registry-unit-test-${process.pid}-${Math.random()}.json`,
  );
});

afterEach(() => {
  try {
    fs.unlinkSync(handoffPath);
  } catch {
    // 既に無ければ何もしない（テストがclearを検証済みの場合等）。
  }
});

describe("registerCollector / readRegisteredCollector", () => {
  it("登録した pid/port をそのまま読み戻せる", () => {
    registerCollector(makeCollector(4242, 4125), handoffPath);
    expect(readRegisteredCollector(handoffPath)).toEqual({
      pid: 4242,
      port: 4125,
    });
  });

  it("2回目の登録は上書きする（差し替え）", () => {
    registerCollector(makeCollector(1111, 4125), handoffPath);
    registerCollector(makeCollector(2222, 4125), handoffPath);
    expect(readRegisteredCollector(handoffPath)).toEqual({
      pid: 2222,
      port: 4125,
    });
  });

  it("pid が undefined の collector は登録できない", () => {
    const collector: RunningCollector = {
      port: 4125,
      process: { pid: undefined } as RunningCollector["process"],
      readLogs: () => "",
      stop: async () => {},
    };
    expect(() => registerCollector(collector, handoffPath)).toThrow(
      /pid is undefined/,
    );
  });

  it("ファイルが存在しなければ null を返す", () => {
    expect(readRegisteredCollector(handoffPath)).toBeNull();
  });

  it("壊れた JSON は null を返す", () => {
    fs.writeFileSync(handoffPath, "not json");
    expect(readRegisteredCollector(handoffPath)).toBeNull();
  });

  it("必須フィールドが欠けていれば null を返す", () => {
    fs.writeFileSync(handoffPath, JSON.stringify({ pid: 123 }));
    expect(readRegisteredCollector(handoffPath)).toBeNull();
  });
});

describe("clearRegisteredCollector", () => {
  it("受け渡しファイルを削除する", () => {
    registerCollector(makeCollector(4242, 4125), handoffPath);
    clearRegisteredCollector(handoffPath);
    expect(readRegisteredCollector(handoffPath)).toBeNull();
  });

  it("既に無い場合も例外を投げない（冪等）", () => {
    expect(() => clearRegisteredCollector(handoffPath)).not.toThrow();
  });
});

describe("stopRegisteredCollector", () => {
  it("未登録なら kill を呼ばない", async () => {
    const kill = vi.fn();
    await stopRegisteredCollector({ handoffPath, kill });
    expect(kill).not.toHaveBeenCalled();
  });

  it("登録済みだが既に死んでいれば kill を呼ばない", async () => {
    registerCollector(makeCollector(4242, 4125), handoffPath);
    const kill = vi.fn();
    const isAlive = vi.fn(() => false);
    await stopRegisteredCollector({ handoffPath, kill, isAlive });
    expect(kill).not.toHaveBeenCalled();
  });

  it("生きていれば SIGTERM を送り、死亡確認できたら SIGKILL は送らない", async () => {
    registerCollector(makeCollector(4242, 4125), handoffPath);
    const kill = vi.fn();
    // 1回目の isAlive 呼び出し(SIGTERM前の判定)はtrue、
    // SIGTERM送信後のポーリング1回目でfalse(死亡確認)を返す。
    let calls = 0;
    const isAlive = vi.fn(() => {
      calls += 1;
      return calls === 1;
    });
    await stopRegisteredCollector({ handoffPath, kill, isAlive, waitMs: 5_000 });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(4242, "SIGTERM");
  });

  it("waitMs 経過しても死ななければ SIGKILL へ切り替える", async () => {
    registerCollector(makeCollector(4242, 4125), handoffPath);
    const kill = vi.fn();
    // 常に生きている(SIGTERMに反応しない)ふりをする。
    const isAlive = vi.fn(() => true);
    // waitMsを実行時間に影響しない小さな値にして高速にテストする
    // (sleep(200)を使うポーリングループのため、waitMsを短くしても
    // 少なくとも1回はポーリングが回ってSIGKILLへ切り替わることを確認できる)。
    await stopRegisteredCollector({ handoffPath, kill, isAlive, waitMs: 10 });
    expect(kill).toHaveBeenNthCalledWith(1, 4242, "SIGTERM");
    expect(kill).toHaveBeenNthCalledWith(2, 4242, "SIGKILL");
  });
});
