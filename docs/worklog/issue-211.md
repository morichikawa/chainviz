# Issue #211/#212/#213/#215/#218/#219 UX設計（デプロイ・操作・役割の伝わり方）

### 2026-07-10 Issue #211 ほか5件 まとめてUX評価・設計

- 担当: ux
- ブランチ: issue-211-deploy-feedback-ux
- 内容: ユーザーが手動操作中に発見した6件のUX Issue（#211 デプロイの見え方、
  #212 tx の状態・チェーンのつながり、#213 操作の説明、#215 reth/beacon の
  役割、#218 コントラクト一覧、#219 ウォレット⇔コントラクトの関係）を、
  稼働中の chainviz-ethereum スタック + collector + frontend を Playwright で
  実際に操作して評価し、4つの実装単位に切り分けて設計した
- 決定事項・注意点:
  - 実装単位は A（#215、shared/collector/node-env を含む）、B（#213+#219、
    frontend のみ）、C（#211+#218、frontend のみ）、D（#212、frontend +
    glossary）。B/C/D は互いに独立で並行可能。A のみ designer 調整が必要
  - 評価中に別の問題2件を発見し起票済み（#244 デプロイtxのイベント未復号、
    #245 ポップオーバーの z-order）。本設計では扱わない
  - 統括・ユーザーの判断が要る点は「6. 確認したい判断」に集約した

## 1. 評価方法

- 稼働中の chainviz-ethereum スタック（compose 7コンテナ + collector:4000 +
  vite:5173）を再利用し、Playwright（chromium）で実際に操作・撮影した
- 実施した操作: 全カード種のホバー（ノード×3種・ワークベンチ・ウォレット・
  コントラクト）、操作パネルの3タブ、Counter のデプロイ、increment 呼び出し、
  ChainvizToken の transfer 呼び出し、各エッジの確認
- 評価時点の環境には ChainvizToken が2つデプロイ済み（ユーザーの手動確認の
  痕跡）で、「同名コントラクトが並ぶ」「トークン残高 0.0000 CVZ」という
  #218/#219 の指摘がそのまま再現された状態だった

## 2. 現状評価（実際に動かして分かったこと）

### 横断的な結論

現在のキャンバスは「何が起きたか」（パルス・チップ・発光などの出来事）は
よく見せているが、「これは何者で、何ができて、なぜそこにつながって
いるのか」（役割・能力・関係の説明）をほとんど示していない。6件の指摘は
すべてこのギャップの現れで、次の3つの切り口に整理できる:

1. **役割の説明が無い** — ノードカードはコンテナ名と clientType
   （reth / lighthouse）だけで、それが何をする係なのかを示さない（#215）。
   ワークベンチ→ノードの「操作先」エッジも、なぜその1本に固定なのかを
   説明しない（#215 コメント）
2. **操作の意味と結果の予告が薄い** — 操作パネルは操作の「手順」
   （フォーム）は示すが「意味」（この関数は何をするのか、単位は何か、
   結果はどこに現れるか）を示さない（#213・#219・#211）
3. **チェーン側の状態の一覧性・可読性が無い** — コントラクトはカードを
   探して回るしかなく（#218）、tx は pending/included の2値でしか見えず
   署名・検証という段階が存在したことが分からない（#212）

### Issue ごとの所見

**#211（デプロイの見え方）**: 仕組み自体はほぼ実装済みで機能している。
デプロイ実行で (1) ワークベンチに「実行中…」スピナー、(2) 操作パルス、
(3) コントラクト行に仮カード「デプロイ中… Counter」、(4) 確定で実カードに
置換＋新着発光＋デプロイエッジ、が観測できた。伝わらない原因は2点:

- 仮カード・実カードが現れる**コントラクト行はウォレット行のさらに下**に
  あり、操作パネル（ワークベンチ脇）に視線がある状態では画面外になりうる。
  出現場所を予告する文言も、出現後にそこへ誘導する導線も無い
- pending 中のデプロイ tx チップはハッシュ短縮表示で、「デプロイが進行中」
  だと分からない（確定して初めて「デプロイ」ラベルになる。
  `createdContractAddress` が確定後にしか入らないため）

**#212（署名中か・状態の中身）**: tx の見え方は「チップが pending 色で
明滅→確定フラッシュ」のみ。統括コメントの3段階（署名→検証→取り込み）の
うち、署名・検証は UI 語彙に存在しない。なお「署名中」というリアルタイム
状態は観測不能（cast はワークベンチ内で署名し、ロギングプロキシには署名
済み tx しか届かない）なので、「今署名中です」という状態表示は作れないし
作るべきでない（実測に基づく表示という設計方針に反する）。一方「この tx は
署名という段階を経てここに居る」という事後の説明は現状の status だけで
導出でき、これが要望への誠実な回答になる。「チェーンの繋がり方」（ブロックが
parentHash で連結されている構造）と「状態の中身」（コントラクト内部の値）は
現状可視化ゼロで、後者は collector 拡張（eth_call）が要る（→ 6. 判断3・4）。

**#213（操作の説明）**: ボタンホバーの予告（ActionHint）とタブ末尾の
note（「tx は mempool に入り…」）は実装済みで良い。足りないのは
「この操作はそもそも何をするものか」の1行と、後述の関数説明。

**#215（reth/beacon の役割）**: 一番ギャップが大きい。実測での見え方:

- 6枚のノードカードすべてが種別ラベル「ノード」で、サブタイトルは
  clientType のみ。beacon1 と validator1 はどちらも「lighthouse」表示で、
  初見では区別不能
- 役割を説明する情報は、(1) ポップオーバーの「クライアント」ラベルの
  用語解説（el-client / cl-client）、(2) beacon 側ポップオーバーの
  「駆動する実行ノード」行、(3) 内部リンクエッジのホバー（「この2つの
  コンテナは…1つの Ethereum ノードです」）に**存在はする**が、いずれも
  ホバーの奥に隠れていて、カードを見ただけでは到達できない
- reth 側のポップオーバーには逆方向（どの beacon に駆動されているか）の
  行が無い
- validator はさらに悪く、ポップオーバーが「同期状態: 同期中・ブロック高 0」
  を出し続ける。バリデーターはチェーンのコピーを同期する係ではないので
  この表示自体が誤解を招く（「壊れているのでは」という印象を与える。
  #214 の指摘とも隣接）
- ワークベンチの「操作先ノード」行・操作先エッジは存在するが、「なぜ
  reth1 固定なのか」「ブートノード役とは無関係」という説明が無い
  （#215 コメントの整理: RPC 接続先の固定は chainviz の観測都合＋実運用
  でも普通のこと / bootnode は P2P 発見の入口という別概念）

**#218（コントラクト一覧）**: コントラクト行のカードが唯一の一覧。評価
環境では同名の ChainvizToken が2枚並び、アドレス短縮表示でしか区別でき
ない。デプロイが増えるほど横に伸び、探して回る負担が増える。呼び出し
タブのドロップダウン「ChainvizToken (0x2fba97…d592)」も同様。

**#219（ウォレットがスマコンに何ができるか）**: 呼び出しタブの関数
ドロップダウンは生の関数名（transfer / approve / transferFrom / mint …）
のみで、各関数が何をするか・誰が呼べるか（mint は deployer のみ）の説明が
無い。さらに**トークン量の単位問題**が深刻: ChainvizToken は decimals=18
で、amount / initialSupply は最小単位の生値入力。ユーザーが「1000」と
入れると 1000 wei 相当 = 表示上「0.0000 CVZ」となり、「デプロイしたのに
残高が増えない」ように見える。評価環境のウォレットがまさにこの状態
（0.0000 CVZ ×2）だった。ETH 送金は ETH 単位入力＋wei 変換済みなのに
トークンは生値、という一貫性の欠如が根本原因。

## 3. 実装単位への切り分け

| 単位 | 対象 Issue | 触るパッケージ | 依存 |
| --- | --- | --- | --- |
| A: ノードの役割と関係の可視化 | #215 | shared / collector / profiles(node-env) / frontend / glossary | designer で `NodeEntity.nodeRole` を先に確定 |
| B: 操作パネルの説明とトークン単位 | #213 + #219 | frontend / glossary | なし（frontend 単独） |
| C: コントラクト一覧とデプロイ結果の導線 | #218 + #211 | frontend | なし（frontend 単独） |
| D: tx ライフサイクル表示 | #212 | frontend / glossary | なし（frontend 単独） |

- グルーピングの理由: #213 と #219 は「操作パネルの説明不足」という同一
  部品への変更（#219 は関数説明とトークン単位に焦点を絞った深掘り）。
  #218 と #211 は「デプロイ結果がどこにあるか」への答えを同じ新設部品
  （コントラクト一覧パネル）で共有する
- B・C・D は互いに独立しており並行実装できる。A のみ shared 型変更を
  含むため、標準フロー（designer → node-env/collector/frontend）で進める
- PR は単位ごとに分け、`Closes` は各単位の対象 Issue を列挙する

## 4. 各実装単位の設計

### 単位A: ノードの役割と関係の可視化（#215）

**データフロー**（designer と要調整）:

1. `profiles/ethereum/docker-compose.yml` の各ノードサービスに Docker
   ラベル `com.chainviz.node-role` を付与する（reth1/reth2 = `execution`、
   beacon1/beacon2 = `consensus`、validator1/validator2 = `validator`）。
   collector の addNode で動的追加するコンテナにも同じラベルを付ける
   （既存の managed / p2p-role ラベル付与と同じ箇所。Issue #65 の
   「ラベルを単一の真実の情報源とする」方針に従う）
2. shared: `NodeEntity` に `nodeRole?: string` を追加。値は**生の文字列**
   とし、解釈・表示はフロントのチェーンプロファイル表現セットの責務に
   する（`OperationEdge.operation` / `SyncStageProgress.stage` と同じ
   パターン。execution/consensus はチェーン固有の概念なので、union 型で
   スキーマに焼き込まない）。ラベルが無い・旧スナップショットでは省略
   （省略 = 不明。フロントは役割表示を出さない。p2pRole と同じ流儀）
3. frontend: `chain-profiles/ethereum/nodeRoles.ts` を新設し、
   `nodeRole 値 → { label: Localized, glossaryKey: string }` のマップを
   置く（syncStageLabels.ts と同じ流儀）:
   - `execution` → ラベル「実行クライアント / Execution client」、
     glossaryKey `el-client`
   - `consensus` → 「コンセンサスクライアント / Consensus client」、
     glossaryKey `cl-client`
   - `validator` → 「バリデーター / Validator」、glossaryKey `validator`
     （用語新設、後述）

**UI**:

- **カードのサブタイトル**を「{役割ラベル} · {clientType}」にする
  （例: 「実行クライアント · reth」「バリデーター · lighthouse」）。
  nodeRole 不明時は従来どおり clientType のみ。これで「カードを見た
  だけで役割が分かる」を最短で満たす（#215 の本丸）
- **ポップオーバーに「役割」行を常設**する（nodeRole があるノードのみ）。
  値に GlossaryTerm（上記 glossaryKey）を張る。既存の bootnode 行は
  「P2P での役割」という**別軸**なので統合しない。混同を防ぐため既存
  bootnode 行のラベルを「役割」から「P2P での役割」に変更する
- **validator の無意味な表示を消す**: `nodeRole === "validator"` のとき、
  カードの同期状態ドット・ポップオーバーの「同期状態」「ブロック高」行を
  出さない（バリデーターはチェーンを同期する係ではないため。値ゼロの
  まま出し続ける現状は「壊れている」誤解を招く）。代わりにポップオーバー
  の役割行の用語解説（validator）で「ブロックの提案・承認をする係」で
  あることを説明する
- **reth 側ポップオーバーに逆方向の行**「駆動元（合意ノード）」を追加する。
  データは既存の `drivesNodeId` の逆引きでフロント側で導出できる
  （shared 変更不要）。ラベルの GlossaryTerm は既存 `engine-api`
- **操作先エッジ（OperationTargetEdge）にホバーポップオーバーを新設**
  （PeerEdgePopover と同型）。文言は #215 コメントの「一般論と chainviz
  都合の切り分け」を必ず反映する（i18n 表参照）。あわせてワークベンチ
  ポップオーバーの「操作先ノード」ラベルに GlossaryTerm（`rpc-endpoint`
  新設）を張る

**glossary 追加**（`glossary/ethereum/terms/a-infra.yaml`。定義は既存の
3拍子「定義 → なぜ必要か → chainviz ではどう見えるか」で書く）:

- `validator`: ステーク（担保）を預けてブロックの提案・承認に参加する係。
  合意はチェーンを勝手に伸ばさないための多数決であり、その投票者。
  chainviz ではコンセンサスクライアントに接続された専用コンテナとして
  見える（チェーンのコピーは持たず、同期状態・ブロック高を表示しない
  理由もここで説明する）。関連: cl-client, bootnode
- `rpc-endpoint`: ウォレットやアプリがチェーンとやり取りする窓口となる
  1つのノードの API。実際の Ethereum でも「一番近いノードを探す」のでは
  なく、あらかじめ決めた1つのエンドポイント（自分のノードや Infura /
  Alchemy などの事業者）に固定的に接続するのが普通（関連サービス TIPS の
  候補: Alchemy / Infura）。chainviz では全操作を観測（ロギングプロキシ）
  するため接続先を1本に固定しており、それが操作先エッジとして見える。
  P2P の入口であるブートノードとは別の概念。関連: workbench, bootnode

**i18n 文言（初稿。役割ラベル自体は nodeRoles.ts 側に置き messages.ts に
入れない）**:

| キー | ja | en |
| --- | --- | --- |
| `field.nodeRole` | 役割 | Role |
| `field.p2pRole` | P2P での役割 | P2P role |
| `field.drivenBy` | 駆動元（合意ノード） | Driven by (consensus node) |
| `edge.operationTarget` | 操作先（RPC 接続先） | RPC target |
| `edge.operationTarget.hint` | このワークベンチの操作（RPC 呼び出し）が届くノードです。実際の Ethereum でもウォレットは決まった1つの RPC エンドポイントに接続します。chainviz ではさらに、全操作を観測して表示するため接続先をこの1本に固定しています（ブートノード役とは無関係です） | The node this workbench's operations (RPC calls) go to. Real Ethereum wallets also connect to one fixed RPC endpoint. chainviz additionally pins the target to observe and display every operation (unrelated to the bootnode role). |

### 単位B: 操作パネルの説明とトークン単位（#213 + #219）

frontend のみ。`packages/frontend/src/operations/` と
`chain-profiles/ethereum/operationCatalog.ts` の変更。

**タブごとの説明1行**を各フォーム冒頭に置く（既存 note と同じ muted
スタイル。「何をする操作か」→フォーム→「実行するとどうなるか」(既存 note)
の順になる）:

| キー | ja | en |
| --- | --- | --- |
| `operation.transfer.description` | あなたのウォレットから別のアドレスへ ETH を送る操作です | Sends ETH from your wallet to another address. |
| `operation.deploy.description` | コントラクト（プログラム）をチェーン上に配置する操作です。配置されると誰でも呼び出せるようになります | Places a contract (program) on the chain. Once placed, anyone can call it. |
| `operation.call.description` | デプロイ済みコントラクトの関数を tx として実行し、コントラクトの状態を変更する操作です。公開関数はどのウォレットからでも呼び出せます | Runs a function of a deployed contract as a tx, changing the contract's state. Public functions can be called from any wallet. |

3つ目の文の後半（どのウォレットからでも呼び出せる）が #219 の
「ウォレットはスマコンに何ができるのか」への直接の回答になる。

**関数の一言説明**: `OperationFunctionForm` に `description: Localized` を
追加し、関数選択の直下に選択中関数の説明を表示する（コントラクト選択の
一言説明と同じ見た目）。初稿（ソース `profiles/ethereum/contracts/src/`
確認済み。mint のみ onlyOwner、reset は制限なし）:

