/// <reference types="vite/client" />

interface ImportMetaEnv {
  // collector の WebSocket URL。未設定ならモックデータで動作する。
  readonly VITE_COLLECTOR_URL?: string;
}

// `?raw` サフィックス付きインポート（Vite 機能）を YAML 生テキストとして扱う。
// tsc の module resolution はこの ambient wildcard で短絡させる。
declare module "*.yaml?raw" {
  const content: string;
  export default content;
}
