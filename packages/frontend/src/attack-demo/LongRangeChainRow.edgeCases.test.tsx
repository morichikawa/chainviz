// LongRangeChainRow の異常系・境界値の補強テスト（Issue #415 テスト強化）。
// ハッピーパス（4〜5件のチェーンをそのまま描く）は
// LongRangeChainRow.test.tsx が扱う。ここは以下を固定する:
//   - 0件・1件のブロック列（連結線が1本も出ない境界）
//   - brokenLinkAfterNumber が範囲外・末尾ブロックを指した場合
//   - note の対象ブロックが存在しない場合
//   - finalized 変種でもラベル未指定ならバッジを描かないこと（`&&` ガード）
//   - variantFor の呼び出し回数と引数（番号ではなくブロック本体が渡ること）
// （CLAUDE.md の1ファイル1責務）。
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LongRangeChainRow, type LongRangeTileVariant } from "./LongRangeChainRow.js";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  connectorGridColumnAfter,
  tileGridColumn,
  type LongRangeAttackDemoBlock,
} from "./longRangeAttackDemo.js";

afterEach(cleanup);

/** `variantFor` の呼び出しを記録する spy（引数の型を実装と揃えておく）。 */
function plainVariantSpy() {
  return vi.fn<(block: LongRangeAttackDemoBlock) => LongRangeTileVariant>(() => "plain");
}

describe("LongRangeChainRow: empty and single-block rows", () => {
  it("renders only the row label for an empty block list", () => {
    const variantFor = plainVariantSpy();
    render(
      <LongRangeChainRow
        rowLabel="空の履歴"
        gridRow={1}
        blocks={[]}
        variantFor={variantFor}
        testIdPrefix="row-empty"
      />,
    );
    expect(screen.getByTestId("row-empty-label").textContent).toBe("空の履歴");
    expect(screen.queryByTestId("row-empty-tile-0")).toBeNull();
    expect(screen.queryByTestId("row-empty-link-0")).toBeNull();
    expect(variantFor).not.toHaveBeenCalled();
  });

  it("renders a single tile with no connector at all", () => {
    render(
      <LongRangeChainRow
        rowLabel="genesis だけ"
        gridRow={1}
        blocks={CANONICAL_CHAIN.slice(0, 1)}
        variantFor={() => "plain"}
        testIdPrefix="row-single"
      />,
    );
    expect(screen.getByTestId("row-single-tile-0")).toBeTruthy();
    expect(screen.queryByTestId("row-single-link-0")).toBeNull();
  });
});

describe("LongRangeChainRow: brokenLinkAfterNumber edge values", () => {
  it("draws no dashed connector when the number is not in the block list", () => {
    for (const brokenLinkAfterNumber of [-1, 99]) {
      cleanup();
      render(
        <LongRangeChainRow
          rowLabel="攻撃者が作り直した履歴"
          gridRow={1}
          blocks={ATTACKER_CHAIN}
          variantFor={() => "plain"}
          brokenLinkAfterNumber={brokenLinkAfterNumber}
          testIdPrefix="row-attacker"
        />,
      );
      for (const number of [0, 1, 2, 3]) {
        expect(screen.getByTestId(`row-attacker-link-${number}`).className).not.toContain(
          "--broken",
        );
      }
    }
  });

  it("draws no dashed connector when the number is the last block (it has no outgoing link)", () => {
    const lastNumber = ATTACKER_CHAIN[ATTACKER_CHAIN.length - 1]!.number;
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={() => "plain"}
        brokenLinkAfterNumber={lastNumber}
        testIdPrefix="row-attacker"
      />,
    );
    expect(screen.queryByTestId(`row-attacker-link-${lastNumber}`)).toBeNull();
    for (const number of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`row-attacker-link-${number}`).className).not.toContain("--broken");
    }
  });

  it("breaks the only connector of a two-block row", () => {
    render(
      <LongRangeChainRow
        rowLabel="2件だけ"
        gridRow={1}
        blocks={CANONICAL_CHAIN.slice(0, 2)}
        variantFor={() => "plain"}
        brokenLinkAfterNumber={0}
        testIdPrefix="row-two"
      />,
    );
    expect(screen.getByTestId("row-two-link-0").className).toContain("--broken");
    expect(screen.queryByTestId("row-two-link-1")).toBeNull();
  });
});

