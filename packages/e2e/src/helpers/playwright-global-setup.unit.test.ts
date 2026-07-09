// playwright-global-setup.ts のオーケストレーション（ロック取得 → Docker 起動
// 確認 → collector 起動 → teardown での後片付け）のユニットテスト。
//
// 実 Docker / 実 collector 子プロセスには触れず、依存する 3 ヘルパー
// （acquireE2eLock / ensureChainRunning / startCollector）をモジュールモックに
// 差し替えて、setup が組み立てる「異常時のクリーンアップ順序」だけを検証する。
// docker やネットワークに依存しないため vitest.unit.config.ts 側（pnpm test）で
// 回る。
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

import { acquireE2eLock, DEFAULT_LOCK_PATH } from "./e2e-lock.js";
import { ensureChainRunning } from "./docker.js";
import { startCollector } from "./collector.js";
import globalSetup, {
  UI_E2E_COLLECTOR_PORT,
} from "./playwright-global-setup.js";

const mockedAcquire = vi.mocked(acquireE2eLock);
const mockedEnsureChain = vi.mocked(ensureChainRunning);
const mockedStartCollector = vi.mocked(startCollector);

/** 呼び出し順の観測用。各モックの実装から名前を push する。 */
let callOrder: string[];

function makeLock() {
  const release = vi.fn(() => {
    callOrder.push("release");
  });
  return { release };
}

function makeCollector() {
  const stop = vi.fn(async () => {
    callOrder.push("stop");
  });
  // RunningCollector のうち teardown が使う stop 以外はダミーで足りる。
  return { port: UI_E2E_COLLECTOR_PORT, stop } as unknown as Awaited<
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ロック取得 → Docker 起動確認 → collector 起動の順に実行する", async () => {
    mockedAcquire.mockReturnValue(makeLock());

    await globalSetup();

    expect(callOrder).toEqual([
      "ensureChainRunning",
      "startCollector",
    ]);
    expect(mockedAcquire).toHaveBeenCalledTimes(1);
  });

  it("UI 層専用ポート(4125)で collector を起動する", async () => {
    mockedAcquire.mockReturnValue(makeLock());

    await globalSetup();

    expect(UI_E2E_COLLECTOR_PORT).toBe(4125);
    expect(mockedStartCollector).toHaveBeenCalledWith(4125);
  });

  it("返り値の teardown 関数は collector 停止 → ロック解放の順で後片付けする", async () => {
    mockedAcquire.mockReturnValue(makeLock());

    const teardown = await globalSetup();
    // setup 完了時点ではまだ後片付けは走っていない。
    expect(callOrder).not.toContain("stop");
    expect(callOrder).not.toContain("release");

    await teardown();

    // stop が release より先。ロックを解放する前に collector を確実に止める。
    expect(callOrder.slice(-2)).toEqual(["stop", "release"]);
  });

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
  });
});
