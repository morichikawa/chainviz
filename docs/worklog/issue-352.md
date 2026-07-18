# Issue #352 ノード間通信ログにRPC呼び出しのレスポンス(成否・所要時間)を追加する

### 2026-07-17 Issue #352 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-351-352-backlog
- 内容: Issue #317（ノード間通信ログタブ）のUX設計時に第1弾スコープから
  分割された論点のIssue起票と、`docs/PLAN.md` バックログへの追記
  （docsのみの変更、Issue #351と同一コミット）のレビュー。
  - Issue #352本文と`docs/PLAN.md`追記の照合: 分割の経緯（Issue #317
    第1弾の設計時にchainviz-uxが分割）・分割理由（OperationEdgeへの
    shared型変更とロギングプロキシからのレスポンス観測というcollector
    変更を伴い、フロントのみで完結する第1弾と単位が異なる）・依存関係
    （Issue #317マージ後に着手）・着手時はchainviz-designerの設計を
    先行させる方針のいずれも一致し、過不足なし
  - Issue本文が参照する事実の実在確認: 設計メモ
    `docs/worklog/issue-317.md` は未マージのブランチ
    `issue-317-comms-log-panel` 上に実在し、その §8「第2弾（本Issueに
    含めるか統括の判断待ち): レスポンスの観測」に実現案の下書き
    （collector: `handleRpcRequest` でのレスポンス観測、shared:
    `OperationEdge` へのoptionalフィールド追加、frontend: 成否アイコンと
    所要時間の表示）が実在する。追記の記述はこの §8 の内容と整合
  - `docs/PLAN.md` の追記フォーマットは直前の #351 項目・#346 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - `docs/worklog/issue-317.md` はレビュー時点でmain未マージ
    （ブランチ `issue-317-comms-log-panel` 上）。Issue #352 に着手する
    頃には #317 がマージ済みのはず（依存関係どおり）なので参照は成立する
  - 実装着手は後日。shared型変更を伴うため、着手時はまず
    chainviz-designerに設計を依頼する

### 2026-07-18 Issue #352 設計(designer)

- 担当: designer
- ブランチ: issue-352-comms-log-rpc-response
- 内容: 実装着手前の設計。Issue #317(通信ログ第1弾)の設計メモ §8 の実現案
  下書きを、マージ済みの第1弾実装(ロギングプロキシ・`OperationEdge`・
  通信ログパネル)と突き合わせて具体化した。`packages/shared` の型変更
  (`OperationEdge` への optional フィールド追加)はこの設計フェーズで実装
  済み。collector/frontend の実装ロジックは書いていない。

## 1. 何を作るか(全体像)

ロギングプロキシ(`packages/collector/src/proxy/logging-proxy.ts`)は透過
転送のため転送先のレスポンスを既に手にしているが、観測対象にしていない
(`RpcObservation` はリクエストのみ)。これを拡張し、呼び出しの成否と
所要時間を観測して `OperationEdge` に載せ、通信ログパネルの操作(RPC)
エントリに表示する。

データフロー(変更点を[*]で示す):

```
ワークベンチ → LoggingProxy.handleRpcRequest
  → extractObservations(リクエスト観測。従来どおり)
  → forward(透過転送)                       [*] 前後で所要時間を計測
  → レスポンスのコピーを解析し成否を判定      [*] 新規(純関数を新設)
  → onObserve(観測 + outcome/durationMs)     [*] 発行タイミングを転送後へ移動
→ operation-observer: RpcObservation → OperationEdge   [*] 2フィールド追記
→ broadcastDiff([operationObserved])(従来どおり)
→ frontend deriveCommsLogEntries → CommsLogOperationEntry  [*] 2フィールド追記
→ CommsLogEntryRow / commsLogText で成否アイコン + 所要時間を表示  [*]
```

## 2. `packages/shared` の型変更(実装済み)

`packages/shared/src/world-state/entities.ts` の `OperationEdge` に
optional フィールドを2つ追加した(テストも `entities.test.ts` に追加済み。
`pnpm lint && pnpm build && pnpm test` 全パッケージ通過を確認済み):

```ts
outcome?: "ok" | "error";
durationMs?: number;
```

- **optional にした理由**: 旧イベント・モック・判定不能ケースとの互換。
  `operationObserved` は揮発性(スナップショット非含有)なので永続データの
  マイグレーションは無いが、フロントは両フィールド欠落を常に許容する
- **語彙の境界**: `"ok" | "error"` はプロトコル非依存の語彙。「JSON-RPC の
  `error` フィールドで判定する」という規則は collector のプロキシ側に
  閉じ、shared 型・フロントには漏らさない(`operation` フィールドと同じ
  境界の考え方)
