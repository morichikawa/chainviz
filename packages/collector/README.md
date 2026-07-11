# @chainviz/collector — バックエンド(観察 + 操作)

Docker 上のノード環境を観測してワールドステートを組み立て、WebSocket で
frontend へ配信するバックエンド。frontend からの操作コマンド(ノード追加・
ワークベンチ操作など)の実行も担う。

## 役割と境界

- 「ノード環境 → Collector → GUI フロント」の一方向依存の**中間層**。
  Docker Engine API・ノードの各種 API(JSON-RPC / Beacon API / Prometheus
  メトリクス)に触れてよいのはこのパッケージだけ。frontend は必ずここを
  経由する(CLAUDE.md「境界を崩さない」)
- チェーン固有のロジック(RPC メソッド名・レスポンスの正規化)は
  `src/adapters/<chainName>/` の中に閉じ込める。store・server・commands には
  チェーン非依存の型(`@chainviz/shared`)だけを流す
- 新チェーン対応は `src/adapters/<newChain>/` の新規追加で行い、既存の
  ethereum アダプタには手を入れない(CLAUDE.md「チェーンプロファイル単位で
  増やす」)
- **依存**: `@chainviz/shared`・dockerode・viem・ws

## モジュール構成

| ディレクトリ / ファイル  | 責務                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`           | エントリポイント。Docker ポーリング → アダプタ → store → WebSocket 配信の配線                                                                                                                               |
| `src/docker/`            | Docker Engine API(dockerode)のポーリング・コンテナ操作の抽象                                                                                                                                                |
| `src/adapters/ethereum/` | EthereumAdapter。JSON-RPC / Beacon API / Prometheus メトリクスの観測とチェーン非依存型への正規化、ウォレット追跡、コントラクトカタログ、ワークベンチ操作(`cast` / `forge`)の実行。1 関心事 1 ファイルで分割 |
| `src/world-state/`       | インメモリのワールドステート store と差分(DiffEvent)計算                                                                                                                                                    |
| `src/proxy/`             | ロギングプロキシ(ワークベンチの RPC を中継しつつ観測)と、観測結果 → `operationObserved` へのマッピング                                                                                                      |
| `src/server/`            | WebSocket サーバー(snapshot / diff / command の送受信)                                                                                                                                                      |
| `src/commands/`          | 操作コマンドの処理と managed コンテナのライフサイクル                                                                                                                                                       |
| `src/build-info/`        | ビルド成果物の鮮度マーカー(古い dist の実行検知)                                                                                                                                                            |

## 実行

```sh
pnpm --filter @chainviz/collector build
pnpm --filter @chainviz/collector start
```

- 前提: `profiles/ethereum` のスタックが起動していること(手元で全部
  まとめて上げるなら、リポジトリルートの `pnpm dev:up` が楽)
- 待受ポート: WebSocket **4000** / ロギングプロキシ **4001**(いずれも
  `0.0.0.0` に bind。理由は `docs/ARCHITECTURE.md`「未確定のまま残す項目」の
  Issue #99 の項を参照)
- 主な環境変数: `CHAINVIZ_PROXY_PORT` / `CHAINVIZ_PROXY_TARGET` /
  `CHAINVIZ_WORKBENCH_RPC_HOST` / `CHAINVIZ_ETHEREUM_PROFILE_DIR`

## テスト

```sh
pnpm --filter @chainviz/collector test   # ユニット(vitest)。Docker 不要
```

実 Docker と疎通させる結合テストは `@chainviz/e2e` の担当
(`packages/e2e/README.md`)。

## 関連ドキュメント

- ワールドステートのスキーマ・差分イベント: `docs/ARCHITECTURE.md` §2
- WebSocket プロトコル・コマンド: `docs/ARCHITECTURE.md` §3
- ChainAdapter の契約・観測方法の設計判断: `docs/ARCHITECTURE.md` §4・§7
- 観測対象のノード環境: `profiles/ethereum/README.md`
