# Issue #298 ブロックが連なって積み上がっていく様子を視覚表現する

### 2026-07-12 Issue #298 ブロック連なり表現のUX設計

- 担当: ux
- ブランチ: issue-298-block-stacking-visualization
- 内容: 実際にアプリを動かして現状の「チェーンが刻まれている」表現を評価し、
  常設のブロック列（チェーンリボン）のUX設計をまとめた。実装は未着手
  （このメモはUX設計のみ。データフロー・型変更の精査は chainviz-designer が
  この後に行う前提）

## 1. 現状評価（実際に動かして確認した内容）

モックデータでフロントを起動し（`pnpm --filter @chainviz/frontend dev`）、
Playwright（chromium）でスクリーンショットを撮りながら確認した。

「チェーンが刻まれている」ことを示す表現は現状3つで、いずれも伝わらない:

1. **ブロック高の数値**: ノードカードの表面には出ておらず、ホバーで開く
   ポップオーバーの中に「ブロック高 129」という1行があるだけ。IP・ポート・
   CPU・メモリと同列に並ぶため、「台帳が伸びている」という意味は読み取れない
2. **ブロック伝播パルス**: 新ブロック到達時にエッジ上を小さな光点が走るが、
   最低表示時間450ms（`blockPulse.ts` の `MIN_PULSE_DURATION_MS`）で消える。
   連写スクリーンショットでも1フレームにしか写らない一瞬の出来事で、
   見逃したら次のブロックまで何も残らない
3. **tx チップの `included` 表示**: ウォレット/コントラクトカードの直近 tx
   チップが確定を示すが、「どのブロックに入ったのか」「そのブロックは
   どこにあるのか」への手がかりが無い

決定的なギャップ: 用語集の `block` の定義文は「各ブロックは直前のブロックの
ハッシュ（parentHash）を指しており、**この連なりが『ブロックチェーン』
そのものになる**」と教えているのに、キャンバス上のどこにもその「連なり」を
見られる場所が無い。tx・コントラクト・ウォレットという「チェーンに書かれる
中身」は全てカードになっているのに、書き込み先である台帳そのものだけが
視覚的実体を持っていない。

## 2. UX設計の結論（要約）

**チェーン全体で1本の「チェーンリボン」をキャンバス上の常設カードとして
追加する。** 直近Nブロックをタイル列として横に並べ、新ブロックが右端に
「積まれる」アニメーションで現れる。既存のパルス（一瞬の伝播）を置き換えず
補完し、「伝播の波（動き）」と「刻まれた履歴（蓄積）」の両方が見える状態に
する。

## 3. 設計判断（Issueの4論点への回答）

### 3.1 表示単位: チェーン全体で1本（ノードごとの列にはしない）

- 本プロジェクトには既に「コントラクトは特定ノードに従属させない独立カード
  として描き、『チェーンに複製され全ノードが同じ実行をするプログラム』で
  あることを示す」という決定がある（CONCEPT.md）。チェーンそのもの
  （ブロックの連なり）も同じ論理で、特定ノードの持ち物ではない。
  ノードごとに列を出すと「各ノードが別々のチェーンを持っている」という
  誤解をむしろ強化する
- ノードごとの列はカード5枚×N件でキャンバスの情報量が跳ね上がり、
  #299（情報の読み取りにくさ）を悪化させる
- 「ノードによって認識が違う瞬間」は、既存のノードカード側の表現
  （ブロック高・追従発光）と #296 のフォーク色分けが担う。役割分担として、
  リボンは「合意された正史」を1本で見せる

### 3.2 データソース: 既存の観測の範囲で成立させる（新規RPCを増やさない）

- `BlockEntity`（hash / number / parentHash / timestamp / receivedAt）は
  既に shared に存在し、collector は newHeads からこれをワールドステートに
  流している。フロントも `App.tsx` で `kind === "block"` を全件 filter
  済み。**リボンの第1段階はこの既存データだけで描ける**
- 「直近Nブロックの保持」は CONCEPT.md「環境スナップショットの共有」節の
  「直近のブロック数件分＋その伝播タイミングだけを持たせる」方針の具体化
  そのもので、設計原則と矛盾しない
- タイルに出したい「tx件数」は `BlockEntity` に無い。ただし collector は
  ブロック取り込み検知で `eth_getBlockReceipts` をブロックごとに1回既に
  呼んでいる（ARCHITECTURE.md §6、Issue #86 の方針）ので、観測済み情報から
  件数を導出できる見込み。`BlockEntity.txCount?` の追加要否・導出経路は
  **chainviz-designer の判断に委ねる**。UX上は「あれば良い」であり、
  無くても第1段階は成立する（§4.2の表示要素で優先度を明示）
- 実装上の注意（designer へ引き継ぎ）: collector 側の
  `BlockPropagationTracker` は200件で evict するが、**`WorldStateStore` は
  block エンティティを一度入れたら削除しない**ため、長時間稼働で
  スナップショットが肥大し続ける。リボンの「直近N件」を機に、store 側の
  block 保持にも上限（evict → `entityRemoved`）を入れるべきかを設計で
  精査してほしい（フロントは entityRemoved で自然にタイルが消える設計に
  しておく）

### 3.3 既存表現との関係: 置き換えず補完する

- パルス（B層・伝播の瞬間）とノードカードのブロック高・追従発光は
  そのまま残す
- 役割: パルス =「いま伝わっている」という動き、リボン =「伝わった結果
  ここに刻まれた」という蓄積。新ブロックで両方が同時に動くことで
  「伝播 → 全ノードの台帳に同じブロックが積まれた」という因果が読める
- 新タイル出現時の発光色はパルスと同系色にし、同一の出来事だと視覚的に
  結びつける

### 3.4 情報密度: 要素の増加は「リボン1枚」に抑える（#299 との整合）

- タイルN枚を1枚のリボン（1つの React Flow ノード相当）にまとめる。
  キャンバス上の要素数の増加は +1
- #299 のレイヤー絞り込み設計との関係: リボンの帰属は **B層**
  （CONCEPT.md の B層 =「ブロック伝播・フォーク発生の様子」）を基本と
  する。ただし tx の行き先（取り込み先）という C層の文脈でも参照される
  ため、#299 側では「B層・C層のどちらかが可視ならリボンを表示する」の
  ような複数レイヤー帰属を許す扱いを推奨する（最終判断は #299 の設計に
  委ねる。既定が全層表示である以上、初期状態でリボンが見えなくなる
  心配は無い）

## 4. UX仕様

### 4.1 配置・形状

- **キャンバス内の常設要素**（画面固定のHUDにはしない）。理由:
  (a) コントラクトカードと同じく「チェーンをグラフの内側の実体として
  見せる」という設計思想に合う、(b) 他カードと同様にドラッグ移動・位置の
  localStorage 永続化・#299 のレイヤー可視性制御に自然に乗る
- 横長のリボン。**右端が最新**（時間は左→右。図解の慣習に合わせる）
- 既定の初期配置は「ノード群の下・ウォレット群の上」の帯域（自動レイアウト
  への正確な組み込み方は実装担当と調整。他カードと重ならないことだけを
  要件とする）
- リボンにはヘッダを付ける: タイトル ja「チェーン」/ en "Chain"、
  タイトル語に用語解説アンカー（`block`）。ヘッダ右に最新ブロック番号
  （例「#131」）を常時表示する

### 4.2 タイル（ブロック1件）の表示要素

優先度順。第1段階は「必須」だけで成立する。

| 優先度 | 要素 | 内容 |
| --- | --- | --- |
| 必須 | ブロック番号 | `#131` 形式。タイルの主表示 |
| 必須 | ハッシュ短縮 | `0x3f8a…` 数文字。タイル下部に小さく |
| 必須 | タイル間の連結線 | 隣接タイルを短い鎖状のコネクタで結ぶ。「連なり」の視覚化の本体 |
| 推奨 | tx件数バッジ | `3 tx` 等。0件なら出さない（空ブロックはバッジ無しが「静かなブロック」の表現になる）。データ導出は designer 判断（§3.2） |
| 任意 | 提案ノードの手がかり | 第1段階では出さない（validator の職務との対応は将来の学習ポイントとして温存） |

- 表示件数は**直近8件**を初期値とする（UX上の初期値であり、実装時に
  タイル幅と情報密度を見て調整してよい。根拠: パルス間隔（slot 1〜2秒）×
  8件 ≈ 10秒強の履歴が残り、「見逃しても遡れる」体験に足りる最小限）
- 左端には省略インジケータ（`⋯`）を置き、ホバーで
  ja「これより前のブロックは表示していません」/
  en "Older blocks are not shown" のツールチップ
- **リボンの表示は観測済みブロックのみで構築する**。接続直後や起動直後は
  1〜2件から始まってよい（過去に遡って埋めるための追加RPCはしない。
  「見ているそばから積み上がっていく」こと自体が体験の核なので、
  歴史の完全性は要件にしない）

### 4.3 新ブロック到着時のアニメーション（「積まれる」の表現）

1. 既存タイル列が左へ1タイル分スライドする（最古のタイルはフェードアウト）
2. 新タイルが右端に上から「載る」（短い落下+着地。数百ms程度）
3. 着地の瞬間、タイルが一瞬発光する。発光色は既存の伝播パルス・ノードカードの
   追従発光と同系色（同一の出来事であることを色で束ねる）
4. 新タイルと直前タイルの間に連結線が「つながる」描画を挟む
   （parentHash の連結を動きで示す）

