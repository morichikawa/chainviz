### 2026-07-10 Issue #222 ノード/ワークベンチ削除中に進行中であることを示す
フィードバックが無い(設計メモ)
- 担当: frontend
- ブランチ: issue-222-delete-pending-feedback

#### 現状確認

- `useCommands.ts` には `runWorkbenchOperation` 用の保留追跡
  (`pendingOperationCounts` → `pendingOperationWorkbenchIds`) が既にあるが、
  `removeNode` / `removeWorkbench` にはこの仕組みが無い。`dispatch` 内で
  `command.action !== "addNode" && command.action !== "addWorkbench"` の
  時点で早期 return しており、削除コマンドは commandId を `pendingRef` に
  積むだけで、UI側が参照できる保留状態を一切持たない。
- `InfraNodeCard.tsx` の削除ボタンは `onClick={onRemove}` のみで、
  クリック後の状態を反映する仕組みが無い(Issue本文の記載どおり)。

#### 採用する設計

`runWorkbenchOperation` の保留追跡パターン(id をキーにしたカウンタ →
Set化)をそのまま踏襲する。node と workbench は同じ `entity.id` 空間で
カードが1枚ずつ対応するため、削除対象の種別を問わず「id ごとの保留
カウンタ」1つで両方をカバーする。

1. `useCommands.ts`
   - `pendingRemovalCounts: Map<string, number>` を追加。dispatch 時に
     `removeNode`/`removeWorkbench` を検知したら対象 id (`nodeId` /
     `workbenchId`) のカウントを +1 する(runWorkbenchOperation と同じ
     カウント方式。理論上同じ id への削除コマンドが二重に飛ぶことは
     UI 上は無い想定だが、ボタン連打時に安全側に倒すため加算式にする)。
   - `handleCommandResult` で `command.action` が `removeNode`/
     `removeWorkbench` の場合、成否によらず対象 id のカウントを -1 する
     (operationPending と同じく「成否によらず解除」。エラー通知は既存の
     `describeCommandError` 経路でそのまま出る)。
   - 集計した Set を `pendingRemovalIds` として `UseCommandsResult` に追加
     し返す。
2. `entities/infraNode.ts`
   - `InfraNodeData` に `removalPending?: boolean` を追加(`isNew`/
     `operationPending` と同じ「時間・保留状態に依存する派生プロパティ」
     の扱いで、`entitiesToFlowNodes` 自体は持たせず `isSameInfraNode` の
     比較対象にも含めない)。
3. `app/App.tsx`
   - `useCommands` の戻り値から `pendingRemovalIds` を受け取り、
     `infraNodesWithHighlight` の後付け計算に `removalPending =
     pendingRemovalIds.has(node.id)` を追加する(`isNew`/`operationPending`
     と同じ変化検知つきのマージ)。
4. `entities/InfraNodeCard.tsx` / `styles.css`
   - UI表現は「カード全体の半透明化 + 削除ボタンの無効化 + スピナー」を
     採用する(Issue本文の提案どおり。追加時のゴーストカード
     (`.ghost-card`: `opacity:0.55` + `pointer-events:none`)と一貫させる
     ため、削除中カードにも同型のクラス `infra-card--removing` を追加し
     同じ値を使う)。
   - 削除ボタンは `removalPending` の間 `disabled` にし、内容を「×」から
     スピナー(`chainviz-spin` を共有する新クラス
     `infra-card__remove-spinner`)に差し替える。`aria-label`/`title` も
     `action.remove.pending`(「削除中…」/"Removing…")に切り替える。
   - 操作パネルを持つワークベンチの操作ボタンについては、削除中は
     カード自体が `pointer-events: none` になるため個別の無効化ロジックは
     追加しない(ゴーストカードと同じ扱い)。
   - 新規メッセージキー `action.remove.pending` を追加
     (`action.addNode.pending`/`action.addWorkbench.pending` と同じ形式)。

#### 選ばなかった案

