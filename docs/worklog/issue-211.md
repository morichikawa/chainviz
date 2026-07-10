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
