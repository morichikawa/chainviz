# Issue #322 作業記録

### 2026-07-16 Issue #322 slot time を現実の Ethereum 値(12秒)に戻す設計(designer)

- 担当: designer
- ブランチ: issue-322-slot-time-and-indicator
- 内容: slot time を 2 秒 → 12 秒へ戻す変更の設計と、影響範囲(genesis 再生成・
  Issue #286 の閾値・E2E テストの待ち時間前提・collector の固定値前提)の
  全面調査を行った。あわせて Issue の分割判断を行った。

## 1. Issue の分割判断: 分割する(インジケータは #343 へ)

本 Issue は「slot time 変更(node-env + E2E 追従)」と「ブロック生成タイミング
のインジケータ(frontend)」の 2 つを含むが、**分割する**。新規 Issue #343
(frontend ラベル)を起票済みで、設計メモは `docs/worklog/issue-343.md` に置いた。

分割の理由:

- **データフロー上の依存が無い**。インジケータは既にフロントへ届いている
  `BlockEntity.timestamp` からブロック生成間隔を導出する設計(#343 参照)に
  したため、slot time が 2 秒でも 12 秒でも動く。shared の型変更も無く、
  互いの実装を待つ必要が一切ない
- 担当パッケージ・レビュー/QA の観点が完全に異なる(こちらは Docker
  プロファイル + テスト基盤、あちらは純粋なフロント表示物)。1 PR に
  まとめるとレビュー範囲が不必要に広がる
- CLAUDE.md の Issue 粒度の方針(担当パッケージに応じたラベル付け・
  1 Issue 1 ブランチ)とも整合する

順序の推奨: **#322(本 Issue)を先にマージし、#343 はその後に着手する**。
理由はインジケータの動作確認・E2E を現実の 12 秒周期で行うため(依存では
なく検証都合)。

本 Issue(#322)に残るスコープ: `profiles/ethereum/values.env` の変更・
プロファイル README 更新(node-env)+ `packages/e2e` の待ち時間前提の追従 +
`packages/collector` の前提コメント更新(§5。ロジック変更なし)。

## 2. slot time 変更(node-env)

`profiles/ethereum/values.env` の 3 変数を 12 秒相当へ変更する:

```
SLOT_DURATION_IN_SECONDS="12"
SLOT_DURATION_MS="12000"
SECONDS_PER_ETH1_BLOCK="12"
```

- 同ファイルの「slot time の短縮(1〜2 秒程度)」というコメントブロックも
  書き換える(現実の mainnet と同じ 12 秒にする決定と、その理由 =
  学習アプリとして非現実的な周期が誤解を招くため、を明記する)
- `GENESIS_DELAY="20"` は変更しない(genesis 生成完了〜全ノード起動までの
  猶予であり、slot time とは独立)
- `NUMBER_OF_VALIDATORS` / フォークスケジュール等も変更しない
- エポック構成は本番と同じ 1 エポック = 32 スロットのまま。slot 12 秒では
  1 エポック = 384 秒(6.4 分)、finality には 2 エポック強(約 13 分)かかる
  ようになるが、**chainviz は finality に依存する観測・テストを持たない**
  (collector / e2e を全文検索して確認済み)ため影響しない
- `profiles/ethereum/README.md` の「slot time は 2 秒。ブロックは約 2 秒ごと
  に進む」の記述を 12 秒へ更新し、下記 §3 の「既存ボリュームへの反映には
  down -v が必要」も追記する

## 3. genesis 再生成の要否: 必要(既存環境では down -v を 1 回)

- slot time は CL 用 `config.yaml`(SECONDS_PER_SLOT)と genesis 生成物に
  焼き込まれるため、**genesis の再生成が必要**
- `generate-genesis.sh` の再生成判定(Issue #148/#286)は完了マーカーと
  genesis 年齢・生存サンプリングだけを見ており、**values.env の内容変化を
  検知しない**。したがって稼働中(または genesis が若い)既存スタックでは、
  values.env を変えても古い 2 秒 genesis が再利用され続ける
- 対応方針: 設定ファイル変更の検知機構(values.env のハッシュ比較等)は
  **今回は作らない**。値の変更はまれで、機構追加は #286 で固めた判定
  ロジックの複雑化に見合わない。かわりに「values.env を変更したら
  `docker compose down -v` で共有ボリュームごと作り直す」ことを
  プロファイル README に明記し、本変更のマージ後は各開発環境で 1 回
  `down -v` が必要である旨を PR 本文にも書く(QA も freshStart で検証する)

## 4. Issue #286(genesis 年齢判定)への影響: 閾値変更なし

`GENESIS_MAX_REBUILD_GAP_SEC`(既定 600 秒)・`GENESIS_LIVE_THRESHOLD_SEC`
(60 秒)・生存サンプリング窓(2 × `HEARTBEAT_INTERVAL_SEC`)はいずれも
**実時間(秒)ベース**の判定で、slot time には依存しない。影響を確認した:

- 600 秒 = 2 秒 slot で 300 slot だったものが、12 秒 slot では **50 slot** に
  なる。再起動時に slot 0 から再構築すべき量はむしろ 1/6 に減り、#139 で
  実測したハング点(約 3,200 slot)からさらに遠ざかる。**安全側にしか
  動かないため閾値は変更しない**(600 秒を伸ばす余地は生まれるが、
  「再生成までに許容する停止時間」という利用者体験上の意味も持つ値なので
  据え置く)
- ハートビート間隔・poison マーカー経路は slot time と無関係で影響なし
- `generate-genesis.sh` 内に slot time 依存の固定値は無いことを確認した

## 5. collector / frontend の固定値前提の確認(コメント更新のみ)

「slot time を大きく変える場合は見直すこと」と自ら注記している固定値を
全て洗い出した。**いずれもロジック変更は不要**で、前提コメントの更新のみ行う:

| 場所 | 値 | 12 秒での判断 |
| --- | --- | --- |
| `collector/src/adapters/ethereum/sync-status.ts` `SYNCED_TOLERANCE_BLOCKS` | 5 | スクレイプ間隔(3 秒)あたりに進むブロック数が減るため、並行スクレイプのジッターで生じる高さ差はむしろ縮む。5 のままで安全側。コメントの「2 秒 slot」前提を 12 秒へ更新 |
| `collector/src/adapters/ethereum/reth-metrics-tracker.ts` `NODE_INTERNALS_POLL_INTERVAL_MS` | 3000 | 増分ベースの観測なので値は据え置き。12 秒 slot では増分ゼロのスクレイプが挟まり、活動パルスが slot ごと(約 12 秒間隔)になるが、これは実際の Engine API 呼び出し頻度を正しく反映した挙動。コメント更新 |
| `collector` の各ポーリング間隔(A層 3 秒・peers・wallets 等) | 3000 | slot time 非依存(インフラ・残高の観測周期)。変更なし |
| `collector/src/world-state` `BLOCK_RETENTION` | 32 | 「リボン表示件数(8)以上」という前提はそのまま成立。時間換算の保持窓が 64 秒→384 秒に伸びるだけ。変更なし |
| `frontend/src/entities/chainRibbon.ts` `RIBBON_TILE_COUNT` | 8 | 8 タイル分の履歴が 10 秒強→96 秒に伸びる(体験としてはむしろ余裕が増える)。値は据え置き、コメントの「slot 1〜2 秒」前提の更新は **#343 側で行う**(frontend を触るのはあちらのため) |
| `frontend` の `GHOST_TIMEOUT_MS` / `blockPulse.ts` の鮮度ガード | 60s / 受信時刻基準 | いずれも A層観測・receivedAt 基準で slot time 非依存。変更なし |

collector 側の addNode(node-lifecycle)にはブロック追従を待つ処理自体が
無い(コンテナ作成後すぐ返る)ことも確認した。

## 6. E2E テスト(packages/e2e)への影響: 全面調査の結果

slot time 依存の待ち・前提を全ファイルで洗い出した。結論:
**修正必須 2 箇所(放置すると不安定化・実害あり)+ 定数追従 3 箇所 +
コメント更新 2 箇所**。それ以外(接続・A層・コマンド・異常系・再接続系)は
slot time 非依存で変更不要。

### 6.1 修正必須

1. **`helpers/docker.ts` `chainIsProgressing()`**: 2 回の観測の間隔が固定
   `sleep(6_000)`。12 秒 slot では 6 秒窓がブロック境界をまたぐ確率が約 5 割
   になり、健全なスタックを「進行していない」と誤判定して不要な `up -d` を
   打つ・readiness 待ちが余分に伸びる。観測窓を slot time から導出する
   (例: slot 秒 × 1.5 = 18 秒。1 窓に必ず 1 境界が入る)よう変更する
2. **`ui/node-internals.spec.ts` `SECOND_PULSE_TIMEOUT_MS`**(現
   `NODE_INTERNALS_POLL_INTERVAL_MS × 5` = 15 秒): 活動パルスの発生源
   (Engine API 呼び出し)は slot ごとに起きるため、12 秒 slot では
   「slot 12 秒 + スクレイプ最大 3 秒 + WS/描画」で 15 秒を普通に超え、
   **確実に flaky 化する**。「slot ミリ秒 + スクレイプ間隔 × 2 + 余裕」以上
   (目安 30 秒)へ導出式ごと見直す。`FIRST_PULSE_TIMEOUT_MS`(60 秒)は
   据え置きで足りる。テスト全体の `test.setTimeout` は既に定数から導出
   されているので自動で追従する

### 6.2 定数の追従(既存コメントが「slot を変えたら見直せ」と指示済み)

3. **`ui/p2p-graph.spec.ts` / `ui/chain-ribbon.spec.ts` の
   `SLOT_DURATION_SECONDS = 2`**(2 ファイルに重複定義): 12 へ。倍率 15 は
   既存コメントの指示どおり維持(待ち上限 30 秒 → 180 秒。実際の待ちは
   1〜2 slot で決着するので所要時間の伸びは小さい)。あわせて重複定義を
   解消し、**`helpers/` に slot time の単一の出所を新設**する(§6.4)
4. **`ui/support/operations.ts` `OPERATION_EFFECT_TIMEOUT_MS`**(現 30 秒、
   コメントで `SLOT_DURATION_IN_SECONDS=2` を前提と明記): cast/forge は
   receipt を待つため、tx 取り込みに最大約 1 slot(12 秒)+ 配信オーバー
   ヘッドがかかるようになる。30 秒でも通る見込みだが余裕が薄い。
   「slot ミリ秒 × 2 + 30 秒(従来の実績オーバーヘッド)」= 54 秒程度へ
   導出式で引き上げる。これを参照する `test.setTimeout`
   (token-balance ×2、chain-ribbon ×3、contract-lifecycle +30s)は
   定数からの導出なので自動で追従する
5. **`a-b-layer.test.ts`** の 90 秒待ち(receivedAt 分散を持つブロックの
   出現): 機会が 45 ブロック→7 ブロックに減る。原理上は毎ブロック満たす
   ため通る見込みだが、余裕確保のため slot 由来の導出(例: slot × 10)へ
   置き換えることを推奨

### 6.3 コメント更新のみ

6. **`commands.test.ts` `MIN_PROGRESS_BLOCKS = 300`**: 追従待ちは
   バックフィル速度(実測 9〜10 ブロック/秒。EL P2P の同期速度であり
   slot time 非依存)基準の動的タイムアウト + 停滞検出(45 秒)で構成されて
   おり、**構造は 12 秒 slot でもそのまま成立する**。ただし「チェーンが
   300 ブロック育つのに要する時間」が 10 分→60 分になり、若いスタックでは
   目標が head 到達へフォールバックする頻度が上がる(検出力は停滞検出が
   担っているため回帰検出には影響しない、と既存コメント自身が明記)。
   前提コメントの時間換算を更新する
7. **`helpers/catch-up.ts`**: 冒頭コメントの前提説明に slot time 非依存で
   ある旨は変更不要だが、実測値記述に触れる場合のみ追従

### 6.4 slot time の単一の出所(重複定義の解消)

現状 `SLOT_DURATION_SECONDS = 2` が 2 つの spec に重複しており、今回
`docker.ts` / `operations.ts` / `node-internals.spec.ts` も参照するように
なる。値の分散を避けるため、**`helpers/` に新モジュール(1 ファイル 1 責務。
例 `helpers/slot-duration.ts`)を作り、`profiles/ethereum/values.env` の
`SLOT_DURATION_IN_SECONDS` を読み取って公開する**(「データとコードの分離」
の原則どおり、値の出所を values.env の 1 箇所にする)。読めない・数値で
ない場合は黙ってフォールバックせず throw する(静かな食い違いを作らない)。
稼働中スタックの genesis が values.env より古い(§3 の未反映状態)場合は
テスト前提とずれるが、これは §3 の「変更後は down -v」の運用で解消する。

### 6.5 実行時間への影響見込み

待ちはすべてイベント駆動(条件成立で即抜ける)ため、タイムアウト上限の
拡大 ≠ 所要時間の増加。実際に伸びるのは (a) readiness 観測窓 +12 秒程度、
(b) tx を伴う操作 1 回あたり平均 +5〜8 秒(取り込み待ちが平均 1 秒→6 秒)、
(c) ブロック出現待ちの期待値 +5 秒程度 × 数箇所。プロトコル層 + UI 層の
合計で **+2〜5 分程度**と見積もる(コールドスタート時の genesis 生成・
ノード起動は slot time 非依存で不変)。壊滅的な伸びにはならない。実測値は
QA で確認し、`docs/ARCHITECTURE.md` §8.6 の実測値を更新すること。

## 7. 開発時のみ slot を短縮するオプション: 設けない

- 2 値の作り分け(環境変数での切り替え・プリセット複数化)は、genesis
  再生成の要否判定・E2E の待ち時間導出・ドキュメントの全てに分岐を持ち込み、
  「値の食い違いが静かに壊す」リスク(まさに今回洗い出した固定値前提の
  問題)を常設化するため**採用しない**
- values.env は設定データファイルなので、開発者が一時的に書き換えて
  `down -v` すれば従来の 2 秒動作は再現できる。E2E の待ち時間も §6.4 の
  仕組みにより values.env から自動で追従する。この手順を README に一言
  記載すれば十分
- ユーザーのフィードバック(2 秒は混乱を招く)を踏まえると、既定値は
  「現実と同じ 12 秒」一本であるべき

## 8. 変更ファイルと担当分担

依存順序: (1) と (2) は独立して並行可能。ただし同一ブランチ
(`issue-322-slot-time-and-indicator`)上で行い、1 PR にまとめる。

1. **node-env 担当**:
   - `profiles/ethereum/values.env` — 3 変数の変更 + コメント更新(§2)
   - `profiles/ethereum/README.md` — slot time の記述更新 +
     「values.env 変更後は down -v」の追記(§3)
2. **TypeScript 側(統括の割り振り。テスト基盤の調整が中心のため
   chainviz-tester を推奨)**:
   - `packages/e2e/src/helpers/`(新規 slot-duration モジュール +
     docker.ts)— §6.1-1 / §6.4
   - `packages/e2e/src/ui/node-internals.spec.ts` — §6.1-2
   - `packages/e2e/src/ui/p2p-graph.spec.ts` /
     `ui/chain-ribbon.spec.ts` / `ui/support/operations.ts` /
     `a-b-layer.test.ts` — §6.2
   - `packages/e2e/src/commands.test.ts` — コメント更新(§6.3)
   - `packages/collector/src/adapters/ethereum/sync-status.ts` /
     `reth-metrics-tracker.ts` — 前提コメント更新のみ(§5)
   - 新モジュール(slot-duration)にはユニットテスト
     (`*.unit.test.ts`。Docker 非依存)を付ける
3. designer(本記録) — `docs/ARCHITECTURE.md` §7/§8.6 の「2 秒」前提
   記述の更新・`docs/CONCEPT.md` の決定事項改訂(このブランチで実施済み)

コミットは関心事ごとに分ける: (a) values.env + README、(b) e2e の
slot-duration 出所新設 + 待ち時間追従、(c) collector のコメント更新、
(d) docs。

## 9. 検証計画(実装担当・QA 向け)

- `docker compose down -v` → `up -d` で genesis を作り直し、
  `eth_blockNumber` が**約 12 秒ごと**に +1 されることを実測する
- 稼働中スタックへの `up -d` 再実行(#56/#286 の回帰): genesis 再利用・
  ブロック進行が途切れないこと
- `pnpm test:e2e`(プロトコル層)と `pnpm test:e2e:ui`(UI 層)を 12 秒
  genesis のスタックに対して全件実行し、全通過と所要時間を記録する
  (§6.5 の見積もりとの突き合わせ。`docs/ARCHITECTURE.md` §8.6 の実測値
  更新までやる)
- 特に `node-internals.spec.ts`(§6.1-2)は修正前の定数のままだと 12 秒
  slot で失敗することを一度確認してから修正する(「直したはず」で
  済ませない)
- collector を起動し、ノードカードの syncStatus が全ノード synced に
  なること(§5 の SYNCED_TOLERANCE_BLOCKS 据え置きの妥当性確認)、
  D層の活動パルスが約 12 秒周期で出ること
- 仕上げに `pnpm lint && pnpm build && pnpm test`

## 10. 決定済み事項(実装担当が前提にしてよいこと)

- slot time は 12 秒一本。開発用の短縮プリセットは設けない(§7)
- values.env 変更の自動検知(ハッシュ比較等)は作らない。README への
  手順明記で対応(§3)
- #286 の閾値(`GENESIS_MAX_REBUILD_GAP_SEC` 等)は変更しない(§4)
- collector のポーリング間隔・保持窓・許容閾値はロジック変更なし、
  前提コメントの更新のみ(§5)
- e2e の slot time は values.env から読み取る単一の出所に集約する(§6.4)
- インジケータは #343(別 Issue・別ブランチ)。本 PR には含めない

## 11. 実装時に判断してよいこと(設計では固定しない)

- slot-duration モジュールのファイル名・パース実装(同期 readFileSync +
  正規表現で足りる)・エクスポート形(秒/ミリ秒のどちらを主にするか)
- 各タイムアウト導出式の細部(§6 に示した下限・目安を満たす範囲で)
- `a-b-layer.test.ts` の 90 秒を導出式に置き換えるか据え置くか(§6.2-5)
- README の文言・構成

### 2026-07-16 Issue #322 slot time を 12 秒に戻す変更に伴う E2E テスト・collector コメントの追従(TypeScript 側)

- 担当: tester
- ブランチ: issue-322-slot-time-and-indicator-e2e
- 位置づけ: Issue #322 のうち node-env 側(`profiles/ethereum/values.env` の
  slot time を 2 秒 → 12 秒へ戻す・genesis 再生成)は別ブランチ
  `issue-322-slot-time-and-indicator` で並行実装。本ブランチは TypeScript 側
  (`packages/e2e` の待ち時間・タイムアウトの追従、`packages/collector` の
  コメント更新)に専念する。後で統括が cherry-pick で合流させる。

#### 設計メモ(着手前の判断)

- slot time を 2 秒前提で決め打ちしている待ち時間・タイムアウトが
  `packages/e2e` に複数あり、`SLOT_DURATION_SECONDS = 2` の重複定義も 2 箇所
  (`p2p-graph.spec.ts` / `chain-ribbon.spec.ts`)にあった。CLAUDE.md の
  「今この瞬間に観測できる状態に依存した固定値をロジックに埋め込まない」
  原則に沿って、slot time の出所を `profiles/ethereum/values.env` の
  `SLOT_DURATION_IN_SECONDS` に一元化し、各テストはそこから導出した
  `SLOT_DURATION_MS` を基に自分のタイムアウトを計算する構成にする。
- 値の性質で 2 系統に分ける:
  - slot 由来(tx のブロック取り込み・ブロック生成イベント): slot 時間に
    比例させる。
  - ポーリング由来(A/C 層の 3 秒ポーリングで解決するカード出現など): slot
    時間に依存しないので据え置く。

#### 実施内容(packages/e2e)

- `helpers/slot-time.ts`(新規): `values.env` を読み `SLOT_DURATION_IN_SECONDS`
  をパースして `SLOT_DURATION_SECONDS` / `SLOT_DURATION_MS` を export する
  単一の出所。パース純関数 `parseSlotDurationSeconds` は
  `adapters/ethereum/mnemonic.ts` の流儀に合わせ、クォート有無いずれの記法にも
  対応。読めない・値が無い・0 以下のときは import 時に throw する(誤った
  既定値へ静かにフォールバックすると全タイムアウトが実チェーンとずれて flaky
  になるため、値が確定できないときは明示的に失敗させる)。
- `helpers/slot-time.unit.test.ts`(新規): パース純関数の境界値・異常系
  (クォート有無、複数行・他キー混在、インデント、キー欠落、空文字列、
  非数値、0・負値、`SLOT_DURATION_MS` のような接頭辞一致の別キーに反応しない
  こと、小数)を 13 ケースで検証。
- `helpers/paths.ts`: `valuesEnvFile` を追加。
- `helpers/docker.ts`: チェーン進行観測窓の固定 `sleep(6_000)` を
  `SLOT_DURATION_MS * 2`(`PROGRESS_OBSERVATION_MS`)に変更。ブロックは slot
  ごとに 1 つなので、観測窓が 1 slot 以下だと slot 境界をまたがず「増えて
  いない」と誤判定しうる(固定 6 秒だと 12 秒 slot で約半分の確率で誤判定)。
  位相ずれ・遅延 slot への余裕を見て 2 slot 分待つ。
- `ui/p2p-graph.spec.ts` / `ui/chain-ribbon.spec.ts`: 重複していた
  `SLOT_DURATION_SECONDS = 2` を削除し `SLOT_DURATION_MS` を import。ブロック
  伝播パルス・チェーンリボンタイルの待ち上限を「次スロットまでの slot 比例分
  ＋コールドスタート等の固定オーバーヘッド」= `SLOT_DURATION_MS * 3 + 20_000`
  に変更(slot=2 秒で約 26 秒、12 秒で約 56 秒)。従来の「slot 秒 × 15 倍」は
  12 秒 slot で 180 秒となり Playwright のテスト単位タイムアウトを超えるため
  採らない。chain-ribbon の「表示窓(直近 8 タイル ≒ 16 秒)」コメントも
  slot time 依存である旨に更新。
- `ui/node-internals.spec.ts`: 15 秒固定だった 2 回目以降のパルス出現待ち
  `SECOND_PULSE_TIMEOUT_MS`(旧 `NODE_INTERNALS_POLL_INTERVAL_MS * 5`)を
  `SLOT_DURATION_MS + NODE_INTERNALS_POLL_INTERVAL_MS * 3` に変更。slot 時間が
  スクレイプ間隔(3 秒)より長くなると、Engine API 呼び出しの増分(=パルス)は
  毎スクレイプではなく slot ごと(最大 1 slot 間隔)にしか出ない。次パルスまでの
  worst case は「1 slot(12s) + スクレイプ位相ずれ(3s) = 15s」で、旧固定値 15 秒
  だと余裕ゼロで flaky。新値は 12 秒 slot で 21 秒となり 6 秒の余裕を確保。
  UI-D-02 の `test.setTimeout` はこの定数から算出されるため自動追従する。
- `ui/support/operations.ts`: `OPERATION_EFFECT_TIMEOUT_MS` を
  `Math.max(30_000, SLOT_DURATION_MS * 2 + 20_000)` に変更(`cast`/`forge` は
  receipt を待つため tx 取り込み = slot 依存。最大 2 slot 分を比例させ、WS 配信
  等の固定オーバーヘッドを加算。ポーリング由来の 30 秒実績値を下限に据えて
  slot を短くしても割り込まないようにする。slot=2 秒で 30 秒、12 秒で 44 秒)。
- `playwright.config.ts`: テスト単位の既定タイムアウトを
  `Math.max(60_000, SLOT_DURATION_MS * 6 + 30_000)` に変更(操作系テストは tx
  取り込み待ちが支配的で slot 依存。slot=2 秒で 60 秒、12 秒で約 102 秒)。
  多段操作のテストは従来どおり各 `test.setTimeout` で更に緩める。
- `d-layer.test.ts`: コメントの前提(「1 ポーリング間隔に必ず 1 回以上の
  Engine 呼び出しが乗る」)を更新。12 秒 slot ではスクレイプ間隔より slot が
  長いため、増分は数回に 1 回のスクレイプでまとまって観測される。ここで待つ
  のは「初回反映」であり、待ち上限 60 秒の中で複数 slot 分が経過するため十分
  間に合う(値自体は変更なし)。

#### 実施内容(packages/collector、コメントのみ・ロジック変更なし)

- `adapters/ethereum/reth-metrics-tracker.ts`: `NODE_INTERNALS_POLL_INTERVAL_MS`
  の前提コメントを更新。slot time(12 秒)がスクレイプ間隔(3 秒)より長いため
  1 スクレイプ間隔に必ずしも Engine 呼び出しが乗らず、数回に 1 回のスクレイプで
  slot 分の増分をまとめて観測する(差分ベースなので増分ゼロのスクレイプが
  混じっても正しく動く)。逆に slot を大幅に短くする場合は取りこぼし防止に
  見直しが必要、という向きに書き換え。
- `adapters/ethereum/sync-status.ts`: `SYNCED_TOLERANCE_BLOCKS` の前提コメントを
  更新。slot time が長いほど単位時間あたりのブロック生成が減り、並行スクレイプ
  のタイミングずれで生じるブロック差はむしろ小さくなるため、5 ブロックの許容量
  はより安全側に働く。逆に slot を大幅に短くする場合は見直しが必要、という
  向きに書き換え。

#### 検証

- `pnpm --filter @chainviz/e2e build`(tsc --noEmit)通過。
- `pnpm --filter @chainviz/collector build` 通過。
- `pnpm --filter @chainviz/e2e test`(vitest ユニット)171 件通過(新規
  `slot-time.unit.test.ts` の 13 件含む)。
- `pnpm --filter @chainviz/collector test` 1458 件通過。
- 実 Docker が必要な UI 層 E2E(`playwright test`)はこの場では実行せず、
  導出タイムアウトの値と worst case の関係を数値で確認した。特に
  `SECOND_PULSE_TIMEOUT_MS` は 12 秒 slot で 21000ms > worst case 15000ms
  (旧固定値 15000ms は worst case と同値で余裕ゼロ = 元の flaky の原因)で、
  6 秒の余裕を確保できることを確認。

#### 注意点・申し送り

- 本ブランチの `values.env` はまだ slot time = 2 秒のまま(node-env 側の変更は
  別ブランチ)。そのため本ブランチ単体でビルド/ユニットテストを走らせると
  `SLOT_DURATION_MS` は 2000 になる。ロジックは値の出所を values.env に一元化
  しているため、統括が node-env 側(12 秒)を cherry-pick で合流させた時点で
  自動的に 12 秒基準のタイムアウトに切り替わる。
- catch-up 系(`commands.test.ts` の `MIN_PROGRESS_BLOCKS` / `catch-up.ts` の
  動的タイムアウト)は追加ノードの履歴バックフィル速度(slot 非依存、実測
  9〜10 ブロック/秒)に基づくため、slot time を変えても影響しないと判断し
  変更していない。12 秒 slot ではチェーンの head 成長が遅くなるが、
  `resolveCatchUpTarget` が head 未達分を head 到達にフォールバックするため
  既存ロジックのまま成立する。

### 2026-07-16 Issue #322 node-env 側実装(slot time 12秒化)

- 担当: node-env
- ブランチ: issue-322-slot-time-and-indicator
- 内容: 設計メモ §2/§3/§4/§8 に従い、`profiles/ethereum/` 側を実装した。

1. **`profiles/ethereum/values.env`**: `SLOT_DURATION_IN_SECONDS` /
   `SLOT_DURATION_MS` / `SECONDS_PER_ETH1_BLOCK` を `2`/`2000`/`2` から
   `12`/`12000`/`12` へ変更した。コメントブロックも「slot time の短縮」から
   「mainnet と同じ 12 秒」へ書き換え、値を変更した場合は既存環境で
   `docker compose down -v` が必要になる旨を明記した。
2. **`profiles/ethereum/README.md`**: 冒頭の構成説明の「slot time は 2 秒」を
   「12 秒(mainnet と同じ)」へ更新。加えて「使い方」節に
   「`values.env` を変更したとき(genesis の作り直しが必要)」という小節を
   新設し、`generate-genesis.sh` の再生成判定が `values.env` の内容変化を
   検知しないため `down -v` が必要になる理由を説明した(設計メモ §3 で
   決定済みの、値変更検知機構を作らない代わりの対応)。
3. **Issue #286 の閾値確認**: `scripts/generate-genesis.sh` の
   `MAX_REBUILD_GAP_SEC="${GENESIS_MAX_REBUILD_GAP_SEC:-600}"`(既定 600 秒)
   と `docker-compose.yml` の同名環境変数の既定値(600)を実際に確認した。
   これは実時間(秒)ベースの判定であり `SLOT_DURATION_IN_SECONDS` を
   一切参照していないコードであることをソースで確認した。600 秒は
   2 秒 slot では 300 slot 分、12 秒 slot では 50 slot 分に相当し、
   再構築すべき slot 数はむしろ減るため安全側であるという設計メモの
   判断は正しいと確認できた。閾値そのものは変更していない。
   あわせて、同ファイル内のコメントが「既定 600秒 = 300 slot分」と
   2 秒 slot 前提の値を固定で書いており、今回の変更で実態と食い違う
   ため(値自体は変えていないが記述が古くなるため)、コメントを
   「slot 数換算は values.env の設定次第で変わる」旨に更新した
   (別コミット。ロジック変更ではない)。
4. **`docs/PLAN.md`**: 該当のバックログ項目(#322 の行)にチェックを付け、
   ブロック生成タイミングのインジケータ(#343)を別行に分離した
   (設計メモの Issue 分割判断に対応)。

#### 動作確認

既存のワークツリーに 2 秒 genesis の稼働中スタックが残っていたため、
`docker compose down -v` → `docker compose up -d` で作り直して検証した。

- `beacon1` の生成済み `config.yaml` を確認し、`SECONDS_PER_SLOT: 12` に
  なっていることを確認した。
- `beacon1` のログで実際のブロック提案時刻を追跡し、slot 11→12→13 が
  08:07:17 → 08:07:29 → 08:07:41 と、正確に 12 秒間隔で進んでいることを
  実測確認した(`eth_blockNumber` のポーリングでも同様に約 12 秒ごとの
  増分を確認済み)。
- `docker compose exec workbench sh -c 'cast chain-id --rpc-url
  http://reth1:8545 && cast block-number --rpc-url http://reth1:8545'` で
  ワークベンチから reth1 への RPC 疎通を確認した(chain-id: 1337、
  block-number が進行していることを確認)。ロギングプロキシ
  (`host.docker.internal:4001`)経由の疎通は collector プロセスが
  この検証環境で起動していなかったため未確認だが、これは本 Issue の
  変更(slot time のみ)による影響を受けない既存の疎通経路であり、
  設計メモのスコープにも含まれない。

#### 次の担当への申し送り

- TypeScript 側(`packages/e2e`・`packages/collector` のコメント更新)は
  並行して同一ブランチで別エージェントが作業中。コンフリクトは発生して
  いない(担当ファイルが重複しないため)。
- 本コミット群のあと `chainviz-tester` は経由せず(Docker/インフラ設定が
  中心のため)、`chainviz-reviewer` → `chainviz-qa` の順でレビューを
  依頼すること。
- 検証で使ったワークツリーの Docker スタックは 12 秒 genesis のまま
  起動を継続している(次のレビュー/QA でそのまま使い回せる)。

### 2026-07-16 Issue #322 レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-322-slot-time-and-indicator-e2e
- 判定: **差し戻し(実装内容は合格品質。cherry-pick 合流時の docs コミット漏れが原因)**

#### 合格と確認した項目

- `profiles/ethereum/values.env`: `SLOT_DURATION_IN_SECONDS`/`SLOT_DURATION_MS`/
  `SECONDS_PER_ETH1_BLOCK` が `12`/`12000`/`12`。コメントも「mainnet と同じ
  12 秒」+ `down -v` 必要の旨に更新済み。設計メモ §2 と一致
- `packages/e2e/src/helpers/slot-time.ts`: values.env を単一の出所として
  パース。読めない・キー欠落・非数値・0 以下で throw し、静かな
  フォールバック無し。readFileSync の catch も元エラーを含めて再 throw
  しており握りつぶし無し。ユニットテスト 13 件は境界値・異常系
  (クォート記法差・キー欠落・空値・非数値・0/負値・接頭辞一致の別キー・
  小数)を実質的に検証しており質は十分
- 導出タイムアウト: `docker.ts` の観測窓 `SLOT_DURATION_MS * 2`、
  `node-internals.spec.ts` の `SLOT_DURATION_MS + POLL * 3`(worst case
  15 秒に対し 21 秒)、`operations.ts` の `max(30_000, slot*2 + 20_000)`、
  `playwright.config.ts` の `max(60_000, slot*6 + 30_000)`、
  p2p-graph/chain-ribbon の `slot*3 + 20_000` — いずれも worklog の数値
  根拠と実装が一致。`SLOT_DURATION_SECONDS = 2` の重複定義 2 箇所は撤去済み
- collector 側 (`reth-metrics-tracker.ts`/`sync-status.ts`) はコメント差分
  のみでロジック変更が無いことを diff で確認
- Issue #286 閾値: `generate-genesis.sh` の `MAX_REBUILD_GAP_SEC`(既定 600)
  ・`LIVE_THRESHOLD_SEC`(60) は不変。変更はコメントの slot 数換算の記述のみ
- lint / build 全体通過。テスト: collector 1458 件・e2e 171 件・
  frontend 2220 件・shared 64 件、全て通過
- 実機確認(独立再確認): 稼働中スタックの genesis 生成物で
  `SECONDS_PER_SLOT: 12` を確認。`eth_blockNumber` を 3 秒間隔で 39 秒
  サンプリングし、ブロック高が約 12 秒ごとに +1 する挙動を実測
- コミット粒度: values.env+README / e2e 出所新設 / e2e 導出追従 /
  collector コメント / genesis スクリプトコメント / worklog がそれぞれ
  別コミットで、設計メモ §8 の分割方針どおり

#### 差し戻し理由(cherry-pick 合流時のコミット漏れ。統括の作業)

元ブランチ `issue-322-slot-time-and-indicator` の 7 コミットのうち、
docs 系 3 コミットが本ブランチへ合流されていない:

1. **`e34c420`(ARCHITECTURE.md の 12 秒更新)が未取り込み**: 本ブランチの
   `docs/ARCHITECTURE.md` は「slot ごと(約 2 秒)」「slot time 2 秒の環境
   では」「slot 2 秒 × スクレイプ 3 秒」等の旧記述のまま(1243 行・1309 行・
   1573 行・1581 行付近)。このままマージすると docs と実装が齟齬を起こす
2. **`7acad0b`(CONCEPT.md の決定事項改訂)が未取り込み**: 「slot time を
   短く(1〜2 秒程度)設定」という旧決定の記述が残っている(457 行・550 行
   付近)
3. **`90d73bf`(設計メモ)が未取り込みで、`docs/worklog/issue-322.md` が
   破損**: 本ファイルは設計メモの見出し・§1(Issue 分割判断)・§2 冒頭の
   約 115 行が欠落し、tester の記録の直後に設計メモ §2 途中のコードブロック
   から唐突に始まる断片(§2 後半〜§11)が続く不整合な状態。原因はコミット
   `6e0d5f1`(node-env worklog の cherry-pick)のコンフリクト解消時に設計
   メモの断片だけが混入したこと。あわせて `docs/worklog/issue-343.md`
   (分割先の設計メモ)と WORKLOG.md の対応する索引行も本ブランチに存在しない

対応方法(統括向け): `e34c420`・`7acad0b` を cherry-pick し、
`issue-322.md` は「見出し + 設計メモ全文(90d73bf の内容)+ tester 記録 +
node-env 記録(+ 本レビュー記録)」の時系列順に再構成する。
`issue-343.md` と WORKLOG.md 索引行は
`git checkout issue-322-slot-time-and-indicator -- docs/worklog/issue-343.md`
等で持ち込み、docs コミットとして積み直す。

#### 軽微な指摘(差し戻し理由ではない)

- マージコミット `bdc6b43` に PLAN.md のチェックボックス更新という内容
  変更が同居している(「1 変更 1 コミット」の観点では、元ブランチの
  `04569d4` を取り込むか別コミットに分けるのが望ましかった)。履歴修正
  までは求めないが、上記 docs 積み直しの際に整理できるなら整理を推奨

### 2026-07-16 Issue #322 docs 再構成(統括)

- 担当: 統括
- 内容: レビュー差し戻しの指摘どおり、以下を対応した。
  - `e34c420`(ARCHITECTURE.md の 12 秒更新)・`7acad0b`(CONCEPT.md の
    決定事項改訂)を cherry-pick で取り込み
  - 本ファイル(`docs/worklog/issue-322.md`)を、見出し + 設計メモ全文
    (§1〜§11)+ tester 記録 + node-env 記録 + レビュー記録、の正しい
    時系列順に再構成(前回の cherry-pick 時にコンフリクト解消を誤り、
    設計メモの前半約 115 行が欠落し tester 記録の直後に §2 途中から
    始まる断片が混入していたため)
  - `docs/worklog/issue-343.md` と `docs/WORKLOG.md` の索引行を元ブランチ
    (`issue-322-slot-time-and-indicator`)から cherry-pick で取り込み
