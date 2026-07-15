# Issue #328 ノード/コンポーネントをドラッグ中にWebSocket更新で位置がガクンとずれる/戻る

### 2026-07-15 Issue #328 起票とバックログ追記のレビュー
- 担当: reviewer
- ブランチ: main(docs/PLAN.md のみの未コミット変更をレビュー。実装着手は後日)
- 内容: Issue #328 の起票内容と `docs/PLAN.md` バックログ節への追記1項目
  (Issue #327 分と同時追記)をレビューした。結果は**合格**
- 確認したこと:
  - Issue本文が不具合報告(ドラッグ中に更新が入ると位置がガクンとずれる/
    戻る)を正確に伝えており、推測原因(WebSocket更新とローカルドラッグ
    位置の競合)を「未確認」と明示したうえで記載している。原因を断定せず
    chainviz-detective の切り分けを先行させる進め方は、原因未調査の不具合
    に対する妥当な手順であり、PLAN.md 追記の括弧書きとも整合している
  - 「原因特定後に標準パイプラインで対応するIssueとして仕切り直す」方針が
    Issue本文・PLAN.md追記の双方に一貫して書かれている
  - PLAN.md の追記はバックログ節の既存項目とフォーマットが一貫している
    (未チェックのチェックボックス+タイトル、6スペースインデントの
    括弧書き補足、Issueリンク行、節末尾への追加)。タイトルはGitHub上の
    Issueタイトルと一致
  - docsのみの変更だが規定どおり `pnpm lint` / `pnpm build` / `pnpm test`
    をリポジトリ全体で実行し、全件通過(テスト計3779件パス)を確認した
- 決定事項・注意点:
  - frontend ラベルが付いているが、対象パッケージは「疑わしいが未確認」で
    ある旨がIssue本文に明記されている。detective の切り分け結果次第で
    collector 側の可能性も残る点に留意する

### 2026-07-16 Issue #328 原因調査(切り分け)
- 担当: detective
- ブランチ: なし(調査のみ。コード変更なし。調査時の作業ツリーは並行作業中の
  issue-319 ブランチがチェックアウトされていたが、本ファイルへの追記以外は
  一切変更していない)
- 内容: 「ドラッグ中に位置がガクンとずれる/戻る」現象を実環境で再現し、
  根本原因を特定した
- 再現手順・実測結果:
  - `scripts/dev-up.sh` で Docker スタック・collector・frontend を起動し、
    Playwright(chromium headless shell)でノードカードをドラッグして検証した
  - 実測1(ドラッグ保持): カードを+240,+180ドラッグしてボタンを押したまま
    静止すると、次の WebSocket diff 到着(約0.1秒後)にカードの transform が
    ドラッグ前の保存位置(`translate(0px, 200px)`)へ跳ね戻った。マウスは
    一切動かしていない
  - 実測2(連続ドラッグ): マウスを動かし続けながら13秒ドラッグすると、
    diff 到着のタイミングと一致して保存位置への逆方向ジャンプが4回発生した
    (ユーザー報告の「がくんと位置がずれたり、戻ったり」と一致)
  - 実測3(更新頻度): collector からの diff(`entityAdded`/`entityRemoved`/
    `entityUpdated`/`nodeLinkActivity`)は約2秒周期で常時届く。つまり2秒を
    超えるドラッグでは必ず跳ね戻りが発生する
- 根本原因:
  - `packages/frontend/src/canvas/Canvas.tsx` の
    `useEffect(() => { setRfNodes((current) => preserveMeasuredDimensions(nodes, current)); }, [nodes])`
    (157〜159行目)が、親(App.tsx)が再計算した `nodes` で `rfNodes` を
    丸ごと置き換えている。`preserveMeasuredDimensions`
    (`packages/frontend/src/entities/canvasNode.ts`)は `measured` しか
    引き継がず、ドラッグ中のローカルな `position`(および `dragging` 等の
    状態)は破棄される
  - 親の `nodes` の position は `layout`(localStorage 由来。
    `onNodeDragStop` でのみ更新)から来るため、ドラッグ中に diff が届くと
    カードは「ドラッグ開始前の保存位置」に描き戻される。次の pointermove で
    React Flow が再びカーソル位置へ動かすため、行き来する「ガクン」になる
  - 位置の永続化自体は React Flow 内部のドラッグ状態から `onNodeDragStop`
    に渡されるため、ドラッグ終了後の最終位置は正しく保存される(壊れるのは
    ドラッグ中の見た目のみ)
- 対応方針の見立て(実装は別担当):
  - Canvas.tsx の親 nodes 反映時のマージで、ドラッグ中のノード
    (`onNodeDragStart`/`onNodeDragStop` で追跡、または `current` 側の
    `dragging` フラグで判定)については `current` の position・dragging を
    引き継ぐ(`preserveMeasuredDimensions` と同系のマージ処理に位置の
    保全を加えるイメージ)
  - collector 側の問題ではない(diff の配信自体は正常な動作)
- 決定事項・注意点:
  - 選択状態(`selected`)も同じ機構で毎回の更新時に失われている可能性が
    高い(今回は未検証。対応時に併せて確認するとよい)

### 2026-07-16 Issue #328 原因調査記録(worklog追記)のレビュー
- 担当: reviewer
- ブランチ: docs-issue-328-investigation(docs/worklog/issue-328.md のみの
  変更。ステージ済み・未コミットの状態をレビュー)
- 内容: detective による原因調査の追記(2026-07-16 の節)をレビューした。
  結果は**合格**
- 確認したこと:
  - 根本原因の記述が実装と一致する。`Canvas.tsx` 157〜159行目の
    `useEffect` の引用はコードと完全一致し、`canvasNode.ts` の
    `preserveMeasuredDimensions`(86〜106行目)が `measured` のみを
    引き継ぎ、`position`・`dragging` を引き継がないことも実装どおり
  - 親側の記述も一致する。`app/App.tsx` で `nodes` は `layout`
    (`loadLayout(storage)` = localStorage 由来)から position を組み立て、
    ドラッグ確定時は `Canvas.tsx` の `onNodeDragStop` →
    `onPersistPosition`(= App.tsx の `persist`)で保存される
  - 対応方針の見立て(ドラッグ中ノードの position・dragging を `current`
    から引き継ぐマージ)は既存の `preserveMeasuredDimensions` パターンの
    自然な拡張であり、境界(Collector 経由の一方向依存)にも影響しない。
    「collector 側の問題ではない」という切り分け結論も、diff 配信自体が
    正常動作である以上妥当
  - 記録のフォーマットは `docs/WORKLOG.md` 冒頭の規定・既存の detective
    記録(issue-210/214/229 等)と一貫している。`docs/WORKLOG.md` の索引には
    issue-328.md の行が既に存在するため索引の更新は不要
  - docsのみの変更だが規定どおり `pnpm lint` / `pnpm build` / `pnpm test`
    をリポジトリ全体で実行し、全件通過(テスト計3779件パス)を確認した
- 決定事項・注意点:
  - 「layout は `onNodeDragStop` でのみ更新」という記述は、厳密には
    新規カード出現時にも `resolveLayoutPositions`(App.tsx)で layout が
    更新されるため簡略化を含む。ただし「ドラッグ中の既存カードの保存
    位置が変わるのはドラッグ確定時のみ」という本件の文脈では正しく、
    修正不要と判断した
  - docsのみの変更のため、CLAUDE.md の例外規定に基づき chainviz-qa は
    省略可

### 2026-07-16 Issue #328 実装 設計メモ
- 担当: frontend
- ブランチ: issue-328-drag-position-jitter
- 対応方針: detective の見立てどおり、`preserveMeasuredDimensions` と同系の
  マージ関数を `canvasNode.ts` に追加する
  (`preserveDraggingState<TNode extends CanvasFlowNode>(next, previous)`)。
  `onNodeDragStart`/`onNodeDragStop` で別途 id を追跡する案は採らず、
  `previous`(= Canvas.tsx の `current` = 直前の rfNodes)側の各ノードが
  既に持つ `dragging` フラグをそのまま判定に使う。理由:
  - React Flow(`@xyflow/react` 12.11.1)の実装を確認したところ、
    `useDrag`(内部フック)がドラッグ開始・移動・終了それぞれで
    `updateNodePositions(items, dragging)` を呼び、`type: "position"` の
    `NodeChange` に `dragging: true`(開始・移動中)/`dragging: false`
    (終了)を積んで `onNodesChange` 経由でディスパッチしている。
    `applyNodeChanges`(`@xyflow/react/dist/esm/index.js` 674〜675行目)は
    `change.dragging` が定義されていればそのまま `element.dragging` に
    反映するため、Canvas.tsx の `onNodesChange`
    (`applyNodeChanges(changes, current)` → `setRfNodes`)を経由した
    `rfNodes` は常に「今ドラッグ中かどうか」を正しく反映している。
    自前で id を追跡する仕組みを足すと、この既存の状態と二重管理になり
    ズレの温床になるため避けた
  - `selected` も同じ理由で `previous` 側の値を信頼できる
    (`applyNodeChanges` が `select`/`unselect` change を同様に反映するため)
- マージ対象のフィールドは `position`・`dragging`・`selected` の3つのみ。
  `data`(エンティティ内容)は `next`(親が最新の WorldState から再計算した
  もの)を優先する。ドラッグ中でも WebSocket 更新によるカード内容の変化
  (残高・ブロック高など)は従来どおり反映され続けるべきで、位置周りの
  ちらつきだけを止めたいため
- 判定は「`previous` の対応する id のノードが `dragging === true` か」のみ。
  `dragging` を持たない(=ドラッグ中でない)ノードは何もせず `next` の値を
  そのまま使う。これにより、ドラッグ中でない他のノードへの WebSocket 更新
  (他ノードの新規追加・移動)は従来どおり即座に反映され続ける
- 適用箇所: `Canvas.tsx` の該当 `useEffect` で
  `preserveMeasuredDimensions` の結果にさらに `preserveDraggingState` を
  適用する(`preserveDraggingState(preserveMeasuredDimensions(nodes, current), current)`)。
  両関数は触るフィールドが完全に独立している(`measured` vs
  `position`/`dragging`/`selected`)ため適用順序に依存関係は無い
- テスト: `canvasNode.test.ts` に `preserveDraggingState` 用の describe
  ブロックを追加する(既存の `preserveMeasuredDimensions` のテストパターンに
  倣う)。中心となるケースは「`previous` で `dragging: true` のノードの
  `position` が、`next` 側の新しい `position` に置き換わらず `previous` の
  値を維持すること」。回帰検出力の確認として、修正前(`preserveDraggingState`
  を呼ばない状態)でこのテストが実際に失敗することを一度確認してから実装を
  適用する

### 2026-07-16 Issue #328 実装
- 担当: frontend
- ブランチ: issue-328-drag-position-jitter
- 内容: 設計メモどおりに実装した
  - `packages/frontend/src/entities/canvasNode.ts` に
    `preserveDraggingState<TNode extends CanvasFlowNode>(next, previous)` を
    追加した。`previous`(直前の React Flow 内部状態)側で `dragging === true`
    のノードについてのみ、`next` の `position`・`dragging`・`selected` を
    `previous` の値で上書きする。`data` は常に `next` を使う(ドラッグ中でも
    残高・ブロック高などの内容更新は止めない)
  - `packages/frontend/src/canvas/Canvas.tsx` の該当 `useEffect` を
    `setRfNodes((current) => preserveDraggingState(preserveMeasuredDimensions(nodes, current), current))`
    に変更した
- テスト: `packages/frontend/src/entities/canvasNode.test.ts` に
  `preserveDraggingState` の describe ブロックを追加した(6ケース)。中心と
  なるのは「ドラッグ中のノードは `next` の新しい position に置き換わらず
  `previous` の position/dragging/selected を維持する」ケースと、
  「ドラッグ中でない他ノードは従来どおり `next` の position を反映する」
  ケース
- 回帰検出力の確認: `preserveDraggingState` の実装を一時的に `return next`
  のみ(何もしない no-op)に置き換えてテストを実行し、追加した6ケースのうち
  3ケース(ドラッグ中position保持・他ノードへの影響なし確認・data保持)が
  実際に失敗することを確認した。その後 no-op を元の実装に戻し、全ケースが
  通ることを確認した
- 確認結果: `pnpm --filter @chainviz/frontend build`・
  `pnpm --filter @chainviz/frontend test`(143ファイル/2127件)がいずれも
  成功。`npx eslint` を変更した3ファイルに対して実行しエラー無しを確認した
- 実機確認について: `scripts/dev-up.sh` での Playwright 再現確認は実施
  しなかった。作業時点で他の並行 worktree(issue-319/325/330 等)が同じ
  Docker デーモンを共有しており、`docker ps` で既に別セッションが起動した
  とみられる `chainviz-ethereum-*` スタックが動作中だった。`dev-up.sh` の
  再実行はそちらのスタックを巻き込んで壊すおそれがあるため見送った。今回の
  修正はロジックの純粋関数化がしやすい性質のバグで、detective が実機で
  再現・特定した根本原因(該当 `useEffect` が `rfNodes` を丸ごと置き換える
  ことで `position`/`dragging` が破棄される)に対して、ユニットテストで
  同じ症状(ドラッグ中に `next` の古い position で上書きされる)を再現・
  検出できることを確認済み。実機での最終確認は `chainviz-qa` の通常工程で
  行う想定
- 決定事項・注意点:
  - `onNodeDragStart`/`onNodeDragStop` で id を別途追跡する案は採らず、
    React Flow が `applyNodeChanges` を通じて自動的に反映する
    `previous` 側の `dragging`/`selected` フラグをそのまま信頼する設計に
    した。二重管理を避けるため
  - `selected` も同じ機構で保全されるようにした(detective が「同じ機構で
    毎回失われている可能性が高い、未検証」と付記していた点に対応。ただし
    現状このアプリには `selected` を読んで見た目を変えるカードコンポー
    ネントは無い(React Flow 標準の選択枠のみ)ため、体感できる変化は
    ドラッグ中のガクツキ解消が主)
