// A層(インフラ表示, UI-A-01〜UI-A-05)。packages/e2e/SCENARIOS.md「A層:
// インフラ表示(UI-A)」節の実装(docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// カード本体の総数の数え方: `.infra-card` は WalletCard / ContractCard /
// GhostNodeCard も見た目を揃えるために共有しているベースクラスなので
// (それぞれ `infra-card infra-card--wallet` 等を付ける)、これだけでは
// A層(node/workbench)以外のカードまで数えてしまう(実際に稼働中の
// ワークベンチのプリセットウォレットが1枚混ざり、期待の7枚に対し8件
// ヒットする事故を実機実行で確認した)。`InfraNodeCard.tsx` が付ける
// `infra-card--node` / `infra-card--workbench` の種別修飾クラス(node/
// workbench 以外のカードは使わない)で絞り込む。`infra-card-bootnode-*` /
// `infra-card-remove-*` / `infra-card-operate-*` も `infra-card-` で
// 前方一致してしまうため、`data-testid` の前方一致でも数えない
// (docs/worklog/issue-199.md 設計メモ参照)。個別カードは完全一致の
// `getByTestId("infra-card-<entity.id>")` で特定する。

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { serviceEntityId } from "./support/serviceIds.js";

/** collector の A 層ポーリング間隔(`POLL_INTERVAL_MS`, packages/collector/src/index.ts)
 * は 3000ms。初回反映を安全に待つため、その約6.5倍の 20 秒を待ち上限にする。 */
const INFRA_SNAPSHOT_TIMEOUT_MS = 20_000;

const RETH1_ID = serviceEntityId("reth1");
const RETH2_ID = serviceEntityId("reth2");
const BEACON1_ID = serviceEntityId("beacon1");
const WORKBENCH_ID = serviceEntityId("workbench");

const COMPOSE_NODES: ReadonlyArray<{ service: string; clientType: string }> = [
  { service: "reth1", clientType: "reth" },
  { service: "reth2", clientType: "reth" },
  { service: "beacon1", clientType: "lighthouse" },
  { service: "beacon2", clientType: "lighthouse" },
  { service: "validator1", clientType: "lighthouse" },
  { service: "validator2", clientType: "lighthouse" },
];

/** インフラ(node/workbench)カードのみを指すロケータ(wallet/contract/ghost を含まない)。 */
function infraCards(page: Page): Locator {
  return page.locator(".infra-card--node, .infra-card--workbench");
}

/** 現在のページで、compose 起動の全カードが出揃うまで待つ。 */
async function waitForAllCards(page: Page): Promise<void> {
  await expect(infraCards(page)).toHaveCount(COMPOSE_NODES.length + 1, {
    timeout: INFRA_SNAPSHOT_TIMEOUT_MS, // + ワークベンチ
  });
}

/** frontend を開き、compose 起動の全カードが出揃うまで待つ(共通前段)。 */
async function openFrontendWithCards(page: Page): Promise<void> {
  await page.goto("/");
  await waitForAllCards(page);
}

