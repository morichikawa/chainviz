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
  "canvas.empty": {
    ja: "表示するコンテナがありません",
    en: "No containers to display",
  },
} as const satisfies Record<string, Localized>;

export type MessageKey = keyof typeof messages;
