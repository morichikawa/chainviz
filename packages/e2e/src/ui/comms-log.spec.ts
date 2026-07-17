// 通信ログパネル（UI-LOG-01〜04。Issue #317）。
// packages/e2e/SCENARIOS.md「通信ログ（UI-LOG）」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { SLOT_DURATION_MS } from "../helpers/slot-time.js";
import {
  OPERATION_EFFECT_TIMEOUT_MS,
  OPERATION_PANEL_VIEWPORT,
  STATIC_WORKBENCH_ID,
  addWorkbenchAndGetWallet,
  submitTransfer,
} from "./support/operations.js";

// UI-LOG-02 が操作パネルを開いて送金するため、既定より大きいビューポートを
// 使う（他の操作系スペックと同じ理由。support/operations.ts 参照）。
test.use({ viewport: OPERATION_PANEL_VIEWPORT });

/**
 * ブロック進行を待つ上限。`chain-ribbon.spec.ts` の
 * `RIBBON_TILE_TIMEOUT_MS` と同じ考え方（次スロットまでの slot 比例分 +
 * 固定オーバーヘッド）。
 */
const NEXT_BLOCK_TIMEOUT_MS = SLOT_DURATION_MS * 3 + 20_000;

function openCommsLogPanel(page: Page) {
  return page.getByTestId("canvas-toolbar-comms-log").click();
}

function commsLogEntriesOf(page: Page, category: string) {
  return page.locator(`[data-testid="comms-log-entry"][data-category="${category}"]`);
}

