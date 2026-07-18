// チェーンリボン（UI-B-05・UI-B-06。Issue #298）。
// packages/e2e/SCENARIOS.md「B層: P2P グラフ（UI-B）」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。

import { expect, test } from "@playwright/test";
import { SLOT_DURATION_MS } from "../helpers/slot-time.js";
import { dispatchHover, dispatchUnhover } from "./support/interactions.js";
import {
  OPERATION_EFFECT_TIMEOUT_MS,
  OPERATION_PANEL_VIEWPORT,
  STATIC_WORKBENCH_ID,
  addWorkbenchAndGetWallet,
  ownershipEdgeWalletAddress,
  submitTransfer,
} from "./support/operations.js";

/**
 * チェーンリボンの初回タイル出現・新規タイル追加を待つ上限。タイルは新ブロック
 * ごと(=1 slot ごと)に増えるため、`p2p-graph.spec.ts` の
 * `BLOCK_PULSE_TIMEOUT_MS` と同じ考え方で「次スロットまでの slot 比例分 +
 * コールドスタック等の固定オーバーヘッド」で構成する。slot time は
 * `helpers/slot-time.ts` が values.env から導出する単一の値を使う
 * (slot=2秒で約26秒、slot=12秒で約56秒)。
 */
const RIBBON_TILE_TIMEOUT_MS = SLOT_DURATION_MS * 3 + 20_000;

/**
 * タイル本体（`chain-ribbon-tile-<hash>`）を選ぶセレクタ。単純に
 * `[data-testid^="chain-ribbon-tile-"]` だけだと、tx 件数バッジの testid
 * （`chain-ribbon-tile-tx-<hash>`）も同じ接頭辞にマッチしてしまい、
 * バッジを子に持つタイル（tx を含むブロック）が対象だと `.last()` が
 * タイル本体ではなくバッジ要素を返すことがある（バッジは DOM 上でタイル
 * 本体より後に現れるため）。タイル本体だけが持つ `data-connected-to-previous`
 * 属性で絞り込み、バッジを除外する。
 */
