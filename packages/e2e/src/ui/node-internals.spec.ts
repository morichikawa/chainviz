// D層(ノード内部, UI-D-01〜UI-D-03)。packages/e2e/SCENARIOS.md「D層: ノード内部
// (UI-D)」節の実装(docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// 前提のIssue #188(内部リンクエッジの常設描画・活動パルス)・#189(同期
// ステージ・mempool内訳の表示)が実装済みであることが前提(SCENARIOS.md の
// `保` マーカーは本Issueで解消する)。対応する frontend 実装は
// entities/InternalLinkEdge.tsx・internalLinkEdge.ts・
// InfraPopoverSyncStages.tsx・InfraPopover.tsx(docs/worklog/issue-203.md
// 設計メモ参照)。

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { dispatchHover, descendantContainingTestId } from "./support/interactions.js";
import { serviceEntityId } from "./support/serviceIds.js";

/**
 * 駆動ペア(beacon(CL) → reth(EL))。`profiles/ethereum` の compose 定義
 * (Issue #186 実装時点)では beacon1 が reth1 を Engine API で駆動する
 * 固定ペアリング(EXECUTION_ENDPOINT)。`packages/e2e/src/d-layer.test.ts` の
 * DRIVING_BEACON/DRIVEN_RETH と同じ前提。ペアが変わる場合はこの対応も
 * 見直すこと。
 */
const DRIVING_BEACON_ID = serviceEntityId("beacon1");
const DRIVEN_RETH_ID = serviceEntityId("reth1");

/**
 * frontend 側の内部リンクエッジ ID 生成規則
 * (`packages/frontend/src/entities/internalLinkEdge.ts` の
 * `internalLinkEdgeId()`)を再現したもの。`packages/e2e` は frontend に
 * 依存しない(package.json 参照)ため文字列リテラルとして複製する
 * (`contract-lifecycle.spec.ts` の deploy edge id と同じ既存の流儀)。
 * frontend 側の実装を変更する場合はここも合わせること。
 */
function internalLinkEdgeId(fromNodeId: string, toNodeId: string): string {
  return `internal-link-${fromNodeId}=>${toNodeId}`;
}

const INTERNAL_LINK_EDGE_ID = internalLinkEdgeId(DRIVING_BEACON_ID, DRIVEN_RETH_ID);

/**
 * 内部リンクエッジ(常設)のロケータ。`data-id` は frontend が明示的に
 * 採番している ID そのものなので完全一致で特定できる(peerEdge の
 * `data-id` 部分一致とは異なる。`p2p-graph.spec.ts` 参照)。
 */
function internalLinkEdge(page: Page): Locator {
  return page.locator(`[data-id="${INTERNAL_LINK_EDGE_ID}"]`);
}

/**
 * A層の Docker ポーリング間隔(`POLL_INTERVAL_MS`,
 * `packages/collector/src/index.ts`)は 3000ms。`NodeEntity.drivesNodeId`
 * (内部リンクエッジの土台)はこのポーリング(`pollInfra`)で解決されるため、
 * `infra-display.spec.ts` の `INFRA_SNAPSHOT_TIMEOUT_MS` と同じ根拠・同じ値
 * (約6.5倍)を初回表示待ちの上限にする。
 */
const A_LAYER_POLL_TIMEOUT_MS = 20_000;

/**
 * D層のノード内部メトリクス(reth `/metrics`)のスクレイプ間隔
 * (`NODE_INTERNALS_POLL_INTERVAL_MS`、既定3000ms。
 * `packages/collector/src/adapters/ethereum/reth-metrics-tracker.ts`)。
 * frontend 側の複製は `entities/internalLinkEdge.ts` の
 * `INTERNAL_LINK_POLL_INTERVAL_MS`(値を変更したら両方合わせること、という
 * 申し送りがそちらのコメントにある)。
 */
const NODE_INTERNALS_POLL_INTERVAL_MS = 3000;

