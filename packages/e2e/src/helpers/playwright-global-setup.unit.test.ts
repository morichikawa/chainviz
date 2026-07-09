// playwright-global-setup.ts のオーケストレーション（ロック取得 → Docker 起動
// 確認 → collector 起動 → teardown での後片付け）のユニットテスト。
//
// 実 Docker / 実 collector 子プロセスには触れず、依存する4ヘルパー
// （acquireE2eLock / ensureChainRunning / startCollector /
// collector-registry.ts の各関数）をモジュールモックに差し替えて、setup が
// 組み立てる「異常時のクリーンアップ順序」だけを検証する。docker やネット
// ワークに依存しないため vitest.unit.config.ts 側（pnpm test）で回る。
//
// なお本パッケージの他ヘルパー（e2e-lock / collector-launch）のユニットテストは
// 依存注入・純粋関数で書かれており vi.mock を使っていない。ここで vi.mock を
// 使うのは playwright-global-setup.ts が依存注入の口を持たず（Playwright の
// globalSetup は引数無しで呼ばれる仕様）、実装を変更せずに配線ロジックだけを
// 検証するための例外的な措置。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./e2e-lock.js", () => ({
  acquireE2eLock: vi.fn(),
  DEFAULT_LOCK_PATH: "/tmp/fake-ui-e2e.lock",
}));
vi.mock("./docker.js", () => ({
  ensureChainRunning: vi.fn(),
}));
vi.mock("./collector.js", () => ({
  startCollector: vi.fn(),
}));
vi.mock("./collector-registry.js", () => ({
  registerCollector: vi.fn(),
  stopRegisteredCollector: vi.fn(),
  clearRegisteredCollector: vi.fn(),
}));

import { acquireE2eLock, DEFAULT_LOCK_PATH } from "./e2e-lock.js";
import { ensureChainRunning } from "./docker.js";
import { startCollector } from "./collector.js";
import {
  clearRegisteredCollector,
  registerCollector,
  stopRegisteredCollector,
} from "./collector-registry.js";
import globalSetup, {
  UI_E2E_COLLECTOR_PORT,
} from "./playwright-global-setup.js";

const mockedAcquire = vi.mocked(acquireE2eLock);
const mockedEnsureChain = vi.mocked(ensureChainRunning);
const mockedStartCollector = vi.mocked(startCollector);
const mockedRegister = vi.mocked(registerCollector);
const mockedStopRegistered = vi.mocked(stopRegisteredCollector);
const mockedClearRegistered = vi.mocked(clearRegisteredCollector);

/** 呼び出し順の観測用。各モックの実装から名前を push する。 */
let callOrder: string[];

function makeLock() {
  const release = vi.fn(() => {
    callOrder.push("release");
  });
  return { release };
}

function makeCollector() {
  // RunningCollector のうち setup が使う port 以外はダミーで足りる
  // （停止処理は registerCollector/stopRegisteredCollector 経由になった
  // ため、collector 自体の stop メソッドはこのテストでは検証しない）。
  return { port: UI_E2E_COLLECTOR_PORT } as unknown as Awaited<
    ReturnType<typeof startCollector>
  >;
}