const CHAIN_RIBBON_TILE_SELECTOR =
  '[data-testid^="chain-ribbon-tile-"][data-connected-to-previous]';

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
      const firstTile = page.locator(CHAIN_RIBBON_TILE_SELECTOR).first();
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
      const tile = page.locator(CHAIN_RIBBON_TILE_SELECTOR).last();
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

  await test.step(
    "マウスをタイルからポップオーバーの「親ブロック」行まで実際に移動させても開いたままで、直前タイルの強調が持続する（Issue #351）",
    async () => {
      // タイルはこの時点で表示窓（既定ズームでキャンバス初期表示範囲内）に
      // 収まっているため、UI-D-03（Issue #346）で判明した「初期ビューポート
      // 外に配置されうるカードは hover() が失敗しうる」制約に当たらない。
      // `Locator.hover()`（座標ベースだが対象が他要素に覆われず操作可能に
      // なるまで待って実行される）を連続して使う。生の `page.mouse.move`
      // だと、経路上にある無関係なフィールド（例:「ブロック番号」の
      // GlossaryTerm）が一瞬開くポップオーバーに目的地が遮られたまま
      // イベントだけ発行してしまい、実機検証で不安定になることを確認した
      // （docs/worklog/issue-351.md）。`hover()` は遮蔽が解消するまで
      // 自動リトライするため、これを避けられる。
      const tile = page.locator(CHAIN_RIBBON_TILE_SELECTOR).last();
      const hash = (await tile.getAttribute("data-testid"))?.replace(
        "chain-ribbon-tile-",
        "",
      );
      if (!hash) throw new Error("chain ribbon tile has no data-testid");
      await tile.hover();
      const popover = page.getByTestId(`chain-ribbon-popover-${hash}`);
      await expect(popover).toBeVisible();
      const parentRow = popover.getByTestId(`chain-ribbon-popover-parent-${hash}`);
      await parentRow.hover();

      // 親の完全な hash は `data-parent-hash`（e2e/テスト専用の data 属性）
      // から取得する。表示テキストは `shortHex` で切り詰められており、
      // 実チェーンの本物の hash では逆引きできない。QA差し戻し対応
      // （Issue #351）: ホバー中タイル自身の自己強調は「自分の親ブロック行
      // を見ている間」は抑制されるため、強調されるタイルは常にちょうど
      // 1つ（親タイルが表示窓内なら親タイル、窓外なら「⋯」）になり、
      // 表示窓上の位置に依存しない安定した検証にする。
      const parentHash = await parentRow.getAttribute("data-parent-hash");
      if (!parentHash) throw new Error("parent row has no data-parent-hash");
      const parentTile = page.getByTestId(`chain-ribbon-tile-${parentHash}`);
      const olderIndicator = page.getByTestId("chain-ribbon-older");
      const parentInWindow = (await parentTile.count()) > 0;

      const expectHighlightState = async () => {
        if (parentInWindow) {
          await expect(parentTile).toHaveClass(/chain-ribbon-tile--highlight/);
        } else {
          await expect(olderIndicator).toHaveClass(
            /chain-ribbon-card__older--highlight/,
          );
        }
        await expect(page.locator(".chain-ribbon-tile--highlight")).toHaveCount(
          parentInWindow ? 1 : 0,
        );
      };
      await expectHighlightState();

      // ポップオーバーの遅延クローズ猶予（frontend側 200ms）を超えて行の
      // 上に静止しても閉じない・強調も消えないことを確認する。ここは
      // 「時間が経っても何も起きないこと」の確認のため、状態変化を
      // ポーリング待機する auto-wait アサーションではなく、猶予値に
      // 安全マージンを乗せた固定待機を使う（frontend の
      // HOVER_POPOVER_CLOSE_DELAY_MS=200ms は他の全ポップオーバーに影響する
      // ため変更されない前提の値。docs/worklog/issue-351.md 参照）。
      await page.waitForTimeout(500);
      await expect(popover).toBeVisible();
      await expectHighlightState();

      await page.mouse.move(0, 0);
      await expect(popover).not.toBeVisible();
      await expect(page.locator(".chain-ribbon-tile--highlight")).toHaveCount(0);
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
    let blockHash = "";

    await test.step(
      "UI-C-02（送金操作）等でブロックに取り込まれた tx が最低1件観測でき、そのブロックの blockHash が分かる状態になっている",
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
        // Issue #388: tx がどのブロックに含まれたかは `data-block-hash`
        // （e2e/テスト専用の完全な hash。`WalletCard.tsx` の `TxChip`）から
        // 直接読み取る。以前はチップにホバーして強調されたタイルを逆引きする
        // 構造だったが、これだと「ホバー開始までの実操作」を挟む分だけ表示窓
        // からの流出との競合窓が広がっていた（併走負荷時の flaky の一因。
        // docs/worklog/issue-388.md）。
        blockHash = (await includedChip.getAttribute("data-block-hash")) ?? "";
        if (!blockHash) {
          throw new Error("included tx chip has no data-block-hash");
        }
      },
    );

    const tile = page.getByTestId(`chain-ribbon-tile-${blockHash}`);

    await test.step(
      "対象ブロックのタイル（chain-ribbon-tile-<blockHash>）が表示窓内に表示されるまで待つ",
      async () => {
        // include チップが観測できた時点で、対象ブロックは collector から
        // 見て最新（block の entityAdded は対応する tx の included 更新より
        // 先に配信される。ARCHITECTURE.md §10.4）ため、ここでの待ちは通常
        // 描画反映のミリ秒オーダーの遅延のみ。上限は「タイルが1件も無い
        // 状態からの初回描画」と同じ最悪ケースを想定した既存の
        // `RIBBON_TILE_TIMEOUT_MS` をそのまま流用する（新しい定数を増やさず、
        // 表示窓の前提: 表示件数8・観測順序は ARCHITECTURE.md §10.6 参照）。
        await expect(tile).toBeVisible({ timeout: RIBBON_TILE_TIMEOUT_MS });
      },
    );

    await test.step(
      "チェーンリボンで、tx を含むブロックのタイルに対応する tx チップにホバーすると、そのタイルがちょうど1件だけ強調される",
      async () => {
        // 実マウス座標ではなく合成イベントでホバーする（Issue #388）。実マウス
        // 座標に紐づくホバーは、負荷時の頻繁な再描画で要素がポインタの下から
        // 動くと `mouseleave` が発火して強調が落ちる（併走 flaky の一因。
        // ARCHITECTURE.md §10.6）。合成イベントはポインタ位置に依存しない
        // ため、再描画があっても落ちない。ビューポート内へ収めるための
        // Fit View 操作もこの経路では不要（React Flow はビューポート外の
        // ノードも DOM に描画するため）。
        const chip = page
          .getByTestId(`wallet-card-${senderAddress}`)
          .locator(`[data-testid^="wallet-tx-chip-"][data-block-hash="${blockHash}"]`);
        await dispatchHover(chip);
        await expect(tile).toHaveClass(/chain-ribbon-tile--highlight/);
        // 二重強調（他のタイルまで強調されてしまう回帰）が無いことを、
        // #351 の教訓に倣い明示的に確認する。
        await expect(page.locator(".chain-ribbon-tile--highlight")).toHaveCount(1);

        await dispatchUnhover(chip);
        await expect(page.locator(".chain-ribbon-tile--highlight")).toHaveCount(0);
      },
    );

    await test.step(
      "そのタイルにホバーすると、そのブロックの tx に関わったウォレット/コントラクトカードにハイライトクラス（infra-card--ribbon-highlight）が付く",
      async () => {
        await dispatchHover(tile);
        await expect(page.getByTestId(`wallet-card-${senderAddress}`)).toHaveClass(
          /infra-card--ribbon-highlight/,
        );
      },
    );

    await test.step("ホバーを外すとハイライトが消える", async () => {
      await dispatchUnhover(tile);
      await expect(page.getByTestId(`wallet-card-${senderAddress}`)).not.toHaveClass(
        /infra-card--ribbon-highlight/,
      );
    });
  } finally {
    // 追加した受け取り用ワークベンチの後始末（wallet-balance.spec.ts と
    // 同じ考え方。残すと以後のテスト実行でグリッド位置がずれ続ける）。実
    // クリックのため、React Flow のキャンバス変換でボタンがビューポート外に
    // 押し出されていても操作できるよう Fit View（実クリック）を直前に挟む
    // （以前はホバー経路の直前にあったが、dispatch 化でホバー側は不要になり、
    // 実クリックを伴うこの後始末の直前へ移した。Issue #388）。
    if (recipientWorkbenchId) {
      await page.click(".react-flow__controls-fitview");
      const removeButton = page.getByTestId(
        `infra-card-remove-${recipientWorkbenchId}`,
      );
      if (await removeButton.isVisible().catch(() => false)) {
        await removeButton.click();
      }
    }
  }
});
