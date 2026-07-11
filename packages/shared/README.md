# @chainviz/shared — ワールドステートの型・プロトコル定義

collector と frontend の間で共有する型定義のパッケージ。ワールドステートの
スキーマを二重定義しないための単一の置き場所で、実行時ロジックは持たない
(型と、型に付随する最小限の定数・型ガードのみ)。

## 役割と境界

- **チェーン非依存の語彙だけを使う**。`eth_getLogs` のようなチェーン固有の
  語彙をここに持ち込まない(CLAUDE.md「ChainAdapter 境界」)。チェーン依存の
  生の文字列(RPC メソッド名・同期ステージ名など)を運ぶフィールドは
  `string` のまま持ち、解釈はフロントのチェーンプロファイル表現セットに
  委ねる
- **依存**: 他パッケージに依存しない(依存グラフの終端)
- **依存される**: collector / frontend / e2e のすべてがこの型を参照する

## モジュール構成

| ディレクトリ         | 責務                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/world-state/`   | エンティティ型(`NodeEntity` / `WorkbenchEntity` / `WalletEntity` / `BlockEntity` / `TransactionEntity` / `ContractEntity` 等)とエッジ型(`PeerEdge` / `OperationEdge`)、スナップショット型 |
| `src/events/`        | 差分イベント型(`DiffEvent`。`entityAdded` / `entityUpdated` / `entityRemoved` / `edgeAdded` / `edgeRemoved` / `operationObserved` / `nodeLinkActivity`)                                   |
| `src/protocol/`      | WebSocket メッセージ envelope 型(`snapshot` / `diff` / `command` / `commandResult`)と操作コマンド型(`Command` / `WorkbenchOperation`)                                                     |
| `src/chain-profile/` | `ChainAdapter` インターフェース型・`ChainType`                                                                                                                                            |

各フィールドの意味・設計判断(揮発性イベントと永続状態の区別、省略時の
セマンティクスなど)は `docs/ARCHITECTURE.md` §2〜§4 を正とする。

## 変更時のルール

- 型の変更は collector / frontend 双方のビルドに影響する。変更したら
  リポジトリルートで `pnpm build && pnpm test`(全パッケージ)を実行して
  壊れていないことを確認する
- 設計フェーズ(chainviz-designer)で型を先に固めるのが基本の流れ。実装中に
  追加の型変更が必要になった場合は chainviz-reviewer が調整する(CLAUDE.md
  「開発体制」)
- 新しいフィールドは原則 optional で足し、「省略 = 情報なし/旧スナップ
  ショット互換」のセマンティクスを型定義のコメントに明記する(既存の
  `p2pRole` / `internals` / `tokenBalances` などと同じ流儀)

## ビルド・テスト

```sh
pnpm --filter @chainviz/shared build
pnpm --filter @chainviz/shared test
```
