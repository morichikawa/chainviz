// Issue #420 テスト強化: validator→beacon の内部リンクポップオーバーで、
// 活動セクション（Issue #420 で表示するようになった部分）の境界を固定する。
// 単一の提案パルスの表示・鮮度切れのフォールバックは
// InternalLinkEdgePopover.test.tsx が持つので、ここは「複数職務の内訳」
// 「英語表示」「鮮度ちょうど境界」「未知の method」に絞る（1ファイル1責務）。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { InternalLinkEdgePopover } from "./InternalLinkEdgePopover.js";
import { INTERNAL_LINK_FRESHNESS_MS } from "./internalLinkEdge.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

function validatorProps(
  overrides: Partial<Parameters<typeof InternalLinkEdgePopover>[0]> = {},
) {
  return {
    drivingContainerName: "chainviz-ethereum-validator1-1",
    drivenContainerName: "chainviz-ethereum-beacon1-1",
    drivingNodeRole: "validator",
    drivenNodeRole: "consensus",
    ...overrides,
  };
}

describe("InternalLinkEdgePopover validator activity: breakdown contents (Issue #420)", () => {
  it("lists both the block proposal and the attestation of one observation", () => {
    wrap(
      validatorProps({
        lastActivity: {
          calls: [
            { method: "vc_signed_beacon_blocks_total:success", count: 1, latencyMs: 13.4 },
            { method: "vc_signed_attestations_total:success", count: 2, latencyMs: 1.16 },
          ],
          observedAt: Date.now(),
        },
      }),
    );
    expect(
      screen.getByText(
        "vc_signed_beacon_blocks_total:success ×1 (ブロック提案の署名) (平均 13 ms) · " +
          "vc_signed_attestations_total:success ×2 (証明（attestation）の署名) (平均 1 ms)",
      ),
    ).toBeTruthy();
  });

  it("localizes the validator duty breakdown to English", () => {
    wrap(
      validatorProps({
        lastActivity: {
          calls: [{ method: "vc_signed_attestations_total:success", count: 3 }],
          observedAt: Date.now(),
        },
      }),
      "en",
    );
    expect(
      screen.getByText("vc_signed_attestations_total:success ×3 (Sign attestation)"),
    ).toBeTruthy();
  });

  it("shows a non-success status with its classification label and raw status visible", () => {
    wrap(
      validatorProps({
        lastActivity: {
          calls: [{ method: "vc_signed_beacon_blocks_total:slashable", count: 1 }],
          observedAt: Date.now(),
        },
      }),
    );
    expect(
      screen.getByText("vc_signed_beacon_blocks_total:slashable ×1 (ブロック提案の署名)"),
    ).toBeTruthy();
  });

  it("shows an unmapped validator metric as its raw name only", () => {
    wrap(
      validatorProps({
        lastActivity: {
          calls: [{ method: "vc_signed_aggregates_total:success", count: 1 }],
          observedAt: Date.now(),
        },
      }),
    );
    expect(screen.getByText("vc_signed_aggregates_total:success ×1")).toBeTruthy();
    expect(screen.queryByText("最近の呼び出しはありません")).toBeNull();
  });
});

describe("InternalLinkEdgePopover validator activity: freshness boundary (Issue #420)", () => {
  it("still shows the breakdown at exactly the freshness boundary", () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    wrap(
      validatorProps({
        lastActivity: {
          calls: [{ method: "vc_signed_attestations_total:success", count: 1 }],
          observedAt: now - INTERNAL_LINK_FRESHNESS_MS,
        },
      }),
    );
    expect(
      screen.getByText("vc_signed_attestations_total:success ×1 (証明（attestation）の署名)"),
    ).toBeTruthy();
  });

  it("switches to the no-recent-calls fallback one millisecond past the boundary", () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    wrap(
      validatorProps({
        lastActivity: {
          calls: [{ method: "vc_signed_attestations_total:success", count: 1 }],
          observedAt: now - INTERNAL_LINK_FRESHNESS_MS - 1,
        },
      }),
    );
    expect(screen.getByText("最近の呼び出しはありません")).toBeTruthy();
    expect(screen.queryByText(/vc_signed_attestations_total/)).toBeNull();
  });

  it("treats an observation timestamped in the future as fresh (clock skew tolerance)", () => {
    // collector と frontend が別プロセス（別時計）なので、observedAt が
    // わずかに未来になることがある。その場合に「観測が無い」表示へ落ちない
    // ことを固定する。
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    wrap(
      validatorProps({
        lastActivity: {
          calls: [{ method: "vc_signed_attestations_total:success", count: 1 }],
          observedAt: now + 500,
        },
      }),
    );
    expect(
      screen.getByText("vc_signed_attestations_total:success ×1 (証明（attestation）の署名)"),
    ).toBeTruthy();
  });
});

describe("InternalLinkEdgePopover validator activity: unrelated role pairs stay unaffected", () => {
  it("still hides the activity section for an unknown role pair even with fresh VC calls", () => {
    // 役割不明の組（旧スナップショット等）は観測経路が不明なので、Issue #420
    // 以降も活動セクションを出さない（§7.6.11 の判断はこの組には残る）。
    wrap({
      drivingContainerName: "a",
      drivenContainerName: "b",
      lastActivity: {
        calls: [{ method: "vc_signed_attestations_total:success", count: 1 }],
        observedAt: Date.now(),
      },
    });
    expect(screen.queryByText("最近の呼び出しはありません")).toBeNull();
    expect(screen.queryByText(/vc_signed_attestations_total/)).toBeNull();
  });
});