/**
 * ノード内部状態(同期ステージ・txpool内訳)の初回反映を待つ上限。
 * syncStages/mempool は Engine API 呼び出し回数のような差分計算を要さず
 * 1回のスクレイプで値が載るため理論上は1ポーリング間隔で反映されるが、
 * `d-layer.test.ts`(プロトコル層。同じ観測を検証する既存テストの
 * `INTERNALS_TIMEOUT_MS`)と同じ桁数・同じ考え方の余裕(コールドスタート・
 * ネットワーク揺らぎ分)を踏襲する。
 */
const INTERNALS_TIMEOUT_MS = 60_000;

/**
 * 活動パルス(`nodeLinkActivity` 由来)の初回出現を待つ上限。
 * `d-layer.test.ts`(プロトコル層)の `LINK_ACTIVITY_TIMEOUT_MS` と同じ
 * 観測対象・同じ値(60秒)を採用する。`RethMetricsTracker` は初回スクレイプを
 * ベースライン記録のみに使う(観測を配信しない)ため、最短でも
 * `NODE_INTERNALS_POLL_INTERVAL_MS` の2倍(6秒)を要する。60秒はさらに
 * コールドスタート・ネットワーク揺らぎ分の余裕を積んだ値。
 */
const FIRST_PULSE_TIMEOUT_MS = 60_000;

/**
 * パルス1個の表示時間(`INTERNAL_LINK_PULSE_DURATION_MS`、既定900ms。
 * frontend の `entities/internalLinkEdge.ts`)。前提: この値を変えたら
 * ここも合わせること。パルス消滅の確認に、表示時間+アニメーション/
 * レンダリングの揺らぎ分の余裕(5倍)を待ち上限にする。
 */
const PULSE_DURATION_MS = 900;
const PULSE_DISAPPEAR_TIMEOUT_MS = PULSE_DURATION_MS * 5;

/**
 * 2回目のパルス出現(周期性の確認)を待つ上限。前提条件: `profiles/ethereum`
 * の slot 時間(既定2秒、`SLOT_DURATION_IN_SECONDS`。`p2p-graph.spec.ts`
 * 参照)がポーリング間隔(3秒)より短く、毎ポーリングで Engine API 呼び出しの
 * 増分が生じること。この前提が崩れる(slot 時間をポーリング間隔以上に
 * 延ばす)場合はこの倍率を保ったまま値を見直すこと。
 */
const SECOND_PULSE_TIMEOUT_MS = NODE_INTERNALS_POLL_INTERVAL_MS * 5;

/**
 * 周期性(「流れ続ける」)を確認するために観測する「出現→消滅」サイクルの回数。
 * 1サイクルだけでは「たまたま1回出て消えた」可能性が残るため、複数回くり返し
 * 観測して単発の出現と区別する。各サイクルはポーリング間隔(3秒)相当なので、
 * 実測ではおおよそ `PULSE_CYCLES × 3秒` 程度で完了する(タイムアウトは worst
 * case の上限であり通常はそこまで待たない)。
 */
const PULSE_CYCLES = 2;

/**
 * 対象エッジ上のパルスが「出現→消滅」を `cycles` 回くり返し、最後にもう一度
 * 出現するところまで確認する。1観測=1パルスの設計(useNodeLinkActivityPulses)で
 * 対象エッジにスコープしたカウントは常に0か1になるため、count 1 → 0 の交互
 * 確認をくり返すことで「周期的に流れ続ける」ことを単発の出現と区別して検証
 * できる。最後の出現まで見るのは「最終的に消えて終わり」の状態と区別するため。
 */
