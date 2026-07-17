# Issue #317 ノード間のリクエスト・レスポンスをログとして別タブで監視できるようにする

### 2026-07-17 Issue #317 UX設計（ux）

- 担当: ux
- ブランチ: issue-317-comms-log-panel
- 内容: 実装着手前のUX設計。実際にアプリ（モックモード + Playwright）を
  動かして現状のキャンバス表現を評価し、「通信ログ」パネルの操作フロー・
  情報の見せ方・保持件数・フィルタ・既存表現との関係を確定した。
  実装コードは書いていない。`packages/shared` の型変更は第1弾では不要
  （§8 の第2弾は統括・designer との調整事項として残す）。

## 1. 評価（実際に動かして確認したこと）

frontend をモックモード（`VITE_COLLECTOR_URL` 未設定で vite 起動）+
Playwright（chromium。サンドボックスに `libnspr4.so` 等が無かったため、
Ubuntu の deb を展開して `LD_LIBRARY_PATH` で解決）で操作・撮影した:

- ワークベンチ → reth-1 の RPC 呼び出し（`eth_sendRawTransaction`）は
  マゼンタの操作エッジ + パルスとして描かれるが、表示時間は 900ms
  （`OPERATION_PULSE_DURATION_MS`）。連続スクリーンショット（0.7 秒間隔）で
  「1枚目には写っているパルスが2枚目では跡形もなく消えている」ことを確認
  した。**一瞬目を離すと、呼び出しがあった事実ごと消える**
- パルス飛行中のホバーでメソッド名は見られるが、900ms 以内にカーソルを
  当てるのは実用的に不可能。つまり「どのメソッドが呼ばれたか」は事実上
  読み取れない
- 内部リンク（beacon → reth の Engine API）の活動パルスも同様に揮発する。
  直近観測はエッジのホバーポップオーバーに残るが「直近1回分」だけで、
  遡れない
- ブロック伝播は波パルス + チェーンリボンで見えるが、「どのノードが
  何秒遅れで受信したか」を後から確認する手段は無い
- Issue #321 のサイドパネル（右ドック・約 420px・ヘッダ + 閉じる + Esc +
  本文スクロール）を実際に開いて確認。ログの置き場所として幅・操作感とも
  成立する

言語化した課題: **キャンバスは「今」を見せることに最適化されており、
「さっき何が起きたか」を保持する場所がどこにも無い**。機能（パルス）は
動いているが、出来事の順序・頻度・相手は伝わっていない。

## 2. 全体方針

- **キャンバス表現の置き換えではなく「記録」を追加する**。パルス・波・
  リボンは従来どおり動かし、同じ出来事を時系列のログエントリとしても
  蓄積する。同じ出来事が「キャンバスでは一瞬の光、ログでは1行」として
  両方に現れ、色の意味体系（後述）で対応づけられることが学習価値になる
- **「別タブ」はブラウザの別タブではなく、既存サイドパネル機構への相乗り**
  と解釈する（`SidePanelView` に `{ kind: "commsLog" }` を追加）。理由:
  (1) キャンバスと並べて見られないと「パルスとログの対応づけ」という
  学習価値が消える、(2) 別タブは WebSocket の二重接続・状態同期という
  新しい複雑さを持ち込む、(3) §12.2 が #317 の相乗りを最初から想定している
- **第1弾はフロントエンドのみで完結させる**。ログの材料は既に WebSocket で
  全クライアントに届いている DiffEvent 列で足りる（§3）。collector・
  `packages/shared` の変更なし。「レスポンス」の観測（成否・所要時間）
  だけは新規観測が必要なため第2弾として分離する（§8）

## 3. ログの情報源（既存 DiffEvent の棚卸し）

既存イベントから導出できるもの（第1弾のスコープ。新規観測ゼロ）:

