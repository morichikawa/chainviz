// ミニ包囲グラフが「色だけ」で正規ピア/攻撃者ピアを区別していないことの
// 検証（Issue #416 テスト強化。UX設計 §3レイアウト2「色のみでの区別は
// 避けること（アクセシビリティ）」）。基本の描画・時計位置は
// EclipseAttackPeerGraph.test.tsx が扱う（CLAUDE.md の1ファイル1責務）。
//
// ここで固定する契約:
//   - class（＝色）属性を完全に無視しても、各スロットの状態がテキスト情報
//     （aria-label とグリフ文字）だけで判別できること
//   - その手がかりが8スロットすべてで独立に機能すること
//   - ja/en どちらの言語でも成立すること
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ECLIPSE_DEMO_SLOT_COUNT, type PeerSlotState } from "./eclipseAttackDemo.js";
import { EclipseAttackPeerGraph } from "./EclipseAttackPeerGraph.js";

afterEach(cleanup);

function renderGraph(
  slots: readonly PeerSlotState[],
  lang: "ja" | "en" = "ja",
  eclipsed = false,
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <EclipseAttackPeerGraph slots={slots} flashingSlotIndex={null} eclipsed={eclipsed} />
    </LanguageProvider>,
  );
}

function slotGroup(index: number): HTMLElement {
  return screen.getByTestId(`eclipse-demo-slot-${index}`);
}

/** class 属性（色の手がかり）を取り除いたクローンから読める区別の手がかり。 */
function nonColorCuesOf(index: number): { label: string | null; glyph: string } {
  const clone = slotGroup(index).cloneNode(true) as SVGGElement;
  clone.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
  clone.removeAttribute("class");
  return {
    label: clone.getAttribute("aria-label"),
    glyph: clone.querySelector("text")?.textContent ?? "",
  };
}

describe("EclipseAttackPeerGraph: honest/attacker are distinguishable without colour", () => {
  it("keeps both cues (accessible name and glyph) for every slot in a mixed state", () => {
    // 偶数を攻撃者・奇数を正規にした混在状態で、8スロットすべてが独立に
    // 正しい手がかりを持つことを確認する（先頭スロットだけの確認では
    // index の取り違えを検出できない）。
    const slots = Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, (_, i) =>
      i % 2 === 0 ? ("attacker" as const) : ("honest" as const),
    );
    renderGraph(slots);

    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      const cues = nonColorCuesOf(i);
      if (i % 2 === 0) {
        expect(cues.label).toBe("攻撃者ピア");
        expect(cues.glyph).toBe("!");
      } else {
        expect(cues.label).toBe("正規ピア");
        expect(cues.glyph).toBe("✓");
      }
    }
  });

  it("uses different glyphs and different accessible names for the two states", () => {
    // 同じグリフ・同じラベルを使ってしまうと区別が色のみになる。その回帰を
    // 直接ガードする。
    renderGraph(["honest", "attacker", ...Array.from({ length: 6 }, () => "honest" as const)]);
    const honest = nonColorCuesOf(0);
    const attacker = nonColorCuesOf(1);
    expect(honest.glyph.length).toBeGreaterThan(0);
    expect(attacker.glyph.length).toBeGreaterThan(0);
    expect(honest.glyph).not.toBe(attacker.glyph);
    expect(honest.label).toBeTruthy();
    expect(attacker.label).toBeTruthy();
    expect(honest.label).not.toBe(attacker.label);
  });

  it("still differs when the colour classes are identical in the comparison (cues are not class-derived)", () => {
    // class を落としたクローン同士でも honest と attacker の中身が異なる
    // = 区別が class（色）に由来していないことの確認。
    renderGraph(["honest", "attacker", ...Array.from({ length: 6 }, () => "honest" as const)]);
    const stripped = (index: number) => {
      const clone = slotGroup(index).cloneNode(true) as SVGGElement;
      clone.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
      clone.removeAttribute("data-testid");
      return clone.innerHTML + `|${clone.getAttribute("aria-label")}`;
    };
    expect(stripped(0)).not.toBe(stripped(1));
  });

  it("localizes the non-colour cue in English as well", () => {
    renderGraph(["honest", "attacker", ...Array.from({ length: 6 }, () => "honest" as const)], "en");
    expect(nonColorCuesOf(0).label).toBe("Honest peer");
    expect(nonColorCuesOf(1).label).toBe("Attacker peer");
    // グリフは言語に依存しない記号（言語を変えても区別が失われない）。
    expect(nonColorCuesOf(0).glyph).toBe("✓");
    expect(nonColorCuesOf(1).glyph).toBe("!");
  });

  it("makes a full eclipse inferable from the labels alone (all eight say attacker)", () => {
    const slots = Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "attacker" as const);
    renderGraph(slots, "ja", true);
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(nonColorCuesOf(i).label).toBe("攻撃者ピア");
      expect(nonColorCuesOf(i).glyph).toBe("!");
    }
  });

  it("does not rely on the colour class alone for the honest state either", () => {
    const slots = Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "honest" as const);
    renderGraph(slots);
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(nonColorCuesOf(i).label).toBe("正規ピア");
      expect(nonColorCuesOf(i).glyph).toBe("✓");
    }
  });
});