| 関数 | ja | en |
| --- | --- | --- |
| transfer | 自分のトークン残高から to へ amount を送ります | Sends amount from your token balance to `to`. |
| approve | spender に、自分の残高から amount まで引き出す許可を与えます | Allows `spender` to withdraw up to amount from your balance. |
| transferFrom | approve で許可された範囲で from から to へトークンを移します | Moves tokens from `from` to `to`, within an approved allowance. |
| mint | 新しいトークンを amount 分発行して to に与えます（デプロイした人だけが実行できます） | Issues new tokens to `to` (only the deployer can call this). |
| increment | カウンタを 1 増やします | Increases the counter by 1. |
| incrementBy | カウンタを amount 増やします | Increases the counter by amount. |
| reset | カウンタを 0 に戻します | Resets the counter to 0. |

**トークン量の単位換算**（#219 の根本対応。→ 6. 判断1）:

- `OperationArgField` に `unit?: "token"` を追加し、トークン量を表す引数
  （transfer / approve / transferFrom / mint の amount、コンストラクタの
  initialSupply）に付ける
- `unit === "token"` の引数は **トークン単位の 10 進入力**（例: `1.5`）に
  し、送信時に decimals で最小単位へ変換する（ETH 金額欄
  `etherAmount.ts` と同じ流儀。ラベルに「（CVZ 単位）」を添える）
- decimals の取得: 呼び出しタブは対象 `ContractEntity.token.decimals`。
  デプロイタブはまだエンティティが無いため、カタログエントリに
  `tokenDecimals?: number`（ChainvizToken = 18）を静的に持たせる
  （ABI とカタログの二重管理は ARCHITECTURE.md §6.5 で許容済みの範囲。
  ソース側も `decimals = 18` の定数）
- これにより「initialSupply に 1000 と入れたのに残高が 0.0000 CVZ」
  という #219 の混乱（評価環境で実際に再現）が根本から消える

**変更しないこと**: ActionHint・既存 note・確認ダイアログなし（気軽に
触れて結果は観測で見せる）の方針は維持。view/pure 関数の掲載もしない
（Issue #167 の判断を維持）。

### 単位C: コントラクト一覧とデプロイ結果の導線（#218 + #211）

frontend のみ。

**コントラクト一覧パネル（新設。#218 の中核）**:

- PeerNetworkLegend と同じ流儀の常設ミニパネルを画面左下（ズーム
  コントロールの上。右下の凡例・ミニマップと重ねない）に置く
- ヘッダ「コントラクト {n}」（ラベルに GlossaryTerm: `contract`）。
  行: `{name または「未知のコントラクト」} {shortHex(address)}`、token が
  あれば「· {symbol}」を続ける。並びは出現順（新しいものが上）
- **行クリックでキャンバスの該当カードへパン**（React Flow `setCenter`。
  ズーム倍率は現状維持）し、到着先のカードに新着発光と同じ一時
  ハイライトを当てる。「一覧から場所へ飛べる」ことが、カードを探して
  回る負担（#218）とデプロイ後の迷子（#211）の両方への答えになる
- デプロイ進行中は仮カード（ghost）と同じデータ源から「デプロイ中… {表示名}」
  行を出す（クリックで仮カードへパン）。`entityAdded`（contract）で
  実行に置換し、行にも短時間の新着ハイライトを当てる
- 0 件かつデプロイ進行中も無いときはパネル自体を出さない（初期画面を
  汚さない。ウォレット 0 件時の流儀と同じ）
- 新しいトースト/通知チャネルは**作らない**（成功通知を既存のエラー用
  トーストに混ぜると通知過多になる。導線はパネルと仮カードで足りる）

**デプロイ tx の pending 表示（#211）**: `txChipLabel` を拡張し、
`tx.to === null`（コントラクト作成 tx）なら pending 中も「デプロイ」
ラベルを出す（現在は `createdContractAddress` が入る確定後のみ）。
WalletPopover の tx 一覧も同じ導出を使っているため同時に直る。

**デプロイ note の場所明示（#211）**: `operation.deploy.note` の文言を
「…取り込まれるとコントラクトカードがキャンバス下段（ウォレットの下の
段）に現れます」に更新し、出現場所を押す前に予告する。

**トークン残高チップの区別（#218 派生）**: WalletCard のトークンチップの
title と WalletPopover のトークン残高行を「{コントラクト名}
（{shortHex(address)}）」に変更する（同名トークンが複数あるとき
アドレスで区別できるように。評価環境の「0.0000 CVZ ×2」が実例）。

**i18n 文言（初稿）**:

| キー | ja | en |
| --- | --- | --- |
| `contractList.title` | コントラクト | Contracts |
| `contractList.deploying` | デプロイ中… {name} | Deploying… {name} |
| `contractList.jumpHint` | クリックでキャンバス上のカードへ移動 | Click to jump to the card on the canvas |
| `operation.deploy.note`（更新） | ソースからコンパイルしたコントラクトを配置する tx が送られ、取り込まれるとコントラクトカードがキャンバス下段（ウォレットの下の段）に現れます | Sends a tx that places the compiled contract on chain; once included, a contract card appears in the bottom row of the canvas (below the wallets). |

### 単位D: tx ライフサイクル表示（#212）

frontend + glossary。shared 型変更は**しない**（署名・検証のリアルタイム
状態は観測不能なので、状態を増やすのではなく「経てきた段階」を既存
status から導出して見せる。嘘の状態を作らない）。

**tx チップのホバーポップオーバー（新設）**: 現在の title 属性（hash のみ）
を小型ポップオーバーに置き換える。WalletCard / WalletPopover の tx チップ
共通。構成:

- ヘッダ: `shortHex(hash)` + 既存ステータスバッジ（`tx.status.*`）
- **ライフサイクル 4 段の縦リスト**。各行 = マーク + ラベル + 一言説明。
  マークは ✓（完了）/ ●（進行中）/ ✕（失敗）。導出は既存 status のみ:
  pending → 1・2 が ✓、3 が ●、4 は未到達表示。included → 全 ✓。
  failed → 1〜3 ✓、4 が ✕

| 段階 | ラベル（GlossaryTerm） | 一言説明 ja | en |
| --- | --- | --- | --- |
| 1 | 署名（`signature` 新設） | ワークベンチの中で秘密鍵により署名済み。この時点ではまだチェーンに触れていません | Signed with the private key inside the workbench. Nothing has touched the chain yet. |
| 2 | 送信（`rpc-endpoint`※単位Aで新設。未実装なら `workbench`） | 署名済み tx が操作先ノードへ送られました | The signed tx was sent to the RPC target node. |
| 3 | mempool（`mempool`） | ノードが署名・nonce・残高を検査し、取り込み待ちの列に入れます | The node checks the signature, nonce and balance, then queues it for inclusion. |
| 4 | ブロック取り込み（`block` 新設） | ブロックに取り込まれ、全ノードに複製されて確定しました | Included in a block, replicated to every node, and final. |

（4 の failed 時: 「実行が失敗として記録されました（ブロックには
取り込まれています）」/ "Recorded as failed (still included in a block)."）

段階 1・2 が常に ✓ なのは「chainviz に tx が見えている時点で署名・送信は
済んでいる」という観測事実に基づく。3 の説明文が統括コメントの
「バリデーション」段階の回答を兼ねる（独立した状態としては見せない。
mempool 投入時の検査として説明する）。

**glossary 追加**（`glossary/ethereum/terms/c-transaction.yaml`）:

- `signature`（署名）: 秘密鍵による「本人が送った」ことの証明。チェーンは
  口座の持ち主をパスワードではなく署名の検証で確かめる。署名はチェーンに
  送る**前に**ウォレット（chainviz ではワークベンチ）の中で完結し、秘密鍵は
  外に出ない。chainviz では tx チップのライフサイクル1段目として見える。
  関連: transaction, eoa, workbench
- `block`（ブロック）: tx をまとめてチェーンに追記する単位。各ブロックは
  前のブロックのハッシュ（parentHash）を指しており、この連なりが
  「ブロックチェーン」そのもの。改ざんすると連結が切れるため過去が
  守られる。chainviz ではノードのブロック高と、新ブロック到着時の伝播
  パルスとして見える。関連: transaction, mempool, gossip
- アンカー: `block` はノードポップオーバーの「ブロック高」ラベル
  （現在アンカー無し）にも張る。「チェーンの繋がり方」への今回の回答は
  この用語解説まで（それ以上は 6. 判断3）

## 5. 実装時の注意（全単位共通）

- 新設文言はすべて `{ja, en}` で用意した（初稿）。語調の微調整は実装者の
  裁量でよいが、構成・意味を変える変更は不可。英語は chainviz-i18n の
  レビューを通すこと
- 用語解説は「アンカーの無い用語は存在しないのと同じ」（Issue #124 の
  教訓）。新設ターム（validator / rpc-endpoint / signature / block）には
  必ず上記のアンカーを対応させる
- 単位C の一覧パネルからのパン（setCenter）は、ユーザーのクリックに
  応じてのみ動かす。デプロイ成功時などに**勝手にカメラを動かさない**
  （Miro 的操作感の維持）
- #232（確定時のコントラクトへのパルスがアドレス表記の食い違いで発火
  しない）・#244（デプロイ時イベントの未復号）は本設計と同じ画面に
  関わるが別 Issue。本設計の実装で巻き込み修正しない

## 6. 確認したい判断（統括・ユーザー向け）

1. **トークン量の入力単位（単位B）**: 推奨案は「トークン単位入力＋
   decimals 換算」（ETH 欄と一貫し、0.0000 CVZ 問題が根本解決）。
   代替案は「生値入力のまま単位注記だけ足す」（実装が軽いが混乱は残る）。
   推奨案で進めてよいか
2. **`NodeEntity.nodeRole` の型（単位A）**: 生文字列 + フロント表現セット
   解釈を推奨（OperationEdge.operation と同じパターン）。union 型に
   焼き込むかは designer の判断に委ねる
3. **「チェーンの繋がり方」の可視化範囲（#212）**: 今回は block 用語解説＋
   tx ライフサイクルまでとし、「最新ブロックの帯・ブロックカード」のような
   ブロックチェーン構造そのものの可視化は見送る（データは BlockEntity に
   あるため作れるが、見せ方の検討が別途必要な規模）。必要なら別 Issue と
   して起票したい
4. **「状態の中身」のうちコントラクト内部状態（#212）**: Counter の現在値
   などは view 関数の呼び出し（eth_call）を collector に足す必要があり
   今回のスコープ外とした。学習価値は高い（increment の結果が数字で
   見える）ので、別 Issue として起票したい

## 7. 評価中に見つけた別の問題（起票のみ、本設計では扱わない）

