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
    e2e/               # E2E 結合テスト（collector を実 Docker と疎通させて検証）
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
  canvas/              # React Flow の土台（ズーム/パン/ドラッグ）・操作ツールバー
  commands/            # 操作コマンドの発行・保留追跡・失敗通知の配線
  entities/            # ノード/ワークベンチ/ウォレットのカード表示コンポーネント
  glossary/            # インライン解説・用語集パネル
  i18n/                # ja/en 切り替え
  layout/              # レイアウトの localStorage 永続化
  notifications/       # トースト通知（コマンド失敗のエラー表示など）
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

// ワークベンチ → ノードの 1 回の呼び出し（操作）を表すエッジ。
// PeerEdge のような永続的な接続状態ではなく「観測された瞬間の出来事」
// （揮発性）なので、スナップショットには含めず、差分イベント
// operationObserved でのみ流れる（後述）。
interface OperationEdge {
  kind: "operation";
  fromWorkbenchId: string; // 呼び出し元ワークベンチのエンティティ id
  toNodeId: string; // 呼び出し先ノードのエンティティ id
  operation: string; // 呼び出しの種類（JSON-RPC メソッド名などの生の文字列）
  observedAt: number; // ロギングプロキシが観測した時刻（epoch ms）
}

// キャンバス上でエッジ（紐）として描画されるものの総称
type WorldStateEdge = PeerEdge | OperationEdge;

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
  | {
      type: "edgeRemoved";
      fromNodeId: string;
      toNodeId: string;
      networkId: string; // エッジの同一性キーは from/to/networkId の 3 つ組
    }
  | { type: "operationObserved"; edge: OperationEdge };
```

エンティティ削除時の扱いは CONCEPT.md の決定に従う: `NodeEntity` /
`WorkbenchEntity` は `entityRemoved` で消えるが、`WalletEntity` は
残し `ownerWorkbenchId` を `null` に更新する（`entityUpdated` を送る）。

エッジ系イベントは性質の違いで 2 系統に分かれる:

- `edgeAdded` / `edgeRemoved` — 永続的なピア接続（`PeerEdge`）の状態遷移。
  store の状態（スナップショットの `edges`）に畳み込まれる
- `operationObserved` — ワークベンチ → ノードの呼び出し（`OperationEdge`）の
  1 回きりの観測イベント（揮発性）。store の状態には畳み込まれず、
  スナップショットにも現れない。対応する削除イベントも存在せず、フロントは
  受信時にエッジ＋パルスのアニメーションとして消費し、自身のタイミングで
  消す（CONCEPT.md「操作がエッジになる」参照）。`OperationEdge.operation` の
  値はチェーン依存の生の文字列であり、その解釈・表示はフロントの
  チェーンプロファイル表現セットの責務とする

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
  subscribeBlocks(onBlock: (block: BlockEntity) => void): Promise<void>; // B層
  subscribeTransactions(onTx: (tx: TransactionEntity) => void): Promise<void>; // C層
  // D層の購読口は Phase 4 の設計時に追加する（チェーンごとに任意）
}
```

当初は C/D 層の入口として層をまたぐ汎用の
`subscribeChainEvents(onEvent: (e: DiffEvent) => void)` を置いていたが、
実装では層ごとに関心を分けるため**層ごとの型付きコールバック**へ発展させた。
型もそれに合わせ、未使用となった汎用口は削除している（先回り実装をしない）:

- `subscribeBlocks` — B層。各 Execution ノードの `eth_subscribe(newHeads)` を
  購読し、ブロック受信時刻を束ねて渡す。
- `subscribeTransactions` — C層。`newPendingTransactions`（pending 検知）と
  `newHeads`（ブロック取り込み検知）を購読し、状態変化した tx を渡す。

いずれも `BlockEntity` / `TransactionEntity` を返し、ワールドステートへの反映
（差分計算・エンティティ更新）は store 側が担う。チェーン固有の RPC メソッド名は
アダプタ配下に閉じ込め、これらのコールバックにはチェーン非依存の型だけを流す。

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
  - 部分的に確定（Issue #65）: addNode/addWorkbench で作成した managed
    コンテナのレジストリ（`EthereumNodeLifecycle` の nodes/workbenches）に
    ついては、ファイルベースの永続化を持たず、**Docker のラベルを単一の
    真実の情報源**とする。collector 起動時に `com.chainviz.managed=true`
    かつ自プロファイルの `com.docker.compose.project` を持つコンテナを
    走査する `recoverManagedContainers()` でレジストリを再構築する。
    ワールドステートそのもの（A〜D 層の観測結果）は引き続きインメモリで、
    再接続クライアントには store のスナップショットで復元する。
- WebSocket の再接続・スナップショット再送のプロトコル詳細
- ロギングプロキシの具体的な実装形態（別コンテナか collector 内蔵か）
  - 確定（Issue #79）: 別コンテナにはせず **collector 内蔵**とする。
    collector プロセス内で JSON-RPC を中継する HTTP プロキシを起動し、
    通過した RPC を観測（ワールドステートの D 層）として記録する。
    待受ポートの既定は **4001**（WebSocket サーバーの 4000 と衝突しない
    値）、中継先の既定は既定ワークベンチが叩くノードの JSON-RPC
    エンドポイント。いずれも環境変数 `CHAINVIZ_PROXY_PORT` /
    `CHAINVIZ_PROXY_TARGET` で上書きできる。
