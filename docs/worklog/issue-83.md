### 2026-07-05 Issue #83 ワークベンチ→ノードの操作エッジをエッジ+パルスで描画する
- 担当: frontend
- ブランチ: issue-83-operation-edge-render
- 内容:
  - Issue #80 で配信される揮発性の `operationObserved`（`OperationEdge`）を、
    キャンバス上に一時的なエッジ + パルスとして描画する仕組みを実装した。
  - `entities/operationEdge.ts`（純粋関数・型）を新規追加:
    - `OPERATION_EDGE_TYPE` / `OPERATION_PULSE_DURATION_MS`(900ms) /
      `OPERATION_EDGE_COLOR`(`var(--op-edge)`)
    - `buildOperationFlowEdge`: 観測イベントを React Flow エッジ（パルスなしの
      土台）へ変換。端点（ワークベンチ・ノード）の両方がキャンバス上に存在
      しない場合・自己ループの場合は null を返す。source=ワークベンチ /
      target=ノード。
    - `addOperationPulse` / `removeOperationPulse`: エッジ配列へパルスを足し引き
      する純粋関数。同一ペアには 1 本のエッジをまとめ、その上に複数パルスを
      乗せる。パルスが 0 本になったらエッジごと配列から落とす（揮発性）。
  - `entities/useOperationPulses.ts`（フック）を新規追加: `useBlockPulses` の
    構造を踏襲。未処理の観測（seq で重複排除）ごとに一時エッジ + パルスを生成し、
    `OPERATION_PULSE_DURATION_MS` 後に消す。deps は signals に絞り、端点存在判定は
    ref 経由で最新の infra ID 集合を参照する（`useBlockPulses` と同じ方針）。
    アンマウント時に保留タイマーを破棄する。
  - `entities/OperationPulseEdge.tsx`（カスタムエッジ）を新規追加: `data.pulses`
    を `animateMotion` で source→target へ走らせる。peer とは別クラス
    (`.operation-pulse`) で色を分ける。
  - 配線: `world-state/store.ts` に `extractOperations`（差分列から
    operationObserved だけを抜き出す純粋関数）を追加。`applyDiff` は従来どおり
    operationObserved を無視する（ワールドステートに畳み込まない）。
    `useWorldState` が onDiff で operationObserved を分離し、通し番号を付けて
    `operations: OperationSignal[]` として別経路で返す。`useCommands` →
    `App` を経由して `useOperationPulses` へ渡し、生成エッジを Canvas の edges に
    合流させる。`Canvas.tsx` の edgeTypes に `OPERATION_EDGE_TYPE` を登録。
    `canvasNode.ts` の `CanvasFlowEdge` 合併型に `OperationFlowEdge` を追加。
  - 色: `styles.css` に `--op-edge: #ff5db1`（マゼンタ）を追加。操作エッジは
    短い点線（`.operation-edge`）、パルスは `.operation-pulse`（マゼンタの発光）。
    B層ピア接続（青緑系パレット）・C層所有エッジ（琥珀 `--own-edge`）のどちらとも
    見分けられる別系統の色にした。
  - モック: `mockData.ts` に `mockOperationObserved` を追加し、live 差分の各 tick で
    workbench-alice → reth-node-1 の `eth_sendRawTransaction` を観測させる。これで
    collector なしでも操作パルスの見た目を確認できる。
  - テスト: `operationEdge.test.ts`（14）・`useOperationPulses.test.tsx`（フェイク
    タイマーでパルス生成・時間経過での消滅・端点不在の無視・seq 重複排除・並行
    パルス・アンマウント時のタイマー破棄）・`store.test.ts`（applyDiff が
    operationObserved を無視すること / extractOperations の抽出）・
    `mockData.test.ts`（tick で operationObserved が流れること）を追加。
    frontend 381 tests green、全パッケージ build/lint/test green。