- 再接続時のスナップショットで一斉に届いた過去ブロックはアニメーション
  しない（既存の `isFreshBlock` の鮮度ガードと同じ流儀。並べるだけ）

### 4.4 タイルホバー時のポップオーバー

既存カードのホバーポップオーバー（`useHoverPopover` / `PopoverPortal`）と
同じ流儀。表示内容:

| 行 | 内容 | 用語解説アンカー |
| --- | --- | --- |
| ブロック番号 | `#131` | `block` |
| ハッシュ | 全文（折り返し） | — |
| 親ブロック | parentHash 短縮。**直前タイルのハッシュと同一であることを、ホバー中に直前タイルのハッシュ表示を強調（ハイライト）して示す** | — |
| 時刻 | ブロックの timestamp | — |
| 取り込み tx | 件数（観測できた場合）。将来: tx ハッシュのチップ | `transaction` |
| 受信したノード | receivedAt を受信順に並べた「ノード名 +Xms」のリスト（波の起点を0msとする相対表示）。伝播の順序が事後からも読める | `gossip` |

- 「親ブロック行ホバーで直前タイルを強調」は、用語集が文章で教えている
  「parentHash の連なりがチェーンそのもの」を実物で確認できる、この機能の
  学習上の要。第1段階に含めることを推奨する
- 「受信したノード」リストは、パルスを見逃しても伝播の事実を事後確認できる
  救済導線（§1の課題2への直接の回答）

### 4.5 tx との接続（C層への橋）

- 第1段階: ブロックタイルに tx 件数を出すところまで（§4.2）
- 第2段階（別Issueに切り出してよい）: タイルホバー時に、そのブロックに
  取り込まれた tx を持つウォレット/コントラクトカードをハイライトする。
  逆方向（tx チップのホバーで該当ブロックタイルをハイライト）も同様。
  **常設のエッジは張らない**（エッジ本数の氾濫は #299 の課題を悪化させる
  ため、ホバー時だけの連動に留める）

### 4.6 文言（i18n。`{ja, en}` 形式）

実装時のキー名は実装担当に委ねる。文言案:

| 用途 | ja | en |
| --- | --- | --- |
| リボンのタイトル | チェーン | Chain |
| リボンのサブタイトル（小さく） | 新しいブロックが右端に積まれていきます | New blocks stack up on the right |
| 省略インジケータのツールチップ | これより前のブロックは表示していません | Older blocks are not shown |
| ポップオーバー: 親ブロック | 親ブロック | Parent block |
| ポップオーバー: 取り込みtx | 取り込まれた tx | Included txs |
| ポップオーバー: 受信したノード | 受信したノード | Received by |
| 空状態（ブロック未観測） | ブロックの到着を待っています… | Waiting for the first block… |

- 用語集の追加・修正: `block` の定義文中「chainviz ではノードのブロック高と、
  新ブロック到着時の伝播パルスとして見える」を、リボン実装後に「キャンバスの
  チェーン表示（ブロックの連なり）としても見える」を含む記述へ更新する。
  必要なら `parent-hash` を新規用語として追加する（英訳は chainviz-i18n の
  レビュー対象）

## 5. #296（フォーク色分け）との接点

**統合は必須ではない。両者は独立して成立する。**

- 本設計の第1段階は「単一の親子連鎖」だけを前提にする。observedな直近N件を
  number 順（同 number はより後に観測された方を先端扱い）に並べるだけで、
  フォーク検知ロジックには依存しない
- 接点（#296 側または統合後の拡張として実装する場合の座標）:
  - リボンの**右端（先端）だけ**は2タイルの縦並置を許すレイアウト拡張点を
    持つ。フォーク発生中は同じ高さのブロック2枚が上下に並び、それぞれの
    タイルを #296 が決める「tip 色」で縁取る（ノードカードの色分けと同じ
    色を使い、どのノードがどちらを見ているかを色で対応づける）
  - 収束したら、負けた側のタイルがグレー化 → 縮小フェードアウトし、
    正史側だけが残る（「収束すると1本に戻る」という学習ポイントの表現）
  - この拡張に必要なのは「同一 number の複数 BlockEntity が store に共存
    し、どちらが正史かを後から判別できること」。現状の `BlockEntity` は
    hash キーなので共存自体は可能。正史判定のデータ（#296 が設計する
    フォーク検知の成果物）をリボンが参照する、という依存方向にする
- 統合要否の判断: リボン第1段階を先に出し、#296 の表現は上記の拡張点に
  後乗せする段階分けを推奨する（統括の最終調整に委ねる）

## 6. 決めきれなかった点（ユーザー・統括への確認事項）

1. **リボンの向き**: 本設計は横リボン（左→右）を推奨とした。Issue の
   ユーザーフィードバックの文言は「積み上がる」であり、縦積み（下→上）の
   方が字義には忠実。横を推奨する理由は (a) ブロックチェーンの図解の慣習が
   横であること、(b) 縦積みは高さ方向にキャンバスを圧迫し #299 を悪化させ
   やすいこと。「積まれる」感は新着タイルの落下アニメーション（§4.3）で
   補う。この解釈で良いかは確認したい
2. **表示件数8件・タイルの具体的な寸法**: UX上の初期値。実装時の見た目で
   調整してよい（固定値の前提条件として「slot 1〜2秒の学習用ネットで
   10秒強の履歴が残る」ことをコード上のコメントに残すこと）
3. **第2段階（ホバー連動ハイライト・tx チップ⇔ブロックの双方向導線）を
   本Issueに含めるか別Issueに切るか**: 別Issueへの切り出しを推奨

## 7. 実装への引き継ぎ（作業分担の見立て）

UX観点からの見立てであり、正式なデータフロー・型設計は chainviz-designer が
確定させる:

- shared: 第1段階は型変更なしで成立する見込み。`BlockEntity.txCount?` の
  追加（推奨要素）と store の block 保持上限は designer 判断
- collector: 第1段階は変更なしの見込み（txCount を入れる場合のみ
  `eth_getBlockReceipts` 正規化の拡張。ブロックあたりの RPC 回数は
  増やさない）
- frontend: リボンコンポーネント（React Flow ノード + タイル列 + 着地
  アニメーション + ホバーポップオーバー）、`blocks` からのタイル列導出
  （純粋関数に切り出してユニットテスト対象にする）、i18n 文言、
  glossary `block` の定義更新
- e2e: UI に見える新機能なので `packages/e2e/SCENARIOS.md` への UI
  シナリオ追記 + Playwright テストが必要（PLAN.md 運用ルール）

## 8. 確認手段のメモ（次の担当向け）

- モック確認: `pnpm --filter @chainviz/frontend dev`（VITE_COLLECTOR_URL
  未設定でモック駆動。blockHeight が3秒ごとに進み、パルス・tx確定も動く）
- この環境の Playwright は `chromium.launch({ channel: "chromium" })` +
  環境変数 `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`
  で起動できる（headless shell は libnspr4.so 欠落で起動不可）。
  スクリプトは module 解決の都合で `packages/e2e` 配下から実行する

### 2026-07-12 Issue #298 チェーンリボンのデータフロー設計

- 担当: designer
- ブランチ: issue-298-block-stacking-visualization
- 内容: 上記UX設計を受けて、実装前のデータフロー・型変更要否・collector/
  frontend の作業分担を確定した。設計の本文は `docs/ARCHITECTURE.md` §9
  （新設）に反映済み。UX設計メモが designer に委ねた2つの未決事項
  （tx件数バッジのデータソース、store のブロック蓄積方針）へ回答した。
  スコープは統括のユーザー確認により**第2段階（ホバー連動ハイライト）も
  今回含める**。#296（フォーク色分け）との統合は含めない（単一連鎖前提）
