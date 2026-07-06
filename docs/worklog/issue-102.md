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
