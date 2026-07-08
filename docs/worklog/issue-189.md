### 2026-07-08 Issue #189 ノードカード/ポップオーバーに同期ステージ・mempool内訳を表示する 設計メモ
- 担当: frontend
- ブランチ: issue-189-sync-mempool-display

#### 実装前の設計方針

ARCHITECTURE.md §7.6.5（同期ステージの見せ方）・§7.6.6（txpool内訳の見せ方）・
§7.6.7（ステージ表示名マッピング）を実装可能な単位に分解する。Issue #188 の
`chain-profiles/ethereum/nodeInternals.ts`（Engine API メソッド分類ラベル）と
同じ「チェーン固有語彙の解釈はフロント表現セットが担う」流儀を、ステージ名にも
適用する。

既存実装との対応:

| 要件 | 対応する既存実装（参考にした流儀） |
| --- | --- |
| ステージ名 → 表示名マッピング | `chain-profiles/ethereum/nodeInternals.ts` の `ENGINE_API_METHOD_LABELS`/`describeEngineApiMethod`（前方一致ではなく完全一致になる点のみ異なる） |
| ポップオーバーへのフィールド追加 | `InfraPopover.tsx` の `Field` / drivesNode 行（Issue #188）と同じ「entity の optional フィールドがあるときだけ行を足す」流儀 |
| カード面への1行常設表示 | `InfraNodeCard.tsx` の既存構造（`entity.kind === "workbench"` 分岐の操作ボタンと同様、`entity.kind === "node"` 側に条件付きブロックを足す） |
| 「駆動する実行ノード」と同じ他エンティティ参照の後付け | `entities/infraNode.ts` の `drivesNodeContainerName`（`entitiesToFlowNodes` が全エンティティから解決してから `InfraNodeData` に載せる） |

#### 分母（全ELノードの blockHeight 最大値）の導出方法

「EL ノード」をチェーン固有の `clientType` 文字列（reth/geth）で判定する既存の
`clientGlossaryKey`（`InfraPopover.tsx`）とは別に、**`internals.syncStages` が
定義されている node エンティティ** を「ステージ型同期を報告できる EL ノード」
とみなして分母計算の対象にする。理由:

1. `clientGlossaryKey` は用語解説アンカーの選択用のヒューリスティックで、
   D層のこの計算に使うと chain-profiles 外（`entities/`）にチェーン固有の
   文字列判定（"reth"/"geth"）を持ち込むことになる。`internals.syncStages`
   の有無で判定すれば、EL/CL の区別を `clientType` の文字列比較に頼らず
   スキーマの構造（ChainAdapter が EL ノードにのみ `syncStages` を積む設計。
   `packages/shared/entities.ts` の `NodeInternals` docstring 参照）だけで
   行える。
2. ARCHITECTURE.md §7.6.5 は「同期中でなくても synced 後も stages は残る」と
   明記しており、`internals.syncStages` はブートノードのように既に synced な
   EL ノードにも入っている前提。よって「全 EL ノードの blockHeight 最大値」は
   `internals.syncStages` を持つ node の `blockHeight` の最大値と実質的に一致する。

`entities/syncProgress.ts` に `computeMaxSyncTargetHeight(nodes: Iterable<NodeEntity>): number`
として実装する（該当ノードが1件も無ければ 0。目標高0の扱いは §7.6.5 どおり
「バーを出さずcheckpointの数値のみ」に倒す）。

#### 「現在のステージ」の導出（カード面用）

§7.6.5「配列順で最初の『checkpoint < 目標高』のステージ」をそのまま実装する。
目標高が0（全EL不明、実運用ではまず起こらない）の場合の扱いは仕様に明記が
無いため、フォールバックとして配列の先頺（index 0）を「現在のステージ」と
みなす（バーは出さずステージ名+checkpointのみ表示になるため、実害が少ない
縮退動作）。`entities/syncProgress.ts` の `findCurrentSyncStage(stages,
targetHeight)` として実装し、この判断の理由をコード上のコメントに明記する。

#### `maxElBlockHeight` の算出タイミングとステート安定化への影響（要注意点）

