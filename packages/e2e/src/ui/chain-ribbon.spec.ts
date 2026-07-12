// チェーンリボン（UI-B-05・UI-B-06。Issue #298）。
// packages/e2e/SCENARIOS.md「B層: P2P グラフ（UI-B）」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。

import { expect, test } from "@playwright/test";
import {
  OPERATION_EFFECT_TIMEOUT_MS,
  OPERATION_PANEL_VIEWPORT,
  STATIC_WORKBENCH_ID,
  addWorkbenchAndGetWallet,
  ownershipEdgeWalletAddress,
  submitTransfer,
} from "./support/operations.js";

/**
 * チェーンリボンの初回タイル出現・新規タイル追加を待つ上限。
 * `profiles/ethereum/values.env` の `SLOT_DURATION_IN_SECONDS=2` を根拠に、
 * `p2p-graph.spec.ts` の `BLOCK_PULSE_TIMEOUT_MS` と同じ倍率(15倍)を使う
 * （スロット時間を変える場合はこの倍率を保ったまま値を見直すこと）。
 */
const SLOT_DURATION_SECONDS = 2;
const RIBBON_TILE_TIMEOUT_MS = SLOT_DURATION_SECONDS * 1000 * 15;

// UI-B-06 が操作パネルを開いて送金するため、既定より大きいビューポートを
// 使う(support/operations.ts の OPERATION_PANEL_VIEWPORT 参照)。
// test.use() はテスト本体の内側では呼べず(実行時エラー)、モジュール
// トップレベルで呼ぶ必要がある(token-balance.spec.ts 等、既存の全ファイル
// と同じ配置)。UI-B-05 は操作パネルを使わないが、大きいビューポートでも
// アサーションには影響しないため、ファイル単位で適用する。
test.use({ viewport: OPERATION_PANEL_VIEWPORT });

test("UI-B-05: チェーンリボンにブロックが連なって表示される", async ({ page }) => {
  await test.step("チェーンが進行し続けている（数秒ごとに新ブロック）", async () => {
    // globalSetup が再利用する既存スタックは継続稼働中で、チェーンは
    // 常に進行している前提。
  });

  await test.step(
    "frontend を開き、チェーンリボンカード（chain-ribbon-card）が表示されるまで待つ",
    async () => {
      await page.goto("/");
      await expect(page.getByTestId("chain-ribbon-card")).toBeVisible({
        timeout: RIBBON_TILE_TIMEOUT_MS,
      });
    },
  );

  await test.step(
    "チェーンリボンカードにタイル（chain-ribbon-tile-<hash>）が1件以上表示される",
    async () => {
      const firstTile = page.locator('[data-testid^="chain-ribbon-tile-"]').first();
      await expect(firstTile).toBeVisible({ timeout: RIBBON_TILE_TIMEOUT_MS });
    },
  );

  await test.step(
    "しばらく待つと新しいタイルが右端に追加され、ヘッダの最新ブロック番号（chain-ribbon-latest）が増える",
    async () => {
      const latest = page.getByTestId("chain-ribbon-latest");
      const before = await latest.textContent();
      await expect(latest).not.toHaveText(before ?? "", {
        timeout: RIBBON_TILE_TIMEOUT_MS,
      });
    },
  );

  await test.step(
    "タイルにホバーするとポップオーバーが開き、ブロック番号・ハッシュ・親ブロック・時刻が表示される",
    async () => {
      const tile = page.locator('[data-testid^="chain-ribbon-tile-"]').last();
      const hash = (await tile.getAttribute("data-testid"))?.replace(
        "chain-ribbon-tile-",
        "",
      );
      if (!hash) throw new Error("chain ribbon tile has no data-testid");
      await tile.hover();
      const popover = page.getByTestId(`chain-ribbon-popover-${hash}`);
      await expect(popover).toBeVisible();
      await expect(
        popover.getByTestId(`chain-ribbon-popover-parent-${hash}`),
      ).toBeVisible();
    },
  );
});

