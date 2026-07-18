// support/cleanup.ts の Playwright 配線層
// (`removeInfraCardIfPresent` / `cleanupRemovableCards`)に対するユニット
// テスト(Issue #233 のテスト強化)。純粋な `removeCardIfPresent` は
// cleanup.unit.test.ts / cleanup.edge.unit.test.ts で押さえているので、
// ここでは実ブラウザを使わずに Browser / Page / Locator をフェイクして
// 「どの testid をどの timeout で待つか」「ページを開く・閉じるライフ
// サイクル」「複数カードを順に後始末するループの相互影響」を検証する。
//
// フェイクは削除ボタンの waitFor / click の成否だけを制御する。いずれの
// シナリオも waitForRemoved(= Playwright の exp(...).toHaveCount)へ成功
// 到達しないように組み、実 expect マッチャに依存しないようにしている。

import type { Browser, Locator, Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
  cleanupRemovableCards,
  removeInfraCardIfPresent,
} from "./cleanup.js";

/** 削除ボタン Locator のフェイク挙動指定。 */
interface ButtonBehavior {
  /** waitFor（ボタン出現待ち）の結果。resolve=出現、reject=不在。 */
  waitFor: "resolve" | "reject";
  /** click の結果。省略時は resolve。 */
  click?: "resolve" | "reject";
}

interface FakePage {
  page: Page;
  goto: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getByTestId: ReturnType<typeof vi.fn>;
  /** entityId ごとの remove ボタンの waitFor 呼び出し timeout を記録。 */
  waitForTimeouts: Map<string, number>;
  /** click された remove ボタンの testid 列。 */
  clickedTestIds: string[];
  /**
   * `fitCanvasView`(Issue #373)が呼ばれた順序を記録する列。
   * `clickedTestIds` と突き合わせて「削除ボタンのクリックより前に
   * フィットボタンを押しているか」を確認する。
   */
  callOrder: string[];
}

/**
 * entityId → ButtonBehavior のマップから、`infra-card-remove-<id>` を返す
 * フェイク Page を作る。`infra-card-<id>`(カード本体)はループが
 * waitForRemoved に到達しない前提のため、参照されても最低限のスタブを返す。
 */
function makeFakePage(behaviors: Record<string, ButtonBehavior>): FakePage {
  const waitForTimeouts = new Map<string, number>();
  const clickedTestIds: string[] = [];
  const callOrder: string[] = [];

  const getByTestId = vi.fn((testId: string): Locator => {
    const removePrefix = "infra-card-remove-";
    if (testId.startsWith(removePrefix)) {
      const entityId = testId.slice(removePrefix.length);
      const behavior = behaviors[entityId] ?? { waitFor: "reject" };
      const locator = {
        waitFor: vi.fn((opts?: { timeout?: number }) => {
          if (opts?.timeout !== undefined) {
            waitForTimeouts.set(entityId, opts.timeout);
          }
          return behavior.waitFor === "resolve"
            ? Promise.resolve()
            : Promise.reject(new Error(`button not found: ${entityId}`));
        }),
        click: vi.fn(() => {
          clickedTestIds.push(testId);
          callOrder.push(`click:${testId}`);
          return behavior.click === "reject"
            ? Promise.reject(new Error(`click failed: ${entityId}`))
            : Promise.resolve();
        }),
      };
      return locator as unknown as Locator;
    }
    // カード本体 Locator。到達しない想定だが、念のため無害なスタブを返す。
    return {} as unknown as Locator;
  });

  // `fitCanvasView`(Issue #373。support/viewport.ts)が使う
  // `.react-flow__controls-fitview` 用のフェイク Locator。常にクリック
  // 成功として扱う(このテストの主眼は削除フローとの呼び出し順序であり、
  // フィットボタン自体の成否分岐は viewport.unit.test.ts で確認済み)。
  const locator = vi.fn((selector: string): Locator => {
    if (selector === ".react-flow__controls-fitview") {
      return {
        click: vi.fn(() => {
          callOrder.push("fitCanvasView");
          return Promise.resolve();
        }),
      } as unknown as Locator;
    }
    throw new Error(`unexpected locator selector in fake page: ${selector}`);
  });

  const goto = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const page = { goto, close, getByTestId, locator } as unknown as Page;

  return {
    page,
    goto,
    close,
    getByTestId,
    waitForTimeouts,
    clickedTestIds,
    callOrder,
  };
}

