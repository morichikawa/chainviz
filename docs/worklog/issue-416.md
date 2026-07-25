# Issue #416 eclipse攻撃のシミュレーション砂場を実装する

### 2026-07-25 Issue #416 UX設計（ux）

- 担当: ux
- ブランチ: issue-416-eclipse-attack-demo
- 前提: Issue #412の設計フェーズ（`docs/ARCHITECTURE.md` §17.5.3・§17.6、
  `docs/worklog/issue-412.md`）で概念モデル・判定ロジックの原則は決定済み。
  本設計はそれを実装着手可能な粒度（操作フロー・図解レイアウト・
  インタラクション・文言・入口配置）まで具体化する。実装（#416本体）は
  この設計を引き継いだ chainviz-frontend が行う。

#### 0. 事前確認したこと

- `pnpm --filter @chainviz/frontend dev` でモックデータ環境を起動し、
  既存の学習用砂場（Issue #401「ハッシュのしくみ」）を実際に開いて操作した
  （チェーンリボンカードの「ハッシュのしくみを試す」ボタン→サイドパネル
  →データ編集→無効化→つなぎ直し、の一連を実機確認）。「編集できる入力
  枠 → 処理帯（f(x)+関数名） → 導出値 → 有効/無効バッジ」という型と、
  ブロック間の縦の連結線（有効=実線・無効=破線+警告色）を実際の画面で
  確認した
- 同じ環境で `PeerNetworkLegend`（画面右下、ネットワーク別の色チップ+
  接続数+ヒント文）の実表示も確認した。ピアエッジが1本もない場合は
  非表示になること、パネル幅が200〜260pxの小さい常設オーバーレイである
  ことを実測した
- ソースコードを読み、以下の既存パターン・値を確認した:
  - `packages/frontend/src/entities/peerEdge.ts`: ピア接続（紐）の色は
    `NETWORK_COLORS`（6色パレット、networkIdのハッシュから決定）、
    `stroke-width: 2`・`stroke-opacity: 0.85`。この砂場は実
    networkIdを持たないため、既存の「ピア接続」全般を指す青
    `#7db8ff`（`.pending-connection-edge--peer`・`.connecting-edge`で
    既に「まだ実データが来ていないピア接続」の色として使われている）を
    正規ピアの色として流用する
  - `packages/frontend/src/styles.css`: 危険/無効を表す色として
    `#ff6b6b`（`.toast--error`・`.operation-form__error`・
    `hash-chain-demo__connector--broken`で使用済み）が既に確立している。
    P2P系の色体系（`NETWORK_COLORS`6色・`--own-edge`琥珀・
    `--op-edge`マゼンタ・`--contract-edge`インディゴ・
    `--internal-edge`シルバー・`--fork-color-a/b`ゴールド/シアン）には
    赤系が1色も含まれないため、攻撃者ピアの専用色として転用しても
    既存パレットと衝突しない
  - `InfraNodeCard`のフォーク時のoutline切り替え（枠のborder-color/
    box-shadowを状態に応じて変える手法。`docs/ARCHITECTURE.md` §9）は、
    「ノードが特別な状態にあることをoutlineで示す」という視覚言語として
    再利用できる
  - `packages/frontend/src/crypto-demo/HashChainDemoView.tsx`・
    `HashChainBlockRow.tsx`: パネルはkindごとにローカル`useState`で
    完結し、開き直すと初期状態に戻ること、`data-testid`の命名規則
    （`{demo名}-{要素}-{識別子}`）、`hashDemo.*`名前空間のi18nキー構成、
    フラッシュ演出（`NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`の流用）を確認した
  - `docs/worklog/issue-402.md`（署名検証デモ）: 「攻撃者」を扱う既存の
    唯一の前例。固定の疑似鍵ペア（Alice役・攻撃者役）を持ち、「攻撃者の
    鍵で署名し直しても、数学的には正しい署名になるが復元されるアドレスは
    攻撃者のものであり、なりすましは成立しない」という「本物の計算が
    実際に攻撃を退ける」体験を作っている。eclipse攻撃デモも同じ精神
    （攻撃側の操作も実ロジックで処理し、結果は演出でなく計算で決まる）を
    踏襲する
  - `ChainRibbonCard.tsx`のsubtitle-row・`ChainRibbonPopover.tsx`:
    Issue #401の入口配置の実例（カード常設ボタン1つ+ポップオーバー内
    文脈導線1つ）を確認した
- スクリーンショットは`pnpm --filter @chainviz/frontend dev`
  （`--host 0.0.0.0`で起動）+ Docker上のPlaywright
  （`mcr.microsoft.com/playwright:v1.61.1-jammy`、ホストの
  ChromiumがOS依存ライブラリ不足で起動できなかったための代替手段）で
  取得し、実際のキャンバス全体・ハッシュのしくみデモ・P2P凡例の見た目を
  確認した

#### 1. 何が伝わっていないか（現状の課題）

- 現状、eclipse攻撃という言葉も概念も画面のどこにも存在しない
  （glossaryへの追加はIssue #413で別途行われる）。この砂場が無いと、
  「ピア接続数が増える」ことは`PeerNetworkLegend`で見えても、「その
  ピアが誰なのか信頼できるとは限らない」「接続相手が偏ると何が起きるか」
  という危険性は一切体験できない
- 既存の暗号デモ2つ（ハッシュ・署名）は「1つのモノ（ブロック/tx）が
  改ざんされたときに何が起きるか」を扱うのに対し、eclipse攻撃は
  「複数の接続relationshipの構成比が変わったときに何が起きるか」という
  質的に異なるテーマ。単純に同じ「編集できる入力→処理帯→導出値→
  検証バッジ」のテンプレートを流用すると、「入力」に相当するものが
  存在せず、当てはまらない。図解そのものを新規に設計する必要がある
  （Issue #412設計メモの結論どおり）

#### 2. 設計判断

**表示場所**: サイドパネルの新kind `eclipseAttackDemo`（既に
`docs/ARCHITECTURE.md` §17.5で決定済み。#401/#402と同じ理由でモーダルや
ポップオーバー組み込みは採らない）。

**データソース**: 完全に独立した疑似データ（砂場）。実チェーン・実P2P
接続には一切影響しない。パネルを開くたびに初期状態（後述）から始まる。

**「本物の判定ロジック」の具体化**: `docs/ARCHITECTURE.md` §17.5.3が
指定する「攻撃者ピアの占有率が100%に達した時点で見え方が切り替わる」を、
以下のように具体化する。

- 被害ノードは固定8スロットを持つ（§17.5.3の「例8個」をそのまま確定値
  として採用。3ブロック固定のハッシュデモ・5〜7バリデーターの51%攻撃
  デモと同様、学習用砂場は具体的な固定値で見せたほうが分かりやすい）
- **初期状態は8/8スロットすべてが正規ピアで占められている**（「これが
  健全な接続状態」という基準点をまず見せる）。ユーザーが「攻撃者ピアを
  追加」ボタンを押すたびに、固定順（後述のスロット順）で次の正規ピア
  スロットが1つ攻撃者ピアに置き換わる（1クリック=1スロット。#412の
  「1つずつ追加していく」という記述に対応）
  - この「初期満員→徐々に乗っ取られる」モデルを採った理由: 「徐々に
    スロットが埋まる」という原文は「空→埋まる」とも「正規→攻撃者に
    置き換わる」とも読めるが、後者のほうが「攻撃前は普通に健全接続
    していた」という比較対象を最初に見せられ、eclipse攻撃の実際の脅威
    （既に確立している接続が乗っ取られていく）に近い。これは私の
    UX設計判断として採用した（技術的な後戻りが困難な決定ではないため
    ユーザー確認は求めず、判断理由をここに明記するに留める）