describe("LongRangeChainRow: note edge cases", () => {
  it("renders no note when the target block number is absent from the row", () => {
    render(
      <LongRangeChainRow
        rowLabel="正規のチェーン"
        gridRow={1}
        blocks={CANONICAL_CHAIN}
        variantFor={() => "plain"}
        note={{ blockNumber: 99, text: "出てはいけない注記", testId: "orphan-note" }}
        testIdPrefix="row-canonical"
      />,
    );
    expect(screen.queryByTestId("orphan-note")).toBeNull();
    expect(screen.queryByText("出てはいけない注記")).toBeNull();
  });

  it("renders the note under the last block when that is the target", () => {
    const lastBlock = CANONICAL_CHAIN[CANONICAL_CHAIN.length - 1]!;
    render(
      <LongRangeChainRow
        rowLabel="正規のチェーン"
        gridRow={1}
        blocks={CANONICAL_CHAIN}
        variantFor={() => "plain"}
        note={{ blockNumber: lastBlock.number, text: "先端の注記", testId: "tip-note" }}
        testIdPrefix="row-canonical"
      />,
    );
    const cell = screen.getByTestId(`row-canonical-tile-${lastBlock.number}`)
      .parentElement as HTMLElement;
    expect(within(cell).getByTestId("tip-note").textContent).toBe("先端の注記");
  });

  it("shows the note and the finalized badge together on the same block", () => {
    render(
      <LongRangeChainRow
        rowLabel="正規のチェーン"
        gridRow={1}
        blocks={CANONICAL_CHAIN}
        variantFor={() => "finalized"}
        finalizedBadgeLabel="確定済み"
        note={{ blockNumber: 1, text: "両方出る", testId: "both-note" }}
        testIdPrefix="row-canonical"
      />,
    );
    const cell = screen.getByTestId("row-canonical-tile-1").parentElement as HTMLElement;
    expect(within(cell).getByTestId("both-note")).toBeTruthy();
    expect(within(cell).getByTestId("row-canonical-finalized-1")).toBeTruthy();
  });
});

describe("LongRangeChainRow: finalized badge guards", () => {
  it("renders no badge element for finalized tiles when no label is supplied", () => {
    render(
      <LongRangeChainRow
        rowLabel="正規のチェーン"
        gridRow={1}
        blocks={CANONICAL_CHAIN}
        variantFor={() => "finalized"}
        testIdPrefix="row-canonical"
      />,
    );
    for (const block of CANONICAL_CHAIN) {
      expect(screen.queryByTestId(`row-canonical-finalized-${block.number}`)).toBeNull();
    }
    // 空のバッジ要素が残らないこと（見えない余白の原因になる）。
    expect(document.querySelector(".long-range-demo__tile-badge")).toBeNull();
  });

  it("renders no badge for fork tiles even when a label is supplied", () => {
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={() => "fork"}
        finalizedBadgeLabel="確定済み"
        testIdPrefix="row-attacker"
      />,
    );
    for (const block of ATTACKER_CHAIN) {
      expect(screen.queryByTestId(`row-attacker-finalized-${block.number}`)).toBeNull();
    }
  });
});

describe("LongRangeChainRow: columns come from the block number, not the array index", () => {
  it("keeps a row that does not start at #0 aligned with the shared grid", () => {
    // 3段そろいの不変条件は「同じブロック番号なら同じ列」。配列の index を
    // 列計算に使ってしまうと、#0 から始まらない行（この砂場では発生しないが、
    // 行の一部だけを渡す使い方をした瞬間）に列がずれる。実データの後半だけを
    // 渡して、番号由来の列になっていることを確認する。
    const tail = ATTACKER_CHAIN.slice(2);
    render(
      <LongRangeChainRow
        rowLabel="分岐後だけ"
        gridRow={1}
        blocks={tail}
        variantFor={() => "plain"}
        testIdPrefix="row-tail"
      />,
    );
    for (const block of tail) {
      const cell = screen.getByTestId(`row-tail-tile-${block.number}`).parentElement as HTMLElement;
      expect(cell.style.gridColumn).toBe(String(tileGridColumn(block.number)));
    }
    const firstBlock = tail[0]!;
    expect(screen.getByTestId(`row-tail-link-${firstBlock.number}`).style.gridColumn).toBe(
      String(connectorGridColumnAfter(firstBlock.number)),
    );
  });
});

describe("LongRangeChainRow: variantFor contract", () => {
  it("calls variantFor exactly once per block, with the block object itself", () => {
    const variantFor = plainVariantSpy();
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={variantFor}
        testIdPrefix="row-attacker"
      />,
    );
    expect(variantFor).toHaveBeenCalledTimes(ATTACKER_CHAIN.length);
    // 配列の index ではなくブロック本体（number/hash を持つオブジェクト）が
    // 渡ること。呼び出し側は block.number で判定しているため、ここが index に
    // すり替わると分岐点の判定が静かにずれる。
    expect(variantFor.mock.calls.map(([block]) => block)).toEqual([...ATTACKER_CHAIN]);
  });
});
