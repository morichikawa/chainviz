# Issue #123 ノード/ワークベンチ追加時の追加先・接続先の予告

### 2026-07-06 Issue #123 UX設計(実装前)

- 担当: ux
- ブランチ: issue-123-ux-design-node-addition
- 内容: 「+ ノードを追加」「+ ワークベンチを追加」を押しても、どこに・
  何と繋がって追加されるかが事前に分からない問題のUX設計。実装は
  まだ行っていない(この記録が frontend / collector / designer への
  引き継ぎ資料)。

## 1. 現状確認(実際に動かした結果)

モックデータで frontend を起動し(`pnpm --filter @chainviz/frontend dev`)、
Playwright(スクラッチパッドに都度導入。手順は末尾)で操作・スクリーン
ショット確認した。あわせて collector 側の接続先決定ロジックをコードで
確認した。

### UI側で観察できた事実

1. **ボタン押下前**: ボタン名(「+ ノードを追加」)以外の説明が一切ない。
   何が(コンテナ何個・どの種類)、どこに、何と繋がって増えるのかを知る
   手段がない。
2. **押下直後**: 仮カード(ゴースト、Issue #102)は出るが、表示は
   「起動中…」のみで接続先の情報はない。またゴーストの配置
   (`useCommands.ts`: グリッド末尾 `infraCount + ghostSeq`)と、実カードの
   最終配置(`infraNode.ts` の `entitiesToFlowNodes`: id ソート順の添字)は
   **一致しない**。仮カードが出た場所と違う場所に実カードが現れる。
3. **実カード到着時**: `entitiesToFlowNodes` が毎回 id ソート順でグリッド
   添字を割り当て直すため、**レイアウト未保存の既存カードが玉突きで
   移動する**。スクリーンショットで、ノード追加後に既存の reth-2 カードが
   最上段から2段目へ移動するのを確認した。新しいカードがどれなのか・
   どこに現れたのかが分からない主因はこれ。
4. **追加直後はエッジが1本も無い**。PeerEdge は collector のポーリングと
   実際のピア確立の後に初めて届くため、それまで新カードは「誰とも
   繋がっていない孤立カード」に見える。
5. **ワークベンチ追加**: どのノードの RPC を叩くのかはどこにも出ない。
   操作エッジ(OperationEdge)は cast 等を実行した瞬間の揮発パルスのみで、
   「このワークベンチの操作先はこのノード」という常設の関係表示がない。

### collector側の事実(接続先は実際どう決まるか)

`packages/collector/src/adapters/ethereum/node-lifecycle.ts` と
`profiles/ethereum/scripts/*.sh` を確認した。

- **addNode**: フォロワー reth+beacon の**2コンテナ**(=キャンバス上は
  2カード)を追加する。
  - reth は共有ボリューム elpeer の `boot.enode`(**reth1** が boot 役として
    書き出す)を `--trusted-peers` / `--bootnodes` に渡して EL ネットワークへ
    参加する。
  - beacon は clpeer の `boot.enr`(**beacon1**)を入口に CL ネットワークへ
    参加する。beacon の `EXECUTION_ENDPOINT` は同時追加した reth
    (Engine API、ポート8551)。
  - つまり**参加の入口(ブートノード)は reth1 / beacon1 で固定**であり、
    現状 UI から接続先を選ぶ余地はない。参加後はディスカバリにより他の
    ノードともメッシュ状に自動接続していく(恒久的なトポロジは入口に
    依存しない)。
- **addWorkbench**: `ETH_RPC_URL` は既定
  `http://172.28.1.1:8545`(= **reth1 直**)。IP・接続先とも固定。
  - **実装ギャップを発見**: compose 起動の Alice ワークベンチは Issue #78
    でロギングプロキシ(`host.docker.internal:4001`)経由に変更済みだが、
    **addWorkbench で動的追加したワークベンチは reth1 直結でプロキシを
    経由しない**(`node-lifecycle.ts` の `DEFAULTS.ethRpcUrl`。`index.ts` は
    `profileDir` しか渡していない)。そのため動的追加ワークベンチの RPC
    呼び出しは操作エッジとして**一切観測・描画されない**。「操作すると
    エッジが見える」という体験が Alice と食い違う。→ §6 の判断事項3。

## 2. 課題の言語化(何が伝わっていないか)

- 追加「前」: この操作で何が(2カード)、どこと繋がって増えるのかが
  分からない。
- 追加「中」: 仮カードは出るが、それがどこに定着し誰と繋がる予定なのかが
  分からない。
- 追加「後」: 既存カードまで動いてしまい「どれが新入りか」が分からない。
  エッジが張られるまでの数秒〜数十秒、孤立カードに見える。
- ワークベンチ: 操作対象ノードとの常設の関係が可視化されていない。

## 3. UX設計の方針

**案A「接続先は現行どおり自動(ブートノード起点)のまま、『何が起きるか』を
事前・進行中・事後の3段階で正確に予告する」を推奨する。**

ユーザー提案の「親ノードを指定して増やす」(案B)を採らない理由:

- collector の実装は入口が reth1/beacon1 固定で、選択式にするには
  shared(コマンド型)・collector(対象ノードの enode/ENR を RPC で取得して
  env 渡し)・node-env(スクリプトに env 優先の分岐追加)をまたぐ変更になる。
- P2P はブートノードを入口にした後ディスカバリで自動メッシュ化するため、
  「親」を選んでも**恒久的な接続関係は変わらない**。選択 UI は「親子関係が
  維持される」という誤ったメンタルモデルを与えるリスクがある。学習アプリ
  としては「ブートノードから網に入り、その後自動で網目状に繋がる」という
  実際の仕組みをそのまま見せる方が価値がある。

ただし案Bはユーザー本人の提案なので、採否は統括からユーザーへ確認して
ほしい(§6 判断事項1)。以下は案Aの設計。

## 4. 操作フロー・情報の見せ方(実装仕様)

### 4-1. 押下前: ボタンのホバー/フォーカスで予告ツールチップ

`CanvasToolbar` の各ボタンに、ホバーおよびキーボードフォーカスで表示される
説明ツールチップを付ける(`title` 属性ではなく `aria-describedby` で参照する
自前ポップオーバー。既存の用語解説ポップオーバーの見た目に揃える)。

文言(i18n キーは新設。`{...}` は実行時置換のプレースホルダ。既存の `t()` に
補間機能が無いため、単純な文字列置換ヘルパーの追加が必要):

- `action.addNode.hint`
  - ja: 「フォロワーノード(reth + beacon のペア、カード2枚)を起動します。
    {elBoot} と {clBoot} を入口(ブートノード)に既存ネットワークへ参加し、
    同期後は他のノードとも自動で繋がります」
  - en: "Starts a follower node (a reth + beacon pair; two cards). It
    joins the existing network through {elBoot} and {clBoot} as bootnodes,
    then connects to other peers automatically once synced."
- `action.addNode.hint.generic`(接続先ノードを特定できない場合の
  フォールバック。§4-5)
  - ja: 「フォロワーノード(reth + beacon のペア、カード2枚)を起動し、
    既存ネットワークのブートノードを入口に参加させます」
  - en: "Starts a follower node (a reth + beacon pair; two cards) and
    joins it to the existing network through its bootnodes."
- `action.addWorkbench.hint`
  - ja: 「Foundry(cast / forge)入りの操作用マシンを起動します。RPC 呼び出しは
    {rpcTarget} に送られ、専用のウォレット(鍵)が1つ割り当てられます」
  - en: "Starts an operator machine with Foundry (cast / forge). Its RPC
    calls go to {rpcTarget}, and it gets a dedicated wallet (key)."
- `action.addWorkbench.hint.generic`
  - ja: 「Foundry(cast / forge)入りの操作用マシンを起動します。専用の
    ウォレット(鍵)が1つ割り当てられます」
  - en: "Starts an operator machine with Foundry (cast / forge). It gets a
    dedicated wallet (key)."

`{elBoot}` / `{clBoot}` / `{rpcTarget}` にはキャンバス上のカード名
(containerName。例: `chainviz-ethereum-reth1`)を入れる。値の出所は §5 の
shared 型追加。

「ブートノード」の語には既存のインライン用語解説(点線下線)を付けたいので、
`glossary/ethereum/terms/b-p2p.yaml` に `bootnode`(ブートノード)の用語追加を
実装Issueに含めること(定義例: 「新しくネットワークに参加するノードが最初に
接続する既知のノード。ここを入口にピアを発見した後は、対等なピアの一つに
なる」)。

### 4-2. 押下直後: 仮カードで「定着位置」と「接続予定先」を予告

Issue #102 の仮カード(ゴースト)を次のとおり拡張する。

- **ノード追加ではゴーストを2枚**(reth 用・beacon 用)を縦に隣接して置き、
  実態(2コンテナ追加)と一致させる。カード名は確定名が分からないため
  「新しいノード (reth)」「新しいノード (beacon)」とする:
  - `ghost.node.execution`: ja「新しいノード (reth)」 en "New node (reth)"
  - `ghost.node.consensus`: ja「新しいノード (beacon)」 en "New node (beacon)"
- ゴーストのサブタイトルに接続予定先を明記する:
  - reth ゴースト: 「起動中… {elBoot} と接続予定」
    (`ghost.willConnect`: ja「{target} と接続予定」 en "Will connect to {target}")
  - beacon ゴースト: 「起動中… {clBoot} と接続予定」
  - ワークベンチゴースト: 「起動中… 操作先: {rpcTarget}」
    (`ghost.rpcTarget`: ja「操作先: {target}」 en "RPC target: {target}")
- **接続予定エッジ**をゴースト→予定先カードに描画する。スタイルは
  PeerEdge と同系色の点線・低彩度(「まだ実接続ではない」ことを示す)。
  reth ゴースト→ELブートノード、beacon ゴースト→CLブートノード、
  ワークベンチゴースト→操作先ノード(こちらは操作エッジ系の色)。
- **ゴーストの位置 = 実カードの最終位置**にする(§4-3 の配置ルールで
  次に割り当てられる空きスロットを使う)。

### 4-3. 配置ルール: 既存カードを動かさない・仮→実で位置を引き継ぐ

- **ルール1(最重要)**: 新規エンティティの出現で既存カードを動かさない。
  実装方式は「エンティティ初出時に空きグリッドスロットを確定し、その場で
  layoutStore(localStorage)へ保存する」を推奨する(以後は保存済みレイアウト
  扱いになるので二度と動かない。リロード後も同じ配置が復元される)。
  `entitiesToFlowNodes` の「毎回 id ソートで添字を振り直す」方式は廃止する。
- **ルール2**: 実カード(entityAdded)到着時、対応するゴーストの位置を
  layoutStore に引き継いでからゴーストを消す。対応付けは #102 の
  FIFO 近似を踏襲しつつ、ノード追加分は entityAdded の `clientType`
  (reth / lighthouse)とゴーストの層(execution / consensus)で突き合わせる。
- この変更により Issue #113(ゴースト配置indexが削除を挟むと重なる)も
  同時に解消される見込み(ゴースト位置の採番が「空きスロット探索」に
  変わるため)。実装時に #113 の再現手順で確認すること。

### 4-4. 到着後: 新入りの強調と「接続確立中」の継続表示

- 実カード到着から約5秒間、カードのアウトラインを発光させる新着強調を
  付ける(ブロック受光の発光と紛れない色にする。追加操作系のアクセント色)。
- **接続予定エッジは実カード到着後も残し**、そのノードを端点とする実
  PeerEdge が1本でも届いた時点で消す。残っている間のエッジラベルは
  `edge.connecting`: ja「P2P接続を確立中…」 en "Establishing P2P connection…"。
  時間タイムアウトは設けない(同期に時間がかかっている実態を正しく表す。
  ノードが消えたらエッジも消す)。
- ワークベンチは到着後、**常設の「操作先」エッジ**(細い点線、操作パルスと
  同系色・低彩度)をワークベンチ→操作先ノードに描く。既存の操作パルスは
  この上を走る形になる。カードのホバーポップオーバーにも
  `field.rpcTarget`: ja「操作先ノード」 en "RPC target" の行を追加する。

### 4-5. フォールバック(段階的劣化)

shared 型の新フィールド(§5)が無いスナップショット(旧 collector・未更新の
モック)でも壊れないこと:

- ブートノードを特定できない → ツールチップは `*.hint.generic`、
  接続予定エッジは描かない、ゴーストのサブタイトルは従来どおり「起動中…」。
- `rpcTargetNodeId` が無い → 操作先エッジ・「操作先」行は出さない(現状同等)。

### 4-6. モックデータの更新

`packages/frontend/src/websocket/mockData.ts` を実挙動に合わせる:

- addNode で reth+beacon の**2エンティティ**を追加し、数秒後に PeerEdge が
  届く遅延も模す(接続予定エッジ→実エッジlaunchの切り替えを目視確認する
  ため)。
- 既存ノードに `p2pRole`、ワークベンチに `rpcTargetNodeId` を設定する。

## 5. 必要な shared 型変更(chainviz-designer と調整)

いずれもチェーン非依存の語彙で、optional(後方互換)とする。形の最終決定は
designer に委ねる。

1. `NodeEntity` に `p2pRole?: "boot" | "peer"` を追加する。
   `boot` = 新規参加ノードの入口になるブートノード。フロントは
   `p2pRole === "boot"` のノードを EL/CL 別(`clientType` で判別)に探して
   `{elBoot}` / `{clBoot}` に使う。
   - collector 側の判定方法は実装に委ねる。候補: (a) コンテナ env の
     `RETH_ROLE` / `BEACON_ROLE` を docker inspect で読む、
     (b) lifecycle の構成知識(boot 役の固定 IP / サービス名)から対応付ける。
2. `WorkbenchEntity` に `rpcTargetNodeId?: string | null` を追加する。
   collector が `ETH_RPC_URL` / ロギングプロキシ転送先のホスト(IP)を
   ノード id に解決して設定する(操作エッジの観測
   (`createOperationObserver`)と同じ resolver を流用できる)。解決不能なら
   省略または null。

## 6. 決めきれない判断(統括へ)

1. **案A(予告のみ・接続先固定) vs 案B(親ノード選択)**。推奨は案A(理由は
   §3)。ただし案Bはユーザー本人の提案(「親ノード?みたいなのがあるなら
   それを指定して増やすとかしたほうがいい」)なので、**「親を選んでも
   P2P では最終的に全員と網目状に繋がるため、入口の予告に留めた」という
   説明とセットでユーザーに確認**してほしい。案Bを採る場合は shared の
   `Command`(`addNode` に `entryNodeId?`)・collector・node-env をまたぐ
   別設計が必要になる。
2. **押下前の予告の形**: ホバーツールチップ(推奨)か、押下時の確認
   ダイアログか。推奨はツールチップ+ゴースト予告。確認ダイアログは
   「キャンバス上で気軽に環境を操作できる」体験(CONCEPT.md)を損なう。
3. **addWorkbench のプロキシバイパス(§1で発見した実装ギャップ)**:
   動的追加ワークベンチの RPC が操作エッジとして観測されない問題。
   §4 の「操作先」表示が嘘にならないよう、collector 側の修正
   (ContainerSpec に extra_hosts(host-gateway 相当)を追加し
   `ETH_RPC_URL` をプロキシへ向ける)を**別Issueとして起票**することを
   推奨する。本Issueの UI 実装とは独立に進められる。
4. **CONCEPT.md の追記**(実装PRに含める提案。決定事項の変更ではなく
   体験イメージの具体化): 「キャンバス上でのノード/ワークベンチの追加・
   削除(操作)」の「追加:」項目に一文追加 —
   「追加操作では、何が(reth+beacon のペア)・どこに・何と繋がって増えるかを
   事前に予告する(ブートノードを入口に参加する実挙動をそのまま見せる)」。

## 7. 実装の分担イメージ

- **shared**: §5 の2フィールド(designer が形を確定)
- **collector**: `p2pRole` / `rpcTargetNodeId` の設定。(判断事項3が採用
  されれば別Issueでプロキシ経由化)
- **frontend**: §4 の全項目(ツールチップ、ゴースト2枚化+接続予定先表示、
  接続予定エッジ、配置ルール変更、新着強調、操作先エッジ、i18n 文言、
  モック更新)。配置ルール変更(§4-3)はテスト必須
  (既存カード不動・リロード復元・#113 の重なり解消)
- **glossary**: `bootnode` の用語追加(b-p2p.yaml)

## 8. 検証環境メモ(次回のUX確認用)

- フロント単体: `pnpm --filter @chainviz/frontend dev`(モックで動く)
- スクリーンショット: リポジトリには Playwright を導入せず、セッションの
  スクラッチパッドに `npm install playwright` し、実行バイナリは
  `~/.cache/ms-playwright/chromium_headless_shell-*` を `executablePath` で
  直接指定した。WSL 環境に chromium の依存ライブラリ
  (libnss3 / libnspr4 / libasound2)が無いため、`apt-get download` で
  取得した deb を展開し `LD_LIBRARY_PATH` で読ませた(root 不要)。
  ヘッドレス環境に CJK フォントが無く日本語が豆腐になるが、
  レイアウト・挙動の確認には支障ない(文言は `i18n/messages.ts` を直接
  確認した)。
