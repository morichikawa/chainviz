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

### 2026-07-07 Issue #125 実装(SMIL→CSS offset-path化・gapX拡大)

- 担当: frontend
- ブランチ: issue-125-ux-design-pulse-visibility
- 内容: UX設計(上記)の実装仕様どおりに着手した。統括判断で
  `OperationPulseEdge` の同バグ修正も本Issueに含め、`gapX` は420を採用した。

#### 変更内容

1. `packages/frontend/src/styles.css`
   - `.peer-edge` セクションに共通キーフレーム `@keyframes pulse-travel`
     (`offset-distance: 0% → 100%`)を追加
   - `.peer-pulse` / `.operation-pulse` に
     `animation-name: pulse-travel; animation-timing-function: linear;
     animation-fill-mode: forwards;` を追加(色・発光などの既存宣言は変更なし)
2. `packages/frontend/src/entities/PeerPropagationEdge.tsx` /
   `packages/frontend/src/entities/OperationPulseEdge.tsx`
   - `<circle>` の子要素だった `<animateMotion>` を削除し、`<circle>` の
     インライン `style` で `offsetPath` / `animationDuration` /
     `animationDirection`(PeerPropagationEdgeのみ、reverse対応)を渡す形に
     変更。パルスの見た目(r=5・発光)・生成消滅のスケジューリング
     (`useBlockPulses` / `useOperationPulses`)・タイミング計算
     (`blockPulse.ts`)は一切変更していない
   - コンポーネント冒頭のコメントを、SMIL前提の説明からCSS
     offset-path前提の説明に更新した
3. `packages/frontend/src/entities/infraNode.ts`
   - `DEFAULT_GRID.gapX` を 260 → 420 に変更。値の根拠と前提条件
     (カード実測最大幅・コンテナ名の長さに依存する点)をコードコメントに
     明記した。`gapY` は変更していない

#### テスト

- `packages/frontend/src/entities/PeerPropagationEdge.test.tsx`: 既存の
  「animateMotionの属性を検証するテスト」を「animateMotion要素が存在
  しないこと」「`style.animationDuration` / `style.animationDirection`
  (reverse時・normal時の両方)/ `style.offsetPath` を検証するテスト」に
  置き換えた
- `packages/frontend/src/entities/OperationPulseEdge.test.tsx`: 既存テスト
  ファイルが無かったため新規作成。パルス0件/複数件の描画、
  `animateMotion`要素が無いこと、`animationDuration` / `offsetPath` の
  検証を行う
- `infraNode.test.ts` は `DEFAULT_GRID.gapX` をシンボリック参照している
  既存テストのみで、値変更(260→420)によって壊れないことを確認済み
  (追加テストは不要と判断)
- 修正前のコード(`animateMotion`構造)に一時的に戻して新規テストを実行し、
  実際に失敗する(＝修正前のバグを検出できる)ことを確認してから、修正後の
  コードに戻して全テストが通ることを再確認した(CLAUDE.mdの回帰テスト
  検証ルールに従う)
- jsdom(`cssstyle`パッケージ)は `animation-duration` / `animation-direction`
  / `offset-path` のいずれも標準プロパティとして認識し、
  `element.style.xxx` で読み書きできることを事前に確認した上で
  `offsetPath` の検証もテストに含めた(ワークログ記載の懸念とは異なり、
  今回のjsdomバージョンでは無視されなかった)

#### ビルド・動作確認

- `pnpm --filter @chainviz/frontend build`(`tsc -b`)・
  `pnpm --filter @chainviz/frontend test`(vitest run)ともに成功
  (48ファイル768テスト)
- `pnpm --filter @chainviz/frontend dev`をポート5273(既存の
  収集悟起動分・利用者の既存環境のport 4000/5173とは別ポート)で起動し、
  配信されるCSS(`/src/styles.css`)・コンポーネントソース
  (`/src/entities/PeerPropagationEdge.tsx`)をcurlで取得して、
  `pulse-travel`キーフレーム・`animation-name`等の追加、および
  `animateMotion`要素(コメント以外)が実際に無くなっていることを確認した
- Playwrightによる「実際に画面上を移動すること」の実機確認は本
  worktreeでは実施できなかった。ヘッドレスChromiumの実行に必要な共有
  ライブラリ(`libnspr4.so`等)がこの環境に無く、`apt-get download`も
  candidateが見つからずインストールできなかった(sudoも使えない)。
  UX設計時(体験優)には同様のPlaywright手順で修正前の凍結が実測
  確認されており、修正後のコード自体はCSSアニメーションの標準的な
  記法(offset-path + animation-fill-mode: forwards)に沿っているため、
  最終的な実機での移動確認は検証大地(QA)に委ねる

