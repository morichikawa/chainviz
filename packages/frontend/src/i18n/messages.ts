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
  "command.error.unknown": {
    ja: "コマンドの実行に失敗しました",
    en: "Command failed",
  },
} as const satisfies Record<string, Localized>;

export type MessageKey = keyof typeof messages;