- 占有率 = 攻撃者ピア数 / 8。占有率が1（8/8）に達した瞬間だけ、
  「被害ノードが見ているチェーン」の表示内容を実際に実チェーン風の
  疑似データ（正規）から攻撃者提供の疑似データ（偽）へ切り替える
  （占有率が7/8のように100%未満のときは、たとえ7個が攻撃者でも
  正規の見え方のまま——「1本でも正規ピアとの接続が残っていれば
  真実に到達できる」という単純化されたが実際のP2P/gossipの直感に
  沿ったロジックにする）
- 全スロットが攻撃者になった後は「攻撃者ピアを追加」ボタンは押せる
  スロットが無いため無効化する。「リセット」ボタンで8/8正規ピアの
  初期状態に戻す（このとき見え方も正規チェーンへ戻る）

**既存可視化との視覚的な結びつき**:

- 正規ピアの接続線: `#7db8ff`（既存の「ピア接続確立中」表現で使われて
  いる青。stroke-width 2, opacity 0.85 でメインキャンバスのピアエッジと
  同じトーン）
- 攻撃者ピアの接続線・チップ: 新規の専用色。既存のP2P/エッジ色パレット
  （`NETWORK_COLORS`6色・`--own-edge`・`--op-edge`・`--contract-edge`・
  `--internal-edge`・フォーク色2色）のどれとも衝突しない赤系を使う。
  具体的には既存の危険/無効色 `#ff6b6b`（`hash-chain-demo__connector
  --broken`等で既に「壊れている」ことを示す色として使われている）を
  再利用することを推奨する。理由: (a) 新規に似て非なる赤を増やすより、
  「危険・信頼できない」という既存の意味づけをそのまま流用するほうが
  一貫性がある、(b) この色は既にダーク背景でのコントラストが検証済み
  （Issue #32のコントラスト調整の対象色ではないが、同系統の
  `--fork-color-a/b`同様に彩度の高い色でありダーク背景での視認性は
  問題ない実績がある）。CSS変数名（例: `--attacker-peer`）を新設するか
  リテラルを直接使うかは実装判断に委ねる
- 被害ノードのステータス表現: `InfraNodeCard`のフォーク時outline切替
  （枠のborder-color/box-shadowを状態に応じて変える手法）と同じ視覚
  言語を再利用する。平常時は`--synced`（既存の同期済み表現に使われる
  緑）のoutline、完全包囲時は攻撃者色のoutlineに切り替える

#### 3. デモパネル「eclipse攻撃のしくみ」の仕様

**状態モデル**(パネル内ローカル`useState`で完結。閉じたら破棄、開き直すと
常に初期状態):

```ts
type PeerSlotState = "honest" | "attacker";

interface EclipseAttackDemoState {
  /** 固定8要素。インデックス = スロット順(後述のクロックポジション)。 */
  slots: readonly PeerSlotState[]; // 初期値: "honest" が8個
}

// 導出値(stateに持たない):
//   attackerCount(state)   = slots.filter(s => s === "attacker").length
//   occupancyRatio(state)  = attackerCount(state) / slots.length  // 0〜1
//   isFullyEclipsed(state) = occupancyRatio(state) === 1
//   visibleChain(state)    = isFullyEclipsed(state) ? FAKE_CHAIN_BLOCKS : REAL_CHAIN_BLOCKS
//     (REAL_CHAIN_BLOCKS/FAKE_CHAIN_BLOCKS はどちらも固定の疑似データ。
//      hashChainDemoのように実計算までは必要ない — このデモの「本物の
//      計算」は占有率の算出と閾値判定そのもの)

// 操作:
//   addAttackerPeer(state): 先頭から見て最初の "honest" スロットを
//     "attacker" に置換した新state。全スロットが既に "attacker" なら
//     何もしない(呼び出し側はボタンをdisabledにして到達させない)
//   resetEclipseAttackDemoState(): 8スロットすべて "honest" の初期state
```

**レイアウト**（縦方向に上から）:

1. 導入文（`eclipseDemo.intro`。砂場であること・実際の接続には影響しない
   こと・操作方法の要約）
2. **ミニ包囲グラフ**（本デモの主役。図解を重視するという要望への回答）
   - 正方形の描画領域（目安280×280px。サイドパネル最小幅300pxでも収まる
     サイズ）に、SVGで以下を描く:
     - 中央: 被害ノードチップ（角丸長方形、幅100px程度、ラベル
       「被害ノード」）。outlineは平常時`--synced`色、完全包囲時は
       攻撃者色に切り替え、切り替わった瞬間は短いパルス/グロー演出
     - 周囲: 8個のピアスロットを、中央から半径110px、時計の12時位置を
       スロット0として時計回りに45度刻みで配置（0=12時, 1=1:30,
       2=3時, 3=4:30, 4=6時, 5=7:30, 6=9時, 7=10:30）。この順序が
       「攻撃者ピアを追加」を押したときにスロットが置き換わっていく
       固定順になる（ユーザーが目で追いやすい規則的な進行）
     - 各スロット: 小さい円チップ（直径28〜32px）。正規ピアは青
       `#7db8ff`の塗り、攻撃者ピアは攻撃者色の塗り。色だけに頼らない
       ため、チップ内に簡易アイコン（正規=✓や単純な点、攻撃者=!や
       ×等)を入れるか、チップの外側に短いラベル（「正規」「攻撃」）を
       添える。最終判断は実装時のスペース制約次第でよいが、色のみでの
       区別は避けること（アクセシビリティ）
     - 中央から各スロットへの直線: 正規ピア→`#7db8ff`(stroke-width 2,
       opacity 0.85)、攻撃者ピア→攻撃者色（同太さ）。メインキャンバスの
       ピアエッジと同じトーンに揃える
   - スロットが「置き換わった」瞬間、そのスロットのチップと線を短く
     フラッシュ（`hashChainDemo`のハッシュ値フラッシュと同じ演出方針・
     同じduration定数を流用してよい）
3. **占有率メーター**: 横棒（幅いっぱい）。攻撃者色で「攻撃者n/8」分だけ
   埋まる。テキストで「攻撃者ピア: n / 8（m%）」を併記（色だけに頼らない）。
   `aria-live="polite"`にして、スクリーンリーダーでも変化が伝わるように
   する（この砂場が初めてこのパターンを使うことになるが、値が操作の
   たびに変わる要約情報であり有用と判断した）
4. **操作行**: 「攻撃者ピアを追加」ボタン（8/8到達で自動的に
   disabled+文言変化）、「リセット」ボタン（常時押せる）
