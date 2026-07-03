# chainviz アーキテクチャ設計

`docs/CONCEPT.md` の決定事項を実装可能な形に落とし込んだもの。
実装はこのドキュメントの記述に従う。コードとの齟齬は sync-docs スキルで検知する。

## 1. リポジトリ構成

pnpm workspace によるモノレポ。3パッケージに分割し、`shared` の型を
`collector` / `frontend` の両方から参照することで、ワールドステートの
スキーマを二重定義しない。

```
chainviz/
  pnpm-workspace.yaml
  tsconfig.base.json
  package.json
  packages/
    shared/          # ワールドステートの型・プロトコル・ChainProfile の型
    collector/        # バックエンド（観察 + 操作）
    frontend/          # GUI（React Flow キャンバス）
  profiles/
    ethereum/          # チェーンプロファイル: ノード環境テンプレート（compose）
  glossary/            # 用語解説データ（CONCEPT.md「データの置き場所」参照）
    ethereum/terms/
    services.yaml
    sources.yaml
    cross-chain.yaml
  docs/
```

各パッケージ内部は技術レイヤーではなくドメイン単位でモジュールを切る
（CLAUDE.md の方針）。

```
packages/shared/src/
  world-state/         # エンティティ型（node, workbench, wallet, peer, block, tx, contract…）
  events/              # 差分イベント型
  protocol/            # WebSocket メッセージ envelope 型（snapshot/diff/command）
  chain-profile/       # ChainAdapter・ChainProfile のインターフェース型

packages/collector/src/
  docker/              # Docker Engine API（dockerode）のポーリング
  adapters/
    chain-adapter.ts    # ChainAdapter インターフェース
    ethereum/           # EthereumAdapter（JSON-RPC / Engine API / Prometheus）
  proxy/               # ワークベンチ RPC 観測用ロギングプロキシ
  world-state/         # インメモリのワールドステート store + 差分計算
  commands/            # フロントからの操作コマンド処理（ノード/ワークベンチ追加・削除）
  server/              # WebSocket サーバー
  index.ts

packages/frontend/src/
  app/                 # アプリのルート組み立て（App コンポーネント・依存の初期化）
  canvas/              # React Flow の土台（ズーム/パン/ドラッグ）
  entities/            # ノード/ワークベンチ/ウォレットのカード表示コンポーネント
  glossary/            # インライン解説・用語集パネル
  i18n/                # ja/en 切り替え
  layout/              # レイアウトの localStorage 永続化
  platform/            # ブラウザ API のラッパー（localStorage などの薄い抽象）
  websocket/           # collector への接続・スナップショット/差分メッセージの受信
  world-state/         # 受信したスナップショット/差分を畳み込むクライアント側ストア
  chain-profiles/      # チェーンプロファイルごとのフロント表現セット
```

## 2. ワールドステートのスキーマ

チェーン非依存の語彙で設計する（CONCEPT.md「ChainAdapter」参照）。
`packages/shared/src/world-state/` に型として定義する。

### エンティティ

```ts
type ChainType = "ethereum"; // 今後 "bitcoin" | "solana" | "cosmos" を追加

interface InfraEntity {
  id: string; // 安定識別子。Docker コンテナ ID は使わない（再起動で変わるため）
  containerName: string;
  ip: string;
  ports: number[];
  resources: { cpuPercent: number; memMB: number };
  process: { name: string; version?: string };
}

interface NodeEntity extends InfraEntity {
  kind: "node";
  chainType: ChainType;
  clientType: string; // "reth" | "lighthouse" など
  syncStatus: "syncing" | "synced";
  blockHeight: number;
  headBlockHash: string;
}

interface WorkbenchEntity extends InfraEntity {
  kind: "workbench";
  label: string; // "Alice" 等、ユーザーが付ける表示名
  walletIds: string[]; // 所有ウォレット（基本は 1 件。CONCEPT.md 案B）
}

interface PeerEdge {
  kind: "peer";
  fromNodeId: string;
  toNodeId: string;
  networkId: string;
}

interface WalletEntity {
  kind: "wallet";
  address: string;
  chainType: ChainType;
  balance: string; // wei を文字列で（精度落ち防止）
  nonce: number;
  isSmartAccount: boolean;
  ownerWorkbenchId: string | null; // ワークベンチ削除後も null にして残す（CONCEPT.md 参照）
  recentTxHashes: string[];
}

interface BlockEntity {
  kind: "block";
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
  receivedAt: Record<string /* nodeId */, number /* epoch ms */>; // 伝播の波アニメーション用
}

interface TransactionEntity {
  kind: "transaction";
  hash: string;
  from: string;
  to: string | null;
  status: "pending" | "included" | "failed";
  blockHash?: string;
}

interface ContractEntity {
  kind: "contract";
  address: string;
  abiRef?: string;
}

// AA（発展）
interface UserOperationEntity {
  kind: "userOperation";
  hash: string;
  sender: string; // Smart Account アドレス
  status: "altMempool" | "bundled" | "included";
}
```

