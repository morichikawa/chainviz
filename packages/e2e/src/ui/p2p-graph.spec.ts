// B層(P2Pグラフ, UI-B-01〜UI-B-03)。packages/e2e/SCENARIOS.md「B層: P2P
// グラフ(UI-B)」節の実装(docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// エッジ自体には ARCHITECTURE.md §8.5 の方針どおり追加計装をしないため、
// React Flow が自動で付与する `data-id`（edge id = `peer-<networkId>::<lo>::<hi>`。
// `entities/peerEdge.ts` の `peerEdgesToFlowEdges` 参照）の部分一致で特定する。

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { serviceEntityId } from "./support/serviceIds.js";

/** B層のピア接続ポーリング間隔(`PEER_POLL_INTERVAL_MS`,
 * packages/collector/src/adapters/ethereum/index.ts)は 3000ms。既存スタック
 * (globalSetup が再利用)はピア確立済みの前提だが、コールドスタート分の
 * 余裕も見て 30 秒を待ち上限にする。 */
const PEER_EDGE_TIMEOUT_MS = 30_000;

/**
 * ブロック伝播パルス(UI-B-03)の待ち上限。`profiles/ethereum/values.env` の
 * `SLOT_DURATION_IN_SECONDS=2`（1スロット=2秒）を根拠に、その15倍を待ち
 * 上限にする。パルスは新しいブロックが2ノード以上に受信されるたびに毎
 * スロット発生しうるため理論上は次スロットで観測できるが、Playwright の
 * expect ポーリング間隔・パルスの表示時間フロア(`MIN_PULSE_DURATION_MS` =
 * 450ms、`entities/blockPulse.ts`)を踏まえて余裕を持たせている。
 *
 * 前提条件: この倍率(15倍)は `SLOT_DURATION_IN_SECONDS=2` を前提にした
 * ものなので、プロファイルのスロット時間を変える場合はこの倍率を保った
 * まま値を見直すこと(固定秒数そのものを使い回さない)。
 */
const SLOT_DURATION_SECONDS = 2;
const BLOCK_PULSE_TIMEOUT_MS = SLOT_DURATION_SECONDS * 1000 * 15;

/** 2つのエンティティ間のピアエッジ(`data-id` が `peer-` で始まる)のロケータ。 */
function peerEdgeBetween(page: Page, a: string, b: string) {
  return page.locator(`[data-id^="peer-"][data-id*="${a}"][data-id*="${b}"]`);
}

test("UI-B-01: ノードカード間に P2P エッジが描画される", async ({ page }) => {
  await test.step("frontend を開き、ピア観測の反映を待つ", async () => {
    await page.goto("/");
  });

  await test.step(
    "beacon1 と beacon2 のカード間にピアエッジ（data-id が peer- で始まる React Flow エッジ）が描画される",
    async () => {
      await expect(
        peerEdgeBetween(page, serviceEntityId("beacon1"), serviceEntityId("beacon2")),
      ).toHaveCount(1, { timeout: PEER_EDGE_TIMEOUT_MS });
    },
  );

  await test.step(
    "reth 同士のあいだにもピアエッジが描画される（Issue #106/#124）",
    async () => {
      await expect(
        peerEdgeBetween(page, serviceEntityId("reth1"), serviceEntityId("reth2")),
      ).toHaveCount(1, { timeout: PEER_EDGE_TIMEOUT_MS });
    },
  );
});

test("UI-B-04: P2P 非参加ノード（validator）に接続確立中エッジが固着しない", async ({
  page,
}) => {
  // Issue #214 の回帰防止。validator client(VC) は libp2p の P2P に参加せず
  // PeerEdge を持たないため、修正前は VC から consensus ブートノードへの
  // 「接続確立中」エッジ（.connecting-edge）が永久に解消されず固着していた。
  await page.goto("/");

  await test.step(
    "P2P グラフが確立するまで（既存ノード間のピアエッジが描画されるまで）待つ",
    async () => {
      // これが出れば導出パイプラインが一巡し、未接続でないノードの
      // 接続確立中エッジは既に消えている状態になる。以降に残る
      // .connecting-edge があれば VC 由来の固着を意味する。
      await expect(
        peerEdgeBetween(
          page,
          serviceEntityId("beacon1"),
          serviceEntityId("beacon2"),
        ),
      ).toHaveCount(1, { timeout: PEER_EDGE_TIMEOUT_MS });
    },
  );

  await test.step(
    "キャンバス上に接続確立中エッジ（.connecting-edge）が 1 本も存在しない",
    async () => {
      // validator を含め、どのノードにも接続確立中エッジが固着していないこと。
      await expect(page.locator(".connecting-edge")).toHaveCount(0);
    },
  );
});

test("UI-B-02: ネットワーク凡例にネットワークごとの接続数が出る", async ({ page }) => {
  await page.goto("/");
  // 凡例はピアエッジが1本以上あるときだけ表示される(PeerNetworkLegend.tsx)。
  await expect(
    peerEdgeBetween(page, serviceEntityId("beacon1"), serviceEntityId("beacon2")),
  ).toHaveCount(1, { timeout: PEER_EDGE_TIMEOUT_MS });

  await test.step(
    "P2P 凡例（p2p-legend）が表示され、ネットワーク ID ごとの接続数が 1 以上で表示される",
    async () => {
      const legend = page.getByTestId("p2p-legend");
      await expect(legend).toBeVisible();

      const counts = legend.locator('[data-testid^="p2p-legend-count-"]');
      await expect(counts.first()).toBeVisible();
      const values = await counts.allTextContents();
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(Number(value)).toBeGreaterThanOrEqual(1);
      }
    },
  );
});

test("UI-B-03: ブロック伝播パルスがエッジ上に現れる", async ({ page }) => {
  // このシナリオはブロック生成のスロット時間に応じた待ちが必要なため、
  // テスト全体のタイムアウトを個別に緩める(既定 60 秒だと余裕が無い)。
  test.setTimeout(BLOCK_PULSE_TIMEOUT_MS + 30_000);

  await test.step("チェーンが進行し続けている（数秒ごとに新ブロック）", async () => {
    // globalSetup が再利用する既存スタックは継続稼働中で、チェーンは
    // 常に進行している前提（ensureChainRunning() 参照）。
  });

  await page.goto("/");
  // パルスが走るエッジ自体が先に描画されている必要がある。
  await expect(
    peerEdgeBetween(page, serviceEntityId("beacon1"), serviceEntityId("beacon2")),
  ).toHaveCount(1, { timeout: PEER_EDGE_TIMEOUT_MS });

  await test.step("ピアエッジを注視して待つ（スロット時間の数倍まで）", async () => {
    // 次のステップの expect 自体が「待つ」操作を兼ねる。
  });

  await test.step(
    "いずれかのエッジ上に伝播パルス要素（peer-pulse）が少なくとも 1 回出現する",
    async () => {
      await expect(page.locator(".peer-pulse").first()).toBeVisible({
        timeout: BLOCK_PULSE_TIMEOUT_MS,
      });
    },
  );
});
