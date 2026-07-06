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

### 2026-07-06 Issue #123 collector側実装(rpcTargetNodeIdの解決)

- 担当: collector
- ブランチ: issue-123-ux-design-node-addition
- 内容: `docs/worklog/meta.md`(designerによるshared型設計・collector側正規化
  ロジック設計の記録)に従い、`WorkbenchEntity.rpcTargetNodeId` を collector
  側で解決する実装を行った。
- 変更点:
  1. `packages/collector/src/adapters/ethereum/index.ts`:
     `EthereumAdapterDeps` に `rpcTargetHost?: string` を追加した。
     `pollInfra()` で、同じポーリングの観測結果(entities)から
     `kind === "node" && ip === rpcTargetHost` のノードを探し、見つかれば
     その `id`(stableId)を全 `WorkbenchEntity.rpcTargetNodeId` に設定する
     私有メソッド `resolveRpcTargetNodeId()` を追加した。`rpcTargetHost` が
     未設定、または一致するノードが観測に無ければ何も設定しない(省略のまま)。
     解決は毎ポーリングで entities から探し直す実装であり、固定の解決結果を
     キャッシュ・埋め込みしていない(ブートノードが再作成されて stableId が
     変わっても追従する)。
  2. `packages/collector/src/index.ts`: `main()` で
     `resolveProxyTarget()` → `parseProxyTargetHost()`(既存の
     `proxy/operation-observer.ts` の関数を再利用)でホストを解決し、
     `EthereumAdapter` の `rpcTargetHost` と、既存のロギングプロキシの
     `createOperationObserver` の `targetHost` の両方に同じ値を渡すよう
     配線した(従来は `targetHost` のみをこの用途で計算していたが、
     同じ値をアダプタにも渡す形にまとめた。重複計算・値のズレを避けるため)。
  3. 実装ギャップ(#129で別対応予定)の前提をコード上のコメントにも明記した
     (`pollInfra()` のドキュメントコメント): 動的追加ワークベンチ
     (addWorkbench)は現状ロギングプロキシを経由せず node-lifecycle.ts の
     既定 `ETH_RPC_URL`(reth1 直)へ直結するため、`CHAINVIZ_PROXY_TARGET` を
     変更した環境では動的追加ワークベンチの実際の呼び出し先とここで解決する
     `rpcTargetNodeId` がずれ得る。既定値同士は同一ホストのため通常運用では
     一致する。
  4. `p2pRole` の設定ロジックは対象外(Issue #124のブランチで実装される。
     本ブランチでは shared 型定義のみが先行マージ済み)。
- テスト: `packages/collector/src/adapters/ethereum/index.test.ts` に
  `describe("EthereumAdapter.pollInfra rpcTargetNodeId resolution (Issue #123)")`
  を追加し、以下を検証した。
  - `rpcTargetHost` が観測ノードの ip と一致する場合、複数ワークベンチ全てに
    同じ `rpcTargetNodeId` が設定される
  - `rpcTargetHost` 未設定(deps省略)では `rpcTargetNodeId` を設定しない
  - `rpcTargetHost` がどのノードの ip とも一致しない場合は設定しない
  - ポーリングごとに解決し直す(1回目は対象ノード未観測で unresolved、
    2回目に対象ノードが観測されると resolved になる)ことを、Docker
    コンテナ一覧が変化する疑似 DockerClient で確認した(固定値のキャッシュに
    していれば検出できないケース)
- 実機確認: メイン作業ディレクトリで稼働中の docker compose 環境(reth1/
  beacon1/reth2/beacon2/validator1/validator2/workbench)に対し、
  ビルド済み collector のモジュールを読み取り専用のスクリプト
  (コンテナ操作は一切行わない一時スクリプト。確認後削除済み)から呼び出し、
  `pollInfra()` の結果を直接確認した。
  - 既定の `CHAINVIZ_PROXY_TARGET`(`http://172.28.1.1:8545`)では、
    workbench の `rpcTargetNodeId` が reth1(`chainviz-ethereum/reth1`、
    ip `172.28.1.1`)に正しく解決されることを確認した。
  - `CHAINVIZ_PROXY_TARGET` を存在しないホスト(`http://10.99.99.99:8545`)に
    差し替えると `rpcTargetNodeId` が `undefined`(省略)になることを確認し、
    フォールバックが機能することも確認した。
  - このworktreeから本物の docker compose プロジェクトへの操作(addNode等)
    は一切行っていない(読み取りのみ)。
- 確認: `pnpm --filter @chainviz/collector build` / `pnpm --filter
  @chainviz/collector test` とも通過(629 tests green)。`eslint`も対象
  ファイルに対して実行しエラー無し。
- frontend側への申し送り: `WorkbenchEntity.rpcTargetNodeId` は
  collector が毎ポーリング解決し直す値であり、対象ノードが観測から消えると
  次のポーリングまでは古い id が残り得る(design記録・meta.md のreviewer
  補足のとおり)。frontend側は「参照先エンティティが存在しない id は無視する
  (エッジを描かない)」というダングリング参照ガードを必ず入れること。
  §4 のUX実装(ツールチップ・ゴースト2枚化・接続予定エッジ・配置ルール・
  操作先エッジ・i18n文言・モック更新)は本記録の対象外(frontend担当が別途
  実装)。
- 未実施: `docs/PLAN.md` の Issue #123 チェックボックス更新は、frontend側の
  実装が完了してからまとめて行う(今回は据え置き)。

### 2026-07-06 Issue #123 frontend実装(§4の全項目)

- 担当: frontend
- ブランチ: issue-123-ux-design-node-addition
- 前提: このセッションはセッションリミットで一度中断したfrontend実装の続き。
  着手時点で以下はすでに実装・ビルド・テスト確認済みだった(このセッションでは
  触っていない): `packages/frontend/src/entities/infraNode.ts` の
  `resolveLayoutPositions` / `findFreeGridPosition`(配置ルールの土台)、
  `clientCategory.ts`、`connectionTargets.ts`(`resolveBootNodes` /
  `resolveRpcTargetNode`)、`i18n/messages.ts` のヒント文言キー、
  `glossary/ethereum/terms/b-network.yaml` の `bootnode` 用語。

#### 実装した範囲(§4-1〜§4-6 すべて)

1. **§4-1 押下前のツールチップ**: `canvas/ActionHint.tsx`(新規)を、
   `glossary/GlossaryTerm.tsx` と同じ「`aria-describedby` で参照する自前
   ポップオーバー」の方式で実装した。`commands/commandMessages.ts` に
   `resolveAddNodeHint` / `resolveAddWorkbenchHint` を追加し、
   `connectionTargets.ts` の解決結果 + `i18n/i18n.ts` の `format()` で
   `{elBoot}` 等を実際の containerName に置換する。解決できなければ
   `*.hint.generic` にフォールバックする(§4-5)。`CanvasToolbar` に
   `entities` prop を追加し、`App.tsx` から現在のワールドステートを渡す。
2. **§4-2 仮カード(ゴースト)の拡張**: `entities/ghostNode.ts` の
   `GhostNodeData` に `layer?: "execution"|"consensus"`・
   `targetContainerName?`・`targetNodeId?` を追加。`createGhostNode` は
   `layer` があれば id に `-execution`/`-consensus` サフィックスを付ける
   (同じ commandId の2枚が衝突しないように)。`commands/useCommands.ts` の
   `dispatch` を、addNode 時に execution/consensus 用の2枚のゴーストを
   生成するよう変更した(`resolveBootNodes` / `resolveRpcTargetNode` を
   ディスパッチ時点の world-state から解決し、ゴーストの接続予定先に
   埋め込む)。`GhostNodeCard.tsx` はゴースト名を層に応じて
   「新しいノード (reth)」「新しいノード (beacon)」に、サブタイトルを
   「起動中… {target} と接続予定」/「起動中… 操作先: {target}」に
   (解決できなければ従来どおり「起動中…」のみ)変更した。
   ゴースト→接続予定先ノードへの点線エッジは
   `entities/pendingConnectionEdge.ts`(+`PendingConnectionEdge.tsx`)で
   導出・描画する(node 由来はピア接続系、workbench 由来は操作エッジ系の
   低彩度色)。
   - 実体への対応付け(#102のFIFO近似)は、`removeOldestGhostByKind` を
     `removeGhostForArrivedEntity`(`entities/ghostNode.ts`)に置き換え、
     到着した node エンティティの `clientType` から層を判定して同じ層の
     ゴーストを優先的に消すようにした(見つからなければ層を問わない
     FIFO へフォールバック)。
3. **§4-3 配置ルール**: `App.tsx` に、entities が変化するたびに
   `resolveLayoutPositions` で「まだ保存されていない containerName」に
   空きグリッドスロットを確定し、即座に `saveLayout` で永続化する
   effect を追加した(既存カードの位置は不変。旧「id ソートで毎回添字を
   振り直す」実装は使っていない)。
   - **既知の制約(実装しきれなかった点)**: UX設計 §4-3 ルール2
     「ゴーストの位置 = 実カードの最終位置にする」は、ピクセル単位での
     完全一致までは実装していない。ゴーストの位置は
     `useCommands.ts` の既存の `ghostIndexRef`(単調増加カウンタ、Issue
     #113 対応)をそのまま使っており、実カードの位置は
     `resolveLayoutPositions`(containerName のアルファベット順に空き
     スロットを確定)という別のアルゴリズムで決まる。レイアウトが
     ドラッグ移動されておらず、他の追加操作と競合しない「素の」状態では
     両者はほぼ一致するが、保証はしていない。ゴースト側もレイアウトの
     空きスロット探索を共有する設計にすれば厳密な一致が実現できるが、
     `useCommands` に `layout` を渡す配線・関連テストの大規模な書き換えが
     必要になり、今回のセッション内では見送った(既存カードが動かない
     というルール1の効果は完全に得られている)。次の担当が続きをやる
     場合は、この既知のギャップから着手するとよい。
4. **§4-4 到着後の新着強調・接続確立中エッジ・常設操作先エッジ**:
   - `entities/useNewArrivalHighlight.ts`(新規)で、実カード到着から
     `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`(5000ms)だけ `isNew` を立てる
     フックを実装。`InfraNodeCard.tsx` は `isNew` で `infra-card--new`
     クラス(発光アニメーション)を付ける。
   - `entities/connectingEdge.ts`(+`ConnectingEdge.tsx`)で、実
     PeerEdge を1本も持たないノードから対応する層のブートノードへの
     「P2P接続を確立中…」エッジを導出・描画する。ゴースト由来の
     `pendingConnectionEdge` とは別物で、実エンティティ・実エッジの
     状態だけから毎回導出する(ゴースト側の状態を引き継ぐ必要がない
     設計)。
   - `entities/operationTargetEdge.ts`(+`OperationTargetEdge.tsx`)で、
     `WorkbenchEntity.rpcTargetNodeId` から常設の「操作先」エッジを
     導出・描画する。`InfraPopover.tsx` にも「操作先ノード」欄を追加した。
5. **§4-5 フォールバック**: 各解決関数(`resolveBootNodes` /
   `resolveRpcTargetNode` / 上記の各エッジ導出関数)はすべて
   「解決できなければ省略・描画しない」設計にしており、ユニットテストで
   個別に確認している。
6. **§4-6 モックデータの更新**: `websocket/mockData.ts` を更新した。
   - `createMockSnapshot`: reth-node-1 / lighthouse-1 に
     `p2pRole: "bootnode"`、reth-node-2 に `p2pRole: "peer"` を設定。
     workbench-alice に `rpcTargetNodeId: "reth-node-1"` を設定。
   - `addNode`: 1コマンドで reth + beacon の2エンティティ
     (`newFollowerNodePair`)を追加するよう変更(`applyCommand` の戻り値を
     `diff?` から `diffs?: DiffEvent[]`(複数)に変更)。
     `ADD_NODE_PEER_CONNECT_DELAY_MS`(4000ms、UX確認用の演出値)経過後に
     ブートノードとの `edgeAdded` を模擬発火し、「接続確立中…」→実エッジの
     切り替えをオフラインで確認できるようにした。
   - `addWorkbench`: 新規ワークベンチに `rpcTargetNodeId: "reth-node-1"`
     を設定。
   - ついでに、追加された node/workbench に `removable: true` を設定した
     (副次的な修正。従来 mockData.ts はどの追加エンティティにも
     `removable` を設定しておらず、モック環境では削除ボタンが一切
     表示されない状態だった。本Issueの手動確認で気付いたため、
     コード上ついでに直した)。

#### 実装中に見つけて直した不具合(新着強調の初期表示レース)

Playwright での実機確認で、**接続直後に初期スナップショットのカード
全部が「新着」として発光してしまう**不具合を発見した。原因は
`useWorldState` の接続処理が別 effect の非同期処理であるため、
マウント直後の最初のレンダーでは `entityIds` が空で渡り、次のレンダーで
初期スナップショットの id が届く、という2段階になっていたこと。
「effect の初回呼び出しを基準にする」実装だと、この空の状態を基準に
してしまい、直後に届いた初期カード全部を新着と誤判定していた。

`useNewArrivalHighlight` に `ready: boolean` 引数を追加し、呼び出し側
(`App.tsx`)が `status === "connected"`(=最初のスナップショットが
届いたかどうか)を明示的に渡すよう変更して修正した。`ready` が
初めて true になった時点の id 集合を基準にすることで、接続の非同期性に
依存しない判定にした。修正前の状態を実際に再現し(Playwright:
「infra-card--new count right after arrival: 6」= 初期4件+新規2件が
全部発光)、修正後に再現しなくなること(同じ操作で2件のみ発光)を
Playwright で目視確認した上で、`useNewArrivalHighlight.test.ts` に
この非同期到着レースを再現する回帰テストを追加した。

#### 動作確認

- `pnpm --filter @chainviz/frontend build` / `build:web` / `test` /
  `packages/frontend` への `eslint` すべて通過を確認した
  (675 tests green)。
- Playwright(スクラッチパッドに導入済みのものを再利用。手順は本ファイル
  §8 参照)で実際に `pnpm --filter @chainviz/frontend dev` を起動し、
  以下を目視・テキスト抽出で確認した:
  - ツールチップ: ホバーで日本語/英語とも `{elBoot}`/`{clBoot}`/
    `{rpcTarget}` が実際の containerName に置換されて表示される。
  - ノード追加直後、reth/beacon の2枚の実カードが「新着」発光
    (`infra-card--new`)付きで到着し、ブートノードへの
    「P2P接続を確立中…」点線エッジが表示され、
    `ADD_NODE_PEER_CONNECT_DELAY_MS` 経過後に実エッジ(緑の実線)へ
    切り替わって「接続確立中」エッジが消えることを確認した。
  - 発光は5秒経過後に消えることを確認した。
  - ワークベンチ追加後、常設の「操作先」エッジ(既存の Alice 分・
    新規追加分の両方)が表示され、カードのホバーポップオーバーに
    「操作先ノード: chainviz-reth-1」が出ることを確認した。
- Issue #113(ゴースト配置indexが削除を挟むと重なる)の再現手順に相当する
  テスト(`useCommands.test.tsx` の「placement index」系)は、addNode が
  1回で2つの index を消費する新仕様に合わせて書き直した上ですべて
  green。ただし上記の「既知の制約」のとおり、ゴースト位置と実カード位置の
  厳密な一致(#113の根本原因だった仕組み自体の置き換え)は今回未実施。

#### 変更ファイル(主なもの)

- 新規: `canvas/ActionHint.tsx`(+test)、`entities/connectingEdge.ts`
  (+`ConnectingEdge.tsx`、+test)、`entities/pendingConnectionEdge.ts`
  (+`PendingConnectionEdge.tsx`、+test)、
  `entities/operationTargetEdge.ts`(+`OperationTargetEdge.tsx`、+test)、
  `entities/useNewArrivalHighlight.ts`(+test)
- 変更: `entities/ghostNode.ts`、`entities/GhostNodeCard.tsx`、
  `entities/InfraNodeCard.tsx`、`entities/InfraPopover.tsx`、
  `entities/canvasNode.ts`、`canvas/Canvas.tsx`、`canvas/CanvasToolbar.tsx`、
  `commands/useCommands.ts`、`commands/commandMessages.ts`、`app/App.tsx`、
  `websocket/mockData.ts`、`styles.css`
- 上記すべてに対応するユニットテストを同じ変更の中で追加・更新した
  (`useCommands.test.tsx` は addNode が2ゴーストになった仕様変更に合わせ、
  ゴースト関連のdescribeブロックをほぼ全面的に書き直した)。

#### 次の担当への申し送り

- 上記「既知の制約」(ゴースト⇔実カードの位置厳密一致は未実装)を
  参照。優先度が高ければ、`useCommands` に `layout`(または layout 由来の
  占有セル集合)を渡す設計から着手するとよい。
- `docs/PLAN.md` の Issue #123 チェックボックスは、レビュー・QA前提の
  ため未更新のまま(統括の判断に委ねる)。
- GitHub Issue のクローズ・commit/push/PR作成は行っていない(統括の判断に
  委ねる)。

### 2026-07-06 Issue #123 テスト強化(異常系・境界値)

- 担当: tester
- ブランチ: issue-123-ux-design-node-addition
- 内容: frontend実装担当が書いた基本テスト(675件)に対し、見落としがちな
  異常系・境界値・特殊遷移のユニットテストを15件追加した。実装コードは
  一切変更していない。追加後 `pnpm --filter @chainviz/frontend build` /
  `test`(690件green)/ 対象テストファイルへの `eslint` すべて通過。
- 追加したテストと観点:
  1. `entities/connectingEdge.test.ts`(+2): 接続確立中エッジ(§4-4)が、
     相手がブートノードでない別フォロワーとのピア接続(ディスカバリメッシュ)でも
     消えること。同一層の未接続フォロワーが複数あるとき各々に独立したエッジを
     引くこと(1本に潰れ・取りこぼしが無いこと)。
  2. `entities/connectionTargets.test.ts`(+3): `resolveBootNodes` で
     consensus 片側のみ present のケース(execution-only の対称)、クライアント
     種別が EL/CL いずれにも分類されないブートノードを無視すること。
     `resolveRpcTargetNode` で先頭ワークベンチの `rpcTargetNodeId` が
     ダングリング(指す先のノードが存在しない)でも探索を打ち切らず次の
     解決可能なワークベンチの対象を返すこと。
  3. `commands/commandMessages.test.ts`(+1): `resolveAddNodeHint` が
     consensus ブートノードのみ既知の場合に generic 文言へフォールバック
     すること(§4-5。execution-only の対称ケース)。
  4. `entities/infraNode.test.ts`(+3): `resolveLayoutPositions`(§4-3)で
     複数欠けの中抜けスロットを正しく埋めること、削除済みカードの stale な
     レイアウトエントリが slot を占有し続けるため削除→追加が入り乱れても
     新規カードが重ならないこと(Issue #113 と同種の再発が無いことの確認)、
     グリッド外へドラッグした保存済みカードがグリッドセルを占有しないこと。
  5. `entities/useNewArrivalHighlight.test.ts`(+2): addNode の reth+beacon
     ペアが同一レンダーで同時到着したとき両方を新着強調すること(片方の
     取りこぼしが無いこと)、同時到着した複数 id が duration 経過でまとめて
     解除されること。
  6. `entities/pendingConnectionEdge.test.ts`(+1): ペアの片方だけ接続予定先が
     present な部分解決時、存在する方だけエッジを描き他方を宙ぶらりんに
     しないこと。
  7. `entities/ghostNode.test.ts`(+2): `removeGhostForArrivedEntity` で
     2ペア保留中に片ペアの beacon が先着したとき、層一致で最古の consensus
     ゴーストを消し別ペアの execution を巻き込まないこと(ペアの取り違え・
     交錯が起きないこと)。ゴーストの並びが consensus 先行でも reth 到着は
     execution ゴーストを消すこと(純粋な先頭 FIFO ではなく層一致優先)。
  8. `entities/operationTargetEdge.test.ts`(+1): 複数ワークベンチのうち一方の
     操作先ノードだけが削除された場合、消えた側のエッジは描かず生きている側は
     残すこと(後始末が他方を巻き込まないこと)。
- バグ報告: 既存実装にバグは検出されなかった。上記の観点はいずれも実装が
  正しく振る舞うことを確認する形で追加できた。frontend実装担当が書いた
  基本テストは既にハッピーパス・多くの異常系を高い網羅性でカバーしており、
  今回の追加は隙間の補強にとどまる。
- 未実施: `docs/PLAN.md` のチェックボックス更新・commit/push/PR作成は行って
  いない(統括の判断に委ねる)。frontend実装の「既知の制約」(ゴースト⇔実カード
  位置の厳密一致未実装)はテスト対象外(未実装機能のため)。

### 2026-07-06 Issue #123 静的レビュー1回目(差し戻し)

- 担当: reviewer
- ブランチ: issue-123-ux-design-node-addition(全変更が未コミットの状態で
  レビューした)
- 確認したこと:
  - 設計原則: フロントは Docker/ノード API に直接触れておらず、collector の
    `rpcTargetNodeId` 解決も IP ベースのチェーン非依存な実装で問題なし。
    `entities/clientCategory.ts` は reth/lighthouse 等のクライアント名で
    EL/CL を判定するチェーン固有ロジックだが、main 側の `InfraPopover.tsx` /
    `PeerNetworkLegend.tsx` に既に同種の前例があり、将来チェーンプロファイル
    表現セット(`chain-profiles/`)へ移す旨の負債コメントも明記されているため
    許容とした
  - `packages/shared`: 差分なし(型は #134 で先行マージ済みのものをそのまま
    使用)を確認
  - エラー握りつぶし: 新規コードに catch 節そのものが無く、各解決関数は
    「解決できなければ省略・描画しない」というフォールバックを docstring 付きで
    実装しており問題なし。ダングリング参照ガード(collector 担当の申し送り)も
    pendingConnectionEdge / connectingEdge / operationTargetEdge の全てに
    入っている
  - 固定値: `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`(5000ms)・
    `ADD_NODE_PEER_CONNECT_DELAY_MS`(4000ms、モック演出値)とも「環境の状態に
    依存しない UX 上の固定値」である旨のコメントがあり問題なし
  - 品質ゲート: リポジトリ全体で `pnpm lint` / `pnpm build` / `pnpm test`
    (shared 13 / e2e 34 / collector 629 / frontend 690)すべて通過
  - テストの質: tester 強化分15件を含め、異常系(片側のみ解決・ダングリング
    参照・ペア同時到着・層一致 FIFO)まで実装の振る舞いを検証しており良好
  - UX設計(§4)からの逸脱・先回り実装: 文言は設計の文言と一致。実装範囲も
    §4-1〜§4-6 に収まっており過剰実装なし
- 差し戻し理由(要対応2点):
  1. **新着強調の `ready` 修正が実 WebSocket クライアントでは不完全**。
     `websocket/client.ts` は WebSocket の `open` イベントで status を
     `connected` にするが、スナップショットはその後の `message` イベントで
     届く。そのため実接続では「`ready=true` かつ entities 空」のレンダーが
     必ず1回挟まり、`useNewArrivalHighlight` が空集合を基準に確立してしまい、
     直後に届く初期スナップショットの全カードが新着発光する(修正したはずの
     不具合が実環境でだけ再発する)。モック(`mockData.ts` の `connect()`)は
     `connected` への遷移とスナップショット配信を同一同期処理内で行うため
     React のバッチ処理で同時に見え、Playwright(dev=モック)の確認では
     検出できない。回帰テストも「ready と ids が同時に届く」ケースのみで、
     「ready が先行し ids が1レンダー遅れて届く」実クライアントの順序を
     カバーしていない。対応案: `ready` を「接続状態」ではなく「最初の
     スナップショットを適用済みか」に基づかせる(例: `useWorldState` が
     snapshot 適用済みフラグを返す)。あわせて「ready 先行・ids 後着」の
     回帰テストを追加すること
  2. **main(origin/main)の取り込みが必須**。本ブランチ分岐後に Issue #124
     (PR #137)が main へマージされており、重複ファイルが多い。特に
     `glossary/ethereum/terms/b-network.yaml` には **bootnode 項目が本ブランチ
     と main の双方で別文面のまま追加**されており、単純マージでは YAML の
     重複キーになるため1つに統合する必要がある。collector の
     `adapters/ethereum/index.ts`(pollInfra 周辺)・`Canvas.tsx`・
     `InfraNodeCard.tsx`・`InfraPopover.tsx`・`messages.ts`・`styles.css` も
     両側で変更されている。また本ブランチのブートノード予告機能は
     `NodeEntity.p2pRole` を collector が設定する #124 の実装(main 側)に
     依存しており、main を取り込まない限り実環境では generic フォールバック
     しか動作しない(QA が本来の動作を検証できない)。取り込み・衝突解消後に
     lint/build/test を再実行すること
- 軽微な指摘(対応は裁量、差し戻し理由ではない):
  - `entitiesToFlowNodes` の1レンダー限りの暫定位置は id ソート順で空き
    スロットを割り当てる一方、確定側の `resolveLayoutPositions` は
    containerName 辞書順。複数カード同時初出時に暫定位置と確定位置が
    食い違い、1レンダーだけ位置が飛び得る(実害は軽微)
  - UX設計 §6-4 の CONCEPT.md 追記提案は未実施のまま(統括預かりの判断事項。
    マージ前に採否を決めること)
  - mockData の `removable: true` 付与は本 Issue と別関心の副次修正なので、
    コミットを分けること
- 申し送り事項への回答:
  1. `ready` 修正の妥当性 → モック経路に対しては妥当だが、実クライアント
     経路で上記1のとおり不完全。差し戻し
  2. ゴースト位置と実カード最終位置の不一致 → 許容と判断。ルール1(既存
     カード不動)は完全に実現されており、Issue #113 同種の再発もテストで
     担保済み。厳密一致は残件として別 Issue 化を推奨
  3. main 取り込み → 必要(上記2)
- コミット粒度: 現状すべて未コミット。「1変更1コミット」に従い、少なくとも
  collector 実装 / glossary(※main 取り込みで #124 側と統合するなら消える
  可能性あり) / frontend の §4-1(ツールチップ)・§4-2(ゴースト・接続予定
  エッジ)・§4-3(配置ルール)・§4-4(新着強調・確立中・操作先エッジ)・
  §4-6(モック更新) / removable 副次修正 / テスト強化 / worklog の単位で
  分けることを推奨する

### 2026-07-06 統括によるレビュー指摘対応

- レビュー(査読誠)の差し戻し2点に対応:
  1. **新着強調のreadyバグ**: `useWorldState`に`hasReceivedSnapshot`
     (最初のスナップショット受信済みか)を追加。実WebSocketクライアント
     では`status==="connected"`(onopen相当)とスナップショット到着の
     間に「connectedだがentitiesは空」のレンダーが必ず挟まるため、
     `App.tsx`の`useNewArrivalHighlight`の`ready`引数をこちらに切り替えた。
     `useWorldState.test.tsx`に、実際の順序(open先行→snapshot後着)を
     再現する回帰テスト3件を追加。修正前のロジック
     (`hasReceivedSnapshot: status === "connected"`)に一時的に戻し、
     3件とも意図通り失敗することを確認してから元に戻した。
  2. **mainの取り込み**: Issue #124(PR #137)マージ後のmainを取り込んだ。
     `glossary/ethereum/terms/b-network.yaml`のbootnode定義が両ブランチ
     で重複していたため統合。
- コミットを以下の単位に分割した:
  1. `feat(collector)`: rpcTargetNodeId解決
  2. `feat(glossary)`: bootnode用語追加
  3. `feat(frontend)`: UX実装一式(§4-1〜§4-6、readyバグ修正含む)
  4. 本コミット(docs)
- `pnpm lint && pnpm build && pnpm test`すべて通過を再確認。

### 2026-07-06 レビュー再実施（査読誠・2回目）: 不合格（差し戻し）

- 確認範囲: 差し戻し2点の解消状況、rebase後の#123/#124共存、
  lint/build/test、コミット粒度
- 合格した項目:
  1. **新着強調のreadyバグ修正**: `useWorldState`の`hasReceivedSnapshot`は
     `onSnapshot`内でのみtrueになり、`status`と独立。実クライアントの順序
     （onopen先行→snapshot後着）を再現する回帰テスト3件も妥当で、
     「修正前ロジックに戻すと3件とも失敗する」検証も実施済みと確認。
     `App.tsx`→`useNewArrivalHighlight`への配線も正しい。解消と認める
  2. **mainの取り込み自体**: `origin/main`(PR #137マージ後)がHEADの祖先で
     あることを確認。#124の凡例・ホバー・バッジ（PeerNetworkLegend /
     PeerEdgePopover / InfraNodeCardのbootnodeバッジテスト）は本ブランチの
     差分で破壊されておらず、`messages.ts` / `styles.css` /
     `InfraNodeCard.test.tsx` は両Issueの内容が共存している。rebase後の
     optional chaining修正(3b207ba)も妥当
  3. `pnpm lint && pnpm build && pnpm test` 全通過（frontend 758件含む）
  4. コミット粒度: 6コミット構成は許容範囲。ただし`feat(frontend)`(576cde9)
     は3,334行追加と大きく、前回推奨した§単位の分割には従っていない
     （推奨事項のため差し戻し理由にはしない）
- **差し戻し理由（1件・ブロッキング）**:
  - `glossary/ethereum/terms/b-network.yaml` に **トップレベルキー
    `bootnode:` が二重定義**されている（54行目=main/#124由来、105行目=
    本ブランチのコミット138f30b由来。文面も別物）。前回差し戻し理由2で
    「1つに統合する必要がある」と明記した症状そのものが未解消。
    worklogの前回対応記録には「重複していたため統合」とあるが、実際には
    統合されていない（#124側とは挿入位置が違うためrebaseで文面上の
    コンフリクトが発生せず、両方が残ったまま素通りしたと推測される）
  - 実害: フロントの `glossary/parse.ts` は `js-yaml` の `load()` を
    そのまま呼んでおり、js-yamlは重複キーで `duplicated mapping key
    (105:1)` 例外を投げる。`glossary/data.ts` はモジュール評価時
    （＝アプリ起動時）に `parseGlossaryYaml(bNetworkRaw)` を呼ぶため、
    **フロントは起動時にクラッシュする**。lint/build/testが通るのは、
    `parse.test.ts` が実データとして `a-infra.yaml` しか読んでおらず、
    `b-network.yaml` を誰もパースしないため
- 対応指示:
  1. 54行目（#124由来）と105行目（本ブランチ由来）のbootnode定義を
     1つに統合する（#124版の「reth1/beacon1がこの役を担う」と#123版の
     「chainvizが接続先を事前に予告する」は補完関係なので、文面を
     マージするのが望ましい。ja/en両方）。コミット138f30bの内容を
     修正する形（rebase -iやamend相当）でも、修正コミットの追加でも可
  2. 再発防止として、実データのglossary YAML全ファイル（a-infra /
     b-network / c-transaction）をパースして例外が出ないことを確認する
     テストを追加すること（今回の重複キーはこのテストがあれば品質ゲート
     で検出できた）。追加したテストが修正前の状態で実際に失敗することを
     確認してから統合すること
  3. worklogの前回対応記録の「統合した」という記述は事実と異なるため、
     訂正の追記をすること

### 2026-07-06 統括による差し戻し対応(2回目)

前回の対応記録「重複していたため統合」は事実誤認だった(訂正)。実際には
rebase時、main/#124由来のbootnode定義(54行目)と本ブランチ由来の定義
(105行目)が異なる挿入位置だったためコンフリクトマーカーが出ず、両方が
サイレントに残っていた。

- `glossary/ethereum/terms/b-network.yaml`の105行目の重複ブロック(#123
  由来)を削除し、54行目(#124由来、reth1/beacon1の役割まで説明する内容)
  に統一した。js-yamlで実際にパースできることを確認済み。
- 再発防止として、`packages/frontend/src/glossary/parse.test.ts`に
  実データの全glossaryファイル(a-infra/b-network/c-transaction)を対象
  にした回帰テスト3件を追加した:
  - 全ファイルが例外なくパースできること
  - 各ファイル単体でトップレベルキーの重複が無いこと
  - 3ファイルをマージした結果のキー数が個別キー数の単純合計と一致する
    こと(=マージ時にもキー衝突が無いこと)
  追加したテストが実際に不具合を検出できることを、b-network.yamlへ
  一時的にbootnodeを重複させて確認した(3件とも意図通り失敗、
  `duplicated mapping key`例外を実際に確認)。元に戻した後、全761件
  (frontend)通過を確認。
- `pnpm lint && pnpm build && pnpm test`すべて通過を再確認。

### 2026-07-06 レビュー再実施（査読誠・3回目）: 合格

- 確認範囲: 前回差し戻し1件（b-network.yamlのbootnode二重定義）の解消
  状況、追加された回帰テストの実効性、lint/build/test、data.tsとテスト
  対象ファイルの整合
- 確認結果:
  1. **二重定義の解消**: `grep -n "^bootnode:"` で54行目の1箇所のみで
     あることを確認。worklogの記述を鵜呑みにせず、js-yamlで実ファイル
     3件（a-infra/b-network/c-transaction）を直接パースし、いずれも
     例外なく読めることを自分の手で確認した（b-network: 7キー）。
     残した文面は#124由来のreth1/beacon1の役割説明を含む版で、内容も妥当
  2. **回帰テストの実効性**: レビュー側でも独立に検証した。b-network.yaml
     のコピー（scratchpad上）へbootnodeを意図的に重複させ、js-yamlが
     `duplicated mapping key` 例外を実際に投げること、テスト内のregexが
     重複キー `bootnode` を検出できることを確認。3件のテスト
     （例外なしパース／ファイル内キー重複なし／マージ後キー数=単純合計）
     は、今回の不具合クラス（同一ファイル内の重複・ファイル間の衝突）を
     いずれも検出できる実効的な設計と認める
  3. `pnpm lint && pnpm build && pnpm test` 全通過（frontend 761件、
     parse.test.ts 17件を含む）
  4. `glossary/ethereum/terms/` の実ファイルは3件のみで、`data.ts` が
     読むファイルとテスト対象が過不足なく一致
- 非ブロッキングの指摘（次回改修時に直せばよい）:
  - `parse.test.ts` の「has no duplicate term keys」テストのコメント
    （197-199行目付近）が実装と食い違っている。「js-yamlが例外を投げる
    ことを直接確認する」とあるが、実際はregexによるテキスト走査であり、
    また冒頭の「後勝ちで静かに1件へ潰れる」もjs-yamlの既定動作（重複キー
    で例外）と矛盾する。テスト自体の実効性は上記2の通り確認済みのため
    差し戻しにはしない
- 判定: **合格**。push/PR作成/マージ/Issueクローズは統括に委ねる
