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

/**
 * consensus→execution（beacon→reth。Engine API）の役割組を明示したデフォルト
 * props。役割不明時のフォールバック挙動（Issue #285）と区別するため、既存の
 * Engine API 表現を検証するテストは明示的にこの役割組を渡す（実運用では
 * Issue #215 のラベル付与により nodeRole は必ず入っている）。
 */
function engineApiProps(
  overrides: Partial<Parameters<typeof InternalLinkEdgePopover>[0]> = {},
) {
  return {
    drivingContainerName: "chainviz-lighthouse-1",
    drivenContainerName: "chainviz-reth-1",
    drivingNodeRole: "consensus",
    drivenNodeRole: "execution",
    ...overrides,
  };
}

describe("InternalLinkEdgePopover layer badge (Issue #299)", () => {
  it("shows the D-layer badge in the heading", () => {
    wrap(engineApiProps());
    expect(screen.getByTestId("layer-badge-d")).toBeTruthy();
  });
});

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

describe("InternalLinkEdgePopover (consensus→execution, Engine API)", () => {
  it("has a tooltip role for accessibility", () => {
    wrap(engineApiProps());
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("shows the endpoint pair as drivingContainerName -> drivenContainerName", () => {
    wrap(engineApiProps());
    expect(
      screen.getByText("chainviz-lighthouse-1 → chainviz-reth-1"),
    ).toBeTruthy();
  });

  it("shows the Engine API heading with its glossary anchor", () => {
    wrap(engineApiProps());
    expect(screen.getByText("内部リンク（Engine API）")).toBeTruthy();
  });

  it("shows the no-recent-calls fallback when there is no last activity", () => {
    wrap(engineApiProps({ drivingContainerName: "a", drivenContainerName: "b" }));
    expect(screen.getByText("最近の呼び出しはありません")).toBeTruthy();
  });

  it("shows the no-recent-calls fallback when the last activity is stale", () => {
    const observedAt = Date.now() - INTERNAL_LINK_FRESHNESS_MS - 1;
    wrap(
      engineApiProps({
        drivingContainerName: "a",
        drivenContainerName: "b",
        lastActivity: { calls: [{ method: "engine_newPayloadV4", count: 2 }], observedAt },
      }),
    );
    expect(screen.getByText("最近の呼び出しはありません")).toBeTruthy();
  });

  it("shows the recent call breakdown when the last activity is fresh", () => {
    wrap(
      engineApiProps({
        drivingContainerName: "a",
        drivenContainerName: "b",
        lastActivity: {
          calls: [
            { method: "engine_newPayloadV4", count: 2 },
            { method: "engine_forkchoiceUpdatedV3", count: 2, latencyMs: 12 },
          ],
          observedAt: Date.now(),
        },
      }),
    );
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
    wrap(
      engineApiProps({
        drivingContainerName: "a",
        drivenContainerName: "b",
        lastActivity: { calls: [], observedAt: Date.now() },
      }),
    );
    expect(screen.queryByText("最近の呼び出しはありません")).toBeNull();
  });

  it("shows the English sentence structure when the language is English", () => {
    wrap(
      engineApiProps({ drivingContainerName: "a", drivenContainerName: "b" }),
      "en",
    );
    expect(screen.getByText("No recent calls")).toBeTruthy();
  });
});

describe("InternalLinkEdgePopover (validator→consensus, Beacon API, Issue #285)", () => {
  function beaconApiProps(
    overrides: Partial<Parameters<typeof InternalLinkEdgePopover>[0]> = {},
  ) {
    return {
      drivingContainerName: "chainviz-validator-1",
      drivenContainerName: "chainviz-lighthouse-1",
      drivingNodeRole: "validator",
      drivenNodeRole: "consensus",
      ...overrides,
    };
  }

  it("shows the Beacon API heading with its glossary anchor", () => {
    wrap(beaconApiProps());
    expect(screen.getByText("内部リンク（Beacon API）")).toBeTruthy();
  });

  it("shows the validator-specific description sentence", () => {
    wrap(beaconApiProps());
    expect(
      screen.getByText(
        "このバリデーターは、この beacon ノードに Beacon API で接続し、担当スロットでのブロック提案・証明を行います。チェーンを前に進める起点です",
      ),
    ).toBeTruthy();
  });

  it("hides the recent-calls section entirely, even when lastActivity is fresh (no observed call path)", () => {
    wrap(
      beaconApiProps({
        lastActivity: {
          calls: [{ method: "beacon_publishBlock", count: 1 }],
          observedAt: Date.now(),
        },
      }),
    );
    expect(screen.queryByText("最近の呼び出しはありません")).toBeNull();
    expect(screen.queryByText(/beacon_publishBlock/)).toBeNull();
  });

  it("localizes the Beacon API heading to English", () => {
    wrap(beaconApiProps(), "en");
    expect(screen.getByText("Internal link (Beacon API)")).toBeTruthy();
  });
});

describe("InternalLinkEdgePopover (unknown role pair fallback, Issue #285)", () => {
  it("shows a generic heading without a glossary anchor when both roles are undefined (legacy snapshot)", () => {
    wrap({ drivingContainerName: "a", drivenContainerName: "b" });
    expect(screen.getByText("内部リンク")).toBeTruthy();
    expect(screen.queryByText("内部リンク（Engine API）")).toBeNull();
    expect(screen.queryByText("内部リンク（Beacon API）")).toBeNull();
  });

  it("shows the generic fallback description sentence", () => {
    wrap({ drivingContainerName: "a", drivenContainerName: "b" });
    expect(
      screen.getByText("この2つのコンテナは内部リンクで接続されています。"),
    ).toBeTruthy();
  });

  it("hides the recent-calls section even with a fresh lastActivity (role pair unmapped)", () => {
    wrap({
      drivingContainerName: "a",
      drivenContainerName: "b",
      drivingNodeRole: "execution",
      drivenNodeRole: "validator",
      lastActivity: { calls: [{ method: "x", count: 1 }], observedAt: Date.now() },
    });
    expect(screen.queryByText("最近の呼び出しはありません")).toBeNull();
  });
});
