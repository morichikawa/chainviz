### 2026-07-10 Issue #203 D層UIシナリオ(UI-D)のPlaywright実装(設計メモ)

- 担当: collector
- ブランチ: issue-203-ui-d-scenarios

#### 設計メモ(着手前)

`packages/e2e/SCENARIOS.md`「D層: ノード内部(UI-D)」節の3シナリオ
(UI-D-01〜03)を実装する。前提のIssue #188(内部リンクエッジの常設描画・
活動パルス)・#189(同期ステージ・mempool内訳の表示)は実装済みで、
`packages/frontend/src/entities/InternalLinkEdge.tsx` /
`internalLinkEdge.ts` / `InfraPopoverSyncStages.tsx` / `InfraPopover.tsx`
に対応する実装がある。実装対象は新規ファイル
`packages/e2e/src/ui/node-internals.spec.ts` の1ファイル(3シナリオ程度の
規模なので既存の `p2p-graph.spec.ts` 等と同じ粒度でまとめる)。

**ロケータ方針**:

- 内部リンクエッジは `internalLinkEdge.ts` の `internalLinkEdgeId()`
  (`internal-link-${from}=>${to}`)が React Flow の edge id にそのまま
  使われるため、`[data-id="..."]` の完全一致で特定できる(peerEdgeの
  部分一致とは異なり、deploy edge と同じ完全一致方式。
  `contract-lifecycle.spec.ts` 参照)。`packages/e2e` は `frontend` に
  依存しないため(package.json参照)、id生成規則を文字列リテラルとして
  spec内に複製する(deploy edge id と同じ既存の流儀)。
- エッジの「別系統の見た目」は、React Flow が type から自動付与する
  `react-flow__edge-internalLink` と、`internalLinkEdge.ts` がedgeへ
  付ける `internal-link-edge` クラスの両方で確認する(ピアエッジの
  `react-flow__edge-peer`/`peer-edge`と対比)。「二重線」は `BaseEdge`
  (鞘)に加えて専用の `<path className="internal-link-edge__core">`
  (芯)が実在することで確認する。
- 活動パルスは `.internal-link-pulse`(`InternalLinkEdge.tsx`)。1観測=
  1パルスの設計(`useNodeLinkActivityPulses.ts`)なので、対象エッジに
  スコープしたロケータのカウントは常に0か1。「周期的に現れる」ことを
  1回きりの出現と区別するため、出現→消滅→再出現の3段階を実際に確認する
  (`p2p-graph.spec.ts`のUI-B-03は1回の出現のみ確認するが、D-02は
  SCENARIOS.mdの文言が明示的に「周期的」を要求するため一段厳しくする)。
- ホバー時のポップオーバー内訳は `InternalLinkEdgePopover.tsx` の
  `.internal-link-popover__calls`(`formatInternalCallList`が
  `<method> ×<count>` 形式で生成)。`×`は言語非依存の記号なので、
  `/×\d+/` で内訳が数値付きで表示されていることを言語に依存せず確認する。
- 同期ステージ・txpoolは `InfraPopover.tsx` から `data-testid` が無いため、
  既存のCSSクラス(`.infra-popover__sync-stages` /
  `.infra-popover__sync-stage-row`)と、`GlossaryTerm`が付ける
  `data-testid="glossary-term-txpool"`を組み合わせて特定する。txpoolの
  値表示(`txpool.value`メッセージ)は日本語・英語で文言が同じ
  (`pending {pending} · queued {queued}`)なため、`/pending \d+ · queued \d+/`
  でのアサーションは言語切り替えとは無関係に安定する。

**タイムアウトの根拠(固定値を使う場合の前提条件)**:

- `A_LAYER_POLL_TIMEOUT_MS`(20秒): `drivesNodeId`はA層の
  Dockerポーリング(`POLL_INTERVAL_MS`=3000ms、`packages/collector/src/index.ts`)
  で解決されるため、`infra-display.spec.ts`の`INFRA_SNAPSHOT_TIMEOUT_MS`と
  同じ根拠・同じ値(約6.5倍)を内部リンクエッジ・カードの初回表示待ちに使う。
- `INTERNALS_TIMEOUT_MS`(60秒): 同期ステージ・txpool内訳は
  `NODE_INTERNALS_POLL_INTERVAL_MS`(3000ms)のスクレイプ由来。差分計算を
  要さない値(1回のスクレイプで載る)だが、`d-layer.test.ts`(プロトコル層で
  同じ観測を検証する既存テスト)の`INTERNALS_TIMEOUT_MS`と同じ桁数・
  同じ考え方の余裕(コールドスタート・ネットワーク揺らぎ分)を踏襲する。
