// 操作: ノードの追加・削除(UI-CMD-01〜04)。packages/e2e/SCENARIOS.md「操作:
// ノード/ワークベンチの追加・削除(UI-CMD)」節の実装(docs/ARCHITECTURE.md
// §8.4 の記法規約に従う)。
//
// UI-CMD-01→02→03 は「01 で追加したノードを 02 で検証し、03 で削除する」と
// いう前提の連鎖(SCENARIOS.md に明記)。playwright.config.ts は既に
// fullyParallel: false / workers: 1 で全体が直列実行されるが、この3件が
// 状態を引き継ぐ意図を明示するため test.describe.serial でグルーピングし、
// 追加したノードの entity id をモジュールスコープの変数で引き継ぐ
// (docs/worklog/issue-200.md 設計メモ参照)。UI-CMD-04(compose起動ノードは
// 削除ボタンが無い)はこの連鎖と無関係な独立シナリオとして同じファイルの
// 末尾に置く。

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { serviceEntityId } from "./support/serviceIds.js";

/**
 * addNode で追加した reth+beacon ペアがカードとして出現するまでの待ち上限。
 * 既存プロトコル層テスト(commands.test.ts)が同じ観測(A層ポーリング。
 * POLL_INTERVAL_MS=3000)に対して timeoutMs: 30_000 で安定して通っている
 * 実績値をそのまま踏襲する。
 */
const ADD_NODE_CARD_TIMEOUT_MS = 30_000;

/**
 * compose 起動の静的ノード数（reth1/reth2/beacon1/beacon2/validator1/
 * validator2。infra-display.spec.ts の COMPOSE_NODES と同じ前提）。
 * 「追加前のベースライン」を数える前に、初回スナップショットの反映を
 * 待つための目安として使う（未反映のまま数えると 0 件のまま addNode の
 * 差分を取ってしまい、実際に確認済みの失敗として再現した）。
 */
const BASELINE_NODE_COUNT = 6;
/** A層ポーリング間隔(3000ms)を根拠に、初回反映待ちの上限を20秒とする(#199と同じ考え方)。 */
const INFRA_SNAPSHOT_TIMEOUT_MS = 20_000;

const RETH1_ID = serviceEntityId("reth1");

/** インフラ(node)カードのみを指すロケータ(ワークベンチ/ウォレット等を含まない)。 */
function nodeCards(page: Page): Locator {
  return page.locator(".infra-card--node");
}

/** 現在表示されているノードカードの entity id 集合(`infra-card-` 接頭辞を除いた値)。 */
async function currentNodeIds(page: Page): Promise<Set<string>> {
  const testIds = await nodeCards(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid") ?? ""),
  );
  return new Set(
    testIds.map((testId) => testId.replace(/^infra-card-/, "")),
  );
}

/** 生成中のゴーストカード(種類を問わない)を指すロケータ。 */
function anyGhostCard(page: Page): Locator {
  return page.locator('[data-testid^="ghost-card-"]');
}

