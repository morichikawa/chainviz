/** 対応言語。当面は日本語・英語の2つ（CONCEPT.md「体験イメージ」）。 */
export type Language = "ja" | "en";

export const LANGUAGES: Language[] = ["ja", "en"];

export const DEFAULT_LANGUAGE: Language = "ja";

/** `{ja, en}` 形式の多言語テキスト。 */
export type Localized = Record<Language, string>;

/** UI 文言。値は `{ja, en}` 形式で持つ。 */
export const messages = {
  "app.title": { ja: "chainviz — インフラ可視化", en: "chainviz — Infrastructure" },
  // Issue #299: 画面は初出のA層(インフラ)のみだったPhase 1の名残で
  // 「(A層)」固定表記だったが、現在のキャンバスはA〜D層すべてを同時に
  // 表示するため「(A層〜D層)」に更新する(docs/worklog/issue-299.md §3.5)。
  "app.subtitle": {
    ja: "Docker 上の Ethereum ノード群（A層〜D層）",
    en: "Ethereum nodes on Docker (Layers A–D)",
  },
  "language.toggle": { ja: "English", en: "日本語" },
  "connection.connecting": { ja: "接続中…", en: "Connecting…" },
  "connection.connected": { ja: "接続済み", en: "Connected" },
  "connection.disconnected": { ja: "切断", en: "Disconnected" },
  "connection.mock": { ja: "モックデータ", en: "Mock data" },
  "card.node": { ja: "ノード", en: "Node" },
  "card.workbench": { ja: "ワークベンチ", en: "Workbench" },
  "card.wallet": { ja: "ウォレット", en: "Wallet" },
  "wallet.eoa": { ja: "EOA", en: "EOA" },
  "wallet.smartAccount": {
    ja: "スマートアカウント",
    en: "Smart account",
  },
  "wallet.ownerDeleted": {
    ja: "所有者は削除済み",
    en: "Owner deleted",
  },
  "wallet.noTx": {
    ja: "トランザクションなし",
    en: "No transactions",
  },
  "field.address": { ja: "アドレス", en: "Address" },
  "field.balance": { ja: "残高", en: "Balance" },
  "field.nonce": { ja: "nonce", en: "Nonce" },
  "field.owner": { ja: "所有者", en: "Owner" },
  "field.recentTx": { ja: "直近の tx", en: "Recent tx" },
  // Issue #320: WalletPopover の tx 一覧見出しに件数を添える。tx が1件以上
  // あるときだけ `field.recentTx` の代わりにこちらを使う（0件時は
  // `wallet.noTx` のみで件数行は出さない）。
  "wallet.recentTxCount": {
    ja: "直近の tx（{count}件）",
    en: "Recent tx ({count})",
  },
  "tx.status.pending": { ja: "保留中（mempool）", en: "Pending (mempool)" },
  "tx.status.included": { ja: "取り込み済み", en: "Included" },
  "tx.status.failed": { ja: "失敗", en: "Failed" },
  "field.ip": { ja: "IP アドレス", en: "IP address" },
  "field.ports": { ja: "ポート", en: "Ports" },
  "field.process": { ja: "プロセス", en: "Process" },
  "field.cpu": { ja: "CPU", en: "CPU" },
  "field.memory": { ja: "メモリ", en: "Memory" },
  "field.client": { ja: "クライアント", en: "Client" },
  "field.role": { ja: "役割", en: "Role" },
  // node の P2P 上の役割（ブートノード等）。上記 field.role（チェーン動作
  // 上の役割。execution/consensus/validator）とは別軸のため文言を分ける
  // （Issue #215）。
  "field.p2pRole": { ja: "P2Pでの役割", en: "P2P role" },
  "field.sync": { ja: "同期状態", en: "Sync status" },
  "field.blockHeight": { ja: "ブロック高", en: "Block height" },
  "sync.synced": { ja: "同期済み", en: "Synced" },
  "sync.syncing": { ja: "同期中", en: "Syncing" },
  // B層拡張: フォーク（一時的な分岐）の色分け（ARCHITECTURE.md §9。Issue #296）。
  "field.headTip": { ja: "見ている tip", en: "Following tip" },
  "ghost.status": { ja: "起動中…", en: "Starting…" },
  "canvas.empty": {
    ja: "表示するコンテナがありません",
    en: "No containers to display",
  },
  "action.addNode": { ja: "ノードを追加", en: "Add node" },
  "action.addWorkbench": { ja: "ワークベンチを追加", en: "Add workbench" },
  "action.workbenchLabelPlaceholder": {
    ja: "ワークベンチ名",
    en: "Workbench label",
  },
  "action.remove": { ja: "削除", en: "Remove" },
  "action.remove.pending": { ja: "削除中…", en: "Removing…" },
  "action.addNode.pending": { ja: "追加中…", en: "Adding…" },
  "action.addWorkbench.pending": { ja: "追加中…", en: "Adding…" },
  "toast.region": { ja: "通知", en: "Notifications" },
  "toast.dismiss": { ja: "閉じる", en: "Dismiss" },
  "command.error.addNode": {
    ja: "ノードの追加に失敗しました",
    en: "Failed to add node",
  },
  "command.error.removeNode": {
    ja: "ノードの削除に失敗しました",
    en: "Failed to remove node",
  },
  "command.error.addWorkbench": {
    ja: "ワークベンチの追加に失敗しました",
    en: "Failed to add workbench",
  },
  "command.error.removeWorkbench": {
    ja: "ワークベンチの削除に失敗しました",
    en: "Failed to remove workbench",
  },
  "command.error.runWorkbenchOperation": {
    ja: "ワークベンチ操作の実行に失敗しました",
    en: "Failed to run workbench operation",
  },
  "command.error.unknown": {
    ja: "コマンドの実行に失敗しました",
    en: "Command failed",
  },
  "command.error.notConnected": {
    ja: "collector に接続されていません",
    en: "Not connected to the collector",
  },
  "command.error.timeout": {
    ja: "応答がありませんでした（タイムアウト）",
    en: "No response (timed out)",
  },
  "role.bootnode": { ja: "ブートノード", en: "Bootnode" },
  "network.execution": { ja: "実行ネットワーク", en: "Execution network" },
  "network.consensus": { ja: "コンセンサスネットワーク", en: "Consensus network" },
  "legend.hint.prefix": { ja: "ピア接続は", en: "Peer connections grow over time via " },
  "legend.hint.term": { ja: "ノード発見", en: "node discovery" },
  // en は語順の都合上 prefix に文を集約しているため、suffix は意図的に
  // 空文字にしている（GlossaryTerm で挟む都合上3分割しているが、英語の
  // 文構造ではprefixで文が完結するため）。
  "legend.hint.suffix": {
    ja: "により時間とともに自動で増えます",
    en: "",
  },
  "peerEdge.hint": {
    ja: "ノード同士がノード発見で見つけ合って自動的につないだ接続です。線が時間差で増えたり、ノードごとに相手が違ったりするのは正常な動きです。",
    en: "A connection the nodes established automatically after finding each other via node discovery. It is normal for cords to appear over time and for each node to have different peers.",
  },
  // --- 追加操作の事前予告（Issue #123） ---
  // `{elBoot}` / `{clBoot}` / `{rpcTarget}` は i18n.ts の format() で実行時に
  // 置換するプレースホルダ（対象カードの containerName が入る）。
  "action.addNode.hint": {
    ja: "フォロワーノード(reth + beacon のペア、カード2枚)を起動します。{elBoot} と {clBoot} を入口(ブートノード)に既存ネットワークへ参加し、同期後は他のノードとも自動で繋がります",
    en: "Starts a follower node (a reth + beacon pair; two cards). It joins the existing network through {elBoot} and {clBoot} as bootnodes, then connects to other peers automatically once synced.",
  },
  "action.addNode.hint.generic": {
    ja: "フォロワーノード(reth + beacon のペア、カード2枚)を起動し、既存ネットワークのブートノードを入口に参加させます",
    en: "Starts a follower node (a reth + beacon pair; two cards) and joins it to the existing network through its bootnodes.",
  },
  // ノード追加ツールチップの2段目（Issue #251）: 1段目（上記2つ）が「何が
  // 起きるか」を説明するのに対し、こちらは「なぜペアなのか」を補う静的な
  // 文言で、ブートノードの解決有無に関わらず常に追加する。文中に
  // GlossaryTerm(el-cl-separation) を埋め込む必要があるため、
  // `internalEdge.pair.prefix/term/suffix` と同じ3分割の手法を使う。
  "action.addNode.hint.pair.prefix": {
    ja: "2枚で1つのノードです。実行(EL)と合意(CL)を別々のクライアントが担うのは The Merge 以降の Ethereum の標準構成(",
    en: "The two cards form one node — running execution (EL) and consensus (CL) as separate clients has been the standard shape of an Ethereum node since The Merge (",
  },
  "action.addNode.hint.pair.term": {
    ja: "EL/CL分離",
    en: "EL/CL separation",
  },
  "action.addNode.hint.pair.suffix": {
    ja: ")です",
    en: ").",
  },
  "action.addWorkbench.hint": {
    ja: "Foundry(cast / forge)入りの操作用マシンを起動します。RPC 呼び出しは {rpcTarget} に送られ、専用のウォレット(鍵)が1つ割り当てられます",
    en: "Starts an operator machine with Foundry (cast / forge). Its RPC calls go to {rpcTarget}, and it gets a dedicated wallet (key).",
  },
  "action.addWorkbench.hint.generic": {
    ja: "Foundry(cast / forge)入りの操作用マシンを起動します。専用のウォレット(鍵)が1つ割り当てられます",
    en: "Starts an operator machine with Foundry (cast / forge). It gets a dedicated wallet (key).",
  },
  "ghost.node.execution": { ja: "新しいノード (reth)", en: "New node (reth)" },
  "ghost.node.consensus": {
    ja: "新しいノード (beacon)",
    en: "New node (beacon)",
  },
  "ghost.willConnect": {
    ja: "{target} と接続予定",
    en: "Will connect to {target}",
  },
  "ghost.rpcTarget": { ja: "操作先: {target}", en: "RPC target: {target}" },
  "edge.connecting": {
    ja: "P2P接続を確立中…",
    en: "Establishing P2P connection…",
  },
  "field.rpcTarget": { ja: "操作先ノード", en: "RPC target" },
  // --- 操作先エッジのホバーポップオーバー（Issue #215。designer 確定版
  // docs/worklog/issue-211.md「14. 設計メモ」） ---
  "edge.operationTarget": { ja: "操作先（RPC 接続先）", en: "RPC target" },
  "edge.operationTarget.hint": {
    ja: "このワークベンチの操作（RPC 呼び出し）が届くノードです。実際の Ethereum でもウォレットは決まった1つの RPC エンドポイントに接続します。chainviz ではさらに、全操作を観測して表示するため接続先をこの1本に固定しています（ブートノード役とは無関係です）",
    en: "The node this workbench's operations (RPC calls) go to. Real Ethereum wallets also connect to one fixed RPC endpoint. chainviz additionally pins the target to observe and display every operation (unrelated to the bootnode role).",
  },
  // --- C層拡張: コントラクトカード（ARCHITECTURE.md §6.3/§6.4/§6.8） ---
  "card.contract": { ja: "コントラクト", en: "Contract" },
  "contract.unknown": { ja: "未知のコントラクト", en: "Unknown contract" },
  "contract.badge.everyNode": { ja: "全ノードで実行", en: "Runs on every node" },
  "contract.badge.uncataloged": { ja: "カタログ外", en: "Not in catalog" },
  "contract.popover.description": {
    ja: "チェーンに複製され、全ノードが同じ実行をするプログラムです。特定のサーバーやノードの中では動いていません",
    en: "A program replicated on the chain; every node runs the same execution. It does not live on any single server or node.",
  },
  "contract.popover.unknownDescription": {
    ja: "chainviz のカタログに載っていないため、関数やイベントの意味（ABI）を復号できません。存在と呼び出しの発生だけを表示します",
    en: "Not in the chainviz catalog, so function and event meanings (ABI) cannot be decoded. Only its existence and incoming calls are shown.",
  },
  "field.deployer": { ja: "デプロイした人", en: "Deployed by" },
  "field.createdByTx": { ja: "作成 tx", en: "Created by tx" },
  "field.token": { ja: "トークン", en: "Token" },
  "field.tokenBalances": { ja: "トークン残高", en: "Token balances" },
  // --- C層拡張: ERC-721(NFT)の所有関係の可視化（Issue #315。
  // docs/worklog/issue-315.md） ---
  "field.nftHoldings": { ja: "保有 NFT", en: "NFTs held" },
  "contract.issuedNft": { ja: "発行済み NFT", en: "Issued NFTs" },
  "contract.noNft": { ja: "まだ発行されていません", en: "None issued yet" },
  "edge.deployedBy": {
    ja: "{address} がデプロイしたコントラクト",
    en: "Contract deployed by {address}",
  },
  // --- C層拡張: コントラクト呼び出し・イベントログの可視化（ARCHITECTURE.md §6.6/§6.8） ---
  "contract.activity": { ja: "直近の呼び出し・イベント", en: "Recent calls & events" },
  "contract.noActivity": { ja: "まだ呼び出しがありません", en: "No calls yet" },
  "contract.chip.undecoded": {
    ja: "カタログに定義が無いため復号できません（生の識別子）",
    en: "Not in the catalog, so it cannot be decoded (raw identifier).",
  },
  "tx.chip.deploy": { ja: "デプロイ", en: "Deploy" },
  // --- C層拡張: tx ライフサイクルのホバーポップオーバー（ARCHITECTURE.md
  // §6.11。Issue #212 単位D） ---
  "tx.lifecycle.stage.signed": { ja: "署名", en: "Signed" },
  "tx.lifecycle.stage.sent": { ja: "送信", en: "Sent" },
  "tx.lifecycle.stage.mempool": { ja: "mempool", en: "Mempool" },
  "tx.lifecycle.stage.included": { ja: "ブロック取り込み", en: "Included in block" },
  "tx.lifecycle.desc.signed": {
    ja: "ワークベンチの中で秘密鍵により署名済み。この時点ではまだチェーンに触れていません",
    en: "Signed with the private key inside the workbench. Nothing has touched the chain yet.",
  },
  "tx.lifecycle.desc.sent": {
    ja: "署名済み tx が操作先ノードへ送られました",
    en: "The signed tx was sent to the RPC target node.",
  },
  "tx.lifecycle.desc.mempool": {
    ja: "ノードが署名・nonce・残高を検査し、取り込み待ちの列に入れます",
    en: "The node checks the signature, nonce, and balance, then queues it for inclusion.",
  },
  "tx.lifecycle.desc.included": {
    ja: "ブロックに取り込まれ、全ノードに複製されて確定しました",
    en: "Included in a block, replicated to every node, and final.",
  },
  "tx.lifecycle.desc.includedPending": {
    ja: "ブロックに取り込まれると、全ノードに複製されて確定します（まだ起きていません）",
    en: "Once included in a block, it will be replicated to every node and become final. This has not happened yet.",
  },
  "tx.lifecycle.desc.includedFailed": {
    ja: "実行が失敗として記録されました（ブロックには取り込まれています）",
    en: "Recorded as failed (still included in a block).",
  },
  // --- C層拡張: 定型操作パネル（送金・デプロイ・コントラクト呼び出し。
  // ARCHITECTURE.md §6.5/§6.8） ---
  "action.workbenchOperations": { ja: "操作を実行…", en: "Run operation…" },
  "action.workbenchOperations.hint": {
    ja: "このワークベンチの中で開発ツール（cast / forge）を実行します。RPC 呼び出しは {rpcTarget} に送られ、通常の操作と同じように観測・表示されます",
    en: "Runs developer tools (cast / forge) inside this workbench. Its RPC calls go to {rpcTarget} and are observed and displayed like any other operation.",
  },
  "action.workbenchOperations.hint.generic": {
    ja: "このワークベンチの中で開発ツール（cast / forge）を実行します。RPC 呼び出しは通常の操作と同じように観測・表示されます",
    en: "Runs developer tools (cast / forge) inside this workbench. Its RPC calls are observed and displayed like any other operation.",
  },
  "operation.tab.transfer": { ja: "送金", en: "Transfer" },
  "operation.tab.deploy": { ja: "デプロイ", en: "Deploy" },
  "operation.tab.call": { ja: "コントラクト呼び出し", en: "Call contract" },
  "operation.close": { ja: "閉じる", en: "Close" },
  // Issue #213: 各タブの冒頭に「何をする操作か」を一言で説明する。
  "operation.transfer.description": {
    ja: "あなたのウォレットから別のアドレスへ ETH を送る操作です",
    en: "Sends ETH from your wallet to another address.",
  },
  "operation.transfer.to": { ja: "宛先", en: "To" },
  "operation.transfer.amount": { ja: "金額（ETH）", en: "Amount (ETH)" },
  "operation.transfer.submit": { ja: "送金する", en: "Send" },
  "operation.transfer.note": {
    ja: "tx は mempool に入り、ブロックに取り込まれると確定します",
    en: "The tx enters the mempool and becomes final once included in a block.",
  },
  "operation.transfer.amount.invalid": {
    ja: "0以上のETH数量を10進数で入力してください（例: 0.5）",
    en: "Enter a non-negative ETH amount in decimal (e.g. 0.5).",
  },
  "operation.deploy.description": {
    ja: "コントラクト（プログラム）をチェーン上に配置する操作です。配置されると誰でも呼び出せるようになります",
    en: "Places a contract (program) on the chain. Once placed, anyone can call it.",
  },
  "operation.deploy.contract": { ja: "コントラクト", en: "Contract" },
  "operation.deploy.submit": { ja: "デプロイする", en: "Deploy" },
  "operation.deploy.note": {
    ja: "ソースからコンパイルしたコントラクトを配置する tx が送られ、取り込まれるとコントラクトカードがキャンバス下段（ウォレットの下の段）に現れます",
    en: "Sends a tx that places the compiled contract on chain; once included, a contract card appears in the bottom row of the canvas (below the wallets).",
  },
  // Issue #213 + #219: 呼び出しタブの冒頭説明。3文目後半（どのウォレット
  // からでも呼び出せる）が #219「ウォレットはスマコンに何ができるのか」の
  // 直接の回答になる。
  "operation.call.description": {
    ja: "デプロイ済みコントラクトの関数を tx として実行し、コントラクトの状態を変更する操作です。公開関数はどのウォレットからでも呼び出せます",
    en: "Runs a function of a deployed contract as a tx, changing the contract's state. Public functions can be called from any wallet.",
  },
  "operation.call.target": { ja: "対象コントラクト", en: "Target contract" },
  "operation.call.function": { ja: "関数", en: "Function" },
  "operation.call.amount": { ja: "送金額（ETH、任意）", en: "Amount (ETH, optional)" },
  "operation.call.submit": { ja: "実行する", en: "Call" },
  "operation.call.empty": {
    ja: "呼び出せるコントラクトがまだありません。先に「デプロイ」タブからデプロイしてください",
    en: "No callable contracts yet. Deploy one from the Deploy tab first.",
  },
  // Issue #209: ABI型（uint/address）と明らかに矛盾する引数入力を送信前に
  // 弾くためのエラー文言。
  "operation.arg.invalid.uint": {
    ja: "0以上の整数を入力してください（例: 1000）",
    en: "Enter a non-negative integer (e.g. 1000).",
  },
  "operation.arg.invalid.address": {
    ja: "0xで始まる40桁の16進数のアドレスを入力してください（例: 0x1234…）",
    en: "Enter an address starting with 0x followed by 40 hex characters.",
  },
  // Issue #219: トークン単位（unit: "token"）の引数用エラー文言・ラベル
  // 添え字。
  "operation.arg.invalid.token": {
    ja: "0以上のトークン量を10進数で入力してください（例: 1.5）",
    en: "Enter a non-negative token amount in decimal (e.g. 1.5).",
  },
  "operation.arg.tokenUnitSuffix": {
    ja: "（{symbol}単位）",
    en: " (in {symbol})",
  },
  "operation.pending": { ja: "実行中…", en: "Running…" },
  "ghost.contract.deploying": { ja: "デプロイ中… {name}", en: "Deploying… {name}" },
  // --- C層拡張: コントラクト一覧パネル（docs/worklog/issue-211.md「単位C」。Issue #218/#211） ---
  "contractList.title": { ja: "コントラクト", en: "Contracts" },
  "contractList.deploying": { ja: "デプロイ中… {name}", en: "Deploying… {name}" },
  "contractList.jumpHint": {
    ja: "クリックでキャンバス上のカードへ移動",
    en: "Click to jump to the card on the canvas",
  },
  // --- C層拡張: mempool パネル（Issue #330。ARCHITECTURE.md §11、
  // docs/worklog/issue-330.md 参照） ---
  "mempoolPanel.title": { ja: "mempool", en: "Mempool" },
  "mempoolPanel.empty": {
    ja: "保留中の tx はありません（滞りなく取り込まれています）",
    en: "No pending transactions — everything is being included promptly.",
  },
  "mempoolPanel.jumpHint": {
    ja: "クリックで送信元ウォレットのカードへ移動",
    en: "Click to jump to the sender wallet's card",
  },
  "mempoolPanel.overflow": { ja: "他 {count} 件", en: "+{count} more" },
  "mempoolPanel.nodesTitle": { ja: "ノード別 txpool", en: "Txpool by node" },
  // --- D層: 内部リンクエッジ・活動パルス（ARCHITECTURE.md §7.6.3/§7.6.4。
  // Issue #188） ---
  "edge.internalLink": { ja: "内部リンク（Engine API）", en: "Internal link (Engine API)" },
  // ARCHITECTURE.md §7.6.8 の初稿は `internalEdge.pair` を1本の完成文として
  // 定義しているが、文中に GlossaryTerm(el-cl-separation) を埋め込む必要が
  // あるため、`legend.hint.prefix/term/suffix` と同じ手法で3分割する
  // （意味・文面は初稿のまま、実装上の都合での分割）。
  "internalEdge.pair.prefix": {
    ja: "この2つのコンテナは、合意（beacon）と実行（reth）を分担する",
    en: "These two containers form ",
  },
  "internalEdge.pair.term": { ja: "1つの Ethereum ノード", en: "one Ethereum node" },
  "internalEdge.pair.suffix": {
    ja: "です。合意した結果を Engine API で実行クライアントへ伝えて駆動します",
    en: ", splitting consensus (beacon) and execution (reth). Each agreed result is pushed to the execution client over the Engine API.",
  },
  "internalEdge.recentCalls": {
    ja: "直近{seconds}秒の呼び出し",
    en: "Calls in the last {seconds}s",
  },
  "internalEdge.noRecentCalls": {
    ja: "最近の呼び出しはありません",
    en: "No recent calls",
  },
  "internalEdge.latency": { ja: "平均 {ms} ms", en: "avg {ms} ms" },
  "field.drivesNode": { ja: "駆動する実行ノード", en: "Drives execution node" },
  // 上記の逆方向。EL 側（reth）ポップオーバーに出す「どの合意ノードに
  // 駆動されているか」欄（Issue #215。ARCHITECTURE.md §7.6.3更新版）。
  "field.drivenBy": {
    ja: "駆動元（合意ノード）",
    en: "Driven by (consensus node)",
  },
  // --- D層: validator→beacon の内部リンク（ARCHITECTURE.md §7.6.11。
  // Issue #285） ---
  "edge.internalLinkValidator": {
    ja: "内部リンク（Beacon API）",
    en: "Internal link (Beacon API)",
  },
  // 端点の nodeRole の組がマッピングに無い（役割不明の旧スナップショット等）
  // 場合のフォールバック見出し。GlossaryTerm のアンカーは付けない。
  "edge.internalLinkGeneric": { ja: "内部リンク", en: "Internal link" },
  "internalEdge.validatorPair": {
    ja: "このバリデーターは、この beacon ノードに Beacon API で接続し、担当スロットでのブロック提案・証明を行います。チェーンを前に進める起点です",
    en: "This validator connects to this beacon node over the Beacon API to propose blocks and attest in its assigned slots — the starting point that moves the chain forward.",
  },
  // フォールバック用の汎用説明文（役割不明の組向け）。
  "internalEdge.genericPair": {
    ja: "この2つのコンテナは内部リンクで接続されています。",
    en: "These two containers are connected by an internal link.",
  },
  "field.connectsToBeacon": {
    ja: "接続先の beacon ノード",
    en: "Connected beacon node",
  },
  "field.validatorClient": {
    ja: "接続元のバリデーター",
    en: "Connected validator",
  },
  // --- D層: 同期ステージ・txpool内訳（ARCHITECTURE.md §7.6.5/§7.6.6。
  // Issue #189） ---
  "field.syncStages": { ja: "同期ステージ", en: "Sync stages" },
  "field.txpool": { ja: "txpool", en: "Txpool" },
  "txpool.value": {
    ja: "pending {pending} · queued {queued}",
    en: "pending {pending} · queued {queued}",
  },
  "sync.progress": {
    ja: "同期中: {stage} {checkpoint}/{target}",
    en: "Syncing: {stage} {checkpoint}/{target}",
  },
  "sync.progressNoTarget": {
    ja: "同期中: {stage} {checkpoint}",
    en: "Syncing: {stage} {checkpoint}",
  },
  // --- チェーンリボン（ブロックの連なり表示。ARCHITECTURE.md §10。
  // Issue #298） ---
  "chainRibbon.title": { ja: "チェーン", en: "Chain" },
  "chainRibbon.subtitle": {
    ja: "新しいブロックが右端に積まれていきます",
    en: "New blocks stack up on the right",
  },
  "chainRibbon.latest": { ja: "#{number}", en: "#{number}" },
  "chainRibbon.older.tooltip": {
    ja: "これより前のブロックは表示していません",
    en: "Older blocks are not shown",
  },
  "chainRibbon.empty": {
    ja: "ブロックの到着を待っています…",
    en: "Waiting for the first block…",
  },
  "chainRibbon.txBadge": { ja: "{count} tx", en: "{count} tx" },
  "chainRibbon.popover.number": { ja: "ブロック番号", en: "Block number" },
  "chainRibbon.popover.hash": { ja: "ハッシュ", en: "Hash" },
  "chainRibbon.popover.parent": { ja: "親ブロック", en: "Parent block" },
  "chainRibbon.popover.time": { ja: "時刻", en: "Time" },
  "chainRibbon.popover.includedTx": { ja: "取り込まれた tx", en: "Included txs" },
  "chainRibbon.popover.includedTxEmpty": { ja: "0（空ブロック）", en: "0 (empty block)" },
  "chainRibbon.popover.receivedBy": { ja: "受信したノード", en: "Received by" },
  "chainRibbon.popover.receivedByEmpty": {
    ja: "受信時刻をまだ観測していません",
    en: "No receipt times observed yet",
  },
  "chainRibbon.popover.receivedByOffset": { ja: "+{ms}ms", en: "+{ms}ms" },
  // --- ブロック生成タイミングのインジケータ（チェーンリボンカードのヘッダ。
  // ARCHITECTURE.md §10.5。Issue #343） ---
  "ribbon.nextBlockCountdown": {
    ja: "次のブロックまで {seconds} 秒",
    en: "Next block in {seconds}s",
  },
  "ribbon.blockProductionStalled": {
    ja: "ブロック生成が停滞しています",
    en: "Block production stalled",
  },
  // --- レイヤーレンズ（A〜D層のチップバー。Issue #299。
  // docs/worklog/issue-299.md §3.7 の初稿をそのまま採用） ---
  "layerFilter.label": { ja: "レイヤー", en: "Layers" },
  "layerFilter.all": { ja: "すべて", en: "All" },
  "layerFilter.a": { ja: "A層 インフラ", en: "A: Infrastructure" },
  "layerFilter.b": { ja: "B層 P2Pネットワーク", en: "B: P2P Network" },
  "layerFilter.c": { ja: "C層 トランザクション", en: "C: Transactions" },
  "layerFilter.d": { ja: "D層 ノード内部", en: "D: Node Internals" },
  "layerFilter.hint.all": {
    ja: "全レイヤーを同時に表示します（既定）",
    en: "Show all layers at once (default)",
  },
  "layerFilter.hint.a": {
    ja: "コンテナとプロセス。選ぶとマシン（ノード・ワークベンチ）のカードだけが通常表示になり、他は薄くなります",
    en: "Containers and processes. Selecting keeps machine cards highlighted and dims the rest",
  },
  "layerFilter.hint.b": {
    ja: "ノード間のP2P通信。選ぶとピア接続とブロック伝播だけが通常表示になり、他は薄くなります",
    en: "Peer-to-peer communication. Selecting keeps peer connections and block propagation highlighted",
  },
  "layerFilter.hint.c": {
    ja: "チェーン上の出来事。選ぶとウォレット・コントラクト・操作の流れだけが通常表示になり、他は薄くなります",
    en: "On-chain activity. Selecting keeps wallets, contracts and operations highlighted",
  },
  "layerFilter.hint.d": {
    ja: "ノード内部の配管。選ぶと合意（CL）と実行（EL）の内部リンクだけが通常表示になり、他は薄くなります",
    en: "Node internals. Selecting keeps CL–EL internal links highlighted",
  },
  // ポップオーバー見出しに添える短い層バッジ（Issue #299 UX設計 §6-3）。
  // チップバーの `layerFilter.a` 等より短く、見出しに収まる表記にする。
  "layerBadge.a": { ja: "A層", en: "Layer A" },
  "layerBadge.b": { ja: "B層", en: "Layer B" },
  "layerBadge.c": { ja: "C層", en: "Layer C" },
  "layerBadge.d": { ja: "D層", en: "Layer D" },
  // --- 汎用サイドパネル機構（Issue #321。docs/ARCHITECTURE.md §12.2） ---
  "sidePanel.close": { ja: "閉じる", en: "Close" },
  // Issue #362: リサイズハンドルの aria-label（role="separator"）。
  "sidePanel.resizeHandle": { ja: "パネルの幅を変更", en: "Resize panel width" },
  // Issue #377: 本文の文字サイズ変更ステッパー（A− / 現在値 / A+）。
  "sidePanel.fontSmaller": { ja: "文字を小さく", en: "Decrease text size" },
  "sidePanel.fontLarger": { ja: "文字を大きく", en: "Increase text size" },
  "sidePanel.fontReset": {
    ja: "文字の大きさを既定に戻す（現在 {value}）",
    en: "Reset text size (current {value})",
  },
  // --- コントラクトソースビュー（kind: "contractSource"。Issue #321。
  // docs/ARCHITECTURE.md §12.3） ---
  "contract.viewSource": { ja: "ソースコードを見る", en: "View source code" },
  "contractSource.title": { ja: "ソースコード", en: "Source code" },
  "contractSource.unavailable": {
    ja: "このコントラクトのソースコードは chainviz の手元にありません。チェーン上にあるのはコンパイル済みのバイトコードだけで、そこから元のソースコード（関数やイベントの意味 = ABI を含む）は復元できません。カタログに載っているコントラクトだけソースを表示できます",
    en: "chainviz does not have this contract's source code on hand. What lives on the chain is only compiled bytecode, from which the original source (including the meaning of functions and events, i.e. the ABI) cannot be recovered. Source is only available for contracts listed in the catalog.",
  },
  // --- 用語集パネル（kind: "glossary"。Issue #313。docs/worklog/issue-313.md §3.9） ---
  "glossary.open": { ja: "用語集", en: "Glossary" },
  "glossary.open.hint": {
    ja: "画面に登場する用語の一覧・検索を開きます",
    en: "Browse and search all terms used on screen",
  },
  "glossary.panel.title": { ja: "用語集", en: "Glossary" },
  "glossary.panel.searchPlaceholder": { ja: "用語を検索", en: "Search terms" },
  "glossary.panel.searchEmpty": {
    ja: "一致する用語がありません",
    en: "No matching terms",
  },
  "glossary.panel.relatedTerms": { ja: "関連用語", en: "Related terms" },
  "glossary.panel.layerLens.hint": {
    ja: "この層だけをキャンバスで見る（レイヤーレンズ）",
    en: "Focus the canvas on this layer (layer lens)",
  },
  "glossary.panel.otherLayer": { ja: "その他", en: "Other" },
  "glossary.popover.openPanel": {
    ja: "クリックで用語集を開く",
    en: "Click to open the glossary",
  },
  // --- 通信ログパネル（kind: "commsLog"。Issue #317。
  // docs/worklog/issue-317.md 設計メモ） ---
  "action.commsLog": { ja: "通信ログ", en: "Communication log" },
  "commsLog.title": { ja: "通信ログ", en: "Communication log" },
  "commsLog.description": {
    ja: "キャンバスに一瞬だけ現れる出来事を時系列に記録しています。新しいものが上です",
    en: "Events that flash by on the canvas for a moment are recorded here in chronological order, newest at the top",
  },
  "commsLog.empty": {
    ja: "まだ記録がありません。ブロックの生成やワークベンチの操作が起きるとここに流れます",
    en: "No entries yet. They will appear here as blocks are produced and workbenches are operated",
  },
  "commsLog.p2pNote": {
    ja: "P2P のブロック伝播は各ノードの受信として記録されます（ノード間の送信経路そのものは観測していません）",
    en: "P2P block propagation is recorded as each node's reception; the send path between nodes is not observed",
  },
  "commsLog.filter.categoryLabel": { ja: "カテゴリ", en: "Category" },
  "commsLog.filter.nodeLabel": { ja: "ノード", en: "Node" },
  "commsLog.filter.nodeAll": { ja: "すべて", en: "All" },
  "commsLog.category.operation": { ja: "操作", en: "Operation" },
  "commsLog.category.internal": { ja: "内部API", en: "Internal API" },
  "commsLog.category.block": { ja: "ブロック", en: "Block" },
  "commsLog.category.tx": { ja: "tx", en: "Tx" },
  "commsLog.category.peer": { ja: "P2P接続", en: "P2P link" },
  "commsLog.category.environment": { ja: "環境", en: "Environment" },
  "commsLog.internal.call": { ja: "{method} ×{count}", en: "{method} ×{count}" },
  "commsLog.internal.latency": { ja: " · {ms}ms", en: " · {ms}ms" },
  // 操作（RPC）エントリのレスポンス観測（Issue #352）。所要時間の表記は
  // commsLog.internal.latency と揃える（" · {ms}ms"）。
  "commsLog.operation.duration": { ja: " · {ms}ms", en: " · {ms}ms" },
  // 成否アイコン（✓/✕）に付けるスクリーンリーダー向けの言語化テキスト
  // （aria-label）。アイコン自体はUI文言ではないため i18n では扱わない。
  "commsLog.operation.outcomeOk": { ja: "成功", en: "Succeeded" },
  "commsLog.operation.outcomeError": { ja: "失敗", en: "Failed" },
  "commsLog.operation.outcomeOkDuration": {
    ja: "成功（{ms}ms）",
    en: "Succeeded ({ms}ms)",
  },
  "commsLog.operation.outcomeErrorDuration": {
    ja: "失敗（{ms}ms）",
    en: "Failed ({ms}ms)",
  },
  "commsLog.block.received": { ja: "ブロック #{number} を受信", en: "Received block #{number}" },
  "commsLog.block.receivedFirst": {
    ja: "ブロック #{number} を最初に受信",
    en: "First to receive block #{number}",
  },
  "commsLog.block.offset": { ja: "（+{seconds}s）", en: " (+{seconds}s)" },
  "commsLog.tx.pending": { ja: "mempool に投入", en: "Submitted to mempool" },
  "commsLog.tx.included": { ja: "ブロック #{number} に取り込み", en: "Included in block #{number}" },
  "commsLog.tx.includedUnknownBlock": { ja: "取り込み済み", en: "Included" },
  "commsLog.tx.failed": { ja: "ブロック #{number} で失敗", en: "Failed in block #{number}" },
  "commsLog.tx.failedUnknownBlock": { ja: "失敗", en: "Failed" },
  "commsLog.peer.connected": { ja: "ピア接続が確立", en: "Peer link established" },
  "commsLog.peer.disconnected": { ja: "ピア接続が切断", en: "Peer link disconnected" },
  "commsLog.environment.nodeAdded": { ja: "ノードが追加された", en: "Node added" },
  "commsLog.environment.nodeRemoved": { ja: "ノードが削除された", en: "Node removed" },
  "commsLog.environment.workbenchAdded": { ja: "ワークベンチが追加された", en: "Workbench added" },
  "commsLog.environment.workbenchRemoved": {
    ja: "ワークベンチが削除された",
    en: "Workbench removed",
  },
  "commsLog.environment.contractDeployed": {
    ja: "コントラクトがデプロイされた",
    en: "Contract deployed",
  },
  "commsLog.environment.contractRemoved": { ja: "コントラクトが削除された", en: "Contract removed" },
  // collector 接続イベントは subject 行に「commsLog.environment.
  // collectorSubject」（"collector"）を出すため、こちらの文言側では
  // 主語を繰り返さない（「collectorとの接続が切れた」の二重表記を避ける）。
  "commsLog.environment.collectorDisconnected": { ja: "接続が切れた", en: "Lost connection" },
  "commsLog.environment.collectorReconnected": { ja: "再接続した", en: "Reconnected" },
  "commsLog.environment.collectorSubject": { ja: "collector", en: "Collector" },
  // --- 「ハッシュのしくみ」デモ（kind: "hashChainDemo"。Issue #401。
  // docs/worklog/issue-401.md UX設計 §5。英語版は初稿で、
  // chainviz-i18n のレビュー対象） ---
  "hashDemo.open": { ja: "ハッシュのしくみを試す", en: "Try how hashes work" },
  "hashDemo.title": { ja: "ハッシュのしくみ", en: "How hashes chain blocks" },
  "hashDemo.intro": {
    ja: "ここは学習用の砂場です。実際のチェーンには影響しません。下の3つのブロックは、キャンバスの「チェーン」カードと同じ仕組みでつながっています。どれかのブロックの「データ」を書き換えてみてください。",
    en: "This is a learning sandbox. It does not affect the real chain. The three blocks below are linked with the same mechanism as the \"Chain\" card on the canvas. Try editing the \"data\" of any block.",
  },
  "hashDemo.storedLabel": { ja: "ブロックに格納されている情報", en: "Information stored in the block" },
  "hashDemo.field.number": { ja: "ブロック番号", en: "Block number" },
  "hashDemo.field.parentHash": { ja: "親ブロックのハッシュ", en: "Parent block's hash" },
  "hashDemo.field.data": { ja: "データ", en: "Data" },
  "hashDemo.compute": { ja: "keccak256 でハッシュ化", en: "Hashed with keccak256" },
  // Issue #406: f(x) の x に何が入るかを明示する行。「x = 」自体は数式記号
  // として JSX 側でハードコードするため、ここには本文（項目名の連結）だけを
  // 持たせる。項目名はすぐ上の hashDemo.field.* の文言と完全一致させる。
  "hashDemo.computeInput": {
    ja: "ブロック番号 | 親ブロックのハッシュ | データ（上の3項目をこの順につなげた文字列です）",
    en: "block number | parent block's hash | data (the three fields above, joined in this order)",
  },
  "hashDemo.blockHash": { ja: "このブロックのハッシュ", en: "This block's hash" },
  "hashDemo.badge.valid": { ja: "有効", en: "Valid" },
  "hashDemo.badge.invalid": {
    ja: "無効: 親ブロックのハッシュと食い違っています",
    en: "Invalid: does not match the recorded parent hash",
  },
  "hashDemo.relink": { ja: "親ハッシュをつなぎ直す", en: "Re-link parent hash" },
  "hashDemo.reset": { ja: "最初に戻す", en: "Reset" },
  "hashDemo.genesisNote": { ja: "（この砂場の起点。親はいません）", en: "(The start of this sandbox. It has no parent.)" },
  "hashDemo.repairedSummary": {
    ja: "全部つなぎ直せてしまいました。1台のマシンの中では、後続のブロックをすべて作り直せば改ざんの辻褄を合わせられます。しかし実際のネットワークでは、同じチェーンのコピーを他の多くのノードが持っており、各ブロックには提案者の署名と検証（attestation）も必要です。1人で作り直したチェーンは受け入れられません。",
    en: "You managed to re-link everything. On a single machine, rebuilding every following block is enough to make a tampered chain look consistent again. But on a real network, many other nodes hold the same chain, and every block also needs the proposer's signature and attestations. A chain rebuilt alone would not be accepted.",
  },
  "hashDemo.whoComputes": {
    ja: "実際のチェーンでは、このハッシュ計算はブロックを作った実行クライアント（reth など）が行い、受け取った各ノードも自分で再計算して検証します。chainviz（collector）はノードが報告した値をそのまま表示しています。",
    en: "On a real chain, this hash is computed by the execution client that built the block (e.g. reth), and every node that receives it recomputes and verifies the hash itself. chainviz (the collector) simply displays the value each node reported.",
  },
  "hashDemo.simplifiedNote": {
    ja: "実際のブロックはここに出した項目のほかにも多くの情報（state root など）を含み、決められた形式（RLP）で並べてからハッシュ化します。この砂場では「中身が変わればハッシュが変わる」ことに絞って簡略化しています。",
    en: "A real block header contains many more fields than shown here (such as the state root) and is encoded in a fixed format (RLP) before hashing. This sandbox is simplified down to the single idea that changing the contents changes the hash.",
  },
  // --- 「署名と検証のしくみ」デモ（kind: "signatureDemo"。Issue #402。
  // docs/worklog/issue-402.md UX設計 §5。英語版は初稿で、
  // chainviz-i18n のレビュー対象） ---
  "sigDemo.open": { ja: "署名と検証のしくみを試す", en: "Try how signing and verification work" },
  "sigDemo.title": { ja: "署名と検証のしくみ", en: "How signing and verification work" },
  "sigDemo.intro": {
    ja: "ここは学習用の砂場です。実際のチェーンには影響しません。ワークベンチから送金するとき、裏側ではこれが起きています。",
    en: "This is a learning sandbox. It does not affect the real chain. This is what happens behind the scenes when you send a transfer from the workbench.",
  },
  "sigDemo.zone.workbench": { ja: "ワークベンチ（署名する側）", en: "Workbench (the signer)" },
  "sigDemo.zone.node": { ja: "ノード（検証する側）", en: "Node (the verifier)" },
  "sigDemo.privateKey": { ja: "秘密鍵（砂場専用）", en: "Private key (sandbox only)" },
  "sigDemo.privateKeyNote": {
    ja: "実際の秘密鍵は画面に出しません。これは砂場専用の使い捨ての鍵です。",
    en: "Real private keys are never shown on screen. This is a disposable key used only in this sandbox.",
  },
  "sigDemo.addressNote": {
    ja: "アドレスは秘密鍵から導出されます（秘密鍵→公開鍵→その keccak256 ハッシュの末尾20バイト）。",
    en: "The address is derived from the private key (private key → public key → the last 20 bytes of its keccak256 hash).",
  },
  "sigDemo.field.from": { ja: "送信者（from）", en: "Sender (from)" },
  "sigDemo.field.to": { ja: "宛先", en: "To" },
  "sigDemo.field.amount": { ja: "金額", en: "Amount" },
  "sigDemo.field.receivedSignature": { ja: "届いた署名", en: "Signature received" },
  "sigDemo.compute.sign": { ja: "secp256k1 で署名", en: "Signed with secp256k1" },
  "sigDemo.compute.verify": {
    ja: "署名からアドレスを復元（ecrecover）",
    en: "Recover the address from the signature (ecrecover)",
  },
  // Issue #406: f(x) / f⁻¹(x) の x に何が入るかを明示する行。「x = 」自体は
  // 数式記号として JSX 側でハードコードするため、ここには本文だけを持たせる。
  "sigDemo.computeInput.sign": {
    ja: "keccak256(送信者 | 宛先 | 金額)。内容をまず keccak256 でハッシュ化し、そのハッシュに署名します。",
    en: "keccak256(sender | to | amount). The content is hashed with keccak256 first, and that hash is what gets signed.",
  },
  "sigDemo.computeInput.verify": {
    ja: "届いた署名 と keccak256(送信者 | 宛先 | 金額)。ハッシュは届いた内容から計算し直します。",
    en: "the received signature and keccak256(sender | to | amount), recomputed from the content that arrived.",
  },
  "sigDemo.verifyNote": {
    ja: "復元に秘密鍵は不要です。誰でも検証できます。",
    en: "Recovery needs no private key. Anyone can verify it.",
  },
  "sigDemo.signature": { ja: "署名データ", en: "Signature" },
  "sigDemo.recovered": { ja: "復元されたアドレス", en: "Recovered address" },
  "sigDemo.transport": {
    ja: "内容と署名がセットでノードへ届きます。",
    en: "The content and the signature travel to the node together.",
  },
  "sigDemo.tamperHint": {
    ja: "届いた内容を書き換えてみてください（通信の途中で改ざんされた想定です）。",
    en: "Try editing the content that arrived (imagine it was tampered with in transit).",
  },
  "sigDemo.badge.valid": {
    ja: "有効: 復元されたアドレスが送信者と一致",
    en: "Valid: the recovered address matches the sender",
  },
  "sigDemo.badge.invalid": {
    ja: "無効: 復元されたアドレスが送信者と一致しません",
    en: "Invalid: the recovered address does not match the sender",
  },
  "sigDemo.resignAttacker": { ja: "攻撃者の鍵で署名し直す", en: "Re-sign with the attacker's key" },
  "sigDemo.resignAttackerResult": {
    ja: "署名そのものは正しくなりましたが、復元されるのは攻撃者のアドレスです。送信者（Alice）にはなりすませません。",
    en: "The signature itself is now mathematically correct, but the recovered address is the attacker's. It cannot impersonate the sender (Alice).",
  },
  "sigDemo.resignAlice": { ja: "Alice が署名し直す（正しく送り直す）", en: "Alice re-signs (resend correctly)" },
  "sigDemo.resignAliceResult": {
    ja: "内容を変えて有効な署名を作れるのは、秘密鍵を持つ本人だけです。",
    en: "Only the person holding the private key can change the content and still produce a valid signature.",
  },
  "sigDemo.reset": { ja: "最初に戻す", en: "Reset" },
  "sigDemo.whoVerifies": {
    ja: "実際のチェーンでは、この検証は tx を受け取った各ノードが mempool に入れる前に行います。chainviz（collector）はこの検証は行わず、ノードが報告する送信者（from）をそのまま表示しています。",
    en: "On a real chain, each node that receives a tx performs this verification before admitting it to the mempool. chainviz (the collector) does not perform this verification itself; it simply displays the sender (from) that each node reports.",
  },
  "sigDemo.otherVerifications": {
    ja: "チェーンには署名検証のほかにも検証があります。ブロックの中身の検証（実行クライアントが行い、合意クライアントが Engine API 経由で依頼する）と、バリデーターによるブロックへの投票（attestation）です。chainviz では validator の投票内容までは観測していません。",
    en: "The chain has other kinds of verification beyond signature checking: validating a block's contents (done by the execution client, requested by the consensus client via the Engine API), and validators voting on blocks (attestation). chainviz does not observe the contents of validator votes.",
  },
  "sigDemo.otherVerifications.attestation": { ja: "attestation", en: "attestation" },
  "sigDemo.otherVerifications.engineApi": { ja: "Engine API", en: "Engine API" },
  "sigDemo.simplifiedNote": {
    ja: "実際の tx はここに出した項目のほかにも多くの情報（nonce・gas など）を含み、決められた形式（RLP）で並べてから署名します。この砂場では「内容と署名が結びついている」ことに絞って簡略化しています。",
    en: "A real tx contains many more fields than shown here (such as nonce and gas) and is encoded in a fixed format (RLP) before signing. This sandbox is simplified down to the single idea that the content and the signature are bound together.",
  },
} as const satisfies Record<string, Localized>;

export type MessageKey = keyof typeof messages;