/** React Flow ノードラッパーの inline transform（`translate(Xpx,Ypx)`）を数値へ。 */
async function readNodeTranslate(
  page: Page,
  entityId: string,
): Promise<{ x: number; y: number }> {
  const transform = await page
    .locator(`.react-flow__node[data-id="${entityId}"]`)
    .evaluate((el) => (el as HTMLElement).style.transform);
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform);
  if (!match) {
    throw new Error(`unexpected react-flow node transform: "${transform}"`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

test("UI-A-01: compose の全ノードとワークベンチがカード表示される", async ({
  page,
}) => {
  await test.step(
    "compose 起動の 6 ノード（reth1/reth2/beacon1/beacon2/validator1/validator2）とワークベンチが稼働している",
    async () => {
      // globalSetup が ensureChainRunning() 済みであることの前提確認
      // (実際のカード出現確認は後続ステップで行う)。
    },
  );

  await test.step("frontend を開き、スナップショットの反映を待つ", async () => {
    await openFrontendWithCards(page);
  });

  await test.step("7 枚のカード（infra-card-<stableId>）が表示される", async () => {
    for (const { service } of COMPOSE_NODES) {
      await expect(page.getByTestId(`infra-card-${serviceEntityId(service)}`)).toBeVisible();
    }
    await expect(page.getByTestId(`infra-card-${WORKBENCH_ID}`)).toBeVisible();
  });

  await test.step(
    "reth のカードに実行クライアント、beacon/validator のカードに lighthouse のクライアント種別が表示される",
    async () => {
      for (const { service, clientType } of COMPOSE_NODES) {
        const card = page.getByTestId(`infra-card-${serviceEntityId(service)}`);
        await expect(card.locator(".infra-card__subtitle")).toHaveText(clientType);
      }
    },
  );

  await test.step("ワークベンチのカードには操作ボタンがあり、ノードのカードには無い", async () => {
    await expect(
      page.getByTestId(`infra-card-${WORKBENCH_ID}`).getByTestId(`infra-card-operate-${WORKBENCH_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`infra-card-${RETH1_ID}`).getByTestId(`infra-card-operate-${RETH1_ID}`),
    ).toHaveCount(0);
  });

  await test.step("ブートノードのカードにブートノードバッジが表示される", async () => {
    // reth1/beacon1 は docker-compose.yml で com.chainviz.p2p-role: bootnode。
    // 2つのブートノード両方にバッジが出ること、および非ブートノード(reth2)には
    // 出ないことを確認する。後者を確認しないとバッジが常時表示でも合格して
    // しまい「ブートノード固有の表示」を検証できないため、境界として付ける。
    await expect(
      page.getByTestId(`infra-card-${RETH1_ID}`).getByTestId(`infra-card-bootnode-${RETH1_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`infra-card-${BEACON1_ID}`).getByTestId(`infra-card-bootnode-${BEACON1_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`infra-card-${RETH2_ID}`).getByTestId(`infra-card-bootnode-${RETH2_ID}`),
    ).toHaveCount(0);
  });
});

test("UI-A-02: カードにホバーすると詳細ポップオーバーが出る", async ({ page }) => {
  await openFrontendWithCards(page);
  const card = page.getByTestId(`infra-card-${RETH1_ID}`);
  const popover = card.getByTestId(`infra-popover-${RETH1_ID}`);

  await test.step("ホバー前はポップオーバーが表示されていない", async () => {
    // ポップオーバーは hovered 状態でのみ条件レンダリングされる
    // (InfraNodeCard.tsx の `{hovered && <InfraPopover .../>}`)。ホバーで
    // 「出現する」ことを検証するには、ホバー前は存在しないことが前提になる。
    await expect(popover).toHaveCount(0);
  });

  await test.step("reth1 のカードにマウスホバーする", async () => {
    await card.hover();
  });

  await test.step("ポップオーバーに IP アドレスが表示される", async () => {
    await expect(popover).toBeVisible();
    // IP アドレスの文言(field.ip)自体は言語別だが、値そのものは
    // ドット区切りの数値表記なので言語に依存せず検証できる。
    await expect(popover.locator(".infra-field__value").first()).toHaveText(
      /^\d+\.\d+\.\d+\.\d+$/,
    );
  });

  await test.step("ホバーを外すとポップオーバーが消える", async () => {
    await page.mouse.move(0, 0);
    await expect(popover).toHaveCount(0);
  });
});

test("UI-A-03: 言語を切り替えると文言が変わり、リロード後も保持される", async ({
  page,
}) => {
  await openFrontendWithCards(page);
  const title = page.locator(".app__title");
  const addNodeButton = page.getByTestId("canvas-toolbar-add-node");
  const toggle = page.getByTestId("language-toggle");

  await expect(title).toHaveText("chainviz — インフラ可視化");
  await expect(addNodeButton).toContainText("ノードを追加");

  await test.step("言語トグルを押して英語に切り替える", async () => {
    await toggle.click();
  });

  await test.step("ヘッダのタイトル・ツールバーの文言が英語になる", async () => {
    await expect(title).toHaveText("chainviz — Infrastructure");
    await expect(addNodeButton).toContainText("Add node");
  });

  await test.step("ページをリロードする", async () => {
    await page.reload();
  });

  await test.step("英語のまま表示される（localStorage に保持）", async () => {
    await expect(title).toHaveText("chainviz — Infrastructure");
    await expect(addNodeButton).toContainText("Add node");
  });

  await test.step("もう一度トグルを押すと日本語に戻る", async () => {
    await page.getByTestId("language-toggle").click();
    await expect(title).toHaveText("chainviz — インフラ可視化");
  });
});

test("UI-A-04: カードのドラッグ配置がリロード後も保持される", async ({ page }) => {
  await openFrontendWithCards(page);
  const nameHandle = page.getByTestId(`infra-card-${RETH1_ID}`).locator(".infra-card__name");

  const before = await readNodeTranslate(page, RETH1_ID);
  let afterDrag: { x: number; y: number } = before;

  await test.step("reth1 のカードを別の位置へドラッグする", async () => {
    const box = await nameHandle.boundingBox();
    if (!box) throw new Error("reth1 card name element has no bounding box");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 複数ステップで移動させ、React Flow のドラッグ判定(pointermove)が
    // 確実に発火するようにする。
    await page.mouse.move(startX + 220, startY + 160, { steps: 15 });
    await page.mouse.up();
    // ドラッグ操作自体がステップの内容なので、ここで「実際に位置が動いた」
    // ことまで確認してから次のステップ（リロード）に進む。
    await expect
      .poll(async () => {
        afterDrag = await readNodeTranslate(page, RETH1_ID);
        return Math.abs(afterDrag.x - before.x) + Math.abs(afterDrag.y - before.y);
      })
      .toBeGreaterThan(5);
  });

  await test.step("ページをリロードする", async () => {
    await page.reload();
    await waitForAllCards(page);
  });

  await test.step(
    "reth1 のカードがドラッグ後の位置に表示される（localStorage に保持）",
    async () => {
      const afterReload = await readNodeTranslate(page, RETH1_ID);
      expect(Math.abs(afterReload.x - afterDrag.x)).toBeLessThan(1);
      expect(Math.abs(afterReload.y - afterDrag.y)).toBeLessThan(1);
      // 元の位置とは明確に異なっていること。
      expect(
        Math.abs(afterReload.x - before.x) + Math.abs(afterReload.y - before.y),
      ).toBeGreaterThan(5);
    },
  );
});

test("UI-A-05: 用語のインライン解説が表示される", async ({ page }) => {
  await openFrontendWithCards(page);
  const card = page.getByTestId(`infra-card-${RETH1_ID}`);
  const term: Locator = card.getByTestId("glossary-term-container");
  const popover: Locator = card.getByTestId("glossary-popover-container");

  await test.step("ホバー前は用語ポップオーバーが表示されていない", async () => {
    // 用語ポップオーバーも open 状態でのみ条件レンダリングされる
    // (GlossaryTerm.tsx の `{open && ...}`)。ホバーで「出現する」ことを
    // 検証するための前提として、ホバー前は存在しないことを確認する。
    await expect(popover).toHaveCount(0);
  });

  await test.step("カード上の用語（例: カード種別の「コンテナ」）にホバーする", async () => {
    await term.hover();
  });

  await test.step("用語ポップオーバーに用語名と定義文が表示される", async () => {
    await expect(popover).toBeVisible();
    await expect(popover.locator(".glossary-popover__name")).toHaveText("コンテナ");
    await expect(popover.locator(".glossary-popover__definition")).not.toBeEmpty();
  });
});