- `FIRST_PULSE_TIMEOUT_MS`(60秒): `d-layer.test.ts`の
  `LINK_ACTIVITY_TIMEOUT_MS`と同じ観測対象(`nodeLinkActivity`)・同じ値。
  `RethMetricsTracker`は初回スクレイプをベースライン記録のみに使う
  (出力しない)ため理論上の最短は`NODE_INTERNALS_POLL_INTERVAL_MS`の2倍
  (6秒)だが、コールドスタート・揺らぎ分の余裕を60秒まで積む。
- `PULSE_DISAPPEAR_TIMEOUT_MS`(4.5秒 = パルス表示時間900ms×5):
  `InternalLinkEdge`のパルス表示時間(`INTERNAL_LINK_PULSE_DURATION_MS`=
  900ms。frontend側のコピー。値を変えたら両方合わせること、という
  申し送りが`internalLinkEdge.ts`のコメントにある)に対し、アニメーション・
  レンダリングの揺らぎ分の余裕として5倍を待ち上限にする。
- `SECOND_PULSE_TIMEOUT_MS`(`NODE_INTERNALS_POLL_INTERVAL_MS`×5=15秒):
  前提条件は「slot時間(既定2秒。`profiles/ethereum/values.env`の
  `SLOT_DURATION_IN_SECONDS`)がポーリング間隔(3秒)より短く、毎ポーリングで
  Engine API呼び出しの増分が生じる」こと。この前提が崩れる(slot時間を
  ポーリング間隔以上に延ばす)場合はこの倍率を保ったまま値を見直すこと。

**完了条件との対応**: この3シナリオの実装・green化で
`docs/PLAN.md`ステップ10の完了条件(SCENARIOS.mdのUIシナリオが`保`を
除き全て実装されgreenになる)を満たす見込み。SCENARIOS.mdの
UI-D-01〜03の`保`マーカーはこのIssueで削除する。UI-D系に対応する
移行元WSテストは無い(棚卸し表の`PROTO-D-01`は「残す」判定=
ワールドステートのスキーマ検証としてプロトコル層に引き続き残す)ため、
今回削除するWSテストは無い。

#### 実装・検証結果

`packages/e2e/src/ui/node-internals.spec.ts` に UI-D-01〜03 の3シナリオを
実装した。

**実装中に見つかった問題と対応**:

1. **`edge.hover()` が他ノードカードに吸われて失敗する**: beacon1→reth1の
   内部リンクエッジは、React Flow の初期自動レイアウト上で隣接する
   beacon2 のカード(HTMLノード。SVGのエッジより上位レイヤーに描画される)
   の当たり判定と視覚的に重なる位置に来ることがあり、Playwright の
   `hover()`(実座標ベースの当たり判定)がそちらに吸われて
   `intercepts pointer events` エラーで失敗することを実機実行で確認した。
   React Flow の `onEdgeMouseEnter` は React の合成 `mouseover`
   イベントで発火するため、`edge.dispatchEvent("mouseover")`
   (座標ベースの当たり判定を経由せず対象要素に直接イベントを発行する)に
   置き換えて解消した。
2. **`Locator.filter({ has: <別インスタンスのLocator> })` が解決に失敗する**:
   txpool 行(`.infra-field`)を、内包する `glossary-term-txpool`
   の `data-testid` で絞り込む際、`popover.locator(".infra-field").filter({
   has: popover.getByTestId(...) })` の形で書いたところ、実際には
   要素が存在する(アクセシビリティスナップショットで実在を確認済み)にも
   関わらず `element(s) not found` で60秒タイムアウトした。原因の深追いは
   していないが、同じ `popover` インスタンスから独立に導出した2つの
   Locator を `filter({ has })` に渡す組み合わせで解決に失敗する事象を
   実機実行で確認したため、回避策としてブラウザ組み込みの CSS `:has()`
   セレクタ文字列(`'.infra-field:has([data-testid="glossary-term-txpool"])'`)
   に置き換えたところ問題なく解決した。

**タイムアウト設計の検証結果**: UI-D-02のパルス周期性チェック(出現→
消滅→再出現の3段階)は実行時間9.3秒で完了し、想定した
`FIRST_PULSE_TIMEOUT_MS`(60秒)を大幅に下回った。稼働中スタックを
再利用する構成では初回パルスがベースライン記録の次のスクレイプ
(6秒程度)で観測できているとみられる。60秒という上限値はコールド
スタート分の安全マージンとして妥当と判断し、そのまま残した。