- 決定事項・注意点:
  - 操作エッジはワールドステートに保存されない揮発性のエッジ。エッジ自体が
    パルスの表示時間だけ存在し、走り終わると消える（peer/ownership とは異なる
    ライフサイクル）。ARCHITECTURE.md §2 の operationObserved の項に実装方針を
    追記した。
  - `OPERATION_PULSE_DURATION_MS`(900ms) は実データ上の伝播時間差ではなく
    「操作が起きたことを一瞬目視できる最低表示時間」という UX 演出値。ブロック
    伝播パルスと違い、1 回きりの呼び出しには時間差が無いため実測から導出しない
    （コード側コメントにも明記）。
  - `useWorldState` の `operations` は `OPERATION_SIGNAL_CAP`(100) で上限を設けて
    いるが、これは観測件数に依存した閾値ではなく、消費前に破棄しないための
    メモリ上限。WebSocket メッセージ 1 通ごとに onDiff→再レンダー→
    useOperationPulses の消費が走るため、この上限を超える未消費イベントは
    積み上がらない（seq による重複排除で、消費済みが押し出されても問題ない）。
  - ワークベンチ→ノードの間に peer エッジは存在しない（peer はノード間 P2P）ため、
    Issue 本文の「既存の PeerEdge があればその上に」は実際には発生せず、常に
    一時エッジを新規生成する実装にした。
  - shared の型定義（`OperationEdge` / `operationObserved`）は Issue #80 で
    確定済みのものをそのまま利用し、変更していない。

### 2026-07-05 Issue #83 テスト強化（異常系・境界値）
- 担当: tester
- ブランチ: issue-83-operation-edge-render
- 内容:
  - 描画麗が実装した操作エッジ+パルスの基本テストを、異常系・境界値の観点で
    強化した。実装コードは変更していない（テストの追加のみ）。
  - `operationEdge.test.ts` に 16 件追加（14→30）:
    - `buildOperationFlowEdge`: 両端点が不在／present 集合が空の場合の null、
      自己ループは端点存在判定より前に弾かれること（存在時・不在時の両方）、
      lazy generator を present 引数に渡せること、type/className/stroke など
      描画メタデータの付与、operation が空文字でも既定値に置換されないこと。
    - `addOperationPulse`: 入力配列・既存エッジの pulses 配列を破壊しない
      イミュータビリティ、重複キーを与えても dedupe せず追加する挙動
      （キー一意性は上流責務）、同一エッジへの 100 件蓄積。
    - `removeOperationPulse`: 空入力／未知エッジ ID の no-op、複数パルスから
      中央のパルスだけを順序を保って除去、対象エッジ以外を残すこと、
      入力を破壊しないこと。
  - `useOperationPulses.test.tsx` に 10 件追加（10→20）:
    - 自己ループ観測の無視、両端点不在の無視。
    - 端点不在で無視された seq は、その後端点が現れて同じ seq が再送されても
      再アニメーションしないこと（seq を消費済みとして扱う仕様の固定）。
    - 同一ペア上に時間差で乗った複数パルスが各自のタイマーでのみ消え、
      互いを巻き添えにしないこと（干渉なしの確認）。異なるペア間でも
      時間差で独立に消えること。
    - 満了して消えた seq を再送しても再生成しないこと、消費済み seq の後に
      来た新しい seq だけが走ること。
    - 同一ペアへの 50 件同時観測を 1 本のエッジ上で束ね、満了で一括消去。
    - 満了前に同一 signals で再レンダーを繰り返してもパルスが増殖せず、
      二重スケジュールによるタイマーリークが起きないこと。
    - パルス除去後にアンマウントしても例外が出ないこと。
  - `store.test.ts` に 4 件追加（33→37）:
    - `extractOperations`: 空イベント列で空配列、operationObserved 以外の
      DiffEvent 種別（entityAdded/Updated/Removed・edgeAdded/Removed）を
      一切拾わないこと、他イベントと交互に並んでも順序・件数を保つこと。
    - `applyDiff` が operationObserved を実状態変化と混在させても畳み込まない
      こと。
  - frontend 411 tests green（+30）、`pnpm lint` / build green。
