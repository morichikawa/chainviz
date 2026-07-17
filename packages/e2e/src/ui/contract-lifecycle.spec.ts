// C層: コントラクトのデプロイ・呼び出し・カタログ外コントラクトの表示
// (UI-C-03・UI-C-04・UI-C-06)。packages/e2e/SCENARIOS.md「C層: トランザ
// クション・ウォレット・コントラクト(UI-C)」節の一部の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// UI-C-03→04は「UI-C-03でデプロイしたCounterコントラクトのアドレスを
// UI-C-04が引き継いで呼び出す」という前提の連鎖(SCENARIOS.mdに明記)。
// test.describe.serial でグルーピングし、デプロイ先アドレスをモジュール
// スコープの変数で引き継ぐ。UI-C-06(カタログ外コントラクトの表示)は
// この連鎖と無関係な独立シナリオとして同じファイルの末尾に置く
// (commands-node.spec.ts の UI-CMD-04 と同じ構成。
// docs/worklog/issue-201.md 設計メモ参照)。

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { deployUncatalogedContractInWorkbench } from "../helpers/docker.js";
import {
  OPERATION_EFFECT_TIMEOUT_MS,
  OPERATION_PANEL_VIEWPORT,
  STATIC_WORKBENCH_ID,
  deployedContractAddresses,
  ownershipEdgeWalletAddress,
  submitCall,
  submitDeploy,
} from "./support/operations.js";
import { dispatchHover } from "./support/interactions.js";

// 操作パネルを開いて送信するため、既定より大きいビューポートを使う
// (support/operations.ts の OPERATION_PANEL_VIEWPORT 参照)。
test.use({ viewport: OPERATION_PANEL_VIEWPORT });

/** `.infra-card--contract` (コントラクトカードのルート要素)のみを指すロケータ。 */
function contractCardIds(page: Page) {
  return page.locator(".infra-card--contract");
}

/**
 * 現在表示されているコントラクトカードの entity id (= address) 集合。
 * `contract-card-<address>` の他に `contract-card-uncataloged-<address>` /
 * `contract-card-everynode-<address>` も同じ prefix で始まる
 * (`infra-display.spec.ts` の infra-card と同じ注意点)ため、ルート要素
 * (`.infra-card--contract`)の testid だけを読む。
 */
async function currentContractAddresses(page: Page): Promise<Set<string>> {
  const testIds = await contractCardIds(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid") ?? ""),
  );
  return new Set(testIds.map((testId) => testId.replace(/^contract-card-/, "")));
}