**実行結果**:

- `pnpm --filter @chainviz/e2e exec playwright test node-internals.spec.ts`:
  3 passed(26.3秒)
- `pnpm test:e2e:ui`(UI層全体、32テスト): 32 passed(3.7分)。新規3件を
  含め既存29件も引き続きgreen
- `pnpm lint && pnpm build && pnpm test`(全パッケージ): いずれも green
  (frontend 1372件・collector 1103件・shared 58件・e2e(unit) 77件、
  すべてpassed)

**プロトコル層(`pnpm test:e2e`)の実行結果と申し送り**: 本Issueの変更は
`packages/e2e/src/ui/` 配下のみ(collector・catch-up.ts等には触れていない)
だが、確認のため実行したところ `commands.test.ts` の
PROTO-CMD-01(addNode のブロック追従)が
`全体タイムアウト540000ms超過(高さ5502/ターゲット8369)`で失敗した。
これは本Issueの変更に起因するものではなく、既存の
[Issue #229](https://github.com/morichikawa/chainviz/issues/229)
(長時間稼働スタックでPROTO-CMD-01が不安定になる問題)と同根の事象と
判断した。実行時点でスタックは稼働5時間・チェーン高8369まで進行して
おり、`packages/e2e/src/helpers/catch-up.ts` の
`waitForBlockCatchUp` が動的に算出するタイムアウトを
`maxTimeoutMs`(既定540,000ms固定)で頭打ちにしている箇所が、
今回のような大きな`gap`(target - startHeight)で頭打ちの原因になり
うることを確認し、追加情報として#229にコメントした(修正は本Issueの
範囲外のため実施していない)。ステップ10の完了条件は「UI層シナリオが
全てgreen」であり、この既知の環境要因はUI-D実装の合否には影響しない。

#### テスト強化記録(2026-07-10)

`node-internals.spec.ts`(UI-D-01〜03)に対し、境界値・退行検出・
周期性の観点でアサーションを強化した。実装ロジックには手を入れていない。

- **Playwright回避策の共有ヘルパー化**: 実装中に判明した2件のハマりどころ
  (座標ベースの当たり判定にホバーが奪われる問題、`Locator.filter({has})`が
  別インスタンスのLocatorを解決できない問題)の回避策を、他のUI層シナリオでも
  再利用できるよう `packages/e2e/src/ui/support/interactions.ts` に
  `dispatchHover` / `descendantContainingTestId` として切り出した。回避策の
  理由(なぜ素直な書き方だと失敗するか)を各ヘルパーのdocコメントに集約し、
  `node-internals.spec.ts` からはヘルパーを参照する形にした。
- **UI-D-01(別系統の見た目)**: 内部リンクエッジ専用クラスの正の確認だけ
  だと、内部リンクエッジが誤ってピアエッジとして描画される退行を検出できない。
  ピアエッジのクラス(`react-flow__edge-peer` / `peer-edge`)を持たないことの
  否定確認(`not.toHaveClass`)を追加した。
- **UI-D-02(パルスの周期性)**: 「流れ続ける」の確認を、出現→消滅→再出現の
  1サイクルから、出現→消滅を複数サイクル(既定2)くり返し最後に再出現まで
  観測する `expectSustainedPulseCycles` に強化した。1サイクルだけでは
  「たまたま1回出て消えた」単発の出現でも通ってしまうため。サイクル数と
  待ち時間のworst caseに合わせて `test.setTimeout` も更新した。
- **UI-D-03(同期ステージ)**: 進行状況の数値確認を、先頭行だけから全行の
  走査に広げた。途中のステージが空文字/非数値で描かれる退行を先頭行の確認
  では見逃すため。`Number("")`が0を返す性質上、Number変換だけでは空文字を
  素通しするので、非負整数の文字列パターン(`/^\d+$/`)で「数字が実際に描かれて
  いる」ことを担保する形にした。

**検証**: 稼働中の `chainviz-ethereum` スタックを再利用し、
`node-internals.spec.ts` 単体を3回連続で実行して全green・安定を確認
(UI-D-02は周期性の複数サイクル観測で約15秒、初回・2回目とも同値)。
UI層全体(`pnpm test:e2e:ui`、32件)もgreen。`pnpm build` /
`pnpm lint` / `pnpm test`(frontend 1372・collector 1103・shared 58・
e2e unit 77)もいずれもgreen。テスト強化で検出された実装バグは無し
(起票したIssueも無し)。