| カテゴリ | 情報源 | ログにできる内容 |
| --- | --- | --- |
| 操作（RPC） | `operationObserved`（OperationEdge） | ワークベンチ → ノードの呼び出し。方向・メソッド名・観測時刻 |
| 内部API | `nodeLinkActivity`（NodeLinkActivity） | CL→EL（Engine API）・validator→beacon の呼び出し。方向・メソッド別回数・レイテンシ・観測時刻 |
| ブロック | BlockEntity の `entityAdded` / `entityUpdated`（receivedAt の増分） | ノードごとのブロック受信。受信ノード・ブロック番号・受信実時刻・波の起点からの相対遅延 |
| tx | TransactionEntity の `entityAdded` / `entityUpdated`（status 遷移） | mempool 投入・ブロック取り込み・失敗。短縮ハッシュ・取り込み先ブロック |
| P2P接続 | `edgeAdded` / `edgeRemoved`（PeerEdge） | ピア接続の確立・切断。両端ノード・ネットワークID |
| 環境 | node/workbench/contract の `entityAdded` / `entityRemoved`、接続ステータス変化 | ノード/ワークベンチの追加・削除、コントラクトのデプロイ、collector との接続断・再接続 |

観測できないもの（正直に扱う）:

- **P2P ゴシップの実際の送信経路**（どのピアがどのピアへブロックを送った
  か）は観測していない。あるのは各ノードの受信時刻だけ。ログの文言は
  「〜が受信」とし、方向を断定しない（波アニメーションと同じ「受信時刻の
  前後関係」以上のことを言わない）。パネルの空状態の説明文にもこの旨を
  一言入れる（§5.6）
- **RPC のレスポンス**（成否・所要時間）。ロギングプロキシは透過転送で
  レスポンスを手にしているが観測対象にしていない（`RpcObservation` は
  リクエストのみ）。第2弾（§8）

## 4. 操作フロー

1. **開く**: キャンバス左上ツールバー（ノード追加・ワークベンチ追加の並び）
   の右端に「通信ログ」トグルボタンを置く。押すとサイドパネルが
   `{ kind: "commsLog" }` で開く。開いている間はボタンを押下状態
   （aria-pressed）で示し、再度押すと閉じる
2. **眺める**: エントリは**新しいものが上**（降順）。新着エントリは
   カード新着発光と同じ流儀で短くハイライトして「流れている」ことを
   見せる。自動スクロールは行わない（先頭 = 最新なので不要）
   - tail -f 型（新しいものが下 + 自動追尾）を不採用とした理由: 追尾の
     一時停止/再開という状態が増え、「なぜ流れが止まったのか」という
     新たな混乱を生む。降順なら「上が今、下へ行くほど過去」という
     単純なモデルで説明が要らない
3. **遡る**: 下へスクロールするだけ。保持窓（§6）を超えた分は消えている
4. **絞る**: パネル上部のフィルタ（§5.4）でカテゴリ・ノードを絞る。
   フィルタは表示だけを絞り、蓄積は全カテゴリ継続する
5. **閉じる**: 閉じるボタン / Esc / ツールバーのトグル再押下。閉じても
   **蓄積は続く**（次に開いたとき、閉じていた間の出来事も遡れる）。
   これが「開いた瞬間は空っぽで何も伝わらない」を防ぐ要点なので、
   ログ蓄積フックはパネルの開閉と無関係に App 層で常駐させること

## 5. 情報の見せ方

### 5.1 エントリの構成

1エントリ2行の固定レイアウト:

- 1行目: 時刻（ローカル `HH:MM:SS`）+ カテゴリチップ + 主体
  （`from → to`。単一主体のイベントはノード名のみ）
- 2行目: 内容。メソッド名などチェーン固有の生値は等幅 code スタイル、
  ブロックは `#番号`、tx・アドレスは既存カードと同じ短縮表記

文言の例（i18n 初稿。語調・英訳の細部は実装時裁量）:

- 操作: `Alice のワークベンチ → chainviz-reth-1` / `eth_sendRawTransaction`
- 内部API: `chainviz-lighthouse-1 → chainviz-reth-1` /
  `engine_newPayloadV4 ×1 · 12ms`（calls 配列の各要素を並べる）
- ブロック: `chainviz-reth-2` / `ブロック #129 を受信（+0.42s）`
  （相対遅延は波の起点 `waveOriginTime` からの差。起点ノード自身は
  「最初に受信」と表記）
- tx: `0xa11c…000` / `mempool に投入` → 後続エントリで
  `ブロック #130 に取り込み` / `失敗`
