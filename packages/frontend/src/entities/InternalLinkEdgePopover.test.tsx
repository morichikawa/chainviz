import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { InternalLinkEdgePopover, isActivityFresh } from "./InternalLinkEdgePopover.js";
import { INTERNAL_LINK_FRESHNESS_MS } from "./internalLinkEdge.js";

afterEach(cleanup);

function wrap(
  props: Parameters<typeof InternalLinkEdgePopover>[0],
  lang: "ja" | "en" = "ja",
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <InternalLinkEdgePopover {...props} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("isActivityFresh", () => {
  it("is fresh exactly at the freshness boundary", () => {
    expect(isActivityFresh(0, INTERNAL_LINK_FRESHNESS_MS)).toBe(true);
  });

  it("is stale just past the freshness boundary", () => {
    expect(isActivityFresh(0, INTERNAL_LINK_FRESHNESS_MS + 1)).toBe(false);
  });

  it("is fresh for an observation in the past within the window", () => {
    expect(isActivityFresh(5_000, 6_000)).toBe(true);
  });

  it("treats a future-dated observation as fresh (guards against negative diffs on clock skew)", () => {
    // observedAt が now より未来（軽微なクロックスキュー）でも now-observedAt が
    // 負になるだけで freshnessMs 以下となり、鮮度切れ扱いにはならない。
    expect(isActivityFresh(10_000, 9_000)).toBe(true);
  });
});

describe("InternalLinkEdgePopover", () => {
  it("has a tooltip role for accessibility", () => {
    wrap({ drivingContainerName: "chainviz-lighthouse-1", drivenContainerName: "chainviz-reth-1" });
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("shows the endpoint pair as drivingContainerName -> drivenContainerName", () => {
    wrap({ drivingContainerName: "chainviz-lighthouse-1", drivenContainerName: "chainviz-reth-1" });
    expect(
      screen.getByText("chainviz-lighthouse-1 → chainviz-reth-1"),
    ).toBeTruthy();
  });

  it("shows the no-recent-calls fallback when there is no last activity", () => {
    wrap({ drivingContainerName: "a", drivenContainerName: "b" });
    expect(screen.getByText("最近の呼び出しはありません")).toBeTruthy();
  });

  it("shows the no-recent-calls fallback when the last activity is stale", () => {
    const observedAt = Date.now() - INTERNAL_LINK_FRESHNESS_MS - 1;
    wrap({
      drivingContainerName: "a",
      drivenContainerName: "b",
      lastActivity: { calls: [{ method: "engine_newPayloadV4", count: 2 }], observedAt },
    });
    expect(screen.getByText("最近の呼び出しはありません")).toBeTruthy();
  });

  it("shows the recent call breakdown when the last activity is fresh", () => {
    wrap({
      drivingContainerName: "a",
      drivenContainerName: "b",
      lastActivity: {
        calls: [
          { method: "engine_newPayloadV4", count: 2 },
          { method: "engine_forkchoiceUpdatedV3", count: 2, latencyMs: 12 },
        ],
        observedAt: Date.now(),
      },
    });
    expect(screen.queryByText("最近の呼び出しはありません")).toBeNull();
    expect(
      screen.getByText(
        "engine_newPayloadV4 ×2 (ブロックの実行依頼) · engine_forkchoiceUpdatedV3 ×2 (チェーン先端の更新) (平均 12 ms)",
      ),
    ).toBeTruthy();
  });

  it("shows the recent-calls header (not the no-calls fallback) for a fresh observation whose calls happen to be empty", () => {
    // 鮮度切れ表示の判定は observedAt の新しさだけで決まり、calls の中身の
    // 有無では切り替わらない。実運用では collector が calls 空の観測を送らない
    // ため空リスト時の内訳は出ないが、判定の分岐がどちらに倒れるかを固定する。
    wrap({
      drivingContainerName: "a",
      drivenContainerName: "b",
      lastActivity: { calls: [], observedAt: Date.now() },
    });
    expect(screen.queryByText("最近の呼び出しはありません")).toBeNull();
  });

  it("shows the English sentence structure when the language is English", () => {
    wrap(
      { drivingContainerName: "a", drivenContainerName: "b" },
      "en",
    );
    expect(screen.getByText("No recent calls")).toBeTruthy();
  });
});
