### 2026-07-10 Issue #220 ノード追加・ワークベンチ追加ボタンの連打防止

#### 設計メモ（着手前）

- 現状確認: `packages/frontend/src/canvas/CanvasToolbar.tsx` の
  `pendingAddNode` / `pendingAddWorkbench` は、スピナー表示・
  `aria-busy` にのみ使われており、ボタンの `disabled` 属性には
  反映されていなかった。`CanvasToolbarProps` の docstring・
  `styles.css` の `.canvas-toolbar__button--pending` 直前のコメント
  にも「二重送信防止のためではない」「ボタン自体は disabled に
  しない」と明記されており、既存テスト
  (`CanvasToolbar.test.tsx` の `"dispatches addNode once per click
  with no built-in double-submit guard"` `"still dispatches addNode
  when clicked while pending (no disabled attribute)"`) がその挙動を
  そのまま固定していた。実際に連打を再現するテストを実行し、
  pending中でも2回クリックで `addNode` が2回呼ばれることを確認した
  （＝Issue #220 の報告どおり、修正前は連打がそのまま通る）。
- `pendingAddNode` / `pendingAddWorkbench` は `AppShell`
  (`packages/frontend/src/app/App.tsx`) で
  `ghosts.some((ghost) => ghost.data.kind === "node" / "workbench")`
  として算出されている。ghosts は `useCommands.ts` の `dispatch` が
  addNode/addWorkbench 送信と同期的に生成し、実エンティティ到着
  (`entityAdded`)・失敗 (`commandResult(ok:false)`)・安全網タイムアウト
  (`ghostNode.ts` の `GHOST_TIMEOUT_MS`) のいずれかで消える。つまり
  「ゴーストが1枚でも残っている」は「直前の追加コマンドがまだ
  解決していない」を過不足なく表しており、`runWorkbenchOperation`
  の `pendingOperationCounts` と同種の「保留追跡→UI反映」の仕組みが
  addNode/addWorkbench にもすでに存在していた。
- 対応方針: 新しい状態やカウンタを増やさず、既存の
  `pendingAddNode` / `pendingAddWorkbench`（＝ゴーストの有無）を
  そのままボタンの `disabled` にも使う。理由:
  - ゴーストの生成・消滅ロジック（FIFO近似・タイムアウトの安全網）を
    そのまま「連打防止」の判定にも転用でき、新しい二重管理を避けられる
  - HTML の `disabled` 属性が付いた `<button>` はブラウザがクリック
    イベント自体を発火させないため、JS側で追加のガード処理を書かなくても
    実際の連打（別々のブラウザイベントとして飛んでくる）を止められる。
    `type="submit"` の暗黙フォーム送信（input内でのEnter）も、既定の
    送信ボタンが disabled の場合はブラウザが送信をブロックする
  - ゴーストが安全網タイムアウト（60秒、固定UX値。`ghostNode.ts` の
    `GHOST_TIMEOUT_MS` のコメント参照）で消えた場合は自動的に
    ボタンも再度有効化されるため、「entityAdded も commandResult も
    来ない異常系でボタンが永久に押せなくなる」事故を避けられる
- 変更点:
  - `CanvasToolbar.tsx`: 追加ボタン・ワークベンチ追加ボタン
    (`type="submit"`) に `disabled={pendingAddNode}` /
    `disabled={pendingAddWorkbench}` を追加。props docstring も
    「連打を許容する」から「pending中はdisabledにする」に書き換える
  - `styles.css`: `.canvas-toolbar__button--pending` 直前のコメントを
    更新し、`:disabled` の見た目（`cursor: not-allowed`・薄い表示）を
    追加する
  - `App.tsx`: `pendingAddNode` / `pendingAddWorkbench` の docstring を
    「ローディング表示に使う」から「ローディング表示 兼 連打防止の
    disabled 判定に使う」に更新（値の算出ロジック自体は変更不要）
  - `CanvasToolbar.test.tsx`: 連打を許容する2件のテストを、
    「pending中はdisabledになり、クリックしても発火しない」
    「pendingでなければ従来どおり複数回発行できる」を検証する内容に
    書き換える
- スコープ外（別Issueで対応するか、既存のまま）:
  - `runWorkbenchOperation`（送金/デプロイ/呼び出し）の連打は本Issueの
    対象外。`useCommands.ts` の docstring どおり、こちらは意図的に
    二重送信を許容する設計のままにする
  - ワークベンチラベル入力欄 (`<input>`) 自体は disabled にしない
    （pending中でも次に追加するラベルを先に入力し始めることは妨げない。
    実際の送信はボタン/フォーム送信の disabled で防がれる）