- P2P接続: `chainviz-reth-1 ⇄ chainviz-reth-2` / `ピア接続が確立`
  （⇄ は方向を断定しない意図）
- 環境: `chainviz-node-3` / `ノードが追加された`、
  `collector との接続が切れた / 再接続した`

表示名はカードと同じ解決（node/workbench は containerName / label、
コントラクトは name または「未知のコントラクト」）を再利用する。

### 5.2 色の意味体系（既存と揃える）

カテゴリチップの色はキャンバスの既存エッジ・要素色を**そのまま**使う。
新しい色を発明しない:

- 操作（RPC）= 操作エッジのマゼンタ（`--op-edge`）
- 内部API = 内部リンクエッジ色（D層）
- ブロック = ブロック伝播パルス/チェーンリボン系
- tx = C層の tx 表現系
- P2P接続 = ピアエッジ系
- 環境 = ニュートラル（グレー系）

「キャンバスで見た光の色」と「ログの行の色」が一致することが、両者が
同じ出来事だと伝える手段になる。具体的な CSS 変数の対応は実装時に
styles.css の既存定義から引くこと。

### 5.3 用語解説との連携

カテゴリチップ・本文中の既存用語（mempool・ピア・ブロック等）には
`GlossaryTerm` アンカーを付けられる。全部に付けると点線だらけになるので、
**カテゴリチップにのみ**付ける程度に抑える（本文はイベントのたびに
繰り返し現れるため過剰になる）。

### 5.4 フィルタ

二軸・いずれも表示フィルタ（蓄積には影響しない）:

- **カテゴリ**: 6種のチップを複数選択トグル。既定は全 on。
  内部APIは流量が多い（観測間隔ごとにペア単位で1件）が、既定 off にすると
  存在自体に気づけないため全 on のまま、エントリの視覚的重み（透明度を
  やや下げる等）で主張を抑える。実測で煩すぎれば既定 off への変更を
  検討してよい（変更する場合はその判断を worklog に残すこと）
- **ノード**: 単一選択のドロップダウン（「すべて」+ 現存の node/workbench
  一覧）。選択時は from/to のどちらかに該当するエントリのみ表示。
  対象が削除済みになった場合は「すべて」へ戻す

### 5.5 パネルヘッダ

- タイトル: 「通信ログ」 / "Communication log"
- タイトル直下に1行の説明: 「キャンバスに一瞬だけ現れる出来事を時系列に
  記録しています。新しいものが上です」/ 同趣旨の英文。
  既存表現との補完関係を明示する（§2 の方針を UI 上でも言う）

### 5.6 空状態

エントリ0件時: 「まだ記録がありません。ブロックの生成やワークベンチの
操作が起きるとここに流れます」。あわせて「P2P のブロック伝播は各ノードの
受信として記録されます（ノード間の送信経路そのものは観測していません）」
という注記をここ（または説明行のツールチップ）に置き、§3 の限界を隠さない。

## 6. 保持件数

- フロント側のリングバッファで **上限 500 件**（定数
  `COMMS_LOG_RETENTION`）。超えたら古い方から捨てる
- 根拠: 実環境（slot 12 秒・ノード5枚前後）でおよそ 40〜60 件/分の想定
  流量なので、500 件で 10 分前後を遡れる。1件数百バイト × 500 でメモリは
  無害。この値は「今の環境の観測数」に依存した閾値ではなく表示上の保持窓
  であり、環境が変わっても静かに壊れる性質のものではない（溢れた分が
  早く流れるだけ）。この前提をコード上のコメントにも明記すること
  （CLAUDE.md の固定値ルール）
- セッションスコープ（リロードでクリア）。localStorage 等への永続化は
  しない（環境スナップショット共有の構想とは別物。先回りしない）
- collector 側の保持は増やさない（揮発イベントは従来どおり揮発のまま。
  ログ化はフロントの責務）

## 7. 実装設計（frontend への引き継ぎ）

### 7.1 データフロー

- ログ導出は **`useWorldState` の `onDiff` 到着時に同期的に**行う。既存の
  `operations` / `nodeLinkActivities` 配列（CAP 100 の揮発シグナル）を
  再消費する形にしないこと（キャップで取りこぼす・二重管理になる）。
  推奨: `deriveCommsLogEntries(prevState, events, now): CommsLogEntry[]`
  という純関数（`applyDiff` 適用**前**の state を渡し、receivedAt の増分
  検出や tx の status 遷移検出に使う）+ リングバッファを持つフック
  `useCommsLog`。App 層で常駐させ、Context でパネルへ渡す