test("UI-B-06: チェーンリボンのタイルホバーでウォレット/コントラクトカードが連動して光る", async ({
  page,
}) => {
  // このシナリオは「ワークベンチ追加」→「送金tx確定待ち」→「ハイライト
  // 反映待ち」と、それぞれ最大 ENTITY_APPEAR_TIMEOUT_MS/
  // OPERATION_EFFECT_TIMEOUT_MS（いずれも30秒）の待ちを直列に3回重ねうる
  // ため、既定のテストタイムアウト（60秒）だと共有スタックが混雑している
  // 状況（同時に稼働するノード数が多い・他ワークトリーの並行実行がある等）
  // で余裕が無い。p2p-graph.spec.ts の BLOCK_PULSE_TIMEOUT_MS と同じ考え方
  // で、3回分の待ちの合計(90秒)に安全マージンを載せた値へ個別に緩める。
  test.setTimeout(3 * OPERATION_EFFECT_TIMEOUT_MS + 60_000);

  let recipientWorkbenchId = "";

  try {
    let senderAddress = "";
    let includedChipHash = "";

    await test.step(
      "UI-C-02（送金操作）等でブロックに取り込まれた tx が最低1件観測できる状態になっている",
      async () => {
        await page.goto("/");
        // ラベルに実行時刻を含めて一意にする。固定ラベル（他の e2e ファイル
        // が採る方式）だと、この長時間稼働の共有 Docker スタックに対して
        // 同じスペックを繰り返し手動実行しただけでベースラベルが恒久的に
        // 使用済み扱いになり、以後 addWorkbench が毎回 "-2" 等の別IDへ
        // 逃げて `infra-card-<base id>` の待ちがタイムアウトする不安定さが
        // 実際に複数回発生した（docs/worklog/issue-298.md 参照）。
        const { workbenchId, address: recipientAddress } =
          await addWorkbenchAndGetWallet(page, `e2e-ribbon-recipient-${Date.now().toString(36)}`);
        recipientWorkbenchId = workbenchId;
        senderAddress = await ownershipEdgeWalletAddress(page, STATIC_WORKBENCH_ID);
        await submitTransfer(page, STATIC_WORKBENCH_ID, {
          to: recipientAddress,
          amount: "0.001",
        });

        const includedChip = page
          .getByTestId(`wallet-card-${senderAddress}`)
          .locator('[data-testid^="wallet-tx-chip-"][data-status="included"]')
          .first();
        await expect(includedChip).toBeVisible({ timeout: OPERATION_EFFECT_TIMEOUT_MS });
        const testId = await includedChip.getAttribute("data-testid");
        if (!testId) throw new Error("included tx chip has no data-testid");
        includedChipHash = testId.replace("wallet-tx-chip-", "");
      },
    );

    let highlightedTileTestId = "";

    await test.step(
      "チェーンリボンで、tx を含むブロックのタイルにホバーする",
      async () => {
        // まず逆方向（tx チップ → タイル）で、どのタイルが対応するかを特定する。
        // tx hash の testid は送信元・宛先どちらのウォレットの「直近の tx」
        // 一覧にも現れうる（WalletEntity.recentTxHashes は from/to 双方の
        // ウォレットが追跡する）ため、`page.getByTestId` のページ全体検索だと
        // strict mode違反（複数要素ヒット）になる。送信元カードの中だけに
        // 絞り込む。
        const chip = page
          .getByTestId(`wallet-card-${senderAddress}`)
          .getByTestId(`wallet-tx-chip-${includedChipHash}`);
        await chip.hover();
        const highlightedTile = page.locator(".chain-ribbon-tile--highlight");
        await expect(highlightedTile).toHaveCount(1, {
          timeout: OPERATION_EFFECT_TIMEOUT_MS,
        });
        const testId = await highlightedTile.getAttribute("data-testid");
        if (!testId) throw new Error("highlighted chain ribbon tile has no data-testid");
        highlightedTileTestId = testId;

        // ホバーを外して逆方向ハイライトが消えることを確かめてから、
        // 今度は正方向（タイル → カード）の確認へ移る。
        await page.mouse.move(0, 0);
        await expect(page.locator(".chain-ribbon-tile--highlight")).toHaveCount(0);

        await page.getByTestId(highlightedTileTestId).hover();
      },
    );

    await test.step(
      "そのブロックの tx に関わったウォレット/コントラクトカードにハイライトクラス（infra-card--ribbon-highlight）が付く",
      async () => {
        await expect(page.getByTestId(`wallet-card-${senderAddress}`)).toHaveClass(
          /infra-card--ribbon-highlight/,
        );
      },
    );

    await test.step("ホバーを外すとハイライトが消える", async () => {
      await page.mouse.move(0, 0);
      await expect(page.getByTestId(`wallet-card-${senderAddress}`)).not.toHaveClass(
        /infra-card--ribbon-highlight/,
      );
    });
  } finally {
    // 追加した受け取り用ワークベンチの後始末（wallet-balance.spec.ts と
    // 同じ考え方。残すと以後のテスト実行でグリッド位置がずれ続ける）。
    if (recipientWorkbenchId) {
      const removeButton = page.getByTestId(
        `infra-card-remove-${recipientWorkbenchId}`,
      );
      if (await removeButton.isVisible().catch(() => false)) {
        await removeButton.click();
      }
    }
  }
});
