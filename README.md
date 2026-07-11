# chainviz

Docker 上の Ethereum ノード群を Miro 風の無限キャンバスでリアルタイムに
可視化する、学習・開発理解のためのインタラクティブアプリ。

- ノード・ワークベンチ(ユーザー操作マシン)・ウォレット・コントラクトを
  カードとして表示し、ズーム・パン・ドラッグで観察する
- P2P 接続・ブロック伝播・RPC 呼び出し・tx ライフサイクルをエッジと
  パルスで表現する
- インフラ(A層) → P2P(B層) → トランザクション(C層) → ノード内部(D層)
  の階層で掘り下げる
- GUI からノード追加・送金・コントラクトのデプロイ/呼び出しを実行し、
  その結果が観測として画面に現れる様子を見る
- 用語のインライン解説(ja/en)つき

## クイックスタート

前提: Docker(compose)・Node.js・pnpm。

```sh
pnpm install
pnpm dev:up      # Docker スタック + collector + frontend をまとめて起動
# → http://localhost:5173 を開く
pnpm dev:down    # まとめて停止
```

## 構成

「ノード環境(被可視化対象) → Collector → GUI フロント」の一方向の依存で
構成する。各パッケージの詳細(役割・境界・モジュール構成)はそれぞれの
README を参照。

| 場所                                                  | 役割                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`profiles/ethereum/`](profiles/ethereum/README.md)   | ノード環境テンプレート(reth + lighthouse の PoS プライベートネット + Foundry ワークベンチ) |
| [`packages/collector/`](packages/collector/README.md) | バックエンド。Docker・ノード API を観測してワールドステートを組み立て、WebSocket で配信    |
| [`packages/frontend/`](packages/frontend/README.md)   | GUI。React Flow の無限キャンバス                                                           |
| [`packages/shared/`](packages/shared/README.md)       | 共有型定義(ワールドステートのスキーマ・プロトコル)                                         |
| [`packages/e2e/`](packages/e2e/README.md)             | E2E 結合テスト(プロトコル層 + Playwright の UI 層)                                         |
| `glossary/`                                           | 用語解説データ(YAML、ja/en)                                                                |

## ドキュメント

| ドキュメント                                 | 内容                                                           |
| -------------------------------------------- | -------------------------------------------------------------- |
| [docs/CONCEPT.md](docs/CONCEPT.md)           | 構想・決定事項と「なぜ」(原典)                                 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 全体設計(スキーマ・プロトコル・チェーンプロファイル・E2E 構成) |
| [docs/PLAN.md](docs/PLAN.md)                 | 作業計画と進捗(チェックボックス管理)                           |
| [docs/WORKLOG.md](docs/WORKLOG.md)           | 作業記録の索引(経緯は `docs/worklog/` 配下)                    |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | 開発の進め方(コミット規約・フック・テスト)                     |