- スナップショット適用（初回・再接続）ではエントリを生成しない（diff
  由来のみ）。代わりに接続ステータス変化（disconnected/connected）を
  「環境」エントリとして記録する
- タイムスタンプはイベント自身が持つ時刻（`observedAt` / `receivedAt` の
  値）を優先し、持たないイベント（entityAdded 等）はフロント受信時刻を使う
- **ブロック受信の重複排除**: `BlockEntity.receivedAt` には同一受信が
  EL キーと beacon エイリアスキーの2キーで載る（Issue #141 の 2 キー記録。
  `blockPulse.ts` 冒頭のコメント参照）。同じ受信が2行に見えないよう
  1論理ノード1エントリに畳むこと。実現方法は実装判断でよい（候補:
  (a) chain-profiles の nodeRoles 解釈で execution 役のキーのみ採用、
  (b) `drivesNodeId` で対になるノードの同時刻キーを畳む一般規則）。
  どちらを採ってもチェーン固有解釈は chain-profiles/ に閉じること

### 7.2 ファイル構成の目安

- `side-panel/sidePanelView.ts`: `{ kind: "commsLog" }` を判別共用体に追加
- `side-panel/CommsLogView.tsx`: パネル中身（`SidePanelHost` に case 追加）
- `comms-log/`（新設ディレクトリ）: エントリ型 `CommsLogEntry`・導出純関数
  `deriveCommsLogEntries`・保持フック `useCommsLog`・フィルタ純関数。
  1ファイル1責務で分け、テストも関心事ごとに分割する
- `canvas/CanvasToolbar.tsx`: 「通信ログ」トグルボタン追加
  （`useSidePanel().open/close`）
- `i18n/messages.ts`: 文言追加（§5.1・§5.5・§5.6 の初稿を基に）
- data-testid の目安: `canvas-toolbar-comms-log` / `comms-log-view` /
  `comms-log-entry` / `comms-log-filter-<category>` / `comms-log-node-filter`
- モックモードは変更なしで動く（mock が毎 tick `operationObserved`・
  `nodeLinkActivity`・block/tx diff を流すため、オフラインで全カテゴリを
  確認できる）

### 7.3 E2E（ステップ10以降のルール対応）

`packages/e2e/SCENARIOS.md` に UI シナリオ（UI-LOG 系）を追記し、Playwright
テストを実装すること。最低限:

- パネルの開閉（ツールバートグル・Esc）
- 送金操作の実行後に「操作（RPC）」エントリが記録される
- ブロック進行で「ブロック受信」エントリが増える
- カテゴリフィルタで該当カテゴリだけに絞られる

## 8. 第2弾（本Issueに含めるか統括の判断待ち): レスポンスの観測

Issue 原文の「リクエスト・**レスポンス**」のうち、レスポンス側（呼び出しの
成否・所要時間）は現状観測していない。実現案:

- collector: `handleRpcRequest` は転送レスポンスを既に手にしているので、
  JSON-RPC レスポンスの `error` 有無と所要時間を `RpcObservation` に追加
  観測する（観測を理由に透過性は崩さない）
- shared: `OperationEdge` に optional フィールド（例:
  `outcome?: "ok" | "error"` と `durationMs?: number`）を追加。optional
  なので旧スナップショット・既存パルス描画とは互換
- frontend: 操作エントリの2行目に成否アイコンと所要時間を添える

推奨は「本Issueは第1弾（フロントのみ）で完結させ、レスポンス観測は
別Issueに分割」。理由: 第1弾だけで時系列ログとしての価値が成立し、
shared 型変更・collector 変更を伴う第2弾を分けたほうがレビュー・QA の
単位が小さく保てる。`packages/shared` の型変更を伴うため、進める場合は
designer との調整が必要。

## 9. 決めた判断とその理由（要約）

