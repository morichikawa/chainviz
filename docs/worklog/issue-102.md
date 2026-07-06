# Issue #102 作業記録

### 2026-07-06 Issue #102 ノード/ワークベンチ追加時の仮カード(ゴーストノード)と即時フィードバック
- 担当: frontend
- ブランチ: issue-102-add-ghost-node
- 内容: `addNode` / `addWorkbench` コマンド送信直後、実エンティティが
  world-state の diff として届くまでの間、何も反応が無いように見える問題
  （Docker コンテナ起動に数秒かかるため）に対応した。
  - `entities/ghostNode.ts`（新規）: 仮カード（ゴーストノード）の型・純粋関数。
    - `GhostNodeData` / `GhostFlowNode`（`type: "ghost"` の React Flow ノード）。
    - `createGhostNode`: commandId・種別（node/workbench）・ラベル・グリッド
      添字から仮カード 1 枚を組み立てる。`draggable: false` / `selectable: false`
      にして、位置未確定のままレイアウト永続化に焼き付かないようにした。
    - `removeGhostByCommandId`: commandResult(ok:false) 時に使う、commandId で
      直接 1 枚取り除く純粋関数。
    - `removeOldestGhostByKind`: 実エンティティ到着時に使う。entityAdded は
      commandId を持たないため、同種の仮カードのうち配列内で最も古い（＝先に
      送った）ものを 1 枚取り除く FIFO 近似。これを厳密にするには collector が
      commandId をエンティティに紐付ける必要があり、shared のスキーマ変更を
      伴うため本 Issue のスコープ外とした。
    - `GHOST_TIMEOUT_MS`（60秒）: commandResult も entityAdded も来ない異常系に
      備えた安全網タイムアウト。実行環境の状態（チェーン稼働時間・ブロック数
      など）に依存しない固定 UX 値であり、早期発火しても実害は無い（実カードは
      到着した diff からそのまま描画されるだけで、仮カードの消去タイミングとは
      独立している）ことをコード内コメントに明記した。
  - `entities/GhostNodeCard.tsx`（新規）: 半透明（`opacity: 0.55`）+ 点線境界の
    仮カード。既存の `infra-card` の骨格を再利用しつつ `ghost-card` クラスで
    見た目を変え、スピナー + 「起動中…」（`ghost.status`）を表示する。削除
    ボタンは持たない（コマンド自体を取り消す手段がまだ無いため）。
  - `entities/canvasNode.ts`: `CanvasFlowNode` 合併型に `GhostFlowNode` を追加。
    `canvasNodeLayoutKey` は `node.type === "ghost"` で分岐して commandId を
    返す（実際にはゴーストは非ドラッグなのでこの分岐には到達しないが、合併型
    を網羅するために用意した）。`"entity" in node.data` による型ガードは
    `GhostNodeData extends Record<string, unknown>` の index signature のせいで
    TypeScript が正しく絞り込めず（`entity` の型が `unknown` になる）
    ビルドが通らなかったため、`node.type` の discriminant で判定する方式に
    変更した。
  - `canvas/Canvas.tsx`: `nodeTypes` に `ghost: GhostNodeCard` を追加。
  - `commands/useCommands.ts`: `useState<GhostFlowNode[]>` で ghosts を保持し、
    `UseCommandsResult.ghosts` として公開。
    - `dispatch` が addNode/addWorkbench を送ったら同時に仮カードを 1 枚追加
      する。グリッド添字は「現在のインフラ実体数 + ghostSeqRef（呼び出しの
      たびに即座にインクリメントする ref カウンタ）」で決める。ghosts state の
      長さを直接使わなかったのは、同一イベントハンドラ内で addNode を連続で
      呼ぶ（render を挟まない）と React の再レンダーが間に合わず同じ長さを
      読んでしまい、複数の仮カードが同じグリッド位置に重なるバグが実際に
      再現したため（テストで確認済み。修正前は該当テストが失敗することを
      確認してから直した）。
    - entities 到着検知: `state.entities` の変化を追う useEffect で、前回まで
      見えなかった id のうち kind が node/workbench のものを「新規到着」とみなし、
      到着した kind ぶんだけ `removeOldestGhostByKind` を呼ぶ。
    - 失敗時: 既存の `handleCommandResult`（ok:false 時にトースト通知する箇所）
      に `removeGhostByCommandId` を追加。ok:true では仮カードを消さない
      （実体は diff で後から届くのを待つ）。
    - 安全網タイマー: `ghosts` state を単一の情報源として「無くなった commandId
      のタイマーは消す・新しく増えた commandId にはタイマーを張る」という
      同期処理にした。除去理由（到着・失敗・タイムアウト自身）を問わずに
      正しく後片付けできる。アンマウント時にも残タイマーを clearTimeout する。
  - `canvas/CanvasToolbar.tsx`: `pendingAddNode` / `pendingAddWorkbench`
    （既定 false）の props を追加。true の間、ボタンへスピナー + 補足文言
    （`(追加中…)` 相当、`action.addNode.pending` / `action.addWorkbench.pending`）
    を足し `aria-busy` を付ける。**ボタンは disabled にしない**
    （`CanvasToolbar.test.tsx` に既存の「連打しても二重送信防止をしない」仕様の
    テストがあり、それを壊さないため。ローディング表示はあくまで視覚的フィード
    バックであり、送信自体を防ぐ機能ではない）。
  - `app/App.tsx`: `useCommands` から受け取った `ghosts` を `nodes` 配列へ連結
    してキャンバスへ渡す。`ghosts` の中身から `pendingAddNode` /
    `pendingAddWorkbench` を導出して `CanvasToolbar` に渡す（ghost が実際に
    存在する間だけローディング表示になるので、コマンドの真の保留状態と一致する）。
  - i18n: `action.addNode.pending` / `action.addWorkbench.pending` /
    `ghost.status` を ja/en で追加。
  - スタイル: `styles.css` に `.ghost-card`（半透明・点線・スピナー）と
    `.canvas-toolbar__button--pending` / `.canvas-toolbar__spinner`
    （共有の `chainviz-spin` キーフレーム）を追加。
  - テスト: `entities/ghostNode.test.ts`（純粋関数）・
    `entities/GhostNodeCard.test.tsx`（表示）・`entities/canvasNode.test.ts`
    （`canvasNodeLayoutKey` の3種別分岐、既存ファイルが無かったため新規作成）・
    `commands/useCommands.test.tsx`（仮カード生成・成功時は消さない・失敗時に
    消す・実体到着時に FIFO で消す・種別を跨いで誤消去しないこと・無関係な
    entity 種別/entityUpdated では消えないこと・タイムアウトでの自動消去・
    タイムアウト発火前に解決済みなら何も起きないこと・アンマウント時に
    タイマーが例外なく片付くこと）・`canvas/CanvasToolbar.test.tsx`
    （pending props によるスピナー/`aria-busy`表示、pending中でも押せること）
    を追加。