function makeFakeBrowser(fakePage: FakePage): {
  browser: Browser;
  newPage: ReturnType<typeof vi.fn>;
} {
  const newPage = vi.fn().mockResolvedValue(fakePage.page);
  const browser = { newPage } as unknown as Browser;
  return { browser, newPage };
}

describe("removeInfraCardIfPresent(Playwright 配線)", () => {
  it("ボタンが不在(waitFor reject)なら click せず正常終了し、正しい testid を timeout 付きで待つ", async () => {
    const fake = makeFakePage({ node1: { waitFor: "reject" } });

    await expect(
      removeInfraCardIfPresent(fake.page, "node1", 4321),
    ).resolves.toBeUndefined();

    expect(fake.getByTestId).toHaveBeenCalledWith("infra-card-remove-node1");
    expect(fake.waitForTimeouts.get("node1")).toBe(4321);
    expect(fake.clickedTestIds).toEqual([]);
  });

  it("ボタン出現後は remove ボタンをクリックする（クリック失敗はそのまま伝播）", async () => {
    const fake = makeFakePage({
      node1: { waitFor: "resolve", click: "reject" },
    });

    await expect(
      removeInfraCardIfPresent(fake.page, "node1", 1000),
    ).rejects.toThrow("click failed: node1");

    // 正しい削除ボタンをクリックしていることを testid で確認。
    expect(fake.clickedTestIds).toEqual(["infra-card-remove-node1"]);
  });

  it(
    "ボタン出現後、削除ボタンをクリックする前に fitCanvasView でビューポートを" +
      "確保する（Issue #373。安全網のクリックがビューポート外へ永久リトライ" +
      "しないようにする対策）",
    async () => {
      // waitForRemoved 到達後(=カード本体 Locator が絡む)は他テストと同じく
      // 実 expect マッチャに依存しないよう、click 自体を失敗させて打ち切る
      // (呼び出し順序の確認が目的で、削除完了までは追わない)。
      const fake = makeFakePage({
        node1: { waitFor: "resolve", click: "reject" },
      });

      await expect(
        removeInfraCardIfPresent(fake.page, "node1", 1000),
      ).rejects.toThrow("click failed: node1");

      expect(fake.callOrder).toEqual([
        "fitCanvasView",
        "click:infra-card-remove-node1",
      ]);
    },
  );

  it(
    "ボタンが不在(waitFor reject)の場合は fitCanvasView も呼ばない" +
      "（既に削除済みの通常ケースで余計な操作を増やさない）",
    async () => {
      const fake = makeFakePage({ node1: { waitFor: "reject" } });

      await removeInfraCardIfPresent(fake.page, "node1", 1000);

      expect(fake.callOrder).toEqual([]);
    },
  );
});