`drivesNodeContainerName` 等は一度解決されると実質的に値が変わらない
（コンテナ名は不変）ため、`isSameInfraNode`（entity参照+position のみの比較）
で他ノードの変化を見逃しても実害が薄い。しかし `maxElBlockHeight` は
**チェーン進行のたびに変わり続ける**値であり、`entitiesToFlowNodes` の中で
計算して `InfraNodeData` に載せる方式のままだと、当のノード自身の entity
参照が変わらない限り（例: バックフィル中でまだ blockHeight が動いていない
フォロワーの reth カード）、`stabilizeNodes`（`isSameInfraNode` が true を
返す）が前回の `data`（古い `maxElBlockHeight` を含む）をそのまま使い回して
しまい、プログレスバーの分母が固まったまま更新されなくなる。

対応として `isSameInfraNode` の比較条件に `maxElBlockHeight` の一致を追加する
（既存の `drivesNodeContainerName`/`rpcTargetContainerName` は据え置き。値が
実質不変なため今回のスコープでは触らない。将来これらも変わり得る運用になった
場合は同様の対応が必要になる点をコード内コメントに残す）。

#### コンポーネント構成（新規ファイル）

1ファイルの肥大化を避けるため、ポップオーバー本体・カード本体には
「行/セクションを差し込むだけ」に留め、中身は専用コンポーネントへ分離する。

- `chain-profiles/ethereum/syncStageLabels.ts`: §7.6.7 のステージ表示名
  マッピング（完全一致。`nodeInternals.ts` は Engine API 用に前方一致なので
  混在させず別ファイルにする）。`describeSyncStage(stage: string): Localized
  | undefined`。
- `entities/syncProgress.ts`: `computeMaxSyncTargetHeight` /
  `findCurrentSyncStage` の純粋関数2つ。
- `entities/SyncProgressBar.tsx`: `{ value, max }` を受けて幅%のバー1本を
  描く小さな表示専用コンポーネント（ポップオーバーの全件・カードの1行の
  両方から再利用する）。
- `entities/InfraPopoverSyncStages.tsx`: 「同期ステージ」セクション
  （見出し + `syncStages` 全件のミニバー列）。`InfraPopover.tsx` からは
  `internals.syncStages` がある場合のみレンダーする形で呼び出す。
- `entities/InfraNodeCardSyncProgress.tsx`: カード面のバックフィル進行1行
  （`syncStatus === "syncing"` かつ `syncStages` がある場合のみ
  `InfraNodeCard.tsx` から呼び出す）。
- txpool行はフィールド1行のみで既存の `Field`/`infra-field` 流儀で足りるため
  専用コンポーネントを作らず `InfraPopover.tsx` に直接書く。

#### データフロー

1. `entities/infraNode.ts`: `entitiesToFlowNodes` 内で全 node エンティティから
   `computeMaxSyncTargetHeight` を1回だけ計算し、`InfraNodeData.maxElBlockHeight`
   として全カードに載せる（`drivesNodeContainerName` と同じ「全エンティティを
   見て解決する」既存の枠組みを流用）。
2. `isSameInfraNode` に `maxElBlockHeight` の比較を追加（上記の要注意点参照）。
3. `InfraNodeCard.tsx`: `data.maxElBlockHeight` を受け取り、
   `entity.kind === "node" && entity.syncStatus === "syncing" &&
   entity.internals?.syncStages` の条件で `InfraNodeCardSyncProgress` を描画。
4. `InfraPopover.tsx`: `maxElBlockHeight` を新しい prop として受け取り（既存の
   `rpcTargetContainerName`/`drivesNodeContainerName` と同列）、
   `entity.internals?.syncStages` があれば `InfraPopoverSyncStages` を、
   `entity.internals?.mempool` があれば txpool 行を描画。
5. `InfraNodeCard.tsx` → `InfraPopover` へ `maxElBlockHeight` をそのまま中継
   （`rpcTargetContainerName`/`drivesNodeContainerName` と同じ中継パターン）。

#### i18n key の追加

ARCHITECTURE.md §7.6.8 の初稿どおり以下を `messages.ts` に追加する
（`field.drivesNode` は Issue #188 で追加済み）:
`field.syncStages` / `field.txpool` / `txpool.value` / `sync.progress` /
`sync.progressNoTarget`。