- 決定事項・注意点:
  - **shared の型変更なし**。リボンはワールドステートのエンティティでは
    なく、フロントが既存の `BlockEntity` 群から導出する表示物（React Flow
    上は id `chain-ribbon` 固定の単一ノード）。`DiffEvent` も既存の
    entityAdded / entityUpdated / entityRemoved で足りる（フロント store は
    entityRemoved を汎用処理済みで、ブロック evict でタイルが自然に消える）
  - **tx件数バッジは `BlockEntity.txCount` を足さず、フロントで
    `TransactionEntity.blockHash` を数えて導出する**。根拠: collector の
    `recordInclusion`（transactions.ts）は eth_getBlockReceipts の結果から
    ブロック内の全 tx（pending 未追跡分も含む）を TransactionEntity として
    配信しており、スナップショットにも入る。第2段階のホバー連動が
    どのみち「blockHash → tx群」の索引を必要とするため、件数はその副産物。
    status は included / failed の両方を数える（failed もブロックに
    取り込まれている）。receipts 取得失敗時は件数 0 = バッジ非表示に
    退行するが「省略 = 情報なし」の既存の流儀と整合
  - **collector の `WorldStateStore.applyBlock` にブロック番号ベースの
    保持窓を入れる**（`BLOCK_RETENTION = 32`）。観測済み最大ブロック番号
    （単調増加）から窓を計算し、(a) 窓より古い番号の流入は取り込まず空の
    差分を返す、(b) 窓から外れた既存ブロックは entityRemoved として配信
    する。挿入順の evict にしない理由: addNode 直後の追いつき中ノードが
    過去ブロックの newHeads を大量に流すと、挿入順 evict では正史の先端側
    ブロックが押し出されてリボンが一時的に過去へ巻き戻る。番号窓なら
    追いつきフラッドは (a) で弾かれる
  - **固定値 32 の前提条件**（CLAUDE.md の固定値ルール。コードコメントにも
    書くこと）: フロントのリボン表示件数（8）以上であること、フォークで
    同一番号の複数ハッシュが共存する余地、`BlockPropagationTracker`
    （200件保持のまま変更しない）からの遅延 receivedAt マージが窓内で
    entityUpdated として反映される余裕を見込んだ値。表示件数 8 を大きく
    増やす変更をするときは窓も併せて見直すこと
  - タイル列の導出仕様（フロントの純粋関数 `entities/chainRibbon.ts`
    想定）: 番号昇順・末尾8件。同一番号に複数ハッシュがある場合は
    `latestReceiptTime` が最も遅いもの（同時刻なら hash 辞書順）を1つ選ぶ。
    隣接タイルの連結線は `次.parentHash === 前.hash` が成立するときだけ
    「連結」として描き、番号が飛んだ区間は切れ目を示す
  - モック（`websocket/mockData.ts`）は現状 BlockEntity を一切流していない
    （blockHeight の entityUpdated のみ）。リボンのオフライン確認のため、
    スナップショットへの直近数件のブロック追加と、tick ごとの連なる
    新ブロック entityAdded（receivedAt 付き）+ collector の保持窓と同様の
    entityRemoved の送出をフロント作業に含める
  - **作業分担と依存**: collector（store の保持窓 + ユニットテスト）と
    frontend（リボン導出・カード・アニメーション・ホバー連動・i18n・
    glossary 更新・モック・e2e）は互いに独立で並行着手できる。frontend は
    「ブロックが無制限に届き続けても直近分だけ描く」導出なので、collector
    の窓の有無に依存しない
  - tx（TransactionEntity）の store 無制限蓄積は本 Issue の範囲外として
    残る（表示が「直近N件」に閉じないため別途設計が要る）。バックログ
    Issue 起票を統括に依頼する

### 2026-07-12 Issue #298 collector側実装: ブロック番号ベースの保持窓

- 担当: collector
- ブランチ: issue-298-block-stacking-visualization
- スコープ: designer が確定した ARCHITECTURE.md §9.2 の仕様どおり、
  `WorldStateStore.applyBlock` に保持窓を実装した。新規 RPC・アダプタ変更・
  shared の型変更はなし。

#### 着手前の方針確認（設計メモ）

- 対象は `packages/collector/src/world-state/store.ts` の `applyBlock` の
  みで、`applyKeyed`（block/transaction/contract 共通の単一エンティティ
  取り込み処理）はそのまま流用する。block だけが保持窓の対象なので、
  `applyBlock` 側で窓判定・evict を行い、`applyKeyed` 自体は変更しない
  （tx・contract には影響を与えない）
- 状態として `maxObservedBlockNumber`（観測済み最大ブロック番号、単調増加）
  を store のプライベートフィールドに追加する。窓の下限は
  `maxObservedBlockNumber - BLOCK_RETENTION + 1`
- 処理順序: (1) 新しい最大値 `newMax` を計算 → (2) 今回のブロックが
  `newMax` 基準の窓より古ければ空配列を返して終了（`maxObservedBlockNumber`
  も更新しない）→ (3) 窓内なら `maxObservedBlockNumber` を更新し、
  `applyKeyed` で通常どおり add/update を計算 → (4) 窓から外れた既存の
  block エンティティを number 基準で探索して `entityRemoved` を生成・適用し、
  (3) の差分と結合して返す
- evict は挿入順ではなく `entities` 全走査で `kind === "block" && number <
  windowLowerBound` を条件に判定する（store 全体のエンティティ数はノード数
  等に比べて block が支配的なので、線形走査のコストは許容範囲と判断）
- `BLOCK_RETENTION = 32` はコード上の定数コメントに前提条件（表示件数8以上・
  フォーク共存・`BlockPropagationTracker` からの遅延 receivedAt マージが
  窓内で反映される余裕）を明記し、このファイルにも同じ内容を残す
  （CLAUDE.md の固定値ルール対応）

#### テスト

- `packages/collector/src/world-state/store-block-retention.test.ts` を
  新規ファイルとして分離した（既存の `store.test.ts` は 800 行超まで
  肥大化しており、これ以上関心事の異なるテストを積み増さない方針。
  `store-transaction-wallet-link.test.ts` と同じ「関心事ごとに分離する」
  既存パターンに合わせた）
- ケース: ちょうど32件投入（evictなし）/ 33件目投入時に最古の1件が
  entityRemoved / 大きな番号ギャップで複数件を一度に evict / 窓より
  古い番号の流入拒否（空diff・store状態不変）/ 境界値（下限ちょうどは
  受理、下限-1は拒否）/ フォーク（同一番号2ハッシュ）が窓内で共存し、
  窓が進むと両方同時に evict される / 拒否されたブロックが
  `maxObservedBlockNumber` を動かさない（＝窓を縮めない）ことの確認 /
  窓内に残るブロックへの entityUpdated（receivedAt の遅延マージ）が
  保持窓と共存すること
- 退行検出の確認: 実装前の store.ts（`git stash` で一時的に変更を戻した
  状態）でこの新規テストファイルを実行し、6件のテストが実際に失敗する
  ことを確認してから実装を復元した（CLAUDE.md「回帰テストを書く場合は
  そのテストが実際に元の不具合を検出できることを確認する」対応）

#### 実機確認

- 既に3時間以上稼働していた `profiles/ethereum` の共有 Docker スタック
  （複数 worktree で共有しているホストの docker daemon 上のスタック。
  他チームが利用中の可能性を考慮し、`docker compose up -d` での再起動や
  停止は行わず既存スタックをそのまま利用した）に対し、collector を
  ポート 4100/4101（既定の 4000/4001 とは別ポート。他の作業中プロセスとの
  衝突を避けるため）で起動し、小さな WebSocket クライアントスクリプトで
  `snapshot`/`diff` を購読して確認した
- 観測結果（約95秒間）: block の entityAdded 47件・entityRemoved 35件、
  最終的に store 内の block エンティティ数は常に32件に収束していた。
  33件目の到着から evict が始まり、以後は「1件追加 → 1件削除」で32件を
  維持する挙動を確認（設計どおり）
- 検証に使った一時スクリプト（`packages/collector/watch-298.mjs`）は
  作業ディレクトリに残さず削除済み

#### ビルド・テスト結果

- `pnpm --filter @chainviz/collector build`: 成功
- `pnpm --filter @chainviz/collector test`: 52 test files / 1319 tests
  すべて成功（新規10件を含む）

#### 次の担当（frontend）への申し送り

- collector 側は完了。frontend 側のチェーンリボン実装は本変更に依存せず
  並行着手可能（設計メモの「作業分担と依存」節のとおり）
- `entityRemoved` は block の evict でも通常の削除（node/workbench の
  A層差分など）でも同じ `{ type: "entityRemoved", id }` 形で届く。
  frontend 側で block 由来かどうかを区別する必要がある場合は、削除前に
  保持していたエンティティの `kind` をフロント側の store で参照すること
  （collector 側では区別する追加情報を載せていない）
### 2026-07-12 Issue #298 frontend実装 設計メモ（着手前）

- 担当: frontend
- ブランチ: issue-298-block-stacking-visualization-frontend
  （collector担当が同名の issue-298-block-stacking-visualization を
  同時に使用中のため、設計メモの前例（chainviz-designer/chainviz-ux の
  ブランチ運用）に倣い別名で分岐。統括が後で cherry-pick して合流させる
  運用）
- 実装方針:
  - **データフロー**: 純粋関数を2ファイルに分離する。
    `entities/chainRibbon.ts`（タイル列導出 `deriveRibbonTiles`・tx件数
    `countTransactionsByBlockHash`・受信順リスト `deriveReceivedOrder`・
    時刻整形）と `entities/blockRelations.ts`（第2段階のハイライト対象
    アドレス導出 `deriveBlockRelatedAddresses`）。前者は「表示物の中身」、
    後者は「カード間の相互作用」で関心事が異なるため分割する
  - **React Flow ノード化**: `entities/chainRibbonNode.ts`
    （`ContractCard`/`contractNode.ts` と対になる型・変換関数。id固定
    `chain-ribbon`）+ `entities/ChainRibbonCard.tsx`（表示本体）+
    `entities/ChainRibbonPopover.tsx`（ホバー詳細。既存の
    `ContractPopover.tsx` と同じ `PopoverPortal` 流儀）
  - **着地アニメーション**: 新規フック `entities/useRibbonLanding.ts`
    （`useNewArrivalHighlight.ts` と同型。`blockPulse.ts` の
    `isFreshBlock` を再利用して再接続時の一斉アニメーションを防ぐ）
  - **第2段階のホバー連動**: 新規 Context
    `entities/RibbonHoverContext.tsx`（`OperationDataContext.tsx` と
    同じ「React Flow ノード内部からキャンバス全体の一時状態へアクセスする
    ための Context」パターン）。状態は `hoveredBlockHash: string | null`
    1本に一本化し、タイルホバー（`setHoveredBlockHash`）・tx/活動チップ
    ホバー（`setHoveredTxHash` → 内部で blockHash に解決）のどちらから
    でも同じ状態を駆動する。`highlightedAddresses` を導出値として持たせ、
    `WalletCard`/`ContractCard` 側は自分の address が含まれるかだけを見る
  - **App.tsx への組み込み**: `blocks`/`transactions`/`nodeEntities` は
    既存の memo を再利用し、`deriveRibbonTiles` → `useRibbonLanding` →
    `chainRibbonToFlowNode` の順で1ノードを組み立て、`nodes` 配列に
    無条件で追加する（コントラクトカードと違い「常設」なので entities の
    有無でフィルタしない）。位置は他カードと同じ `layout`
    （`saveNodePosition`/`canvasNodeLayoutKey`）に乗せ、固定 id
    `chain-ribbon` をキーにする
  - **Issue #119 の stabilizeNodes 対応は見送る**: 他のカード型
    （`isSameInfraNode` 等）と違い、リボンは1本しか無く毎ブロックで
    実質的に内容が変わるため、内容比較による再レンダー抑制の効果が薄い。
    `Canvas.tsx` の `preserveMeasuredDimensions` は id ベースで自動的に
    効くため、Issue #119 の「measured 破棄によるチラつき」自体は対応済み
    のまま。将来リボンの再レンダーコストが問題になったら追加最適化を
    検討する（今回は見送りとその理由をここに明記するだけに留める）
  - **モック**: `websocket/mockData.ts` に `initialMockBlocks`（初期
    スナップショット用、direnced past `receivedAt` で鮮度ガードの外）と
    `advanceChain`（tick ごとに1ブロック追加 + 遅延 `receivedAt` 更新 +
    `MOCK_BLOCK_RETENTION`（モック専用の12。collector側の実窓32とは無関係）
    超過分の evict）を追加する
  - **既存表現の維持確認**: `blockPulse.ts`/`useBlockPulses.ts`
    （伝播パルス）・`useTxLifecycle.ts`（tx確定演出）には一切手を入れない
    （UX設計の「置き換えず補完する」方針どおり）