1. 別タブではなくサイドパネル相乗り（§2）
2. 並び順は新しいものが上・自動スクロールなし（§4-2）
3. ログ蓄積はパネル開閉と無関係に常駐（§4-5）
4. カテゴリ色は既存エッジ色の再利用で新色を作らない（§5.2)
5. P2P 伝播は「受信」の語で記録し送信経路を断定しない（§3・§5.6）
6. 保持は 500 件のリングバッファ・セッションスコープ（§6）
7. レスポンス観測は第2弾として分離を推奨（§8。統括の確認待ち）

## 10. 未決のまま実装担当へ委ねる点

- エントリの正確なレイアウト・フォントサイズ・チップの形状（実測で調整）
- ブロック受信の重複排除の実現方法（§7.1 の (a)/(b) どちらでも可）
- 内部APIエントリの視覚的な抑え方（透明度か文字サイズか）
- フィルタ UI の細部（チップの並び・ドロップダウンの実装方式）
- 相対遅延表記（+0.42s）の桁数・閾値（波の起点と同時刻の場合の扱い含む）

### 2026-07-17 Issue #317 第1弾実装（frontend）

- 担当: frontend
- ブランチ: issue-317-comms-log-panel
- 統括の判断: レスポンス（成否・所要時間）の観測は Issue #352 として別
  Issue に分割済み。今回のスコープには含めない（§8 の判断どおり）。

#### 実装方針・設計メモ

- ログ導出は `packages/frontend/src/comms-log/` に新設した純関数群に閉じる。
  `deriveCommsLogEntries(prevState, events, now)` が DiffEvent 列から
  `CommsLogEntry[]` を導出し、リングバッファ・フィルタ状態は
  `useCommsLog()` フックが持つ（§7.1 の設計どおり）。`packages/shared` の
  変更は無し。
- `useWorldState` に `onDiffEvents?: DiffObserver`（`(prevState, events,
  now) => void`）を追加した。onDiff 到着のたびに「適用前の WorldState」を
  渡して呼ぶ。React 18 Strict Mode は `setState` へ渡した更新関数を開発時に
  二重実行しうるため、`setState(current => applyDiff(current, events))`
  という既存の書き方のまま `onDiffEvents` を呼ぶと二重発火してしまう。
  代わりに `worldStateRef`（直近確定 state を手動で同期する ref）を導入し、
  `setState` には確定済みの値をそのまま渡す形に変えた（`onDiff`
  ハンドラ自体は React のレンダー経路の外で動く通常の JS コールバックなので
  二重実行の対象ではないが、`setState` の関数形式引数だけは対象になりうる
  ため、そちらを避けた）。`useCommands` はこの引数をそのまま
  `useWorldState` へ委譲するだけ。
- `useCommsLog()` は当初「現存する node/workbench id 集合」を引数に取る
  設計だったが、App.tsx で実際に配線する際に「`observeDiff` を
  `useCommands` に渡すには `state` が確定する前にこのフックを呼ぶ必要が
  あるが、id 集合は `state` から導出される」という循環に気づいた
  （設計段階では気づけなかった実装上の制約）。引数を廃止し、
  `syncValidNodeWorkbenchIds(ids)` という明示的な呼び出しに変更し、
  呼び出し側（App.tsx）が `entities` 確定後に `useEffect` から呼ぶ形にした
  （接続状態を伝える `noteConnectionStatus` と同じパターンに統一）。
- ブロック受信の重複排除（§7.1 候補(b)）は「駆動する側（beacon）の
  receivedAt キーが、駆動される側（execution）と同じ時刻を持つ場合にだけ
  エイリアスとして畳む」という構造だけを見た汎用規則にした
  （`comms-log/blockReceiptDedup.ts`）。ロール名（"execution"/"consensus"）
  を一切参照しないため、この関数自体はチェーン固有解釈を持ち込まない
  （CLAUDE.md の ChainAdapter 境界を満たす）。
- 表示名解決（node は containerName、workbench は label）は
  `resolveActorLabel.ts` に切り出した。カード本体の見出し（両kindとも
  containerName）とは異なる決定だが、設計メモ §5.1 の例（"Alice のワーク
  ベンチ → chainviz-reth-1"）が workbench 側を人が付けた名前で示している
  ことに合わせた。