#### glossary 参照

`glossary/ethereum/terms/d-internal.yaml` の `staged-sync`/`txpool` は
Issue #190 で追加済み。今回は `GlossaryTerm` からの参照配線のみを行う
（ポップオーバーの「同期ステージ」見出し・カード面の同期進行行に
`staged-sync`、ポップオーバーの「txpool」行に `txpool`）。

#### mockData への追加

`packages/frontend/src/websocket/mockData.ts` の `rethNode()`・
`newFollowerNodePair()` に `internals`（`syncStages` 全件 + `mempool`）を
追加する:

- `rethNode()`（bootnode/peer、synced想定）: 全ステージの checkpoint を
  渡された `blockHeight` に揃え（synced後もステージ一覧は残るという§7.6.5の
  記述どおり）、`mempool` にも小さめの固定値を入れる。
- `newFollowerNodePair()` の reth（syncing、blockHeight 0 スタート）:
  ステージの一部（先頭側）だけ進み、残りが0のサンプルにする
  （バックフィル進行中の見た目をオフラインで確認できるようにする）。
  Headers/Bodies が完了、SenderRecovery 以降が0、という構成にすると
  「現在のステージ」がSenderRecoveryになり、カード面の1行表示を確認できる。

#### CSS

新規: `.infra-popover__sync-stages`・`.infra-popover__sync-stage-list`・
`.infra-popover__sync-stage-row`・`.infra-popover__sync-stage-line`・
`.sync-progress-bar`・`.sync-progress-bar__fill`・`.infra-card__sync-progress`・
`.infra-card__sync-progress-text`。既存の `.infra-field`/`.infra-popover` の
配色・フォントサイズに合わせる（新しい色トークンは増やさない。バーの色は
`--syncing`(琥珀)を流用し、カード面の同期中ドット・既存の「同期中」表現との
一貫性を保つ）。

---

### 実装記録

設計メモどおりに実装した。追加・変更したファイルは以下:

- 新規:
  - `chain-profiles/ethereum/syncStageLabels.ts`（+test）: ARCHITECTURE.md
    §7.6.7 のステージ表示名マッピング（完全一致）。
  - `entities/syncProgress.ts`（+test）: `computeMaxSyncTargetHeight`
    （全ELノードのblockHeight最大値）・`findCurrentSyncStage`（カード面の
    「現在のステージ」導出）の純粋関数2つ。
  - `entities/SyncProgressBar.tsx`（+test）: ミニプログレスバーの表示専用
    コンポーネント。ポップオーバー全件表示・カード1行表示の両方から再利用。
  - `entities/InfraPopoverSyncStages.tsx`（+test）: ポップオーバーの
    「同期ステージ」セクション（全件 + ミニバー）。
  - `entities/InfraNodeCardSyncProgress.tsx`（+test）: カード面の
    バックフィル進行1行。
- 変更:
  - `entities/infraNode.ts`: `InfraNodeData.maxElBlockHeight` を追加し、
    `entitiesToFlowNodes` で `computeMaxSyncTargetHeight` により1回だけ
    算出して全カードに載せる。`isSameInfraNode` の比較条件に
    `maxElBlockHeight` の一致を追加（後述の注意点参照）。
  - `entities/InfraNodeCard.tsx`: `syncStatus === "syncing"` かつ
    `internals.syncStages` があるノードにのみ `InfraNodeCardSyncProgress`
    を描画。`InfraPopover` へ `maxElBlockHeight` を中継。
  - `entities/InfraPopover.tsx`: `internals.syncStages` があれば
    `InfraPopoverSyncStages`、`internals.mempool` があれば txpool 行
    （ラベル `GlossaryTerm(txpool)`・値 `pending {n} · queued {m}`）を追加。
  - `i18n/messages.ts`: ARCHITECTURE.md §7.6.8 の
    `field.syncStages`/`field.txpool`/`txpool.value`/`sync.progress`/
    `sync.progressNoTarget` を追加。
  - `styles.css`: `.sync-progress-bar`系・`.infra-popover__sync-stages`系・
    `.infra-card__sync-progress`系を追加。新しい色トークンは増やさず、
    バーの色は既存の `--syncing`（琥珀）を流用した。
  - `websocket/mockData.ts`: `rethNode()` に全ステージ完了済みの
    `internals`（+ mempool固定値）を追加。`newFollowerNodePair()` の reth に
    Headers/Bodies のみ進んだ `internals`（バックフィル途中のサンプル）を
    追加。