### 差分イベント（`packages/shared/src/events/`）

```ts
type DiffEvent =
  | { type: "entityAdded"; entity: WorldStateEntity }
  | { type: "entityUpdated"; id: string; patch: Partial<WorldStateEntity> }
  | { type: "entityRemoved"; id: string }
  | { type: "edgeAdded"; edge: PeerEdge }
  | { type: "edgeRemoved"; fromNodeId: string; toNodeId: string };
```

エンティティ削除時の扱いは CONCEPT.md の決定に従う: `NodeEntity` /
`WorkbenchEntity` は `entityRemoved` で消えるが、`WalletEntity` は
残し `ownerWorkbenchId` を `null` に更新する（`entityUpdated` を送る）。

## 3. Collector ⇔ フロントの WebSocket プロトコル

`packages/shared/src/protocol/` にメッセージ envelope を定義する。

```ts
// サーバー → クライアント
type ServerMessage =
  | { type: "snapshot"; payload: WorldStateSnapshot }
  | { type: "diff"; payload: DiffEvent[] }
  | { type: "commandResult"; commandId: string; ok: boolean; error?: string };

// クライアント → サーバー
type ClientMessage = { type: "command"; commandId: string; command: Command };

type Command =
  | { action: "addNode"; chainProfile: string }
  | { action: "removeNode"; nodeId: string }
  | { action: "addWorkbench"; label: string }
  | { action: "removeWorkbench"; workbenchId: string };
```

流れ:

1. クライアント接続 → サーバーが `snapshot` を1回送る
2. 以後、状態変化のたびに `diff` を送る（3秒間隔のポーリング結果 or
   購読イベントのたびに反映）
3. クライアントが操作したい場合は `command` を送り、サーバーは処理後に
   `commandResult` を返す。実際の反映は後続の `diff` で届く
   （command 自体はワールドステートを直接書き換えない）

## 4. チェーンプロファイルの構成

CONCEPT.md の「3点セット」を、それぞれ対応するディレクトリ/コードで表現する。

| 要素                   | 置き場所                                                              |
| ---------------------- | --------------------------------------------------------------------- |
| ノード環境テンプレート | `profiles/<chainName>/docker-compose.yml` ＋ genesis 等の設定ファイル |
| ChainAdapter           | `packages/collector/src/adapters/<chainName>/`                        |
| フロント表現セット     | `packages/frontend/src/chain-profiles/<chainName>/`                   |

```ts
// packages/shared/src/chain-profile/index.ts
interface ChainAdapter {
  chainType: ChainType;
  pollInfra(): Promise<Partial<WorldStateSnapshot>>; // A層
  subscribePeers(onUpdate: (edges: PeerEdge[]) => void): void; // B層
  subscribeChainEvents(onEvent: (e: DiffEvent) => void): void; // C層
  // D層はチェーンごとに任意（Ethereum のみ実装）
}
```

`ChainAdapter` を実装し、`profiles/<chainName>/` を追加するだけで
新チェーンに対応する。既存プロファイルのコードは変更しない
（CLAUDE.md「チェーンプロファイル単位で増やす」）。

## 5. glossary データ形式

CONCEPT.md「用語解説」「データの置き場所」の設計をそのまま採用する。
スキーマ（1エントリあたり）:

```yaml
# glossary/ethereum/terms/a-infra.yaml の例
mempool:
  name: { ja: "メンプール", en: "Mempool" }
  definition: { ja: "...", en: "..." }
  layer: c-tx
  relatedTerms: [nonce, gas]
```

```yaml
# glossary/services.yaml の例（用語キー → サービス一覧）
mempool:
  - name: "Blocknative Mempool Explorer"
    note: { ja: "...", en: "..." }
    url: "https://..."
```

```yaml
# glossary/sources.yaml の例（リソース名 → url・対象の用語キー一覧）
"EIP-4337":
  url: "https://eips.ethereum.org/EIPS/eip-4337"
  termKeys: [userOperation, bundler, entryPoint]
```

```yaml
# glossary/cross-chain.yaml の例
mempool:
  ethereum: { ja: "待機プールに保持", en: "..." }
  solana: { ja: "リーダーへ直接転送しため込まない", en: "..." }
```

## 未確定のまま残す項目

以下は実装しながら詰める（先回りして今は決めない）。

- `collector` 内の状態ストア実装（インメモリのみで十分か、再起動時の
  復元をどうするか）
- WebSocket の再接続・スナップショット再送のプロトコル詳細
- ロギングプロキシの具体的な実装形態（別コンテナか collector 内蔵か）