- 決定事項・注意点:
  - 「端点不在で無視された seq は再送しても復活しない」挙動は、実装が
    `seen.add(signal.seq)` を build 判定より前に行うことに由来する。観測は
    1 回きりの出来事で、端点が現れる頃には演出の瞬間が過ぎているため、
    仕様として妥当と判断し characterization テストで固定した。
  - 実装に差し戻すべきバグは見つからなかった。

### 2026-07-05 Issue #83 操作エッジ描画のレビュー(合格)
- 担当: reviewer
- ブランチ: issue-83-operation-edge-render
- 内容:
  - 境界の遵守を確認した。`operationObserved` はワールドステートの
    store 状態(entities/edges)へ一切畳み込まれない。`applyDiff` は
    default 節で無視し(store.test.ts で挙動を固定済み)、`extractOperations`
    が別経路(`useWorldState` の `operations`)へ流し、描画層の
    `useOperationPulses` だけが揮発性イベントとして消費する。
    ARCHITECTURE.md §2 の記述どおりの実装になっている。
  - チェーン固有語彙(`eth_*`)の漏れを grep で確認した。テスト・モック
    データ(collector のワイヤーフォーマットを模すもの)以外の frontend /
    shared のロジックには存在しない。`OperationEdge.operation` は設計上
    「チェーン依存の生の文字列」であり、frontend はそれを解釈せず
    そのまま持ち回るだけなので問題ない。
  - 試験学が挙げた懸念点「端点不在で無視された seq は、後で端点が現れて
    同じ seq が再送されても再アニメーションしない(`seen.add` が端点判定
    より前)」は、**(a) 妥当な仕様**と判断した。理由:
    (1) operationObserved は「観測された瞬間の出来事」(ARCHITECTURE.md §2
    「フロントは受信時に…消費し」)であり、パルスは観測時刻の演出。
    seq を消費済みにしない実装だと、signals バッファ(上限100件)に
    残っている間は再レンダーのたびに再試行され、端点が数十秒〜数分後に
    現れた時点で「とっくに終わった呼び出し」のパルスが今起きたかのように
    走ってしまう。これは時系列の嘘になり、遅延再生のほうが有害。
    (2) 実運用ではワークベンチ・ノードはスナップショット/entityAdded で
    操作観測より先に届くため、端点不在は起動直後の一瞬の競合か削除直後
    のみで、取りこぼしの実害は極小。characterization テストで固定した
    現在の挙動を仕様として承認する。
  - 固定値の妥当性を確認した。`OPERATION_PULSE_DURATION_MS`(900ms) は
    実測から導出すべき量ではない UX 演出値であることがコードコメントと
    worklog の両方に明記されている。`OPERATION_SIGNAL_CAP`(100) も
    「観測件数に依存した閾値ではなくメモリ上限」という前提条件が
    両方に明記されており、運用ルールを満たす。
  - エラーの握りつぶしは無い。端点不在時の無視は設計上の意図的な挙動で、
    コードコメント・ARCHITECTURE.md に明記されている。
  - テストの実効性を確認した。seen 重複排除を外せば「再レンダーで
    パルスが増殖しない」テストが落ち、タイマー後始末を外せば満了時の
    独立消滅テストが落ちる構造で、実装の詳細をなぞるだけの無意味な
    テストは見当たらない。イミュータビリティ・干渉なし・リーク検出の
    観点も有意味。
  - `pnpm lint` / `pnpm build` / `pnpm test` を全パッケージで実行し全て
    成功(frontend 411 / collector 498)。基本テストのみの中間コミット
    状態でも frontend のテストが緑であることを確認した。
  - コミット分割をレビュー担当が実施した(未コミット状態で引き渡された
    ため)。feat(実装+基本テスト) / test(強化30件) / docs の3コミット
    +本レビュー記録に分けた。試験学の追加テストは git インデックス操作
    (update-index)で分離し、作業ツリーのファイルは一切上書きしていない。
