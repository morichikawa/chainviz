import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SyncProgressBar } from "./SyncProgressBar.js";

afterEach(cleanup);

function fillWidth(container: HTMLElement): string {
  const fill = container.querySelector(".sync-progress-bar__fill");
  return (fill as HTMLElement).style.width;
}

describe("SyncProgressBar", () => {
  it("renders a fill width proportional to value/max", () => {
    const { container } = render(<SyncProgressBar value={64} max={128} />);
    expect(fillWidth(container)).toBe("50%");
  });

  it("clamps to 100% when value exceeds max (defensive, should not overflow visually)", () => {
    const { container } = render(<SyncProgressBar value={200} max={128} />);
    expect(fillWidth(container)).toBe("100%");
  });

  it("clamps to 0% when value is negative (defensive)", () => {
    const { container } = render(<SyncProgressBar value={-10} max={128} />);
    expect(fillWidth(container)).toBe("0%");
  });

  it("renders 0% width when max is 0 (avoids division by zero)", () => {
    const { container } = render(<SyncProgressBar value={0} max={0} />);
    expect(fillWidth(container)).toBe("0%");
  });

  it("renders exactly 100% when value equals max (boundary, fully synced stage)", () => {
    const { container } = render(<SyncProgressBar value={128} max={128} />);
    expect(fillWidth(container)).toBe("100%");
  });

  it("renders 0% width when value is 0 and max is positive (stage not started)", () => {
    const { container } = render(<SyncProgressBar value={0} max={128} />);
    expect(fillWidth(container)).toBe("0%");
  });

  it("exposes progressbar ARIA attributes for accessibility", () => {
    const { getByRole } = render(<SyncProgressBar value={64} max={128} />);
    const bar = getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("64");
    expect(bar.getAttribute("aria-valuemax")).toBe("128");
  });
});
