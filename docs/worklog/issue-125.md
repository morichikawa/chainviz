# Issue #125 ブロック伝播パルスが隣接カード間では移動距離が短すぎて点滅にしか見えない

### 2026-07-06 Issue #125 UX設計(実測による根本原因の特定と実装仕様の確定)

- 担当: ux
- ブランチ: issue-125-ux-design-pulse-visibility
- 内容: 実環境(Docker + collector + frontend)とPlaywrightでパルスの実際の
  挙動を実測し、UX設計・実装仕様をまとめた。実装コードは書いていない。
  実装担当(frontend)は下記「実装仕様」をそのまま着手指示として使える

## 実測で確認したこと(設計の根拠)

検証環境: 稼働中の `profiles/ethereum` スタック(2ノード + workbench)に
対し、既存環境(port 4000/5173)へ影響を与えないよう本worktreeから別ポート
(collector 4100 / proxy 4101 / vite 5273)で collector・frontend を並走させ、
Playwright(headless Chromium)で `circle.peer-pulse` の画面座標を50〜60ms
間隔で追跡した。

1. **パルスは隣接カード間だけでなく、どのエッジ上でも一切移動していない**。
   beacon2カードをドラッグして beacon1 との間隔を広げ、エッジパス長を
   37px / 94px / 155px に変えて追跡したが、いずれも450msの表示時間中の
   移動距離は0px(パルスは常に「到達先ノード側の端点」に固定表示)だった。
   つまりIssueタイトルの「移動距離が短すぎて点滅に見える」は正確には
   「そもそも移動しておらず、隣接カード間ではそれが固定点滅として
   目立って見えた」が実態
2. 原因はSMILの仕様: `PeerPropagationEdge` の `<animateMotion>` は
   `begin` 属性を指定していないため、開始時刻が「SVG文書タイムラインの
   0秒」に解決される。パルス要素はブロック受信のたびに(ページ表示から
   何分も後に)動的挿入されるので、挿入された時点で `dur=450ms` は
   とっくに経過済み → `fill="freeze"` により即座に終端状態
   (keyPoints の最終値 = 到達先端点)へ固定され、一度も再生されない。
   分離プロトタイプ(素のSVG + 動的挿入 + 同一属性)で同じ凍結を再現し、
   ページ読み込み時から存在する `animateMotion` は正常に動くことも
   確認して、動的挿入が条件であることを切り分けた
3. **横に隣接するカードは接触・重複している**。`DEFAULT_GRID.gapX`(260)が
   カードの実測幅(フロー座標で reth 239 / beacon 260 / validator 279 /
   workbench 285)以下のため、beacon1↔beacon2 間には紐(エッジ)が1pxも
   見えず(エッジパス長は実測17px)、validator1のカード名はvalidator2の
   カードの下に隠れて読めない
4. 現環境で `BlockEntity.receivedAt` に記録されるのはbeaconノードの
   stableIdだけ(collectorの `targets.ts` がEL購読の受信をbeacon側の
   stableIdへ意図的に寄せている)なので、**パルスが走る唯一のエッジが
   「紐が見えない隣接beacon間」**であり、B層の見せ場であるブロック伝播
   アニメーションは実質まったく機能していなかった

## UX設計の考え方

- 「ブロックが伝播する」ことを伝える最小の情報は「光が ノードAから
  ノードBへ **移動する**」こと。点滅(出現と消滅)では方向も移動も
  伝わらない。まず移動を成立させる(上記2の修正)
- 移動が見えるためには、移動する距離(=カード間に見える紐)が必要。
  横に隣接するカード間にも紐がはっきり見える距離を既定グリッドで確保する
  (上記3の修正)。実測では紐が100px以上見えていれば、450msの移動は
  はっきり知覚できた(約300px/s)
- 尾を引く・色を変える等の新しい演出は追加しない。移動そのものが
  成立すれば伝わることをプロトタイプで確認済みで、CLAUDE.mdの
  「先回り実装をしない」原則に従い最小の変更に留める
- 実データ駆動の設計(`blockPulse.ts` の実差分 + 450msフロア)は
  一切変えない。離れたカード間のエッジも、修正後は(現状の
  「終端へ瞬間移動して450ms静止」ではなく)実データ由来の時間で
  パスを走るようになる、という改善のみを受ける

## 実装仕様(frontend担当向け)

### 1. パルスのアニメーションをSMILからCSS offset-pathへ置き換える

対象: `packages/frontend/src/entities/PeerPropagationEdge.tsx`、
`packages/frontend/src/entities/OperationPulseEdge.tsx`(同じ
`animateMotion` 構造で同じバグを持つ)、`packages/frontend/src/styles.css`

- `styles.css` に共通のキーフレームを追加する:

  ```css
  /* パルスがエッジパス上を始点→終点へ走る共通キーフレーム(Issue #125)。
     SMILのanimateMotionはbegin未指定だと文書タイムライン0秒起点で解決され、
     動的挿入時には再生済み扱い→fill=freezeで終端に固定され一度も動かない。
     CSSアニメーションは要素挿入時に開始されるためこの問題がない。 */
  @keyframes pulse-travel {
    from { offset-distance: 0%; }
    to { offset-distance: 100%; }
  }
  ```

- `.peer-pulse` / `.operation-pulse` に
  `animation-name: pulse-travel; animation-timing-function: linear;
  animation-fill-mode: forwards;` を追加する
