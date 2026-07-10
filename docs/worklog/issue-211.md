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
