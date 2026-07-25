// LongRangeChainRow（正規/攻撃者共通のタイル行描画）の単体テスト
// （Issue #415）。折り込み側の checkpoint 操作・判定バナーは
// LongRangeAttackDemoView.test.tsx が扱う（CLAUDE.md の1ファイル1責務）。
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LongRangeChainRow } from "./LongRangeChainRow.js";
import { ATTACKER_CHAIN, CANONICAL_CHAIN } from "./longRangeAttackDemo.js";

afterEach(cleanup);

describe("LongRangeChainRow: tiles", () => {
  it("renders one tile per block, labelled with its block number", () => {
    render(
      <div>
        <LongRangeChainRow
          rowLabel="正規のチェーン"
          gridRow={1}
          blocks={CANONICAL_CHAIN}
          variantFor={() => "plain"}
          testIdPrefix="row-canonical"
        />
      </div>,
    );
    for (const block of CANONICAL_CHAIN) {
      const tile = screen.getByTestId(`row-canonical-tile-${block.number}`);
      expect(within(tile).getByText(`#${block.number}`)).toBeTruthy();
    }
    expect(screen.getByTestId("row-canonical-label").textContent).toBe("正規のチェーン");
  });

  it("applies the variant class returned by variantFor", () => {
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={(block) => (block.number >= 2 ? "fork" : "plain")}
        testIdPrefix="row-attacker"
      />,
    );
    expect(screen.getByTestId("row-attacker-tile-1").className).not.toContain("--fork");
    expect(screen.getByTestId("row-attacker-tile-2").className).toContain("--fork");
    expect(screen.getByTestId("row-attacker-tile-4").className).toContain("--fork");
  });

  it("shows the finalized badge label only for tiles marked finalized", () => {
    render(
      <LongRangeChainRow
        rowLabel="正規のチェーン"
        gridRow={1}
        blocks={CANONICAL_CHAIN}
        variantFor={(block) => (block.number <= 1 ? "finalized" : "plain")}
        finalizedBadgeLabel="確定済み"
        testIdPrefix="row-canonical"
      />,
    );
    expect(screen.getByTestId("row-canonical-finalized-0").textContent).toBe("確定済み");
    expect(screen.getByTestId("row-canonical-finalized-1").textContent).toBe("確定済み");
    expect(screen.queryByTestId("row-canonical-finalized-2")).toBeNull();
  });
});

describe("LongRangeChainRow: connectors", () => {
  it("renders one fewer connector than the number of tiles (links between consecutive blocks only)", () => {
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={() => "plain"}
        testIdPrefix="row-attacker"
      />,
    );
    // ATTACKER_CHAIN は5ブロック → 連結線は4本(#0-1, #1-2, #2-3, #3-4)。
    for (const number of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`row-attacker-link-${number}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("row-attacker-link-4")).toBeNull();
  });

  it("marks only the link right after brokenLinkAfterNumber as broken (dashed)", () => {
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={() => "plain"}
        brokenLinkAfterNumber={1}
        testIdPrefix="row-attacker"
      />,
    );
    expect(screen.getByTestId("row-attacker-link-0").className).not.toContain("--broken");
    expect(screen.getByTestId("row-attacker-link-1").className).toContain("--broken");
    expect(screen.getByTestId("row-attacker-link-2").className).not.toContain("--broken");
    expect(screen.getByTestId("row-attacker-link-3").className).not.toContain("--broken");
  });

  it("marks decorative connectors as aria-hidden", () => {
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={() => "plain"}
        testIdPrefix="row-attacker"
      />,
    );
    expect(screen.getByTestId("row-attacker-link-0").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("LongRangeChainRow: rival note", () => {
  it("attaches the note only under the specified block number", () => {
    render(
      <LongRangeChainRow
        rowLabel="攻撃者が作り直した履歴"
        gridRow={1}
        blocks={ATTACKER_CHAIN}
        variantFor={() => "plain"}
        note={{
          blockNumber: 2,
          text: "同じ番号でも中身が違う、ライバルのブロックです",
          testId: "rival-note",
        }}
        testIdPrefix="row-attacker"
      />,
    );
    expect(screen.getByTestId("rival-note").textContent).toBe(
      "同じ番号でも中身が違う、ライバルのブロックです",
    );
    // #2 のタイルセルの内側に注記があること（他のブロックには無い）。
    const tileTwoCell = screen.getByTestId("row-attacker-tile-2").parentElement;
    expect(within(tileTwoCell as HTMLElement).getByTestId("rival-note")).toBeTruthy();
  });
});