#### 分母（全ELノードのblockHeight最大値）の実装

設計メモどおり、`internals.syncStages !== undefined` を「EL ノード」の
判定に使った（`clientType` の文字列比較には頼らない）。

#### `maxElBlockHeight` のステート安定化バグを実際に再現して確認した

設計メモで懸念していた「`isSameInfraNode` が entity 参照のみで比較すると
プログレスバーの分母が固まる」という問題を、実際に発生させてから直した
（CLAUDE.md「直したはずで済ませず実際に再現して確認する」に従う）。

手順:
1. `@testing-library/react` で実際に `<App isMock />` をレンダーし、
   addNode でフォロワー reth（`chainviz-reth-follower-1`、syncing・
   blockHeight 0、内訳は Headers=128/Bodies=64/以降0で登録）を追加。
2. モックの周期tick（3秒間隔。`intervalMs` 既定値のまま、実タイマーで待機）
   で `reth-node-1` の blockHeight が 128→129 と進む。
3. `isSameInfraNode` に `maxElBlockHeight`比較を**含めない**状態で実行す
   ると、フォロワーカードの表示は3.3秒待っても
   `同期中: ボディ取得 64/128` のまま固まった（バグを実際に再現した）。
4. `isSameInfraNode` に比較を**追加した**状態（実装どおり）で同じ手順を
   再実行すると、`同期中: ヘッダ取得 128/129` に正しく更新された
   （目標高が129になったことで Headers(128) が「128 < 129」で
   in-progress 扱いになり、現在のステージも正しく繰り上がった）。
5. 確認用の一時テストファイル（`src/app/verify189*.manual.test.tsx`）は
   確認後に削除済みで、ブランチへの残置は無い。

この結果から、`isSameInfraNode` への `maxElBlockHeight` 比較追加は
「観測できる問題を実際に直した」ことを手元で確認済み。

#### mockDataでの目視確認内容

上記と同じ手順で以下も確認した:
- `reth-node-1`（synced・bootnode）のポップオーバーに「同期ステージ」
  セクションが全11ステージ分表示され、各行のミニバーが100%（全て
  blockHeight=128で揃えたサンプルのため）になっている。
- `reth-node-1` の txpool 行が `pending 1 · queued 0` と表示される。
- addNode 直後のフォロワーカード（`chainviz-reth-follower-1`）に
  カード面の1行「同期中: ボディ取得 64/128」+ 50%のバーが常設表示される。
- フォロワーのポップオーバーにも同じ11ステージ全件（進捗にばらつきの
  あるサンプル）とtxpool行（`pending 0 · queued 0`）が表示される。

#### 決定事項・注意点（次の担当への申し送り）

- `field.syncStages`（「同期ステージ」）のGlossaryTermは、ポップオーバーの
  見出し・カード面の行テキスト全体の両方に付けている。ARCHITECTURE.md
  §7.6.5の「ラベルにGlossaryTerm」という記述に対し、カード面には短い
  ラベル語が別途定義されていなかったため、行のテキスト全体をアンカーに
  した（「そのまま用語解説の入口になる」という趣旨には沿っている判断。
  構成・意味を変える変更ではなく実装上の解釈）。
- `computeMaxSyncTargetHeight`の「EL ノード判定」は`internals.syncStages`の
  有無に基づく。将来 CL ノード側にも何らかの`syncStages`相当の情報が乗る
  ような仕様変更がある場合はこの判定を見直す必要がある。
- `isSameInfraNode`の比較に`maxElBlockHeight`を追加したが、
  `rpcTargetContainerName`/`drivesNodeContainerName`は据え置いた（値が
  実質不変なため）。これらも将来変わり得る運用になった場合は同様の対応が
  必要になる旨をコード内コメントに明記済み。
- `pnpm --filter @chainviz/frontend build`（成功）・
  `pnpm --filter @chainviz/frontend test`（88 test files / 1326 tests、
  全通過）・`pnpm lint`（エラーなし）を確認済み。
