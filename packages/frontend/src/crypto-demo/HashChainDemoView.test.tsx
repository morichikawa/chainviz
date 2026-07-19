// HashChainDemoView の操作フロー(編集→無効化→つなぎ直し→連鎖修復→まとめ
// メッセージ→リセット)のコンポーネントテスト(Issue #401)。文言・i18n観点は
// HashChainDemoView.i18n.test.tsx に分ける(CLAUDE.md の1ファイル1責務)。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { HashChainDemoView } from "./HashChainDemoView.js";

// Issue #406: 処理帯に keccak256 の GlossaryTerm アンカーが増えたため、
// useGlossary() が例外を投げないよう GlossaryProvider でラップする
// （SignatureDemoView の既存テストと同じ流儀。空 glossary で十分）。
function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <HashChainDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function badgeText(number: number): string | null {
  return screen.getByTestId(`hash-chain-demo-badge-${number}`).textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HashChainDemoView: pristine initial state", () => {
  it("renders 3 blocks, all valid, with no relink buttons and no summary", () => {
    renderView();
    expect(screen.getByTestId("hash-chain-demo-block-1")).toBeTruthy();
    expect(screen.getByTestId("hash-chain-demo-block-2")).toBeTruthy();
    expect(screen.getByTestId("hash-chain-demo-block-3")).toBeTruthy();
    expect(badgeText(1)).toBe("有効");
    expect(badgeText(2)).toBe("有効");
    expect(badgeText(3)).toBe("有効");
    expect(screen.queryByTestId("hash-chain-demo-relink-2")).toBeNull();
    expect(screen.queryByTestId("hash-chain-demo-relink-3")).toBeNull();
    expect(screen.queryByTestId("hash-chain-demo-summary")).toBeNull();
    // 先頭ブロックには relink ボタン自体が無い(親を持たないため)。
    expect(screen.queryByTestId("hash-chain-demo-relink-1")).toBeNull();
  });
});

describe("HashChainDemoView: editing breaks the chain, one relink at a time repairs it", () => {
  it("editing block #1's data invalidates only block #2 (block #3 stays valid)", () => {
    renderView();
    const hashBefore = screen.getByTestId("hash-chain-demo-hash-1").title;

    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "Alice -> Bob: 999 ETH" },
    });

    expect(screen.getByTestId("hash-chain-demo-hash-1").title).not.toBe(hashBefore);
    expect(badgeText(1)).toBe("有効"); // 先頭は常に有効
    expect(badgeText(2)).toBe("無効: 親ブロックのハッシュと食い違っています");
    expect(badgeText(3)).toBe("有効"); // まだ直接の影響は受けない
    expect(screen.getByTestId("hash-chain-demo-relink-2")).toBeTruthy();
    expect(screen.queryByTestId("hash-chain-demo-relink-3")).toBeNull();
    expect(
      screen.getByTestId("hash-chain-demo-connector-2").className,
    ).toContain("hash-chain-demo__connector--broken");
  });

  it("relinking block #2 repairs it but pushes invalidity to block #3 (cascade), then relinking #3 fully repairs and shows the summary", () => {
    renderView();
    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "tampered" },
    });
    expect(badgeText(2)).toBe("無効: 親ブロックのハッシュと食い違っています");
    expect(badgeText(3)).toBe("有効");

    fireEvent.click(screen.getByTestId("hash-chain-demo-relink-2"));
    expect(badgeText(2)).toBe("有効");
    expect(badgeText(3)).toBe("無効: 親ブロックのハッシュと食い違っています");
    expect(screen.queryByTestId("hash-chain-demo-summary")).toBeNull();

    fireEvent.click(screen.getByTestId("hash-chain-demo-relink-3"));
    expect(badgeText(3)).toBe("有効");
    expect(screen.getByTestId("hash-chain-demo-summary")).toBeTruthy();
  });

  it("does not show the summary on pristine load even though every block starts out valid", () => {
    renderView();
    expect(screen.queryByTestId("hash-chain-demo-summary")).toBeNull();
  });
});

describe("HashChainDemoView: hash-change flash", () => {
  it("flashes the edited block's hash and clears the flash after the highlight duration", () => {
    renderView();
    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "tampered" },
    });
    expect(screen.getByTestId("hash-chain-demo-hash-1").className).toContain(
      "hash-chain-demo__hash-value--flash",
    );

    act(() => {
      vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    });
    expect(screen.getByTestId("hash-chain-demo-hash-1").className).not.toContain(
      "hash-chain-demo__hash-value--flash",
    );
  });
});

describe("HashChainDemoView: reset", () => {
  it("returns to the pristine (all-valid, no summary) state after edits and relinks", () => {
    renderView();
    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "tampered" },
    });
    fireEvent.click(screen.getByTestId("hash-chain-demo-relink-2"));
    fireEvent.click(screen.getByTestId("hash-chain-demo-relink-3"));
    expect(screen.getByTestId("hash-chain-demo-summary")).toBeTruthy();

    fireEvent.click(screen.getByTestId("hash-chain-demo-reset"));
    expect(badgeText(1)).toBe("有効");
    expect(badgeText(2)).toBe("有効");
    expect(badgeText(3)).toBe("有効");
    expect(screen.queryByTestId("hash-chain-demo-summary")).toBeNull();
    expect(
      (screen.getByTestId("hash-chain-demo-data-1") as HTMLInputElement).value,
    ).toBe("Alice → Bob: 5 ETH");
  });
});
