import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCommsLogFilterState, toggleCommsLogCategory } from "../comms-log/commsLogFilter.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CommsLogFilterBar } from "./CommsLogFilterBar.js";

afterEach(cleanup);

describe("CommsLogFilterBar", () => {
  it("renders one chip per category, all pressed by default", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <CommsLogFilterBar
          filters={defaultCommsLogFilterState()}
          onToggleCategory={vi.fn()}
          onNodeFilterChange={vi.fn()}
          nodeOptions={[]}
        />
      </LanguageProvider>,
    );
    for (const category of ["operation", "internal", "block", "tx", "peer", "environment"]) {
      const chip = screen.getByTestId(`comms-log-filter-${category}`);
      expect(chip.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("reflects a toggled-off category as not pressed", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <CommsLogFilterBar
          filters={toggleCommsLogCategory(defaultCommsLogFilterState(), "internal")}
          onToggleCategory={vi.fn()}
          onNodeFilterChange={vi.fn()}
          nodeOptions={[]}
        />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("comms-log-filter-internal").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("calls onToggleCategory with the clicked category", () => {
    const onToggleCategory = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <CommsLogFilterBar
          filters={defaultCommsLogFilterState()}
          onToggleCategory={onToggleCategory}
          onNodeFilterChange={vi.fn()}
          nodeOptions={[]}
        />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByTestId("comms-log-filter-block"));
    expect(onToggleCategory).toHaveBeenCalledWith("block");
  });

  it("lists the given node options plus 'all', and calls onNodeFilterChange with null for 'all'", () => {
    const onNodeFilterChange = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <CommsLogFilterBar
          filters={{ ...defaultCommsLogFilterState(), nodeId: "reth-1" }}
          onToggleCategory={vi.fn()}
          onNodeFilterChange={onNodeFilterChange}
          nodeOptions={[
            { id: "reth-1", label: "chainviz-reth-1" },
            { id: "wb-1", label: "Alice" },
          ]}
        />
      </LanguageProvider>,
    );
    const select = screen.getByTestId("comms-log-node-filter") as HTMLSelectElement;
    expect(select.value).toBe("reth-1");
    expect(screen.getByText("Alice")).toBeTruthy();

    fireEvent.change(select, { target: { value: "" } });
    expect(onNodeFilterChange).toHaveBeenCalledWith(null);
  });
});