- `docs/PLAN.md`ステップ9はこのIssueの完了により frontend/collector/
  node-env/UX の全項目が完了した。残るのは e2e（Issue #191、ステップ9の
  範囲だが別Issue・別担当）のみ。

---

### テスト強化（エッジケース・異常系・境界値）

実装担当が書いた基本テストに対し、以下の観点でテストを追加した（新機能の
実装は行わず、テストの追加・強化のみ）。追加後 `pnpm --filter
@chainviz/frontend test` は 88 test files / 1350 tests（+24）全通過、
`pnpm --filter @chainviz/frontend build`・`pnpm -r build`・`pnpm lint`
いずれも成功。

- `entities/syncProgress.test.ts`:
  - `computeMaxSyncTargetHeight`: `internals` はあるが `syncStages` が省略
    （mempool のみ）のノードを分母対象から除外すること／全ノードの
    blockHeight が同値の場合／全ノードが blockHeight 0（バックフィル開始
    直後）で0を返す場合。
  - `findCurrentSyncStage`: 全ステージが同一 checkpoint かつ目標高未満なら
    先頭を返す／全ステージが同一 checkpoint かつ目標高と一致なら末尾を返す
    ／後段ステージが目標高を追い越していても配列順で最初に「checkpoint <
    目標高」を満たすステージを返す。
- `entities/infraNode.test.ts`:
  - `entitiesToFlowNodes`: `maxElBlockHeight` を全カードの data に載せること
    ／syncStages ノードが無ければ0になること／高 blockHeight の非 syncStages
    ノード（CL 相当）を分母から除外すること。
  - `isSameInfraNode`: **Issue #189 のバグ再発防止の回帰テスト**。entity 参照・
    position が同一でも `maxElBlockHeight` だけが変われば false を返すこと
    （比較行を外して修正前へ戻すと実際に false→true に転んで失敗することを
    確認済み）／同値なら true を返すこと／目標高0→実値の確定遷移も検出する
    こと。
- `entities/InfraPopover.test.tsx`（新機能について本ファイルでは未カバー
  だった txpool 行・同期ステージセクションを追加）:
  - txpool 行: mempool 有りで pending/queued を表示／pending=queued=0 でも
    行を出す（空プールは「未観測」ではなく「空という情報」）／mempool 省略
    時・internals 省略時は行を出さない／workbench には出さない。
  - 同期ステージセクション: syncStages 有りで表示／空配列なら見出しごと
    非表示（`.length > 0` ガード）／undefined でも非表示／`maxElBlockHeight`
    prop 省略時は目標高0でバー非表示／prop 指定時はステージ数分のバーを描画。
- `entities/SyncProgressBar.test.tsx`: value===max の 100% 境界／value=0 かつ
  max 正で 0% の境界。

実装のバグは新たに発見しなかった（既存の `isSameInfraNode` の
`maxElBlockHeight` 比較修正が Issue #119 の安定化ロジックを壊していない
ことも、既存テスト全通過と回帰テストの追加で確認した）。

---

### レビュー（chainviz-reviewer）

結果: **合格**（差し戻しなし。軽微な指摘1件は下記参照）。

確認した内容:

1. **UX設計（ARCHITECTURE.md §7.6.5〜§7.6.7・§7.6.9）との整合**: 一致を確認。
   - ポップオーバー: `internals.syncStages` がある場合のみ「同期ステージ」
     セクションを配列順で全件表示し、各行にミニバー。未知ステージ名は生名の
     まま表示（`describeSyncStage` が undefined を返すフォールバック、
     テストあり）。目標高0のときはバーを出さず checkpoint のみ。
   - カード面: `syncStatus === "syncing"` かつ `syncStages` がある node にのみ
     1行常設（§7.6.10 決定3「カード常設はバックフィル進行の1行のみ」どおり。
     txpool はカード面に出していない）。synced で行ごと消える条件も呼び出し側
     の分岐で成立。
   - txpool 行: `internals.mempool` がある場合のみ「pending {n} · queued {m}」
     （§7.6.6 どおり）。0/0 でも行を出す（空＝情報、省略＝未観測の区別。
     テストで明文化されている）。
   - i18n キーは §7.6.8 初稿の5件（field.syncStages/field.txpool/txpool.value/
     sync.progress/sync.progressNoTarget）と一致。
   - ステージ表示名マッピングは collector 側 `reth-metrics.ts` の
     `KNOWN_STAGE_ORDER`（実機 /metrics で確定済みの生ステージ名）と全11件
     一致しており、§7.6.7 の「実環境の生ステージ名へ合わせて確定する」を
     満たしている。