5. **被害ノードが見ているチェーン**: 3ブロック程度の簡易タイル列
   （`HashChainBlockRow`ほど詳細ではなく、番号+短い内容+バッジのみの
   軽量表示）。占有率<100%のときは正規の内容（例:
   「#1 Alice→Bob: 3 ETH」「#2 Bob→Carol: 1 ETH」「#3（最新）」）+
   `--synced`色バッジ「ネットワーク全体と一致しています」。占有率が
   100%になった瞬間、内容が別の疑似データ（例: 「#3
   Carol→攻撃者: 50 ETH」のような、明らかに被害ノード単体でしか見えて
   いない怪しい内容）+攻撃者色バッジ「攻撃者だけが見せている内容です」
   に切り替わる。バッジはアイコン+文言（色だけに頼らない）
6. 完全包囲時のみ表示する強調文（`eclipseDemo.eclipsedWarning`）:
   「被害ノードの接続スロットがすべて攻撃者に占められました。今、この
   被害ノードは攻撃者だけが作る偽のネットワークの中にいます。」
7. 常設の「リセット」ボタン（4と重複させず、4の操作行にまとめてよい。
   実装時にレイアウト都合で1箇所に統合して構わない）
8. フッター注記2本（`hashDemo.whoComputes`/`simplifiedNote`と同型）:
   - 簡略化注記: 「実際のeclipse攻撃では、攻撃者は多数の異なる身元
     （Sybil）を用意し、ノード発見の仕組み自体（ルーティングテーブル）
     を操作して接続を乗っ取ります。この砂場では『スロットが1つずつ
     攻撃者に置き換わる』という部分だけに絞って簡略化しています」
   - 防御の説明: 「実際のノードは、ブートノードだけでなく
     discv5（ノード発見）を通じて多様な相手から接続先を集めるほか、
     信頼できる固定ピア（static peer）を明示的に指定することで、
     すべての接続を攻撃者に握られるリスクを減らしています」
     （`discovery`/`bootnode`のglossaryエントリへ`GlossaryTerm`または
     `withTermAnchor`で軽く接続してよい。必須要件ではない）

**操作フロー**（まとめ）:

1. 開いた直後: 8/8正規ピア、被害ノードは平常状態、見ているチェーンは
   正規。導入文を表示
2. 「攻撃者ピアを追加」を押すたびに、固定順で次の正規スロットが攻撃者に
   置き換わり、占有率メーターが増える。見ているチェーンはまだ正規のまま
   （7/8までは変化しない）
3. 8回目の追加で占有率100%に到達した瞬間: 被害ノードのoutlineが攻撃者色
   に切り替わり、「見ているチェーン」の内容が偽データへ切り替わり、
   強調文が現れる。「攻撃者ピアを追加」ボタンは無効化される
4. 「リセット」でいつでも初期状態（8/8正規、正規の見え方）へ戻せる

#### 4. 入口の配置

**単一の入口: `PeerNetworkLegend.tsx`（画面右下のP2P凡例）に置く。**

- 理由:
  - `docs/ARCHITECTURE.md` §17.4が、eclipse攻撃のglossary用語アンカーの
    配置先として既にこのコンポーネントを指定している（「ノードの接続
    ピアという主題がこの凡例と直接対応するため」）。砂場の入口も同じ
    理由でここに置くのが最も文脈に合う
  - Issue本文が懸念する「チェーンリボンカードのsubtitle-rowにボタンが
    並びすぎる」問題は、51%攻撃・ロングレンジ攻撃（どちらもチェーン/
    フォークが主題でチェーンリボン起点が妥当）の懸念であり、eclipse攻撃
    はそもそもテーマがP2Pピア接続でチェーンリボンとは文脈が異なる。
    チェーンリボンに入口を置かない判断をすることで、この懸念にも
    自然に抵触しなくなる
  - ノードカード（`InfraNodeCard`/`InfraPopover`）に入口を置く案も検討
    したが不採用: このデモは「架空の被害ノード1つ」を扱う独立した砂場で、
    実際のどのノードにも対応しない。特定の実ノードカードに入口を置くと
    「このノードが攻撃されている/されうる」という誤った対応関係を
    ユーザーに与えかねない。`PeerNetworkLegend`はどの実ノードにも
    紐付かない「ネットワーク全体」を俯瞰する場所であり、砂場の抽象度
    （実ノード非依存）と一致する
  - ピアエッジのホバーポップオーバー（`PeerEdgePopover.tsx`）への追加も
    検討したが不採用: このポップオーバーは純粋にホバーで出入りする一時
    UIで、クリック可能なボタンを載せると離脱によりホバーが切れて掴み
    にくい（Issue #401設計メモが同じ理由でデモ本体をポップオーバーへ
    埋め込むことを避けた判断と同種）。ChainRibbonPopoverの
    「ハッシュのしくみを試す」ボタンとは異なり、`PeerEdgePopover`は
    「開いたまま維持されるカード内蔵ポップオーバー」ではなく素のホバー
    ツールチップに近いため、同列に扱わない
- 具体的な配置: `PeerNetworkLegend`のネットワーク別行（`p2p-legend__row`
  の並び）とヒント文（`p2p-legend__hint`）の下に、リンク調のボタンを
  1行追加する。既存の`.tx-lifecycle-popover__sig-demo-open`
  （`margin-top: 8px; padding-top: 8px; border-top: 1px solid
  var(--divider);`+`--accent`色のテキストリンク）と同じ視覚パターンを
  踏襲する。文言は`eclipseDemo.open`（後述）