- [#244](https://github.com/morichikawa/chainviz/issues/244)
  デプロイ tx で発生したイベント（mint の Transfer 等）が復号されず
  生チップ表示になる（未復号チップの「カタログに定義が無いため」という
  ホバー文言もこの場合は事実と異なる）
- [#245](https://github.com/morichikawa/chainviz/issues/245)
  カードのホバーポップオーバーが隣接カードの下に描画され読めない
  （z-order。#221 とは別の問題）

### 2026-07-10 Issue #211/#218 実装記録（単位C）着手前の設計メモ

- 担当: frontend
- ブランチ: issue-211-deploy-feedback-ux
- 対象: 単位C（#218 コントラクト一覧パネルの新設 + #211 デプロイ中txの
  「デプロイ」ラベル化・導線）。上記「4. 単位Cの設計」をベースに、実際の
  コンポーネント構成・データ取得元を以下のとおり具体化してから着手する。

**コントラクト一覧パネル（新設）**

- パネル自体は `Canvas.tsx`（`CanvasInner`、`ReactFlowProvider` の内側）に
  置く。App.tsx 側の変更は不要にする。`CanvasInner` は既に `rfNodes`
  （contract カード・ghost カードを含む全ノード）を持っているため、そこから
  `type === CONTRACT_NODE_TYPE` のノードと `type === GHOST_NODE_TYPE &&
  data.kind === "contract"` のノードを filter するだけでパネルの元データが
  揃う（peerEdges を rfEdges から filter して PeerNetworkLegend に渡している
  既存パターンと同じ流儀）
- 新規の純粋関数群 `entities/contractList.ts`:
  - `ContractListEntry`（`nodeId` / `status: "deployed" | "deploying"` /
    `name?` / `address?` / `tokenSymbol?`）
  - `buildContractListEntries(contracts, deployingGhosts)`: 実カード配列と
    ghost 配列を1本の `ContractListEntry[]` に合成する
  - `sortEntriesByAppearance(entries, order)`: 出現順（新しいものが上）に
    並べ替える。order は下記フックが返す `Map<id, seq>`
  - `resolveNodeCenter(position, measured)`: パン先の中心座標を
    `position + measured/2` から求める（`measured` 未確定時のフォールバック
    幅高さも持つ）。setCenter に渡す値の算出をテスト可能にするため Canvas.tsx
    から切り出す
- 出現順トラッキング用に新規フック `entities/useAppearanceOrder.ts`:
  `useAppearanceOrder(ids: string[]): ReadonlyMap<string, number>`。
  `useNewArrivalHighlight` と同じ「id 集合の差分から新規現れた id を検知する」
  骨格を流用するが、ハイライト用のタイマー・ready ゲートは持たず、初めて
  見た id に単調増加のシーケンス番号を振るだけ（並び替えに使うだけで演出は
  伴わないため）。ghost → 実カードの置換時は実カードの address が新しい id
  として扱われ、置換直後に一覧の最上段へ来る（「デプロイが今しがた実体化
  した」という事実と一致するため許容する）
- 新規コンポーネント `entities/ContractListPanel.tsx`: entries が空なら
  null。ヘッダ「{GlossaryTerm contract}{件数}」。行は
  `deployed`→`{name ?? 未知のコントラクト} {shortHex(address)}{· symbol}`、
  `deploying`→ スピナー + 「デプロイ中… {name}」（`ghost.contract.deploying`
  とは別キー `contractList.deploying` を使う。表示先コンポーネントが違う
  ため既存の命名慣習どおり分ける）。行クリックで `onSelect(nodeId)` を呼ぶ
  だけの薄いプレゼンテーション層にする（パン処理自体は持たない）
- Canvas.tsx 側でクリック時のパン+一時ハイライトを実装する:
  `useReactFlow()` の `getNode` / `setCenter` / `getZoom` を使い、
  `resolveNodeCenter` で求めた中心へ `setCenter(cx, cy, { zoom: getZoom(),
  duration: 400 })`（ズーム倍率は変えない）。あわせて `jumpHighlightNodeId`
  という Canvas 内部 state を立て、対象が contract カードのときだけ
  表示直前に `data.isNew = true` を注入する（peer/deploy エッジの hover 注入
  と同じ「表示直前に合成し、rfNodes 自体は書き換えない」パターン）。これは
  既存の新着発光 CSS（`.infra-card--new`）をそのまま再利用するだけで、
  shared 型・ContractNodeData に新規フィールドを増やさない。一定時間後
  `setTimeout` で `jumpHighlightNodeId` を null に戻す（ghost 行クリック時は
  ghost カード自体に既存のスピナー演出があるためハイライト注入はしない）
- 0件（実コントラクトもデプロイ中もない）ならパネル自体を出さない
  （`ContractListPanel` が null を返す時点で満たされる）
- 配置は画面左下、`Controls`（既定 bottom-left、4ボタン）の上。
  `PeerNetworkLegend` の右下配置と対称に、`.contract-list-panel { position:
  absolute; left: 15px; bottom: 150px; }` を追加する（Controls の実測高さ
  ~110px+マージン15pxに収まる余白を確保）

**デプロイ tx の pending 表示（#211）**

- `entities/transaction.ts` の `txChipLabel` に `tx.to === null` の判定を
  追加する（`createdContractAddress` は確定後のみ入るため、pending 中は
  これだけでは「デプロイ」と判定できていなかった）。優先順位は
  「functionName → (createdContractAddress あり or to===null) → デプロイ
  → rawFunctionId → hash」に変える。副次効果として、確定に失敗した
  デプロイ tx（`createdContractAddress` が入らない failed）も「デプロイ」
  ラベルになる（従来は素の tx ハッシュ短縮に落ちていた不整合が解消される）
- 副作用の確認: `entities/txCallPreview.ts`（`deriveTxCallPreview`、
  WalletPopover の「呼び出し内容」プレビュー行が使う）は
  `createdContractAddress` 前提のままにする。pending 中のデプロイ tx は
  作成先アドレスがまだ存在しないため、この行は従来どおり「呼び出し内容
  なし」（プレビュー行自体が出ない）のままにする。設計メモの「WalletPopover
  の tx 一覧も同じ導出を使っているため同時に直る」という記述は実際には
  `WalletPopover.tsx` が `txChipLabel` を呼んでおらず（`TX_STATUS_KEY` の
  ステータスバッジのみ）不正確だったため、ここで訂正する。ステータス
  バッジ自体は元々 pending/included/failed を正しく出しているため実害は
  ない
- `operation.deploy.note` の文言を設計どおり更新する（出現場所を予告）

**トークン残高チップの区別（#218 派生）**

- `entities/walletTokenBalances.ts` に純粋関数
  `formatTokenContractLabel(balance, unknownLabel)` を追加し、
  `"${contractName ?? unknownLabel} (${shortHex(contractAddress)})"` を返す。
  `WalletCard.tsx` の token chip title 属性と `WalletPopover.tsx` の
  トークン残高行の名前表示の両方をこの関数に置き換える（同名トークンが
  複数あるとき短縮アドレスで区別できるようにする）

**変更しないこと**

- `deriveDeployedContracts`（操作パネルの呼び出しタブ用、catalogKey が
  カタログに存在するものだけに絞る）はそのまま。コントラクト一覧パネルは
  「一覧性」が目的のため catalogKey 不明な未知コントラクトも含めるが、
  呼び出し操作の対象候補とは要件が異なるため共通化しない
- shared（`packages/shared`）の型変更は無し

### 2026-07-10 Issue #211/#218 実装記録（単位C）完了報告

- 担当: frontend
- ブランチ: issue-211-deploy-feedback-ux
- 内容: 上記の設計メモどおり実装した。新規ファイル・主な変更点は以下。

**新規ファイル**

- `packages/frontend/src/entities/contractList.ts` /
  `contractList.test.ts`: `buildContractListEntries`（実カード + デプロイ中
  ghost を1本の行データへ合成）、`sortEntriesByAppearance`（出現順ソート）、
  `resolveNodeCenter`（パン先中心座標の算出）
- `packages/frontend/src/entities/useAppearanceOrder.ts` /
  `useAppearanceOrder.test.ts`: id の出現順に単調増加のシーケンス番号を
  振るフック（`useNewArrivalHighlight` と同じ骨格だが演出・ready ゲート
  無し）
- `packages/frontend/src/entities/ContractListPanel.tsx` /
  `ContractListPanel.test.tsx`: コントラクト一覧パネル本体
- `packages/frontend/src/canvas/Canvas.tsx`: `CanvasInner` 内で上記を
  組み合わせ、パネルの配置・行クリックによる `setCenter` パン・一時ハイ
  ライト注入（`ContractNodeData.isNew` を表示直前にだけ true にする、
  hover 注入と同じパターン）を実装。shared・ContractNodeData 自体の型は
  変更していない
- `packages/frontend/src/styles.css`: `.contract-list-panel*` を追加
  （キャンバス左下、React Flow 標準 Controls の上）

**既存ファイルの変更**

- `entities/transaction.ts` の `txChipLabel`: `tx.to === null` を deploy
  判定に追加し、pending 中のデプロイ tx も「デプロイ」ラベルになるように
  した（#211 本体）。副次効果として、確定失敗（failed）でも
  `createdContractAddress` が入らなかったデプロイ tx が「デプロイ」表示に
  なる（従来は tx hash 短縮表示に落ちていた）
- `entities/walletTokenBalances.ts` に `formatTokenContractLabel` を追加し、
  `WalletCard.tsx`（トークンチップの title 属性）・`WalletPopover.tsx`
  （トークン残高行の名前表示）を置き換えた。同名トークンが複数デプロイ
  されていてもアドレスの短縮表記で区別できるようにした（#218 派生）
- `i18n/messages.ts`: `operation.deploy.note` を「キャンバス下段（ウォレット
  の下の段）に現れます」に更新し、`contractList.title` /
  `contractList.deploying` / `contractList.jumpHint` を追加した

**設計メモからの訂正点**

- 設計メモは「WalletPopover の tx 一覧も txChipLabel と同じ導出を使って
  いるため同時に直る」としていたが、実際には `WalletPopover.tsx` は
  `txChipLabel` を呼んでおらず（ステータスバッジは `TX_STATUS_KEY` を
  直接使う別経路）、この記述は不正確だった。ステータスバッジ自体は元々
  pending/included/failed を正しく表示できているため実害はなく、
  `txCallPreview.ts`（呼び出し内容プレビュー行）も意図的に変更していない
  （pending 中のデプロイ tx は作成先アドレスがまだ存在しないため、
  プレビュー行が出ないのはこれまでどおりで正しい挙動）

**動作確認**

- `pnpm build && pnpm test`（ルートから全パッケージ対象）が通ることを
  確認した（frontend 96 ファイル 1456 件含め全て pass）。`npx eslint .`
  も警告無しで通過
- 変更に伴い2件の既存テストを更新した:
  `App.workbenchOperations.test.tsx`（「デプロイ中… Counter」がゴースト
  カードとコントラクト一覧パネルの両方に出るようになり複数マッチに
  なったため `getAllByText` に変更）、`WalletPopover.test.tsx`（トークン
  残高行のテキストにアドレス短縮表記が追加されたぶんの期待値更新、および
  同名2トークンの区別を確認する新規テストを追加）
- Playwright（chromium、モックデータの `pnpm dev`）で実際に操作して確認:
  左下にコントラクト一覧パネルが出る（0件なら非表示）、行クリックで
  該当カードへパン + 一時ハイライトが当たる、ウォレットカードの tx
  チップに「デプロイ」ラベルが出る、トークン残高チップの title に
  アドレス短縮表記が併記される、実際に Deploy タブから Counter を
  デプロイして一覧の最上段に新しい行として現れる（出現順ソートが機能）
  ことを確認した。この環境では Playwright の Chromium 実行に
  `libnspr4`/`libnss3` 等の共有ライブラリが不足していたが、`sudo` 無しで
  `.deb` を展開して `LD_LIBRARY_PATH` に加える回避策が既に
  `scratchpad/pwlibs/` に用意されていたため、それを再利用して起動した
- pending 中のデプロイ tx が実際に「デプロイ」ラベルで表示される瞬間は
  モックのコマンド解決が速すぎて Playwright 上で目視するタイミングを
  掴めなかった（`txChipLabel` のユニットテストで pending/failed 両方の
  `to === null` ケースを直接検証済みのため、これで代替した）

**次の担当が知っておくべきこと**

- collector 側の追加対応は無し（単位Cは frontend のみの設計どおり実装
  できた）。`docs/PLAN.md` の #211・#218 のチェックは付けてよい
- コントラクト一覧パネルの並び順は `useAppearanceOrder` の内部 Map に
  依存し、id ごとの出現シーケンス番号は無期限に保持される（削除しない）。
  実運用でデプロイされるコントラクト数の規模ではメモリ上問題にならない
  想定（`useAppearanceOrder.ts` の docstring 参照）
- 作業中に本 Issue の範囲外の問題は見つからなかった（新規 Issue の起票は
  無し）

### 2026-07-10 Issue #211/#218 テスト強化記録（単位C）

- 担当: tester
- ブランチ: issue-211-deploy-feedback-ux
- 内容: 実装担当が書いた基本テスト（ハッピーパス中心）に対し、異常系・
  境界値・出現順の特殊遷移を中心にテストを追加した。実装コードは変更して
  いない。全 26 件を追加し、frontend の総テスト数は 1456 → 1482 になった。
  `pnpm build && pnpm lint && pnpm test` が通ることを確認済み。

**追加した観点**

- `contractList.test.ts`（+13件）: 複数デプロイ済み・複数デプロイ中の
  入力順保持、両者が複数混在するケースの並び、空 label のゴースト行を
  落とさないこと。`sortEntriesByAppearance` の空入力・同一 order 値での
  安定性（入力順維持）・空 order マップで全件を最古扱いにする防御、
  「今しがた現れたデプロイ中の行が古いデプロイ済みより上に来る」実利用
  シナリオ。`resolveNodeCenter` の部分 measured（width のみ / height のみ）・
  負座標・ゼロサイズ（`0 ?? fallback` で 0 が採用され position のままに
  なる境界）。
- `useAppearanceOrder.test.ts`（+2件）: 同一配列内の重複 id が1つの番号
  しか消費しないこと、ghost → 実カード置換時に実カードへより新しい番号が
  振られ最上段へ来ること（worklog「単位C」の想定挙動）。
- `ContractListPanel.test.tsx`（+5件）: デプロイ済み・デプロイ中の混在
  レンダーと件数バッジ、name が undefined のデプロイ中行・address 欠落の
  デプロイ済み行でも落ちないこと、多件数（12件）で件数バッジと行数が
  一致すること、行クリックが id を渡す責務のみを持つこと（対象ノードが
  React Flow 上に無い場合の防御 `if (!node) return` は Canvas 側の責務で
  あることをコメントで明示）。
- `transaction.test.ts`（+4件）: `txChipLabel` の境界値。`to === null`
  でも関数名が復号済みなら関数名が最優先になること、`to === ""`（空文字は
  null ではない）を deploy 扱いしないこと（hash へフォールバック）、空文字
  `to` + rawFunctionId が raw 呼び出しになること、`to === null` 単独
  （createdContractAddress 未着）でも deploy になること。
- `walletTokenBalances.test.ts`（+3件）: `formatTokenContractLabel` が
  単一トークンでもアドレスを併記すること、短すぎるアドレスは shortHex が
  そのまま返すこと、contractName が空文字（falsy だが undefined ではない）
  のとき ?? が空文字を採用する現仕様。

**確認した挙動（実装のバグではないもの）**

- 行クリック時のパン処理で対象ノードが React Flow 上に存在しない場合、
  Canvas.tsx の `handleJumpToContract` が `if (!node) return` で早期リターン
  するためエラーにならない。この分岐は `useReactFlow` を要する統合レベルの
  ため単体テストは追加しなかった（`ContractListPanel` 側は id を渡す責務
  のみで、そこはテスト済み）。
- `to === null` は現状すべて「デプロイ」扱いになる（コントラクト作成 tx を
  他の to=null ケースと区別する情報が tx に無いため。理論上の別ケースは
  存在しない前提で設計されており、実装の穴ではない）。

**起票した Issue**

- 無し（テスト強化のみで完結。新規のバグ・改善提案は見つからなかった）

### 2026-07-10 Issue #211/#218 レビュー記録（単位C）

- 担当: reviewer
- ブランチ: issue-211-deploy-feedback-ux
- 内容: 単位C（コントラクト一覧パネル・デプロイtxラベル・同名トークン
  区別）の静的レビュー。`pnpm build` / `pnpm lint` / `pnpm test` は
  リポジトリ全体で全て通過（shared 58 / collector 1126 / e2e 77 /
  frontend 1482 件 pass）。実装ロジック・テストの質・境界の遵守
  （frontend のみの変更で shared 型変更なし、チェーン固有語彙の漏れなし。
  `TransactionEntity.to: string | null` の「null = コントラクト作成」は
  shared スキーマに元からある意味論）に問題なし。以下の確認を実施した:
  - 出現順管理: `useAppearanceOrder` は `useNewArrivalHighlight` と別
    モジュールだが、ready ゲート・タイマーを持たない理由が docstring に
    明記されており独自実装の妥当性を確認した
  - `handleJumpToContract`（Canvas.tsx）: 対象ノード不在時は
    `if (!node) return` で早期リターンし安全（tester の報告どおり）
  - `txChipLabel`: functionName 最優先 → deploy 判定
    （createdContractAddress または to === null）の順で既存ロジックと
    正しく共存。両立ケース・`to === ""` 境界もテスト済み
  - `formatTokenContractLabel`: WalletCard/WalletPopover の既存
    data-testid・CSS クラスは変更なしで一貫
  - パネル配置: `.contract-list-panel`（左下 bottom:150px, z-index:6）は
    `.p2p-legend`（右下 bottom:175px, z-index:6）と対称・同スタイルで、
    React Flow 標準 Controls（左下、実測高さ約110px+マージン15px）と
    重ならない。固定値の前提条件は CSS コメントと本 worklog の両方に
    記載済みで運用ルールを満たす
  - エラー握りつぶし: 該当なし（タイマーのアンマウント時 cleanup も有り）
  - `docs/PLAN.md` の #211/#218 チェック・worklog 記録・WORKLOG.md 索引は
    実装と整合
- 指摘（差し戻し。いずれも軽微で docs/コメントのみ、ロジック修正は不要）:
  1. `docs/ARCHITECTURE.md` §6.8（879行目）の `operation.deploy.note` が
     旧文言のままで、更新後の `messages.ts` と食い違う。§6.8 は「初稿」
     表記だが、ARCHITECTURE.md は「実装の正確な記述」を置く場所なので
     この1行を実装に合わせて更新すること（sync-docs 観点）
  2. `messages.ts` のコントラクト一覧パネル用キーのコメントが
     「ARCHITECTURE.md §6.2」を参照しているが、§6.2 はコントラクト行の
     帯構造の節でパネルの記述は無い。設計の実体である
     `docs/worklog/issue-211.md`「単位C」への参照に修正すること
- 記録のみ（修正不要の観察）:
  - コミット cc6587a（パネル新設）が i18n キー追加（7f4610b）より前に
    あり、単体ではビルドが通らない（`t("contractList.title")` が当時の
    MessageKey に存在しない）。ブランチ先端は健全で「1変更1コミット」の
    関心事分離自体は適切だが、bisect 可能性のため今後は依存するキーを
    先行または同一コミットに入れること
  - `useAppearanceOrder` は `setOrder` のアップデータ関数内で
    `nextSeqRef` を増分しており、StrictMode（開発時）の二重呼び出しで
    連番に飛びが生じ得る。相対順序は保たれるため表示上の実害はない

### 2026-07-10 Issue #211/#218 QA検証記録（単位C）

- 担当: qa
- ブランチ: issue-211-deploy-feedback-ux
- 結論: 完了条件を満たしている（合格）。#211（デプロイ後の表現の
  分かりにくさ）・#218（コントラクト一覧の欠如）はいずれも実機で解消を
  確認した。

**検証環境**

- 稼働中の chainviz-ethereum スタック（compose 7コンテナ）+ collector
  （ポート4000）+ vite dev server（ポート5173、`VITE_COLLECTOR_URL=
  ws://127.0.0.1:4000` で実データ接続）を再利用。ブランチ
  issue-211-deploy-feedback-ux のフロントが 5173 から配信されていることを
  確認済み（`/proc/<pid>/cwd` = packages/frontend）。
- WebSocket スナップショットを直接受信して実データを確認: contract 5→
  検証中に増加、wallet 4、うち ChainvizToken が同名2件（0x47d8b3…8634 /
  0x2fba97…d592）、Counter 1件、名前なしコントラクト複数。
- 描画確認は Playwright（chromium headless）で 5173 を実操作。chromium の
  共有ライブラリ（libnspr4 等）不足はセッションの scratchpad/pwlibs に
  展開済みの回避策（LD_LIBRARY_PATH 追加）で解決した。

**確認した項目と結果**

1. コントラクト一覧パネルがキャンバス左下に表示される（#218）: 表示を確認。
   `.contract-list-panel` は左下（x=15, y=685〜850。ビューポート
   1600×1000）に配置。ヘッダ「コントラクト {件数}」+ 各行に名前・短縮
   アドレス・トークンは「· CVZ」を表示。名前なしは「未知のコントラクト」。
2. デプロイの表現（#211）: 実際に workbench の操作パネル →「デプロイ」
   タブから Counter をデプロイして観測。
   - pending 中に「デプロイ」ラベル: クリック後 t≈207ms で
     `.wallet-tx-chip--pending` の1つがテキスト「デプロイ」、ホバー
     「保留中（mempool）」で表示されることを実機で捕捉（従来は確定後に
     しか「デプロイ」にならなかった問題が解消）。
   - デプロイ中のコントラクト一覧行: 送信直後（t=0ms）にパネル最上段へ
     「デプロイ中… Counter」ゴースト行（スピナー付き）が出現し、件数
     バッジも増加。あわせてキャンバス下段に「デプロイ中… Counter」の
     ゴーストカード、workbench に「実行中…」スピナー、操作パルスを確認。
   - 出現場所の予告文言: デプロイフォームの note が「取り込まれると
     コントラクトカードがキャンバス下段（ウォレットの下の段）に現れます」
     に更新済みであることを確認。
3. 行クリックでのパン+一時ハイライト（#211/#218）: 一覧の Counter 行を
   クリックすると React Flow の viewport transform が変化（translate が
   移動、scale=0.6165 は維持=ズーム不変）し、対象の Counter カードに
   `.infra-card--new` の一時ハイライトが当たることを確認。ハイライトは
   5秒（NEW_ARRIVAL_HIGHLIGHT_DURATION_MS）で消える仕様どおり。
4. 他UI要素との重なり（#218）: パネル（左下 y=685〜850）と React Flow
   標準 Controls（左下 y=881〜985）の間に約31pxの余白があり重ならない。
   `.p2p-legend`・ミニマップは右下、上部ツールバー（ノード/ワークベンチ
   追加）は上部で、いずれもパネルと重なったり隠したりしていない。
5. 同名トークンの区別（#218派生）: ウォレットカードのトークン残高チップ
   と WalletPopover のトークン残高行が「ChainvizToken (0x47d8b3…8634)」
   「ChainvizToken (0x2fba97…d592)」のように短縮アドレス併記で区別されて
   いることを確認。一覧パネル・呼び出しタブのドロップダウンでも同名2件が
   短縮アドレスで区別できる。検証中に Counter を追加デプロイした結果、
   同名 Counter 2件（0xc5577d…a37e / 0xb9b73c…73e5）も短縮アドレスで
   区別できることを確認した。

**補足**

- コンソールエラーは初期ロード時に検出なし。
- 検証のため使い捨て環境に Counter を複数回デプロイした（ユーザー許可の
  範囲内。実害なし）。
- 差し戻しなし。frontend 実装は設計どおり動作している。

## 8. 実装記録（単位B: #213 + #219）

- 担当: frontend
- ブランチ: `issue-213-219-operation-panel-clarity`
- 実施内容: 上記「単位B」の設計をベースに、操作パネルの各タブ・関数の
  説明文言追加と、トークン量のトークン単位入力＋decimals換算を実装した。
  トークン量の入力方式は「トークン単位入力＋decimals換算」（設計メモ
  6.判断1の推奨案）で進めることをユーザーから承認済み
- 補足: 本セクションは着手時点で設計判断（下記1〜7）まで書いた状態で
  一度セッションが中断し、`tokenAmount.ts`/`tokenAmount.test.ts` のみが
  実装済みの状態で引き継いだ。他のファイルは本文中の記述に反して
  未着手だったため、このセッションで実装・テスト・ビルド・実機確認まで
  完了させた（下記「変更ファイル」「9. 検証」が実際の実施内容）

### 実装時に具体化した設計判断

1. **decimals換算ロジックの置き場所**: `operations/etherAmount.ts` の
   `parseEtherToWei`（decimals=18固定）を、新設する
   `operations/tokenAmount.ts` の `parseUnits(input, decimals)`（decimals
   可変の一般化版）を呼ぶ薄いラッパーに書き換えた。表示方向の
   `entities/tokenAmount.ts`（`formatUnits`/`formatEther`）と対称な構成
   にしている
2. **カタログの型拡張**（`chain-profiles/ethereum/operationCatalog.ts`）:
   - `OperationArgField.unit?: "token"` — トークン量を表す引数に付与
   - `OperationFunctionForm.description: Localized` — 関数の一言説明
     （必須化。既存テストフィクスチャに `description` を追加する必要が
     あった）
   - `ContractCatalogEntry.token?: { symbol: string; decimals: number }`
     — ERC20系コントラクトの静的トークン情報。`ContractEntity.token` と
     同じ形にして対称にした
3. **decimalsの解決**（`operations/deployedContracts.ts`）:
   `DeployedContractCandidate.token` を、デプロイ済み実体の
   `ContractEntity.token`（実測値）優先・カタログの静的値
   （`entry.token`）へフォールバックして導出する。デプロイタブ
   （`DeployForm`）はまだ実体が無いため、カタログの静的値をそのまま使う
4. **バリデーション・変換の分離**（`operations/operationArgValidation.ts`）:
   既存 `isValidOperationArgValue(type, value)` のシグネチャは変更せず
   （既存呼び出し元・既存テストへの影響を避けるため）、
   `validateOperationArgs` に第3引数 `tokenDecimals?: number` を追加し、
   `field.unit === "token"` のときだけ `parseUnits` で検証する分岐を
   足した。送信直前の値変換は新設の `convertOperationArgsToChainValues`
   （同ファイル）が担い、`unit === "token"` の引数だけ最小単位の10進
   文字列へ変換する（他の引数は従来どおりそのまま渡す。§6.10決定事項2）
5. **UI**: `OperationArgInput` に `tokenInfo?: { symbol; decimals }` prop
   を追加し、`unit === "token"` のときラベルに
   「（{symbol}単位）」を付与、入力値の検証も `parseUnits` ベースに
   切り替えた。`CallForm`/`DeployForm` は選択中コントラクト（または
   カタログ）の `token` を取り出して `OperationArgInput` と
   `validateOperationArgs`/`convertOperationArgsToChainValues` に渡す
6. **タブ・関数の説明文言**: `TransferForm`/`DeployForm`/`CallForm` の
   先頭に `operation.{tab}.description` を表示する（既存 note と同じ
   `operation-form__note` スタイルを流用。専用クラスは新設しない）。
   `CallForm` は選択中関数の直下に `fn.description` を追加表示する
   （同じく `operation-form__note` スタイル。「コントラクト選択の一言
   説明と同じ見た目」という設計意図を、実装上は既存の muted note
   スタイルの再利用として解釈した）
7. 新設した i18n キーは `i18n.test.ts` の
   `describe("operation panel message keys")` の対象リストに追加し、
   ja/en 両方が空でないこと・訳し忘れ（ja===en）が無いことを回帰
   ガードした

### 変更ファイル

- `operations/tokenAmount.ts`（新設）/ `tokenAmount.test.ts`（新設）
- `operations/etherAmount.ts`（`parseUnits` の薄いラッパーへ変更。
  既存テスト・既存の外部からの見え方は変えていない）
- `chain-profiles/ethereum/operationCatalog.ts` /
  `operationCatalog.test.ts`（既存テストに `description`/`token`/`unit`
  絡みのケースを追加）
- `operations/deployedContracts.ts` / `deployedContracts.test.ts`
- `operations/operationArgValidation.ts`（既存テストは変更なし。
  `unit: "token"` を使わない既存フィクスチャは無変更で通る後方互換の
  拡張にした）
- `operations/OperationArgInput.tsx`（既存テストは変更なし。同上）
- `operations/TransferForm.tsx` / `TransferForm.test.tsx`（説明文言の
  表示テストを1件追加）
- `operations/DeployForm.tsx` / `DeployForm.test.tsx`（同上）
- `operations/CallForm.tsx` / `CallForm.test.tsx`（説明文言の表示テストを
  追加。既存 `functions` フィクスチャは `description` が必須化された
  ため追記が必要だった）
- `i18n/messages.ts` / `i18n/i18n.test.ts`
- 新設したトークン単位（#219）関連のテストは、既存ファイルを肥大化
  させないため関心事ごとに専用ファイルへ分けた（1ファイル1責務の
  原則をテストにも適用）:
  - `operations/operationArgValidation.tokenUnit.test.ts`
  - `operations/OperationArgInput.tokenUnit.test.tsx`
  - `operations/DeployForm.tokenUnit.test.tsx`
  - `operations/CallForm.tokenUnit.test.tsx`

### 次の担当者への注意点

- トークン単位入力の対象は現状 ChainvizToken の amount/initialSupply の
  みで、Counter の `incrementBy(amount)` は従来どおり生の整数入力
  （`unit` 未設定）のまま。将来トークンを持つコントラクトを catalog に
  追加する場合は `token` フィールドと該当引数の `unit: "token"` を
  忘れず設定すること
- ラベルのトークン単位サフィックスは symbol ベースの汎用文言
  （「（{symbol}単位）」）にした。設計メモの例示（「（CVZ単位）」）は
  ChainvizToken 固有の例であり、実装は symbol を差し替え可能な形に
  一般化した
- `validateOperationArgs`/`convertOperationArgsToChainValues` は
  `tokenDecimals` が未解決（対象コントラクトの `token` 情報が取れない）
  場合、`unit: "token"` な引数を安全側に倒して常に無効（送信不可）にする。
  単位換算ができない状態で最小単位の生の値をそのまま送ってしまうと
  #219 と同じ混乱を再発させるため

## 9. 検証（単位B: #213 + #219）

- `pnpm build`・`pnpm lint`・`pnpm test`（いずれもリポジトリルートで
  全パッケージ対象）が通ることを確認した
- モックデータで実際に frontend の dev サーバーを起動し（`vite --port
  <空きポート>`。既存の別 worktree の dev サーバーとポートが衝突した
  ため空きポートを都度確認した）、Playwright（システムにインストール
  権限が無かったため、事前に用意されていた `.deb` 展開済みライブラリ
  （`libnspr4.so` 等）を `LD_LIBRARY_PATH` に足して headless chromium を
  起動）で実際の画面を操作して確認した:
  - 送金/デプロイ/呼び出しタブそれぞれの冒頭に説明文言が表示される
  - デプロイタブで ChainvizToken を選ぶと `initialSupply（CVZ単位）` の
    ラベルが出る
  - 呼び出しタブで ChainvizToken の `transfer` を選ぶと、関数の一言説明
    （「自分のトークン残高から to へ amount を送ります」）と
    `amount（CVZ単位）` のラベルが出る
  - 呼び出しタブで `to` に有効なアドレス、`amount` に `1000`（トークン
    単位）を入力すると送信ボタンが有効になる（#219 が実際に再現していた
    「1000 と入れたのに 0.0000 CVZ」の原因だった、最小単位の生入力
    としての誤入力扱いが解消されたことを確認）
- 確認スクリプトは使い捨てで実行後に削除し、起動していた dev サーバーも
  終了させた（作業ディレクトリに残していない）

## 10. テスト強化記録（単位B: #213 + #219）

実装担当が書いた基本テスト（ハッピーパス＋主要な異常系）を土台に、
トークン量の単位換算まわりのエッジケース・境界値・状態遷移のテストを
追加した。実装ロジックは変更していない（テストの追加のみ）。既存の
関心事分割（`*.tokenUnit.test.ts(x)`）と 1 ファイル 1 責務の方針を
踏襲し、既存ファイルへ追記する形にした。追加は 19 ケース
（frontend のテスト総数 1485 → 1504）。

### 追加したテストの観点

- トークン量変換の境界値（`operations/tokenAmount.ts` /
  `entities/tokenAmount.ts`）:
  - `parseUnits`: decimals>18 の高精度トークン（スケール・境界ちょうど・
    境界超過）、小数点の各種形（`1.000000`・`0.000000`・末尾のみの `.`・
    先頭のみの `.5`・明示的な `+` 符号）
  - `formatUnits`: decimals=0 の早期リターン枝での負値の符号保持
    （`-42`）、整数部 0 の小さな負の小数（`-0.5000`）、表示精度で 0 に
    潰れる微小負値の符号（`-0.0000`。現挙動の固定）
- トークン単位引数の変換対象の区別（`operationArgValidation.tokenUnit`）:
  - `convertOperationArgsToChainValues` が複数のトークン単位引数を
    それぞれ独立に換算すること、`values` が `fields` より長い場合に
    余分な値を出力しないこと、変換対象を位置ではなく `unit` で判定する
    こと
  - `validateOperationArgs` が複数トークン引数のうち 1 つでも無効なら
    全体を無効にすること
- 呼び出しフォームの関数切り替え時の挙動（`CallForm.tokenUnit`）:
  - トークン単位の関数（`transfer.amount` = `unit:"token"`）から生の
    整数引数を持つ関数（`incrementBy.amount` = `unit` なし）へ切り替えた
    際、ラベルの単位サフィックス（「（CVZ単位）」）と入力バリデーション
    （小数許容 → 整数のみ）が正しく入れ替わること
  - トークンを持つコントラクトでも `unit` なしの引数は最小単位へ換算
    されず生の整数のまま送信されること
- デプロイ済みコントラクトの token 情報フォールバック
  （`deployedContracts`）:
  - 実測値（`ContractEntity.token`）が壊れている（decimals が非負整数で
    ない）場合、`deriveDeployedContracts` は中身を検証せずそのまま採用し、
    カタログ値へフォールバックしない現挙動を明示的に固定

### 調査したが起票しなかった点

- 「壊れた実測 token 値がカタログ値へフォールバックしない」件は、
  実測値が collector の `decimals()`（uint8）由来で現実には壊れ得ず、
  かつ下流の `parseUnits`/`formatUnits` が不正な decimals を防御的に
  弾いてトークン単位入力を無効化する（クラッシュしない）ため、
  実害が無いと判断して Issue 化は見送った。挙動自体はテストで固定した
- ETH 送金（`TransferForm`、decimals=18 固定）の回帰は、ETH 専用の
  `parseEtherToWei` を直接叩く `etherAmount.test.ts`（18 桁ちょうどの
  精度・整数部との合わせ技を含む）で既に厚くカバーされており、
  `tokenAmount.ts` への一般化後も全て通ることを確認した（追加不要と判断）

### 検証

- `pnpm build`・`pnpm lint`・`pnpm test`（リポジトリルートで全パッケージ
  対象）が通ることを確認した（frontend 1504 / collector 1126 /
  shared 58、いずれも pass）

## 11. レビュー記録（単位B: #213 + #219）

### 2026-07-10 Issue #213/#219 静的レビュー

- 担当: reviewer
- ブランチ: issue-213-219-operation-panel-clarity
- 内容: 単位B（操作パネルの説明文言＋トークン単位入力・decimals換算）の
  実装・テスト強化を静的レビューした。判定は合格
- 確認した点:
  - `tokenAmount.ts` の `parseUnits`（decimals可変）への一般化が
    `etherAmount.ts`（decimals=18固定ラッパー）の既存挙動を変えて
    いないこと。BigIntベースの変換ロジック（小数部のゼロ埋め・桁数超過の
    拒否・符号/指数/カンマ表記の拒否）を読み、正しいことを確認した
  - `convertOperationArgsToChainValues` が送る値の形式（最小単位の
    10進整数文字列）が、collector 側
    `adapters/ethereum/workbench-operations.ts`（引数を無加工で
    cast/forge に渡す）の期待と一致すること。collector 側は無変更
  - `OperationFunctionForm.description` 必須化に対し、カタログ全関数
    （ChainvizToken 4件・Counter 3件）に ja/en の説明が付与されており、
    空でないことを固定するテストもあること
  - ARCHITECTURE.md §6.10 決定事項2（値の型解釈・エンコードは collector
    側）との整合。フロントの変換は「表示・入力単位 → 最小単位」の文字列
    変換のみで、エンコードは従来どおり collector 側のまま。決定事項3
    （ETH単位入力＋フロントでwei変換）のトークンへの自然な拡張になっている
  - エラーの握りつぶしなし。防御的フォールバック
    （`convertOperationArgsToChainValues` の生値通過、`formatUnits` の
    入力そのまま返し）はいずれも理由がコメントで明記され、テストで
    挙動が固定されている
  - `pnpm build` / `pnpm lint` / `pnpm test` 全パッケージ通過
    （frontend 1504 / collector 1126 / shared 58）
  - コミット粒度: 変換ロジック・カタログ拡張・フォールバック・
    バリデーション・各フォーム・i18n・テスト強化・docs が関心事ごとに
    分割されており適切
- 決定事項・注意点（いずれも非ブロッキングの申し送り）:
  - `unit: "token"` の引数で token 情報が解決できない場合、
    `OperationArgInput` は生の整数として妥当と表示する一方、
    `validateOperationArgs` は安全側で常に無効にするため、「エラー表示は
    無いのに送信ボタンが無効」という状態になり得る。現行カタログでは
    ChainvizToken に静的 token が必ずあるため実際には到達しないが、
    将来 token 未設定のカタログエントリに `unit: "token"` を付けると
    顕在化する。テスト（CallForm.tokenUnit「no resolvable token
    metadata」）で挙動自体は固定済み
  - ARCHITECTURE.md §6.5 にはトークン単位入力・関数説明の記述を追記して
    いない。過去の同種の細部（#209 の送信前バリデーション）も §6.5 には
    反映せず worklog に留める運用だったため踏襲した。§6.10 決定事項3の
    トークン一般化として一言追記する価値はある（任意）
  - 本ブランチはコミット e0237fc（UX設計メモ、`issue-211-deploy-feedback-ux`
    の先頭と同一）を含む形で fork されている。両ブランチをマージする際は
    docs コミットの重複に留意（同一SHAなので通常は問題にならない）

## 12. 英語訳レビュー記録（単位B: #213 + #219）

### 2026-07-10 Issue #213/#219 英語訳レビュー

- 担当: i18n
- ブランチ: issue-213-219-operation-panel-clarity
- 対象: `chain-profiles/ethereum/operationCatalog.ts` の
  `OperationFunctionForm.description`（ChainvizToken 4関数・Counter 3関数）
  と `i18n/messages.ts` の操作パネル説明文言・トークン単位関連の新規キー
  （`operation.{transfer,deploy,call}.description` /
  `operation.arg.invalid.token` / `operation.arg.tokenUnitSuffix`）。
  日本語の内容自体はレビュー対象外とし、英訳の質・自然さのみを確認した
- 確認した点（問題なし）:
  - `operation.{transfer,deploy,call}.description` は直訳ではなく自然な
    英語の宣言文になっており、既存メッセージ（`contract.popover.description`
    等）のトーン・語彙（tx / mempool / wallet などの標準語彙）と一貫している
  - `operation.arg.invalid.token` は既存の `operation.arg.invalid.uint` /
    `operation.transfer.amount.invalid` と同じ "Enter a non-negative ... in
    decimal (e.g. ...)." のパターンを踏襲しており一貫性がある
  - `operation.arg.tokenUnitSuffix`（`" (in {symbol})"`）はラベルへの
    後置サフィックスとして自然
  - Counter 3関数（increment/incrementBy/reset）の英訳は日本語と1対1で
    対応し、既存の "Increases the counter by 1." のような文体で統一されて
    いる
- 修正した点（2件、いずれも `operationCatalog.ts` の
  `ChainvizToken.functions[].description.en` のみ）:
  1. **バッククォートによる引数名の強調がUIでは無意味な生文字として
     表示される**: `transfer`/`approve`/`transferFrom`/`mint` の英訳は
     引数名（`to`/`spender`/`from`）をMarkdownのインラインコード記法
     （`` `to` `` 等）で囲んでいたが、`CallForm.tsx`/`DeployForm.tsx` の
     `description` 表示箇所はプレーンテキストの `<p>` にそのまま流し込む
     だけで、Markdownパーサーは存在しない（`dangerouslySetInnerHTML` 等の
     使用箇所なし。grepで確認済み）。そのままではエンドユーザーの画面に
     `` ` `` の文字がそのまま表示されてしまう。加えて日本語側は
     `to`/`spender`/`from` をコード記法なしの地の文で参照しており、
     英語側だけがこの記法を持つのは既存メッセージ群のトーン（他の
     エントリはプレースホルダ `{target}` はあるがインラインコードは
     使わない）とも整合しない。バッククォートを引用符（`'to'` のように
     シングルクォート）へ置き換え、前置詞の "to" と引数名の "to" が
     並ぶ曖昧さは残したまま維持しつつ（"to 'to'" 等）、表示上の破損を
     解消した
  2. **`mint` の英訳が `amount` への言及を欠落していた**: 日本語
     「新しいトークンを **amount** 分発行して to に与えます」に対し、
     旧英訳 "Issues new tokens to `to` (only the deployer can call this)."
     は発行量（`amount`）への言及が抜けており、同じ配列内の
     `transfer`/`approve` の英訳（いずれも `amount` を明示的に参照する
     文体）と一貫していなかった。"Issues amount of new tokens to 'to'
     (only the deployer can call this)." に修正し、`amount` への言及を
     復元した
- `transferFrom` の英訳（"Moves tokens from `from` to `to`, within an
  approved allowance."）は `amount` への直接言及が無いが、日本語側も
  同様に amount へ言及しておらず ERC20 の標準語彙である "allowance" で
  意味を汲んでいるため、こちらは修正不要と判断した
- ロジック変更を伴わない文言修正のみのため、テストコードの変更・
  ユニットテストの追加は不要と判断した（`operationCatalog.test.ts` を
  確認し、ja/en が空でないことを固定しているだけで具体的な文言までは
  検証していないことを確認済み。修正後の文字列も型・空文字チェックの
  対象からは外れない）
- 本セッションはシェル実行環境を持たないため `pnpm build`/`lint`/`test`
  は自分では実行していない。変更は既存の `description: Localized`
  フィールド内の文字列リテラル4件のみで型・ロジックへの影響は無いため
  ビルドを壊すリスクは低いと判断したが、`chainviz-reviewer`/pre-push
  フックでの実行確認は次工程に委ねる

## 13. QA検証記録（単位B: #213 + #219）

### 2026-07-10 Issue #213/#219 実機検証

- 担当: qa
- ブランチ: issue-213-219-operation-panel-clarity
- 判定: 合格（#213・#219の完了条件をいずれも満たしている）
- 検証環境: 稼働中の chainviz-ethereum スタック（7コンテナ、reth1/reth2
  同期済み・ブロック進行中）を再利用。同スタックに接続済みの collector
  （:4000）をそのまま使い、本ブランチの frontend を別ポート（:5180）で
  `VITE_COLLECTOR_URL=ws://localhost:4000` を指定して dev 起動した。
  ブラウザは事前展開済みの共有ライブラリを LD_LIBRARY_PATH に通した
  headless chromium を CDP で駆動し、実際のフォーム操作・デプロイ・
  呼び出しを行った（メインの :5173 dev サーバー・collector は共有資源の
  ため停止・変更していない）。

### 実施内容と結果

1. 実データ接続（接続バッジ「接続済み」）を確認したうえで、操作パネルの
   3タブに説明文言が表示されることを確認した:
   - 送金タブ「あなたのウォレットから別のアドレスへ ETH を送る操作です」
   - デプロイタブ「コントラクト（プログラム）をチェーン上に配置する
     操作です。配置されると誰でも呼び出せるようになります」
   - 呼び出しタブ「デプロイ済みコントラクトの関数を tx として実行し、
     コントラクトの状態を変更する操作です。公開関数はどのウォレットからでも
     呼び出せます」
2. 呼び出しタブで ChainvizToken の transfer/approve/transferFrom/mint を
   それぞれ選択し、関数ごとの一言説明が正しく表示されることを日本語・英語
   両方で確認した。英語表示で:
   - バッククォートが生表示されず、引数名がシングルクォート（'to' /
     'spender' / 'from'）で表示されること
   - mint の英語説明が amount に言及していること
     （"Issues amount of new tokens to 'to' (only the deployer can call
     this)."）
   をいずれも確認した。amount 引数のラベルは「amount（CVZ単位）」/
   「amount (in CVZ)」と単位付きで表示された。
3. #219の実際の再現手順の解消確認: デプロイタブで ChainvizToken を選び
   initialSupply に「1000」（トークン単位のつもり）を入力してデプロイした。
   新規デプロイされた ChainvizToken（0xe3fc…0de1）について、デプロイヤー
   ウォレット（0x2BB7…d4c0）のトークン残高が collector 実測で
   1000000000000000000000（= 1000 × 10^18 最小単位）となり、UI の
   ウォレットカードにも「1000.0000 CVZ」と表示された。旧不具合の
   「1000 と入れたのに 0.0000 CVZ」は解消されている。
   （同ウォレットが過去の手動誤入力で保有する既存2トークンは 0.0000 CVZ
   のまま並ぶが、これは今回の対象外の過去データ。）
4. 呼び出しタブで上記の新トークンを対象に transfer の amount に「100」
   （トークン単位）を入力して実行し、デプロイヤーのトークン残高が
   1000.0000 CVZ → 900.0000 CVZ へ、ちょうど 100 CVZ 分減ったことを
   確認した（100 wei 相当の誤送金にならない）。
5. 回帰確認: Counter の increment()（引数なし。説明「カウンタを 1
   増やします」/ "Increases the counter by 1."）と incrementBy(5)
   （生の整数入力。ラベルは単位サフィックスの付かない「amount」のまま、
   トークン単位換算の対象外）をそれぞれ実行し、いずれも tx が included と
   なりデプロイヤーの nonce が進んだ（トークン単位でない引数の入力・実行が
   引き続き正しく動作する）。
6. 日本語・英語の言語切り替えで、タブ説明・関数説明・単位サフィックスの
   表示がいずれも正しく切り替わることを確認した。

### 補足

- 実データ検証のため、ライブチェーン上に新規 ChainvizToken 1件のデプロイ・
  100 CVZ の transfer・Counter への increment/incrementBy を実行した
  （使い捨て可のスタックへの操作。既存のユーザー許可の範囲内）。
- transfer の受け取り先に指定した既存ウォレットは、新トークンを collector が
  そのウォレットの追跡対象に含めていないため受け取り側残高は未追跡表示に
  なるが、送り元（デプロイヤー）の残高が正確に 100 CVZ 減ったことで
  移動量がトークン単位で扱われていることを確認できている。
## 8. 実装記録(単位D: tx ライフサイクル表示、#212)

### 2026-07-10 実装着手前の設計メモ

- 担当: frontend
- ブランチ: issue-212-tx-lifecycle
- 前提: 上記4節の設計をそのまま実装する。`packages/shared` の型変更は無し。
  `signature` glossary の第2段階アンカーは worklog 記載の `rpc-endpoint`
  （単位A、本ブランチの時点では未実装）ではなく、フォールバックとして
  明記されている `workbench` を使う（`glossary/ethereum/terms/a-infra.yaml`
  に既存）

**ファイル構成（1ファイル1責務を維持するため新規分割）**:

- `packages/frontend/src/entities/txLifecycle.ts`（新規）: 既存 status
  （`pending` | `included` | `failed`）から4段階
  （signed/sent/mempool/included）の状態（`done` / `active` / `failed` /
  `pending`(未到達)）を導出する純粋関数 `deriveTxLifecycle`。実時間の
  タイマーは持たない（`useTxLifecycle.ts` と同じ「エンティティ→表示用
  データ変換はここ、Reactの副作用は別」という既存の分離方針を踏襲）
- `packages/frontend/src/entities/txLifecycle.test.ts`（新規）: 上記の
  pending/included/failed 3パターンの導出結果を検証
- `packages/frontend/src/entities/TxLifecyclePopover.tsx`（新規）: tx
  チップ・tx一覧行の共通ポップオーバー本体。ヘッダ（shortHex(hash) +
  既存ステータスバッジ）+ 4段階リスト（マーク + GlossaryTerm付きラベル +
  一言説明）。`deriveTxLifecycle` の結果を描画するだけで、状態導出ロジック
  は持たない
- `packages/frontend/src/entities/TxLifecyclePopover.test.tsx`（新規）:
  pending/included/failed それぞれで正しい段階の完了/進行中/未到達/失敗
  表示になっているかを検証
- `packages/frontend/src/entities/transaction.ts`: `TX_STATUS_MESSAGE_KEY`
  （tx.status.* への対応表）をここに集約する。現状 `WalletPopover.tsx`
  内にローカル定数として存在するが、`TxLifecyclePopover.tsx` でも同じ
  対応表が要るため共有元をここに一本化し、`WalletPopover.tsx` はここから
  import するよう改める（ロジックの二重管理を避ける）
- `WalletCard.tsx`: tx チップ (`span.wallet-tx-chip`) 自体に GlossaryTerm と
  同型のホバー/フォーカス状態を追加し、ホバー中は `TxLifecyclePopover` を
  子要素として描画する。既存の `title` 属性（hash のみ）はポップオーバーに
  置き換わるため削除する。既存のテスト対象（`data-testid`・`data-status`・
  `is-settling` クラス）はそのまま維持する
- `WalletPopover.tsx`: tx 一覧の `<li>` (`wallet-popover__tx-item`) にも
  同様のホバー状態を追加し、同じ `TxLifecyclePopover` を使う（worklogの
  「WalletCard / WalletPopover の tx チップ共通」の指示どおり、表示内容を
  1つのコンポーネントに共通化する）
- `InfraPopover.tsx`: 「ブロック高」ラベルに `GlossaryTerm termKey="block"`
  を追加する（worklogの「アンカー」指示）
- i18n: `tx.lifecycle.*` を新設（段階ラベル4つ + 一言説明4つ + failed時の
  4段階目の代替説明1つ）。文言は本設計メモの3節の表をそのまま使う
- glossary: `glossary/ethereum/terms/c-transaction.yaml` に `signature` と
  `block` を新設（本設計メモ4節「単位D」の定義文をそのまま使う）
- CSS: `.tx-lifecycle-popover` を新設（`.glossary-popover` と同系の見た目）。
  `.wallet-tx-chip` と `.wallet-popover__tx-item` に `position: relative`
  を追加し、ポップオーバーがチップ/行の直下に出るようにする

**表示しないと決めたこと（観測不能な状態を作らない）**:

- 「今署名中です」というリアルタイム状態は表示しない。段階1・2は
  「chainviz に tx が見えている時点で常に完了済み」という事後の説明として
  常に ✓ 表示にする
- 段階3（mempool）の一言説明が、統括コメントの「バリデーション」段階
  （署名・nonce・残高チェック）の回答を兼ねる。独立した状態としては
  見せない

### 2026-07-10 実装完了

設計メモどおりに実装した。設計メモからの変更点・補足は以下のとおり。

- `docs/ARCHITECTURE.md` §6.11「tx ライフサイクル表示（Issue #212 単位D）」
  を新設し、導出ロジック・UI構成・glossary追加・見送った範囲を記載した
  （設計メモ自体は worklog に残るが、実装済み機能の正式な記述は
  ARCHITECTURE.md 側に置く方針に合わせた）
- 未到達段階（`pending` state）のマークは設計メモで明記されていなかった
  ため「○」（控えめな空丸）を採用した。done=✓ / active=● / failed=✕ と
  区別しつつ、「進行中」と誤読されないよう CSS で opacity を下げている
- `TxChip`（WalletCard 側）・`WalletPopoverTxItem`（WalletPopover 側）は
  それぞれのファイル内のプライベートなサブコンポーネントとして実装した
  （`TxCallPreviewLine` など既存の同ファイル内サブコンポーネントの流儀を
  踏襲。別ファイルに切り出すほどの複雑さは無いと判断）
- 動作確認: `pnpm build` / `pnpm lint` / `pnpm test`（frontend 全体、
  1430件）が通ることを確認した。加えて `pnpm --filter @chainviz/frontend
  dev` でモックデータを起動し、Playwright（headless Chromium）で実際に
  tx チップをホバーして `TxLifecyclePopover` が表示されること、
  pending/included/failed それぞれで4段階の状態（✓/●/○/✕）と各段階の
  一言説明が正しく出ることを目視確認した。ノードカードの「ブロック高」
  ラベルに `glossary-term-block` のアンカーが実際に描画されることも
  確認した
- 本Issueの範囲外として見送ったもの（設計メモ6節と同じ）: ブロック
  チェーン構造そのものの可視化（最新ブロックの帯等）、コントラクト
  内部状態（Counter の現在値等、`eth_call` 対応が必要）。これらは
  ユーザー確認待ちのため新規Issueは起票していない
- 作業中に見つけた範囲外の問題: 無し（既存の #244 / #245 は設計メモ
  7節で起票済みのものを参照したのみで、新規には至っていない）

### 2026-07-10 テスト強化記録（単位D）

実装担当が書いた基本テスト（ハッピーパス中心）に対し、異常系・境界値・
不変条件・UI操作の独立性の観点を追加した。実装コードは変更していない。

追加した観点は以下のとおり。

- `txLifecycle.test.ts`（導出ロジックの不変条件）
  - 全 status（pending/included/failed）で常に4段階を固定順
    `signed → sent → mempool → included` で返すこと
  - Issue #212 の中心的な設計判断「観測不能な状態を誇張しない」の担保:
    `signed`/`sent` はどの status でも決して `active` にならず常に `done`
    であること、`active` は `mempool` 段階にのみ現れること、`failed` は
    `included` 段階にのみ現れること
  - pending は `active` がちょうど1件、included/failed は0件であること
  - 呼び出しごとに新しい配列・オブジェクトを返し、返り値を変更しても
    後続の呼び出しに汚染が漏れないこと
  - `deriveTxLifecycleFromTx` が全 status で `deriveTxLifecycle` と同一の
    出力を返す（tx エンティティの status に委譲している）こと
- `TxLifecyclePopover.test.tsx`（マーク文字とヘッダの整合）
  - 4段階のマーク（✓=done / ●=active / ○=未到達 / ✕=failed）が
    `deriveTxLifecycle` の各状態と一致して描画されること（pending/
    included/failed それぞれ）
  - マーク span が `aria-hidden="true"` で、スクリーンリーダーはテキスト
    ラベル側を読むこと
  - ヘッダのステータスバッジが pending/failed でも正しい文言・
    className（`wallet-tx-chip--<status>`）で出ること（従来は included
    のみ検証）
  - hash 短縮の境界: 短縮閾値未満の hash（例 `0x1`）はそのまま表示され、
    testid は完全 hash を使うので取得できること／短縮後に同じ接頭辞に
    見える2件でも testid が衝突しないこと
- `txLifecyclePopoverHover.test.tsx`（新規。ホバー開閉の独立性）
  - `TxChip`（WalletCard）・`WalletPopoverTxItem`（WalletPopover）の
    ライフサイクルポップオーバーが、ホバー/フォーカス前は描画されず、
    mouseEnter/focus で開き mouseLeave/blur で閉じること
  - 複数チップが並んでも各 tx ごとに独立して開閉し、1件のホバー状態が
    別のチップへ漏れないこと。`DEFAULT_RECENT_TX_LIMIT`（6件）を同時に
    並べても各 tx のポップオーバーが独立していること

回帰検出力の確認: 導出ロジックを意図的に壊す（`signed` を `active` に
する／`TxChip` のホバーガードを外す）と上記テストが実際に失敗すること
を確認してから元に戻した。

テストファイルは関心事ごとに分けた（導出ロジック＝`txLifecycle.test.ts`、
ポップオーバーの描画＝`TxLifecyclePopover.test.tsx`、ホバー開閉の操作＝
新規 `txLifecyclePopoverHover.test.tsx`）。

動作確認: `pnpm build` / `pnpm lint` / `pnpm test`（frontend 全体、
1453件に増加）が通ることを確認した。

作業中に見つけたバグ・改善提案: 無し（実装は設計どおりで、テストで
検出すべき挙動のずれは見つからなかった）。

### 2026-07-10 レビュー記録（単位D、chainviz-reviewer）

ブランチ `issue-212-tx-lifecycle` の全12コミット（横断設計メモ e0237fc を
含む）を静的レビューした。判定は**合格**。

確認した内容:

- `pnpm build` / `pnpm lint` / `pnpm test`（frontend 1453件を含む全パッケージ）
  がリポジトリ全体で通ることを確認した
- 「観測不能な状態を観測したかのように表示しない」という制約の遵守:
  `deriveTxLifecycle` は署名(signed)・送信(sent)を全 status で常に `done`
  とし、`active` は mempool 段階にのみ現れる。将来 status に値が追加された
  場合も default 節で全段階「未到達」へフォールバックし、嘘の完了表示を
  しない（never 型による網羅チェック付き）。テスト
  （`txLifecycle.test.ts` の不変条件群）もこの制約を直接検証しており、
  実装を壊すと落ちることがテスト強化記録で確認済み
- `TxLifecyclePopover.tsx` は既存パターン（`role="tooltip"`、
  `data-testid` の `<種別>-<hash>` 命名、glossary-popover 系の CSS、
  マーク文字の `aria-hidden`）と一貫している。状態導出はコンポーネントに
  持たず `txLifecycle.ts` に分離されている（1ファイル1責務）
- `TxChip` / `WalletPopoverTxItem` のサブコンポーネント化は既存の
  `data-testid` / `data-status` / `is-settling` クラス・残高・nonce・
  トークンチップ表示を維持している。`title` 属性（hash のみ）の削除は
  設計メモ・ARCHITECTURE.md §6.11 に明記された置き換えで、コメントにも
  経緯が残っている
- glossary 新設2語（signature / block）は既存の `{ja, en}` +
  `layer` + `relatedTerms` 形式に沿い、relatedTerms が参照する用語キー
  （transaction / eoa / workbench / mempool / gossip）は全て実在する。
  `GlossaryTerm` のアンカー（signature / workbench / mempool / block）も
  全キー実在を確認した
- `docs/ARCHITECTURE.md` §6.11・`docs/PLAN.md` のチェック・
  `docs/WORKLOG.md` 索引・本 worklog の実装/テスト強化記録は実装と
  整合している
- エラーの握りつぶし・環境状態依存の決め打ち定数は無い（新規コードに
  try/catch・タイマー・閾値定数が無い）
- コミット粒度は「導出ロジック / i18n / glossary / ポップオーバー本体 /
  統合 / アンカー追加 / docs / テスト3種 / worklog」と関心事ごとに
  分かれており適切

非ブロッキングの申し送り（差し戻し不要、QA・統括向けメモ）:

- pending の tx をホバーしたとき、未到達の4段階目（ブロック取り込み）の
  一言説明が「〜確定しました」と過去形のまま表示される（○マークと
  opacity 0.6 で「未到達」は視覚的に区別される）。UX設計メモの表を
  そのまま実装した結果であり設計との齟齬ではないが、実機で誤読が
  懸念されるようなら状態別文言の検討余地がある。QA での見え方確認を
  推奨する
- 新設 i18n 文言・glossary 英語版は chainviz-i18n のレビュー対象
  （設計メモ5節の指示）。未実施であればマージ前後に手配が必要
- 本ブランチは main + e0237fc（issue-211 ブランチと共有する横断設計メモ
  コミット）を基点に積まれている。#211 側と #212 側のどちらの PR を
  先にマージしても git 上は問題ないが、両 PR に同一コミットが表示される
  点は把握しておくこと

### 2026-07-10 英語訳レビュー記録（単位D、chainviz-i18n）

レビュー対象は以下2点。日本語の定義文の内容自体は対象外とし、英訳の質
（自然さ・既存エントリとのトーン/語彙の一貫性）のみを確認した。

- `packages/frontend/src/i18n/messages.ts` の `tx.lifecycle.*`（段階ラベル
  4つ・一言説明4つ・failed時の代替説明1つ）
- `glossary/ethereum/terms/c-transaction.yaml` の新設エントリ `signature`
  （署名）・`block`（ブロック）の `en` フィールド

**総評**: 全体として直訳ではなく自然な英語話者の言い回しになっており、
既存エントリの語調ともよく合っている。具体的には:

- `signature`/`block` とも、冒頭が名詞句フラグメントで始まる既存の
  house style（`nonce`/`eoa`/`wei` 等と同じ）を踏襲している
- `signature` の "the private key never leaves it" や `block` の
  "once it lands"（`mempool` エントリの "A submitted tx lands here" と
  同じ語彙）など、既存語彙との一貫性が意図的に保たれている
- `tx.lifecycle.desc.signed` の "Nothing has touched the chain yet." と
  `signature` glossary 本文の "nothing has touched the chain yet" が
  同一の言い回しで揃えてあり、2箇所にまたがる説明として一貫している
- mempool/gas/nonce 等の技術用語は標準的な訳語のまま使われており、
  独自の意訳は見られない

**指摘・修正した点（1件）**:

- `tx.lifecycle.desc.mempool` の英訳 "The node checks the signature,
  nonce and balance, then queues it for inclusion." で、3項目の列挙
  なのに Oxford comma が抜けていた。同じファイル内の既存エントリ
  （`wei`: "Balances, transfer amounts, and gas costs are all handled…"）
  および同一追加内の `tx.lifecycle.desc.included`（"Included in a block,
  replicated to every node, and final."）はいずれも Oxford comma 付きで
  一貫しているため、内部一貫性の観点から "the signature, nonce, and
  balance" に修正した（意味の変更なし）

**検討したが見送った点**:

- `tx.lifecycle.stage.included` の英訳が "Included in block" で、他の
  3段階ラベル（Signed / Sent / Mempool、いずれも1語）に対して唯一の
  フレーズになっている点は一見不揃いに見えるが、対応する日本語ラベルも
  「ブロック取り込み」（他の3つより長い）で意図的に「mempool」の
  「取り込み待ち」と区別するための表記になっている。日本語側の内容
  決定に対応した訳であり、翻訳の質の問題ではないため修正しなかった
  （英語側だけ既存の `tx.status.included`「Included」に合わせて短縮する
  という案は検討したが、日本語の意図的な書き分けを踏まえると独断で
  変えるべきではないと判断した。気になる場合は chainviz-frontend に
  ラベルの長さについて再検討を提案する）
- `signature` glossary の en 本文が「tx チップの」を明示的に訳出せず
  「the tx lifecycle popover」としている点も、意味は変わらず自然な
  圧縮と判断し修正しなかった

**修正コミット**: `fix(frontend): tx lifecycle英語訳のOxfordコンマを既存エントリに合わせて統一` 相当の1コミットとして
`packages/frontend/src/i18n/messages.ts` のみを変更（Conventional
Commits形式での実際のコミット作成は、このレビューを実行した
chainviz-i18n セッションに shell/git 実行ツールが無いため未実施。
ファイル差分のみ適用済み。統括側でのコミット作成を依頼する）

### 2026-07-10 QA検証記録（単位D、chainviz-qa）

ブランチ `issue-212-tx-lifecycle` を実機で検証した。frontend を
モックモード（`VITE_COLLECTOR_URL` 未設定）で `vite` dev server として
起動し、Chromium（Playwright）で実際にウォレットカードの tx チップに
ホバーして、描画されたポップオーバーの DOM とテキストを言語別に確認した。
failed 状態はモックデータのストリームに存在しないため、dev server が
配信する実モジュール（`TxLifecyclePopover.tsx` 本体・`LanguageProvider`・
`GlossaryProvider`）をブラウザ内で直接 import し、実コンポーネントを
failed の tx で描画して確認した。

**判定: 条件付き。1件の差し戻しあり（chainviz-frontend へ）。**

満たしている完了条件:

- 条件1（4段階表示）: ウォレットカードの tx チップにホバーすると
  署名 → 送信 → mempool → ブロック取り込みの4段縦リストが実際に表示される。
- 条件3（included）: included の tx は全4段が `done`（✓）で表示される。
- 条件4（failed）: failed の tx は署名・送信・mempool が `done`（✓）、
  4段目のみ `failed`（✕）。説明文は専用の
  「実行が失敗として記録されました（ブロックには取り込まれています）」/
  「Recorded as failed (still included in a block).」で、取り込み自体の
  失敗と誤読させない適切な文言になっている。ヘッダバッジも「失敗」/
  「Failed」。
- 条件5（ブロック高の用語解説）: EL ノード（chainviz-reth-node-1）の
  カードポップオーバーで「ブロック高」に付いた `GlossaryTerm`（termKey=
  block）にホバーすると、glossary ポップオーバーが日本語・英語とも開き、
  「ブロック」/「Block」の定義が表示される。ワークベンチノードには
  ブロック高フィールドが無いことも確認（EL コンテナノードでのみ表示）。
- 条件6（言語切り替え）: 上記すべてを language-toggle で ja/en 切り替え、
  段階ラベル・説明文・ステータスバッジ・glossary が両言語で正しく
  切り替わることを確認した。
- 条件7のうち「署名中」誤認の主要懸念: 署名(signed)・送信(sent)は
  pending でも常に `done`（✓）として表示され、「今まさに署名中」という
  進行中(`active`)表現は一切出ない。Issue タイトルの「署名中かどうか」の
  懸念（観測不能なリアルタイム状態を観測したかのように見せない）は
  適切に処理されている。

満たしていない完了条件（差し戻し）:

- 条件2・条件7（pending の未到達段階の説明文）: pending の tx をホバー
  すると、4段目「ブロック取り込み」はマーク ○（未到達）・
  `data-stage-state="pending"` で視覚的には未到達と区別されるが、その
  一言説明が完了を断定する過去形のまま表示される。
  - 実際の表示（ja）: `○ ブロック取り込み :: ブロックに取り込まれ、
    全ノードに複製されて確定しました`
  - 実際の表示（en）: `○ Included in block :: Included in a block,
    replicated to every node, and final.`
  - ○マーク（未到達）と、同じ行の説明文が述べる「取り込まれ…確定
    しました／included…and final」が矛盾しており、未到達の段階なのに
    あたかも取り込み・確定が起きた事実であるかのように読める。これは
    chainviz-reviewer の申し送り（本 worklog レビュー記録の非ブロッキング
    メモ）が指摘した点そのもので、実機の見た目でも誤読を招くと判断した。
  - この説明文は included が `done`（included の tx）でも `pending`
    （pending の tx の未到達）でも同一の
    `tx.lifecycle.desc.included` を使っており、状態で出し分けていない
    （failed のみ `includedFailed` に分岐している）。
  - 期待する挙動: 未到達（pending 状態）の included 段階では、完了を
    断定しない文言（未来形・定義形。例「ブロックに取り込まれると、
    全ノードに複製されて確定します」）を出す。failed 用の
    `includedFailed` と同様に、未到達用の説明キーを分岐で用意するのが
    素直。

再現手順:

1. `packages/frontend` を `VITE_COLLECTOR_URL` 未設定（モックモード）で
   `vite` 起動する。
2. Alice の EOA カード（0xa11ce0…）の pending の tx チップにホバーする。
3. 開いたライフサイクルポップオーバーの4段目「ブロック取り込み」の
   説明文が「…確定しました」と完了断定の過去形で表示されることを確認。

差し戻し先: chainviz-frontend（描画麗）。`packages/frontend/src/entities/
TxLifecyclePopover.tsx` の `stageDescriptionKey` と
`packages/frontend/src/i18n/messages.ts` に、included の未到達
（`state === "pending"`）用の説明文言を追加し出し分ける。単位Dの他の
挙動（条件1・3・4・5・6・署名/送信の done 表示）は問題なし。

備考: 検証は使い捨ての Chromium 実行で行い、frontend 側のコード・
設定は一切変更していない。実データ（稼働中の chainviz-ethereum
スタック）ではなくモックデータで検証したが、failed を含む全 status の
描画は実コンポーネントで確認済み。

### 2026-07-10 QA差し戻し対応（単位D、chainviz-frontend）

QA検証記録の差し戻し（条件2・7: pending の未到達段階の説明文が完了断定の
過去形のまま）に対応した。

修正内容:

- `packages/frontend/src/entities/TxLifecyclePopover.tsx` の
  `stageDescriptionKey` に、`included` 段階が `pending`（未到達）状態の
  場合の分岐を追加した。`failed` 状態の `includedFailed` と同じパターンで、
  `state === "pending"` のときは新設した `tx.lifecycle.desc.includedPending`
  を返すようにした
- `packages/frontend/src/i18n/messages.ts` に
  `tx.lifecycle.desc.includedPending` を新設した。ja は「ブロックに
  取り込まれると、全ノードに複製されて確定します（まだ起きていません）」、
  en は "Once included in a block, it will be replicated to every node and
  become final. This has not happened yet."。完了を断定せず、未来形・
  「まだ起きていない」ことを明示する文言にした
- `TxLifecyclePopover.test.tsx` に、pending の tx で included 段階の
  `data-stage-state` が `pending` であること、説明文が旧来の完了断定文
  （「…確定しました」）を含まないこと、新設の未来形文言を含むことを
  検証するテストを1件追加した

不具合の再現と修正確認:

- 修正前（`TxLifecyclePopover.tsx` の変更のみを一時的に `git stash` で
  戻した状態）で追加テストを実行し、`○ブロック取り込み` の説明文に旧来の
  完了断定文「ブロックに取り込まれ、全ノードに複製されて確定しました」が
  含まれてテストが失敗することを確認した
- `git stash pop` で修正を戻し、テストが通ることを確認した
- `pnpm --filter @chainviz/frontend dev` でモックモードの frontend を
  起動し、Playwright（使い捨て Chromium 実行）で Alice の EOA カードの
  pending tx チップにホバーして、実際のブラウザ描画で4段目の説明文が
  ja「ブロックに取り込まれると、全ノードに複製されて確定します（まだ
  起きていません）」、en "Once included in a block, it will be replicated
  to every node and become final. This has not happened yet." になって
  いることを目視確認した（言語切り替えも実施）。○マーク（未到達）と
  説明文の内容が矛盾しなくなったことを確認した

動作確認: `pnpm build` / `pnpm lint` / `pnpm test`
（frontend 1454件を含む全パッケージ）が通ることを確認した。

作業中に見つけた範囲外の問題: 無し。QA差し戻しの範囲内のみを修正した。

### 2026-07-10 QA差し戻し対応の再レビュー（単位D、chainviz-reviewer）

QA差し戻し（pending tx の4段目「ブロック取り込み」が未到達○マークなのに
完了断定の過去形説明文のままだった件）への修正（コミット 21b7a54）を
レビューした。結果は合格。

確認した内容:

- `TxLifecyclePopover.tsx` の `stageDescriptionKey` の分岐:
  `included` 段階について、現在の `deriveTxLifecycle` が返しうる3状態
  （done / pending / failed）がすべて別々の文言キーに対応した
  （done → `desc.included`、pending → 新設 `desc.includedPending`、
  failed → 既存 `desc.includedFailed`）。既存の `includedFailed` と
  同じパターンで実装されており、分岐漏れなし。分岐の理由もコメントで
  説明されている
- i18n 文言: 新設 `tx.lifecycle.desc.includedPending` は ja が
  「〜すると、〜確定します（まだ起きていません）」と未来形+補足の
  括弧書きで、`includedFailed` の括弧書きスタイル・文末に句点を
  付けない既存スタイルと一貫している。en も既存の複文スタイル
  （`desc.signed` 等）と揃っており、"This has not happened yet." で
  未到達であることが明確
- 追加テストの質: pending tx の included 段階について
  `data-stage-state` が pending であること・旧来の完了断定文を
  含まないこと・新設文言を含むことの3点を検証しており、実装の詳細を
  なぞるだけのテストではない。実際に修正コミット直前の
  `TxLifecyclePopover.tsx` に一時的に戻して該当テストを実行し、
  1件失敗（旧文言が表示される）することを確認したうえで復元し、
  15件全件通過に戻ることを確認した（ミューテーション確認）
- `pnpm build` / `pnpm lint` / `pnpm test`（frontend 1454件を含む
  全パッケージ）がリポジトリ全体で通ることを確認した
- コミット粒度: 修正本体（コード+i18n+回帰テスト = 1つの関心事）と
  worklog 追記が別コミットに分かれており適切

範囲外の観察（差し戻し対象外・非ブロッキング）:

- `txLifecycle.ts` の `deriveTxLifecycle` の default フォールバック
  （将来 status が増えた場合に全段階 pending を返す経路）では、
  signed / sent / mempool の3段階も○マーク+過去形説明文の組み合わせに
  なりうる。ただし `TxStatus` は閉じた union で `never` による網羅性
  チェックがあるため、この経路はフロント側のコンパイルが通る限り
  到達しない（collector が未知の status を送ってきた場合のみ）。
  将来 status を追加する際に、説明文の時制も併せて見直すこと

### 2026-07-10 QA再検証記録（単位D、chainviz-qa）

前回のQA差し戻し（pending の tx で4段目「ブロック取り込み」が未到達○
マークなのに説明文が完了断定の過去形のままだった件）への修正
（コミット 21b7a54）を実機で再検証した。結果は合格。前回の差し戻し理由は
解消されている。

検証方法:

- frontend をモックモード（`VITE_COLLECTOR_URL` 未設定）で `vite` dev
  server として起動し、Chromium（playwright-core + ローカルの chromium
  ビルド）で実際にウォレットカードの tx チップにホバーして、描画された
  ポップオーバーの DOM とテキストを言語別に読み取った。
- failed 状態はモックデータのストリームに存在しないため、dev server が
  配信する実モジュール（`TxLifecyclePopover.tsx` 本体・`LanguageProvider`・
  `GlossaryProvider`）をブラウザ内で直接 import し、実コンポーネントを
  failed の tx で描画して確認した（前回QAと同じ手法）。
- frontend 側のコード・設定は一切変更していない。

差し戻し対象（条件2・7）の再確認結果:

- pending の tx の4段目「ブロック取り込み」は、○マーク（未到達・
  `data-stage-state="pending"`）のまま、説明文が完了を断定しない未来形に
  変わっていることを確認した。
  - ja: 「ブロックに取り込まれると、全ノードに複製されて確定します
    （まだ起きていません）」
  - en: "Once included in a block, it will be replicated to every node and
    become final. This has not happened yet."
  - ○マーク（未到達）と説明文の内容が矛盾しなくなり、前回指摘した
    「未到達なのに取り込み・確定が起きた事実であるかのように読める」
    誤読は解消された。日本語・英語の両方で確認した。

回帰確認（前回合格していた項目の再確認）:

- 条件1（4段階表示）: pending の tx チップにホバーすると
  署名 → 送信 → mempool → ブロック取り込みの4段縦リストが表示される。
- 条件3（included）: included の tx（Bob の tx）は全4段が `done`（✓）で、
  4段目の説明文は完了形「ブロックに取り込まれ、全ノードに複製されて
  確定しました」で正しい。ja/en とも確認。
- 条件4（failed）: failed の tx は署名・送信・mempool が `done`（✓）、
  4段目のみ `failed`（✕）で、専用文言「実行が失敗として記録されました
  （ブロックには取り込まれています）」/ "Recorded as failed (still
  included in a block)." が表示される。ヘッダバッジも「失敗」/「Failed」。
  ja/en とも確認。今回の pending 用分岐追加が failed 用分岐に影響して
  いないことを確認した。