- 名前は #317 設計メモ §8 の下書き(`outcome` / `durationMs`)を踏襲。
  `durationMs` は `InternalCallStats.latencyMs` と異なる名前だが、意味も
  異なる(こちらは1呼び出しの実測、あちらはメトリクス由来の代表値)ため
  揃えない

## 3. 仕様上の判断(決定事項)

実装担当はこれらを決定済みの前提としてよい。

### 3.1 イベントは従来どおり「1呼び出し = 1 `operationObserved`」。発行はレスポンス受領後へ移す

- 現状 `handleRpcRequest` は転送**前**に `onObserve` を呼ぶ。これを転送
  完了**後**(成否・所要時間が確定した後)に移す
- リクエスト時・レスポンス時の2イベント案は不採用。相関 id がプロトコルに
  必要になり、フロントのログエントリを後から書き換える構造(エントリの
  不変性が崩れる)になるため
- 帰結: パルス・ログエントリの出現が RPC の所要時間ぶん遅れる(ローカル
  環境で通常数ms〜数十ms。転送失敗時は forwarder のタイムアウト 10 秒まで
  遅れうる)。学習用途の可視化として許容し、`observedAt` は従来どおり
  「リクエスト受領時刻」のままとする(ログの時系列上の位置は変えない)
- 帰結: operation-observer のワークベンチ/ノード解決もレスポンス後に
  行われる。呼び出し中に端点が削除された場合はエッジが落ちてログに残る
  (現状の解決失敗パスと同じ扱いで許容)

### 3.2 所要時間の計測起点・終点

- 起点 = リクエストボディの受領完了時点(既存の `timestamp` 取得と同じ
  タイミング。`now()` 注入時計を使う)
- 終点 = 転送先レスポンスボディの受領完了時点(`forward` の resolve /
  reject 時)
- バッチリクエスト(JSON-RPC 配列)は 1 回の HTTP 往復なので、バッチ内の
  全観測が**同じ `durationMs` を共有**する(1要素ごとの内訳は観測不能。
  正直にこの意味で統一し、コメントにも明記する)
- 値は 0 以上の整数(ms)に丸める

### 3.3 成否の判定規則(collector のプロキシ内に閉じる)

1. `forward` が throw(ネットワーク失敗・タイムアウト) → 全観測 `error`
   (このとき `durationMs` は失敗までの実測値を入れる)
2. HTTP ステータスが 2xx 以外 → 全観測 `error`
3. 2xx: レスポンスボディのコピーを JSON パースして判定
   - 単発リクエスト → 応答オブジェクトに `error` プロパティが**存在**
     すれば `error`、無ければ `ok`
   - バッチ → 応答配列の要素を `id` で突き合わせ、要素ごとに判定。
     対応する要素が見つからない観測(`id` が null の通知・応答欠落・
     `id` 重複で一意に決まらない場合)は `outcome` を**省略**する
   - ボディが JSON として解釈できない場合も `outcome` を省略する
     (`durationMs` は入れる)
- **判定不能をエラーに倒さない**(省略 = 判定不能、を3値目として使う)。
  観測の失敗と呼び出しの失敗を混同させないため
- エラーの詳細(JSON-RPC の error code / message)は本 Issue では**載せない**。
  Issue 原文の要求は成否・所要時間のみで、詳細表示は必要になったら別 Issue
  (揮発イベントに任意長の文字列を載せる是非も含めて再検討する)
- 透過性は崩さない: 判定は応答ボディの**コピー**をパースするだけで、
  ワークベンチへ返すバイト列は従来どおり素通し

### 3.4 フロントの表示(第1弾の6カテゴリとの統合方法)

- 新カテゴリは作らない。既存の操作(RPC)エントリ
  (`CommsLogOperationEntry`)に optional フィールドを足すだけ
- 2行目(メソッド名の行)に、成否アイコンと所要時間を添える。例:
  `eth_sendRawTransaction · ✓ 12ms` / `eth_call · ✕ 8ms`
- 色は新設しない: 成功 = 既存の成功系(`--synced` 等)、失敗 = tx 失敗と
  同じ赤系。具体的な CSS 変数・アイコン文字は実装時に styles.css の既存
  定義から引く
- 所要時間の表記は内部APIエントリの `commsLog.internal.latency`(`· 12ms`)
  と揃える
- `outcome` / `durationMs` が無い場合は従来どおりメソッド名のみ表示
  (それぞれ独立に欠落しうる。§3.3 の判定不能ケース)