2. **`isSameInfraNode` への `maxElBlockHeight` 比較追加**: 妥当と判断。
   `maxElBlockHeight` はスナップショット単位の値で、当該ノードの entity 参照が
   変わらなくても他ノードのチェーン進行で変わり続けるため、entity 参照比較
   だけでは古い分母を使い回す。回帰テスト（entity 参照・position 同一で
   `maxElBlockHeight` のみ変化→false）は、比較行を外すと entity===entity・
   position 一致で true になり必ず失敗する構造であり、静的にも実効性を確認
   できた（testerの「戻すと失敗する」報告と整合）。Issue #119 の安定化目的に
   ついては、値が実際に変わったときだけ false になる（同値なら true のテスト
   あり）ため骨抜きにはなっていない。なお全カード（workbench 含む）が
   ブロック進行ごとに再レンダーされるようになるが、カード数は高々十数枚・
   数秒間隔であり実害はない（設計メモで意識済みのトレードオフ）。
3. **`computeMaxSyncTargetHeight` / `findCurrentSyncStage`**: 正確。前者は
   `internals.syncStages` の有無で EL を判定（chain 固有文字列を entities/ に
   持ち込まない設計判断が docstring に明記）。後者は §7.6.5「配列順で最初の
   checkpoint < 目標高」をそのまま実装し、仕様未定義の縮退（目標高0→先頭、
   全ステージ追いつき→末尾）はコメント付きで妥当なフォールバック。
4. **既存パターンとの一貫性**: `Field`/`infra-field` の「optional フィールドが
   あるときだけ行を足す」流儀、`rpcTargetContainerName` 等と同じ prop 中継、
   `nodeInternals.ts` と同型のチェーンプロファイル表現セット、既存の
   `--syncing` トークン流用、いずれも既存実装の流儀に沿っている。
   1ファイル1責務の分割（バー/セクション/行を別コンポーネント化）も適切。
5. **glossary 参照**: `staged-sync`（ポップオーバー見出し + カード面の行
   テキスト）・`txpool`（ポップオーバー行ラベル）とも GlossaryTerm で配線
   されており、`glossary/ethereum/terms/d-internal.yaml` に両キーの実体が
   存在することを確認。アンカーの有無はテストでも検証されている。
6. **ステップ9の完了状況**: `docs/PLAN.md` のステップ9は #183〜#190 の
   UX/node-env/collector/frontend 全項目がチェック済みとなり、残るのは
   e2e（#191）のみであることを確認。チェックボックスへの #189 リンク併記も
   規約どおり。
7. **品質ゲート**: `pnpm lint`（エラーなし）・`pnpm build`（shared/collector/
   frontend/e2e 全て成功）・`pnpm test`（shared 58 / collector 1084 /
   frontend 1350 / e2e 34、全通過）をワークツリーで実行し確認。エラー握り
   つぶし箇所なし（新規コードは純粋な表示ロジックで catch 自体が無い）。
   環境状態依存の決め打ち定数なし（mockData の 128/64 等はモックのサンプル
   値であり対象外）。

軽微な指摘（差し戻し不要、コミット時に対応推奨）:

- ARCHITECTURE.md §7.6.7 の表では TransactionLookup の ja が「tx 索引作成」
  （半角スペースあり）だが、実装（`syncStageLabels.ts`）は「tx索引作成」
  （スペースなし）。表は「実装時に確定する初稿」と明記されているため、
  確定値（実装側）に合わせて docs 側の1文字を更新しておくとよい。

補足（統括への申し送り）:

- レビュー時点で変更は全て未コミット（`git log main..HEAD` は空）。コミット
  時は1変更1コミットの規約に従い、少なくとも「実装」「テスト強化」「docs
  （PLAN/worklog）」程度の関心事で分割すること。

