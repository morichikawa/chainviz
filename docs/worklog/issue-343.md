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