- Issue #413（土台。glossaryへの`eclipseAttack`用語追加+
  `PeerNetworkLegend`への用語アンカー配置）との組み合わせ方: 本Issueの
  着手時点でIssue #413はまだmainにマージされていない（`gh issue view
  413`で確認、OPEN）。#413が用語アンカーをこのコンポーネント内の
  どの位置（ヒント文中/新規行）に置くかは#413の実装次第のため、
  本設計では位置を厳密に決め打ちしない。#416実装時に#413が既にマージ
  済みであれば、実際のDOM構成を見てから「ヒント文または用語アンカーの
  下に砂場入口ボタンを追記する」形で自然に共存させればよい（両者とも
  追記的な変更で、大きな構造変更を伴わない）
- ピア接続が1本もない場合（`edges.length === 0`）は`PeerNetworkLegend`
  自体が非表示になる。この砂場は実データに依存しないため、本来は
  ピア接続の有無に関わらず開けてよいはずだが、入口を凡例に同居させる
  以上はこの既存の非表示条件を継承する（起動直後などノード数が少ない
  構成では凡例ごと隠れる）。これは許容できるトレードオフと判断した:
  ハッシュデモがチェーンリボンカード（常に描画される）に載っているのと
  異なり、P2P凡例は「ピア接続が実在するときに初めて意味を持つ情報」
  という性質上そもそも条件付き表示であり、eclipse攻撃という「ピア接続の
  信頼性」の砂場もピア接続の実在を前提にした文脈で見せるほうが自然

#### 5. 新設するi18n文言（初稿。`eclipseDemo.*`名前空間）

- `eclipseDemo.open`: ja「eclipse攻撃のしくみを試す」/
  en "Try how eclipse attacks work"（凡例のボタンで使う）
- `eclipseDemo.title`: ja「eclipse攻撃のしくみ」/
  en "How eclipse attacks work"
- `eclipseDemo.intro`: ja「ここは学習用の砂場です。実際のピア接続には
  影響しません。中央の『被害ノード』は8個の接続スロットを持ち、
  はじめは全スロットが正規ピアで満たされています。下の『攻撃者ピアを
  追加』を押すと、攻撃者が1つずつスロットを奪っていきます。」/
  en "This is a learning sandbox. It doesn't affect real peer
  connections. The 'victim node' in the center has 8 connection slots,
  all initially filled with honest peers. Press 'Add attacker peer'
  below to watch the attacker take over slots one by one."
- `eclipseDemo.victimNode`: ja「被害ノード」/ en "Victim node"
- `eclipseDemo.slot.honest`: ja「正規ピア」/ en "Honest peer"
- `eclipseDemo.slot.attacker`: ja「攻撃者ピア」/ en "Attacker peer"
- `eclipseDemo.occupancy`: ja「攻撃者ピア: {count} / {total}（{percent}%）」/
  en "Attacker peers: {count} / {total} ({percent}%)"（`format()`で
  埋め込む値。既存の`format(t(...), {...})`パターンに合わせる）
- `eclipseDemo.addAttacker`: ja「攻撃者ピアを追加」/
  en "Add attacker peer"
- `eclipseDemo.allSlotsOccupied`: ja「すべてのスロットが攻撃者に
  占められました」/ en "All slots are occupied by the attacker"
  （ボタンdisabled時の代替表示 or 近傍の状態文言）
- `eclipseDemo.reset`: ja「リセット」/ en "Reset"
- `eclipseDemo.viewLabel`: ja「被害ノードが見ているチェーン」/
  en "What the victim node sees"
- `eclipseDemo.badge.real`: ja「ネットワーク全体と一致しています」/
  en "Matches the real network"
- `eclipseDemo.badge.fake`: ja「攻撃者だけが見せている内容です」/
  en "Only the attacker is showing you this"
- `eclipseDemo.eclipsedWarning`: ja「被害ノードの接続スロットがすべて
  攻撃者に占められました。今、この被害ノードは攻撃者だけが作る偽の
  ネットワークの中にいます。」/ en "All of the victim node's connection
  slots are now occupied by the attacker. This node is currently
  trapped inside a fake network made entirely by the attacker."
- `eclipseDemo.simplifiedNote`: ja「実際のeclipse攻撃では、攻撃者は
  多数の異なる身元(Sybil)を用意し、ノード発見の仕組み自体を操作して
  接続を乗っ取ります。この砂場では『スロットが1つずつ攻撃者に
  置き換わる』という部分だけに絞って簡略化しています。」/ en相当
- `eclipseDemo.defenseNote`: ja「実際のノードは、最初の接続先
  (ブートノード)だけでなくノード発見の仕組みを通じて多様な相手から
  接続先を集めるほか、信頼できる固定ピアを明示的に指定することで、
  すべての接続を攻撃者に握られるリスクを減らしています。」/ en相当
  （`bootnode`/`discovery`のglossaryキーへ`withTermAnchor`等でアンカー
  してよい）
- 疑似チェーンの表示用データ（`REAL_CHAIN_BLOCKS`/`FAKE_CHAIN_BLOCKS`の
  ラベル文言）は具体的な例文キーとして追加してよい（例:
  `eclipseDemo.block.real.1`等）。ハッシュ計算をしない分、
  `hashDemo.field.data`ほど厳密な形式は不要。実装時に具体的なキー数を
  確定してよい（先回りして全パターンをここで決め打ちしない）
- 英語版はすべて初稿を用意し、chainviz-i18nのレビューを受ける

#### 6. 型変更の要否・影響範囲

- **`packages/shared`の型変更: 不要**（Issue #412設計メモの結論どおり。
  完全にフロント内で完結する疑似データ）
- 変更対象: `packages/frontend`のみ
  - `side-panel/sidePanelView.ts`に`{ kind: "eclipseAttackDemo" }`を追加
  - `packages/frontend/src/attack-demo/`を新設し、`EclipseAttackDemoView.tsx`
    （表示）・`eclipseAttackDemo.ts`（状態型・初期値・
    `addAttackerPeer`/`resetEclipseAttackDemoState`等の純粋関数）に
    分割する（1ファイル1責務。ミニ包囲グラフ自体が複雑になる場合は
    `EclipseAttackPeerGraph.tsx`のようにさらに分離してよい）
  - `SidePanelHost.tsx`に`eclipseAttackDemo` kindのディスパッチを追加
  - `PeerNetworkLegend.tsx`に入口ボタンを追加
  - `i18n/messages.ts`に`eclipseDemo.*`キーを追加
  - `styles.css`にミニ包囲グラフ・占有率メーター・凡例ボタン等のスタイル
    を追加（攻撃者色は新規CSS変数を切るか既存`#ff6b6b`を直接参照するかは
    実装判断）
- `glossary/`の変更は無し（`eclipseAttack`用語の新設・アンカーはIssue
  #413の担当範囲。本Issueは#413がマージ済みであることを前提にしないが、
  仮に#413が先にマージされていれば`PeerNetworkLegend`内に既に用語
  アンカーがある状態で本実装が追記されることになる）

#### 7. テスト観点（実装担当・testerへの申し送り）

- 純粋ロジック（`eclipseAttackDemo.ts`）のユニットテスト: 初期状態が
  8/8正規であること、`addAttackerPeer`を1〜8回適用したときの
  スロット構成・占有率の推移、8回適用後にさらに適用しても状態が
  変わらないこと（冪等性）、占有率が7/8のときは`visibleChain`が正規の
  ままで8/8で初めて偽に切り替わる境界値、`resetEclipseAttackDemoState`
  で初期状態に戻ること
- コンポーネントテスト: 「攻撃者ピアを追加」を8回押すと占有率メーター
  ・被害ノードのoutline・見ているチェーンの内容がすべて実際に切り替わる
  こと（演出ではなく状態に連動していることを確認）、8回目で追加
  ボタンがdisabledになること、リセットで全表示が初期状態に戻ること
- a11y観点: 追加/リセットボタンが実`<button>`でアクセシブル名を持つ
  こと、占有率・見ているチェーンの状態（正規/偽）が色だけでなく
  テキストで伝わること、各ピアスロットが色以外の手がかり（アイコン/
  ラベル）を持つこと
- i18nテスト: 新規`eclipseDemo.*`キーがja/en両方揃っていること
  （既存の`hashDemo`/`sigDemo`の`.i18n.test.tsx`と同型）

#### 8. 意図的に決めなかったこと

- 攻撃者色の正確なCSS変数名・実際の実装方法（既存`#ff6b6b`を直接参照
  するか、`--attacker-peer`のような新規CSS変数を切るか）は実装時の
  裁量に委ねる。色そのもの（既存の危険/無効色を再利用する方針）は
  決定済み
- 「見ているチェーン」に表示する疑似ブロックの具体的な文面・件数は、
  実装時に確定してよい範囲として残した（3ブロック程度、という目安のみ
  指定）
- `discovery`/`bootnode`用語へのアンカーはあれば良い追加要素で、必須
  要件にはしていない
- Issue #413（土台）が本Issueより先にマージされるか後になるかは統括の
  Issue進行順に委ねる。どちらの順でも自然に共存できる設計にしてある

#### 9. ビルド・テストへの影響

本設計はドキュメント（`docs/worklog/issue-416.md`、本ファイル）のみの
追加で、`packages/*`のコード変更は行っていない。`pnpm lint && pnpm
build && pnpm test`の実行・確認は不要。

