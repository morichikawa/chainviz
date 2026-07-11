// C層: トークン残高の表示と変化(UI-C-05)。packages/e2e/SCENARIOS.md
// 「C層: トランザクション・ウォレット・コントラクト(UI-C)」節の一部の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// 前提(ChainvizTokenがデプロイ済みでウォレットがトークンを保有している)は
// 他ファイルの結果に依存せず、このテスト自身の「前提」ステップの中で
// ChainvizTokenをデプロイして満たす(他specファイルへの依存を作らない。
// docs/worklog/issue-201.md 設計メモ参照)。送金先は新規に追加したワーク
// ベンチのプリセットウォレット(WalletEntityはワークベンチ所有のウォレット
// のみ追跡されるため。wallet-tracker.ts参照)。

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { cleanupRemovableCards } from "./support/cleanup.js";
import {
  ENTITY_APPEAR_TIMEOUT_MS,
  OPERATION_EFFECT_TIMEOUT_MS,
  OPERATION_PANEL_VIEWPORT,
  STATIC_WORKBENCH_ID,
  addWorkbenchAndGetWallet,
  deployedContractAddresses,
  ownershipEdgeWalletAddress,
  submitCall,
  submitDeploy,
} from "./support/operations.js";

// 操作パネルを開いて送信するため、既定より大きいビューポートを使う
// (support/operations.ts の OPERATION_PANEL_VIEWPORT 参照)。
test.use({ viewport: OPERATION_PANEL_VIEWPORT });

/** トークンチップ(`"<formatted> <symbol>"`。WalletCard.tsx参照)の数量部分を読む。 */
async function readTokenBalance(
  page: Page,
  walletAddress: string,
  tokenAddress: string,
): Promise<number> {
  const text = await page
    .getByTestId(`wallet-token-chip-${walletAddress}-${tokenAddress}`)
    .textContent();
  if (!text) throw new Error(`no token chip for wallet ${walletAddress} / token ${tokenAddress}`);
  const match = /^([\d.]+)/.exec(text.trim());
  if (!match) throw new Error(`unexpected token chip text: "${text}"`);
  return Number(match[1]);
}

let recipientWorkbenchId = "";

test.afterAll(async ({ browser }) => {
  // このテストで追加した受け取り用ワークベンチの後始末
  // (wallet-balance.spec.ts の afterAll と同じ考え方。残すとキャンバス上の
  // グリッド位置が右・下へずれ続け、操作パネルのビューポート越境
  // (OPERATION_PANEL_VIEWPORT 参照)が再発しやすくなる)。
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

test("UI-C-05: トークン残高の表示と変化が見える", async ({ page }) => {
  // デプロイ + transfer の2操作分の反映待ちを含むため、既定の60秒では
  // 他ステップと合わせて余裕が無い。
  test.setTimeout(OPERATION_EFFECT_TIMEOUT_MS * 2 + 30_000);

  await page.goto("/");
  const senderAddress = await ownershipEdgeWalletAddress(page, STATIC_WORKBENCH_ID);

  let recipientAddress = "";
  let tokenAddress = "";

  await test.step(
    "ChainvizToken（ERC20）がデプロイ済みで、ウォレットがトークンを保有している",
    async () => {
      const recipient = await addWorkbenchAndGetWallet(page, "e2e-ui-c-token-recipient");
      recipientWorkbenchId = recipient.workbenchId;
      recipientAddress = recipient.address;

      const before = await deployedContractAddresses(page, senderAddress);
      // 1000 CVZ(decimals=18)をデプロイヤー(senderAddress)へ初期供給する。
      await submitDeploy(page, STATIC_WORKBENCH_ID, {
        catalogKey: "ChainvizToken",
        constructorArgs: { initialSupply: "1000000000000000000000" },
      });
      await expect
        .poll(
          async () => (await deployedContractAddresses(page, senderAddress)).size,
          { timeout: OPERATION_EFFECT_TIMEOUT_MS },
        )
        .toBeGreaterThan(before.size);
      const after = await deployedContractAddresses(page, senderAddress);
      const added = [...after].filter((address) => !before.has(address));
      expect(added).toHaveLength(1);
      tokenAddress = added[0];

      await expect(
        page.getByTestId(`wallet-token-chip-${senderAddress}-${tokenAddress}`),
      ).toBeVisible({ timeout: OPERATION_EFFECT_TIMEOUT_MS });
    },
  );

  const senderTokenBefore = await readTokenBalance(page, senderAddress, tokenAddress);

  await test.step("トークンの transfer をコントラクト呼び出しで実行する", async () => {
    // 100 CVZ をrecipientへ送る。
    await submitCall(page, STATIC_WORKBENCH_ID, {
      contractAddress: tokenAddress,
      functionSignature: "transfer(address,uint256)",
      args: { to: recipientAddress, amount: "100000000000000000000" },
    });
  });

  await test.step(
    "ウォレットカードのトークンチップ（wallet-token-chip-<address>-<contract>）に残高が表示される",
    async () => {
      await expect(
        page.getByTestId(`wallet-token-chip-${recipientAddress}-${tokenAddress}`),
      ).toBeVisible({ timeout: OPERATION_EFFECT_TIMEOUT_MS });
    },
  );

  await test.step(
    "transfer 後、送信側・受信側のトークン残高が変化する",
    async () => {
      await expect
        .poll(() => readTokenBalance(page, senderAddress, tokenAddress), {
          timeout: OPERATION_EFFECT_TIMEOUT_MS,
        })
        .toBeLessThan(senderTokenBefore);
      await expect
        .poll(() => readTokenBalance(page, recipientAddress, tokenAddress), {
          timeout: OPERATION_EFFECT_TIMEOUT_MS,
        })
        .toBeGreaterThan(0);
    },
  );
});
