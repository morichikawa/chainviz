// EclipseAttackPeerGraph 単体のテスト（Issue #416）。デモ全体の状態遷移は
// EclipseAttackDemoView.test.tsx が扱う（CLAUDE.md の1ファイル1責務）。
// ここは図解固有の関心事に絞る:
//   - スロットの時計位置（0=12時, 2=3時, 4=6時, 6=9時）が正しく描かれるか
//   - honest/attacker の色クラス・グリフが state と対応しているか
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ECLIPSE_DEMO_SLOT_COUNT, type PeerSlotState } from "./eclipseAttackDemo.js";
import { EclipseAttackPeerGraph } from "./EclipseAttackPeerGraph.js";

afterEach(cleanup);

function allHonest(): readonly PeerSlotState[] {
  return Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "honest" as const);
}

function renderGraph(
  slots: readonly PeerSlotState[],
  flashingSlotIndex: number | null = null,
  eclipsed = false,
) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <EclipseAttackPeerGraph
        slots={slots}
        flashingSlotIndex={flashingSlotIndex}
        eclipsed={eclipsed}
      />
    </LanguageProvider>,
  );
}

function circleOf(index: number) {
  return screen.getByTestId(`eclipse-demo-slot-${index}`).querySelector("circle")!;
}

describe("EclipseAttackPeerGraph: clock positions", () => {
  it("places slot 0 at 12 o'clock (directly above center, same x as center)", () => {
    renderGraph(allHonest());
    const victim = screen.getByTestId("eclipse-demo-victim");
    const centerX = Number(victim.getAttribute("x")) + Number(victim.getAttribute("width")) / 2;
    const slot0 = circleOf(0);
    expect(Number(slot0.getAttribute("cx"))).toBeCloseTo(centerX, 1);
    expect(Number(slot0.getAttribute("cy"))).toBeLessThan(
      Number(victim.getAttribute("y")),
    );
  });

  it("places slot 2 at 3 o'clock (directly right of center, same y as center)", () => {
    renderGraph(allHonest());
    const victim = screen.getByTestId("eclipse-demo-victim");
    const centerY = Number(victim.getAttribute("y")) + Number(victim.getAttribute("height")) / 2;
    const slot2 = circleOf(2);
    expect(Number(slot2.getAttribute("cy"))).toBeCloseTo(centerY, 1);
    expect(Number(slot2.getAttribute("cx"))).toBeGreaterThan(
      Number(victim.getAttribute("x")) + Number(victim.getAttribute("width")),
    );
  });

  it("places slot 4 at 6 o'clock (directly below center) and slot 6 at 9 o'clock (directly left)", () => {
    renderGraph(allHonest());
    const victim = screen.getByTestId("eclipse-demo-victim");
    const centerX = Number(victim.getAttribute("x")) + Number(victim.getAttribute("width")) / 2;
    const centerY = Number(victim.getAttribute("y")) + Number(victim.getAttribute("height")) / 2;

    const slot4 = circleOf(4);
    expect(Number(slot4.getAttribute("cx"))).toBeCloseTo(centerX, 1);
    expect(Number(slot4.getAttribute("cy"))).toBeGreaterThan(
      Number(victim.getAttribute("y")) + Number(victim.getAttribute("height")),
    );

    const slot6 = circleOf(6);
    expect(Number(slot6.getAttribute("cy"))).toBeCloseTo(centerY, 1);
    expect(Number(slot6.getAttribute("cx"))).toBeLessThan(Number(victim.getAttribute("x")));
  });
});

describe("EclipseAttackPeerGraph: color/glyph reflects slot state", () => {
  it("renders honest slots with the honest color class and a check glyph", () => {
    renderGraph(allHonest());
    expect(circleOf(0).getAttribute("class")).toContain("eclipse-demo__slot-chip--honest");
    expect(screen.getByTestId("eclipse-demo-slot-0").querySelector("text")?.textContent).toBe(
      "✓",
    );
  });

  it("renders attacker slots with the attacker color class and an exclamation glyph", () => {
    const slots = allHonest().map((s, i) => (i === 0 ? "attacker" : s)) as PeerSlotState[];
    renderGraph(slots);
    expect(circleOf(0).getAttribute("class")).toContain("eclipse-demo__slot-chip--attacker");
    expect(screen.getByTestId("eclipse-demo-slot-0").querySelector("text")?.textContent).toBe(
      "!",
    );
  });

  it("toggles the victim rect's eclipsed class based on the eclipsed prop", () => {
    renderGraph(allHonest(), null, false);
    expect(screen.getByTestId("eclipse-demo-victim").getAttribute("class")).not.toContain(
      "eclipse-demo__victim--eclipsed",
    );
    cleanup();

    renderGraph(allHonest(), null, true);
    expect(screen.getByTestId("eclipse-demo-victim").getAttribute("class")).toContain(
      "eclipse-demo__victim--eclipsed",
    );
  });
});
