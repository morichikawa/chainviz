// C層: ウォレットの残高/nonce表示・送金操作・操作エッジの観測
// (UI-C-01・UI-C-02・UI-C-07)。packages/e2e/SCENARIOS.md「C層: トランザ
// クション・ウォレット・コントラクト(UI-C)」節の一部の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// UI-C-01→02→07は「compose起動の静的ワークベンチ(プリセットウォレット
// 持ち)から、追加ワークベンチのウォレットへ送金する」という一連の流れを
// 共有する(UI-C-02の送金操作がUI-C-07の操作エッジ観測を兼ねる)。
// test.describe.serial でグルーピングし、送金先アドレス・送金前後の
// 残高/nonceをモジュールスコープの変数で引き継ぐ(commands-node.spec.ts /
// commands-workbench.spec.ts と同じ設計。docs/worklog/issue-201.md
// 設計メモ参照)。

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { cleanupRemovableCards } from "./support/cleanup.js";
import {
  ENTITY_APPEAR_TIMEOUT_MS,
  OPERATION_EFFECT_TIMEOUT_MS,
  OPERATION_PANEL_VIEWPORT,
  STATIC_WORKBENCH_ID,
  addWorkbenchAndGetWallet,
  ownershipEdgeWalletAddress,
  submitTransfer,
} from "./support/operations.js";

// 操作パネルを開いて送信するため、既定より大きいビューポートを使う
// (support/operations.ts の OPERATION_PANEL_VIEWPORT 参照)。
test.use({ viewport: OPERATION_PANEL_VIEWPORT });

/**
 * ウォレットカードの subtitle(`"<balance> ETH · <nonce label> <nonce>"`。
 * `WalletCard.tsx` 参照)から残高(ETH)と nonce を取り出す。balance/nonce
 * それぞれ専用の testid は無いが、数値部分は言語に依存しないため正規表現で
 * 読む。
 */
async function readWalletStats(
  page: Page,
  address: string,
): Promise<{ balanceEth: number; nonce: number }> {
  const text = await page
    .getByTestId(`wallet-card-${address}`)
    .locator(".infra-card__subtitle")
    .textContent();
  if (!text) throw new Error(`wallet card ${address} has no subtitle text`);
  const trimmed = text.trim();
  const balanceMatch = /^([\d.]+)\s*ETH/.exec(trimmed);
  const nonceMatch = /(\d+)\s*$/.exec(trimmed);
  if (!balanceMatch || !nonceMatch) {
    throw new Error(`unexpected wallet subtitle format: "${trimmed}"`);
  }
  return { balanceEth: Number(balanceMatch[1]), nonce: Number(nonceMatch[1]) };
}