- **キャンバスの操作パルス側には表示を追加しない**。900ms で消える揮発
  表現へのホバーは実用的に不可能なことが第1弾の評価(#317 §1)で確認
  済みで、レスポンスを読み取る場所は通信ログに一本化する
  (`entities/operationEdge.ts` は変更しない)

## 4. 作業分担と依存順序

shared の型変更は本設計で完了済み。**collector と frontend は互いに依存せず
並行着手できる**(フィールドは optional で、frontend はモックで検証できる)。

### 4.1 collector(収集 悟)

- `proxy/logging-proxy.ts`:
  - `RpcObservation` に `outcome?: "ok" | "error"` / `durationMs?: number`
    を追加(collector 内部型。shared とは別)
  - `handleRpcRequest`: `onObserve` の発行を転送完了後へ移す。転送前後で
    `now()` により所要時間を計測。転送失敗(catch)パスでも `error` +
    実測 `durationMs` で発行する。リクエスト時の既存ログ出力
    (`[proxy] rpc call from ...`)は従来どおり転送前のままでよい
  - 成否判定は §3.3 の規則で、**専用の純関数を新ファイルに切り出す**
    (例: `proxy/response-outcome.ts` の
    `resolveOutcomes(observations, response)` 相当。
    1ファイル1責務・テスト容易性のため。関数シグネチャの細部は実装判断)
- `proxy/operation-observer.ts`: `resolveOperationEdge` で
  `observation.outcome → edge.outcome`、`durationMs → edge.durationMs` を
  写す(undefined はフィールドごと省略)
- ユニットテスト: 判定純関数(単発 ok/error・バッチの id 突き合わせ・
  対応欠落・非JSON・非2xx)、`handleRpcRequest` の発行タイミングと計測
  (`now` 注入で決定的に)、転送失敗パス、observer のフィールド伝搬

### 4.2 frontend(描画 麗)

- `comms-log/commsLogEntry.ts`: `CommsLogOperationEntry` に
  `outcome?: "ok" | "error"` / `durationMs?: number` を追加
- `comms-log/deriveCommsLogEntries.ts`: `operationObserved` ケースで
  2フィールドを写す
- `comms-log/commsLogText.ts` + `i18n/messages.ts`: §3.4 の表示文言
  (ja/en)。成否はアイコン+ラベルどちらにするかは実装判断(スクリーン
  リーダー向けに aria-label か視覚外テキストで成否を言語化すること)
- `side-panel/CommsLogEntryRow.tsx` + `styles.css`: 成否の色(既存変数の
  再利用。新色禁止)
- `websocket/mockData.ts`: `mockOperationObserved` に outcome/durationMs を
  入れる(大半 ok・時々 error、数ms〜数十ms 程度。オフラインで表示を
  確認できるように)。欠落ケースの表示はユニットテストで担保する
- E2E: `packages/e2e/SCENARIOS.md` の UI-LOG-02 に「操作エントリに所要
  時間(ms)と成功表示が含まれる」ことの確認を追記し、
  `src/ui/comms-log.spec.ts` を対応させる(実環境の送金 RPC は成功する
  前提でよい。失敗ケースの実環境 E2E は決定的に作りにくいためユニット
  テストで担保し、E2E には含めない)
- i18n の英語文言は実装後に chainviz-i18n のレビュー対象

### 4.3 テスト強化・レビュー時の注意

- 発行タイミング変更(§3.1)は既存のプロキシテストの前提(転送前に
  onObserve が呼ばれる)を壊す可能性がある。既存テストの修正は「仕様変更に
  伴う正当な修正」として扱ってよい
- forwarder のタイムアウト(10秒)まで onObserve が遅れるケースは、パルス
  表示の遅延として体感に影響しうる。QA では転送失敗時(ノード停止など)に
  ログへ `error` エントリが出ることまで確認できるとよい

## 5. 未決のまま実装担当へ委ねる点

- 成否判定純関数の正確なシグネチャ・ファイル名(§4.1)
- 成否表示の具体形(アイコン文字 ✓/✕ かラベルか、位置)と失敗時の行全体の
  強調有無(§3.4 の範囲内で)
- モックの outcome/durationMs の生成パターン(乱数か周期か)
- 1000ms 超の所要時間の表記(`1200ms` のままか `1.2s` に切り替えるか。
  内部APIの latency 表記との一貫性を優先して決めること)

### 2026-07-18 Issue #352 実装(frontend)設計メモ

- 担当: frontend
- ブランチ: issue-352-comms-log-rpc-response-frontend（cherry-pick合流用の
  一時ブランチ。設計ブランチ `issue-352-comms-log-rpc-response` から分岐）
- 内容: §4.2 の作業分担に従い着手する前の実装方針メモ。設計メモ §5「未決の
  まま実装担当へ委ねる点」への回答を中心に記録する。

#### 表示テキストの構造化方針

`describeCommsLogEntry`（`commsLogText.ts`）が返す `CommsLogEntryText` に
`body`（従来どおりメソッド名のみ）とは別に、任意の `operationSuffix`
フィールドを追加する方針にした。理由:

- 成否アイコン部分だけに色（`tone`）とスクリーンリーダー向けの言語化
  （`ariaLabel`）を付けたい。`body` を1本の文字列にまとめてしまうと、
  `CommsLogEntryRow` 側でアイコン部分だけを抜き出して別要素に包むのが
  困難になる（文字列パースに頼ることになり脆い）
- `outcome`/`durationMs` は独立に欠落しうる（設計メモ §3.3）ため、
  `operationSuffix` は次の4パターンを組み立てる純関数
  （`describeOperationSuffix`）に切り出した:
  - 両方無し → `undefined`（`body` はメソッド名のみ、従来と完全互換）
  - `durationMs` のみ → `commsLog.internal.latency` と同じ表記
    （" · 12ms"）を新設の `commsLog.operation.duration` キーで再現。
    色分け・aria-label は付けない（可視テキストの数値がそのまま読み
    上げられるため不要）
  - `outcome` のみ → アイコン（✓/✕）を追加。`tone` + `ariaLabel`
    （"成功"/"失敗"）を付ける
  - 両方 → アイコン+所要時間をまとめて1つの色付き要素にし、`ariaLabel`
    にも両方の情報を含める（例: "成功（12ms）"）。aria-label を持つ要素の
    子テキストはスクリーンリーダーに読まれない一般的な挙動があるため、
    アイコンの後ろに所要時間を裸で置かず、まとめて言語化する必要がある

#### i18n キー

`commsLog.internal.latency` をそのまま流用せず、`commsLog.operation.*` に
専用キーを新設した（既存の各カテゴリが専用キーを持つ流儀に揃えるため。
文言の内容自体は latency と同一）。成否アイコン文字（✓/✕）自体は UI 文言
ではなく記号なので i18n に置かず `commsLogText.ts` にハードコードする
（"ms" 単位表記が既存キーで ja/en 共通なのと同じ扱い）。

#### 色

`.comms-log-entry__outcome--ok` は `var(--synced)`、`--error` は
`.comms-log-entry__chip--tx-failed` と同じ `#ffb4b4` を再利用する（新色を
作らない）。成否の色はアイコン+所要時間の suffix 部分のみに適用し、
メソッド名自体（`body`）は着色しない。

#### モック

`mockOperationObserved` は呼び出し順の通し番号（モジュールレベルの
`operationObservedSeq`）から `outcome`/`durationMs` を決定的に生成する
（`Math.random` ではなく、既存の `txSeq % 3 === 0` と同じ「周期的な決定値」
の流儀）。7回に1回 `error`、`durationMs` は3ms〜45msの範囲で周期変化させる。

#### E2E

実環境の送金RPCは成功する前提のため、UI-LOG-02 に「操作エントリに所要時間
(ms) と成功アイコン(`comms-log-entry-outcome` testid)が含まれる」ことの
確認を追加する。失敗ケースの決定的な実環境E2Eは作りにくいためユニット
テスト側で担保し、E2Eには含めない（設計メモ §4.2の指示どおり）。

### 2026-07-18 Issue #352 実装(frontend)完了

- 担当: frontend
- ブランチ: issue-352-comms-log-rpc-response-frontend（cherry-pick合流用の
  一時ブランチ。collector側の実装と並行に進めた）
- 内容: 上記の設計メモどおりに実装した。
  - `comms-log/commsLogEntry.ts`: `CommsLogOperationEntry` に
    `outcome?: "ok" | "error"` / `durationMs?: number` を追加
  - `comms-log/deriveCommsLogEntries.ts`: `operationObserved` ケースで
    `OperationEdge` の両フィールドをそのまま写す
  - `comms-log/commsLogText.ts`: `describeCommsLogEntry` の operation
    ケースに `operationSuffix`（設計メモの4パターン）を追加する純関数
    `describeOperationSuffix` を新設
  - `i18n/messages.ts`: `commsLog.operation.duration` /
    `outcomeOk[Duration]` / `outcomeError[Duration]` を追加
  - `side-panel/CommsLogEntryRow.tsx` / `styles.css`: `operationSuffix.tone`
    に応じて既存CSS変数（成功=`--synced`、失敗=tx失敗と同じ`#ffb4b4`）で
    色分けし、aria-label を付与
  - `websocket/mockData.ts`: `mockOperationObserved` が通し番号から
    outcome/durationMs を決定的に生成するように変更
  - `packages/e2e/SCENARIOS.md` の UI-LOG-02 と
    `packages/e2e/src/ui/comms-log.spec.ts` に、所要時間・成功表示の確認を
    追記
  - 各変更にユニットテストを追加（
    `deriveCommsLogEntries.operation.test.ts` に追加、
    `commsLogText.operationOutcome.test.ts` /
    `CommsLogEntryRow.operationOutcome.test.tsx` /
    `mockData.operationOutcome.test.ts` を新規作成。CLAUDE.mdのテスト分割
    方針に従い、既存の基本ケーステストとは別ファイルに分けた）
  - `entities/operationEdge.ts`（キャンバスの操作パルス）は設計判断どおり
    変更していない
- 決定事項・注意点:
  - `pnpm lint && pnpm build && pnpm test`（shared/collector/frontend/e2e
    全パッケージ）が通ることを確認済み
  - i18n の英語文言（`commsLog.operation.outcomeOk`/`outcomeError`/
    `outcomeOkDuration`/`outcomeErrorDuration` の en 訳）は
    chainviz-i18n のレビュー対象。"Succeeded"/"Failed" とした語感が
    他のUI文言と馴染むかは未確認
  - `docs/PLAN.md` のIssue #352チェックボックスは、collector側の実装も
    含めた本Issue全体が完了してから更新する（本コミット時点では未更新。
    frontend単独では該当箇所の一部でしかないため）

## 6. 反映済みドキュメント

- `docs/ARCHITECTURE.md`: `OperationEdge` スキーマ記述、§12.5(通信ログ
  パネル)の第2弾記述、「未確定のまま残す項目」内ロギングプロキシ項の
  確定(Issue #352)
- `packages/shared/src/world-state/entities.ts` / `entities.test.ts`

### 2026-07-18 実装(collector)設計メモ

- 担当: collector
- ブランチ: issue-352-comms-log-rpc-response-collector（designer の
  `issue-352-comms-log-rpc-response` から分岐した一時ブランチ。後で統括が
  cherry-pick して本流ブランチへ合流させる）
- 設計メモ §4.1 を踏まえた実装方針:
  1. **成否判定純関数を新ファイル `proxy/response-outcome.ts` に切り出す**。
     エントリポイントは `resolveResponseOutcomes(observations, forwardOutcome)`。
     `forwardOutcome` は `{ kind: "success"; status; body } | { kind: "failure" }`
     の判別union にし、§3.3 の3ケース(forward throw / 非2xx / 2xx本体解析)を
     1つの関数の中で完結させる(forward throw・非2xx は「全観測 error」という
     自明な分岐だが、判定ロジックを1箇所に集約して`handleRpcRequest`側を
     薄く保つため、ここに含める)。戻り値は `observations` と同じ長さ・順序の
     `(("ok" | "error") | undefined)[]`。
     - 単発/バッチの判定は「レスポンスボディの形」で行う(配列なら id 突き合わせ、
       オブジェクトかつ observations.length === 1 ならその1件を判定)。
       JSON-RPC 仕様上、バッチ(要素数1でも)は配列で応答し単発はオブジェクトで
       応答するため、リクエスト側の元の形(単発/バッチ)を別途保持しなくても
       レスポンス形状だけで一意に判定できる。バッチの id 突き合わせは
       `id === null`(通知)・対応欠落・id 重複のいずれも「判定不能
       (undefined)」に倒す
  2. **所要時間の起点は新たに `now()` を呼ばず、既存の `timestamp`
     (リクエスト受領完了時点の値)をそのまま起点として使う**(設計メモ §3.2
     「既存の `timestamp` 取得と同じタイミング」)。終点は forward の
     resolve/reject 直後の `now()`。バッチは 1 回の HTTP 往復を全観測で
     共有するため `durationMs` は observations 全体で1つの値
  3. `handleRpcRequest`:
     - 観測ログ出力(`log("[proxy] rpc call ...")`)ループは従来どおり転送前に残す
       (onObserve 呼び出しだけをここから外す)
     - forward 成功時: `resolveResponseOutcomes(observations, { kind: "success", ... })`
       で outcomes を得てから、observations と outcomes を zip して
       `onObserve` を発行する(小さなプライベートヘルパー
       `emitObservations(observations, outcomes, durationMs, onObserve)` に
       まとめ、成功/失敗パスの両方から呼ぶ)
     - forward 失敗(catch)時: `resolveResponseOutcomes(observations, { kind: "failure" })`
       (= 全観測 "error")で outcomes を得て同様に発行してから、従来どおり
       502 を返す
     - `durationMs` は `Math.max(0, Math.round(now() - timestamp))` で
       0以上の整数に丸める(§3.2)
  4. `RpcObservation`(collector 内部型)に `outcome?: "ok" | "error"` /
     `durationMs?: number` を追加。`emitObservations` は `outcome` が
     `undefined` のときフィールド自体を省略したオブジェクトを組み立てる
     (spread + 条件付きプロパティ)
  5. `operation-observer.ts` の `resolveOperationEdge`: `observation.outcome` /
     `observation.durationMs` を、`undefined` ならフィールドごと省略する形で
     `edge` に写す(既存の `nodeRole` 等 optional フィールドの流儀と同じ
     条件付きスプレッドパターンを使う)
  6. 既存 `logging-proxy.test.ts` の「転送前に onObserve が呼ばれる」前提の
     アサーション(`forward` が呼ばれる前に observed 配列を検査する等)は
     無いことを確認済み(現状のテストは `await handleRpcRequest` 完了後に
     まとめて検査しているため、発行タイミングの変更で壊れるのは主に
     期待値の中身(`outcome`/`durationMs` フィールド追加)であり、
     テスト構造自体は温存できる見込み)
- ファイル分割方針: `response-outcome.ts` を判定ロジック専用にし、
  `response-outcome.test.ts` も同ファイルのテストのみに絞る
  (1ファイル1責務をテストにも適用)。`logging-proxy.test.ts` は既存の
  `describe("handleRpcRequest")` 内に outcome/durationMs 関連のケースを
  追加する形にとどめ、新規ファイルには分けない(既存の関心事の延長のため)

### 2026-07-18 実装(collector)完了

- 担当: collector
- ブランチ: issue-352-comms-log-rpc-response-collector(designer の
  `issue-352-comms-log-rpc-response` から分岐した一時ブランチ。統括が
  cherry-pick して本流ブランチへ合流させる想定)
- 実施内容: 上記「実装(collector)設計メモ」の方針どおりに実装した。
  - `packages/collector/src/proxy/response-outcome.ts`(新規): 成否判定の
    純関数 `resolveResponseOutcomes(observations, forwardOutcome)` を実装。
    forward throw / 非2xx / 2xx(単発・バッチ・非JSON・対応欠落・id重複)の
    全パターンを1関数に集約
  - `packages/collector/src/proxy/logging-proxy.ts`:
    `RpcObservation` に `outcome?` / `durationMs?` を追加。
    `handleRpcRequest` の `onObserve` 発行を転送完了後(成功時・失敗時の
    両方)へ移動し、`timestamp`(既存のリクエスト受領時計測)を起点、
    `now()`(転送完了直後)を終点として `durationMs` を計測。ヘルパー
    `elapsedMs` / `emitObservations` を追加
  - `packages/collector/src/proxy/operation-observer.ts`:
    `resolveOperationEdge` で `observation.outcome` /
    `observation.durationMs` を、`undefined` ならフィールドごと省略する形で
    `OperationEdge` へ伝搬
  - テスト: `response-outcome.test.ts`(新規、13ケース)、
    `logging-proxy.test.ts`(発行タイミング・durationMs計測・丸め・
    バッチ共有・非JSON時のoutcome省略・転送失敗時のoutcome伝搬を追加、
    既存の「転送前にonObserve」を前提にした期待値は転送後の値に更新)、
    `operation-observer.test.ts`(outcome/durationMsの伝搬・省略を追加)
  - `pnpm lint && pnpm build && pnpm test`(全パッケージ)通過を確認
    (collector: 79 test files / 1617 tests、frontend含む全体も通過)
- 実装中に気づいた点・申し送り:
  - 単発/バッチの判定は「レスポンスボディの形(オブジェクトか配列か)」で
    行った。JSON-RPC仕様上、バッチ呼び出しは要素数が1でも配列で応答する
    ため、元のリクエストが単発かバッチかを別途保持しなくてもレスポンス
    形状だけで一意に判定できる。ユニットテストにこの前提(バッチ1件の
    ケース)を明示的なケースとして追加した
  - `handleRpcRequest` 内で `now()` を呼ぶ回数は変更前後で変わらない
    (タイムスタンプ取得時に1回、転送完了後に1回の計2回)。設計メモ§3.2の
    「既存の `timestamp` 取得と同じタイミングを起点にする」を、単に
    `timestamp` の値を再利用することで実現し、余分な `now()` 呼び出しは
    増やしていない
  - `docs/PLAN.md` のIssue #352チェックボックスは、frontend側の実装(並行
    作業中)が完了していないため今回は更新していない。両方揃った時点で
    更新する想定(この判断は統括が最終的に確認すること)
  - このブランチではshared型・frontend側のファイルには一切触れていない

### 2026-07-18 テスト強化メモ

- 担当: tester
- ブランチ: issue-352-comms-log-rpc-response
- 対象: collector/frontend の実装担当が書いた基本テストを、異常系・境界値・
  判定不能パターンの観点で補強する。新機能の実装は行わない。
- 既存カバレッジの確認結果:
  - `response-outcome.test.ts`: forward失敗/非2xx(500,301)/単発ok・error/
    非JSON/スカラー/バッチ突き合わせ・欠落・id重複・通知(null)・1件バッチ・
    非レコード配列は網羅済み
  - `logging-proxy.test.ts`: 発行タイミング・durationMs計測/丸め/バッチ共有/
    非JSON時outcome省略/転送失敗時のerror伝搬は網羅済み
  - frontend の commsLogText / CommsLogEntryRow / mockData / deriveCommsLog
    の各 operationOutcome テストは4パターン+ja+モックの基本性質を網羅済み
- 追加する観点（抜けていたもの）:
  1. `resolveResponseOutcomes` の境界: 観測0件、HTTPステータス境界値
     (199/299/300)、2xxだが空ボディ(204相当→JSON解釈不能→判定不能)、
     `error`キーが `null`/`false` の場合の扱い(キー存在で error に倒す
     現仕様の固定)、単発オブジェクト応答なのに観測が複数件、空配列応答、
     バッチのid型不一致(数値vs文字列)・文字列id一致・id=0境界
  2. `handleRpcRequest` の異常系: 転送がresolveした非2xx(上流500)を透過
     しつつoutcome=errorにすること、時計が逆行した場合のdurationMs=0
     クランプ、onObserve未指定でも例外を出さないこと
  3. `describeOperationSuffix` の境界値: durationMs=0(欠落と区別して表示)、
     非常に大きい値(単位切替せずms表記のまま)
  4. `CommsLogEntryRow`: durationMs=0の描画、outcome span が描画される
     ときは常にaria-labelを持つこと(モレの検出)
  5. `mockOperationObserved`: 「7回に1回error」を21連続呼び出しで厳密に
     error=3件と固定、durationMsが15連続で3〜45msの15値を網羅すること
- ファイル分割方針: collector の境界ケースは
  `response-outcome.boundary.test.ts` を新規作成して基本仕様テストと分離。
  `handleRpcRequest` の異常系は関心が同じなので既存 `logging-proxy.test.ts`
  の describe に追記。frontend は既存の各 operationOutcome テストへ境界値
  ケースを追記する（同一関心のため新ファイルは作らない）。

### 2026-07-18 テスト強化 完了

- 担当: tester
- ブランチ: issue-352-comms-log-rpc-response
- 追加したテスト:
  - `packages/collector/src/proxy/response-outcome.boundary.test.ts`（新規、
    16ケース）: 観測0件・HTTPステータス境界(199/299/300)・204空ボディ・
    `error`キーが null/false のときの扱い・応答形状と件数の不一致・空配列
    応答・バッチのid型不一致/文字列id/id=0/通知混在
  - `packages/collector/src/proxy/logging-proxy.test.ts`（追記、3ケース）:
    resolveした非2xx上流の透過とoutcome=error・時計逆行時のdurationMs=0
    クランプ・onObserve未指定でも動作
  - `packages/frontend/src/comms-log/commsLogText.operationOutcome.test.ts`
    （追記、4ケース）: durationMs=0の表示・非常に大きい値でms単位維持
  - `packages/frontend/src/side-panel/CommsLogEntryRow.operationOutcome.test.tsx`
    （追記、3ケース）: durationMs=0の描画・outcome span描画時は常にaria-label
    を持つこと
  - `packages/frontend/src/websocket/mockData.operationOutcome.test.ts`
    （追記、2ケース）: 21連続でerror厳密3件・15連続でdurationMsが15値網羅
- 実施結果: `pnpm build`（collector/frontend）・`pnpm test`（collector 1636 /
  frontend 2650）・`pnpm lint` 通過。
- 実装への懸念（バグではないが申し送り）:
  - `resolveResponseOutcomes` は JSON-RPC 応答の `error` キーの「存在」だけで
    error に倒す（値が null/false でも error）。準拠サーバは成功時に error
    メンバーを含めないため通常は問題ないが、非準拠サーバが成功時に
    `error: null` を返すと成功が error 表示になる。設計メモ §3.3 の割り切り
    どおりの挙動であり現時点では妥当と判断。将来 error 詳細を載せる別Issueで
    再検討の余地あり（テストで現挙動を固定済み）。

### 2026-07-18 レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-352-comms-log-rpc-response
- 判定: **合格**
- 確認内容:
  - `packages/shared` の型変更(`OperationEdge.outcome?/durationMs?`)の
    設計原則との整合: `"ok" | "error"` はプロトコル非依存の語彙で、
    JSON-RPC 固有の判定規則は collector のプロキシ側
    (`response-outcome.ts`)に閉じている。型コメント内の「JSON-RPC の
    error フィールド等」への言及は「判定は collector の責務」という境界の
    説明であり語彙の漏れではない(既存 `operation` フィールドと同じ扱い)。
    optional 化による後方互換も `entities.test.ts` で固定済み
  - エラー握りつぶしの明示的チェック(collector):
    - `handleRpcRequest` の転送失敗 catch はログ出力(`log("[proxy]
      forward to upstream failed:", err)`)+ outcome=error の観測発行 +
      502 応答で、握りつぶしなし
    - `response-outcome.ts` の JSON.parse catch は「判定不能 =
      undefined」への意図的な倒し込みで、理由コメントあり(判定不能を
      error に倒さない設計判断も §3.3 とファイル冒頭コメントに明記)
    - 非2xx 上流応答を 502 に潰さず素通ししつつ観測だけ error にする
      透過性もテストで固定されている
  - `onObserve` 発行の転送後移動の影響: リクエスト時の観測ログ出力は
    転送前に残り、成功・失敗の両パスで `emitObservations` が呼ばれるため
    観測が失われるパスはない。既存のボディ読み取りエラー(400/413)パスは
    `handleRpcRequest` 到達前で従来どおり
  - frontend: `commsLog.operation.*` の新規キーは `{ja, en}` 形式・
    `format()` プレースホルダの既存パターン(`commsLog.internal.latency`)と
    整合。CSS は `--synced` と既存の `#ffb4b4`(tx失敗系で4箇所使用済みの
    リテラル)の再利用のみで新色なし。`describeOperationSuffix` の4パターン
    (両方欠落/duration のみ/outcome のみ/両方)が実装・テストとも網羅
  - tester の申し送り(「error キーの存在だけで error に倒す。値が
    null/false でも error」): 設計メモ §3.3 の「存在すれば error」の
    割り切りどおりで妥当。`response-outcome.boundary.test.ts` に理由
    コメント付きテスト(§3.3 参照)で現挙動を固定済み。実装側も冒頭
    コメントで存在ベースの規則を明記しており十分
  - 決め打ち定数の混入なし: `durationMs` は `now()` 注入時計からの実測。
    モックの周期値(7回に1回 error 等)は「演出値」とコメント明記済み
  - テストの質: 発行タイミング(転送後)・時計逆行時の0クランプ・
    HTTP ステータス境界(199/299/300)・id 突き合わせの各種判定不能・
    aria-label の付与保証・durationMs=0 と欠落の区別など、異常系・境界値
    まで実質的に検証している。壊れたコードでも通る形骸テストは見当たらない
  - コミット粒度: shared型 → ARCHITECTURE → 設計メモ → collector 3コミット
    (純関数/プロキシ/observer) → frontend 4コミット(導出/文言/描画/モック)
    → e2e → テスト強化2コミット → docs と、1変更1コミットが守られている。
    全コミット Conventional Commits 形式
  - `pnpm lint` / `pnpm build` / `pnpm test`(shared/collector/frontend/e2e
    全パッケージ)通過を確認(collector 1636 / frontend 2650)
- 注意点(統括への申し送り。差し戻し理由ではない):
  - 本ブランチの分岐点は main の e6bf05d(#381 docs マージ)より前のため、
    `git diff main..HEAD` 上は `docs/worklog/issue-381.md` 削除・
    `docs/PLAN.md`/`docs/WORKLOG.md` の #381/#346 行の巻き戻りに見えるが、
    ブランチ自体は何も削除していない(見かけ上の差分)。PR 作成前に main を
    取り込む際、`docs/WORKLOG.md` の #346 行と `docs/PLAN.md` バックログで
    軽微なコンフリクト解消が必要になる見込み
  - i18n の英語文言("Succeeded"/"Failed" 系)は chainviz-i18n のレビュー
    対象として残っている(frontend 実装メモに記載のとおり)
  - E2E(UI-LOG-02)の追加検証は実環境依存のため chainviz-qa の確認対象