- 決定事項・注意点:
  - `packages/shared` の型変更は行っていない。ゴーストはフロント内部限定の
    概念（`entities/ghostNode.ts`）として実装し、`Command` / `WorldStateEntity`
    などの共有スキーマには一切手を入れていない。
  - 実エンティティとゴーストの対応付けは commandId ベースの厳密な一致では
    なく「同種のうち最も古いものから消す」FIFO 近似（上述）。通常の操作順
    （1件ずつ追加して待つ）では問題にならないが、同種のコマンドを連打で
    複数積んだ場合、どのゴーストがどの実体に対応するかの見た目上の対応が
    入れ替わる可能性はある（実害は「表示上どのゴーストがどの実体になったか」
    程度で、実体そのものの内容には影響しない）。厳密にしたい場合は collector
    側で commandId をエンティティに紐付ける必要があり、別 Issue とすること。
  - `GHOST_TIMEOUT_MS`（60秒）は環境依存の値ではなく UI 側の安全網。コンテナ
    起動が恒常的にこれより長くかかる環境が今後出てきた場合は見直すこと
    （`entities/ghostNode.ts` のコメント参照）。
  - `pnpm lint` / `pnpm build` / `pnpm test` を全パッケージに対して実行し通過
    済み（frontend 442 tests / 全体 34+ ファイル）。