### 2026-07-25 Issue #416 実装（frontend）

- 担当: frontend
- ブランチ: issue-416-eclipse-attack-demo（既存のUX設計コミットの上に実装を追加）

#### 実装方針（設計メモ）

UX設計（本ファイル上部）と `docs/ARCHITECTURE.md` §17.5.3・§17.6 に沿って、
`hashChainDemo`/`signatureDemo`（Issue #401/#402）と同型の「状態は
コンポーネントローカルな `useState` で完結する砂場」として実装した。

- `packages/frontend/src/attack-demo/eclipseAttackDemo.ts`: 純粋ロジック。
  `EclipseAttackDemoState`（`slots: readonly PeerSlotState[]`、固定8要素）・
  `createInitialEclipseAttackDemoState`・`addAttackerPeer`（先頭から見て
  最初の `honest` スロットを `attacker` に置換。全て `attacker` なら
  no-op で同一参照を返す冪等な実装）・`attackerCount`/`occupancyRatio`/
  `isFullyEclipsed`（導出値。stateには持たない）・
  `visibleChainBlockKeys`（`isFullyEclipsed` から実際に導出して
  `REAL_CHAIN_BLOCK_KEYS`/`FAKE_CHAIN_BLOCK_KEYS` を切り替える）を持つ。
  `nextHonestSlotIndex` はView側がフラッシュ対象インデックスを「state更新前に」
  算出するための共通ヘルパー（`addAttackerPeer` 内部でも同じ関数を使う）。
- `packages/frontend/src/attack-demo/EclipseAttackPeerGraph.tsx`: ミニ
  包囲グラフのSVG描画のみを担当する専用コンポーネント（1ファイル1責務。
  View本体から図解を切り出した）。スロット位置は
  `angle = index * 45度`（0=12時）から `sin/cos` で座標計算する
  `slotPosition()` に集約。正規=青`#7db8ff`・攻撃者=`var(--attacker-peer)`
  （新設したCSS変数。実体は既存の危険色`#ff6b6b`のリテラルをそのまま
  代入。UX設計 §8「CSS変数名を新設するかリテラル直接参照かは実装判断」の
  結論として変数名を切った。理由をコメントで明記）。色だけに頼らない
  区別として、各スロットの `<g>` に `role="img"` +
  `aria-label`（「正規ピア」/「攻撃者ピア」）を付け、視覚的にも
  ✓（正規）/!（攻撃者）のグリフを描画する。
- `packages/frontend/src/attack-demo/EclipseAttackDemoView.tsx`: 本体。
  `hashChainDemo` のフラッシュ演出（`NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`と
  同じ定数・同じ「対象indexをrefで管理してタイムアウトで解除」パターン）
  を流用。「攻撃者ピアを追加」は state 更新の**前**に
  `nextHonestSlotIndex(state)` でフラッシュ対象を求めてから
  `setState(addAttackerPeer)` する（更新後の diff を取るより単純で、
  eclipseAttackDemo.ts のロジックとフラッシュ対象特定を同じ関数に
  委ねられる）。占有率メーターは `format(t("eclipseDemo.occupancy"), …)`
  で数値を埋め込み、`aria-live="polite"` を付けた `<p>` に文言全体を持たせる
  （UX設計 §3の指示どおり）。defenseNote 内の discovery/bootnode 用語
  アンカーは、当初 `withTermAnchor` での文中差し込みを検討したが、
  `withTermAnchor` は「1つの部分文字列」の一致に依存するため、ja/enで
  異なる部分文字列を同じ関数呼び出しでは扱えない（`withTermAnchor` の
  戻り値はReactNodeであり2回目の呼び出しに文字列として渡せない、という
  型の制約もある）。`SignatureDemoView.tsx` の
  `sigDemo.otherVerifications` が採っている「文の下に用語チップを並べる」
  パターン（`<GlossaryTerm termKey="…" />` を段落として別行に置く）に
  合わせ、同じ構成にした。
- `packages/frontend/src/side-panel/sidePanelView.ts`: `{ kind:
  "eclipseAttackDemo" }` を判別共用体に追加。
- `packages/frontend/src/side-panel/SidePanelHost.tsx`: 新kindのディスパッチ
  を追加。`hashChainDemo`/`signatureDemo` と同じくダングリングガードの
  対象外（world state のエンティティを持たないため）。
- `packages/frontend/src/entities/PeerNetworkLegend.tsx`: UX設計どおり、
  ヒント文の下に「eclipse攻撃のしくみを試す」ボタンを1行追加した。
  既存の `.tx-lifecycle-popover__sig-demo-open` と同じ「テキストリンク調」
  の見た目（`.p2p-legend__eclipse-demo-open`）。Issue #413（用語アンカー
  基盤）は本実装時点でまだmainに未マージだったため、`eclipseAttack`
  用語アンカー自体はこのファイルにまだ存在しない。UX設計が想定した
  とおり、#413が先にマージされても後にマージされても「ヒント文または
  用語アンカーの下に砂場入口ボタンを追記する」形で自然に共存できる
  構造にしてある（今回追加したのはヒント文の直後の新規行であり、#413が
  ヒント文中に用語を差し込む場合でも要素の追加位置が競合しない）。
- `packages/frontend/src/i18n/messages.ts`: `eclipseDemo.*`
  名前空間をUX設計§5の初稿どおり追加（ja/en両方）。加えて
  「被害ノードが見ているチェーン」の疑似ブロック文言
  （`eclipseDemo.block.real.1〜3`/`eclipseDemo.block.fake.1〜3`）を
  UX設計の例文を踏まえて具体化した（real: Alice→Bob→Carol→Daveの
  順当な送金3件、fake: 攻撃者へ大金が流れる不自然な内容3件）。
- `packages/frontend/src/styles.css`: `--attacker-peer: #ff6b6b`
  というCSS変数を新設（新しい色ではなく既存の危険色のリテラルをそのまま
  代入。理由をコメントに明記）。`.p2p-legend__eclipse-demo-open`・
  `.eclipse-demo__*`一式（グラフ・占有率メーター・操作行・見ている
  チェーン・警告文・フッター注記）を追加。被害ノードのoutline切替は
  `InfraNodeCard`のフォークoutline（`.infra-card--fork-*`の
  border-color/box-shadow切替という手法）と同じ視覚言語を、SVG向けに
  rectの`stroke`切替として再現した（`.eclipse-demo__victim`/
  `--eclipsed`）。

#### `packages/shared`の型変更

無し（UX設計・ARCHITECTURE.md §17.2どおり、`packages/frontend`のみで完結）。

#### テスト

- `eclipseAttackDemo.test.ts`: 初期状態8/8正規、固定順での置換
  （0→7）、全置換後の冪等性（同一参照を返すことまで確認）、占有率・
  完全包囲判定の境界値（7/8では非包囲・`visibleChainBlockKeys`が正規の
  まま、8/8で初めて包囲・偽データへ切り替わる）、リセットの動作を検証。
- `EclipseAttackDemoView.test.tsx`: 初期状態の表示、1クリックごとの
  固定順置換と占有率メーターの更新、7/8→8/8境界での被害ノードoutline・
  バッジ・見ているチェーンの内容・警告文の切り替わり、8/8到達後の
  追加ボタンdisabled化、スロットのフラッシュ演出（付与・
  `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`経過後の解除・次クリックでの
  対象スロット切り替え）、リセットでの初期状態への復帰を確認。
