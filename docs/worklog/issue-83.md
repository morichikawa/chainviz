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
