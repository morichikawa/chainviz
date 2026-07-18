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