### 2026-07-12 Issue #298 frontend実装

- 担当: frontend
- ブランチ: issue-298-block-stacking-visualization-frontend
- 内容: 上記設計メモのとおり実装した。新規ファイル: `entities/chainRibbon.ts`
  （+テスト）、`entities/blockRelations.ts`（+テスト）、
  `entities/chainRibbonNode.ts`（+テスト）、`entities/ChainRibbonCard.tsx`
  （+テスト）、`entities/ChainRibbonPopover.tsx`、
  `entities/useRibbonLanding.ts`（+テスト）、
  `entities/RibbonHoverContext.tsx`（+テスト）、
  `entities/chainRibbonCrossHighlight.test.tsx`（リボン⇔ウォレット/
  コントラクトの結合テスト）、
  `websocket/mockData.chainRibbon.test.ts`。既存ファイルの変更:
  `App.tsx`（リボンノードの組み立て・`RibbonHoverProvider` の設置）、
  `Canvas.tsx`（`nodeTypes` へ登録）、`canvasNode.ts`（`CanvasFlowNode`
  合併型・`canvasNodeLayoutKey` にリボンを追加）、`WalletCard.tsx`/
  `ContractCard.tsx`（順方向ハイライトのクラス付与・tx/活動チップの
  逆方向ホバー連動）、`i18n/messages.ts`（`chainRibbon.*` キー群）、
  `glossary/ethereum/terms/c-transaction.yaml`（`block` 定義文にリボンへの
  言及を追記）、`styles.css`（`.chain-ribbon-*`/`.infra-card--ribbon-highlight`）、
  `websocket/mockData.ts`（`initialMockBlocks`/`advanceChain`）。
- 決定事項・注意点:
  - **`docs/PLAN.md` の Issue #298 チェックボックスはまだチェックしない**。
    collector側（`WorldStateStore` の保持窓 `BLOCK_RETENTION=32`）が
    並行worktreeで実装中で、統括が両ブランチを cherry-pick して合流させる
    運用のため、片方だけでは Issue 全体が完了したことにならない。両方が
    揃いレビュー・QAを通過した時点でチェックを付けること
  - **canvas.empty の空状態メッセージが実質到達不能になった**:
    チェーンリボンを `nodes` 配列に無条件で追加するようにしたため、
    `nodes.length === 0` は常に false になる（リボン自体が空状態
    （`chain-ribbon.empty`「ブロックの到着を待っています…」）を持つため、
    UX的には後退ではなく改善だが、既存の「表示するコンテナがありません」
    分岐は事実上死んだコードになった。既存テストはこの分岐に依存して
    いなかったため退行は無いが、次にこの分岐を触る担当は事情を把握して
    おくこと
  - **ブロックタイムスタンプの表示形式**: `BlockEntity.timestamp` は
    Ethereum のブロックヘッダ慣習どおり epoch秒（collector側
    `blocks.ts`）。`toLocaleString` はホストのロケール/タイムゾーンに
    依存し表示・テストの両方が不安定になるため、
    `chainRibbon.ts#formatBlockTimestamp` で常に UTC 固定書式
    （`YYYY-MM-DD HH:MM:SS UTC`）に整形する方針にした
  - **ホバー連動ハイライト（第2段階）の実装範囲**: `WalletCard` の
    tx チップ・`ContractCard` の活動チップの両方から逆方向ハイライト
    （チップ → 対応タイル）を実装した（UX設計 §4.5 は「別Issueでもよい」
    としていたが、統括のユーザー確認で今回スコープに含めることが確定して
    いたため両方実装した）。色は新着強調と同じ `--accent`（青）を再利用し、
    着地アニメーションの `--synced`（緑）とは意図的に系統を分けている
    （「伝播の出来事」と「操作起点の強調」を混同させないため）
  - **e2e**: `packages/e2e/SCENARIOS.md` に UI-B-05（基本表示・着地）・
    UI-B-06（第2段階のホバー連動）を追記し、
    `packages/e2e/src/ui/chain-ribbon.spec.ts` を実装した。
    `pnpm exec playwright test --list` で2件とも正しく登録されることは
    確認したが、**実 Docker スタックに対する実行（`pnpm test:e2e:ui`）は
    実施していない**（frontend 実装担当の作業範囲は「モックデータでの
    動作確認」までとし、実環境での検証は chainviz-qa に委ねる運用のため）。
    QA は本Issueの検証時に必ず `pnpm test:e2e:ui -- chain-ribbon` を
    実行すること
  - **確認手段**: `pnpm --filter @chainviz/frontend dev` で起動し、
    Playwright（`chromium.launch({ channel: "chromium" })` +
    `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`。
    §8の前例どおり `packages/e2e` 配下から `@playwright/test` の
    `chromium` をインポートして実行）でスクリーンショットを撮り、
    タイル表示・着地アニメーション（緑発光）・ホバーポップオーバー
    （親ブロック行ホバーでの直前タイル強調含む）・順方向/逆方向の
    カード間ハイライト（青枠）を目視確認した
  - **次の担当（#296 フォーク色分け）への申し送り**: UX設計 §5 の
    拡張点（先端の縦並置）はこの実装に含めていない。`deriveRibbonTiles`
    の `pickCanonicalPerNumber`（同一 number は latestReceiptTime最大→
    hash辞書順で1件選ぶ暫定ルール）を、#296 が正史判定を実装したら
    そちらの成果物に置き換える設計にしてある

### 2026-07-12 Issue #298 テスト強化（異常系・境界値）

- 担当: tester
- ブランチ: issue-298-block-stacking-visualization
- 内容: collector/frontend の実装担当が書いた基本テストに対し、エッジ
  ケース・境界値・双方向連動のテストを追加した（実装は変更していない。
  追加はテストファイルのみ）。
- 追加したテストと観点:
  - `entities/chainRibbon.test.ts`:
    - `pickCanonicalPerNumber` の暫定選択ルールの境界。両ブロックとも
      `receivedAt` 空（`latestReceiptTime` が null 同士 = NEGATIVE_INFINITY）
      で時刻決着がつかない場合の hash 辞書順フォールバック。片方だけ
      `receivedAt` を持つ場合に時刻を持つ側が勝つこと（入力順非依存）。
    - collector の保持窓（32）と表示件数（8）の差（24）をまたぐ統合的な
      境界。32件中の末尾8件だけを描き、先頭タイルは隠れた24件と連鎖して
      いても `connectedToPrevious` が常に false であること、2件目以降は
      表示窓内だけで前タイルと比較して連結すること。
    - `deriveReceivedOrder` が非有限な `receivedAt` 値（NaN/Infinity）を
      offset に混入させずスキップすること。
    - `formatBlockTimestamp` の UTC 固定書式。負オフセット TZ で前日に
      ずれる早朝時刻でも UTC 日付を保つこと、秒未満のドリフトを切り捨てる
      こと（テスト実行環境の TZ 設定に依存しない確認）。
  - `entities/useRibbonLanding.test.ts`:
    - 鮮度ガード（`isFreshBlock`）の境界。閾値ちょうど（6000ms）は着地
      アニメーションし、1ms 過ぎたら過去分として扱うこと。
    - 再接続バーストで過去ブロックが一斉に届いても一つも着地しないこと。
      過去分に本物の新着が1件混じるケースでは新着だけが着地すること
      （鮮度ガードがタイル単位で効く確認）。
  - `entities/RibbonHoverContext.test.tsx`:
    - 順方向で tx を持たないブロックをホバーすると hoveredBlockHash は
      立つが highlightedAddresses は空になること。
    - 明示的な解除を挟まず別ブロックへホバーを移した際、前ブロックの
      アドレスが残らず置き換わること（状態リセット漏れの確認）。
  - `entities/chainRibbonCrossHighlight.test.tsx`:
    - 逆方向（ウォレット tx チップのホバー）が対応タイルだけでなく同一
      ブロックのコントラクトカードにも同時に波及すること（双方向連動が
      単一の hoveredBlockHash に一本化されている確認）。
    - 順方向でタイルを直接ホバーするとそのタイル自身も逆方向ハイライトの
      対象になること。
  - `entities/ChainRibbonCard.test.tsx`:
    - 空状態でヘッダの最新ブロック番号を出さないこと。
  - `world-state/store-block-retention.test.ts`:
    - 同一ブロックの再受信（冪等）で差分ゼロ・窓不変であること。
    - 先端（観測済み最大番号）でのフォーク共存。
    - 最初の観測が genesis（番号0）でも取り込まれること。