- 「ボタンだけ無効化してカードは半透明にしない」案: 追加時のゴーストと
  見た目の一貫性が薄れるため不採用。
- 「二重送信防止として一度押したら二度と押せなくする」仕組み自体の追加:
  今回のスコープは「保留中であることの可視化」であり、二重送信防止の
  要否は別問題(既存の `runWorkbenchOperation` も二重送信防止はしない
  方針)。ボタンの `disabled` はあくまで視覚的フィードバックの一部として
  副次的に付くだけで、それ自体を目的にした設計変更はしない。

#### テスト方針

- `useCommands.ts`: 新規 `useCommandsPendingRemoval.test.tsx` に、
  `runWorkbenchOperation` 用テストファイルと同じ形式で
  removeNode/removeWorkbench それぞれの保留セット追跡
  (即時セット・ok/ng 両方での解除・id ごとの独立性)を書く。
- `InfraNodeCard.tsx`: 既存 `InfraNodeCard.test.tsx` に
  `removalPending` 用の describe ブロックを追加(カードのクラス・ボタンの
  disabled・スピナー表示)。

### 2026-07-10 Issue #222 実装記録
- 担当: frontend
- ブランチ: issue-222-delete-pending-feedback

#### 内容

上記の設計メモどおりに実装した。差分の要点:

- `commands/useCommands.ts`: `pendingRemovalCounts`(`Map<id, count>`)を
  追加し、`dispatch` が `removeNode`/`removeWorkbench` を検知した時点で
  対象 id のカウントを +1、`handleCommandResult` で成否によらず -1 する。
  Set化した `pendingRemovalIds` を `UseCommandsResult` に追加した。
- `entities/infraNode.ts`: `InfraNodeData` に `removalPending?: boolean`
  を追加(`isNew`/`operationPending` と同じ、時間依存の派生プロパティ)。
- `app/App.tsx`: `pendingRemovalIds` を受け取り、`infraNodesWithHighlight`
  の後付け計算に `removalPending` を追加した。
- `entities/InfraNodeCard.tsx`: `removalPending` の間、カードに
  `infra-card--removing` クラスを付け(半透明化 + `pointer-events: none`)、
  削除ボタンを `disabled` にして「×」をスピナー(`infra-card__remove-spinner`)
  に差し替え、`aria-label`/`title` を「削除中…」に切り替えた。
- `i18n/messages.ts`: `action.remove.pending`(ja:「削除中…」/
  en:"Removing…")を追加した。
- `styles.css`: `.infra-card--removing`(ゴーストカードと同じ
  `opacity:0.55`+`pointer-events:none`)と `.infra-card__remove-spinner`
  (既存の `chainviz-spin` キーフレームを共有)を追加した。

#### テスト

- 新規 `commands/useCommandsPendingRemoval.test.tsx`(8件): removeNode/
  removeWorkbench それぞれの即時セット・commandResult(ok:true/false)
  両方での解除・id ごとの独立性(node/workbenchで id 空間を共有していても
  混線しない)・同一idへの多重発行時のカウント方式を検証。
- 既存 `entities/InfraNodeCard.test.tsx` に `removalPending` 用の
  describeブロック(6件)を追加: 既定でクラスが付かないこと、
  `removalPending=true` でクラス付与・ボタンdisabled・スピナー表示・
  aria-label/title切り替え・クリックしても `removeNode` が呼ばれない
  こと・workbenchカードでも同じ挙動になることを確認。

#### 動作確認

`pnpm build && pnpm lint && pnpm test`(リポジトリルート、全パッケージ)が
通ることを確認した。加えて、実際に `pnpm dev`(frontend、モックデータ)を
起動し、Playwright(`chromium`。この開発環境では `chromium_headless_shell`/
`chromium` 同梱バイナリの `libnspr4.so` 等の共有ライブラリが不足しており
そのままでは起動できなかったため、`LD_LIBRARY_PATH` で別途用意済みの
ライブラリを指す形で回避した)で以下を確認した。