- 条件5（ブロック高の用語解説）: 稼働中の DOM に
  `data-testid="glossary-term-block"` のアンカー（ノードポップオーバーの
  「ブロック高」に張られた block 用語解説）が存在することを確認した。
- 条件6（言語切り替え）: 上記すべてを ja/en で切り替え、段階ラベル・
  説明文・ステータスバッジが両言語で正しく切り替わることを確認した。
- 条件7（署名中の誤認回避）: 署名(signed)・送信(sent)は pending でも常に
  `done`（✓）で、進行中(`active`)表現は mempool 段階のみに出る。観測不能な
  「今まさに署名中」というリアルタイム状態は表示されない。

判定: 合格。前回の差し戻し理由は解消され、Issue #212 本文の要望
（tx が経てきた段階＝署名・送信・mempool・ブロック取り込みの可視化）が
満たされている。単位Dの他の挙動（条件1・3・4・5・6）にも回帰は無い。

備考: 検証は使い捨ての Chromium 実行で行い、frontend 側のコード・設定は
一切変更していない。ユニットテスト（`txLifecycle` / `TxLifecyclePopover` /
`txLifecyclePopoverHover`、計39件）も全通過を確認した。push / PR作成 /
マージ / Issueクローズは統括の判断・実行に委ねる。