- 退行検出の確認（実装を意図的に壊して失敗することを確認後に復元）:
  - `chainRibbon.ts` の hash 比較 `<` → `>`: 上記の both-null tie テストが
    失敗。
  - `blockPulse.ts#isFreshBlock` の `<=` → `<`: 鮮度ガード境界テストが失敗。
  - `chainRibbon.ts` の表示窓リンク計算を canonical 全体参照に変更:
    32→8 リンク境界テストが失敗。
  - `RibbonHoverContext.tsx#setHoveredTxHash` の blockHash 解決を素通しに
    変更: reverse fan-out テストが失敗。
  - `store.ts` の窓拒否分岐 `<` → `<=`: 窓下限境界の受理テストが失敗。
- ファイル分割: 追加は各実装モジュールに対応する既存テストファイルへの
  関心事別の追記に留めた。`chainRibbon.test.ts` は 1 モジュール
  （`chainRibbon.ts`）に対応するテストのため、関数ごとの describe 単位で
  まとまっており現時点（約250行）では分割不要と判断した。
- ビルド・テスト結果: collector build 成功 / test 1322件成功、
  frontend build 成功 / test 2003件成功（追加分 +17件）。

### 2026-07-12 Issue #298 レビュー結果（差し戻し1件・統括対応2件）

- 担当: reviewer
- 対象: ブランチ `issue-298-block-stacking-visualization`（cherry-pick合流後、
  working tree clean の状態）
- 確認した内容:
  - `pnpm build && pnpm lint && pnpm test` 全パッケージ通過（collector
    1322件 / frontend 2003件）
  - `git diff <分岐点>...HEAD` で `packages/shared` の変更が無いことを確認
    （設計メモの「shared の型変更なし」どおり）
  - 設計メモの3決定事項（shared/collector最小限・リボンはエンティティで
    なく表示物・既存表現の置き換えなし）からの逸脱なし。
    `blockPulse.ts`/`useBlockPulses.ts`/`useTxLifecycle.ts` は未変更
  - `WorldStateStore` の保持窓は `applyBlock`/`evictBlocksBelow` に閉じて
    おり、`applyKeyed` は未変更。tx/contract/node/wallet への影響なし。
    `BLOCK_RETENTION=32` の前提条件コメントもコード・worklog 両方に記載
    済み（固定値ルール準拠）
  - 境界の遵守: フロント新規コードに Docker・チェーン固有語彙の漏れなし
  - エラー握りつぶし: 新規コードに catch して無視する箇所なし（e2e の
    後始末の `isVisible().catch(() => false)` は既存スペックと同じ
    防御的クリーンアップで許容）
  - コミット粒度・Conventional Commits: `git log main..HEAD` 17コミット
    全て準拠。cherry-pick 由来の履歴も関心事ごとに分かれている
  - docs: ARCHITECTURE.md §9・PLAN.md（チェック済み+Issueリンク）・
    WORKLOG.md 索引・glossary の `block` 定義更新、いずれも実装と整合
  - e2e: `playwright test --list` で UI-B-05/UI-B-06 の2件が登録される
    ことを確認
- **差し戻し（frontend担当）**:
  1. `packages/e2e/src/ui/chain-ribbon.spec.ts` の UI-B-06 が、テスト
     本体の内側（81行目）で `test.use({ viewport: OPERATION_PANEL_VIEWPORT })`
     を呼んでいる。Playwright は `test.use()` をテスト内で呼ぶと実行時
     エラー（"test.use() can only be called in a test file and can only
     be used in the top level scope..."）で即失敗する。最小スペックで
     実際に再現して確認済み（`--list` では検出されず、実行して初めて
     落ちる）。既存スペック（`token-balance.spec.ts` 29行目等）と同じく
     ファイルのトップレベルへ移すこと（同一ファイルの UI-B-05 にも
     viewport が適用されることになるが、既存スペック群と同じ扱いで問題
     ないか実装担当が判断すること）
- **統括対応が必要な事項（実装の欠陥ではない）**:
  1. ブランチの分岐点（e1327b9）が #295/#296 のマージ前で、main への
     マージで `docs/ARCHITECTURE.md`・`docs/WORKLOG.md`・
     `packages/frontend/src/app/App.tsx` の3ファイルがコンフリクトする
     （`git merge-tree` で確認）。特に App.tsx は #296（フォーク色分け）と
     #298（リボン組み込み）が同じ領域を触っており、機械的な解消では
     済まない可能性がある。main を取り込んで解消したうえで、合流後の
     状態で build/lint/test を再実行すること（本レビューの合格判定は
     ブランチ単体の状態にのみ有効）
  2. 設計メモが統括に依頼しているバックログ起票2件の確認:
     (a) tx（TransactionEntity）の store 無制限蓄積の保持方針、
     (b) リボン×#296 フォーク判定の統合（`pickCanonicalPerNumber` の
     暫定ルールを #296 の成果物へ置き換える + 先端の縦並置。UX設計 §5 の
     拡張点）。#296 は main にマージ済みだが本ブランチは分岐が先行して
     いるため未統合のままであり、設計どおり「独立成立・後乗せ」の扱いで
     問題ない（今回のスコープに含める必要はない）
- 軽微な指摘（対応任意）:
  - `store-block-retention.test.ts` の最後のテスト
    （"does not disturb infra entities or edges..."）は名前に反して
    infra エンティティを実際には投入しておらず、block 件数の確認しか
    していない。テスト名どおりの検証にするなら node/edge を置いた状態で
    evict 後も残ることを確認すべき（コメントで自認しているため
    ブロッカーとはしない）

### 2026-07-12 Issue #298 差し戻し対応（frontend, chain-ribbon.spec.ts の test.use() 配置）

- 担当: frontend
- ブランチ: issue-298-block-stacking-visualization（cherry-pick 合流後の
  worktree で対応。旧 frontend 専用ブランチではない）
- 内容: レビュー差し戻し1件を修正した。`test.use({ viewport:
  OPERATION_PANEL_VIEWPORT })` をテスト本体（UI-B-06）の内側からファイルの
  トップレベルへ移した（既存4ファイルと同じ配置。UI-B-05 にも同じ
  viewport が適用されることになるがアサーションには影響しない）。
- 決定事項・注意点:
  - 実 Docker スタック（起動済みの `profiles/ethereum`）に対して
    `pnpm exec playwright test src/ui/chain-ribbon.spec.ts --project=chromium`
    を実行し、修正の効果を実測で確認した。UI-B-05 は完全に green（実行完了）。
    UI-B-06 は「`test.use()` の実行時エラーで即座に落ちる」という指摘の
    症状が完全に解消され（そのエラー自体は一度も再発しなかった）、実際の
    ステップ（送金・tx確定待ち・ホバー連動）を数十秒かけて実行するところ
    まで進むことを確認した
  - 実行中に**別の実バグ**を発見し、同じコミットで修正した:
    「tx を含むブロックのタイルにホバーする」ステップで
    `page.getByTestId(`wallet-tx-chip-${hash}`)`（ページ全体検索）が
    strict mode 違反（要素2件ヒット）で失敗していた。原因は
    `WalletEntity.recentTxHashes` が送信元・宛先の両方のウォレットで
    同じ tx を追跡するため、同じ tx hash の chip テストID が2枚の
    ウォレットカードに同時に存在すること。送信元ウォレットカード配下に
    スコープを絞ることで解消した
  - **UI-B-06 の完全な green 確認はこのセッション内では取れていない**。
    同じ固定ラベル（`e2e-ribbon-recipient`）の addWorkbench を、この
    長時間稼働中の共有 Docker スタックに対して検証のため何度も手動で
    再実行したことで、ベースラベルの workbench 追加が毎回 `-2`/`-3` の
    ような別IDへ逃げるようになった（一度使われたラベルをこの環境が
    再利用しない挙動によるもので、修正内容そのものの欠陥ではない。
    `wallet-balance.spec.ts`/`token-balance.spec.ts` も同じ固定ラベル
    方式を採っており、同じ環境で繰り返し手動実行すれば同様に汚染されうる
    という、このリポジトリの e2e テスト全体に共通する既知の脆さ）。
    副生成された `chainviz-ethereum-e2e-ribbon-recipient-*` コンテナの
    後始末は、sandbox の権限方針（パターンマッチでの検出はセッション内
    追跡と見なされず自動許可されない）によりこのセッションでは実行
    できなかった。統括・QA側で該当コンテナの要否を確認し、不要なら
    削除してほしい
  - QA には、汚染されていない（またはこのタスクで使ったラベルが未使用の）
    状態で `pnpm test:e2e:ui -- chain-ribbon` を一度実行し、UI-B-06 が
    最後まで green になることの最終確認を依頼する