- `EclipseAttackDemoView.i18n.test.tsx`: ja/en双方で主要文言（初期状態・
  8/8完全包囲時の警告文・偽ブロック内容）が表示されることを確認。
- `EclipseAttackDemoView.a11y.test.tsx`: 追加/リセットボタンが実
  `<button>`でアクセシブル名を持つこと、各ピアスロットが
  `role="img"`+`aria-label`で色以外の手がかりを持つこと、占有率
  メーターのテキストが`aria-live="polite"`であること、装飾的な
  SVG要素（線・グリフ）が`aria-hidden`であることを確認。
- `EclipseAttackDemoView.glossaryAnchor.test.tsx`: フッター注記の
  discovery/bootnodeアンカーがそれぞれ1回ずつ出ることを確認（Issue #124
  「アンカーの無い用語を作らない」教訓）。
- `EclipseAttackPeerGraph.test.tsx`: 図解コンポーネント単体で、スロット
  0/2/4/6の時計位置（12時・3時・6時・9時）が幾何学的に正しいこと、
  honest/attackerで色クラス・グリフが切り替わること、被害ノードの
  eclipsedクラス切り替えを確認（`EclipseAttackDemoView.test.tsx`とは
  責務を分離: こちらは純粋に図解コンポーネントの入出力）。
- `SidePanelHost.eclipseAttackDemo.test.tsx`: 新kindへの振り分け・
  `contractSource`との排他制御・ダングリングガード対象外であること・
  開き直すたびに初期状態へ戻ることを確認（`SidePanelHost.hashChainDemo.
  test.tsx`と同型）。
- `PeerNetworkLegend.test.tsx`: 入口ボタンが表示されることを追加で確認
  （既存テストの1ケース追加のみ）。
- `PeerNetworkLegend.eclipseDemoEntry.test.tsx`: 入口ボタンが
  `SidePanelProvider`無しでも例外を投げないこと、実`<button>`として
  キーボード到達可能であること、クリックで`eclipseAttackDemo`パネルが
  開くことを確認（`TxLifecyclePopover.sigDemoEntry.test.tsx`と同型）。

テストを書く過程で、SVG要素の `className` は `SVGAnimatedString`
（`.baseVal`が必要）であり、通常のHTML要素の `className`（文字列）と
同じ流儀の `toContain` アサーションが使えないことに気付いた
（jsdomの実装差に依存する落とし穴になりうるため、素直に
`getAttribute("class")` で文字列として読む方針に統一した）。

#### 次の担当（レビュー/QA）への申し送り

- `eclipseAttackDemo`はglossary変更を伴わない。Issue #413（用語集土台）が
  未マージの状態でも本Issueは独立してレビュー・マージ可能（#413マージ後
  に`PeerNetworkLegend.tsx`が変わっても、今回の追記はヒント文の下の新規
  行であり構造的にコンフリクトしにくい設計にしてある。ただし実際に
  cherry-pick/rebaseする際は、`PeerNetworkLegend.tsx`のdiffを両方
  見比べて意図した位置関係になっているか確認すること）。
- 「見ているチェーン」の疑似ブロック文言（`eclipseDemo.block.*`）は
  UX設計の例文を私（frontend）が具体化したもの。英語表現の質は
  chainviz-i18n（Sam Wordsmith）のレビュー対象に含める。
- `pnpm lint && pnpm build && pnpm test`をリポジトリルートで実行し、
  全パッケージ（shared/collector/frontend/e2e）が通ることを確認済み。

### 2026-07-25 Issue #416 テスト強化（tester）

- 担当: tester
- ブランチ: issue-416-eclipse-attack-demo（実装コミットの続き）
- 内容: 実装担当が書いた基本テスト（ハッピーパス＋主要な境界）を土台に、
  異常系・境界値・決定性・アクセシビリティの観点でテストを追加した。
  実装コード（`packages/frontend/src/attack-demo/`・`i18n/messages.ts`・
  `side-panel/`・`entities/PeerNetworkLegend.tsx`）は一切変更していない。

#### 追加したテストファイル（新規4本）

いずれも既存の基本テストとは関心事を分けた別ファイルにした（CLAUDE.md の
1ファイル1責務。`hashChainDemo.edgeCases.test.ts`・
`keccak256.boundary.test.ts` と同じ流儀の命名）。

- `attack-demo/eclipseAttackDemo.edgeCases.test.ts`（純粋ロジック、25ケース）
  - 満杯（8/8）到達後の9回目〜20回目の呼び出しがすべて同一参照を返す完全な
    no-op であること。占有率が1を超えないこと・例外を投げないこと
  - 攻撃者数 0〜7 の各段階（`it.each`で全網羅）で `isFullyEclipsed` が false・
    `visibleChainBlockKeys` が正規のままであること。8/8 でのみ偽へ切り替わり、
    0→8の全progressionを通して切り替わりが**ちょうど1回**であること
  - 正規/偽のブロックキー列が互いに素・同じ長さ・重複なし（切り替えが
    ユーザーから観測可能であることの前提）
  - 固定順の決定性: 同じクリック数の独立2回実行で slots が完全一致すること、
    置換対象の index 列が毎回 `[0..7, null]` であること（3回実行して比較）、
    各段階で「まだ取られていないスロットは必ず honest」であること
  - リセット後に再度満杯まで進められること（2周）、リセットが部分状態からも
    効くこと、毎回新しいオブジェクト/配列を返すこと
  - 公開APIでは作れない state に対する防御的挙動: `Object.freeze` した
    slots でも例外を投げない（破壊的変更をしていない証明）、穴あき状態では
    「先頭から見て最初の honest」を埋める契約、未知の値が混ざったスロットを
    攻撃者と誤カウントしない・完全包囲と誤判定しない、空配列 state で
    完全包囲と誤判定しない（占有率は 0/0 = NaN だが安全側に倒れる）、
    占有率がスロット数定数ではなく state 自身の `slots.length` から
    導出されていること
- `attack-demo/EclipseAttackDemoView.edgeCases.test.tsx`（パネル、10ケース）
  - 8/8 到達後にさらに4回クリックしても「8 / 8」「100%」のまま、警告文が
    1つだけ、全スロットのラベルが攻撃者、偽ブロック3件のままであること
  - 追加ボタンが disabled になった後もリセットボタンが enabled で
    フォーカス可能であること（初期状態へ戻る手段がキーボードで残る）
  - 占有率の丸め境界を 0〜8 の全段階で網羅（1/8=13%・3/8=38%・5/8=63%・
    7/8=88% と、メーター塗り幅の `style.width` が同じ値であること）
  - 7/8 では正規ブロックの本文3件がそのままで、偽ブロックの文言が画面上に
    1つも存在しないこと（バッジだけでなく中身そのものの確認）。8回目で
    3件すべてが入れ替わり、件数は3のままであること
  - リセット→再度満杯を2周できること、途中リセット後は置換順がスロット0から
    再開すること
  - フラッシュ用タイマーの後始末: リセット時に保留中のフラッシュが解除され
    時間経過後も再点灯しないこと、アンマウント時にタイマーが残らないこと
    （`vi.getTimerCount()` が0になることを確認）、連打時にフラッシュ対象が
    常に最後の1つだけであること