## 14. 設計メモ（単位A: #215、designer確定版）

### 2026-07-10 単位Aの設計確定

- 担当: designer
- ブランチ: issue-215-node-role-visibility
- 内容: 上記4節「単位A」のUX設計初稿を精査し、実装可能な形に確定した。
  `NodeEntity.nodeRole` の型定義は本ブランチで実装・テスト済み
  （`pnpm build && pnpm lint && pnpm test` 全パッケージ通過を確認済み。
  shared 62件 / collector 1126件 / frontend 1606件）

### UX初稿からの変更点（要注意）

**ラベルは `com.chainviz.node-role` を新設せず、既存の `com.chainviz.role`
を再利用する。** 精査の結果、collector には既にこのラベルが存在していた
（`packages/collector/src/adapters/ethereum/labels.ts` の `ROLE_LABEL`。
値は `execution` / `consensus` / `workbench`）。addNode / addWorkbench が
作る動的コンテナには `node-lifecycle.ts` の `nodeLabels()` /
`workbenchLabels()` が**既に付与済み**。理由:

- UX初稿どおり `com.chainviz.node-role` を新設すると、addNode で作る
  コンテナに `com.chainviz.role=execution` と
  `com.chainviz.node-role=execution` という**同じ意味のラベルが2つ**並び、
  値がずれると検知しづらい不整合になる（labels.ts が警告しているのと
  同種の問題）
