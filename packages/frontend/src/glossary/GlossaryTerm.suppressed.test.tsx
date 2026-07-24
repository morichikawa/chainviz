import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { GlossaryProvider } from "./GlossaryProvider.js";
import { GlossaryTerm } from "./GlossaryTerm.js";
import type { Glossary } from "./types.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const glossary: Glossary = {
  workbench: {
    key: "workbench",
    name: { ja: "ワークベンチ", en: "Workbench" },
    definition: { ja: "操作を実行できる作業台", en: "A workbench for running operations" },
    layer: "a-infra",
    relatedTerms: [],
  },
};

function wrap(node: ReactNode) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>{node}</GlossaryProvider>
    </LanguageProvider>,
  );
}

// Issue #410 (差し戻し対応): カードヘッダーの「ワークベンチ」ラベルの用語解説
// ポップオーバーが、操作パネルより前面(z-index)に出てパネルを覆う問題への
// 対応。ActionHint.suppressed.test.tsx / ActionHint.suppressedHoverSync.test.tsx
// と同じ観点をこちらにも適用する（同型の suppressed prop のため）。
// GlossaryTerm.test.tsx（基本のホバー/フォーカス挙動）を肥大化させないよう
// 別ファイルに分ける。
describe("GlossaryTerm suppressed prop", () => {
  it("hides an already-open popover when suppressed becomes true, without closing the underlying hover state", () => {
    const { rerender } = wrap(
      <GlossaryTerm termKey="workbench" suppressed={false}>
        ワークベンチ
      </GlossaryTerm>,
    );
    const term = screen.getByRole("button");
    fireEvent.mouseEnter(term);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <GlossaryTerm termKey="workbench" suppressed>
            ワークベンチ
          </GlossaryTerm>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    // suppressed が解除されれば、ホバー状態そのものは保持されていたので
    // 再度ホバーし直さなくても表示が戻る(内部の open 自体は変更していない)。
    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <GlossaryTerm termKey="workbench" suppressed={false}>
            ワークベンチ
          </GlossaryTerm>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByRole("tooltip").textContent).toContain("操作を実行できる作業台");
  });

  it("does not open the popover on hover while suppressed is true", () => {
    wrap(
      <GlossaryTerm termKey="workbench" suppressed>
        ワークベンチ
      </GlossaryTerm>,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("clears aria-describedby while suppressed even if hovered", () => {
    wrap(
      <GlossaryTerm termKey="workbench" suppressed>
        ワークベンチ
      </GlossaryTerm>,
    );
    const term = screen.getByRole("button");
    fireEvent.mouseEnter(term);
    expect(term.getAttribute("aria-describedby")).toBeNull();
  });

  it("defaults to not suppressed when the prop is omitted (existing callers unaffected)", () => {
    wrap(<GlossaryTerm termKey="workbench">ワークベンチ</GlossaryTerm>);
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("does not resurrect the popover after unsuppressing if the mouse actually left while suppressed", () => {
    const { rerender } = wrap(
      <GlossaryTerm termKey="workbench" suppressed={false}>
        ワークベンチ
      </GlossaryTerm>,
    );
    const term = screen.getByRole("button");
    fireEvent.mouseEnter(term);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <GlossaryTerm termKey="workbench" suppressed>
            ワークベンチ
          </GlossaryTerm>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    fireEvent.mouseLeave(term);
    act(() => {
      vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
    });

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <GlossaryTerm termKey="workbench" suppressed={false}>
            ワークベンチ
          </GlossaryTerm>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not resurrect the popover after unsuppressing if focus moved away while suppressed", () => {
    const { rerender } = wrap(
      <GlossaryTerm termKey="workbench" suppressed={false}>
        ワークベンチ
      </GlossaryTerm>,
    );
    const term = screen.getByRole("button");
    fireEvent.focus(term);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <GlossaryTerm termKey="workbench" suppressed>
            ワークベンチ
          </GlossaryTerm>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    fireEvent.blur(term);

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <GlossaryTerm termKey="workbench" suppressed={false}>
            ワークベンチ
          </GlossaryTerm>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a hover that started while suppressed once suppression is lifted", () => {
    const { rerender } = wrap(
      <GlossaryTerm termKey="workbench" suppressed>
        ワークベンチ
      </GlossaryTerm>,
    );
    const term = screen.getByRole("button");
    fireEvent.mouseEnter(term);
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={glossary}>
          <GlossaryTerm termKey="workbench" suppressed={false}>
            ワークベンチ
          </GlossaryTerm>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});