#### 次の担当への申し送り

- worklog記載の「Issueスコープ外の発見」のうち、発見2(collectorの
  eth_subscribe再購読が無い)は既にIssue #135として起票済み。発見1
  (`BlockEntity.receivedAt`がbeacon側stableIdにしか記録されずreth間
  エッジではパルスが走らない)はまだIssue化されていない。本Issueの
  スコープ外(collector側の変更が必要)のため未対応のまま
- QAは実環境+Playwrightで `circle.peer-pulse` /
  `circle.operation-pulse` の `getBoundingClientRect()` を450ms
  (operationは900ms)間サンプリングし、座標が始点側から到達先側へ
  単調に変化することを確認してほしい(本worklog冒頭のUX設計時の観測
  手順と同じ)

### 2026-07-07 Issue #125 テスト強化(異常系・境界値の追加)

- 担当: tester
- ブランチ: issue-125-ux-design-pulse-visibility
- 内容: 実装担当が書いた基本テスト(ハッピーパス中心)に対し、CSS
  offset-path化・gapX拡大の変更点を対象に異常系・境界値のテストを追加した。
  実装コードは変更していない(既存実装に対するテスト追加のみ)。

#### 追加したテストの観点

`packages/frontend/src/entities/PeerPropagationEdge.test.tsx`

- 複数パルス同時存在時の独立性: 向き・所要時間の異なる3パルスを描画し、
  文書順(描画順)で各circleが自分のパルスの `animationDuration` /
  `animationDirection` を持ち、隣のパルスの値と混線しないことを検証
- 同一エッジ上の全パルスが同じ `offsetPath` を指すことの不変条件
- エッジ形状変化時の追従(ノードドラッグ相当): 同じ `pulse.key` を保った
  まま `targetX/Y` を変えて再レンダーし、走行中パルスの `offsetPath` が
  古いパスのまま取り残されず新しいパスへ更新されることを検証
- `durationMs` の境界値(0 / 1 / 123.5 / 10_000_000)で `animationDuration`
  文字列が `${durationMs}ms` としてそのまま生成されること(jsdom の cssstyle
  が時間値を正規化・丸めしないことを事前に確認済み)
- `reverse` フラグ境界: フラグ欠落(undefined)を防御的に渡された場合も
  falsy として `normal` に落ちること(true/false/omitted の3系統を網羅)

`packages/frontend/src/entities/OperationPulseEdge.test.tsx`

- 複数パルス同時存在時の `durationMs` 独立性(混線しないこと)
- 操作パルスは常に source→target のため `animationDirection` を一切設定
  しない(空文字のまま)ことの固定
- 同一エッジ上の全パルスが同じ `offsetPath` を指すこと
- エッジ形状変化時の `offsetPath` 追従(再レンダー)
- `durationMs` 境界値での `animationDuration` 文字列生成

`packages/frontend/src/entities/infraNode.test.ts`

- `DEFAULT_GRID` の横間隔退行ガード: gapX が UX設計で実測されたカード最大幅
  (約285フローpx)を上回り、隣接カード間に紐が見える距離を確保していること
  (旧 gapX=260 への巻き戻しを検出)。値そのものの固定ではなく、UXの根拠
  (カード幅との差)に紐付けて表現した
- gapX > gapY(横間隔だけ広げた設計意図)の固定
- gapX 変更で別グリッドセルどうしの座標が衝突(positionKey 重複)しないこと

#### 回帰検出の確認

- 追加テストのうち「複数パルスの独立性」「offset-path の再レンダー追従」が
  実際に不具合を検出できることを、実装を一時的に壊して確認した(offsetPath
  を固定文字列に差し替え・animationDirection を reverse 無視に固定した状態で
  該当テストが失敗し、元に戻すと通ることを確認)。確認後は実装ファイルを
  バックアップと突き合わせて完全に復元済み

#### ビルド・テスト

- `pnpm --filter @chainviz/frontend build`(tsc -b)成功
- `pnpm --filter @chainviz/frontend test` 成功(48ファイル。768→787テスト、
  +19テスト)

#### 実装のバグ

- 今回追加した観点の範囲では、既存実装にバグは見つからなかった(追加した
  境界値・異常系テストはいずれも修正後の実装で通る)

### 2026-07-07 Issue #125 静的レビュー(合格)