async function expectSustainedPulseCycles(
  pulse: Locator,
  cycles: number,
): Promise<void> {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    // 初回の出現だけコールドスタート分の長い上限、以降は周期内で出るはずなので
    // 短い上限を使う(タイムアウト根拠は各定数の doc コメント参照)。
    const appearTimeout =
      cycle === 0 ? FIRST_PULSE_TIMEOUT_MS : SECOND_PULSE_TIMEOUT_MS;
    await expect(pulse).toHaveCount(1, { timeout: appearTimeout });
    await expect(pulse).toHaveCount(0, { timeout: PULSE_DISAPPEAR_TIMEOUT_MS });
  }
  await expect(pulse).toHaveCount(1, { timeout: SECOND_PULSE_TIMEOUT_MS });
}

test("UI-D-01: beacon→reth の内部リンクエッジが常設表示される", async ({ page }) => {
  await page.goto("/");

  await test.step(
    "beacon1 → reth1 のあいだに内部リンクエッジ（無彩色・二重線）が常設で描画される（ピアエッジとは別系統の見た目）",
    async () => {
      const edge = internalLinkEdge(page);
      await expect(edge).toHaveCount(1, { timeout: A_LAYER_POLL_TIMEOUT_MS });

      // 「ピアエッジとは別系統の見た目」= React Flow が type から自動付与
      // する修飾クラス(react-flow__edge-<type>)と、internalLinkEdge.ts が
      // 付ける専用クラスの両方で、ピアエッジ(react-flow__edge-peer /
      // peer-edge)と判別できることを確認する。
      await expect(edge).toHaveClass(/react-flow__edge-internalLink/);
      await expect(edge).toHaveClass(/internal-link-edge\b/);

      // 「別系統の見た目」を正の確認だけで済ませると、たとえば内部リンク
      // エッジが誤ってピアエッジとして描かれても検出できない。ピアエッジが
      // 付与するクラス(react-flow__edge-peer / peer-edge。peerEdge.ts)を
      // 持たないことを否定側でも固定し、両系統が確実に別物であることを担保する。
      await expect(edge).not.toHaveClass(/react-flow__edge-peer\b/);
      await expect(edge).not.toHaveClass(/\bpeer-edge\b/);

      // 二重線(鞘+芯)は BaseEdge(鞘)に加えて専用の <path>(芯)を重ねて
      // 描く(InternalLinkEdge.tsx)。芯の要素が実在することで確認する。
      await expect(edge.locator(".internal-link-edge__core")).toHaveCount(1);
    },
  );
});

test("UI-D-02: Engine API の活動パルスが流れ続ける", async ({ page }) => {
  // パルスの初回出現に加え、周期性の確認として「出現→消滅」を複数サイクル
  // + 最終出現まで待つため、既定の60秒では足りない。個別に緩める
  // (p2p-graph.spec.ts の UI-B-03 と同じ考え方)。worst case は
  // 初回出現(FIRST) + 各サイクルの(出現SECOND + 消滅DISAPPEAR) + 最終出現
  // (SECOND) の合計に、goto・ホバー内訳確認分の余裕(40秒)を足した値。
  test.setTimeout(
    FIRST_PULSE_TIMEOUT_MS +
      PULSE_CYCLES * (SECOND_PULSE_TIMEOUT_MS + PULSE_DISAPPEAR_TIMEOUT_MS) +
      SECOND_PULSE_TIMEOUT_MS +
      40_000,
  );

  await test.step(
    "チェーンが進行し続けている（slot ごとに Engine API 呼び出しがある）",
    async () => {
      // globalSetup が再利用する既存スタックは継続稼働中で、チェーンは
      // 常に進行している前提(ensureChainRunning() 参照。UI-B-03 と同じ前提)。
    },
  );

  await page.goto("/");
  const edge = internalLinkEdge(page);
  await expect(edge).toHaveCount(1, { timeout: A_LAYER_POLL_TIMEOUT_MS });
  const pulse = edge.locator(".internal-link-pulse");

  await test.step("内部リンクエッジ上に活動パルスが周期的に現れる", async () => {
    // 「周期的に流れ続ける」を1回きりの出現と区別するため、出現→消滅を
    // 複数サイクルくり返し観測する(単発なら2サイクル目で detect できない)。
    await expectSustainedPulseCycles(pulse, PULSE_CYCLES);
  });

  await test.step(
    "エッジへのホバーで直近の呼び出し回数の内訳が見える",
    async () => {
      // beacon1/reth1 のカード配置によっては内部リンクエッジの経路が隣接する
      // 他ノードカードの当たり判定と重なり、実マウス座標での `hover()` が
      // そちらへ吸われて実行不能(intercepts pointer events)になることを実機で
      // 確認した(理由の詳細は dispatchHover の doc コメント)。座標ベースの
      // 当たり判定を経由しない dispatchHover で確実にホバーを発火させる。
      await dispatchHover(edge);
      const popover = page.locator(".internal-link-popover");
      await expect(popover).toBeVisible();

      const calls = popover.locator(".internal-link-popover__calls");
      await expect(calls).toBeVisible();
      // formatInternalCallList (internalLinkActivity.ts) は
      // `<method> ×<count>` 形式で内訳を組み立てる。"×" は言語非依存の
      // 記号なので、内訳が数値付きで表示されていることを言語切り替えとは
      // 無関係に確認できる。
      await expect(calls).toHaveText(/×\d+/);
    },
  );
});