### 2026-07-12 Issue #298 再レビュー（chainviz-reviewer, 差し戻し対応の確認）

- 担当: chainviz-reviewer
- 対象: コミット 54ab0d6（`chain-ribbon.spec.ts` の test.use() 配置修正 +
  strict mode 違反修正）および a0be512（worklog 追記）
- 判定: **合格**
- 確認した内容:
  - `test.use({ viewport: OPERATION_PANEL_VIEWPORT })` がテスト本体の
    内側からモジュールトップレベル（定数定義の直後）へ移動されている
    ことを確認。既存4ファイル（wallet-balance / token-balance /
    contract-lifecycle / form-validation の各 spec、いずれも29行目付近の
    トップレベル）と同じ配置パターン。前回差し戻しの欠陥（実行時エラーで
    UI-B-06 が即死する）は静的には解消
  - strict mode 違反修正の妥当性を実装側で裏取りした。
    `packages/collector/src/world-state/store.ts` の
    `linkTransactionToWallets()` は tx の from/to 両方に一致する
    WalletEntity の `recentTxHashes` へ同じ hash を追加するため、
    `wallet-tx-chip-<hash>` の testid が送信元・宛先の2枚のカードに
    同時に存在しうるのは事実。testid `wallet-tx-chip-` を出力するのは
    `WalletCard.tsx` のみ（WalletPopover / TxLifecyclePopover は CSS
    クラスのみで testid を持たない）で、`wallet-card-<address>` 配下に
    スコープすれば一意に定まる。修正は正しい
  - リポジトリ全体で `pnpm lint` / `pnpm build` / `pnpm test`
    （frontend 2003件を含む全パッケージ）がすべて green。
    `playwright test src/ui/chain-ribbon.spec.ts --list` で UI-B-05 /
    UI-B-06 の2件が登録されることも確認
  - コミット粒度: 54ab0d6 は「test.use() 移動」と「strict mode 違反修正」
    の2つの修正を含むが、後者は前者を直して初めて実行が到達・発覚した
    同一ファイル内の欠陥で、いずれも「UI-B-06 を実行可能にする」という
    同じ目的に属し、コミットメッセージにも両方が明記されている。
    許容範囲と判断（ブロッカーとしない）
- レビュー中に対応した事項:
  - a0be512 の worklog 追記が前セクション末尾の1行手前に挿入されており、
    結びの「ブロッカーとはしない）」が新セクションの末尾に取り残されて
    いた（文の分断）。worklog はレビュー担当が記録を書き込むファイルで
    あるため、レビュー側で該当行を元の文へ戻した（コミット 78192da）
- 未確認事項（QAへの引き継ぎ）:
  - UI-B-06 の実 Docker 環境での完全 green は本レビューでは未確認
    （動作検証は QA の担当。実装担当も worklog で QA での実行を依頼
    済み）。統括が残存コンテナ
    `chainviz-ethereum-e2e-ribbon-recipient-*` を削除済みとのことなので、
    QA は汚染のない状態で `chain-ribbon.spec.ts` を一度実行し、UI-B-06 が
    最後まで green になることを確認すること

### 2026-07-12 Issue #298 QA検証結果（差し戻し: UI-B-06 が再現性を持って失敗）

- 担当: qa
- ブランチ: issue-298-block-stacking-visualization（cherry-pick 合流後の worktree、working tree clean）
- 判定: **差し戻し（chainviz-frontend）**。第1段階（チェーンリボンの表示）は
  合格。第2段階のホバー連動ハイライト（UI-B-06）が実 Docker 環境で再現性を
  持って失敗し、完了条件「ホバー連動ハイライト(第2段階)も含む」を満たさない。

#### 検証環境

- 既存稼働中の共有 Docker スタック（`profiles/ethereum`）を再利用。検証開始時
  reth1 のブロック高は 9041、検証中も 2 秒スロットで進行し続けることを確認
  （終盤 9381 以降）。globalSetup が collector（4125）・vite dev（5275、
  `VITE_COLLECTOR_URL=ws://127.0.0.1:4125`）を起動し、実 collector に接続した
  状態で chromium から検証した（モックデータではない）。
- スタックには別セッションが追加した reth4/reth5・beacon4/beacon5（一部は
  同期途中）が存在した。これらは検証開始前から在ったもので QA の生成物では
  ない。

#### UI-B-05（合格）

- `chain-ribbon.spec.ts` を単体実行し、UI-B-05 は 2 回とも green（3.5s / 5.4s）。
  以下を実物で確認できた:
  - 無限キャンバス上にチェーンリボンカード（`chain-ribbon-card`）が表示される
  - タイル（`chain-ribbon-tile-<hash>`）が並び、ヘッダの最新ブロック番号
    （`chain-ribbon-latest`）が時間とともに増える（新ブロックが右端に積まれる）
  - タイルホバーでポップオーバーが開き、親ブロック行
    （`chain-ribbon-popover-parent-<hash>`）が表示される

#### UI-B-06（不合格・再現性あり）

- 3 回とも失敗（フルスイート実行時 1 回 + 単体実行 2 回）。症状は毎回同じで、
  「送金 → tx 確定（`wallet-tx-chip` が `data-status="included"` になる）→ その
  チップにホバー → 対応するリボンタイルが光る（`.chain-ribbon-tile--highlight`
  が 1 件になる）」の逆方向ハイライト待ちで、30 秒間ずっと 0 件のままタイムアウト
  する（`toHaveCount(1)` が 64 回のポーリングすべてで 0 を観測）。

- 再現手順:
  1. 汚染のない状態（`e2e-ribbon-recipient*` コンテナが無いこと）を確認
  2. `pnpm --filter @chainviz/e2e exec playwright test src/ui/chain-ribbon.spec.ts:86 --project=chromium`
     （globalSetup が実 Docker・collector・vite を起動）
  3. UI-B-06 が「チェーンリボンで、tx を含むブロックのタイルにホバーする」
     ステップで失敗する

- 原因調査（trace.zip の DOM スナップショット + reth RPC で裏取り）:
  - 失敗は「tx のブロックが最初から 8 タイルの表示窓の外にあった（窓外流出）」
    ためではない。単体実行 2 回目の trace で、ホバー実行時刻（ts≈18047ms）と
    直前の DOM スナップショット（ts≈18038ms、リボン最新 #9431）が一致しており、
    ホバー時点で tx の入ったブロック 9431（canonical hash
    `0x4e16e9d8…4cdd`、receipt の blockHash と一致）は最新タイルとして表示されて
    いた。
  - さらに trace のスナップショットには、ホバー直後に当該タイル
    （`chain-ribbon-tile-0x4e16e9d8…`）へ `chain-ribbon-tile--highlight` クラスが
    一度は付与された瞬間が記録されている。つまり逆方向ハイライトのロジック
    （`RibbonHoverContext.setHoveredTxHash` → `tx.blockHash` → タイルの
    `block.hash === hoveredBlockHash`）自体は正しく動作し、一瞬は光っている。
  - ところがそのハイライトは最初のアサーション・ポーリング（ホバーから約 470ms
    後）より前に消え、以後 30 秒間 0 のまま復帰しない。待機中にチェーンが進行して
    表示窓が #9431→#9447 へ前進し、当該タイルは 8 枠の窓から流れ出て二度と戻らない
    （窓は前進のみ）。

- 結論（メカニズム）: 逆方向ハイライトはホバー直後に一度は正しく点灯するが、
  **ライブの実チェーン（2 秒スロットで差分が流れ続け、追加ノードの同期も重なって
  再描画が頻発する状況）ではハイライトがほぼ即座に失われ、`toHaveCount(1)` が
  一度も 1 を観測できない**。ホバー状態が短時間で落ちる要因（頻繁な再描画で
  ホバー中のチップの下から要素が動き mouseleave が発生する等）と、待機中に対象
  タイルが 8 枠窓の外へ流れて戻らないことが重なっている。ユーザー体験としても
  「チップにホバーして対応ブロックが光るが、次のブロックが届いた瞬間に消える」
  という不安定さになり得る点で、実挙動上の不具合と判断する。

- 差し戻し先と扱い: chainviz-frontend。実装（ライブ更新中もホバー中はハイライトを
  保持させるか、対象タイルが窓外でも参照できるようにするか）と e2e スペック
  （単発ホバー後に 30 秒 `toHaveCount` を待つ前提が現状の挙動と噛み合っていない）は
  いずれも frontend 担当の範囲。どちらをどう直すかは統括・frontend の判断に委ねる
  （QA は挙動の事実と再現手順の報告に留める）。

#### その他の観測

- `pnpm test:e2e:ui -- chain-ribbon` は、`-- chain-ribbon` のフィルタが効かず UI 層
  スペック 35 件すべてを直列実行した（chain-ribbon への絞り込みにならない）。この
  フルスイート実行では chain-ribbon 以外にも複数スペックが失敗したが、7 分での
  タイムアウト・同期途中の追加ノードを含む多忙な共有スタックが原因と見られ、#298
  の退行ではない（chain-ribbon の判定は `chain-ribbon.spec.ts` の単体実行を根拠と
  した）。UI-B-06 のみを対象にしたい場合は
  `playwright test src/ui/chain-ribbon.spec.ts` のようにファイルパスで指定する。
