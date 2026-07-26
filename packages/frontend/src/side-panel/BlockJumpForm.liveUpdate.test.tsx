// ブロック番号ジャンプ欄（Issue #428）の、チェーンが進行し続けている最中の
// 挙動。ジャンプ欄は「常に更新され続けるワールドステート（`blocksByHash`）」
// を毎レンダー参照するため、ユーザーが入力している最中にも保持窓が前へ
// ずれていく。入力欄の同期・送信可否・エラー文が、その更新に正しく追随する
// （かつ入力中の値を不用意に捨てない）ことをここで固定する。
//
// 静的な入力（初期値・バリデーション・エラー文の出し分け）は
// BlockJumpForm.test.tsx、`resolveBlockJump` 自体のロジックは
// entities/blockDetail.jump.test.ts が扱う（CLAUDE.md のテスト分割方針）。
import type { BlockEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { BlockJumpForm } from "./BlockJumpForm.js";

afterEach(cleanup);

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 10,
    parentHash: "0xparent",
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

function tree(
  displayed: BlockEntity,
  blocksByHash: ReadonlyMap<string, BlockEntity>,
  onNavigate: (hash: string) => void,
) {
  return (
    <LanguageProvider initialLanguage="ja">
      <BlockJumpForm block={displayed} blocksByHash={blocksByHash} onNavigate={onNavigate} />
    </LanguageProvider>
  );
}

function getInput(): HTMLInputElement {
  return screen.getByTestId("block-jump-input") as HTMLInputElement;
}

function getSubmit(): HTMLButtonElement {
  return screen.getByTestId("block-jump-submit") as HTMLButtonElement;
}

describe("BlockJumpForm: while the chain keeps advancing", () => {
  it("keeps the in-progress input when new blocks arrive but the displayed block is unchanged", () => {
    // 入力中に新しいブロックが届くのは通常運転（12秒ごと）。ここで入力欄が
    // リセットされると、番号を打ち終える前に消えて実質入力できなくなる。
    const displayed = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    const { rerender } = render(
      tree(displayed, new Map([[displayed.hash, displayed]]), onNavigate),
    );

    fireEvent.change(getInput(), { target: { value: "1" } });
    const advanced = block({ hash: "0xnew", number: 11 });
    rerender(
      tree(
        displayed,
        new Map([
          [displayed.hash, displayed],
          [advanced.hash, advanced],
        ]),
        onNavigate,
      ),
    );
    expect(getInput().value).toBe("1");
  });

  it("keeps the in-progress input when the displayed block object is replaced with a fresh one carrying the same hash", () => {
    // ワールドステートの更新で `BlockEntity` は新しいオブジェクトとして
    // 差し替わる（受信ノードが1つ増えた等）。同期の判定は hash であって
    // オブジェクト同一性ではないことを固定する。
    const displayed = block({ hash: "0xtarget", number: 10, receivedAt: { node1: 1 } });
    const onNavigate = vi.fn();
    const { rerender } = render(
      tree(displayed, new Map([[displayed.hash, displayed]]), onNavigate),
    );

    fireEvent.change(getInput(), { target: { value: "42" } });
    const sameBlockNewObject = block({
      hash: "0xtarget",
      number: 10,
      receivedAt: { node1: 1, node2: 2 },
    });
    rerender(
      tree(
        sameBlockNewObject,
        new Map([[sameBlockNewObject.hash, sameBlockNewObject]]),
        onNavigate,
      ),
    );
    expect(getInput().value).toBe("42");
  });

  it("re-syncs the input when the displayed block switches to a fork with the same number but a different hash", () => {
    const displayed = block({ hash: "0xforka", number: 10 });
    const onNavigate = vi.fn();
    const { rerender } = render(
      tree(displayed, new Map([[displayed.hash, displayed]]), onNavigate),
    );

    fireEvent.change(getInput(), { target: { value: "999" } });
    const forkB = block({ hash: "0xforkb", number: 10 });
    rerender(tree(forkB, new Map([[forkB.hash, forkB]]), onNavigate));
    expect(getInput().value).toBe("10");
  });

  it("turns a not-found input into a submittable one once that block is observed", () => {
    // 「まだ来ていない先の番号」を先回りで入力した状態。到着した瞬間に
    // エラーが消え、送信できるようになる（毎レンダー導出しているため）。
    const displayed = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    const { rerender } = render(
      tree(displayed, new Map([[displayed.hash, displayed]]), onNavigate),
    );

    fireEvent.change(getInput(), { target: { value: "11" } });
    expect(screen.getByTestId("block-jump-error-notFound")).toBeTruthy();
    expect(getSubmit().disabled).toBe(true);

    const arrived = block({ hash: "0xarrived", number: 11 });
    rerender(
      tree(
        displayed,
        new Map([
          [displayed.hash, displayed],
          [arrived.hash, arrived],
        ]),
        onNavigate,
      ),
    );
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
    expect(getSubmit().disabled).toBe(false);
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledWith("0xarrived");
  });

  it("turns a submittable input into a not-found one when the target block falls out of the retention window", () => {
    const displayed = block({ hash: "0xtarget", number: 10 });
    const oldest = block({ hash: "0xoldest", number: 9 });
    const onNavigate = vi.fn();
    const withOldest = new Map([
      [oldest.hash, oldest],
      [displayed.hash, displayed],
    ]);
    const { rerender } = render(tree(displayed, withOldest, onNavigate));

    fireEvent.change(getInput(), { target: { value: "9" } });
    expect(getSubmit().disabled).toBe(false);

    // 保持窓が前へずれ、#9 が忘れられた（#11 が新しく入った）状態。
    const arrived = block({ hash: "0xarrived", number: 11 });
    rerender(
      tree(
        displayed,
        new Map([
          [displayed.hash, displayed],
          [arrived.hash, arrived],
        ]),
        onNavigate,
      ),
    );
    expect(getSubmit().disabled).toBe(true);
    expect(screen.getByTestId("block-jump-error-notFound").textContent).toBe(
      "指定したブロック番号は見つかりませんでした（現在保持しているのは #10 〜 #11）",
    );
    fireEvent.click(getSubmit());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("updates the retained range shown in the not-found message as the window slides", () => {
    const displayed = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    const { rerender } = render(
      tree(displayed, new Map([[displayed.hash, displayed]]), onNavigate),
    );

    fireEvent.change(getInput(), { target: { value: "5" } });
    expect(screen.getByTestId("block-jump-error-notFound").textContent).toContain(
      "#10 〜 #10",
    );

    const arrived = block({ hash: "0xarrived", number: 12 });
    rerender(
      tree(
        displayed,
        new Map([
          [displayed.hash, displayed],
          [arrived.hash, arrived],
        ]),
        onNavigate,
      ),
    );
    expect(screen.getByTestId("block-jump-error-notFound").textContent).toContain(
      "#10 〜 #12",
    );
  });

  it("resolves to the new fork winner when a competing block for the entered number arrives", () => {
    const displayed = block({ hash: "0xtarget", number: 10 });
    const forkEarly = block({ hash: "0xearly", number: 20, receivedAt: { node1: 100 } });
    const onNavigate = vi.fn();
    const { rerender } = render(
      tree(
        displayed,
        new Map([
          [displayed.hash, displayed],
          [forkEarly.hash, forkEarly],
        ]),
        onNavigate,
      ),
    );

    fireEvent.change(getInput(), { target: { value: "20" } });
    const forkLate = block({ hash: "0xlate", number: 20, receivedAt: { node1: 200 } });
    rerender(
      tree(
        displayed,
        new Map([
          [displayed.hash, displayed],
          [forkEarly.hash, forkEarly],
          [forkLate.hash, forkLate],
        ]),
        onNavigate,
      ),
    );
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledWith("0xlate");
  });

  it("falls back to a defensive single-number range if the retention window empties while a number is typed", () => {
    // 実際には対象ブロックが消えた時点で SidePanelHost がパネルを閉じる
    // （ダングリングガード）ため到達しない経路。それでも空 Map で例外を
    // 投げず、エラー文が壊れないことを確認する（`resolveBlockJump` の
    // フォールバックが UI まで通ることの担保）。
    const displayed = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    const { rerender } = render(
      tree(displayed, new Map([[displayed.hash, displayed]]), onNavigate),
    );

    fireEvent.change(getInput(), { target: { value: "50" } });
    rerender(tree(displayed, new Map(), onNavigate));
    expect(screen.getByTestId("block-jump-error-notFound").textContent).toBe(
      "指定したブロック番号は見つかりませんでした（現在保持しているのは #50 〜 #50）",
    );
    expect(getSubmit().disabled).toBe(true);
  });
});
