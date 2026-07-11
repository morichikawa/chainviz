# @chainviz/frontend — GUI(無限キャンバス)

collector から受け取ったワールドステートを React Flow の無限キャンバスに
描画し、ノード・ワークベンチへの操作コマンドを発行する GUI。

## 役割と境界

- collector と **WebSocket でのみ**通信する(接続先は `VITE_COLLECTOR_URL`。
  ビルド時埋め込み)。Docker やノードの API には直接触れない(CLAUDE.md
  「境界を崩さない」)
- チェーン依存の生の文字列(RPC メソッド名・同期ステージ名・ノード役割
  など)の解釈・表示は `src/chain-profiles/<chainName>/` の表現セットに
  閉じ込める。それ以外のコードはチェーン非依存に保つ
- UI 文言は `src/i18n/` の `{ja, en}` 2 言語対応を前提に書く
- **依存**: `@chainviz/shared`・@xyflow/react(React Flow)・react・js-yaml

## モジュール構成

| ディレクトリ          | 責務                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`            | アプリのルート組み立て(`App` コンポーネント・依存の初期化)                                                                                        |
| `src/canvas/`         | React Flow の土台(ズーム/パン/ドラッグ)・操作ツールバー・操作予告(ActionHint)                                                                     |
| `src/entities/`       | カード(ノード/ワークベンチ/ウォレット/コントラクト)とエッジ(ピア/所有/操作/デプロイ/内部リンク)の表示コンポーネント、パルス・発光などの演出フック |
| `src/operations/`     | ワークベンチ定型操作(送金/デプロイ/コントラクト呼び出し)のパネル・フォーム・入力バリデーション                                                    |
| `src/commands/`       | 操作コマンドの発行・保留追跡・失敗通知の配線                                                                                                      |
| `src/world-state/`    | 受信したスナップショット/差分を畳み込むクライアント側ストア                                                                                       |
| `src/websocket/`      | collector への接続・メッセージ送受信・モックデータ                                                                                                |
| `src/chain-profiles/` | チェーンプロファイルごとのフロント表現セット(チェーン依存の生の文字列 → 表示名/説明の対応)                                                        |
| `src/glossary/`       | インライン用語解説・用語集パネル(`glossary/` データの読み込み)                                                                                    |
| `src/i18n/`           | ja/en の文言定義と切り替え                                                                                                                        |
| `src/interaction/`    | カード種別を跨ぐ汎用の操作性ロジック(ホバーポップオーバーの開閉遅延・document.body への portal 描画など)                                          |
| `src/layout/`         | カード配置の localStorage 永続化                                                                                                                  |
| `src/notifications/`  | トースト通知(コマンド失敗のエラー表示など)                                                                                                        |
| `src/platform/`       | ブラウザ API の薄いラッパー(localStorage など)                                                                                                    |

`src/index.ts` はロジック部分のバレル(テスト・e2e から参照する純粋な
変換・状態管理のみ。React コンポーネントは含めない)。

## 実行

```sh
pnpm --filter @chainviz/frontend dev        # vite dev サーバー(ポート 5173)
```

- collector(ポート 4000)が起動していれば実データに接続する。手元で全部
  まとめて上げるなら、リポジトリルートの `pnpm dev:up` が楽

## テスト

```sh
pnpm --filter @chainviz/frontend test   # ユニット(vitest + testing-library)
```

- ロケータは `data-testid` を正とする(E2E と共通の計装方針。
  `docs/ARCHITECTURE.md` §8.5)
- 実ブラウザで操作する UI 層 E2E は `@chainviz/e2e` の担当

## 関連ドキュメント

- 受信するスキーマ・プロトコル: `docs/ARCHITECTURE.md` §2〜§3
- キャンバスの情報構造・カード/エッジの UX 設計: `docs/ARCHITECTURE.md`
  §6(C層)・§7(D層)
- UI コンセプト(帯構造・レイヤー切り替え・用語解説): `docs/CONCEPT.md`