- 修正前(実装差分を `git stash` で一時的に戻した状態): ノード削除ボタンを
  クリックしても、カードのクラス・ボタンの `disabled`・スピナーのいずれも
  変化せず、Issue本文どおり「進行中であることを示すフィードバックが無い」
  ことを再現した。
- 修正後: `+ ノードを追加` で追加した reth フォロワーカードの削除ボタンを
  クリックすると、`commandResult` が返るまでの間(モックの
  `commandLatencyMs` を一時的に3秒へ上げて確認。本番のデフォルトは
  同期的に近い解決なので実運用ではこの遅延そのものは体感できないが、
  実際のDocker削除では数秒かかる想定であり、その間ずっとこの表示になる)、
  カードに `infra-card--removing` が付いて半透明化し、削除ボタンが
  `disabled` になってスピナーへ切り替わり、`aria-label` が「削除中…」に
  変わることを確認した。`commandResult` 到着後はエンティティごと
  カードが消えることも確認した。

#### 決定事項・注意点

- node/workbench は `entity.id` 空間を共有し1entity=1カードなので、
  `pendingRemovalIds` は種別を分けず単一の `Set<string>` で表現した。
  同じ id へ2件以上の削除コマンドが飛ぶことは UI 上想定していないが、
  `runWorkbenchOperation` と同じカウント方式にしてあるため、万一連打で
  複数飛んでも早期に pending 解除されることはない(安全側)。
- 削除ボタンの `disabled` 自体は「二重送信防止」を目的にした変更ではなく、
  視覚的フィードバック(Issue本文の提案)の一部として付随的に付くだけ。
  既存の `runWorkbenchOperation`(操作ボタンは押下可能なまま)とは
  ポリシーが異なる点に注意(削除は一度発行したら取り消せない操作なので、
  ここでは disabled にする判断をした)。
- カードに `pointer-events: none` を付けるため、削除中はホバー
  ポップオーバー(`InfraPopover`)も出なくなる(`.ghost-card` と同じ仕様)。
  これは意図的な挙動。

### 2026-07-10 Issue #222 レビュー記録
- 担当: reviewer
- ブランチ: issue-222-delete-pending-feedback

#### 判定

合格。差し戻し事項なし。

#### 確認した内容

- `pendingRemovalCounts` のカウンタ管理: 既存の `pendingOperationCounts`
  (runWorkbenchOperation用)と同一のパターン(dispatch成功時に+1、
  `handleCommandResult` で成否によらず-1、count<=1 で Map から削除)で
  実装されており一貫している。`sendCommand` が undefined を返した場合
  (未接続)はカウントしない点も正しい。
- node/workbench の id 空間共有の前提: `packages/shared` では
  NodeEntity / WorkbenchEntity とも `InfraEntity.id` を持ち、ワールド
  ステートは単一の `entities: Record<id, entity>` マップで管理される
  ため、種別を問わず id は構造的に一意。単一 Set での表現は妥当。
- `InfraNodeData.removalPending`: `isNew` / `operationPending` と同じ
  「時間・保留状態依存の派生プロパティ」として optional で追加され、
  `entitiesToFlowNodes` では設定せず App.tsx の後付けマージ
  (変化検知つき、参照安定性維持)で付与する既存設計と一貫している。
- 削除失敗時(ok:false)の解除: `handleCommandResult` が成否によらず
  カウントを減らすため、拒否された削除でもカードが `removalPending`
  のまま残らない。テスト(ok:false での解除・エラー通知の発火)でも
  検証済み。エラー通知は既存の `describeCommandError` 経路が維持されて
  おり、エラーの握りつぶしは無い。