#### 実装記録

- 担当: frontend
- ブランチ: issue-220-prevent-double-add
- 内容: 上記設計メモのとおり実装。`CanvasToolbar.tsx` の2ボタンに
  `disabled` を追加し、`styles.css` に `:disabled` の見た目
  （`cursor: not-allowed` + 半透明化）を追加。`App.tsx` の docstring を
  更新。`CanvasToolbar.test.tsx` の該当2テストを新しい仕様に合わせて
  書き換えた。
- 確認したこと:
  - jsdomでのユニットテスト: 修正前は `CanvasToolbar.test.tsx` に
    「pending中でもdisabledにしない」ことを固定するテストが既に
    存在しており、これを実行してpending中でも連打で `addNode` が
    複数回呼ばれることを確認（Issue の再現）。修正後は同テストを
    書き換え、pending中はボタンが `disabled` になり `fireEvent.click`
    を複数回呼んでも `addNode`/`addWorkbench` が1回も呼ばれないこと、
    pendingでなければ従来どおり複数回発行できることの両方を確認
  - 実ブラウザでの確認: `pnpm dev` でフロントエンドを起動し（モック
    クライアント）、Playwrightで実際のマウスクリックを5連打した。
    モッククライアントは既定でコマンド結果を即時（マイクロタスク）に
    返すため、pendingウィンドウが実際の連打の間隔より短くなり
    disabled化の効果を目視で確認しづらかった。そこで
    `createMockClient` に既存の `commandLatencyMs` オプション
    （テスト用に既に用意されていた、結果を返すまでの遅延)を一時的に
    3000msで渡すよう `defaultClient.ts` を書き換えて確認用に起動し
    （確認後は元に戻し、コミットには含めていない）:
    - 修正前（`disabled` 属性を一時的に取り除いた状態）: 5連打で
      実カードが10枚（reth+beacon 5組)増え、5回とも `addNode` が
      送信されてしまうことを確認（再現）
    - 修正後: 5連打してもボタンが `disabled` になり、実カードは2枚
      （1組)しか増えないことを確認（修正確認）
  - `pnpm build && pnpm lint && pnpm test`（frontendパッケージ）が
    通ることを確認
- 決定事項・注意点:
  - `pendingAddNode` / `pendingAddWorkbench` はゴースト（仮カード）の
    有無から算出される既存の値をそのまま流用した。新しい状態や
    タイムアウト定数は追加していない
  - モッククライアントの `commandLatencyMs` は元々テスト用に用意されて
    いたオプションで、今回の実装では使っていない（確認作業でのみ
    一時的に利用し、最終的なコミットには含まれていない）。本番の
    `defaultClient.ts` は変更なし
  - `runWorkbenchOperation` 側のボタン（送金/デプロイ/呼び出し）は
    本Issueの対象外のため変更していない。連打時の挙動について
    ユーザーから追加の指摘があれば別Issueとして起票する

#### レビュー記録（chainviz-reviewer）

- 判定: 合格
- 確認したこと:
  - `pendingAddNode` / `pendingAddWorkbench` の算出元（`App.tsx` の
    `ghosts.some(...)`）と、ゴーストが消える3経路を実コードで確認した。
    (1) 実エンティティ到着: `useCommands.ts` の `state.entities` 監視
    effect が `removeGhostForArrivedEntity` を呼ぶ（EL/CL層一致優先＋
    FIFOフォールバック）。(2) 失敗: `handleCommandResult` の
    `ok:false` 分岐で `removeGhostByCommandId`。(3) 安全網: ゴースト
    ごとに `GHOST_TIMEOUT_MS`（60秒）のタイマーを張り直す effect。
    タイマーは ghosts state と同期して張り直され、アンマウント時にも
    まとめて破棄される。3経路のいずれかで必ず解除されるため、
    「ボタンが押せなくなったまま」にはならない
  - `GHOST_TIMEOUT_MS` は環境の状態（稼働時間・ブロック数）に依存しない
    固定UX値であり、その前提条件が `ghostNode.ts` のコメントに明記
    されている（「固定値をロジックに埋め込まない」ルールに適合）
  - `sendCommand` が `undefined` を返す（未接続）場合はゴースト自体が
    作られないため、この経路でも disabled 固着は起きない
  - テスト: 旧仕様（pending中も連打可）を固定していた2テストが、
    「pending中は `disabled` になりクリックが発火しない」（両ボタン）
    「pending解除後は再度押せる」「非pending中はクリック回数分発行」
    に置き換えられており、`disabled` 属性を外せば失敗する実質的な
    テストになっている
  - `type="submit"` ボタンが disabled の間、input内Enterの暗黙送信を
    ブラウザがブロックすることは HTML 仕様どおり（worklog の設計メモに
    記載あり）。`onAddWorkbench` 自体には pending ガードが無いが、
    プログラム的な `form.requestSubmit()` 等の呼び出し経路は存在しない
    ため実害なし（将来フォーム送信経路を増やす場合はガード追加を検討）
  - スタイル: `.canvas-toolbar__button:disabled` はツールバーの2ボタン
    にのみ適用され、他のUI要素（`.operation-form__submit:disabled` 等）
    への副作用なし
  - `pnpm build` / `pnpm lint` / `pnpm test` がリポジトリ全体で通過
    （shared 59 / e2e 77 / collector 1137 / frontend 1608 件すべて合格）
  - `docs/PLAN.md` のチェック・`docs/WORKLOG.md` 索引・本ファイルの
    記録が実装と整合。コミット粒度は実装1＋docs1の2コミットで適切
