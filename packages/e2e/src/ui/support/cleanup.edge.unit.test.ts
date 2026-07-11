// support/cleanup.ts の `removeCardIfPresent` に対する異常系・境界値テスト
// (Issue #233 のテスト強化)。cleanup.unit.test.ts が基本4分岐(不在・
// 遅延出現・クリック失敗・削除完了待ちタイムアウト)を押さえているのに対し、
// ここでは「エラー分類の境界」と「ボタンが一瞬だけ現れる競合タイミング」を
// 重点的に検証する。
//
// このヘルパーの肝は、失敗を2つの経路に分類することにある。
//   - waitForButton の失敗 = 「既に削除済み」とみなして握りつぶす
//   - click / waitForRemoved の失敗 = 削除が本当に失敗した可能性が高いので
//     例外を伝播させる
// 境界(どちらの経路に落ちるか)がタイミング次第で誤判定されないこと、
// および握りつぶし側が広くなりすぎない(waitForButton 以外を飲み込まない)
// ことを確認する。

import { describe, expect, it, vi } from "vitest";
import { removeCardIfPresent } from "./cleanup.js";

describe("removeCardIfPresent 異常系・境界", () => {
  it("waitForButton → click → waitForRemoved の順に厳密に1回ずつ呼ばれる", async () => {
    const order: string[] = [];
    const waitForButton = vi.fn(async () => {
      order.push("waitForButton");
    });
    const click = vi.fn(async () => {
      order.push("click");
    });
    const waitForRemoved = vi.fn(async () => {
      order.push("waitForRemoved");
    });

    await removeCardIfPresent({ waitForButton, click, waitForRemoved });

    expect(order).toEqual(["waitForButton", "click", "waitForRemoved"]);
    expect(waitForButton).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(waitForRemoved).toHaveBeenCalledTimes(1);
  });

  it("waitForButton が Error 以外(文字列)で reject しても握りつぶす(空 catch の境界)", async () => {
    // Playwright の waitFor は Error を投げるが、握りつぶし側の catch が
    // Error 型に依存していると、想定外の reject 値でクラッシュしうる。
    // catch {} が値の種類を問わず飲み込むことを保証する。
    const click = vi.fn();
    const waitForRemoved = vi.fn();

    await expect(
      removeCardIfPresent({
        waitForButton: () => Promise.reject("not an Error object"),
        click,
        waitForRemoved,
      }),
    ).resolves.toBeUndefined();

    expect(click).not.toHaveBeenCalled();
    expect(waitForRemoved).not.toHaveBeenCalled();
  });

  it("waitForButton が undefined で reject しても握りつぶす(空 catch の境界)", async () => {
    const click = vi.fn();

    await expect(
      removeCardIfPresent({
        waitForButton: () => Promise.reject(undefined),
        click,
        waitForRemoved: vi.fn(),
      }),
    ).resolves.toBeUndefined();

    expect(click).not.toHaveBeenCalled();
  });

  it("ボタンが一瞬現れた直後に消える競合(クリックが element detached で失敗)は握りつぶさず伝播する", async () => {
    // 「一瞬だけ削除ボタンが出現し、直後に本体テスト側の削除が完了して
    // ボタンが DOM から外れる」タイミングを模す。waitForButton は成功する
    // ため握りつぶし経路には落ちず、続く click が detached エラーで失敗する。
    // ここで握りつぶすと「削除できていないのに成功扱い」に戻ってしまうため、
    // 現状の実装が例外を伝播させる(=失敗を隠さない)ことを固定する。
    const detachedError = new Error(
      "locator.click: Element is not attached to the DOM",
    );
    const waitForRemoved = vi.fn();

    await expect(
      removeCardIfPresent({
        waitForButton: () => Promise.resolve(),
        click: () => Promise.reject(detachedError),
        waitForRemoved,
      }),
    ).rejects.toThrow(detachedError);

    // click が失敗した時点で打ち切られ、削除完了待ちには進まない。
    expect(waitForRemoved).not.toHaveBeenCalled();
  });

  it("ボタン出現→クリック成功後、カードが既に消えていれば(waitForRemoved 即 resolve)エラーなく完了する", async () => {
    // 競合で本体テストが削除を完了させた直後でも、クリックが通り
    // waitForRemoved が即 resolve するなら、後始末は成功として扱われる。
    const click = vi.fn().mockResolvedValue(undefined);
    const waitForRemoved = vi.fn().mockResolvedValue(undefined);

    await expect(
      removeCardIfPresent({
        waitForButton: () => Promise.resolve(),
        click,
        waitForRemoved,
      }),
    ).resolves.toBeUndefined();

    expect(click).toHaveBeenCalledTimes(1);
    expect(waitForRemoved).toHaveBeenCalledTimes(1);
  });

  it("連続呼び出しは互いに独立: 1回目がボタン不在で握りつぶされても、2回目は通常どおり削除まで進む", async () => {
    // afterAll が複数カードを順番に後始末する状況を、純粋関数レベルで模す。
    // 1枚目(既に削除済み)の握りつぶしが、2枚目(まだ残っている)の削除を
    // 妨げないことを確認する。
    const secondClick = vi.fn().mockResolvedValue(undefined);
    const secondRemoved = vi.fn().mockResolvedValue(undefined);

    await removeCardIfPresent({
      waitForButton: () => Promise.reject(new Error("gone")),
      click: vi.fn(),
      waitForRemoved: vi.fn(),
    });
    await removeCardIfPresent({
      waitForButton: () => Promise.resolve(),
      click: secondClick,
      waitForRemoved: secondRemoved,
    });

    expect(secondClick).toHaveBeenCalledTimes(1);
    expect(secondRemoved).toHaveBeenCalledTimes(1);
  });
});