- 決定事項・注意点:
  - 軽微(非ブロッキング): `applyDiff` の default 節のコメントは
    「未知のイベント型は無視する(前方互換)」だが、operationObserved は
    既知の型を意図的に畳み込まない扱いなので、厳密には
    `case "operationObserved"` を明示して意図をコメントするほうが
    読み手に親切。挙動はテストで固定済みのため差し戻しはしない。
    次に store.ts を触る機会があれば直すとよい。
  - 実際の描画(パルスがマゼンタで走って消えること・ピア/所有エッジとの
    見分け)は静的確認の範囲外。chainviz-qa の実機検証に委ねる。

### 2026-07-05 Issue #83 QA検証記録
- 担当: qa
- ブランチ: issue-83-operation-edge-render
- 結果: 合格。完了条件「workbench から cast を実行すると、workbench から
  reth1 へのエッジ上にパルスが流れる様子が見える」を満たすことを実機で確認した。
- 実施内容:
  - 静的ゲート: `pnpm lint` / `pnpm build` / `pnpm test` を全パッケージで実行し
    全て成功（frontend 411件・collector 498件、lint/build もエラーなし）。
  - モックデータでのブラウザ確認: `pnpm dev`（モッククライアント）で frontend を
    起動し、Playwright（Chromium headless）で描画を確認した。live 差分 tick ごとに
    `workbench-alice → reth-node-1` の `eth_sendRawTransaction` 観測が発生し、
    操作エッジ（マゼンタの点線）上を発光パルスが流れることをスクリーンショットで
    確認した。方向は source=ワークベンチ → target=ノードで正しい。
  - 実 Docker + 実 collector での end-to-end 確認:
    - `profiles/ethereum` を `docker compose up -d` し、reth1 でブロックが進行する
      ことを確認（block 0 → 1 → … と増加）。
    - ビルド済み collector（`dist/index.js`）を起動（WebSocket 4123 / ロギング
      プロキシ 4001）。
    - workbench コンテナから `cast block-number` / `cast chain-id` / 実 tx を送る
      `cast send`（account0 = ワークベンチウォレット 0x2BB7…、mnemonic はプロファイル
      共有）を実行。WebSocket テストクライアントで、実 collector が
      `operationObserved`（`fromWorkbenchId: chainviz-ethereum/workbench`,
      `toNodeId: chainviz-ethereum/reth1`, `operation: eth_blockNumber` 等,
      `observedAt`）を frontend が消費する形そのままで配信することを確認した。
      端点解決（呼び出し元 IP 172.28.0.2 → ワークベンチ、転送先 172.28.1.1 → reth1）
      も期待通り動作した。
    - `VITE_COLLECTOR_URL=ws://127.0.0.1:4123` で frontend を実 collector に接続し
      （ヘッダのバッジが「接続済み」= 非モック）、workbench から `cast send` を
      繰り返し実行。Playwright で、ワークベンチ → reth1 の操作エッジ上をマゼンタの
      パルスが実際に流れる様子をスクリーンショットで確認した（観測窓 30 秒で
      パルス出現を 27 回検出）。実 tx により当該ウォレットの nonce が 1 に増加した
      ことも画面上で確認した。
  - 色・見た目の区別: 操作エッジ = マゼンタ（`--op-edge` = rgb(255,93,177) /
    #ff5db1、点線 3/4）、C層の所有エッジ = 琥珀（#e0a94f、点線 6/4）、B層のピア
    エッジ = ネットワーク色パレット（モックの networkId 1337 は #f5b544）で、
    操作エッジのマゼンタは所有・ピアのどちらとも別系統として同一画面上で明確に
    見分けられることを確認した。
- 注意点:
  - 実環境の検証後、起動した collector プロセス・vite dev サーバ・Docker スタック
    （`docker compose down -v`）はすべて停止・破棄済み。リスニングポート
    4123/4001/5178/5179 の残留が無いことを確認した。
  - `operationObserved` はどの JSON-RPC メソッドでも操作エッジを生成する（method →
    operation）。read 系（eth_blockNumber 等）でもパルスが流れるため、`cast send`
    に限らず任意の cast 実行でエッジ描画を確認できる。