- 再利用なら **collector の lifecycle 側は変更ゼロ**（動的コンテナは既に
  ラベル済み）。既存の稼働中 managed コンテナも nodeRole が自動で入る
- 静的コンテナへの `com.chainviz.role` 追加は managed 回収
  （`recoverManagedContainers`）に干渉しない（回収フィルタは
  `com.chainviz.managed=true` が必須で、compose の静的コンテナには
  付かないため）。値 `validator` は compose の静的 VC のみが持ち、
  addNode は VC を作らないので `toManagedContainer` の role 検証
  （execution/consensus/workbench のみ許容）にも影響しない

### 確定した型・ラベル・データフロー

- **shared（実装済み）**: `NodeEntity.nodeRole?: string`。生文字列
  （Ethereum プロファイルでは `execution` / `consensus` / `validator`）。
  解釈・表示はフロント表現セットの責務。省略 = 不明（ラベル未付与・
  旧スナップショット）。p2pRole とは別軸で統合しない（validator client は
  `nodeRole="validator"` かつ `p2pRole="none"`）。ARCHITECTURE.md §2 の
  スキーマ記述も更新済み
- **ラベル**: `com.chainviz.role`（既存）。静的コンテナ = compose が付与、
  動的コンテナ = collector lifecycle が付与（実装済み・変更不要）
