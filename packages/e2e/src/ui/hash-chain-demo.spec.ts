// 「ハッシュのしくみ」デモ（UI-HASH-01。Issue #401）。
// packages/e2e/SCENARIOS.md「「ハッシュのしくみ」デモ（UI-HASH）」節の実装
// （docs/ARCHITECTURE.md §8.4 の記法規約に従う）。
//
// このデモは実チェーンから完全に独立した学習用の砂場（`kind:
// "hashChainDemo"`）で、チェーンリボンカードは常に描画される（タイルが
// 0件でも subtitle 行の常設入口ボタンは表示される）ため、チェーンの進行を
// 一切待たずに開始できる。操作フロー・状態遷移の細部は
// `packages/frontend/src/crypto-demo/HashChainDemoView.test.tsx`
// （コンポーネントテスト）で検証済みのため、ここでは実ブラウザで入口から
// 最後まで一連の操作が通ることの一度きりの通し確認に絞る。

import { expect, test } from "@playwright/test";

test("UI-HASH-01: チェーンリボンの入口から砂場を開き、改ざん→連鎖修復まで一連の操作が通る", async ({
  page,
}) => {
  await page.goto("/");

  await test.step("frontend を開き、チェーンリボンカードの「ハッシュのしくみを試す」ボタンを押す", async () => {
    await expect(page.getByTestId("chain-ribbon-card")).toBeVisible();
    await page.getByTestId("chain-ribbon-hash-demo-open").click();
  });

  await test.step("サイドパネルが開き、3つのブロックがすべて「有効」で表示される", async () => {
    await expect(page.getByTestId("hash-chain-demo")).toBeVisible();
    for (const number of [1, 2, 3]) {
      await expect(page.getByTestId(`hash-chain-demo-badge-${number}`)).toHaveText("有効");
    }
    await expect(page.getByTestId("hash-chain-demo-summary")).toHaveCount(0);
  });

  await test.step("ブロック#1の「データ」欄を書き換える", async () => {
    await page.getByTestId("hash-chain-demo-data-1").fill("Alice → Bob: 999 ETH");
  });

  await test.step("ブロック#2が「無効」になり、「親ハッシュをつなぎ直す」ボタンが現れる。ブロック#3はまだ「有効」のまま", async () => {
    await expect(page.getByTestId("hash-chain-demo-badge-2")).toHaveText(
      "無効: 親ブロックのハッシュと食い違っています",
    );
    await expect(page.getByTestId("hash-chain-demo-relink-2")).toBeVisible();
    await expect(page.getByTestId("hash-chain-demo-badge-3")).toHaveText("有効");
    await expect(page.getByTestId("hash-chain-demo-relink-3")).toHaveCount(0);
  });

  await test.step("ブロック#2の「親ハッシュをつなぎ直す」ボタンを押す", async () => {
    await page.getByTestId("hash-chain-demo-relink-2").click();
  });

  await test.step("ブロック#2は「有効」に戻り、代わりにブロック#3が「無効」になる（連鎖修復）", async () => {
    await expect(page.getByTestId("hash-chain-demo-badge-2")).toHaveText("有効");
    await expect(page.getByTestId("hash-chain-demo-badge-3")).toHaveText(
      "無効: 親ブロックのハッシュと食い違っています",
    );
    await expect(page.getByTestId("hash-chain-demo-relink-3")).toBeVisible();
  });

  await test.step("ブロック#3の「親ハッシュをつなぎ直す」ボタンを押す", async () => {
    await page.getByTestId("hash-chain-demo-relink-3").click();
  });

  await test.step("3つのブロックすべてが「有効」に戻り、まとめメッセージが表示される", async () => {
    for (const number of [1, 2, 3]) {
      await expect(page.getByTestId(`hash-chain-demo-badge-${number}`)).toHaveText("有効");
    }
    await expect(page.getByTestId("hash-chain-demo-summary")).toBeVisible();
  });

  await test.step("「最初に戻す」ボタンを押すと、3つのブロックが最初のデータ・全て有効な状態に戻る", async () => {
    await page.getByTestId("hash-chain-demo-reset").click();
    await expect(page.getByTestId("hash-chain-demo-data-1")).toHaveValue("Alice → Bob: 5 ETH");
    for (const number of [1, 2, 3]) {
      await expect(page.getByTestId(`hash-chain-demo-badge-${number}`)).toHaveText("有効");
    }
    await expect(page.getByTestId("hash-chain-demo-summary")).toHaveCount(0);
  });
});