test("UI-LOG-01: ツールバーのトグルボタン・Escでパネルが開閉する", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByTestId("canvas-toolbar-comms-log");
  await expect(toggle).toBeVisible();

  await test.step("押すとパネルが開き、ボタンが押下状態になる", async () => {
    await toggle.click();
    await expect(page.getByTestId("comms-log-view")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("Escで閉じる", async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("side-panel")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("トグル再押下でも開閉する", async () => {
    await toggle.click();
    await expect(page.getByTestId("side-panel")).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("side-panel")).toHaveCount(0);
  });
});

test("UI-LOG-02: 送金操作の実行後に「操作（RPC）」エントリが記録される", async ({ page }) => {
  await page.goto("/");
  await openCommsLogPanel(page);

  const before = await commsLogEntriesOf(page, "operation").count();

  await test.step("ワークベンチカードから送金操作を実行する", async () => {
    const { address } = await addWorkbenchAndGetWallet(page, "comms-log-sender");
    await submitTransfer(page, STATIC_WORKBENCH_ID, { to: address, amount: "0.001" });
  });

  await test.step("操作（RPC）カテゴリのエントリが新たに現れる", async () => {
    await expect
      .poll(async () => commsLogEntriesOf(page, "operation").count(), {
        timeout: OPERATION_EFFECT_TIMEOUT_MS,
      })
      .toBeGreaterThan(before);

    // 送金操作は送金呼び出し後にレシート待ちで eth_getBlockByNumber /
    // eth_getTransactionReceipt を複数回ポーリングするため、それらの方が
    // タイムスタンプが新しく一覧の先頭に来る。先頭固定ではなく、操作
    // カテゴリの中に eth_sendRawTransaction を含むエントリが存在すること
    // を確認する（Issue #317 QA差し戻し）。
    const sendRawTxEntries = commsLogEntriesOf(page, "operation").filter({
      hasText: "eth_sendRawTransaction",
    });
    await expect(sendRawTxEntries.first()).toBeVisible();
  });
});

test("UI-LOG-03: ブロック進行で「ブロック受信」エントリが増える", async ({ page }) => {
  await page.goto("/");
  await openCommsLogPanel(page);

  // ブロック生成直後は内部API観測（engine_newPayloadV4 等）がブロック
  // エントリよりさらに新しいタイムスタンプで記録されることがあり、
  // 全カテゴリ横断で見た「一覧の絶対先頭」が block になるとは限らない
  // （Issue #317 QA差し戻し）。そのため「新しいものが上」の検証は
  // block カテゴリ内の相対順序（新しいブロックエントリが、そのカテゴリの
  // 中で以前の先頭より上に来る）に限定する。
  const blockEntries = commsLogEntriesOf(page, "block");
  const before = await blockEntries.count();
  const previousTopBlockText = before > 0 ? await blockEntries.first().textContent() : null;

  await test.step("次のブロックが生成されるまで待つと、ブロックカテゴリのエントリが増える", async () => {
    await expect
      .poll(async () => blockEntries.count(), {
        timeout: NEXT_BLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(before);
  });

  await test.step("新しいブロックエントリがブロックカテゴリの先頭に来る（新しいものが上）", async () => {
    const newTopBlockText = await blockEntries.first().textContent();
    if (previousTopBlockText !== null) {
      expect(newTopBlockText).not.toBe(previousTopBlockText);
    } else {
      // 待機開始時点で block エントリが0件だった場合、比較対象の
      // 「以前の先頭」が無いため差分検証はできない。この場合は
      // 新しい先頭エントリ自体が存在することだけを確認する。
      expect(newTopBlockText).not.toBeNull();
    }
  });
});

test("UI-LOG-04: カテゴリフィルタで該当カテゴリだけに絞られる", async ({ page }) => {
  await page.goto("/");
  await openCommsLogPanel(page);

  // 複数カテゴリが蓄積されるまで、次のブロックが生成されるのを待つ
  // （毎tickで操作・内部API・ブロック・txの複数カテゴリが同時に増える）。
  await expect
    .poll(async () => commsLogEntriesOf(page, "block").count(), {
      timeout: NEXT_BLOCK_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);
  await expect(commsLogEntriesOf(page, "internal").first()).toBeVisible();

  // 操作（RPC）カテゴリのエントリを決定的に発生させる。tick 由来の
  // ブロック/内部API等はモック・実環境どちらでも継続的に生じるが、操作
  // カテゴリはワークベンチから明示的に送金しない限り0件のままになりうる
  // ため、UI-LOG-02 と同様に送金操作を実行してから絞り込みに進む
  // （Issue #317 QA差し戻し: 以前は UI-LOG-02 が作ったワークベンチの
  // ポーリングが偶然この窓に入っていたため見かけ上合格していた）。
  const operationBefore = await commsLogEntriesOf(page, "operation").count();
  await test.step("ワークベンチカードから送金操作を実行し、操作エントリを発生させる", async () => {
    const { address } = await addWorkbenchAndGetWallet(page, "comms-log-filter-sender");
    await submitTransfer(page, STATIC_WORKBENCH_ID, { to: address, amount: "0.001" });
    await expect
      .poll(async () => commsLogEntriesOf(page, "operation").count(), {
        timeout: OPERATION_EFFECT_TIMEOUT_MS,
      })
      .toBeGreaterThan(operationBefore);
  });

  await test.step("「操作」以外の全カテゴリチップを off にする", async () => {
    // 各クリックが実際に反映される（aria-pressed が false になる）ことを
    // 待ってから次のチップへ進む。高速連続クリックだと、反映前に次の
    // 検証へ進んでしまいクリックを取りこぼすことがあった（Issue #317
    // QA差し戻し）。
    for (const category of ["internal", "block", "tx", "peer", "environment"]) {
      const chip = page.getByTestId(`comms-log-filter-${category}`);
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", "false");
    }
  });

  await test.step("表示されるエントリが全て操作（RPC）カテゴリになる", async () => {
    await expect(page.locator('[data-testid="comms-log-entry"]:not([data-category="operation"])')).toHaveCount(0);
    await expect(commsLogEntriesOf(page, "operation").first()).toBeVisible();
  });

  await test.step("off にしたカテゴリを再度 on に戻すと再び表示される（蓄積自体は保たれている）", async () => {
    await page.getByTestId("comms-log-filter-block").click();
    await expect(commsLogEntriesOf(page, "block").first()).toBeVisible();
  });
});