- 既存のブロック伝播パルス・tx ライフサイクル表示の退行は、対象ファイルが未変更
  （査読済み）であり UI-B-05 実行時にアプリがクラッシュせず描画されたことから
  問題は観測されなかった。ただし本セッションでパルスを独立に走らせて目視確認は
  していない。

#### 後片付け

- 検証で追加された `e2e-ribbon-recipient` 系ワークベンチコンテナ
  （`chainviz-ethereum-e2e-ribbon-recipient-2` / `-2-3`）を `docker rm -f` で削除
  済み。メインスタック（reth1〜5・beacon・validator・test・workbench）には手を
  付けていない。残プロセス（collector 4125 / vite 5275 等）が残っていないことも
  確認済み。

### 2026-07-12 Issue #298 QA差し戻し対応（frontend, ホバー連動ハイライトの窓流出）修正方針

- 担当: frontend
- ブランチ: issue-298-block-stacking-visualization
- QA差し戻し要約: 逆方向ハイライト（tx/活動チップ → タイル）はホバー直後は
  正しく点灯するが、待機中にチェーンが進行してリボンの表示窓（直近8タイル）
  が前進し、ハイライト対象のタイルが窓外へ流出して二度と戻らない。実Docker
  環境で3/3回再現（詳細は直前の「Issue #298 QA検証結果」記録を参照）。
- 修正方針: **ホバー中（`RibbonHoverContext.hoveredBlockHash !== null`。
  順方向・逆方向どちらの由来でも共通の1状態）は、チェーンリボンのタイル列
  （表示窓）の前進自体を一時停止する**。コーディネーターから提示された
  2案のうち「表示窓の前進を止める」を採用する。理由:
  - 「ホバー中はハイライト状態だけ保持する」案は、対象タイルが物理的に
    描画されなくなる（`tiles` 配列から消える）以上、ハイライトを表示する
    先が無く根本解決にならない（「消えたタイルの情報だけ保持」しても画面上
    何も光らせられない）
  - 表示窓を止める方式なら、順方向（タイル自体をホバー）・逆方向（他カード
    のチップをホバー）のどちらでも同じ1つの状態
    （`hoveredBlockHash !== null`）で一貫して機能し、`RibbonHoverContext`
    が既に採用している「単一の状態に一本化する」設計方針とも整合する
  - 副作用として「ホバー中は新しいブロックが滑り込んでこない」という
    UXになるが、これは一般的な「ツールチップ/詳細を読んでいる間はリストの
    自動更新を止める」パターンと同種で、不自然ではないと判断する
- 実装の置き場所: 表示窓の前進停止は `entities/ChainRibbonCard.tsx`
  （タイル列を実際にレンダリングするコンポーネント）に閉じる。
  新規フック `entities/useFrozenRibbonTiles.ts` を追加し、
  `useRibbonHover().hoveredBlockHash !== null` の間は直前のタイル配列
  スナップショットを返し続け、null に戻ったら最新の配列に追従を再開する
  （App.tsx 側のタイル導出・ノードデータ組み立てには一切手を入れない。
  「ライブの実データ導出」と「表示用に凍結するかどうか」を分離する）。
  ref を useMemo コールバック内で更新するパターンは、本ファイル内の
  `App.tsx`（`previousInfraNodesRef` 等）で既に使われている書き方に揃える
- 既知の残課題（今回のスコープ外。QAが再現した主症状の解消を優先）:
  タイル自身を直接ホバー → ポップオーバーの「親ブロック」行へマウス移動する
  経路では、タイル本体からの `mouseleave` で `hoveredBlockHash` が即座に
  null へ戻る（ポップオーバー自体は `useHoverPopover` の200ms遅延クローズで
  開いたままになる）ため、その一瞬だけ表示窓の凍結が解除される。実運用では
  ブロック生成間隔（2秒程度）に対してこの遷移は一瞬で完了するため実害は
  ほぼ無いと判断するが、将来この経路も含めて完全に安定させたい場合は
  ポップオーバー表示中も凍結を維持する設計（例: 「いずれかのタイルの
  ポップオーバーが開いている」も凍結条件に含める）を検討すること

### 2026-07-12 Issue #298 QA差し戻し対応（frontend, ホバー連動ハイライトの窓流出）実装・検証

- 担当: frontend
- ブランチ: issue-298-block-stacking-visualization
- 内容: 上記方針どおり `entities/useFrozenRibbonTiles.ts`（新規。テスト5件）
  を実装し、`entities/ChainRibbonCard.tsx` から
  `useFrozenRibbonTiles(data.tiles, hoveredBlockHash !== null)` として利用
  する形に変更した。`ChainRibbonCard.test.tsx` に3件追加（凍結中は流出しない
  ・解除後に最新へ追従・逆方向ホバー由来でも同様に凍結する、をそれぞれ確認。
  カード外からのホバーを模す `ReverseHoverProbe` を追加）。
  `pnpm --filter @chainviz/frontend build && test` は成功（132ファイル/2011
  テスト）。`tsc --noEmit`・`eslint` も成功。
- 実Docker環境での検証:
  - `chain-ribbon.spec.ts` を実Docker環境（起動済みの `profiles/ethereum`。
    このセッション中に他ワークトリー由来と見られる reth3〜5/beacon3〜5 が
    追加され、スタックが以前よりかなり混雑していた）に対して複数回実行した。
  - **1回目**: UI-B-05/UI-B-06 とも green（それぞれ5.4秒・5.5秒）。修正の
    効果を直接確認できた
  - **2〜4回目**: UI-B-06 が失敗したが、いずれも「`.chain-ribbon-tile
    --highlight` の `toHaveCount(1)` 自体は成功した後、その次の行
    （`getAttribute`）でテスト全体のタイムアウトに到達する」という同一の
    失敗パターンだった。これは「ハイライトは実際に点灯し、消えずに残って
    いた」ことの証拠であり（`toHaveCount(1)` が失敗した場合は当然その行で
    別のエラーになる）、**QAが報告した「一瞬点灯した後に消えて戻らない」
    という不具合そのものは複数回とも再現しなかった**。純粋にステップの
    直列待ち（addWorkbench最大30秒 + tx確定最大30秒 + ハイライト反映最大
    30秒）の合計が、混雑した共有スタックでは既定のテストタイムアウト
    （60秒、次いで拡大後の150秒）を超えることがある、という実行時間の
    問題だった（`test.setTimeout` を p2p-graph.spec.ts の前例に倣って
    3×OPERATION_EFFECT_TIMEOUT_MS+60秒まで拡大したが、混雑度によっては
    それでも足りないことがあった）
  - ラベル固定方式（他の e2e ファイルと同じ慣習）だと、この長時間稼働の
    共有スタックに対して同じスペックを何度も手動実行しただけでベースラベル
    が恒久的に使用済み扱いになり、`addWorkbench` が毎回別IDへ逃げて
    `infra-card-<base id>` の待ちがタイムアウトする不安定さも複数回発生
    した。`chain-ribbon.spec.ts` のワークベンチラベルに実行時刻
    （`Date.now().toString(36)`）を含めて一意化し、この不安定さを解消した
    （他ファイルの固定ラベル方式は今回のスコープ外として変更していない）
- 後片付け: 検証中にタイムアウトで `finally` の後始末が完走できなかった
  ワークベンチ3件（`e2e-ribbon-recipient-mrhphike-5` / `-3-4` / `-2-3`。
  いずれもこのセッション自身の直前の実行で作成した、id が既知のもの）を、
  アプリの `removeWorkbench` コマンド経由（一時的な確認用 Playwright
  スクリプトで、パターン検索ではなく上記の既知の正確な id を指定）で削除
  した。カード自体は削除に成功したが、対応する Docker コンテナが
  `docker ps` 上は "Up" のまま残っているのを確認した（collector 側の
  コンテナ停止処理のタイミング/挙動の可能性があり、frontend 側からは
  これ以上追えない。統括・QAで要確認）
- 結論: QAが報告した不具合（ホバー直後にハイライトが消えて復帰しない）は
  修正により解消したことを実機で複数回確認した。残る e2e の不安定さは、
  この特定の検証セッション中に混雑した共有 Docker スタックの実行時間
  ばらつきに起因するものであり、修正の正しさとは別軸の課題として記録する。
  QA には、比較的空いている状態での `chain-ribbon.spec.ts` 最終確認を
  依頼したい

### 2026-07-12 Issue #298 再レビュー（chainviz-reviewer, QA差し戻し対応の確認）

- 担当: chainviz-reviewer
- 対象: コミット b929a90（表示窓の凍結フック `useFrozenRibbonTiles` +
  `ChainRibbonCard` への組み込み + テスト + e2e頑健化 + worklog追記）
- 判定: **差し戻し（chainviz-frontend、1件）**。実装本体・修正方針は問題
  なし。テスト1件が「壊れたコードでも通る」状態であることが確認されたため、
  その修正のみ差し戻す。

#### 差し戻し内容（frontend担当）

