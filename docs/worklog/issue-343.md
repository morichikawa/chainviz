# Issue #343 作業記録

### 2026-07-16 Issue #343 ブロック生成タイミングのインジケータ設計(designer)

- 担当: designer
- ブランチ: issue-322-slot-time-and-indicator(設計のみ。実装は #343 用の
  ブランチで行う)
- 内容: 次のブロックが生成されるまでの残り時間・進捗を示すインジケータの
  設計。Issue #322(slot time を 12 秒へ戻す)から分割した frontend 側
  (分割判断は `docs/worklog/issue-322.md` §1)。slot time 12 秒化で伸びる
  待ち時間の体感を補い、「txの有無に関わらず一定間隔でブロックが生成され
  続ける」という PoS Ethereum の本質的な挙動を見せることが目的。

## 1. データフロー: フロント側の導出のみ(shared/collector 変更なし)

**採用**: フロントが既に受信している `BlockEntity.timestamp`(チェーンが
刻むブロック時刻。epoch 秒)の差分から、ブロック生成間隔(interval)と
位相(anchor = 最新ブロックの timestamp)を導出する。チェーンリボン
(Issue #298、ARCHITECTURE.md §10.1)と同じ「新しい観測・新しいスキーマは
増やさない」方針。

- slot ベースのチェーンではブロック timestamp は「genesis 時刻 +
  slot 番号 × slot 間隔」で正確に刻まれるため、観測済みブロックの
  timestamp 差分は必ず間隔の整数倍になる。空 slot(ブロック無し)を
  挟んでも、複数の差分の **GCD(最大公約数)** を取れば真の間隔が得られる
- store のブロック保持窓は 32 件(`BLOCK_RETENTION`)なので、導出の入力は
  最大 32 件 = 差分 31 個。十分な冗長性がある
- 位相が分かれば残り時間は
  `remaining = interval - ((now - anchor) mod interval)` で常時計算できる。
  **新しいブロックが観測されなくてもカウントダウンは周期的に回り続ける**
  (= 「slot は進み続ける」という現実の挙動そのもの。空 slot が起きたら
  カウントダウンが 0 に達してもタイルが増えない、という形で観察できる)

**不採用案**: collector が ChainAdapter 経由で beacon API
(`/eth/v1/config/spec` の SECONDS_PER_SLOT、`/eth/v1/beacon/genesis` の
genesis_time)を取得し、チェーン非依存語彙(例 `blockCadence`)へ正規化して
スナップショットに載せる案。値の正確さでは勝るが、

- 既に届いているブロックから導出できる情報のために、shared スキーマ・
  アダプタ観測・プロトコルの 3 層へ追加を入れることになり、#298 で確立した
  方針と矛盾する
- スナップショットレベルのフィールドは DiffEvent で更新が流せないため、
  接続後に判明した値の反映に別の仕組みが要る(エンティティ化するほどの
  実体でもない)
- 導出方式はブロック時刻が規則的な任意のチェーンでそのまま動き、規則性の
  ないチェーン(PoW 等の確率的な生成)では自然に「導出不成立 → 非表示」に
  落ちる。チェーン固有の観測を増やすより境界(ChainAdapter 境界)にも優しい

ため見送った。将来、導出では困るチェーンプロファイルが現れたときに
再検討する。

## 2. 導出モジュール(純粋関数)の仕様

`packages/frontend/src/entities/blockCadence.ts`(新規。1 ファイル 1 責務)に
純粋関数として切り出し、ユニットテストを付ける。React・タイマーへの接続は
別ファイル(§4)。

入力: store 上の `BlockEntity[]` と現在時刻 `now`(epoch ms)。
出力: `{ intervalMs: number; anchorMs: number } | null`(null = 導出不成立 =
インジケータ非表示)。

導出手順:

1. ブロックを number 昇順に並べ、timestamp(秒)を取り出す。同一 timestamp
   の重複(同一 number のフォークブロック等)は除去する
2. 隣接する timestamp の正の差分列を作る。差分が 1 つも無い(観測ブロックが
   実質 1 件以下)なら null
3. 差分列の GCD を interval(秒)とする。ガードとして、interval が妥当範囲
   (1 秒以上 600 秒以下)を外れたら null(不規則な timestamp を持つ
   チェーン・異常データで無意味なカウントダウンを出さない)
4. anchor = 最新(number 最大)ブロックの timestamp × 1000
5. `anchorMs > now + intervalMs` なら null(ホストとチェーンの時計が大きく
   ずれている場合の防御。ローカル開発ツールでは通常起きない)

残り時間・進捗の計算(表示側が毎 tick 呼ぶ):
`elapsed = (now - anchorMs) mod intervalMs`、`remaining = intervalMs - elapsed`、
進捗率 = `elapsed / intervalMs`。

停滞判定: `now - anchorMs > intervalMs × 3` のときはカウントダウンを止め
「停滞」状態を返す(表示は §3)。倍率 3 の根拠: 1〜2 slot 分の空白は正常
運転でも起こりうる(空 slot・観測遅延)ので許容し、3 slot 連続で新ブロックが
観測されない状態は「ノード停止・接続断など、待っていても次は来ない状況」と
みなす。チェーンの進行状態(稼働時間・ブロック高)に依存しない相対値であり、
CLAUDE.md の固定値ルール上も安全(この根拠をコード上のコメントにも書くこと)。

## 3. 表示場所と見せ方: チェーンリボンカードのヘッダ(チェーン全体で 1 つ)

- **チェーンリボンカード(`ChainRibbonCard.tsx`)のヘッダ右側**に置く。
  ノードカードごとには出さない。理由: ブロック生成(提案)はチェーン全体で
  slot ごとに担当バリデーターが持ち回る**チェーンレベルの現象**であり、
  ノードごとに出すと「各ノードが独立にブロックを作っている」という誤解を
  与える。リボンは「チェーンが刻まれていく様子」の常設表示であり、
  カウントダウンが 0 になった直後に新タイルが着地する、という因果が同一
  カード内で完結する
- 表示要素(初期案): 残り秒数のカウントダウン(例「次のブロックまで 7s」)+
  slot 1 周期を表す小さな進捗表現(バー or 円形)。詳細な見た目・アニメー
  ションは実装時判断(必要なら統括の判断で chainviz-ux を挟む)
- 停滞状態(§2)では、カウントダウンの代わりに停滞を示す文言へ切り替える
- 導出不成立(接続直後でブロックが 1 件以下・不規則チェーン)のときは
  領域ごと出さない(「観測できないものは出さない」の既存の流儀)
- 文言はチェーン非依存の一般語彙で i18n(`{ja, en}`)に置く。初稿:
  - `ribbon.nextBlockCountdown`: ja「次のブロックまで {seconds} 秒」/
    en "Next block in {seconds}s"
  - `ribbon.blockProductionStalled`: ja「ブロック生成が停滞しています」/
    en "Block production stalled"
  - 文言の最終形は実装時に chainviz-i18n のレビューを通す

## 4. React 側の構成

- tick(残り時間の再計算・再描画)は `useRibbonLanding.ts` と同様の分離で、
  新規フック(例 `useBlockCadence.ts`)に閉じる。tick 間隔は表示粒度
  (秒単位)に対して十分な 250ms 程度を目安に実装時判断。導出(§2)は
  ブロック集合が変わったときだけ再計算し、毎 tick は剰余計算のみにする
- モックモード(`websocket/mockData.ts`)は #298 で既に hash/parentHash が
  連なるブロックを定期 tick で流しているため、timestamp を一定間隔で
  刻むようにすれば(なっていなければ修正)インジケータもオフラインで
  確認できる

## 5. テスト

- `blockCadence.ts` のユニットテスト: 等間隔・空 slot 混じり(GCD)・
  フォーク重複 timestamp・1 件以下・不規則間隔(null)・停滞判定・
  時計ずれガード・剰余計算の境界(remaining が interval ちょうど)
- `ChainRibbonCard` の表示テスト: 導出成立時に表示・不成立時に非表示・
  停滞文言への切り替え
- E2E(UI 層): `SCENARIOS.md` にシナリオを追記し(ID は既存の UI-B 系の
  連番)、リボン上にインジケータが表示され値が変化することを検証する。
  slot 12 秒前提(#322 マージ後)の待ち上限は `helpers/` の slot-duration
  出所(#322 で新設)から導出する
- あわせて `entities/chainRibbon.ts` の `RIBBON_TILE_COUNT` コメント
  (slot 1〜2 秒前提の記述)を 12 秒前提へ更新する(#322 §5 から委譲)

## 6. 決定済み事項(実装担当が前提にしてよいこと)

- shared / collector は一切変更しない(§1。実装中に必要になった場合は
  直接変更せず chainviz-reviewer に調整を依頼する)
- 導出はフロントの純粋関数モジュール、方式は timestamp 差分の GCD(§2)
- 表示場所はチェーンリボンカードのヘッダ、チェーン全体で 1 つ(§3)
- 導出不成立時は非表示、停滞(interval × 3)でカウントダウン停止(§2, §3)
- 実装時に `docs/ARCHITECTURE.md` へ本設計の節(§10 チェーンリボンの
  隣に新節)を追加する(本メモの §1〜§3 を要約転記。設計だけが先に main へ
  載る期間を作らないため、実装と同じブランチ・同じ PR で反映する)

## 7. 実装時に判断してよいこと(設計では固定しない)

- 進捗表現の見た目(バー/円形/数字のみ)・アニメーションの詳細・
  data-testid 名・SCENARIOS.md のシナリオ ID
- tick の実装(setInterval 250ms か requestAnimationFrame か)
- GCD 実装の細部(ユークリッドの互除法で十分。差分件数の上限は保持窓 32 件
  由来の 31 個で自然に頭打ち)
- i18n 文言の最終形(chainviz-i18n レビューを通すこと)
- モックデータの timestamp 調整の要否

### 2026-07-16 実装(frontend)

- 担当: frontend
- ブランチ: issue-343-block-cadence-indicator

#### 設計メモ（着手前）

- `entities/blockCadence.ts`（新規、純粋関数）: 設計メモ §2 の手順どおり実装。
  `deriveBlockCadence(blocks, now)` が `{ intervalMs, anchorMs } | null` を返し、
  `computeBlockCadenceProgress(cadence, now)` が毎 tick の残り時間・進捗・
  停滞状態（`{ remainingMs, progress, stalled }`）を計算する。2 関数に分けた
  理由は設計メモ §4 のとおり「導出はブロック集合が変わったときだけ、剰余計算は
  毎 tick」という責務分離をテストからも明確にするため
- `entities/useBlockCadence.ts`（新規フック）: `deriveBlockCadence` を
  `useMemo(() => ..., [blocks])` でメモ化し、`computeBlockCadenceProgress` を
  250ms 間隔の `setInterval` で呼ぶ。cadence が変わった直後は tick を待たず
  `setNow(Date.now())` を即時実行し、表示のもたつきを防ぐ
- `ChainRibbonCard.tsx`: ヘッダの `latest`（最新ブロック番号）の右隣に
  cadence 領域を追加。`useBlockCadence(data.blocks)` を呼び、null なら領域
  ごと非表示、`stalled` なら文言切り替え、それ以外はバー + カウントダウン
  秒数（`Math.ceil(remainingMs/1000)`）を表示
- データの流れ: `App.tsx` は既存の `blocks`（`BlockEntity[]`、store 保持分
  最大 32 件相当）をそのままリボンノードの `data.blocks` として渡す。
  `ribbonTiles`（表示件数8件に絞った窓）ではなく `blocks` を渡す理由は、
  導出に使う差分の数（冗長性）を確保するため（設計メモの前提どおり）
- `chainRibbonNode.ts`: `ChainRibbonNodeData`/`ChainRibbonNodeContext` に
  `blocks: readonly BlockEntity[]` を追加（既存の `tiles` 等と並ぶ形。
  受け渡しのみで加工はしない）
- i18n: `ribbon.nextBlockCountdown` / `ribbon.blockProductionStalled` を
  設計メモの初稿どおり追加（既存の `chainRibbon.*` とは別の名前空間である
  点は設計メモの文言をそのまま踏襲した。最終形は chainviz-i18n のレビュー
  待ち）
- `entities/chainRibbon.ts` の `RIBBON_TILE_COUNT` コメント: 「slot 1〜2秒」
  前提の記述を「slot 12秒（Issue #322で確定）」前提に更新（値の 8 自体は
  変更しない。設計メモ §6 の指示どおりコメントのみ）
- `docs/ARCHITECTURE.md`: §10（チェーンリボン）の中に §10.5 として新設。
  §10.4 が既存の慣例で「拡張は §10 のサブセクションとして追記」だったため、
  それに倣った（トップレベルの `## 11.` を追加して以降の節番号
  （mempool パネル §11 とその参照多数）をずらす案は、既存 worklog
  （issue-303/330）に残る `§11` 参照との不整合を生む churn が大きいため
  見送った）

#### モックデータの timestamp（設計メモ §7 の実装時判断）

- 当初、ライブ tick で追加するブロックの timestamp を実時計ではなく
  「1 tick ごとに固定秒数を積み上げる合成クロック」にする案を試したが、
  `intervalMs` が1秒の整数倍でない場合（テストで `intervalMs: 500` 等を
  使うケース）に合成クロックが実時間より速く進み、時計ずれガード
  （`anchorMs > now + intervalMs`）が数 tick 後に恒久的に発火して
  インジケータが二度と復活しない不具合を実際に確認した（Node スクリプトで
  再現・修正後に再現しないことを確認済み）
- 既存の実時計ベース（`timestamp: Math.floor(Date.now() / 1000)`）に戻し、
  その判断根拠をコード内コメントと `docs/ARCHITECTURE.md` §10.5 に明記した。
  実時計ベースなら anchor は常にその時点の現在時刻そのものなので、ガードは
  実質発火しない。本番既定の `intervalMs = 3000` では導出される interval が
  安定して 3000ms に収束することを、ビルド後の Node スクリプトで実際に
  connect + 12 tick 分シミュレートして確認した

#### テスト

- `entities/blockCadence.test.ts`（新規）: 等間隔/空slot混じり(GCD)/フォーク
  重複timestamp/1件以下/重複のみで差分0件/不規則間隔(600秒超でnull)/時計ずれ
  ガード(境界含む)/剰余計算の境界(remainingがintervalちょうど)/周回時の
  剰余/停滞判定の境界(3倍ちょうどはfalse、直後はtrue)
- `entities/useBlockCadence.test.ts`（新規）: 導出不成立でnull、tick経過で
  カウントダウンが進む、ブロック集合の更新で再導出される（progressが
  リセット方向に動く）、アンマウント後もtickが例外を投げない
- `entities/ChainRibbonCard.test.tsx`: 既存 `data()` ヘルパーに `blocks: []`
  を追加。新規 describe「block cadence indicator (Issue #343)」で、
  導出不成立時の非表示・カウントダウン+バー表示・停滞表示への切り替えを
  確認
- 既存の `chainRibbonNode.test.ts`/`canvasNode.test.ts`/
  `chainRibbonCrossHighlight.test.tsx` は `blocks` フィールド追加に伴う
  型エラー分だけ最小限の修正

#### 確認結果

- `pnpm --filter @chainviz/frontend build`: 成功
- `pnpm --filter @chainviz/frontend test`: 153 files / 2242 tests 全て成功
- `pnpm exec eslint`（変更ファイル対象）: エラーなし
- モックモード（`websocket/mockData.ts`）: ビルド後の Node スクリプトで
  `createMockSnapshot`/`createMockClient` を実行し、接続直後から
  cadence が導出されカウントダウンが働くこと、ライブ tick が進んでも
  null に落ちないことを確認済み（上記「モックデータの timestamp」参照）

#### 次の担当への申し送り

- E2E（`SCENARIOS.md` へのシナリオ追記・Playwright テスト）はユーザー指示
  により本 Issue のスコープから明示的に除外した（フロント実装完了後に
  別途対応）。設計メモ §5 が挙げている E2E シナリオ（`chain-ribbon-cadence`
  等の testid を使って値が変化することを検証）は未着手のまま残っている
- i18n キー `ribbon.nextBlockCountdown` / `ribbon.blockProductionStalled`
  の最終的な文言・キー名は chainviz-i18n のレビュー待ち（既存の
  `chainRibbon.*` 名前空間との統一を検討する余地がある）

### 2026-07-16 テスト強化（tester）

- 担当: tester
- ブランチ: issue-343-block-cadence-indicator
- 目的: 実装担当が用意した基本テストに対し、異常系・境界値・遷移の観点で
  ケースを追加する（実装ロジックは変更しない）。

#### 追加したテスト

- `blockCadence.test.ts`（+6 件）
  - `deriveBlockCadence`
    - 差分が最小値の単純な倍数関係でないケースで GCD が正しく縮約されること
      （差分 [6, 9, 12] → interval 3 秒）。既存は差分がすべて最小値の倍数で
      GCD が最小差分に一致するケースのみだったため補完
    - number 昇順に並べると timestamp が逆行する区間（reorg 相当）で、負の
      差分が捨てられ anchor は timestamp 最大ではなく number 最大で決まること
    - interval が 600 秒ちょうど（上限の境界、許容）と 601 秒（上限超過、null）
    - 同一 timestamp のブロックが大量（20 件）に存在し、重複除去後に差分が
      1 件も残らず null になること
  - `computeBlockCadenceProgress`
    - now が anchor より過去（時計が巻き戻った場合）に、剰余を [0, interval)
      へ正規化して負の remaining や NaN を出さないこと（progress 0.75 を確認）
- `useBlockCadence.test.ts`（+2 件）
  - 3 倍 interval 超過で停滞状態に入り、新しいブロック到着で停滞が解消して
    カウントダウンが再開すること
  - cadence が null（1 件のみ）でタイマー未起動の間に時間が経過し、その後
    有効なブロック集合が届いたとき、即時 setNow により内部の now が新 anchor
    へ揃い progress がほぼ 0 に戻ること（即時 setNow の行を外すと落ちることを
    確認済みの回帰テスト）
- `ChainRibbonCard.test.tsx`（+2 件）
  - 導出成立 → 不成立（ブロックが 1 件に減る）への遷移でインジケータ領域が
    丸ごと消えること
  - 停滞表示 → 新しいブロック到着でカウントダウン表示へ戻ること

#### 確認結果

- `pnpm --filter @chainviz/frontend test`: 153 files / 2252 tests 全て成功
  （実装時の 2242 から +10 件）
- `pnpm --filter @chainviz/frontend build`: 成功
- `pnpm exec eslint`（追加した 3 テストファイル対象）: エラーなし
- 即時 setNow の回帰テストは、実装の該当行を一時的に削除すると当該テストが
  失敗すること、元に戻すと成功することを確認した

### 2026-07-16 レビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-343-block-cadence-indicator
- 判定: **合格**（軽微な指摘1件あり。下記参照。差し戻しは不要）

#### 確認内容

- 設計メモとの整合: shared / collector への変更が無いこと（diff は
  `packages/frontend` と `docs/` のみ）、GCD による導出方式・停滞判定
  `interval × 3`・導出不成立時の非表示が設計メモ §2〜§3 のとおり実装されて
  いることを確認した
- `blockCadence.ts`: GCD（ユークリッドの互除法、正の差分のみ）・重複
  timestamp 除去（Set の挿入順保持を利用）・時計ずれガード
  （`anchorMs > now + intervalMs`）・剰余の [0, interval) への正規化
  （now が anchor より過去でも負値/NaN を出さない）はいずれも正しい。
  固定値（1〜600秒の interval 妥当範囲・停滞倍率3・tick 250ms）はすべて
  根拠コメント付きで、チェーンの進行状態に依存しない相対値であり
  CLAUDE.md の固定値ルールに適合する
- `useBlockCadence.ts`: 導出は `useMemo(..., [blocks])` でブロック集合の
  変化時のみ、毎 tick は `computeBlockCadenceProgress`（剰余計算）のみ、
  という設計メモ §4 の方針どおり。導出不成立時はタイマー自体を起動しない。
  cadence 確立直後の即時 `setNow` は tester の回帰テスト（意図的に壊して
  検出を確認済み）で担保されている
- モック timestamp の追加判断（合成クロック案を不具合の実測を根拠に
  見送り、実時計ベースを維持）: 妥当。判断根拠が `mockData.ts` のコメントと
  ARCHITECTURE.md §10.5 の両方に記録されており、CLAUDE.md の「実際に再現
  して確認する」ルールにも沿っている
- `ChainRibbonCard.tsx` への統合: 既存のヘッダ（title / latest）と共存し、
  導出不成立時は `chain-ribbon-cadence` 領域ごと非表示。既存のリボン表示
  ロジック（タイル・フリーズ・ハイライト）には手を入れていない
- 境界の遵守: チェーン固有語彙の漏れなし。フロントは shared の
  `BlockEntity` のみに依存し、導出はチェーン非依存（不規則チェーンでは
  自然に非表示へ落ちる）
- エラー握りつぶし: 新規コードに catch は無く、null 返却はすべて
  「導出不成立 = 非表示」という意味付きでコメント化されている。問題なし
- テストの質: GCD の非自明な縮約（[6,9,12]→3）、reorg 相当の timestamp
  逆行、上限 600 秒の両側境界、停滞判定の厳密境界（3倍ちょうど/直後）、
  時計巻き戻り、停滞からの回復、導出成立→不成立の遷移まで網羅されており、
  実装の詳細をなぞるだけの無意味なテストは見当たらない
- docs: ARCHITECTURE.md §10.5 の記述は実装と一致。PLAN.md のチェックと
  E2E 除外の注記も適切
- コミット粒度: feat / docs / test / docs(worklog) の4コミット。
  `RIBBON_TILE_COUNT` コメント更新（12秒前提化）が feat コミットに同居して
  いるが、本 Issue のスコープに明記された関連変更（コメントのみ）であり
  許容範囲と判断した
- `pnpm lint` / `pnpm build` / `pnpm test`: リポジトリ全体で成功
  （shared 64 / collector 1458 / e2e 171 / frontend 2252、計 3945 件）

#### 指摘（軽微・マージ前の対応を推奨、差し戻し不要）

1. `blockCadence.ts` の `BlockCadenceProgress.remainingMs` の JSDoc が
   「0以上、intervalMs未満」となっているが、実際の値域は
   「0より大きく、intervalMs以下」（elapsed が [0, interval) に正規化される
   ため remaining = interval - elapsed は (0, interval]）。テスト
   （`returns remainingMs exactly equal to intervalMs when now === anchorMs`）
   も remaining === intervalMs を固定しており、コメントだけが実装・テストと
   矛盾している。コメントの1行修正を推奨

#### 申し送り（対応不要の所見）

- i18n キーが既存の `chainRibbon.*` ではなく `ribbon.*` 名前空間である点は
  設計メモの初稿どおりだが、実装 worklog にも記載のとおり chainviz-i18n の
  レビュー時に名前空間の統一を検討する余地がある
- 停滞判定はホストの時計がチェーンより 3 interval 超進んでいる場合に恒久的な
  停滞表示になるが、ローカル開発ツールの前提（同一ホスト上の Docker）では
  実質起きない。設計メモ §2 で言及済みの許容事項

### 2026-07-16 実機検証（qa）

- 担当: qa
- ブランチ: issue-343-block-cadence-indicator
- 判定: **合格**（Issue 本文の期待する対応をすべて満たす）

#### 検証環境

- 既に稼働中の profiles/ethereum スタック（Issue #322 の slot time 12 秒版、
  2 ノード構成、reth1 が host:8545 公開）をそのまま再利用した。他 worktree と
  Docker デーモンを共有しているため、スタックの起動・停止・再作成は一切
  行っていない。
- 検証時に host:4000 で稼働していた別 collector は、過去に破棄された旧スタック
  の残骸（tip がブロック 16205・timestamp が約 3 時間前で停止、2 秒間隔の
  古いチェーン）を保持しており、現行の 12 秒スタックを追従していなかった。
  そのため検証用に本 worktree の collector を空きポート（WS 4100 / proxy 4101）
  で新規起動し、現行スタックへ接続させた。collector は Docker を読み取り専用で
  ポーリングしてノードを自動発見するため、他 worktree の作業には影響しない。
  frontend は vite dev server をポート 5273 で `VITE_COLLECTOR_URL=
  ws://127.0.0.1:4100` で起動し、Playwright（chromium headless）で実描画を
  観察した。検証後、起動した collector（4100）と vite（5273）は停止済み。
  Docker スタックと host:4000 の collector は無傷のまま残している。

#### 確認結果（Issue 本文・依頼の検証項目に対応）

1. 環境起動: 現行の 12 秒スタックへ新規 collector を接続し、WebSocket 経由で
   ブロック diff がリアルタイムに届くこと（block 531→535 が各 ts 差 12 秒、
   wallclock と ts が一致）を確認した。
2. カウントダウン表示: チェーンリボンカード（`chain-ribbon-card`）のヘッダに
   `chain-ribbon-cadence-countdown`「次のブロックまで N 秒」が表示された。
3. 約 12 秒周期のリセット: Playwright でヘッダを 40 秒間 0.5 秒刻みでサンプ
   リングし、カウントダウンが 12→1 と減り、新ブロック着地の瞬間（latest が
   #559→#560→#561→#562 と増える瞬間）に 12 秒へリセットされることを確認。
   リセット間隔は 9.5s→21.5s→33.5s で厳密に 12.0 秒であった。
4. 進捗バー連動: `chain-ribbon-cadence-bar-fill` の width が 3%→99% へ線形に
   増加し、新ブロックごとに 3% へリセットされること（カウントダウンと連動）を
   確認した。
5. 接続直後の非表示: 接続直後のスナップショットはブロック 1 件のみで、
   `deriveBlockCadence` が導出不成立（null）となりインジケータ領域が出ない
   ことを WebSocket プローブで確認した（差分が届いて 2 件以上になった後に
   インジケータが出現）。
6. 日英切り替え: `language-toggle` で ja「次のブロックまで N 秒」/ en
   「Next block in Ns」が正しく切り替わること、再度トグルで日本語へ戻ることを
   実 DOM の outerHTML で確認した。
7. デグレ無し: チェーンリボンのタイル積み上げは従来どおり 8 件表示され、最新
   ブロック番号（`chain-ribbon-latest`）が新ブロックごとに増加した。既存表示に
   異常は見られなかった。

#### 備考

- 停滞表示（`interval × 3` 超で `chain-ribbon-cadence-stalled` へ切り替え）は
  今回のライブ環境（健全な 12 秒生成）では発生条件に入らないため実機では
  観測していない。ロジックは blockCadence / useBlockCadence / ChainRibbonCard
  の各ユニット・コンポーネントテスト（停滞境界・停滞からの回復）で担保済み。
- コンソールに接続直後の一過性の警告
  `WebSocket connection ... closed before the connection is established` が
  1 件出るが、その後正常に接続・スナップショット受信・diff 配信まで到達して
  おり、本 Issue の機能（インジケータ）とは無関係。既存の再接続挙動の範疇。
