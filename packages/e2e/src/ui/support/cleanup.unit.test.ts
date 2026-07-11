// support/cleanup.ts の `removeCardIfPresent` のユニットテスト
// (Issue #233)。Playwright の実ブラウザ・実 Locator には依存しない
// フェイクの非同期アクションで、以下の分岐を検証する。
//
// - ボタンが最後まで現れない(=既に削除済み)場合は何もしない
// - ボタンが遅延して現れる場合でも(旧不具合1: goto直後の即時count()判定
//   では検知できなかったケース)正しく削除まで進む
// - クリック自体が失敗した場合、例外を握りつぶさず伝播させる
// - 削除完了待ちがタイムアウトした場合(旧不具合2: 削除未完了のまま
//   page.closeしてしまうケースに相当)、例外を握りつぶさず伝播させる

import { describe, expect, it, vi } from "vitest";
import { removeCardIfPresent } from "./cleanup.js";

describe("removeCardIfPresent", () => {
  it("ボタンが最後まで現れない場合は何もせず正常終了する(本体テストが既に削除済みの通常ケース)", async () => {
    const click = vi.fn();
    const waitForRemoved = vi.fn();

    await removeCardIfPresent({
      waitForButton: () => Promise.reject(new Error("timeout: button not found")),
      click,
      waitForRemoved,
    });

    expect(click).not.toHaveBeenCalled();
    expect(waitForRemoved).not.toHaveBeenCalled();
  });

  it("ボタンが遅延して現れる場合でも、出現を待ってからクリックし削除完了まで進む(旧不具合1相当)", async () => {
    // goto直後の即時count()判定であれば見逃していたはずの
    // 「少し遅れてボタンが出現するケース」を模する。
    let buttonAppeared = false;
    const waitForButton = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      buttonAppeared = true;
    });
    const click = vi.fn(async () => {
      expect(buttonAppeared).toBe(true);
    });
    const waitForRemoved = vi.fn().mockResolvedValue(undefined);

    await removeCardIfPresent({ waitForButton, click, waitForRemoved });

    expect(click).toHaveBeenCalledTimes(1);
    expect(waitForRemoved).toHaveBeenCalledTimes(1);
  });

  it("クリックが失敗した場合、例外を握りつぶさずそのまま伝播させる", async () => {
    const waitForRemoved = vi.fn();
    const clickError = new Error("click failed: element detached");

    await expect(
      removeCardIfPresent({
        waitForButton: () => Promise.resolve(),
        click: () => Promise.reject(clickError),
        waitForRemoved,
      }),
    ).rejects.toThrow(clickError);

    expect(waitForRemoved).not.toHaveBeenCalled();
  });

  it("クリック後、カードが実際に消えるまでの待ちがタイムアウトした場合、例外を握りつぶさずそのまま伝播させる(旧不具合2相当)", async () => {
    const removalTimeoutError = new Error("timeout: card still present");

    await expect(
      removeCardIfPresent({
        waitForButton: () => Promise.resolve(),
        click: () => Promise.resolve(),
        waitForRemoved: () => Promise.reject(removalTimeoutError),
      }),
    ).rejects.toThrow(removalTimeoutError);
  });
});