test.describe.serial("UI-C ウォレット送金・操作エッジの連鎖シナリオ", () => {
  let recipientWorkbenchId = "";
  let recipientAddress = "";
  let senderBefore = { balanceEth: 0, nonce: 0 };
  let recipientBefore = { balanceEth: 0, nonce: 0 };

  test.afterAll(async ({ browser }) => {
    // UI-C-02 で追加した受け取り用ワークベンチの後始末
    // (commands-workbench.spec.ts の afterAll と同じ考え方。追加したまま
    // 残すと、以後のテスト実行でキャンバス上のグリッド位置が右・下へ
    // ずれ続け、操作パネルのビューポート越境(OPERATION_PANEL_VIEWPORT
    // 参照)が再発しやすくなる)。
    // browser.newPage() は test.use({ viewport }) を引き継がないため、
    // 明示的に同じビューポートを指定する(既定のDesktop Chromeプリセット
    // だとカードが表示範囲外になり削除ボタンをクリックできないことがある)。
    // 削除ボタンの出現待ち・クリック後の消滅待ちのロジックは
    // support/cleanup.ts に集約している(Issue #233。競合状態で後始末が
    // 無効化されうる問題への対応)。
    await cleanupRemovableCards(browser, [recipientWorkbenchId], {
      timeoutMs: ENTITY_APPEAR_TIMEOUT_MS,
      viewport: OPERATION_PANEL_VIEWPORT,
    });
  });

  test("UI-C-01: ウォレットカードに残高と nonce が表示される", async ({ page }) => {
    await test.step(
      "compose のワークベンチ（プリセットウォレット持ち）が稼働している",
      async () => {
        // globalSetup が ensureChainRunning() 済みであることの前提確認
        // (実際のカード出現確認は後続ステップで行う)。
      },
    );

    let senderAddress = "";
    await test.step(
      "ウォレットカードが表示され、ETH 残高と nonce が表示される",
      async () => {
        await page.goto("/");
        senderAddress = await ownershipEdgeWalletAddress(page, STATIC_WORKBENCH_ID);
        await expect(page.getByTestId(`wallet-card-${senderAddress}`)).toBeVisible({
          timeout: ENTITY_APPEAR_TIMEOUT_MS,
        });
        const stats = await readWalletStats(page, senderAddress);
        // EL_PREMINE_COUNT=8(values.env)によりこのプリセットウォレットは
        // genesisでプリファンド済みなので残高は必ず正。
        expect(stats.balanceEth).toBeGreaterThan(0);
        expect(stats.nonce).toBeGreaterThanOrEqual(0);
      },
    );

    await test.step(
      "ワークベンチ → ウォレットの所有エッジが描画される",
      async () => {
        await expect(
          page.locator(`[data-id^="own-${STATIC_WORKBENCH_ID}-0x"]`),
        ).toHaveCount(1);
      },
    );
  });

  test("UI-C-02: 送金操作で tx が流れ、残高・nonce が変化する", async ({ page }) => {
    await page.goto("/");
    const senderAddress = await ownershipEdgeWalletAddress(page, STATIC_WORKBENCH_ID);

    await test.step(
      "（準備）送金先となる別ウォレットを持つワークベンチを追加する",
      async () => {
        const recipient = await addWorkbenchAndGetWallet(page, "e2e-ui-c-recipient");
        recipientWorkbenchId = recipient.workbenchId;
        recipientAddress = recipient.address;
      },
    );

    senderBefore = await readWalletStats(page, senderAddress);
    recipientBefore = await readWalletStats(page, recipientAddress);

    await test.step(
      "ワークベンチカードの操作ボタンで操作パネルを開く",
      async () => {
        // submitTransfer が openOperationPanel を内包するため、次のステップ
        // (フォーム入力・実行)とまとめて実施する。ここではシナリオの
        // 箇条書きどおりステップとして明示するだけに留める。
      },
    );

    await test.step(
      "送金タブで宛先（別ウォレット）と金額を入力して実行する",
      async () => {
        await submitTransfer(page, STATIC_WORKBENCH_ID, {
          to: recipientAddress,
          amount: "1",
        });
      },
    );

    await test.step(
      "操作パネルに保留中の表示が出る（またはトーストで受付が伝わる）",
      async () => {
        await expect(
          page.getByTestId(`infra-card-operate-${STATIC_WORKBENCH_ID}`),
        ).toHaveAttribute("aria-busy", "true");
      },
    );

    await test.step("しばらく待つと送金元ウォレットの nonce が増える", async () => {
      await expect
        .poll(async () => (await readWalletStats(page, senderAddress)).nonce, {
          timeout: OPERATION_EFFECT_TIMEOUT_MS,
        })
        .toBeGreaterThan(senderBefore.nonce);
    });

    await test.step("宛先ウォレットの残高が増える", async () => {
      await expect
        .poll(
          async () => (await readWalletStats(page, recipientAddress)).balanceEth,
          { timeout: OPERATION_EFFECT_TIMEOUT_MS },
        )
        .toBeGreaterThan(recipientBefore.balanceEth);
    });

    await test.step(
      "送金元ウォレットカードに tx チップ（wallet-tx-chip-<hash>）が現れる",
      async () => {
        await expect(
          page
            .getByTestId(`wallet-card-${senderAddress}`)
            .locator('[data-testid^="wallet-tx-chip-"]'),
        ).not.toHaveCount(0, { timeout: OPERATION_EFFECT_TIMEOUT_MS });
      },
    );
  });

  test("UI-C-07: ワークベンチ → ノードの操作エッジが観測される", async ({ page }) => {
    expect(recipientAddress, "UI-C-02 must have run first").toBeTruthy();
    await page.goto("/");

    await test.step("ワークベンチから任意の操作（送金等）を実行する", async () => {
      await submitTransfer(page, STATIC_WORKBENCH_ID, {
        to: recipientAddress,
        amount: "1",
      });
    });

    await test.step(
      "ワークベンチ → RPC 接続先ノードの操作パルスエッジが一時的に描画される（揮発性。実行直後に観測する）",
      async () => {
        // ロギングプロキシは中継する全RPC呼び出し(読み取り含む)を観測して
        // operationObservedを配信する(operation-observer.ts)。cast sendは
        // nonce取得・gas見積り・送信・receipt待ちポーリング等、複数回の
        // RPC呼び出しを操作の実行中(数秒間)にわたって行うため、送信後に
        // パルスエッジの出現をOPERATION_EFFECT_TIMEOUT_MS以内で待てば
        // 十分観測できる(docs/worklog/issue-201.md 設計メモ参照)。
        await expect(
          page.locator(`[data-id^="op-${STATIC_WORKBENCH_ID}=>"]`),
        ).not.toHaveCount(0, { timeout: OPERATION_EFFECT_TIMEOUT_MS });
      },
    );

    await test.step(
      "常設の「操作先」エッジがワークベンチ → 接続先ノードに描画されている",
      async () => {
        await expect(
          page.locator(`[data-id="optarget-${STATIC_WORKBENCH_ID}"]`),
        ).toHaveCount(1);
      },
    );
  });
});