describe("cleanupRemovableCards(afterAll 定型処理)", () => {
  it("entityIds が空なら browser.newPage を開かず即座に返る(0件境界・成功パスで待ちを増やさない)", async () => {
    const fake = makeFakePage({});
    const { browser, newPage } = makeFakeBrowser(fake);

    await cleanupRemovableCards(browser, [], { timeoutMs: 1000 });

    expect(newPage).not.toHaveBeenCalled();
    expect(fake.goto).not.toHaveBeenCalled();
  });

  it("entityIds が全て空文字なら filter され、ページを開かない", async () => {
    const fake = makeFakePage({});
    const { browser, newPage } = makeFakeBrowser(fake);

    await cleanupRemovableCards(browser, ["", ""], { timeoutMs: 1000 });

    expect(newPage).not.toHaveBeenCalled();
  });

  it("空文字が混ざっていても、有効な entityId だけを対象にする", async () => {
    const fake = makeFakePage({
      node1: { waitFor: "reject" },
      node2: { waitFor: "reject" },
    });
    const { browser, newPage } = makeFakeBrowser(fake);

    await cleanupRemovableCards(browser, ["", "node1", "", "node2"], {
      timeoutMs: 2000,
    });

    expect(newPage).toHaveBeenCalledTimes(1);
    expect(fake.getByTestId).toHaveBeenCalledWith("infra-card-remove-node1");
    expect(fake.getByTestId).toHaveBeenCalledWith("infra-card-remove-node2");
    // 空文字の remove ボタンは待たない。
    expect(fake.getByTestId).not.toHaveBeenCalledWith("infra-card-remove-");
  });

  it("複数カード(全て既に削除済み)ではページを1回だけ開き、goto→各カード後始末→close を1度ずつ行う", async () => {
    const fake = makeFakePage({
      a: { waitFor: "reject" },
      b: { waitFor: "reject" },
      c: { waitFor: "reject" },
    });
    const { browser, newPage } = makeFakeBrowser(fake);

    await cleanupRemovableCards(browser, ["a", "b", "c"], { timeoutMs: 3000 });

    expect(newPage).toHaveBeenCalledTimes(1);
    expect(fake.goto).toHaveBeenCalledTimes(1);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.waitForTimeouts.get("a")).toBe(3000);
    expect(fake.waitForTimeouts.get("b")).toBe(3000);
    expect(fake.waitForTimeouts.get("c")).toBe(3000);
  });

  it("viewport 指定時は newPage に viewport を渡し、未指定時は undefined を渡す", async () => {
    const viewport = { width: 1280, height: 720 };

    const fake1 = makeFakePage({ a: { waitFor: "reject" } });
    const b1 = makeFakeBrowser(fake1);
    await cleanupRemovableCards(b1.browser, ["a"], {
      timeoutMs: 1000,
      viewport,
    });
    expect(b1.newPage).toHaveBeenCalledWith({ viewport });

    const fake2 = makeFakePage({ a: { waitFor: "reject" } });
    const b2 = makeFakeBrowser(fake2);
    await cleanupRemovableCards(b2.browser, ["a"], { timeoutMs: 1000 });
    expect(b2.newPage).toHaveBeenCalledWith(undefined);
  });

  it("途中のカードで削除が失敗すると例外を伝播し、以降のカードは処理せず、それでも page.close は必ず呼ばれる", async () => {
    // afterAll のループで前のカードの失敗が後続へ波及する挙動と、finally に
    // よるページ後始末の保証(不具合2: 削除未完了のまま放置しない)を固定する。
    const fake = makeFakePage({
      a: { waitFor: "reject" }, // 既に削除済み → 握りつぶし
      b: { waitFor: "resolve", click: "reject" }, // クリック失敗 → 伝播
      c: { waitFor: "reject" }, // ここまで到達しないはず
    });
    const { browser, newPage } = makeFakeBrowser(fake);

    await expect(
      cleanupRemovableCards(browser, ["a", "b", "c"], { timeoutMs: 1000 }),
    ).rejects.toThrow("click failed: b");

    expect(newPage).toHaveBeenCalledTimes(1);
    // b で打ち切られ、c の削除ボタンは参照すらされない。
    expect(fake.getByTestId).not.toHaveBeenCalledWith("infra-card-remove-c");
    // 例外が起きても finally で必ずページを閉じる。
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it("後始末が例外を投げても、その前に開いたページは閉じられる(page.close が finally 経由)", async () => {
    const fake = makeFakePage({ a: { waitFor: "resolve", click: "reject" } });
    const { browser } = makeFakeBrowser(fake);

    await expect(
      cleanupRemovableCards(browser, ["a"], { timeoutMs: 1000 }),
    ).rejects.toThrow();

    expect(fake.close).toHaveBeenCalledTimes(1);
  });
});