1. `packages/frontend/src/entities/ChainRibbonCard.test.tsx` の
   「also freezes for the reverse direction (hoveredBlockHash set from
   outside via context, not from this tile)」が、**修正前のコード（凍結
   フックを使わない `ChainRibbonCard`）でも合格してしまう**。レビュー時に
   `b929a90^` の `ChainRibbonCard.tsx` を一時的に復元して確認したところ、
   凍結テスト3件のうち前2件は正しく失敗する（退行を検出できる）が、この
   3件目だけは通った（確認後、working tree は元に戻し済み）。原因は、
   プローブで `0x2` をホバーした後の前進後タイル列を
   `tilesB = [0x2, 0x3]` としているため、凍結が無くても `0x2` が live
   タイルとして描画され続け、「`0x2` が存在しハイライトされている」という
   アサーションが成立してしまうこと。QA差し戻しの主症状はまさに逆方向
   ホバー由来の窓流出であり、その方向を担保すると称するテストが退行を
   検出できないのは「意味のないテスト」（CLAUDE.md 品質ゲート運用ルール）
   に該当する。修正案: 1件目のテストと同様に「凍結の証拠」をアサートする
   （前進後も `0x1` が残存し `0x3` が現れないことを確認する、または
   `tilesB` を `[0x3, 0x4]` のようにホバー対象 `0x2` が窓外へ出る構成に
   して `0x2` の残存を確認する）。修正後、修正前コードで実際に失敗する
   ことを確認してから復元すること（CLAUDE.md「回帰テストが元の不具合を
   検出できることを意図的に壊した状態で確認する」。今回の worklog には
   この確認の記録が無く、実際に1件すり抜けていた）。

#### 合格と確認した内容

- 修正方針（ホバー中は表示窓の前進を一時停止する「凍結」）は妥当。
  「ハイライト状態だけ保持する」案ではタイル自体が描画されなくなるため
  根本解決にならないという棄却理由も正しい。`RibbonHoverContext` の
  「単一の `hoveredBlockHash` に一本化」した既存設計と整合し、順方向・
  逆方向のどちらの由来でも同じ条件で凍結される。UX設計・ARCHITECTURE.md
  §9 の決定事項（既存表現の維持・エンティティ化しない・App.tsx の live
  導出は不変）との矛盾なし
- `useFrozenRibbonTiles.ts` の実装は正しい。凍結開始時のスナップショット
  捕捉（`snapshotRef` が null のときのみ代入）・解除時のリセット（`frozen`
  が deps に含まれるため false へ戻る描画で必ず再計算されクリアされる）・
  初回描画から frozen の場合、いずれも整合。レンダー中の ref 更新は
  冪等で StrictMode の二重実行にも安全（App.tsx の既存パターンと同型）。
  スナップショットは最大タイル8件で解除時に解放されるためメモリリークの
  懸念なし
- トレードオフ「凍結中は着地アニメーションが見えない」は許容範囲。
  `landingHashes` は live のまま渡るため、解除時に鮮度ガード（6秒）内の
  新着タイルは遅れて着地演出され、ガード外なら演出なしで並ぶだけ。
  別の問題（クラッシュ・不整合）は生まない。凍結中に evict された
  ブロックのタイルも `txCountByHash.get` が undefined を返すだけで安全。
  タイル→ポップオーバー親ブロック行への遷移で一瞬凍結が解ける既知の
  残課題は worklog に明記済みで扱いも妥当
- `useFrozenRibbonTiles.test.ts` の5件（素通し・凍結・追従再開・再凍結
  時の新スナップショット・初回から frozen）はフック単体の仕様を過不足
  なく検証しており良質。`ChainRibbonCard.test.tsx` の1・2件目も修正前
  コードで失敗することを実測確認した
- e2e のワークベンチラベル一意化（`e2e-ribbon-recipient-<base36時刻>`）は
  他スペックの固定ラベル（`e2e-ui-c-recipient` / `e2e-ui-c-token-recipient`）
  と接頭辞が異なり衝突しない。`test.setTimeout` は定数
  `OPERATION_EFFECT_TIMEOUT_MS` からの導出+根拠コメント付きで固定値
  ルール準拠。`finally` の後始末も id 指定で維持されている
- `pnpm build` / `pnpm lint` / `pnpm test` 全パッケージ green
  （shared 62 / collector 1322 / frontend 2011 / e2e 158）
- エラー握りつぶし・チェーン固有語彙の漏れ・境界違反: 新規コードに無し

#### 軽微な指摘（対応任意）

- b929a90 は「凍結フック導入」と「e2e頑健化（タイムアウト拡大・ラベル
  一意化）」の2つの関心事を含む。いずれも UI-B-06 の QA差し戻し対応と
  いう同一目的に属しコミットメッセージにも両方明記されているため
  ブロッカーとしないが、厳密には分割が望ましかった

#### 統括対応が必要な事項（実装の欠陥ではない）

- main との合流時コンフリクトが前回レビュー時より拡大している。
  `git merge-tree` で確認したところ、#299 等のマージにより現在は
  `docs/ARCHITECTURE.md` / `docs/WORKLOG.md` / `App.tsx` / `Canvas.tsx` /
  `i18n/messages.ts` の5ファイルがコンフリクトする。マージ時に解消し、
  合流後の状態で build/lint/test を再実行すること
- `docs/PLAN.md` の #298 注記が「修正中」のまま。QA合格後にチェックと
  併せて注記を更新すること

### 2026-07-12 Issue #298 再レビュー差し戻し対応（frontend, 意味のない逆方向凍結テストの修正）

- 担当: frontend
- ブランチ: issue-298-block-stacking-visualization
- 差し戻し要約: `ChainRibbonCard.test.tsx` の凍結テスト3件目
  （"also freezes for the reverse direction"）が、`tilesB` にホバー対象の
  `0x2` を残したまま（`[0x2, 0x3]`）窓前進を模していたため、凍結フックが
  無くても `0x2` は liveTiles 由来でそのまま描画・ハイライトされてしまい、
  退行を検出できない「意味のないテスト」になっていた（`b929a90^` で実測
  確認済み、との指摘）。
- 修正: `tilesB` を、ホバー対象が完全に窓外へ流出する構成
  （`[tile("0x3"), tile("0x4")]`。`0x2` を含めない）に変更した。あわせて
  1件目のテストと同様に「新規タイル（0x3/0x4）がまだ見えていないこと」も
  明示的にアサートし、「凍結によって古いタイルが残っている」ことと「凍結
  によって新しいタイルの反映が止まっている」ことの両方を検証するようにした。
- **回帰検出能力の実機確認**（CLAUDE.mdの品質ゲート運用ルールに従い実施）:
  1. `packages/frontend/src/entities/ChainRibbonCard.tsx` を一時的に
     `b929a90^`（凍結フック導入前のバージョン。`git show b929a90^:...`
     で取得）へ差し替え、修正後のテストファイルのままで
     `pnpm vitest run src/entities/ChainRibbonCard.test.tsx` を実行した
  2. 結果: 16件中13件は合格、**凍結関連の3件（1・2・3件目すべて）が
     期待どおり失敗した**。3件目は
     `screen.getByTestId("chain-ribbon-tile-0x2")` が要素を見つけられずに
     落ちており、「凍結が無ければ 0x2 は描画されずテストが検出する」ことを
     直接確認できた
  3. `ChainRibbonCard.tsx` を修正版（`git show b929a90:...` と同一内容）へ
     戻し、`pnpm vitest run src/entities/ChainRibbonCard.test.tsx` で
     16件全て合格することを再確認した（差し戻し前と差分無しであることも
     `diff` で確認済み）
- `pnpm --filter @chainviz/frontend build && test`: 成功（132ファイル/2011
  テスト）。`tsc --noEmit`・`eslint` も成功

### 2026-07-12 Issue #298 再々レビュー（reviewer, 逆方向凍結テスト修正の確認・合格）

- 担当: reviewer
- 対象: 958960c（`ChainRibbonCard.test.tsx` の凍結テスト3件目の修正）
- 判定: **合格**

#### 確認した内容

- 前回差し戻した問題（3件目のテストが修正前コードでも合格してしまう）の
  解消を、実装担当の報告を鵜呑みにせず自分の手で再現確認した:
  1. `ChainRibbonCard.tsx` を一時的に `b929a90^`（凍結フック導入前）へ
     差し替えてテストを実行 → 16件中3件（凍結関連の1・2・3件目すべて）が
     失敗。3件目も確かに失敗するようになった
  2. `git checkout` で復元し `git status` がcleanであることを確認 →
     16件全件合格に復帰
- テストの構成も妥当: `tilesB = [0x3, 0x4]` でホバー対象 `0x2` が窓外へ
  完全流出する体になっており、凍結が無ければ最初のアサーション
  （`getByTestId("chain-ribbon-tile-0x2")`）で即失敗する。加えて
  「新規タイル 0x3/0x4 がまだ見えないこと」のアサートも追加され、
  1件目のテストと対称的な検証になった。差し戻し経緯を説明する
  コメントも付いており、後から読む人が意図を追える
- worklog の「回帰検出能力の実機確認」の記録（前節）は、上記の再現結果と
  完全に一致しており正確
- 958960c が `ChainRibbonCard.tsx` 本体に触れていないこと（実装は
  b929a90 版のまま）を `git show --stat` で確認。テストファイルと
  worklog のみの変更で、修正とその記録という同一関心事の1コミット
- テストファイル全体を通読し、他の15件に同種の問題（実装が壊れていても
  通ってしまうアサーション）が無いことを確認
- `pnpm build` / `pnpm lint` / `pnpm test` リポジトリ全体で成功
  （shared 62 / collector 1322 / frontend 2011 / e2e 158）。collector の
  テスト出力に見える "failed to decode" 等のログは異常系テストが意図的に
  出させているもので、テスト自体は全件合格

#### 統括への申し送り（前回から変わらず）

- main との合流時コンフリクト（5ファイル）の解消と、合流後の
  build/lint/test 再実行
- `docs/PLAN.md` の #298 注記の QA 合格後更新