test("UI-D-03: ノード詳細に同期ステージと txpool 内訳が表示される", async ({
  page,
}) => {
  await page.goto("/");
  const card = page.getByTestId(`infra-card-${DRIVEN_RETH_ID}`);
  await expect(card).toBeVisible({ timeout: A_LAYER_POLL_TIMEOUT_MS });
  const popover = card.getByTestId(`infra-popover-${DRIVEN_RETH_ID}`);

  await test.step("reth ノードのカードにホバーしてポップオーバーを開く", async () => {
    await card.hover();
    await expect(popover).toBeVisible();
  });

  await test.step("同期ステージの進行状況が表示される", async () => {
    // InfraPopover.tsx は data-testid を持たないため、専用の CSS クラス
    // (InfraPopoverSyncStages.tsx)で特定する。ホバーを維持したまま
    // (mouse を動かさない)自動リトライで反映を待つ(entity 更新は hover
    // 状態を変えない。InfraNodeCard.tsx のローカル state のため)。
    const stagesSection = popover.locator(".infra-popover__sync-stages");
    await expect(stagesSection).toBeVisible({ timeout: INTERNALS_TIMEOUT_MS });

    const rows = stagesSection.locator(".infra-popover__sync-stage-row");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // 各ステージ行にチェックポイント(進行状況の数値)が載っていることを
    // 確認する(数値であること自体が「進行状況」の最小限の証跡)。
    const checkpointText = await rows.first().locator(".infra-field__value").textContent();
    expect(Number(checkpointText)).toBeGreaterThanOrEqual(0);
  });

  await test.step("txpool の pending / queued 件数が表示される", async () => {
    // txpool 行も data-testid が無いため、内包する GlossaryTerm の
    // testid(glossary-term-txpool)を子孫に持つ行(.infra-field)を絞り込む。
    // Locator.filter({has: ...}) は別インスタンスの Locator を組み合わせると
    // 解決に失敗するため、ネイティブ CSS の :has() を使う共有ヘルパーで指定する
    // (理由の詳細は descendantContainingTestId の doc コメント)。
    const txpoolField = descendantContainingTestId(
      popover,
      ".infra-field",
      "glossary-term-txpool",
    );
    await expect(txpoolField).toBeVisible({ timeout: INTERNALS_TIMEOUT_MS });

    // txpool.value のメッセージは日本語・英語で同一文言
    // (`pending {pending} · queued {queued}`)なので、言語切り替えとは
    // 無関係に安定して確認できる。
    await expect(txpoolField.locator(".infra-field__value")).toHaveText(
      /pending \d+ · queued \d+/,
    );
  });
});