- カテゴリチップの色は既存のキャンバス色をそのまま再利用する方針
  （設計メモ §5.2）を CSS カスタムプロパティの参照だけで実現し、新しい
  色は一切定義していない（`--op-edge`/`--internal-edge`/`--accent`/
  `--syncing`/`--synced`/赤/`--muted`）。peer だけは
  `entities/peerEdge.ts` の `networkIdColor(networkId)` をエントリ単位で
  呼び、実際のピアエッジと同じ色を inline style で当てている。
- E2E（`packages/e2e/SCENARIOS.md` UI-LOG-01〜04・
  `packages/e2e/src/ui/comms-log.spec.ts`）は §7.3 のルールに従い追加した。
  実 Docker スタックに対しては未実行（globalSetup が実環境を要求するため、
  フロント実装担当の環境では起動していない）。chainviz-qa による実行を
  前提とする。

#### 実装中に見つけたバグとその修正

- **同一バッチ内での entityAdded→entityUpdated の見落とし**:
  当初の実装は block の receivedAt 増分検出に `prevState`
  （イベント列全体の適用前）だけを基準にしていた。モックモードで実際に
  アプリを動かして目視確認したところ、新しいブロックの受信ノードが
  「最初の1台」しかログに現れないことに気づいた。原因は、モックの
  `advanceChain()` が「ブロックの entityAdded」→「直後の同一 hash への
  entityUpdated（receivedAt 追記）」を同じ `events` 配列内で連続して
  push するため、後段の entityUpdated が「まだ `prevState` に存在しない
  エンティティの更新」として黙って無視されていたこと。`deriveCommsLogEntries`
  内で `running`（events を1件ずつ `applyDiff` して進める、直前state）を
  導入し、block の receivedAt・tx の status 遷移の両方の「前の値」を
  `prevState` 固定ではなく `running` から引く形に修正した。回帰テスト
  （同一バッチ内 entityAdded→entityUpdated の組み合わせ）を追加し、修正前
  の実装に戻すと実際に落ちることを確認してから元に戻した
  （`deriveCommsLogEntries.block.test.ts`）。
- `SidePanelHost.tsx` の既存ダングリングガード（`view !== null && contract
  === undefined`）は元々 contractSource 専用の判定だったが、`commsLog`
  kind を素通しすると `contract` が常に `undefined` になり、開いた瞬間に
  即座に閉じてしまう不具合を実装中に発見した（実装前の型チェック時点で
  気づいた。ランタイムでの再現確認はテスト
  `SidePanelHost.commsLog.test.tsx` の
  "is not affected by the contractSource dangling guard" で行った）。
  判定を `view?.kind === "contractSource" && contract === undefined` に
  変更し、commsLog を対象外にした。

#### ファイル構成（実装後）

- `comms-log/commsLogEntry.ts`: `CommsLogEntry`（6カテゴリの判別共用体）
- `comms-log/blockReceiptDedup.ts` (+test): EL/CL 2キー記録の重複排除
- `comms-log/resolveActorLabel.ts` (+test): node/workbench の表示名解決
- `comms-log/deriveCommsLogEntries.ts`
  (+`.operation`/`.block`/`.tx`/`.peer`/`.environment`/`.ordering`
  の5分割test): 導出純関数本体
- `comms-log/commsLogFilter.ts` (+test): フィルタ状態・適用純関数
- `comms-log/commsLogText.ts` (+test): エントリ→表示文言の変換純関数
  （React 非依存、`t` を引数化）
- `comms-log/formatLocalTime.ts` (+test): ローカル時刻表示
- `comms-log/useCommsLog.ts` (+test): リングバッファ・フィルタ・
  接続状態監視・`observeDiff`/`syncValidNodeWorkbenchIds`
- `comms-log/testFixtures.ts`: テスト用の最小エンティティビルダー
  （derive系テストで共通利用。テストファイル自体ではないため vitest
  には拾われない）
- `side-panel/CommsLogView.tsx` / `CommsLogEntryRow.tsx` /
  `CommsLogFilterBar.tsx`（各+test）: パネル中身
- `side-panel/SidePanelHost.tsx`: `commsLog` kind の振り分けを追加
  （+`SidePanelHost.commsLog.test.tsx`）
