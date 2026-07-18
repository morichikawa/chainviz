// Playwright（UI 層 E2E, `pnpm test:e2e:ui`）の globalSetup。
//
// プロトコル層 E2E（vitest, `helpers/global-setup.ts` + `helpers/harness.ts`）
// と同じ排他ロック・Docker 起動確認・collector 起動ヘルパーを再利用し、
// UI 層専用のポートで collector を起動する（docs/ARCHITECTURE.md §8.3）。
//
// Playwright は globalSetup が返した関数を「グローバルティアダウン」として
// 扱う（全テスト終了後に一度だけ呼ばれる。ただし globalSetup/globalTeardown
// は実際にテストを走らせる「ワーカープロセス」とは別の OS プロセスで動く
// ため、ここで起動した collector の参照をワーカー側のテストコードへ
// クロージャで渡すことはできない）。
//
// connection-errors.spec.ts（UI-ERR-01/02）は実際に collector プロセスを
// 停止・再起動するテストのため、`helpers/collector-registry.ts` の
// ファイルベースの受け渡し（PID/ポート）を経由して、プロセスをまたいで
// 「現在の collector」を追跡する（同ファイルの docstring参照）。

import { acquireE2eLock, DEFAULT_LOCK_PATH, type E2eLock } from "./e2e-lock.js";
import { ensureChainRunning } from "./docker.js";
import { startCollector } from "./collector.js";
import {
  clearRegisteredCollector,
  registerCollector,
  stopRegisteredCollector,
} from "./collector-registry.js";

/**
 * UI 層 E2E 専用の collector ポート。
 * 既存の dev(4000) / vitest e2e(4123) / ポート衝突テスト(4199) と
 * 衝突しない値（docs/ARCHITECTURE.md §8.3）。
 */
export const UI_E2E_COLLECTOR_PORT = 4125;

/**
 * UI 層 E2E 専用のロギングプロキシポート。
 * 「WebSocket ポート + 1」という規約（docs/ARCHITECTURE.md §8.3、Issue #254）
 * の知識をこの定数定義 1 箇所に集約する。`startCollector` の暗黙の既定値
 * （`port + 1`）に頼らず、ここで明示的に計算した値をそのまま渡すことで、
 * 静的ワークベンチの RPC 向き先を exec 時に上書きする側（helpers/docker.ts）
 * からも同じ値を参照できるようにする（Issue #381）。
 */
export const UI_E2E_PROXY_PORT = UI_E2E_COLLECTOR_PORT + 1;

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

  try {
    await ensureChainRunning();
    const collector = await startCollector(UI_E2E_COLLECTOR_PORT, UI_E2E_PROXY_PORT);
    registerCollector(collector);
  } catch (err) {
    lock.release();
    throw err;
  }

  return async () => {
    // connection-errors.spec.ts（UI-ERR-01/02）が collector を停止・再起動
    // して差し替えている可能性があるため、起動直後の参照ではなく、
    // レジストリ（受け渡しファイル）経由で「その時点の最新の collector」を
    // 止める（collector-registry.ts の docstring参照）。
    await stopRegisteredCollector();
    clearRegisteredCollector();
    lock.release();
  };
}
