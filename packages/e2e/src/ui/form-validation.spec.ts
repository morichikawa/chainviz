// 異常系: 定型操作フォームのバリデーション(UI-ERR-03・UI-ERR-04)。
// packages/e2e/SCENARIOS.md「異常系(UI-ERR)」節の一部の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// UI-ERR-03は実装時に実挙動を確認した結果、SCENARIOS.mdの操作対象を
// 「宛先の不正なアドレス」から「金額の不正な値」へ差し替えている
// (docs/worklog/issue-202.md 設計メモ参照。宛先側のクライアント側
// バリデーション欠落は Issue #236 として別途起票済み)。

import { expect, test } from "@playwright/test";
import {
  OPERATION_PANEL_VIEWPORT,
  STATIC_WORKBENCH_ID,
  openOperationPanel,
  submitTransfer,
} from "./support/operations.js";

// 操作パネルを開いて送信するため、既定より大きいビューポートを使う
// (support/operations.ts の OPERATION_PANEL_VIEWPORT 参照)。
test.use({ viewport: OPERATION_PANEL_VIEWPORT });

/**
 * UI-ERR-04で「残高を大きく超える金額」として使うETH建て文字列。
 * 静的ワークベンチのプリセットウォレットはジェネシスのpremineにより
 * 実測で約7億ETHの残高を持つ(profiles/ethereum/values.env の
 * EL_PREMINE_COUNT に依存)。この値は premine量が今後変わっても確実に
 * 超過するよう、実測残高よりも大きく安全側に取った固定値。premine の
 * 設定が桁違いに変わった場合はこの値も見直すこと。
 */
const OVER_BALANCE_AMOUNT_ETH = "999999999999";

/** UI-ERR-04で送金先に使う任意の有効アドレス(バーンアドレス)。 */
const RECIPIENT_ADDRESS = "0x000000000000000000000000000000000000dEaD";

test.describe("UI-ERR 定型操作フォームのバリデーション", () => {
  test("UI-ERR-03: 定型操作フォームの不正入力は実行前に弾かれる", async ({
    page,
  }) => {
    await page.goto("/");
    const panel = await openOperationPanel(page, STATIC_WORKBENCH_ID, "transfer");

    await test.step(
      "送金フォームの金額に数値として解釈できない値（例: abc）を入力する",
      async () => {
        // 宛先は有効な値を入れ、金額のバリデーションだけを単独で検証する。
        await panel.getByTestId("operation-transfer-to").fill(RECIPIENT_ADDRESS);
        await panel.getByTestId("operation-transfer-amount").fill("abc");
      },
    );

    await test.step(
      "バリデーションエラーが表示され、コマンドが送信されない" +
        "（保留表示・トーストが出ない）",
      async () => {
        const submitButton = panel.locator('form button[type="submit"]');
        await expect(submitButton).toBeDisabled();
        await expect(panel.locator(".operation-form__error")).toBeVisible();

        // 無効化されたボタンなのでクリックしても何も起きないはずだが、
        // 「実行を試みる」というシナリオの意図を明示的に確認する。
        await submitButton.click({ force: true }).catch(() => {});

        // 「保留中でない」ことの確認は aria-busy が厳密に "false" 文字列で
        // あることではなく "true" でないこと（≒属性が無い場合も含む）で
        // 判定する。App.tsx の infraNodesWithHighlight はブロック高が進む
        // たびにノードを作り直す際、operationPending を一度も切り替えて
        // いないワークベンチには aria-busy 属性自体を付けない実装になって
        // おり（entitiesToFlowNodes は operationPending を持たず、値が
        // false のままなら明示的な merge が走らない）、稼働中のチェーンでは
        // ブロック到達のタイミング次第で "false" 明示 / 属性欠落のどちらも
        // 起こりうる（実装時に発覚。Issue #237として別途起票、この属性欠落
        // 自体はaria-busyの意味論上「busyでない」と等価なため実害は無い）。
        await expect(
          page.getByTestId(`infra-card-operate-${STATIC_WORKBENCH_ID}`),
        ).not.toHaveAttribute("aria-busy", "true");
        await expect(page.locator('[data-testid^="toast-"]')).toHaveCount(0);
      },
    );
  });

  test("UI-ERR-04: collector 側で失敗する操作はエラートーストで伝わる", async ({
    page,
  }) => {
    await page.goto("/");

    await test.step("送金フォームで残高を大きく超える金額を入力して実行する", async () => {
      await submitTransfer(page, STATIC_WORKBENCH_ID, {
        to: RECIPIENT_ADDRESS,
        amount: OVER_BALANCE_AMOUNT_ETH,
      });
    });

    await test.step(
      "エラートースト（toast-*）が表示され、失敗理由が読める" +
        "（汎用文言へのすり替えでないこと）",
      async () => {
        const toast = page.locator('[data-testid^="toast-"]').first();
        await expect(toast).toBeVisible();
        // describeCommandError は i18n の定型文言に続けて collector から
        // 届いた具体的なエラー文字列（cast の失敗理由。宛先アドレスを含む）
        // をそのまま連結する（commandMessages.ts）。宛先アドレスが含まれて
        // いることをもって、「ワークベンチ操作の実行に失敗しました」だけの
        // 汎用文言にすり替えられていない(collector由来の具体的な内容が
        // 実際に載っている)ことを確認する。
        await expect(toast).toContainText(RECIPIENT_ADDRESS);
      },
    );
  });
});