test.describe.serial("UI-CMD ノード追加・削除の連鎖シナリオ", () => {
  /** UI-CMD-01 で追加した reth/beacon の entity id。02/03 が引き継ぐ。 */
  let addedRethId = "";
  let addedBeaconId = "";

  test.afterAll(async ({ browser }) => {
    // UI-CMD-03 が失敗して削除できなかった場合の後始末(残存コンテナを
    // 残さない。commands.test.ts の afterAll と同じ考え方)。
    if (!addedRethId) return;
    const page = await browser.newPage();
    try {
      await page.goto("/");
      const removeButton = page.getByTestId(`infra-card-remove-${addedRethId}`);
      if ((await removeButton.count()) > 0) {
        await removeButton.click();
      }
    } finally {
      await page.close();
    }
  });

  test("UI-CMD-01: ノード追加ボタンで reth+beacon ペアが追加される", async ({
    page,
  }) => {
    await page.goto("/");
    // ベースラインを数える前に、compose 起動の6ノードが出揃うまで待つ
    // (未反映のまま数えると addNode 後の差分判定を誤る)。
    await expect(nodeCards(page)).toHaveCount(BASELINE_NODE_COUNT, {
      timeout: INFRA_SNAPSHOT_TIMEOUT_MS,
    });
    const before = await currentNodeIds(page);

    await test.step("ツールバーの「ノード追加」ボタンを押す", async () => {
      await page.getByTestId("canvas-toolbar-add-node").click();
    });

    await test.step(
      "押した直後にゴーストカード（ghost-card-<commandId>）が現れる（即時フィードバック。Issue #102）",
      async () => {
        // addNode は reth(EL) と beacon(CL) の 2 枚のゴーストを生む
        // (frontend useCommands.ts の dispatch)。ボタンを 1 回だけ押した前提
        // (Issue #220 の連打防止は未実装)なので、ゴーストはちょうど 2 枚。
        // 件数を固定しておくことで、コマンドの二重発行が混入した場合(4 枚に
        // なる)を早期に検知できる。
        await expect(anyGhostCard(page)).toHaveCount(2);
        await expect(anyGhostCard(page).first()).toBeVisible();
      },
    );

    await test.step(
      "しばらく待つと新しい reth と beacon のカードが実体として現れ、ゴーストカードは消える",
      async () => {
        await expect(nodeCards(page)).toHaveCount(before.size + 2, {
          timeout: ADD_NODE_CARD_TIMEOUT_MS,
        });
        const after = await currentNodeIds(page);
        const added = [...after].filter((entityId) => !before.has(entityId));
        expect(added).toHaveLength(2);

        for (const entityId of added) {
          const subtitle = await page
            .getByTestId(`infra-card-${entityId}`)
            .locator(".infra-card__subtitle")
            .textContent();
          if (subtitle === "reth") addedRethId = entityId;
          else if (subtitle === "lighthouse") addedBeaconId = entityId;
        }
        expect(addedRethId, "added reth card must be identified").toBeTruthy();
        expect(addedBeaconId, "added beacon card must be identified").toBeTruthy();

        await expect(anyGhostCard(page)).toHaveCount(0);
      },
    );

    await test.step("新カードには新着ハイライトが付く（Issue #123）", async () => {
      await expect(page.getByTestId(`infra-card-${addedRethId}`)).toHaveClass(
        /infra-card--new/,
      );
      await expect(page.getByTestId(`infra-card-${addedBeaconId}`)).toHaveClass(
        /infra-card--new/,
      );
    });
  });

  test("UI-CMD-02: 追加したノードが既存ネットワークにエッジで繋がる", async ({
    page,
  }) => {
    expect(addedBeaconId, "UI-CMD-01 must have run first").toBeTruthy();

    await test.step("UI-CMD-01 でノードを追加した直後", async () => {
      await page.goto("/");
      await expect(page.getByTestId(`infra-card-${addedBeaconId}`)).toBeVisible();
    });

    await test.step(
      "追加された beacon と既存ノードのあいだにピアエッジ（または接続確立中エッジ）が描画される",
      async () => {
        await expect(
          page.locator(
            `[data-id^="peer-"][data-id*="${addedBeaconId}"]`,
          ),
        ).not.toHaveCount(0, { timeout: ADD_NODE_CARD_TIMEOUT_MS });
      },
    );
  });

  test("UI-CMD-03: 追加したノードは削除ボタンで消える", async ({ page }) => {
    expect(addedRethId, "UI-CMD-01 must have run first").toBeTruthy();

    await test.step("UI-CMD-01 で追加したノードが表示されている", async () => {
      await page.goto("/");
      await expect(page.getByTestId(`infra-card-${addedRethId}`)).toBeVisible();
      await expect(page.getByTestId(`infra-card-${addedBeaconId}`)).toBeVisible();
    });

    await test.step(
      "追加した reth のカードの削除ボタン（infra-card-remove-<id>）を押す",
      async () => {
        await page.getByTestId(`infra-card-remove-${addedRethId}`).click();
      },
    );

    await test.step("reth と対の beacon のカードが両方ともキャンバスから消える", async () => {
      await expect(page.getByTestId(`infra-card-${addedRethId}`)).toHaveCount(
        0,
        { timeout: ADD_NODE_CARD_TIMEOUT_MS },
      );
      await expect(page.getByTestId(`infra-card-${addedBeaconId}`)).toHaveCount(
        0,
      );
    });

    // 次のテスト・afterAll で誤って再削除しないようクリアする。
    addedRethId = "";
    addedBeaconId = "";
  });
});

test("UI-CMD-04: compose 起動のノードには削除ボタンが無い", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId(`infra-card-${RETH1_ID}`)).toBeVisible();

  await test.step(
    "reth1（compose 起動、removable でない）のカードに削除ボタンが表示されない（Issue #103）",
    async () => {
      await expect(
        page.getByTestId(`infra-card-${RETH1_ID}`).getByTestId(`infra-card-remove-${RETH1_ID}`),
      ).toHaveCount(0);
    },
  );
});