describe("playwright-global-setup", () => {
  beforeEach(() => {
    callOrder = [];
    vi.clearAllMocks();
    mockedEnsureChain.mockImplementation(async () => {
      callOrder.push("ensureChainRunning");
    });
    mockedStartCollector.mockImplementation(async () => {
      callOrder.push("startCollector");
      return makeCollector();
    });
    mockedRegister.mockImplementation(() => {
      callOrder.push("registerCollector");
    });
    mockedStopRegistered.mockImplementation(async () => {
      callOrder.push("stopRegisteredCollector");
    });
    mockedClearRegistered.mockImplementation(() => {
      callOrder.push("clearRegisteredCollector");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ロック取得 → Docker 起動確認 → collector 起動 → 登録の順に実行する", async () => {
    mockedAcquire.mockReturnValue(makeLock());

    await globalSetup();

    expect(callOrder).toEqual([
      "ensureChainRunning",
      "startCollector",
      "registerCollector",
    ]);
    expect(mockedAcquire).toHaveBeenCalledTimes(1);
  });

  it("UI 層専用ポート(4125)で collector を起動する", async () => {
    mockedAcquire.mockReturnValue(makeLock());

    await globalSetup();

    expect(UI_E2E_COLLECTOR_PORT).toBe(4125);
    expect(mockedStartCollector).toHaveBeenCalledWith(4125);
  });

  it("起動した collector をレジストリへ登録する", async () => {
    mockedAcquire.mockReturnValue(makeLock());

    await globalSetup();

    expect(mockedRegister).toHaveBeenCalledWith(
      expect.objectContaining({ port: UI_E2E_COLLECTOR_PORT }),
    );
  });

  it(
    "返り値の teardown 関数は「登録済み collector を停止 → 受け渡しファイル" +
      "削除 → ロック解放」の順で後片付けする",
    async () => {
      mockedAcquire.mockReturnValue(makeLock());

      const teardown = await globalSetup();
      // setup 完了時点ではまだ後片付けは走っていない。
      expect(callOrder).not.toContain("stopRegisteredCollector");
      expect(callOrder).not.toContain("release");

      await teardown();

      // stopRegisteredCollector → clearRegisteredCollector → release の順。
      // クロージャで閉じ込めた collector ではなく、常にレジストリ（受け渡し
      // ファイル）経由で「その時点の最新の collector」を止める設計であること
      // を確認する（UI-ERR-01/02 が collector を差し替えても正しく後始末
      // できる。docs/worklog/issue-202.md 設計メモ参照）。
      expect(callOrder.slice(-3)).toEqual([
        "stopRegisteredCollector",
        "clearRegisteredCollector",
        "release",
      ]);
    },
  );

  it("ロック取得に失敗したら同じエラーを伝播し、Docker・collector には進まない", async () => {
    const boom = new Error("lock held by another run");
    mockedAcquire.mockImplementation(() => {
      throw boom;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(globalSetup()).rejects.toBe(boom);

    // ロックを取れていないので後続処理は一切呼ばない。
    expect(mockedEnsureChain).not.toHaveBeenCalled();
    expect(mockedStartCollector).not.toHaveBeenCalled();
    // ロックパスを含む原因の分かるメッセージをログに出す。
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(DEFAULT_LOCK_PATH);
  });

  it("Docker 起動確認に失敗したらロックを解放してからエラーを伝播する", async () => {
    const lock = makeLock();
    mockedAcquire.mockReturnValue(lock);
    const boom = new Error("docker not available");
    mockedEnsureChain.mockImplementation(async () => {
      callOrder.push("ensureChainRunning");
      throw boom;
    });

    await expect(globalSetup()).rejects.toBe(boom);

    // 取得済みロックをリークさせない。
    expect(lock.release).toHaveBeenCalledTimes(1);
    // Docker 起動確認で落ちたので collector 起動には進まない。
    expect(mockedStartCollector).not.toHaveBeenCalled();
  });

  it("collector 起動に失敗したらロックを解放してからエラーを伝播する", async () => {
    const lock = makeLock();
    mockedAcquire.mockReturnValue(lock);
    const boom = new Error("collector crashed on launch");
    mockedStartCollector.mockImplementation(async () => {
      callOrder.push("startCollector");
      throw boom;
    });

    await expect(globalSetup()).rejects.toBe(boom);

    expect(lock.release).toHaveBeenCalledTimes(1);
    // 起動確認 → 起動試行までは進んでいる（その後クリーンアップで release）。
    expect(callOrder).toEqual([
      "ensureChainRunning",
      "startCollector",
      "release",
    ]);
    // 起動自体に失敗しているので、レジストリへの登録はしない。
    expect(mockedRegister).not.toHaveBeenCalled();
  });
});