### 2026-07-06 Issue #102 テスト強化（異常系・境界値の追加）
- 担当: tester
- ブランチ: issue-102-add-ghost-node
- 内容: 実装担当が書いた基本テストに対し、独立した観点で異常系・境界値の
  テストを追加した（実装コードは一切変更していない）。
  - `entities/ghostNode.test.ts`: 純粋関数の境界値を追加。
    - `createGhostNode`: 10 連打相当（連続 index）で全位置が一意になること、
      グリッド幅を跨いだ折り返し（`index === columns`）で行がずれて衝突しない
      こと、既定グリッド/カスタムグリッドの座標が `defaultGridPosition` と
      一致すること、空・空白・特殊文字/絵文字ラベルがそのまま `data.label` に
      入ること、`GHOST_TIMEOUT_MS` が正の有限値であること。
    - `removeGhostByCommandId` / `removeOldestGhostByKind`: 残余の順序保持、
      入力配列を破壊しない（no-op でも新配列を返す）こと、複数該当時に必ず
      1 枚だけ消すこと、種別が交互に並ぶ配列で先頭の他種別を飛ばして目的の
      種別の最古を消すこと。
  - `commands/useCommands.test.tsx`: `setup` に `snapshot` / `setStatus`
    ヘルパーを追加し、以下の describe を追加。
    - FIFO / バースト / 交互: 3 連打後に 1 通の diff で 2 実体が同時到着した際に
      先発 2 枚だけが FIFO で消えること、node/workbench を交互に積んだ場合に
      種別ごとの FIFO が保たれること、1 通の diff に node と workbench が
      混在した場合に各種別 1 枚ずつ消えること、workbench の到着で node の
      ゴーストに触れないこと。
    - 失敗と到着の競合: 失敗で消えた後に実体到着が来ても no-op で例外を出さない
      こと、実体到着でゴースト消費済みの後に遅れて失敗が来ても二重消去にならず
      通知は 1 回だけ出ること、同種 2 枚で片方が commandId 失敗・もう片方が到着で
      両方消えること、同一 act 内で失敗と到着が同時に届いても合計 1 枚ずつ
      正しく消えること。
    - 安全網タイマーの独立性: ずらして生成した 2 枚がそれぞれ自分の 60 秒で
      個別に消えること、片方を早期解決しても残り 1 枚のタイマーが生き続け最終的に
      消えること、失敗解決後に時刻を跨いでもゴーストが復活せず通知も増えないこと。
    - 切断 / 再接続: 再接続スナップショットに実体が含まれれば新規到着として
      ゴーストが消えること、実体を含まない（空）スナップショットでは誤って
      消えないこと、実体がスナップショットと後続 diff の両方に現れても二重消去
      しないこと、既知エンティティがある状態で新規 id がスナップショットに
      現れた分だけ消えること。
  - `entities/GhostNodeCard.test.tsx`: en ロケール表示、スピナーの
    `aria-hidden`、空ラベルでもクラッシュしないこと、削除ボタンを持たないこと。
  - `entities/canvasNode.test.ts`: workbench ゴーストも commandId をキーにする
    こと、同一ラベルでも commandId が異なればレイアウトキーが衝突しないこと。
- 発見した軽微な不具合（frontend 担当への差し戻し検討事項、実装未変更）:
  - ゴーストのグリッド添字は `infraCount + ghostSeqRef` で決まるが、2 回の
    addNode の間に既存インフラ実体が削除される（`entityRemoved` で `infraCount`
    が減る）と、`ghostSeqRef` の増分と相殺して 2 枚のゴーストが同じグリッド
    セルに重なる。`useCommands.ts` の `ghostSeqRef` コメントにある「以後常に
    新しいセルへ置ける」という保証は、実体削除を挟むこのケースでは成り立たない。
    影響は表示上の重なりのみ（機能への実害なし、コメント自身も重なりは
    「実害なし」と述べている）。同種コマンド連打（削除を挟まない）での重なりは
    正しく防げている。テストには固定化していない（誤った挙動を仕様として
    固定しないため）。恒久対応するなら添字を単調増加カウンタ単独にするなどの
    案がある。
- `pnpm lint` / `pnpm build` / `pnpm test` を全パッケージで実行し通過
  （frontend 474 tests / collector 500 tests）。
