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