- `side-panel/sidePanelView.ts`: `{ kind: "commsLog" }` を追加
- `canvas/CanvasToolbar.tsx`: 「通信ログ」トグルボタン追加
  （+`CanvasToolbarCommsLog.test.tsx`）
- `canvas/Canvas.tsx`: `commsLog`/`commsLogNodeOptions`
  （rfNodesから導出）を `SidePanelHost` へ橋渡し
- `app/App.tsx`: `useCommsLog()` を App 層で常駐マウントし、
  `observeDiff` を `useCommands` へ、`syncValidNodeWorkbenchIds`/
  `noteConnectionStatus` を対応する `useEffect` から配線
- `world-state/useWorldState.ts`: `DiffObserver` 型・`onDiffEvents`
  引数を追加（+`useWorldState.diffObserver.test.tsx`）
- `commands/useCommands.ts`: `onDiffEvents` 引数を追加して委譲
  （+`useCommandsDiffObserver.test.tsx`）
- `i18n/messages.ts`: `commsLog.*` / `action.commsLog` を追加
- `styles.css`: `.comms-log-*` 一式、`.canvas-toolbar__button--active`

#### 確認したこと

- `pnpm --filter @chainviz/frontend build` / `test`（vitest、180ファイル・
  2415件）が通ることを確認済み。lint（`eslint`）もクリーン。
- モックモード（`vite` を `VITE_COLLECTOR_URL` 未設定で起動）+ Playwright
  （chromium。サンドボックスに `libnspr4.so` 等が無いため、事前に展開
  済みのライブラリへ `LD_LIBRARY_PATH` を通して解決。UX設計時と同じ
  対処）で実際に操作・撮影して確認した:
  - ツールバーの「通信ログ」ボタンでパネルが開閉し、Esc でも閉じる
  - モックの tick（既定3秒間隔）で6カテゴリのうち operation/internal/
    block/tx の4カテゴリが実際にログへ流れることを確認（peer/environment
    は addNode 等の操作が必要なため、この目視確認では未発生。ユニット
    テストでは全カテゴリを確認済み）
  - ブロックカテゴリで、CL（lighthouse）→EL（reth-1）→reth-2 の受信順・
    相対遅延（+0.03s・+0.07s）が正しく表示される（このモックはCL/ELの
    受信時刻を意図的に30ms・65ms ずらしてシミュレートしており、Issue #141
    の「同時刻エイリアス」とは別物。重複排除ロジックはこのケースでは
    発火せず、3ノード全てが独立したエントリとして正しく現れることを確認）
  - tx チップの色が実際に pending=amber/included=green で塗り分けられる
    ことを DOM の computedStyle で確認（クロップした縮小画像では目視で
    判別しづらかったため、色そのものは JS 評価で検証した）
  - カテゴリフィルタで on/off した表示切り替え、日本語/英語表示切替も
    確認した
- `packages/e2e` 側は `pnpm --filter @chainviz/e2e build`（tsc --noEmit）・
  `pnpm --filter @chainviz/e2e test`（protocol層 vitest、171件）のみ確認。
  Playwright の UI 層 E2E（`test:e2e:ui`）は実 Docker スタックを要するため
  未実行（chainviz-qa に委ねる）。

#### 次の担当（レビュー・QA）への申し送り

- `useCommsLog` の API（`observeDiff`/`noteConnectionStatus`/
  `syncValidNodeWorkbenchIds`）は設計メモの想定から実装時に変わっている
  （上記「実装方針・設計メモ」参照）。設計メモの §7.1 と実装を突き合わせる
  際はこの差分を踏まえてほしい。
- `packages/e2e/src/ui/comms-log.spec.ts` は実環境未実行。特に
  UI-LOG-03（ブロック進行待ち）・UI-LOG-04（複数カテゴリの蓄積待ち）は
  タイミング依存が強いため、実機での安定性を重点的に見てほしい。
- 第2弾（レスポンス観測、Issue #352）は本Issueのスコープ外。
  `CommsLogTxEntry`/`CommsLogOperationEntry` 等の型に成否・所要時間を
  追加する際は、この第1弾の型・導出ロジックとの整合を確認すること。

### 2026-07-17 Issue #317 テスト強化（tester）

