import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerFilter } from "../entities/canvasLayers.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { LayerFilterBar } from "./LayerFilterBar.js";

afterEach(cleanup);

function renderBar(value: LayerFilter = "all") {
  const onChange = vi.fn();
  render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <LayerFilterBar value={value} onChange={onChange} layers={["a", "b", "c", "d"]} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
  return onChange;
}

describe("LayerFilterBar", () => {
  it("renders an 'all' chip plus one chip per supplied layer", () => {
    renderBar();
    expect(screen.getByTestId("layer-filter-chip-all")).toBeTruthy();
    expect(screen.getByTestId("layer-filter-chip-a")).toBeTruthy();
    expect(screen.getByTestId("layer-filter-chip-b")).toBeTruthy();
    expect(screen.getByTestId("layer-filter-chip-c")).toBeTruthy();
    expect(screen.getByTestId("layer-filter-chip-d")).toBeTruthy();
  });

  it("renders only chips for the layers passed in (chain-profile driven)", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <LayerFilterBar value="all" onChange={vi.fn()} layers={["a", "b"]} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId("layer-filter-chip-a")).toBeTruthy();
    expect(screen.getByTestId("layer-filter-chip-b")).toBeTruthy();
    expect(screen.queryByTestId("layer-filter-chip-c")).toBeNull();
    expect(screen.queryByTestId("layer-filter-chip-d")).toBeNull();
  });

  it("marks the 'all' chip active by default", () => {
    renderBar("all");
    expect(screen.getByTestId("layer-filter-chip-all").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("layer-filter-chip-b").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("marks the selected layer's chip active", () => {
    renderBar("b");
    expect(screen.getByTestId("layer-filter-chip-b").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("layer-filter-chip-all").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("calls onChange('b') when the B chip is clicked from 'all'", () => {
    const onChange = renderBar("all");
    fireEvent.click(screen.getByTestId("layer-filter-chip-b"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("calls onChange('all') when clicking the already-selected chip again (toggle off)", () => {
    const onChange = renderBar("b");
    fireEvent.click(screen.getByTestId("layer-filter-chip-b"));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("calls onChange('all') when the 'all' chip is clicked", () => {
    const onChange = renderBar("c");
    fireEvent.click(screen.getByTestId("layer-filter-chip-all"));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("switches directly from one layer to another when a different chip is clicked", () => {
    const onChange = renderBar("b");
    fireEvent.click(screen.getByTestId("layer-filter-chip-d"));
    expect(onChange).toHaveBeenCalledWith("d");
  });

  describe("pre-click hint tooltips (same convention as CanvasToolbar, Issue #123 §4-1)", () => {
    it("shows no tooltip before hovering any chip", () => {
      renderBar();
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("shows the layer-specific hint on hover", () => {
      renderBar();
      const chip = screen.getByTestId("layer-filter-chip-b");
      fireEvent.mouseEnter(chip.parentElement as HTMLElement);
      expect(screen.getByRole("tooltip").textContent).toContain(
        "ピア接続とブロック伝播だけが通常表示になり",
      );
    });

    it("shows the 'all' hint on hover", () => {
      renderBar();
      const chip = screen.getByTestId("layer-filter-chip-all");
      fireEvent.mouseEnter(chip.parentElement as HTMLElement);
      expect(screen.getByRole("tooltip").textContent).toBe(
        "全レイヤーを同時に表示します（既定）",
      );
    });
  });
});
