// UI-CMD系(commands-node.spec.ts / commands-workbench.spec.ts)・UI-C系
// (wallet-balance.spec.ts / token-balance.spec.ts)が共有する、
// `test.afterAll` の安全網としてのカード削除ヘルパー。
//
// 背景(Issue #233): 本体のテストが追加したノード/ワークベンチの削除に
// 失敗した場合に備え、`afterAll` で「削除ボタンが残っていればクリック
// する」という後始末を行っているが、素朴な実装には2つの競合状態があった。
//
// 1. `page.goto("/")` 直後は WebSocket 接続・snapshot 受信・React 描画が
//    完了していないことがあり、直後に `Locator.count()` を判定すると
//    実際にはカードが存在するのに `0` と判定されて削除がスキップされる。
// 2. 削除ボタンのクリックはコマンド送信のみで、docker 停止・削除の完了を
//    待たない。カードが実際に消えるまで待たずに `page.close()` すると、
//    そのファイルが最後の実行ファイルだった場合に直後の `globalTeardown` で
//    collector が停止し、削除が完遂しないままコンテナが残る。
//
// Issue #201 では2ファイル(wallet-balance.spec.ts / token-balance.spec.ts)
// だけにこの回避策をインラインで実装したが、同型の
// commands-node.spec.ts / commands-workbench.spec.ts には未適用のまま
// 残っていた(修正が一部にしか行き渡らない再発防止のため、ここに1箇所へ
// 集約する。docs/worklog/issue-233.md 設計メモ参照)。

import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { fitCanvasView } from "./viewport.js";

/**
 * カード削除の後始末を構成する3つの非同期アクション。実 Playwright の
 * `Locator` に依存しないため、ユニットテストではフェイク関数を渡せる。
 */
export interface RemoveCardActions {
  /** 削除ボタンが出現するまで待つ。出現しなければ reject する想定。 */
  waitForButton: () => Promise<void>;
  /** 削除ボタンを押す。 */
  click: () => Promise<void>;
  /** カードが実際に消えるまで待つ。消えなければ reject する想定。 */
  waitForRemoved: () => Promise<void>;
}

/**
 * `afterAll` の安全網としてのカード削除ロジック(Playwright に依存しない
 * 純粋なオーケストレーション)。
 *
 * - `waitForButton` が失敗(ボタンが最後まで現れない)した場合は、本体の
 *   テストが既に削除を完了させた通常ケースとみなし、何もせず返る。
 * - `waitForButton` が成功したら `click` → `waitForRemoved` の順に実行する。
 *   どちらかが失敗した場合は、削除が本当に失敗した可能性が高いため
 *   catch で握りつぶさず、そのまま例外を呼び出し元に伝播させる
 *   (Issue #201 のレビューで指摘された、catch の範囲が広すぎて本当の
 *   失敗までログ無しで握りつぶしていた問題への対応。CLAUDE.md
 *   「エラーを握りつぶすコードを見逃さない」に従う)。
 */
export async function removeCardIfPresent(
  actions: RemoveCardActions,
): Promise<void> {
  try {
    await actions.waitForButton();
  } catch {
    // 削除ボタンが最後まで見つからない = 本体テストが既に削除済み。
    return;
  }
  await actions.click();
  await actions.waitForRemoved();
}

/**
 * `removeCardIfPresent` を実 Playwright の `Page` に配線する。
 *
 * `infra-card-remove-<entityId>` の出現を `timeoutMs` まで待ってからクリック
 * し、対応する `infra-card-<entityId>` が実際に消える(`count === 0`)まで
 * `timeoutMs` を上限に待つ。クリック前に `fitCanvasView` で視野を確保する
 * (Issue #373。安全網はコンテナ残留に直結するため、ビューポート外クリックの
 * 永久リトライへの頑健化の価値が高い。削除ボタン自体を対象として渡し、
 * 実際に視野内へ入ったことを確認してからクリックする。
 * docs/worklog/issue-373.md 参照)。
 */
export async function removeInfraCardIfPresent(
  page: Page,
  entityId: string,
  timeoutMs: number,
): Promise<void> {
  const removeButton = page.getByTestId(`infra-card-remove-${entityId}`);
  await removeCardIfPresent({
    waitForButton: () => removeButton.waitFor({ timeout: timeoutMs }),
    click: async () => {
      await fitCanvasView(page, removeButton);
      await removeButton.click();
    },
    waitForRemoved: () =>
      expect(page.getByTestId(`infra-card-${entityId}`)).toHaveCount(0, {
        timeout: timeoutMs,
      }),
  });
}

/**
 * `test.afterAll` の定型処理(ページを開く → goto → 各 entityId を安全に
 * 削除 → 必ず page.close する)をまとめる。`entityIds` が空(=本体テストが
 * 既に後始末済みの通常ケース)ならページすら開かず即座に返る。
 *
 * `viewport` は `browser.newPage()` が `test.use({ viewport })` を引き継が
 * ないために必要な場合(操作パネルを開くUI-C系シナリオ)にのみ指定する。
 */
export async function cleanupRemovableCards(
  browser: Browser,
  entityIds: readonly string[],
  options: { timeoutMs: number; viewport?: { width: number; height: number } },
): Promise<void> {
  const targets = entityIds.filter((entityId) => entityId !== "");
  if (targets.length === 0) return;

  const page = await browser.newPage(
    options.viewport ? { viewport: options.viewport } : undefined,
  );
  try {
    await page.goto("/");
    for (const entityId of targets) {
      await removeInfraCardIfPresent(page, entityId, options.timeoutMs);
    }
  } finally {
    await page.close();
  }
}
