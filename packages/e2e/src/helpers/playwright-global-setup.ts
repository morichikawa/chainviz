// Playwright（UI 層 E2E, `pnpm test:e2e:ui`）の globalSetup。
//
// プロトコル層 E2E（vitest, `helpers/global-setup.ts` + `helpers/harness.ts`）
// と同じ排他ロック・Docker 起動確認・collector 起動ヘルパーを再利用し、
// UI 層専用のポートで collector を起動する（docs/ARCHITECTURE.md §8.3）。
//
// Playwright は globalSetup が返した関数を「グローバルティアダウン」として
// 扱う（同一プロセス内で、全テスト終了後に一度だけ呼ばれる）。これにより、
// setup 側で起動した collector 子プロセスの参照をクロージャでそのまま
// teardown 側へ渡せるため、`playwright.config.ts` の `globalTeardown`
// オプション（別ファイル + 状態受け渡しが必要になる）は使わない。

import { acquireE2eLock, DEFAULT_LOCK_PATH, type E2eLock } from "./e2e-lock.js";
import { ensureChainRunning } from "./docker.js";
import { startCollector, type RunningCollector } from "./collector.js";

/**
 * UI 層 E2E 専用の collector ポート。
 * 既存の dev(4000) / vitest e2e(4123) / ポート衝突テスト(4199) と
 * 衝突しない値（docs/ARCHITECTURE.md §8.3）。
 */
export const UI_E2E_COLLECTOR_PORT = 4125;

export default async function globalSetup(): Promise<() => Promise<void>> {
  let lock: E2eLock;
  try {
    lock = acquireE2eLock();
  } catch (err) {
    // vitest 版（helpers/global-setup.ts）と同様、globalSetup の例外は
    // そのまま伝播させる（タイムアウトで分かりにくく失敗させない）。
    console.error(
      `[e2e:ui] test:e2e:ui の排他ロックを取得できませんでした(${DEFAULT_LOCK_PATH}):`,
    );
    throw err;
  }

  let collector: RunningCollector;
  try {
    await ensureChainRunning();
    collector = await startCollector(UI_E2E_COLLECTOR_PORT);
  } catch (err) {
    lock.release();
    throw err;
  }

  return async () => {
    await collector.stop();
    lock.release();
  };
}