- **データフロー**: compose / lifecycle がラベル付与 → docker 観測
  （`ContainerObservation.labels`）→ Ethereum アダプタ `toEntity` が
  `nodeRole` へ転記 → フロント `chain-profiles/ethereum/nodeRoles.ts` が
  表示（ラベル・用語解説キー・同期状態表示の要否）へ解釈

### 実装引き継ぎ（依存順）

shared は本ブランチでコミット済み。node-env と collector と frontend は
コード上は互いに独立で並行可能（実機での結合確認は全部そろってから）。

**(1) node-env（`profiles/ethereum/docker-compose.yml`）**

- 6つのノードサービスに `com.chainviz.role` ラベルを追加する:
  reth1/reth2 = `"execution"`、beacon1/beacon2 = `"consensus"`、
  validator1/validator2 = `"validator"`。reth1/beacon1 は既存の
  `com.chainviz.p2p-role: "bootnode"` と並記、validator1/2 と reth2/beacon2
  は `labels:` ブロック自体の新設になる
- workbench サービスには付けない（NodeEntity.nodeRole の唯一の消費者は
  ノードカードで、workbench はエンティティ種別自体が別。使われないラベルを
  先回りで足さない）
- 注意: 稼働中のスタックにはラベルが反映されない（Docker のラベルは
  コンテナ作成時に固定）。`docker compose up -d` でラベル差分により
  該当コンテナが再作成されることを README に書く必要はないが、QA には
  再作成が必要である旨を引き継ぐこと

**(2) collector（`packages/collector/src/adapters/ethereum/`）**

- `index.ts` の `toEntity()`: node 分岐の返却オブジェクトに
  `obs.labels[ROLE_LABEL]` が非空文字列なら `nodeRole` として**生値の
  まま**設定する（p2pRole のような値の検証・写像はしない。未知の値は
  フロント表現セットが無視する契約。省略 = 不明の流儀は optional
  フィールドの組み立てで実現する。`removable` と違い常設キーにしない）
- `labels.ts` の `ROLE_LABEL` docstring 更新: 「managed=true のコンテナが
  持つ」→「全ノードコンテナの役割宣言（静的 = compose テンプレート、
  動的 = lifecycle が付与）。値は execution / consensus / validator /
  workbench。NodeEntity.nodeRole の出所（Issue #215）」へ
- `classify.ts`・`node-lifecycle.ts` は**変更不要**（分類ロジックは
  従来どおりイメージ名/プロセス名ベース。role ラベルを分類に使う
  リファクタは今回のスコープ外）
- テストは `index.test.ts`（toEntity 経由の nodeRole 転記: ラベル有り3値・
  ラベル無し省略・空文字列省略）に追加する

**(3) frontend（`packages/frontend/src/`）**