test.describe.serial("UI-C コントラクトのデプロイ・呼び出しの連鎖シナリオ", () => {
  let counterAddress = "";

  test("UI-C-03: コントラクトをデプロイするとカードが現れる", async ({ page }) => {
    await page.goto("/");
    const deployerAddress = await ownershipEdgeWalletAddress(page, STATIC_WORKBENCH_ID);
    const before = await deployedContractAddresses(page, deployerAddress);

    await test.step(
      "操作パネルのデプロイタブでカタログのコントラクト（例: Counter）を選び、デプロイを実行する",
      async () => {
        await submitDeploy(page, STATIC_WORKBENCH_ID, { catalogKey: "Counter" });
      },
    );

    await test.step(
      "しばらく待つとコントラクトカード（contract-card-<address>）が現れ、カタログの表示名が表示される",
      async () => {
        await expect
          .poll(
            async () => (await deployedContractAddresses(page, deployerAddress)).size,
            { timeout: OPERATION_EFFECT_TIMEOUT_MS },
          )
          .toBeGreaterThan(before.size);
        const after = await deployedContractAddresses(page, deployerAddress);
        const added = [...after].filter((address) => !before.has(address));
        expect(added).toHaveLength(1);
        counterAddress = added[0];

        await expect(page.getByTestId(`contract-card-${counterAddress}`)).toBeVisible();
        await expect(
          page.getByTestId(`contract-card-${counterAddress}`).locator(".infra-card__name"),
        ).toHaveText("Counter");
      },
    );

    await test.step(
      "デプロイ元ウォレット → コントラクトのデプロイエッジが描画される",
      async () => {
        // デプロイエッジの source/id はキャンバス上に実在するウォレットの
        // 表記(= deployerAddress変数、WalletEntity.address)をそのまま使う
        // (entities/deployEdge.ts が、receipt由来の小文字表記の
        // deployerAddressと突き合わせたうえで、実際のウォレットの表記へ
        // 解決してから edge を組み立てるため。Issue #201 で修正)。
        await expect(
          page.locator(`[data-id="deploy-${deployerAddress}-${counterAddress}"]`),
        ).toHaveCount(1);
      },
    );

    await test.step(
      "「全ノードで実行される」ことを示す表記（everynode）がカードにある",
      async () => {
        await expect(
          page.getByTestId(`contract-card-everynode-${counterAddress}`),
        ).toBeVisible();
      },
    );
  });

  test("UI-C-04: コントラクト呼び出しが関数名付きで可視化される", async ({ page }) => {
    expect(counterAddress, "UI-C-03 must have run first").toBeTruthy();
    await page.goto("/");

    await test.step("UI-C-03 でデプロイしたコントラクトが表示されている", async () => {
      await expect(page.getByTestId(`contract-card-${counterAddress}`)).toBeVisible();
    });

    await test.step(
      "操作パネルの呼び出しタブで対象コントラクトと関数（例: increment）を選んで実行する",
      async () => {
        await submitCall(page, STATIC_WORKBENCH_ID, {
          contractAddress: counterAddress,
          functionSignature: "increment()",
        });
      },
    );

    const activity = () => page.getByTestId(`contract-activity-${counterAddress}`);

    await test.step(
      "しばらく待つとコントラクトカードのアクティビティ（contract-activity-chip-*）に関数名付きの呼び出しが現れる",
      async () => {
        const callChip = activity().locator(
          '[data-testid^="contract-activity-chip-"][data-kind="call"]',
        );
        await expect(callChip).toHaveCount(1, { timeout: OPERATION_EFFECT_TIMEOUT_MS });
        await expect(callChip).toContainText("increment");
      },
    );

    await test.step(
      "発生したイベントログがイベント名付きで確認できる（ポップオーバー）",
      async () => {
        const eventChip = activity().locator(
          '[data-testid^="contract-activity-chip-"][data-kind="event"]',
        );
        await expect(eventChip).toHaveCount(1);
        await expect(eventChip).toContainText("Incremented");

        // 実マウス座標の hover() ではなく座標非依存の dispatchHover を使う
        // (node-internals.spec.ts の UI-D-02 と同じ理由。Issue #346)。
        // ContractCard の ActivityChip は useHoverPopover の onMouseEnter で
        // 開閉するため同じ仕組みが使える。
        await dispatchHover(eventChip);
        // contract-activity-chip__popover は PopoverPortal 経由で
        // document.body 直下へ描画される(Issue #245)ため、DOM 上は
        // eventChip の子孫にならない。`eventChip` スコープの locator では
        // 常に解決できないため(Issue #346で判明)、page 直下から特定する。
        await expect(page.locator(".contract-activity-chip__popover")).toBeVisible();
      },
    );
  });
});

test("UI-C-06: カタログ外のコントラクトは「未知のコントラクト」と表示される", async ({
  page,
}) => {
  // docker exec(forge create) + ブロック確定 + collectorの検知を待つため、
  // 既定の60秒では他ステップと合わせて余裕が無い。
  test.setTimeout(OPERATION_EFFECT_TIMEOUT_MS + 30_000);

  await page.goto("/");
  // goto直後はスナップショット反映前で0件のまま読んでしまうことがあるため、
  // 静的ワークベンチのカード出現を待ってから「前」を数える(UI-C-03/04で
  // 既に確認済みの静的インフラの前提を流用する)。
  await expect(page.getByTestId(`infra-card-${STATIC_WORKBENCH_ID}`)).toBeVisible({
    timeout: OPERATION_EFFECT_TIMEOUT_MS,
  });
  const before = await currentContractAddresses(page);

  await test.step(
    "（セットアップとして）ワークベンチコンテナ内でカタログ外のコントラクトを forge create 等でデプロイする（docker exec。検証自体は UI で行う）",
    async () => {
      await deployUncatalogedContractInWorkbench();
    },
  );

  await test.step(
    "コントラクトカードが「未知のコントラクト」表記（contract-card-uncataloged-<address>）で現れる",
    async () => {
      await expect
        .poll(async () => (await currentContractAddresses(page)).size, {
          timeout: OPERATION_EFFECT_TIMEOUT_MS,
        })
        .toBeGreaterThan(before.size);
      const after = await currentContractAddresses(page);
      const added = [...after].filter((address) => !before.has(address));
      expect(added).toHaveLength(1);
      const [address] = added;

      await expect(
        page.getByTestId(`contract-card-uncataloged-${address}`),
      ).toBeVisible();
    },
  );
});