- 担当: tester
- ブランチ: issue-317-comms-log-panel
- 内容: 第1弾実装（frontend）の基本テストに対し、異常系・境界値・設計不変
  条件の観点でユニットテストを追加した。新機能の実装・既存実装ロジックの
  変更は行っていない。

#### 追加したテスト（関心事ごとに新規ファイルへ分割）

- `comms-log/deriveCommsLogEntries.sameBatch.test.ts`（新規）:
  同一 diff バッチ内で「同じエンティティ／エッジへの複数イベントが連続する」
  ケースを block 以外へ横展開して固定。実装担当が block でのみ確認・修正した
  「後続 entityUpdated 見落とし」（`running` 逐次適用で修正済み）が、tx
  （added pending → updated included/failed）・環境（node added → removed）・
  peer（edgeAdded → edgeRemoved）・複数ブロックのインターリーブでも正しく
  機能することを確認。この仕組みは `deriveCommsLogEntries` 内の
  `running.entities[event.id]` 参照に集約されているため横展開漏れは無い
  （実装を `prevState.entities` に戻すと tx・複数ブロックのテストが実際に
  失敗することを確認してから戻した）。
- `comms-log/deriveCommsLogEntries.noise.test.ts`（新規）:
  ログエントリを生んではいけない DiffEvent の組み合わせを固定。node/workbench
  の entityUpdated（resource/sync 更新）、receivedAt 以外のみを触る block
  update、block/transaction/wallet の entityRemoved、未知 id の削除が
  いずれも 0 件になることを確認（誤分類・過剰記録の防止）。
- `comms-log/blockReceiptDedup.test.ts`（追記）:
  空の receivedAt マップ、drivesNodeId の指す相手がこの block に受信キーを
  持たない場合（beacon をエイリアスではなく実受信として残す）の2境界を追加。
- `comms-log/useCommsLog.retention.test.tsx`（新規）:
  リングバッファ境界。上限ちょうどで1件も落ちないこと、1回の observeDiff で
  上限超えのバッチを流したときの切り詰め、空バッチが無害なこと、カテゴリ
  フィルタで表示を絞っても蓄積・上限切り詰めは継続すること（フィルタを戻すと
  上限ぶんが一気に見える）を確認。
- `side-panel/SidePanelHost.kindSwitch.test.tsx`（新規）:
  複数 kind をまたぐパネル遷移。contractSource ⇄ commsLog の排他置換、
  ダングリングで閉じた contractSource の直後に commsLog を開いても即閉じ
  しないこと、commsLog 表示中に contract カタログが空へ変わっても閉じない
  ことを確認（contractSource 専用ダングリングガードの他 kind への非漏洩）。
- `comms-log/commsLogText.p2pWording.test.ts`（新規）:
  設計不変条件（§3・§5.6）の固定。ブロック伝播は受信ノード単体を主体とし、
  文言に送信方向の矢印（→）を含まず受信の語（受信 / receive）を使うこと、
  peer は双方向記号（⇄）で方向を断定しないことを ja/en 両方で確認。

#### 気づいた点（実装変更はしていない）

- 依頼では「3 kind（contractSource / glossary / commsLog）」のダングリング
  ガード相互作用の確認を挙げられていたが、このブランチの `SidePanelView` は
  contractSource / commsLog の2 kind。用語集（glossary）はサイドパネルの
  kind ではなくインラインの `GlossaryTerm` アンカーで表現されており、パネル
  kind としては存在しない。そのため kind をまたぐ相互作用テストの対象は
  上記2種にした（glossary が将来パネル kind 化される場合は同種の遷移テストを
  足すこと）。実装上の不具合ではなく、依頼時の前提と実装の差分の共有。

#### 確認したこと

- `pnpm --filter @chainviz/frontend build`（tsc -b）が通ることを確認。
- `pnpm --filter @chainviz/frontend test`（vitest）が 185 ファイル・2444 件
  すべて通ることを確認（追加前 2415 件 → 2444 件）。
- 追加した回帰テスト（sameBatch）が、意図的に `running` 参照を
  `prevState` へ戻した壊れた実装で実際に失敗することを確認してから元に
  戻した。
- lint（`eslint`）は追加ファイルについてクリーン。