- `chain-profiles/ethereum/nodeRoles.ts` 新設（`syncStageLabels.ts` と
  同じ流儀。テストも同名 `.test.ts`）:
  - `NODE_ROLE_DESCRIPTORS: Readonly<Record<string, NodeRoleDescriptor>>`
    と `describeNodeRole(nodeRole: string | undefined):
    NodeRoleDescriptor | undefined`
  - `NodeRoleDescriptor = { label: Localized; glossaryKey: string;
    showsSyncState: boolean }`
  - `execution` → ラベル「実行クライアント / Execution client」、
    glossaryKey `el-client`、showsSyncState: true
  - `consensus` → 「コンセンサスクライアント / Consensus client」、
    `cl-client`、true
  - `validator` → 「バリデーター / Validator」、`validator`（新設）、
    **false**
  - `showsSyncState` は「このノードはチェーンのコピーを同期する係か」。
    UX初稿の「validator の同期状態表示を消す」判定を、コンポーネントに
    `"validator"` というプロファイル固有リテラルを書かずに実現するための
    フラグ。descriptor が引けない（nodeRole 省略・未知値）ときは true
    扱い（現状表示の維持）
- `entities/InfraNodeCard.tsx`:
  - サブタイトル: node かつ descriptor が引けたら
    「{役割ラベル} · {clientType}」、引けなければ従来どおり clientType のみ
  - 同期状態ドット（`infra-card__status`）: node かつ
    `showsSyncState === false` なら**描画しない**（syncing 色で出し続ける
    現状が「壊れている」誤解を招くため。workbench は従来どおり）
- `entities/InfraPopover.tsx`:
  - 「役割」行を node かつ descriptor が引けたときに常設: ラベルは既存
    i18n キー `field.role`（「役割 / Role」をそのまま再利用）、値に
    `GlossaryTerm termKey={descriptor.glossaryKey}` を張る
  - 既存 bootnode 行のラベルを `field.role` → **新設 `field.p2pRole`**
    （「P2P での役割 / P2P role」）へ変更（役割行との軸の混同を防ぐ。
    UX初稿の指示どおり。`field.role` キー自体は役割行が引き継ぐので
    削除しない）
  - `showsSyncState === false` のとき「同期状態」「ブロック高」の行を
    出さない
  - 「駆動元（合意ノード）」行: 新設 prop `drivenByContainerName` が
    あれば表示。ラベルは新設 `field.drivenBy`、GlossaryTerm は既存
    `engine-api`（「駆動する実行ノード」行と対称）
- `entities/infraNode.ts`: `InfraNodeData.drivenByContainerName?: string`
  を追加し、`entitiesToFlowNodes` で導出（node について「自分を
  `drivesNodeId` に持つ node」の containerName を逆引き。Ethereum では
  beacon→reth の1対1なので最初の一致でよい）。`isSameInfraNode` は
  変更不要（`drivesNodeContainerName` と同じく実質不変の導出値。docstring
  の該当箇所に併記すること）
- 操作先エッジのポップオーバー新設:
  - `entities/operationTargetEdge.ts`: `OperationTargetEdgeData` に
    `workbenchContainerName` / `targetContainerName` / `hovered` を持たせ、
    `operationTargetEdgesToFlowEdges` で端点名を詰める（呼び出し元から
    nodesById 相当を渡す。シグネチャ変更はテストも更新）
  - `entities/OperationTargetEdgePopover.tsx` 新設（`PeerEdgePopover` と
    同型の薄い表示コンポーネント）: タイトル = 新設 `edge.operationTarget`
    （「操作先（RPC 接続先） / RPC target」）、端点表示
    「{workbench} → {target}」、本文 = 新設 `edge.operationTarget.hint`
    （UX初稿4節の i18n 表の文言をそのまま使う。「実際の Ethereum でも
    ウォレットは決まった1つの RPC エンドポイントに接続する」一般論と
    「chainviz は全操作観測のため1本に固定」という chainviz 都合、
    「ブートノード役とは無関係」の3点を必ず含める。Issue #215 コメントの
    切り分けを崩さない）
  - `entities/OperationTargetEdge.tsx`: hovered 時に線を強調し
    `EdgeLabelRenderer` でポップオーバーを出す（`InternalLinkEdge` と
    同じ構成）
  - `canvas/Canvas.tsx`: `hoveredOperationTargetEdgeId` state と
    onEdgeMouseEnter/Leave の分岐、displayEdges での hovered 注入を追加
    （peer/deploy/internal-link と同じパターン）
  - 注意: EdgeLabelRenderer のラッパーは `pointerEvents: "none"` のため、
    エッジポップオーバー内に GlossaryTerm アンカーを置いてもホバーできない。
    `rpc-endpoint` の用語解説アンカーはエッジ側ではなく**ワークベンチの
    ポップオーバーの「操作先ノード」ラベル**（`field.rpcTarget` の行。
    現在は素の `Field`）に張る
- i18n（`i18n/messages.ts`）新設キー: `field.p2pRole` / `field.drivenBy` /
  `edge.operationTarget` / `edge.operationTarget.hint`（文言はUX初稿4節の
  表のとおり。役割ラベル自体は nodeRoles.ts 側に置き messages.ts に
  入れない）
- glossary（`glossary/ethereum/terms/a-infra.yaml`）: `validator` と
  `rpc-endpoint` を新設。定義の内容・relatedTerms（validator: cl-client,
  bootnode / rpc-endpoint: workbench, bootnode）はUX初稿4節のとおり。
  既存の3拍子（定義→なぜ必要か→chainvizではどう見えるか）で書き、
  英語版は chainviz-i18n のレビューを通す

### 実装しないと決めたこと（理由つき）

- `p2pRole` の validator 判定（`isValidatorService`、compose サービス名
  ベース）を role ラベル参照へ置き換えるリファクタ: #214 の確定挙動で
  あり、動くものを本Issueで巻き込まない。nodeRole 導入後に一本化する
  価値はあるが、必要になった時点で別途判断する
- `classify.ts` の分類（イメージ名/プロセス名ベース）への role ラベルの
  利用: 同上。分類とラベルは独立に機能する
- `clientCategory.ts`（フロントの EL/CL 判定）の nodeRole ベースへの
  置き換え: ghost カード・接続予定エッジで使われており、nodeRole が
  無い状況（addNode 直後の ghost はエンティティ未着）でも動く必要が
  ある。今回は触らない
- compose の workbench サービスへの role ラベル付与: 消費者がいない
  （前述）

### 未確定のまま残す点（実装時判断でよい）

- サブタイトルの区切り文字（「 · 」）や役割行の表示順（クライアント行の
  直後を想定）などの見た目の細部
- 操作先エッジのホバー時の強調幅・ポップオーバーの具体的なクラス名
  （既存の peer-popover 系に合わせる想定）

### 2026-07-10 実装記録（単位A、node-env分）

- 担当: node-env
- ブランチ: issue-215-node-role-visibility
- 内容: 上記「14. 設計メモ」の「実装引き継ぎ（依存順）」(1) node-env の
  指示どおり、`profiles/ethereum/docker-compose.yml` の6つの静的ノード
  サービスに Docker ラベル `com.chainviz.role`（既存のラベル。新設では
  ない）を追加した。
  - `reth1`/`reth2` → `"execution"`
  - `beacon1`/`beacon2` → `"consensus"`
  - `validator1`/`validator2` → `"validator"`
  - `workbench` には付けない（消費者が無いため。設計メモどおり）
  - `reth1`/`beacon1` は既存の `labels:` ブロック（`com.chainviz.p2p-role:
    "bootnode"`）に並記し、`reth2`/`beacon2`/`validator1`/`validator2` は
    `labels:` ブロック自体を新設した
- 確認したこと: `packages/collector/src/adapters/ethereum/labels.ts` の
  `ROLE_LABEL`（値は `"com.chainviz.role"`）を確認し、値の書式（生文字列
  `execution`/`consensus`/`workbench`）と重複しないことを確認した上で
  同じキー・同じ値の語彙を使った。`node-lifecycle.ts` が addNode/
  addWorkbench 時に動的コンテナへ既に同じラベルを付与しているため、
  collector側のコード変更は不要（設計メモの結論どおり）。

**動作確認**

- `docker compose config --quiet` で構文エラー無しを確認
- 稼働中の chainviz-ethereum スタックに対し `docker compose up -d` を実行し、
  ラベル差分により6つのノードサービス（reth1/reth2/beacon1/beacon2/
  validator1/validator2）が Recreate されたことを確認した。`docker
  inspect` で各コンテナの `com.chainviz.role` ラベルが設計どおりの値に
  なっていること、`workbench` にはラベルが付与されていないことを確認した
- 再作成後、しばらく `exec_hash: n/a` のまま empty ブロックが続き
  `cast block-number` が 0 のまま進まない状態に遭遇した。原因を調査した
  結果、既存の genesis 自動再生成の仕組み（Issue #148、
  `scripts/generate-genesis.sh` の `should_regenerate`）が、
  `docker compose up -d` で複数の静的ノードコンテナがほぼ同時に
  Recreate される際、旧コンテナが停止する直前に書いたハートビートが
  まだ新しい（60秒以内）と判定され、実際には全ノードが再作成された
  にもかかわらず古い genesis（生成時刻が実時間から大きく離れている）を
  再利用してしまうことによるものだった（各ノードスクリプトは起動の
  たびに自分のデータディレクトリを初期化する仕様のため、"古い genesis +
  空のノードデータ"という整合しない組み合わせになり、スロットが実時間
  どおりに進む一方で実行ペイロードの提案・取り込みが安定しない状態に
  陥っていた）。`docker compose down -v` は同じ Docker network 上に残って
  いた本タスクと無関係な使い捨てコンテナ（`chainviz-ethereum-beacon3`/
  `chainviz-ethereum-reth3`、他セッションの検証残骸と思われる）が
  ボリューム・ネットワークを保持していたため完全には行えなかったが、
  `GENESIS_DOWNTIME_RESET_SEC=0 docker compose up -d`
  （`generate-genesis.sh` が公式にサポートする検証用の環境変数上書き）で
  genesis を強制的に現在時刻で再生成させたところ、ブロックが実測で
  数十秒の間に 0→44 まで安定して進み続けることを確認できた
  （`beacon1` のログでも `exec_hash` が `verified` に変わり、
  `Signed block published` が繰り返し出るようになった）
- `docker compose exec workbench cast chain-id --rpc-url http://reth1:8545`
  で `1337` を取得し、ワークベンチからの RPC 疎通も確認した
- `pnpm build && pnpm lint && pnpm test`（ルートから全パッケージ対象）が
  通ることを確認した（shared 62 / collector 1126 / e2e 77 / frontend 1606
  件 pass。本タスクは TypeScript ロジックの変更を伴わないため既存挙動に
  変化は無い）

**起票した Issue**

- 無し。上記の「genesis 再利用によるスタック不整合」は、複数の静的
  コンテナをほぼ同時に Recreate する操作（本タスクのラベル付与に限らず、
  他の compose 設定変更でも起こり得る）で再現し得る既存の Issue #148 の
  仕組みの境界事例だが、`GENESIS_DOWNTIME_RESET_SEC=0` という正規の回避策
  が既に用意されており、実運用（初回起動・genesisサービスは通常1回しか
  介在しない）では起きにくい限定的な事象と判断し、新規Issueの起票は
  見送った。次にこの現象に遭遇した担当者（特にQA）は、この記録と
  `docs/worklog/issue-148.md` を参照して同じ回避策を使うか、再現性が
  高いと判断した場合は改めてIssue化を検討してほしい

**次の担当が知っておくべきこと**

- collector（`packages/collector/src/adapters/ethereum/index.ts` の
  `toEntity()`、`labels.ts` の docstring 更新）が次の担当。値は生文字列
  のまま転記し、p2pRole のような値の検証・写像はしない方針（設計メモの
  「実装引き継ぎ（依存順）」(2) を参照）
- 稼働中のスタックに対して今回の変更を反映するには再作成
  （`docker compose up -d`）が必要（ラベルはコンテナ作成時に固定される
  ため）。QA検証時も同様の再作成が必要になる
- `docs/PLAN.md` の #215 チェックボックスは、collector・frontend の実装
  まで完了してから更新する（node-env分のみでは単位A全体が未完了のため）

### 2026-07-10 実装記録（単位A、collector分）

- 担当: collector
- ブランチ: issue-215-node-role-visibility
- 内容: 上記「14. 設計メモ」の「実装引き継ぎ（依存順）」(2) collector の
  指示どおり実装した。node-env 分の実装状況（reth1/reth2 =
  `com.chainviz.role: execution`、beacon1/beacon2 = `consensus`、
  validator1/validator2 = `validator`、workbench には付与なし）を先に
  確認し、collector 側は `ROLE_LABEL`（`com.chainviz.role`）を再利用する
  だけで新規のラベル定義・`node-lifecycle.ts`・`classify.ts` の変更は
  不要であることを確認したうえで着手した。

**変更したファイル**

- `packages/collector/src/adapters/ethereum/index.ts`: `toEntity()` の
  node 分岐で `obs.labels[ROLE_LABEL]` を読み、非空文字列であれば
  `NodeEntity.nodeRole` へ生値のまま設定する。値の検証・解釈（execution/
  consensus/validator の意味づけ）はしない（p2pRole のような正規化とは
  異なり、そのまま転記するだけ）。ラベルが無い・空文字列の場合は
  `nodeRole` キー自体を省略する（省略 = 不明。JSON シリアライズ後に
  `nodeRole` プロパティが存在しないことまで含めて仕様どおり）
- `packages/collector/src/adapters/ethereum/labels.ts`: `ROLE_LABEL` の
  docstring を、従来の「managed=true のコンテナが持つ役割」という説明から、
  「全ノードコンテナ（静的・動的）が持つ役割宣言であり、
  `NodeEntity.nodeRole`（Issue #215）の出所でもある」ことが分かる内容に
  更新した
- `packages/collector/src/adapters/ethereum/index.test.ts`: `toEntity`
  経由の `nodeRole` 転記を検証するテストを3種追加した。(1) `execution`/
  `consensus`/`validator` の3値それぞれが生値のまま転記されること
  （`it.each`）、(2) ラベル自体が無いコンテナ（既存の `rethFixture`）で
  `nodeRole` が `undefined` かつプロパティ自体が存在しないこと、(3) ラベル
  値が空文字列のときも同様に省略されること。既存の `p2pRole` 系テストの
  直後（"rejects when the underlying poller fails..." の手前）に配置し、
  同じ `Fixture` 組み立てパターンを踏襲した

**動作確認**

- `pnpm build && pnpm lint && pnpm test`（ルートから全パッケージ対象）が
  通ることを確認した（shared 62 / collector 1142（追加3件を含む）/
  e2e 77 / frontend 1606 件 pass）
- 稼働中の chainviz-ethereum スタック（node-env 分の作業で既にラベル付き
  コンテナへ再作成済み）に対し、`pnpm dev:down` → `pnpm build` 済みの
  dist を使って `pnpm dev:up` で collector・frontend を再起動し（Docker
  スタック自体は既存のものを再利用）、WebSocket スナップショットを直接
  受信して確認した。結果は設計どおり:
  - `reth1`/`reth2` → `nodeRole: "execution"`
  - `beacon1`/`beacon2` → `nodeRole: "consensus"`
  - `validator1`/`validator2` → `nodeRole: "validator"`
  - `workbench` エンティティ（kind: "workbench"）には `nodeRole` プロパティ
    自体が存在しないことも確認した

**起票した Issue**

- 無し。作業中に本 Issue の範囲外の新規問題は見つからなかった

**次の担当が知っておくべきこと**

- 次は frontend（`chain-profiles/ethereum/nodeRoles.ts` 新設、
  `InfraNodeCard.tsx`/`InfraPopover.tsx` のサブタイトル・役割行・
  validator の同期状態非表示、`InfraPopover.tsx` の「駆動元」行、
  `OperationTargetEdge`/`OperationTargetEdgePopover` の新設、glossary の
  `validator`/`rpc-endpoint` 追加）。設計メモの「実装引き継ぎ（依存順）」
  (3) を参照
- `docs/PLAN.md` の #215 チェックボックスは、frontend の実装まで完了して
  から更新する（node-env・collector分のみでは単位A全体が未完了のため）