---

### QA検証記録（chainviz-qa 実機検証）

判定: **合格**。実ブラウザ（Playwright + Chromium）で
`pnpm --filter @chainviz/frontend build:web` → `preview`（モッククライアント、
ポート4290）を起動し、Issue #189 の完了条件4点を実際の画面で確認した。

#### 実機環境の準備

このリポジトリの Playwright Chromium（chromium-1228、Playwright 1.61.1 が
要求する版）は共有ライブラリ不足で起動できないため、Issue #165〜188 QA と
同じ手法で `apt-get download` により該当 deb（libnspr4 / libnss3 /
libasound2t64 / libasound2-data）を取得・ローカル展開し、`LD_LIBRARY_PATH`
に通して起動した。

#### 確認できた項目（完了条件との対応）

1. **EL ノードのポップオーバーに同期ステージ全件 + ミニバー**: 合格。
   `chainviz-reth-1`（synced、blockHeight 128）のカードにホバーすると
   「同期ステージ」セクションが表示され、11 ステージ（ヘッダ取得 / ボディ
   取得 / 送信者復元 / 実行 / アカウントのハッシュ化 / ストレージの
   ハッシュ化 / 状態ルート検証 / tx索引作成 / アカウント履歴の索引 /
   ストレージ履歴の索引 / 仕上げ）が配列順に、各行「表示名 + checkpoint
   128 + 琥珀色のミニバー」で並ぶことを DOM・スクリーンショット双方で確認。
   全ステージが目標高（=全EL blockHeight最大値 128）に達しているため
   ミニバーの塗り幅は全件 100%（`.sync-progress-bar__fill` の width が
   11 件とも "100%"）。§7.6.7 の表示名マッピングどおり日本語表示名が
   出ている。

2. **バックフィル中（syncing）の EL カードに進行 1 行 + バーが常設、synced
   では消える**: 合格。「ノードを追加」ボタンを押すと
   `chainviz-reth-follower-1`（syncing・琥珀ドット）が現れ、カード面に
   「同期中: ヘッダ取得 128/129」の 1 行と琥珀のプログレスバー
   （塗り幅 99.2%）が常設表示された。目標高がチェーン進行で 128→129 に
   増えたことを受けて「現在のステージ」が正しく繰り上がって Headers に
   なっており、`isSameInfraNode` への `maxElBlockHeight` 比較追加による
   動的な分母更新が実画面でも働いていることを確認した。synced の
   `chainviz-reth-1` カードには `.infra-card__sync-progress` が存在しない
   （count 0）ことも確認し、synced 時に行ごと消える仕様どおり。フォロワーの
   ポップオーバーにも 11 ステージ全件が進捗のばらつき（Headers 128 /
   Bodies 64 / 以降 0、バー幅 99.2% / 49.6% / 0%…）付きで表示された。

3. **ポップオーバーに txpool 内訳（pending/queued）**: 合格。
   `chainviz-reth-1` のポップオーバーに「txpool」行が現れ値は
   「pending 1 · queued 0」、フォロワーは「pending 0 · queued 0」。
   `internals.mempool` があるノードにのみ行が出て、0/0 でも行を出す
   （空＝情報）挙動を確認した。

4. **glossary 用語（staged-sync, txpool）が UI から参照できる**: 合格。
   ポップオーバー内の「同期ステージ」ラベル（GlossaryTerm）にホバーすると
   「ステージ型同期」の解説（定義→なぜ必要か→chainviz ではどう見えるか の
   3 拍子 + relatedTerm el-client）が表示された。「txpool」ラベルにホバー
   すると「txpool」の解説（mempool のノード内実体、pending/queued の説明、
   relatedTerms: mempool / transaction / nonce）が表示された。

#### 品質ゲート

`pnpm lint && pnpm build && pnpm test` を独立に実行し全て成功
（exit 0）。テスト内訳: shared 58 / collector 1084 / frontend 1350 /
e2e 34、いずれも全通過。collector ログ中の「failed to decode …」は
異常系テストの期待出力であり失敗ではない。

以上より Issue #189 の完了条件を全て満たしていると判断し合格とした。
`docs/PLAN.md` ステップ9の #189 チェックボックス済み。