- `attack-demo/EclipseAttackPeerGraph.colorIndependence.test.tsx`（6ケース）
  - `class` 属性（＝色の手がかり）を全て除去したクローンから読み取っても、
    各スロットの状態が `aria-label` とグリフ文字だけで判別できること
  - 偶数=攻撃者/奇数=正規の混在状態で8スロットすべてを個別に検証
    （先頭スロットだけの確認では index の取り違えを検出できないため）
  - 正規と攻撃者でグリフ文字・アクセシブル名がどちらも**異なる**こと
    （同じ記号・同じラベルにしてしまう＝色のみの区別に退化する回帰のガード）
  - en でもラベルがローカライズされ、グリフは言語非依存であること
  - 8/8 のとき8スロット全部のラベルが攻撃者になり、テキストだけから
    完全包囲を推測できること
- `i18n/messages.eclipseDemo.test.ts`（101ケース）
  - `eclipseDemo.` プレフィックスからキー一覧を動的に導出しているため、
    後から文言が追加されても自動的に検査対象になる（列挙の更新漏れ防止）
  - 全キーで ja/en が非空・`translate()` がキー文字列をそのまま返さない・
    プレースホルダ集合が ja/en で一致すること
  - 訳し忘れ（ja===en）の検出。意図的に同一な `eclipseDemo.block.real.1〜3`
    （言語非依存の送金例）は許容リストに入れ、かつ「本当に同一であること」も
    別ケースで固定した（許容リストの陳腐化を防ぐ）
  - `eclipseDemo.occupancy` の `{count}`/`{total}`/`{percent}` が両言語に
    存在し、`format()` 後に未解決のプレースホルダが残らないこと
    （綴り違いが混入すると生の `{...}` が画面に出るため）
  - 疑似チェーンの正規/偽ブロック文言が両言語で互いに素な集合であること
    （切り替えがユーザーに見えることの前提）

#### 既存テストファイルへの追加（2本）

- `side-panel/SidePanelHost.eclipseAttackDemo.test.tsx`: **完全包囲まで
  進めた状態**を、実際のユーザー操作（閉じるボタン・Escape）で閉じてから
  開き直しても状態が残らないことを追加した（既存ケースは1クリック分の
  進捗を別kindへの切り替えで捨てる確認のみだった）。あわせて、同じ kind を
  再度 open した場合は再マウントされず進捗が保持されることも固定した
- `entities/PeerNetworkLegend.eclipseDemoEntry.test.tsx`: ピアエッジ0本の
  ときは凡例ごと非表示になり入口ボタンも出ないこと（UX設計 §4 が
  「許容できるトレードオフ」として明記した挙動の固定）、1本あれば出ること、
  en のラベル、連続クリックでも `eclipseAttackDemo` のままであることを追加

#### 追加したテストが実際に回帰を検出できることの確認

実装を一時的に壊して（確認後すべて元に戻した）、各テストが落ちることを
確認した。

| 意図的に入れた不具合 | 落ちたテスト |
| --- | --- |
| `isFullyEclipsed` の閾値を `>= 7/8` に緩める | 8件（0..8網羅・切り替え1回・7/8のブロック本文など） |
| 満杯時の `addAttackerPeer` を no-op でなく9個目のスロット追加にする | 5件（冪等性・偽データ維持・防御ケース） |
| 置換対象を `findIndex` から `findLastIndex` に変える | 14件（決定性・置換順・フラッシュ対象） |
| スロットのグリフを両状態で `✓` に統一（色のみの区別に退化） | 5件（うち4件は新規のcolorIndependence） |
| スロットの `aria-label` を状態によらず固定 | 8件 |
| ja の occupancy 文言から `{percent}` を削除 | 3件 |
| フラッシュタイマーのアンマウント時クリーンアップとリセット時解除を削除 | 2件 |

#### 実装の変更は不要と判断したが、レビュー時に見てほしい点

いずれも今の仕様では動作上の不具合ではないため実装は変更していない。
差し戻しではなく所見として記録する。

1. **ミニ包囲グラフの入れ子 `role="img"`（a11y）**: 外側の `<svg>` に
   `role="img"` + `aria-label` があり、その内側の各スロット `<g>` にも
   `role="img"` + `aria-label`（「正規ピア」「攻撃者ピア」）が付いている。
   ARIA では `role="img"` の要素は葉ノードとして扱われ、支援技術は
   その子孫を読み上げない実装が一般的なため、スロット個別のラベルは
   実際のスクリーンリーダーには届かない可能性がある。加えて外側の
   `aria-label` は `eclipseDemo.victimNode`（「被害ノード」）で、図全体の
   説明としては情報が足りない（8スロットの図であることや現在の占有状況が
   伝わらない）。ただし、色以外の視覚的手がかり（✓ / ! のグリフ）は
   sighted user 向けに機能しており、占有率テキスト（`aria-live="polite"`）・
   バッジ・完全包囲時の警告文で状態は**テキストとしても**伝わるため、
   「色のみに依存」というUX設計の要件自体は満たしている。改善するなら
   外側の `aria-label` を図全体の要約（例:「被害ノードと8個の接続スロット。
   攻撃者 n / 8」）にするか、外側の `role="img"` を外して各スロットの
   ラベルを露出させる方向が考えられる。テストは現状の DOM 構造を
   そのまま固定するのではなく、「色を無視しても区別できること」という
   本来の要件を検証する形にしてある
2. **占有率の算出が View 側で重複している**: `EclipseAttackDemoView` は
   `percent` を `count / ECLIPSE_DEMO_SLOT_COUNT` から、`addDisabled` を
   `count >= ECLIPSE_DEMO_SLOT_COUNT` から計算している。
   `eclipseAttackDemo.ts` に `occupancyRatio` / `nextHonestSlotIndex` が
   あるので、そちらを使えば「導出はロジック側に集約する」方針とより
   揃う（現状の固定8スロットでは結果は同じ）

#### ビルド・テスト

リポジトリルートで `pnpm lint`・`pnpm build`・`pnpm test` を実行し、
全パッケージが通ることを確認した（frontend: 268ファイル / 3386ケース。
テスト強化前は264ファイル / 3237ケース）。

### 2026-07-25 Issue #416 レビュー（reviewer）

- 担当: reviewer
- ブランチ: issue-416-eclipse-attack-demo（レビューは `review-issue-416`
  ブランチ上で行った。branch `issue-416-eclipse-attack-demo` は別worktreeで
  使用中だったため、`origin/issue-416-eclipse-attack-demo` を追跡する別名
  ブランチをレビュー専用に作成した。commit・pushは行っていない。統括が
  実ブランチ側に反映する）

#### 判定: 合格（1件、軽微な修正を実施）

#### テスト強化担当からの申し送り2件への判断