- テストの有効性: `useCommandsPendingRemoval.test.tsx`(8件)は修正前の
  コードでは `pendingRemovalIds` 自体が存在せず必ず失敗する(=修正前後の
  違いを実際に検出できる)。多重発行時のカウント維持・id ごとの独立性・
  ok/ng 両方の解除もカバー。`InfraNodeCard.test.tsx` の追加6件も
  クラス付与・disabled・スピナー・aria-label・クリック無効・workbench
  カードへの適用を検証しており、実装の詳細をなぞるだけの無意味な
  テストにはなっていない。worklog に「修正前の状態で再現を確認した」
  記録もある。
- 環境依存の固定値: 新規追加なし(スピナーのアニメーション時間0.7sは
  純粋な見た目の値)。
- `pnpm build` / `pnpm lint` / `pnpm test` はリポジトリ全体で通過
  (frontend 1621件を含む全106ファイル成功)。
- コミット粒度: feat(実装+テスト)と docs(worklog/PLAN/索引)の2コミット
  に分かれており適切。

#### 注意点(差し戻しではない申し送り)

- `pendingRemovalIds` には、commandResult が永久に届かない異常系
  (コマンド送信直後の WebSocket 切断など)への安全網タイムアウトが無い。
  これは既存の `pendingOperationWorkbenchIds` も同じ仕様であり、既存
  パターン踏襲として今回のスコープでは妥当と判断した。ただし削除保留は
  カード全体が `pointer-events: none` になるぶん、固着した場合の影響が
  操作スピナーより大きい(リロードまでカードに触れなくなる)。将来
  問題になったら、ゴーストカードの `GHOST_TIMEOUT_MS` と同様の安全網を
  検討する余地がある。
- ブランチの分岐点が現在の main より古い(#214/#216 等のマージ前)。
  `docs/WORKLOG.md` の索引末尾への行追加が main 側の追記と衝突する
  可能性があるため、マージ時に統括側でコンフリクト解消(または rebase)
  が必要になる場合がある。

### 2026-07-10 Issue #222 QA検証記録
- 担当: qa
- ブランチ: issue-222-delete-pending-feedback

#### 検証方法

frontend をモックデータで実際にブラウザ(Playwright/Chromium headless)で
起動して操作した。既定のモックは削除コマンドをほぼ即時(commandLatencyMs=0)
に解決してしまい保留状態の可視化を目視できないため、実際の collector で
Docker 削除に数秒かかる状況を再現する目的で、検証用の一時エントリ
(commandLatencyMs=2500 でモッククライアントを生成)を用意して確認した
(この一時ファイルとモックの改変は検証後にすべて破棄し、作業ツリーは
クリーンに戻した)。

#### 確認結果(いずれも実際のDOM属性で確認)

1. ノードカードの削除ボタン押下時の即時フィードバック: 合格
   - クリック前: class は `infra-card infra-card--node`、削除ボタンは
     enabled・aria-label「削除」・スピナー無し。
   - クリック直後(150ms後): カードに `infra-card--removing` が付与され、
     削除ボタンが `disabled`・`aria-busy=true`・aria-label「削除中…」に
     切り替わり、`.infra-card__remove-spinner` が表示された。
2. ワークベンチカードでも同様: 合格
   - `+ ワークベンチを追加` で追加したワークベンチ(removable)で、
     クリック直後に `infra-card--removing`・ボタン disabled・aria-busy・
     aria-label「削除中…」・スピナー表示に切り替わることを確認した。
3. 削除完了後の遷移: 合格
   - commandResult(ok:true) 到着後、対象カードが DOM から消える
     (entityRemoved 反映)ことを確認した。
4. 削除失敗時に元の状態へ戻ること: 合格
   - モックの removeWorkbench を一時的に ok:false を返すよう改変して確認。
     削除中は removalPending 表示になり、commandResult(ok:false) 到着後は
     カードが残ったまま `infra-card--removing` が外れ、ボタンが enabled・
     aria-label「削除」・スピナー無しへ復帰した。あわせてエラー通知
     (トースト)が表示されることも確認した。

#### 判定

合格。Issue #222 の「ノード/ワークベンチ削除中に進行中であることを示す
フィードバックが無い」は解消されている。完了条件を満たす。