- `<animateMotion>` 子要素を削除し、`<circle>` のインラインstyleで
  パスと個別タイミングを渡す:

  ```tsx
  <circle
    key={pulse.key}
    className="peer-pulse"
    r={5}
    style={{
      offsetPath: `path("${edgePath}")`,
      animationDuration: `${pulse.durationMs}ms`,
      animationDirection: pulse.reverse ? "reverse" : "normal",
    }}
  />
  ```

  `OperationPulseEdge` は常に source→target なので
  `animationDirection` は不要(省略 = normal)
- `animation-direction: reverse` + `fill-mode: forwards` の終端状態は
  `offset-distance: 0%`(= パス始点 = 逆走時の到達先)になる。
  プロトタイプで正方向・逆方向とも450msかけて滑らかに移動し、
  終端で停止することを実測済み
- 挙動が変わらないこと: パルスの見た目(r=5・発光)・生成消滅の
  スケジューリング(`useBlockPulses` / `useOperationPulses`)・
  タイミング計算(`blockPulse.ts`)は変更しない

### 2. 既定グリッドの横間隔を広げ、隣接カード間に紐を見えるようにする

対象: `packages/frontend/src/entities/infraNode.ts`

- `DEFAULT_GRID.gapX` を 260 → **420** に変更する。`gapY`(200)は
  カード実測高さ(約80フローpx)に対して十分な余白があるため変えない
- 420の根拠と前提条件(CLAUDE.mdの「固定値の前提を明記する」ルールに
  従い、コードコメントにも同旨を書くこと):
  - 現行の命名(`chainviz-ethereum-<service>-N`)でのカード実測最大幅は
    約285フローpx(workbench)。420なら横に隣接するカード間に
    約135px以上の紐が見え、450msフロアでの移動(約300px/s)が
    はっきり知覚できる
  - カード幅は `containerName` の長さに依存する(min-width 190px、
    max-width なし)。コンテナ名が現行より大幅に長くなる運用に
    変わった場合はこの値の見直しが必要
- `GHOST_GRID` は `DEFAULT_GRID` の別名、`WALLET_GRID` はスプレッドで
  継承しているため追随変更は不要。既存テストもグリッド定数を
  シンボリック参照しており(`DEFAULT_GRID.gapX` 等)、値の変更では壊れない
- 副作用: キャンバス全体が横に広がり、fitView時のズームがやや下がる。
  無限キャンバス(ズーム・パン前提)のアプリなので許容する。手で
  ドラッグ済みの位置(localStorage保存)には影響しない

### 3. テストについて(実装担当・tester向けの注意)

- jsdomは `offset-path` を未知のCSSプロパティとして無視する可能性が
  高い(その場合 `element.style.offsetPath` が空になる)。コンポーネント
  テストでは最低限「`animateMotion` 要素が存在しないこと」
  「`style.animationDuration` が `durationMs` と一致すること」
  「reverse時に `style.animationDirection` が `reverse` になること」を
  検証する。`offsetPath` はjsdomが保持するなら合わせて検証する
- 「パルスが実際に画面上を移動すること」はjsdomでは検証できない。
  QA(検証大地)は実環境 + Playwrightで `circle.peer-pulse` の
  `getBoundingClientRect()` を450ms間サンプリングし、座標が
  始点側から到達先側へ単調に変化することを確認する(本設計時の
  観測手順と同じ。座標が1pxも動かなければ修正前の再現になる)

### 4. 変更しないもの(明示)

- `MIN_PULSE_DURATION_MS`(450ms)・`DEFAULT_FRESHNESS_MS`・
  `blockPulse.ts` のタイミング計算・`useBlockPulses` のスケジューリング
- パルスの色・大きさ・発光(styles.cssの `.peer-pulse` /
  `.operation-pulse` の既存宣言)
- 尾・残像・色変化などの新規演出は追加しない

## Issueスコープ外の発見(統括への報告事項)

1. **実行(reth間)エッジには構造的にパルスが走らない**:
   `packages/collector/src/adapters/ethereum/targets.ts` が
   `BlockEntity.receivedAt` のキーを意図的にbeacon側stableIdへ寄せている
   (ピアエッジがbeacon間しか無かった頃の設計)。Issue #106で
   reth間エッジ(`-execution`)が描画されるようになった今、実行エッジは
   端点が `receivedAt` に決して現れず、伝播アニメーションの対象外の
   まま。EL側の受信もEL自身のstableIdで記録する(両方に記録する)
   修正を別Issueとして起票することを推奨
2. **collectorのブロック購読がDockerスタック再起動後に死んだまま復帰
   しない**: 統括起動の既存collector(port 4000)は、コンテナ群が
   再作成された約4.3時間前からブロック受信記録が停止していた
   (チェーン自体はslot 9000超まで正常進行中)。eth_subscribeのWebSocket
   切断後の再購読が無い可能性が高い。別Issueとして起票を推奨
3. `OperationPulseEdge` も同じSMILバグを持つため、本Issueの修正に
   含めた(上記実装仕様1)。分離したい場合は統括判断で分割してよい

## 未決事項(統括の判断待ち)

- `gapX` の最終値: 本設計の推奨は420。より控えめ(400)や余裕を持たせる
  (450)の選択もあるが、現行カード幅の前提では420で十分な視認性が得られる
- スコープ外発見1・2のIssue起票の要否
