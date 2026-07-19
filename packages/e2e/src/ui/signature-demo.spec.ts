// 「署名と検証のしくみ」デモ(UI-SIG-01。Issue #402)。
// packages/e2e/SCENARIOS.md「「署名と検証のしくみ」デモ(UI-SIG)」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// このデモは実チェーンから完全に独立した学習用の砂場(`kind:
// "signatureDemo"`)で、送金フォーム内の入口リンクから開ける(操作パネルを
// 開ければよく、チェーンの進行を一切待たずに開始できる。UI-HASH-01の
// チェーンリボン入口と同じ「待たずに開始できる」導線を選ぶ)。操作フロー・
// 状態遷移の細部は
// `packages/frontend/src/crypto-demo/SignatureDemoView.test.tsx`
// (コンポーネントテスト)で検証済みのため、ここでは実ブラウザで入口から
// 最後まで一連の操作が通ることの一度きりの通し確認に絞る。

import { expect, test } from "@playwright/test";
import { OPERATION_PANEL_VIEWPORT, STATIC_WORKBENCH_ID, openOperationPanel } from "./support/operations.js";

test.use({ viewport: OPERATION_PANEL_VIEWPORT });

test("UI-SIG-01: 送金フォームの入口から砂場を開き、改ざん→なりすまし不成立→正しい再署名まで一連の操作が通る", async ({
  page,
}) => {
  await page.goto("/");

  await test.step("frontend を開き、送金フォームの「署名と検証のしくみを試す」リンクを押す", async () => {
    const panel = await openOperationPanel(page, STATIC_WORKBENCH_ID, "transfer");
    await panel.getByTestId("operation-transfer-sig-demo-open").click();
  });

  await test.step("サイドパネルが開き、初期状態は「有効」で表示される", async () => {
    await expect(page.getByTestId("signature-demo")).toBeVisible();
    await expect(page.getByTestId("signature-demo-badge")).toHaveText(
      "有効: 復元されたアドレスが送信者と一致",
    );
    await expect(page.getByTestId("signature-demo-resign-attacker")).toHaveCount(0);
    await expect(page.getByTestId("signature-demo-resign-alice")).toHaveCount(0);
  });

  await test.step("「届いた内容」の金額を書き換える(改ざん)", async () => {
    await page.getByTestId("signature-demo-received-amount").fill("999");
  });

  await test.step("「無効」バッジに変わり、2つの再署名ボタンが現れる", async () => {
    await expect(page.getByTestId("signature-demo-badge")).toHaveText(
      "無効: 復元されたアドレスが送信者と一致しません",
    );
    await expect(page.getByTestId("signature-demo-resign-attacker")).toBeVisible();
    await expect(page.getByTestId("signature-demo-resign-alice")).toBeVisible();
  });

  await test.step("「攻撃者の鍵で署名し直す」を押す", async () => {
    await page.getByTestId("signature-demo-resign-attacker").click();
  });

  await test.step("署名は数学的に正しくなるが、依然「無効」のまま(なりすまし不成立)", async () => {
    await expect(page.getByTestId("signature-demo-badge")).toHaveText(
      "無効: 復元されたアドレスが送信者と一致しません",
    );
    await expect(page.getByTestId("signature-demo-result-attacker")).toBeVisible();
  });

  await test.step("「Alice が署名し直す(正しく送り直す)」を押す", async () => {
    await page.getByTestId("signature-demo-resign-alice").click();
  });

  await test.step("「有効」に戻り、Alice再署名の結果メッセージが表示される", async () => {
    await expect(page.getByTestId("signature-demo-badge")).toHaveText(
      "有効: 復元されたアドレスが送信者と一致",
    );
    await expect(page.getByTestId("signature-demo-result-alice")).toBeVisible();
    await expect(page.getByTestId("signature-demo-resign-attacker")).toHaveCount(0);
  });

  await test.step("「最初に戻す」ボタンを押すと、届いた内容・バッジとも初期状態に戻る", async () => {
    await page.getByTestId("signature-demo-reset").click();
    await expect(page.getByTestId("signature-demo-received-amount")).toHaveValue("1");
    await expect(page.getByTestId("signature-demo-badge")).toHaveText(
      "有効: 復元されたアドレスが送信者と一致",
    );
    await expect(page.getByTestId("signature-demo-result-alice")).toHaveCount(0);
  });
});