- 統括への申し送り:
  - 本ブランチは main より2コミット遅れており（merge-base `26f4273`、
    main 先端は Issue #216 のdocsコミット）、`docs/WORKLOG.md` の索引
    末尾行が main 側の #216 行と競合する（`git merge-tree` で確認済み）。
    マージ前に main への rebase（または競合解消）が必要。競合は索引
    表の行追加同士なので両方残せばよい

#### QA検証記録（chainviz-qa）

- 判定: 合格（Issue #220 の連打による多重送信は解消されている）
- 検証環境: frontend を vite dev server（モッククライアント、collector
  未接続）で起動し、Playwright（chromium）で実ブラウザ操作を自動化して
  確認した。モッククライアントは既定でコマンド結果をマイクロタスクで
  即時に返し pending ウィンドウが実際の連打間隔より短くなるため、
  実装記録と同様に `defaultClient.ts` へ一時的に
  `createMockClient(handlers, { commandLatencyMs: 2500 })` を注入して
  現実的なコマンド往復遅延を再現した（検証専用の変更。確認後に
  `git checkout` で戻し、作業ツリーはクリーンな状態に復帰済み。コミット
  していない）。
- 実施内容と結果:
  1. 「+ ノードを追加」ボタンを 30ms 間隔で 5 連打した。押下直後に
     ボタンが `disabled` になり（`disabled=true`）、ゴーストは 2 枚
     （reth/beacon の EL/CL 各 1 枚 = addNode 1 コマンド分）のみ生成された。
     2.5 秒後のコマンド解決後、実カード（infra-card）の増分は 2 枚
     （reth+beacon 1 組）のみだった。5 連打しても addNode コマンドは
     1 回しか反映されておらず、多重送信が防止されていることを確認した。
  2. 「+ ワークベンチを追加」ボタンでも同様に 5 連打した。押下直後に
     ボタンが `disabled` になり、ゴーストは 1 枚のみ生成され、解決後の
     実カード増分も 1 枚のみだった。多重送信が防止されていることを
     確認した。
  3. どちらのボタンも、コマンド解決（実カード到着・ゴースト消滅）後に
     `disabled=false` へ戻り再度押下できる状態になることを確認した
     （ノード側・ワークベンチ側とも解決後 `disabled=false`、ghosts=0）。
  4. disabled 中の見た目を確認した。`aria-busy=true`、`--pending`
     クラス付与、スピナー要素あり、`opacity: 0.7`、`cursor: not-allowed`
     が適用されており、作成中であることが視覚的に伝わる状態だった。
- 補足: addNode 1 コマンドがゴースト 2 枚・実カード 2 枚を生む点は
  `useCommands.ts`（reth/beacon の2枚のゴースト）・mockData.ts の
  addNode ハンドラ（entityAdded ×2）で裏取り済み。したがって「実カード
  増分 2 枚」は addNode コマンドがちょうど 1 回だけ処理されたことを
  過不足なく表す。
- 静的確認: `CanvasToolbar.test.tsx`（22 件）が合格。pending 中に
  `disabled` になりクリックが発火しないこと、pending 解除後に再度
  押せることを検証するテストが含まれることを確認した。
