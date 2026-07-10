/** 対応言語。当面は日本語・英語の2つ（CONCEPT.md「体験イメージ」）。 */
export type Language = "ja" | "en";

export const LANGUAGES: Language[] = ["ja", "en"];

export const DEFAULT_LANGUAGE: Language = "ja";

/** `{ja, en}` 形式の多言語テキスト。 */
export type Localized = Record<Language, string>;

/** UI 文言。値は `{ja, en}` 形式で持つ。 */
export const messages = {
  "app.title": { ja: "chainviz — インフラ可視化", en: "chainviz — Infrastructure" },
  "app.subtitle": {
    ja: "Docker 上の Ethereum ノード群（A層）",
    en: "Ethereum nodes on Docker (Layer A)",
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
  "field.sync": { ja: "同期状態", en: "Sync status" },
  "field.blockHeight": { ja: "ブロック高", en: "Block height" },
  "sync.synced": { ja: "同期済み", en: "Synced" },
  "sync.syncing": { ja: "同期中", en: "Syncing" },
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
  "operation.deploy.contract": { ja: "コントラクト", en: "Contract" },
  "operation.deploy.submit": { ja: "デプロイする", en: "Deploy" },
  "operation.deploy.note": {
    ja: "ソースからコンパイルしたコントラクトを配置する tx が送られ、取り込まれるとコントラクトカードが現れます",
    en: "Sends a tx that places the compiled contract on chain; a contract card appears once it is included.",
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
  "operation.pending": { ja: "実行中…", en: "Running…" },
  "ghost.contract.deploying": { ja: "デプロイ中… {name}", en: "Deploying… {name}" },
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
} as const satisfies Record<string, Localized>;

export type MessageKey = keyof typeof messages;