1. **ミニ包囲グラフの入れ子 `role="img"`（a11y）**: 実際にコードを確認し
   （`EclipseAttackPeerGraph.tsx`）、指摘は技術的に正確であると判断した。
   ただし、UX設計・ARCHITECTURE.md §17.5.3が明示的に要求しているのは
   「色のみに依存しない」ことであり、これはグリフ（✓/!）による視覚的
   区別、占有率テキスト（`aria-live="polite"`）、バッジ文言、完全包囲時の
   警告文によって満たされている。個々のスロットへの `role="img"` +
   `aria-label` は実装が自主的に追加した上乗せの配慮であり、要求仕様
   そのものの未達ではない。正しく直すには
   `EclipseAttackPeerGraph.tsx`本体に加えて、現在の入れ子構造を前提に
   書かれたテスト3本（`EclipseAttackDemoView.a11y.test.tsx`・
   `EclipseAttackPeerGraph.test.tsx`・
   `EclipseAttackPeerGraph.colorIndependence.test.tsx`）のアサーションを
   書き換える必要があり、「軽微な修正」の範囲を超えると判断した。
   差し戻しには値しない（設計要件は満たされている）ため、今回は修正せず、
   将来の改善余地として記録に留める。改善案: 外側 `<svg>` の
   `aria-label` を「被害ノード」単体ではなく図全体の状態要約
   （例:「被害ノードと8個の接続スロット。攻撃者 n/8」）にする、または
   外側の `role="img"` を外して各スロットのラベルを支援技術に露出させる
2. **占有率算出の重複（軽微）**: 実際にコードを確認し
   （`EclipseAttackDemoView.tsx`）、指摘のとおり `percent` が
   `count / ECLIPSE_DEMO_SLOT_COUNT` から、`addDisabled` が
   `count >= ECLIPSE_DEMO_SLOT_COUNT` から計算されており、
   `eclipseAttackDemo.ts` の `occupancyRatio`/`nextHonestSlotIndex` を
   使っていなかった。固定8スロットの現状では結果に差はないが、「導出は
   ロジック側に集約する」という同ファイル・同Issueの設計方針（実際
   `eclipseAttackDemo.edgeCases.test.ts` は `occupancyRatio` が
   `state.slots.length` から導出されスロット数定数の焼き付けが無いことを
   固定している）と揃えるべき軽微な修正と判断し、レビュー担当自身で
   修正した。`EclipseAttackDemoView.tsx` の `percent` を
   `Math.round(occupancyRatio(state) * 100)` に、`addDisabled` を
   `nextHonestSlotIndex(state) === null` に変更した。動作は変わらない
   （既存の268ファイル/3386ケースが無変更で全て通ることを確認済み）。
   `ECLIPSE_DEMO_SLOT_COUNT` は `eclipseDemo.occupancy` の `total` 埋め込み
   （表示用の定数値そのもの）としては引き続き使用しており、この用途は
   導出の重複には当たらないため変更していない

#### 境界・設計原則の確認

- **境界の遵守**: 変更は `packages/frontend` のみ（`packages/shared`・
  collector・node-envへの変更なし）。フロントはDocker/ノードAPIに直接
  触れていない。チェーン固有語彙（`eth_getLogs`等）の混入なし
  （`packages/frontend/src/attack-demo/` 配下をgrepし確認済み）
- **チェーンプロファイルの独立性**: 該当なし（このIssueは新チェーン対応
  ではない）
- **`packages/shared`の整合**: 型変更なし。設計メモ・Issue本文どおり
- **データとコードの分離**: glossaryの変更は無し（Issue #413の担当範囲。
  本Issueは`discovery`/`bootnode`という既存glossaryエントリへの
  アンカーのみ追加しており、両エントリが `glossary/ethereum/terms/
  b-network.yaml` に実在することを確認した）

#### ビルド・テスト

`pnpm lint && pnpm build && pnpm test` をリポジトリルートで実行し、
shared（6ファイル/75ケース）・collector（92ファイル/1765ケース）・
e2e（16ファイル/185ケース）・frontend（268ファイル/3386ケース）の
全パッケージが通ることを確認した。上記の軽微な修正後も再度
`pnpm lint`・`pnpm --filter @chainviz/frontend build`・
`pnpm --filter @chainviz/frontend test` を実行し、268ファイル/3386ケースが
無変更で全て通ることを確認した。

#### Issue本文・ARCHITECTURE.md §17.5.3・§17.6との突き合わせ

- 完了条件「サイドパネルからeclipse攻撃シミュレーションを開始・操作
  できる」: `sidePanelView.ts`に`eclipseAttackDemo` kindを追加、
  `SidePanelHost.tsx`でディスパッチ、`PeerNetworkLegend.tsx`に入口ボタンを
  設置済み。設計どおり
- 完了条件「実際に動く簡略化アルゴリズムで結果が決まる（演出のみのフェイク
  にしない）」: `eclipseAttackDemo.ts`の`isFullyEclipsed`/
  `visibleChainBlockKeys`が占有率の実計算から結果を導出しており、
  ARCHITECTURE.md §17.5.3の「攻撃者ピアの占有率が100%に達した時点で
  実際に切り替わる」を満たす
- 完了条件「対応するユニットテストがある」: 純粋ロジック・View・図解
  コンポーネント・a11y・i18n・glossaryアンカー・入口ボタンの各観点で
  テストが揃っている。テスト強化担当が意図的にロジックを壊して各テストが
  実際に検知することを確認した記録もworklogにある
- §17.6「3つの砂場は個別の図解を必要とし…UX設計を経ることを推奨」:
  chainviz-uxによる設計（本ファイル冒頭）を経て実装している
- §17.4「eclipseAttack用語アンカーはPeerNetworkLegend.tsxに置く」:
  Issue #413（土台）が本Issue着手時点で未マージのため、`eclipseAttack`
  自体の用語アンカーは本Issueの範囲外（#413の担当）。本Issueは
  `PeerNetworkLegend.tsx`への砂場入口ボタン追加のみを行っており、
  設計メモが説明する「#413が先でも後でも自然に共存できる」構造になって
  いることを確認した

#### コミットの粒度

`git log main..issue-416-eclipse-attack-demo`を確認した。設計
（UX設計）・純粋ロジック（`eclipseAttackDemo.ts`）・デモパネル本体
（`EclipseAttackDemoView.tsx`/`EclipseAttackPeerGraph.tsx`とその基本
テスト）・凡例への入口ボタン追加・worklog記録、という関心事ごとに分けた
実装コミット5本と、テスト強化担当による関心事別のテストファイル追加
コミット6本（純粋ロジック・View境界値・図解の色非依存性・i18n・
再表示テスト・入口ボタン境界ケース）に分かれており、1コミット1関心事の
方針に沿っている。問題なし

#### 次の担当（統括）への申し送り

- レビュー中に軽微な修正を1件加えた（`EclipseAttackDemoView.tsx`の
  `percent`/`addDisabled`をロジック層の`occupancyRatio`/
  `nextHonestSlotIndex`経由に変更）。この変更は`review-issue-416`
  ブランチ（`origin/issue-416-eclipse-attack-demo`を追跡）にコミットせず
  作業ツリーに留めてある。統括が実際のブランチ
  `issue-416-eclipse-attack-demo`側（別worktree）に同じ変更を反映し、
  `fix(frontend): eclipse攻撃デモの占有率算出をロジック層に一本化する
  (Issue #416)`のような単独コミットとしてコミットすること
- 入れ子`role="img"`のa11y所見は差し戻し不要と判断し、コードは変更して
  いない。将来的な改善候補として記録するに留めた
- QA（chainviz-qa）による実機検証へ進めてよい