- 担当: reviewer
- ブランチ: issue-125-ux-design-pulse-visibility
- 結果: **合格**。指摘事項なし(コミット分割の推奨あり。下記)

#### 確認内容

1. **CSS offset-path 化が SMIL の凍結バグを解消する設計か**: 前提は正しい。
   SMIL の `animateMotion` は `begin` 未指定だと文書タイムライン0秒起点で
   解決されるのに対し、CSS アニメーションは要素にスタイルが適用された
   時点(= 動的挿入時)に開始される。加えて、パルスの `key` は
   `useBlockPulses`(`...#${seqRef.current++}`)・`useOperationPulses`
   (`op-pulse-${signal.seq}`)ともに毎回一意に生成されるため、React は
   パルスごとに新しい `<circle>` を挿入し、アニメーションは必ず 0% から
   再生される。`animation-direction: reverse` + `fill-mode: forwards` の
   終端が始点(0%)になる点も UX 設計時のプロトタイプで実測済みと記録
   されており、整合している
2. **gapX 420 の前提条件の明記**: `infraNode.ts` の `DEFAULT_GRID` 直上の
   コメントに、カード実測最大幅(約285フローpx)・`containerName` の長さに
   幅が依存すること(min-width 190px / max-width なし)・命名が大幅に長く
   なった場合は見直しが必要であることが明記されている。CLAUDE.md の
   固定値ルールを満たす。テスト側(`infraNode.test.ts`)も値の丸暗記では
   なく「gapX − 実測最大幅 ≥ 100px」という UX 根拠に紐付けた退行ガードに
   なっており良い
3. **変更範囲の限定**: `blockPulse.ts` / `useBlockPulses.ts` /
   `useOperationPulses.ts` は無変更(git diff で確認)。
   `MIN_PULSE_DURATION_MS` 等のタイミング計算・スケジューリングに
   変更なし。UX 設計の「変更しないもの」の範囲が守られている
4. **ビルド・テスト**: リポジトリ全体で `pnpm lint` / `pnpm build` /
   `pnpm test` すべて成功(shared 13 / e2e 34 / collector 638 /
   frontend 787 テスト)
5. **テストの質**: animateMotion 不在の固定・duration/direction/offsetPath
   の検証・複数パルスの独立性・再レンダー時の offset-path 追従・境界値と、
   jsdom で検証可能な範囲を適切にカバーしている。実装担当・tester とも
   「実装を一時的に壊してテストが失敗すること」を確認済みと記録されて
   おり、意味のないテストになっていない
6. **境界・エラー処理**: frontend は collector の WebSocket 経由のデータを
   描くのみで境界違反なし。テスト中の `eth_call` は既存設計(観測された
   操作名を不透明な文字列として運ぶ `OperationEdgeData.operation`)の
   サンプル値であり本変更由来ではない。今回の変更に catch 節はなく
   エラー握りつぶしの懸念なし
7. **docs との齟齬**: `docs/ARCHITECTURE.md` / `docs/CONCEPT.md` はパルスを
   概念レベル(SMIL 等の実装詳細に踏み込まない)でのみ記述しており齟齬なし

#### コミット粒度についての統括への申し送り

- コミット済みは UX 設計 docs の1件のみで、実装・テスト強化・PLAN.md
  更新はすべて未コミット。CLAUDE.md の「1つの変更内容 = 1コミット」に
  従い、最低限以下の単位に分けてコミットすることを推奨する:
  1. fix(frontend): SMIL→CSS offset-path 化(PeerPropagationEdge.tsx /
     OperationPulseEdge.tsx / styles.css と対応するテストの置き換え・新規)
  2. fix(frontend): DEFAULT_GRID.gapX 260→420(infraNode.ts)—
     アニメーション修正とは別の関心事のため分ける
  3. test(frontend): tester によるテスト強化19件
  4. docs: worklog 追記 + PLAN.md チェック
- 実装担当分のテスト変更と tester 分の追加が同一テストファイルに混在して
  いるため、厳密に分けるなら `git add -p` が必要。テスト変更を1コミットに
  まとめる判断は統括に委ねる

#### QA への申し送り(実装担当の申し送りの補足)

- `offset-path` を SVG 要素に適用できないブラウザではパルスがパス上を
  走らず原点付近に静止する退化があり得る。QA の実機確認は UX 設計時と
  同じ Chromium 系で、`circle.peer-pulse` の座標が始点側から到達先側へ
  単調に変化することを確認してほしい

### 2026-07-07 Issue #125 QA検証(実機Playwright相当のCDP実測・合格)