### 2026-07-05 Issue #83 QA報告の訂正（P2Pエッジ色の記述について）
- 担当: qa
- ブランチ: issue-83-operation-edge-render
- 経緯: 上の「QA検証記録」で、色の区別を説明する際に「B層のピアエッジ =
  ネットワーク色パレット（モックの networkId 1337 は #f5b544）」と書いた。
  この記述について、CONCEPT/ARCHITECTURE では P2P エッジが「青緑系」だった
  はずでは、という疑義が出たため、実装と画像を再確認して訂正する。
- 訂正の対象と、何が誤解を招いたか:
  - 実測値「networkId 1337 は #f5b544（アンバー）」という記述自体は正しい。
    しかし「青緑系」という当時流布していた前提を否定も肯定もせず実測値だけを
    並べたため、あたかも P2P エッジの色が特定の1色に固定されているかのように
    読めてしまった。P2P エッジ色が固定であるという含意を与えた点が不適切だった。
- 正しい実態（`packages/frontend/src/entities/peerEdge.ts` を再確認）:
  - P2P（B層ピア）エッジの色は固定ではない。`networkIdColor()` が `networkId`
    文字列のハッシュを 6 色パレット長で割った剰余で決定的に1色を選ぶ。
  - パレット `NETWORK_COLORS` は次の6色:
    `#7db8ff`(青) / `#38d39f`(青緑) / `#f5b544`(アンバー) / `#d59bff`(紫) /
    `#ff8f6b`(オレンジ) / `#5ad1e8`(シアン)。「青緑」はこの6色のうちの1色で
    あって、P2P エッジ共通の色ではない。
  - 今回のテスト環境の `networkId`(1337) はハッシュの結果、たまたまアンバー
    `#f5b544` が選ばれていた。別の `networkId` なら別の色になる。
  - CONCEPT.md / ARCHITECTURE.md にも「青緑系」という具体的な色指定は無い。
    CONCEPT.md には「どのチェーン（ネットワーク）に所属しているかをエッジの
    色やグループ枠で表現」とあるのみで、具体的な色相は実装（ハッシュ配色）に
    委ねられている。「青緑系」はどこかの時点で生まれた思い込みだった。
- あわせて確認した別の論点（P2P エッジと所有エッジの色の近さ）:
  - `canvas-full.png` を実際に見ると、上部の P2P エッジ（reth-1↔reth-2・
    実線・アンバー `#f5b544`）と、下部の C層所有エッジ（workbench/EOA 間・
    点線・アンバー `--own-edge` `#e0a94f`）は色相がかなり近く、実質的には
    線種（実線／点線）でしか区別できていない。
  - ただしこれは Issue #83 の不具合ではない。#83 の操作エッジはマゼンタ
    `--op-edge` `#ff5db1` で、P2P・所有のどちらとも明確に別系統として
    見分けられており（`e2e-pulse.png` / `canvas-full.png` で確認済み）、
    #83 の完了条件「操作エッジをエッジ+パルスで区別可能に描画する」は
    満たされている。
  - P2P エッジ（アンバー）と所有エッジ（アンバー）の色の近さは、#22-24 の
    P2P 色パレット設計と #82 の所有エッジ色設計に由来する既存の特性であり、
    今回たまたま networkId 1337 が P2P パレットのアンバーを引き当てたことで
    顕在化した。改善の余地がある論点だが、#83 の責任範囲外。必要であれば
    別 Issue（P2P パレットと所有エッジ色の色相分離）として扱うのが適切。
- 合格判定: Issue #83 の合格判定は覆らない。操作エッジの色区別という #83 の
  完了条件は満たされている。今回の訂正は QA 報告文の記述精度の是正であり、
  実装・検証結果そのものの変更ではない。