- 担当: qa
- ブランチ: issue-125-ux-design-pulse-visibility
- 結果: **合格**。PLAN.mdの完了条件「隣接ノード間のブロック伝播パルスが
  『点滅』ではなく『移動している』とユーザーに伝わるようになっていること」を
  満たしていることを実機で確認した。

#### 検証環境と手法

- 稼働中のメイン環境(Docker + 統括起動のcollector port 4000)は読み取り
  専用で利用し、破壊的操作(docker down等)は一切行っていない。
- 本worktreeから修正版frontendを別ポート(vite 5273、`VITE_COLLECTOR_URL=
  ws://127.0.0.1:4000`)で並走起動し、稼働中collectorのワールドステートを
  描画させた(メインのfrontend port 5173には触れていない)。配信された
  `/src/styles.css` に `pulse-travel` キーフレームが含まれることを確認。
- 実装担当・UX設計時はこの環境でPlaywright(ヘッドレスChromium)が起動
  できなかった(libnss3/libnspr4/libasound欠落・sudo不可)。今回は
  playwright同梱の `chrome-headless-shell`(chromium 1228 / HeadlessChrome
  149)に対し、欠落libを含むubuntu debパッケージ(libnss3/libnspr4/
  libasound2t64)をアーカイブから取得してスクラッチ領域へ展開し、
  `LD_LIBRARY_PATH` で解決して起動に成功した。CDP(DevTools Protocol)を
  `ws` モジュール経由で直接駆動し、`circle.peer-pulse` の
  `getBoundingClientRect()` を40ms間隔でサンプリングした。

#### 前提の確認(パルス発生源が生きているか)

- collector(4000)のWS diffを40秒監視した結果、約2秒ごとに新規ブロックが
  到来し、`receivedAt` が beacon1 と beacon2 に数〜十数ms差で記録され続けて
  いた(peer-pulse の発生源が正常。UX設計時に懸念された購読停止(#135)は
  現時点のこのcollectorでは再発しておらず、ブロックは流れている)。

#### 完了条件1: パルスが実際に移動している(修正前は0px)

- 既定グリッド(gapX=420)のまま、beacon1↔beacon2 の隣接エッジ上を走る
  peer-pulse を12秒サンプリングし、6回のブロック伝播バーストを捕捉。
  各バーストとも所要 dur=450ms で、x座標が単調変化していた:
  - reverse方向(beacon2→beacon1): x が 約603→429 へ単調減少
  - normal方向(beacon1→beacon2): x が 約429→618 へ単調増加
  - y座標は一定(水平隣接エッジ)。1バーストの正味移動量は約160〜190px。
- 修正前(SMILの`animateMotion`凍結)は同手法で移動量0pxだったのに対し、
  実際にエッジ上を端から端へ移動するようになったことを確認した。正方向・
  逆方向の両方が正しく動作する。

#### 完了条件2: 隣接カード間に紐(エッジ)が視認できる長さになっている

- 上記の水平隣接エッジ上でパルスが画面上を約175〜190px移動しており、
  紐が十分な長さで見えている(修正前のエッジ長17px = 実質点滅とは明確に
  異なる)。gapX=420への拡大が効いていることを実測で確認した。

#### 完了条件3: 離れたカード間のパルスも壊れない

- クライアント側操作のみ(collectorに影響しない)で beacon2 ノードを
  右下へドラッグしてエッジを対角・長距離化し、再サンプリングした。
  パルスは x(約452→764)・y(約147→343)ともに単調変化し、約368〜410pxの
  長い経路を450msで最後まで走破した(normal/reverse両方向)。エッジ形状の
  変化に offset-path が追従し、凍結・取り残しは発生しなかった。

#### 補足(スコープ外・観測できなかった事項)

- 現環境では `receivedAt` が beacon 側 stableId にのみ記録されるため、
  パルスが走るのは beacon 間エッジのみで、reth(EL)間エッジには構造的に
  パルスが走らない(worklog記載のスコープ外発見1のとおり。別Issue対象)。
- operation-pulse は同一のCSS offset-path修正を受けているが、検証時に
  アクティブなワークベンチのRPC操作が無く実機では発火しなかった。機構は
  peer-pulse と同一で、tester/reviewer が静的に検証済み。本Issueの完了
  条件はブロック伝播パルスに関するものであり、判定には影響しない。

#### 後片付け

- 起動した chrome-headless-shell と vite(5273)は検証後に停止済み。Docker・
  メインのcollector(4000)・frontend(5173)には一切変更を加えていない。
