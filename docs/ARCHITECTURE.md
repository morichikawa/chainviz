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
  interaction/         # カード種別を跨ぐ汎用の操作性ロジック（ホバーポップオーバーの
                       # 開閉遅延・React Flow ノードの外（document.body）へ
                       # portal 描画する位置追従など。特定のドメインに属さない
                       # 横断的なフック・コンポーネント）
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
  // collector の addNode/addWorkbench で作成されたコンテナなら true。
  // compose 起動時からある初期構成のコンテナは removeNode/removeWorkbench が
  // 拒否するため false。省略時は false（削除不可）と同義で、フロントは true の
  // ときだけ削除 UI を出す。collector は managed ラベル（Issue #65 の
  // 「Docker のラベルを単一の真実の情報源とする」方針）から値を導出する
  removable?: boolean;
}

interface NodeEntity extends InfraEntity {
  kind: "node";
  chainType: ChainType;
  clientType: string; // "reth" | "lighthouse" など
  syncStatus: "syncing" | "synced";
  blockHeight: number;
  headBlockHash: string;
  // P2P ネットワーク上の役割。"bootnode" = 新規参加ノードが最初に接続する
  // 入口役、"peer" = それ以外の通常ピア、"none" = P2P ネットワークに参加
  // しないノード（Issue #214。例: Ethereum の validator client。beacon へ
  // HTTP API で接続するだけで libp2p に参加しないため、これを端点とする
  // PeerEdge は決して観測されない）。bootnode はチェーン非依存の P2P
  // 一般語彙として使う（Bitcoin の seed node 等も同系概念）。collector は
  // Docker ラベル `com.chainviz.p2p-role`（値 "bootnode" のときのみ
  // bootnode）と ChainAdapter 内の分類（Ethereum アダプタは compose
  // サービス名に "validator" を含むコンテナを "none" と判定）から導出し、
  // どちらにも該当しなければ peer とする（Issue #65 の「ラベルを単一の
  // 真実の情報源とする」方針。Ethereum プロファイルでは compose で
  // reth1/beacon1 にラベルを付与する）。省略時は「不明」（旧スナップ
  // ショット互換）で、フロントは p2pRole === "bootnode" の判定のみ行い、
  // 見つからなければブートノード前提の表示を出さない（Issue #123 / #124）。
  // "none" のノードは「接続確立中」エッジ（Issue #123/#124）の導出対象から除外する
  p2pRole?: "bootnode" | "peer" | "none";
  // ノードの役割（チェーン動作の中で何をする係か。Issue #215）。値はチェーン
  // プロファイル依存の生の文字列（Ethereum では "execution" / "consensus" /
  // "validator"）で、解釈・表示はフロントのチェーンプロファイル表現セット
  // （`chain-profiles/ethereum/nodeRoles.ts`）の責務（OperationEdge.operation /
  // SyncStageProgress.stage と同じパターン。union 型に焼き込まない）。
  // collector は Docker ラベル `com.chainviz.role`（既存。addNode の動的
  // コンテナには lifecycle が付与済み、compose の静的コンテナにはノード環境
  // テンプレートが付与する）から導出する（Issue #65 のラベル方針）。
  // p2pRole とは別軸（validator client は nodeRole="validator" かつ
  // p2pRole="none"）。省略 = 不明（ラベル未付与・旧スナップショット互換）で、
  // フロントは役割表示を出さない側に倒す。表現セットに無い未知の値も同様
  nodeRole?: string;
  // D層: このノードが内部 API で駆動する相手ノード（同じ論理ノードを構成する
  // 相方クライアント）の id。Ethereum プロファイルでは beacon（CL）に入り、
  // 対になる Execution（EL）を Engine API で駆動する関係を表す（チェーン固有
  // 語彙はスキーマに持ち込まず「駆動する側→される側」の一般関係だけを載せる）。
  // collector がインフラ観測から毎回解決する（rpcTargetNodeId と同じ考え方）。
  // 駆動関係を持たない・解決不能・旧スナップショットでは省略。フロントは
  // この値から常設の「内部リンク」エッジを導出して描画する（§7）
  drivesNodeId?: string;
  // D層: ノード内部の観測状態。メトリクス非公開・観測前・旧スナップショット
  // では省略（省略 = 情報なし）
  internals?: NodeInternals;
}

// ノード内部の同期ステージ 1 件の進行状況（D層）。stage はクライアント依存の
// 生の識別子（例: reth の "Headers"）で、解釈・表示はフロントのチェーン
// プロファイル表現セットの責務（OperationEdge.operation と同じ扱い）
interface SyncStageProgress {
  stage: string;
  checkpoint: number; // そのステージが処理を終えたブロック高
}

// ノード内部の観測状態（D層）。各フィールドは「そのノードが該当する内部構造を
// 持ち、かつ観測できた場合」のみ入る。Ethereum プロファイルでは EL（reth）
// ノードのみが syncStages / mempool を持ち、CL では internals 自体が省略される
interface NodeInternals {
  syncStages?: SyncStageProgress[];
  // このノードローカルの mempool の内訳（pending = 次のブロックに入れる tx 数、
  // queued = 前提条件待ちで保留中の tx 数）
  mempool?: { pending: number; queued: number };
}

interface WorkbenchEntity extends InfraEntity {
  kind: "workbench";
  label: string; // "Alice" 等、ユーザーが付ける表示名
  walletIds: string[]; // 所有ウォレット（基本は 1 件。CONCEPT.md 案B）
  // このワークベンチの RPC 呼び出しが最終的に届くノードのエンティティ id。
  // collector が実効的な RPC 到達先ホスト（ロギングプロキシの転送先
  // CHAINVIZ_PROXY_TARGET の host 部）をノードの ip と突き合わせて解決する
  // （operationObserved の toNodeId 解決と同じ考え方）。解決できない場合と
  // 旧スナップショットでは省略（null は使わず「無い」を省略に一本化）。
  // フロントは常設の「操作先」エッジ・カード詳細の表示に使う（Issue #123）
  rpcTargetNodeId?: string;
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

// 内部 API 呼び出し 1 種類ぶんの観測値（D層）。呼び出し 1 回ごとの離散イベント
// ではなく、観測間隔（メトリクスのスクレイプ周期）内の増分として観測される点が
// OperationEdge と異なる。method はチェーン/クライアント依存の生の識別子
// （例: "engine_newPayload"）で、解釈・表示はフロントの表現セットの責務
interface InternalCallStats {
  method: string;
  count: number; // 観測間隔内に増えた呼び出し回数（増分ゼロの種類は載せない）
  latencyMs?: number; // 所要時間の代表値。クライアントが公開し観測できた場合のみ
}

// 駆動リンク（NodeEntity.drivesNodeId）上で観測された呼び出し活動（揮発性）。
// OperationEdge と同じくスナップショットには含めず、差分イベント
// nodeLinkActivity でのみ流れる（後述）
interface NodeLinkActivity {
  fromNodeId: string; // 駆動する側（drivesNodeId を持つ側）
  toNodeId: string; // 駆動される側
  calls: InternalCallStats[];
  observedAt: number; // 観測した時刻（epoch ms）
}

interface TokenBalance {
  contractAddress: string; // トークンを管理する ContractEntity.address に対応
  amount: string; // トークン最小単位の 10 進文字列（精度落ち防止）
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
  // 追跡中のトークンコントラクト（コントラクトカタログ掲載分）の残高一覧。
  // symbol / decimals は対応する ContractEntity.token が持ち、ここでは重複させない。
  // トークン未デプロイの環境・旧スナップショットでは省略（省略 = 情報なし）
  tokenBalances?: TokenBalance[];
}

interface BlockEntity {
  kind: "block";
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
  receivedAt: Record<string /* nodeId */, number /* epoch ms */>; // 伝播の波アニメーション用
}

// 復号済みの引数 1 件。値は表示用に文字列化して持つ（大きな数値の精度落ち
// 防止と、チェーンごとの型体系をスキーマに持ち込まないため）
interface DecodedArgument {
  name: string;
  value: string;
}

// tx によるコントラクト関数呼び出しの内容。関数名・引数はコントラクト
// カタログ（後述 §4）で復号できた場合のみ入る。復号できない呼び出しは
// rawFunctionId（チェーン依存の生の識別子。EVM なら 4 バイトセレクタ）だけを
// 持ち、解釈・表示は OperationEdge.operation と同じくフロントのチェーン
// プロファイル表現セットの責務とする
interface ContractCall {
  contractAddress: string;
  functionName?: string;
  args?: DecodedArgument[];
  rawFunctionId?: string;
}

// tx の実行中にコントラクトが発したイベント（ログ）1 件。復号できない
// イベントは rawEventId（EVM なら topic0）だけを持つ
interface ContractEvent {
  contractAddress: string;
  eventName?: string;
  args?: DecodedArgument[];
  rawEventId?: string;
}

interface TransactionEntity {
  kind: "transaction";
  hash: string;
  from: string;
  to: string | null;
  status: "pending" | "included" | "failed";
  blockHash?: string;
  // 追跡中のコントラクト宛てで、入力データを観測できた場合のみ（pending を
  // 経ずに取り込みだけを観測した tx では省略されることがある。その場合も
  // フロントは to と ContractEntity.address の照合で「コントラクト宛て」の
  // 判定はできる）
  contractCall?: ContractCall;
  // この tx がコントラクトを新規作成（デプロイ）した場合の作成先アドレス
  createdContractAddress?: string;
  // 取り込み確定後（included / failed）にのみ入る
  contractEvents?: ContractEvent[];
}

// チェーン上にデプロイされたスマートコントラクト。特定の 1 ノードの中で
// 動くものではなく「チェーンに複製され、全ノードが同じ実行をするプログラム」
// であり、WalletEntity と同じくチェーン側の状態なので、ノード・ワークベンチの
// 削除とは無関係に、一度現れたら削除しない
interface ContractEntity {
  kind: "contract";
  address: string;
  chainType: ChainType;
  name?: string; // カタログで特定できた場合の表示名。無ければ「未知のコントラクト」
  catalogKey?: string; // チェーンプロファイルのコントラクトカタログ上のキー
  deployerAddress?: string; // デプロイを観測できた場合のみ
  createdByTxHash?: string; // デプロイを観測できた場合のみ
  token?: { symbol: string; decimals: number }; // トークンコントラクトの表示メタ情報
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
  | { type: "operationObserved"; edge: OperationEdge }
  | { type: "nodeLinkActivity"; activity: NodeLinkActivity };
```

エンティティ削除時の扱いは CONCEPT.md の決定に従う: `NodeEntity` /
`WorkbenchEntity` は `entityRemoved` で消えるが、`WalletEntity` /
`ContractEntity` はチェーン側の状態なので削除しない（ウォレットは
`ownerWorkbenchId` を `null` に更新する `entityUpdated` を送る。
コントラクトは一度現れたら以後そのまま残る）。

コントラクト関連の観測（新 Phase 4 / C層 拡張）は既存のイベント型に乗せ、
新しい DiffEvent 種別は追加しない:

- コントラクトのデプロイ検知・名前の判明は `ContractEntity` の
  `entityAdded` / `entityUpdated` として流れる（スナップショットにも含まれる）
- 関数呼び出し・イベントログの復号結果は `TransactionEntity` のフィールド
  （`contractCall` / `createdContractAddress` / `contractEvents`）として、
  tx の `entityAdded` / `entityUpdated` に同乗する。フロントは既存の
  tx 状態遷移検知（pending → included/failed）を使って「呼び出しが確定した
  瞬間」「イベントが発生した瞬間」のアニメーションを駆動できるため、
  operationObserved のような揮発性イベントの新設は不要と判断した

エッジ系イベントは性質の違いで 2 系統に分かれる:

- `edgeAdded` / `edgeRemoved` — 永続的なピア接続（`PeerEdge`）の状態遷移。
  store の状態（スナップショットの `edges`）に畳み込まれる
- `operationObserved` — ワークベンチ → ノードの呼び出し（`OperationEdge`）の
  1 回きりの観測イベント（揮発性）。store の状態には畳み込まれず、
  スナップショットにも現れない。対応する削除イベントも存在せず、フロントは
  受信時にエッジ＋パルスのアニメーションとして消費し、自身のタイミングで
  消す（CONCEPT.md「操作がエッジになる」参照）。`OperationEdge.operation` の
  値はチェーン依存の生の文字列であり、その解釈・表示はフロントの
  チェーンプロファイル表現セットの責務とする。
  フロント側の実装は差分適用（`world-state/store.ts` の `applyDiff`）から
  `operationObserved` を分離し（`extractOperations`）、通し番号を付けて
  `useWorldState` の `operations` として別経路へ流す。`entities/useOperationPulses`
  が未処理の観測ごとに一時的な操作エッジ（`OperationFlowEdge`）を生成し、
  `OPERATION_PULSE_DURATION_MS` 経過後にエッジごと消す（パルスが流れている間
  だけ存在する揮発性のエッジ）。端点のワークベンチ／ノードがキャンバス上に
  無い観測は無視する。色は B層のピア接続・C層の所有エッジと混同しないよう
  別系統のマゼンタ（`--op-edge`）にする
- `nodeLinkActivity` — 駆動リンク（`NodeEntity.drivesNodeId`）上の内部 API
  呼び出しの観測イベント（揮発性。D層）。operationObserved と同じく store の
  状態には畳み込まれず、スナップショットにも現れず、`broadcastDiff` 経由で
  passthrough 配信のみ行う。operationObserved との違いは粒度で、こちらは
  「観測間隔（メトリクスのスクレイプ周期）内の増分」として届く（Prometheus
  カウンタからは個々の呼び出しを復元できないため）。フロントは受信時に
  内部リンクエッジ上のパルスとして消費する（§7）

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
  | { action: "removeWorkbench"; workbenchId: string }
  | {
      action: "runWorkbenchOperation";
      workbenchId: string;
      operation: WorkbenchOperation;
    };

// ワークベンチ上で実行する定型操作（新 Phase 4）。amount はチェーン最小単位
// （Ethereum なら wei）の 10 進文字列
type WorkbenchOperation =
  | { type: "transfer"; to: string; amount: string } // ネイティブ通貨の送金
  | {
      type: "deployContract"; // カタログ掲載コントラクトのデプロイ
      contractKey: string;
      constructorArgs?: string[]; // コンストラクタ引数（省略時は引数なし）。
      // callContract.args と同様に文字列で受け渡す
    }
  | {
      type: "callContract"; // デプロイ済みコントラクトの関数呼び出し
      contractAddress: string;
      functionName: string;
      args: string[]; // 型解釈（数値・アドレス等）はカタログを持つアダプタ側が行う
      amount?: string; // 省略時は 0
    };
```

`runWorkbenchOperation` は collector が対象ワークベンチコンテナ内の開発ツール
（Ethereum プロファイルなら Foundry の `cast` / `forge`）を `docker exec` 相当で
実行する方式とする。ワークベンチ内のツールは `ETH_RPC_URL`（ロギングプロキシ）
経由でノードを叩くため、この操作の RPC 呼び出しは既存の観測経路
（操作エッジ `operationObserved`・tx ライフサイクル）に**特別な配線なしで**
そのまま乗る。「操作は必ずワークベンチという実体から発する」という CONCEPT.md
の投影の考え方を GUI 操作でも崩さないための設計判断。コマンドの実行結果
（成功・失敗）は既存の `commandResult` で返し、実際の反映（tx の出現、
コントラクトカードの出現）は後続の観測 = `diff` で届く。

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
  // C層: コントラクトのデプロイ検知・内容更新。コントラクトという概念を
  // 持たないチェーン（Bitcoin 等）のアダプタは実装しなくてよい（省略可）
  subscribeContracts?(onContract: (contract: ContractEntity) => void): Promise<void>;
  // D層: ノード内部の観測（内部状態の更新と駆動リンク上の呼び出し活動）。
  // ノード内部という階層を持たないチェーンのアダプタは実装しなくてよい
  // （省略可。CONCEPT.md「非 EVM チェーンでは D層は無いものとして扱う」）
  subscribeNodeInternals?(handlers: {
    onInternals: (nodeId: string, internals: NodeInternals) => void;
    onLinkActivity: (activity: NodeLinkActivity) => void;
  }): Promise<void>;
}
```

当初は C/D 層の入口として層をまたぐ汎用の
`subscribeChainEvents(onEvent: (e: DiffEvent) => void)` を置いていたが、
実装では層ごとに関心を分けるため**層ごとの型付きコールバック**へ発展させた。
型もそれに合わせ、未使用となった汎用口は削除している（先回り実装をしない）:

- `subscribePeers` — B層。ピア接続を周期ポーリングし、`PeerEdge[]` を渡す。
  Ethereum プロファイルは物理的に別物である 2 つの P2P ネットワークを
  それぞれ観測する（Issue #106）:
  - **CL（libp2p）**: 各 beacon ノードの Beacon API
    （`/eth/v1/node/identity` と `/eth/v1/node/peers`）から自ノードの
    peer_id と接続相手の peer_id 一覧を取り、エッジの端点は beacon
    コンテナの stableId、`networkId` は `<project>-consensus` とする
  - **EL（devp2p）**: 各 Execution ノードの HTTP JSON-RPC
    （`admin_nodeInfo` と `admin_peers`）から自ノードと接続相手の識別子を
    取り、エッジの端点は Execution コンテナ自身の stableId、`networkId` は
    `<project>-execution` とする。識別子は enode URL から抽出した公開鍵
    （小文字 16 進・0x なし）へ正規化して突き合わせる

  どちらも「各ノードが自己申告した P2P 識別子 → stableId」の対応表を作り、
  解決できた相手とのエッジだけを残す（観測対象外ノードとの接続は落とす）。
  CL/EL で `networkId` を分けるのは、実体として別ネットワークである事実を
  フロントの色分け・グルーピング（`networkId` 単位）にそのまま映すため。
  エッジの同一性キーは from/to/networkId の 3 つ組なので、CL/EL のエッジは
  端点が違う（beacon カード間 / Execution カード間）ことと合わせて衝突しない。
  ブロック伝播パルスは `BlockEntity.receivedAt` のキーと両端点が一致する
  エッジ上に乗る。`receivedAt` には同じ `newHeads` 受信 1 回を「対応する
  beacon の stableId」と「Execution ノード自身の stableId」の 2 キー・同一
  時刻で記録するため（Issue #141）、CL エッジ・EL エッジの両方にパルスが
  走る。CL エッジの端点は beacon の stableId だけ、EL エッジの端点は
  Execution の stableId だけなので、ネットワーク種別ごとの分離はフロント側の
  端点照合（`computeBlockPulses` の既存ロジック）だけで成立し、networkId に
  よるフィルタは不要。
- `subscribeBlocks` — B層。各 Execution ノードの `eth_subscribe(newHeads)` を
  購読し、ブロック受信時刻を束ねて渡す。CL 側のブロック購読は行っておらず、
  受信時刻の唯一のソースは EL の `newHeads`。受信 1 回を `receivedAt` の
  2 キー（対応する beacon / Execution 自身。beacon が見つからなければ
  Execution 自身のみ）へ同一時刻で記録する（Issue #141）。beacon キーの
  時刻は「同じ論理ノードの EL が受信した時刻」のエイリアスであり、CL の
  実受信時刻ではない（CL 実測は本 Issue の範囲外）。
- `subscribeTransactions` — C層。`newPendingTransactions`（pending 検知）と
  `newHeads`（ブロック取り込み検知）を購読し、状態変化した tx を渡す。
  ブロック取り込みの検知では `eth_getBlockReceipts` を 1 ブロックにつき
  1 回だけ呼び、ブロック内 tx 一覧（hash/from/to）と各 tx の実行結果
  （receipt の status）を同時に得る。status が失敗（`0x0`）の tx は
  `failed`、それ以外は `included` へ正規化する。tx ごとに
  `eth_getTransactionReceipt` を呼ぶ方式は採らず、RPC 呼び出し回数は
  failed 判定の導入前（`eth_getBlockByHash` 1 回）から増えない
  （Issue #86）。

- `subscribeContracts` — C層（新 Phase 4）。コントラクトのデプロイ検知と
  内容更新（カタログ照合による名前の判明等）を購読する。Ethereum プロファイル
  では追加の購読・ポーリングを設けず、`subscribeTransactions` が既に
  ブロックごとに 1 回呼んでいる `eth_getBlockReceipts` の正規化を拡張して
  実現する（receipt の `contractAddress` でデプロイを、`logs` でイベントを
  得る。**ブロックあたりの RPC 回数は増やさない**。Issue #86 の方針を維持）:
  - receipt の `contractAddress` が非 null の tx をコントラクト作成として
    検知し、`ContractEntity` を生成・追跡する（`deployerAddress` = from、
    `createdByTxHash` = tx ハッシュ）。カタログとの照合で `name` /
    `catalogKey` / `token` を埋める
  - `deployContract` コマンド経由のデプロイは、コマンド処理側が
    「アドレス → カタログキー」をアダプタの追跡レジストリへ登録するため
    確実に照合できる。手動デプロイ（ユーザーが直接 `forge create` した場合）
    は未知のコントラクトとして表示される（デプロイ済みバイトコードとの
    照合による特定は実装時のオプション。必須にしない）
  - 関数呼び出しの復号（`TransactionEntity.contractCall`）は、pending 検知時に
    既に呼んでいる `eth_getTransactionByHash` の正規化へ `input` を加え、
    宛先が追跡中のコントラクトならカタログの ABI で復号する（viem の
    `decodeFunctionData`。viem は既存依存）。イベントログの復号
    （`contractEvents`）は receipt の `logs` をカタログの ABI で復号する
    （`decodeEventLog`）。復号できないものは raw 識別子だけを載せる
  - 制約: pending を経ずに取り込みだけを観測した tx は入力データを取得
    しないため `contractCall`（関数名）が付かないことがある。フロントは
    `to` と `ContractEntity.address` の照合でコントラクト宛て表示に
    フォールバックする

- `subscribeNodeInternals` — D層（Phase 5）。各ノードの内部メトリクスを周期
  ポーリングし、`NodeInternals`（対象ノードへのパッチとして store が反映）と
  `NodeLinkActivity`（揮発性。passthrough 配信）を渡す。Ethereum プロファイル
  の観測方法・設計判断は §7 参照

いずれも `BlockEntity` / `TransactionEntity` / `ContractEntity` を返し、
ワールドステートへの反映（差分計算・エンティティ更新）は store 側が担う。
チェーン固有の RPC メソッド名・ABI はアダプタ配下に閉じ込め、これらの
コールバックにはチェーン非依存の型だけを流す。

### コントラクトカタログ（新 Phase 4）

チェーンプロファイルに同梱するサンプルコントラクトと、その表示名・
インターフェース定義（EVM なら ABI）を持つデータファイル。
「データとコードの分離」（CLAUDE.md）に従い、コードはこれを読むだけにする。

```
profiles/ethereum/contracts/
  foundry.toml
  src/
    ChainvizToken.sol   # 最小の ERC20（外部依存なしの自己完結実装）
    Counter.sol         # 最小のカウンタ（もっとも単純な学習用コントラクト）
  catalog.json          # カタログキー → { 表示名, ABI, token メタ情報(symbol/decimals) }
  build-catalog.sh      # forge build の成果物から catalog.json を再生成する開発用スクリプト
```

- ソース（`src/`）と `catalog.json` は両方コミットする。`catalog.json` は
  ビルド成果物由来だが、ソースを変更したときだけ `build-catalog.sh` で
  再生成するデータファイルとして扱う（genesis のような実行時生成にしない。
  ABI はコンパイル時刻に依存せず決定的なため、コミットして差分レビュー
  できる方が安全）
- `contracts/` はワークベンチコンテナへ bind mount し、`deployContract` は
  ワークベンチ内の `forge create`（ソースからのコンパイル・デプロイ）で行う
- collector は `catalog.json` を既存の profileDir 解決
  （`CHAINVIZ_ETHEREUM_PROFILE_DIR` / 相対パス既定。`values.env` の mnemonic
  読み込みと同じ仕組み）で読む。カタログが無い・読めない場合はコントラクト
  復号を無効にして起動を継続する（ウォレット追跡の mnemonic 欠落時と同じ
  「機能単位の縮退」。エラーはログに残す）
- 環境起動時の自動デプロイは行わない。デプロイはユーザー操作
  （`runWorkbenchOperation` の `deployContract`、または手動の `forge create`）
  で行い、「デプロイという行為そのもの」を可視化の対象にする
- ウォレットのトークン残高（`WalletEntity.tokenBalances`）は、WalletTracker が
  追跡中のトークンコントラクト（カタログ掲載かつデプロイ済みのもの）に対して
  残高照会（EVM では `balanceOf` の `eth_call`）を既存の残高・nonce ポーリングと
  同じ周期で行って得る。トークンが 1 つもデプロイされていなければ何もしない

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

## 6. Phase 4（C層拡張）の UX 設計

`docs/PLAN.md` ステップ8の UX 項目（コントラクトカード・定型操作・イベント
ログ表示の UX 設計）の成果物。frontend 担当はこの節をそのまま着手指示として
使える。設計にあたっては frontend をモックデータで起動し（Playwright での
操作・スクリーンショット確認）、既存 UI の流儀（カードの構成・ポップ
オーバー・GlossaryTerm アンカー・仮カード・新着発光・エッジの色体系）を
実際に確認した。文言（i18n）は初稿であり、実装時に語調を揃える微調整は
frontend の裁量でよい（構成・意味を変える変更は不可）。

### 6.1 何が伝わっていないか（設計の動機）

Phase 3 までの画面を実際に操作して確認した課題:

1. **コントラクトという存在が画面に一切ない**。tx はウォレットカード上の
   hash チップでしか見えず、素の送金なのかコントラクト呼び出しなのか
   区別できない。「どこでスマコンが動いているのか」に答える要素がゼロ
2. **操作の起点が GUI にない**。tx を起こすにはワークベンチコンテナ内で
   cast を手で叩くしかなく、「支払いのような一般的な操作」を体験できない。
   ワークベンチカードは観測結果の表示のみで「操作できる場所」に見えない
3. **tx の中身（何をしたか）がどこにも出ない**。WalletPopover の tx 一覧も
   hash + status のみ
4. 初学者の「スマートコントラクトはどこかのサーバーで動いている」という
   誤解を防ぐ手がかりが（作る前から）必要（CONCEPT.md の決定事項）

### 6.2 キャンバスの情報構造: 「チェーン側の状態」の帯にコントラクト行を足す

現状のキャンバスは上段 = インフラ行（ノード・ワークベンチ、`DEFAULT_GRID`
originY=0）、下段 = ウォレット行（`WALLET_GRID` originY=520）という
「観測対象のマシン／チェーン側の状態」の帯構造になっている。コントラクトは
ウォレットと同じ「チェーン側の状態」（削除されない・コンテナの持ち物では
ない）なので、この帯構造を保ってウォレット行のさらに一段下に
**コントラクト行**を新設する。

- `CONTRACT_GRID` = `DEFAULT_GRID` + originY（ウォレット行のカード実測高さと
  重ならない値。目安 1040。実装時に実測で確定してよい）
- 配置・新着の流儀は Issue #123 の配置ルールに従う: エンティティ初出時に
  空きスロットを確定して即 layout 保存（既存カードを動かさない）、
  到着から一定時間の新着発光（`infra-card--new` と同じ仕組み）を当てる
- レイアウト永続化のキーは `address`（ウォレットと同じ安定識別子）

### 6.3 コントラクトカード

カードの構成（上から。WalletCard と同型の構造）:

- **ヘッダ**: 種別ラベル「コントラクト」（GlossaryTerm: `contract`）＋
  「全ノードで実行」ピル（GlossaryTerm: `evm`。bootnode バッジと同型の
  見た目、コントラクト色）。**削除ボタンは置かない**（チェーン側の状態で
  削除できない。「削除できないものに削除 UI を出さない」Issue #103 の
  流儀と一貫）
- **名前**: `name`（例: ChainvizToken）。無ければ「未知のコントラクト」（6.4）
- **サブタイトル**: `shortHex(address)`。`token` があれば「· トークン
  {symbol}」を続ける（GlossaryTerm: `token`）
- **直近の呼び出し・イベント**: チップ列（6.6）

**「特定ノードではなく全ノードで実行される」の伝え方**は次の3経路で行う:

1. **常設ピル**（視覚）: ヘッダの「全ノードで実行」。ホバーで `evm` の
   用語解説がその場で出る
2. **ポップオーバー冒頭の説明文**（文言）: 「チェーンに複製され、全ノードが
   同じ実行をするプログラムです。特定のサーバーやノードの中では動いて
   いません」を、フィールド一覧より先に 1 行置く
3. **確定の瞬間の同期**（動き）: 呼び出し tx がブロックに取り込まれた瞬間、
   既存のブロック伝播発光で全ノードカードが光る。同じ確定検知でコントラクト
   カードにも確定フラッシュ（6.6）を当てるため、「コントラクトの実行」と
   「全ノードへのブロック到達」が同時の出来事として見える。新しい演出は
   作らず、タイミングの一致だけで見せる

**ノードへのエッジは張らない**。本アプリのエッジ（紐）は「実在する接続・
実在した呼び出し」（P2P ピア・所有・RPC 呼び出し）だけを表す語彙として
確立しており、コントラクト→ノードの恒久エッジはどの実在の通信にも対応
しない。全ノードへ薄いエッジを張る案は「特定ノード群と接続している」という
逆の誤解とノード増加時の線の氾濫を招くため採らない。

**ポップオーバー**（WalletPopover と同型。観測できなかったフィールドは
行ごと省略する既存の流儀に従う）:

| 行 | 内容 |
| --- | --- |
| （説明文） | 上記 2. の誤解防止文（muted 表示） |
| アドレス | `shortHex(address, 10, 6)` |
| デプロイした人 | `shortHex(deployerAddress)`（ラベルに GlossaryTerm: `deploy`） |
| 作成 tx | `shortHex(createdByTxHash)` |
| トークン | `{symbol} / decimals {decimals}`（`token` がある場合のみ） |

**デプロイエッジ（常設）**: `deployerAddress` に一致するウォレットカードが
キャンバス上に存在する場合のみ、ウォレット → コントラクトの細線を描く
（コントラクト色・低彩度。所有エッジのアンバー破線と混同しない見た目に
する）。ホバーで「{address} がデプロイしたコントラクト」のポップオーバー
（PeerEdgePopover と同型、GlossaryTerm: `deploy`）。ダングリング参照
ガード必須（一致するウォレットが無ければ描かない。手動デプロイや追跡外
アドレスからのデプロイはここで自然に落ちる）。

### 6.4 未知のコントラクトの差別化

カタログで特定できないコントラクト（`name` 省略）は「存在は確かだが中身を
解釈できない」ことを見た目で示す:

- カード枠を**破線ボーダー + muted 色**にし、ヘッダに「カタログ外」ピルを
  追加する（既知カードとひと目で区別できる）
- 名前は「未知のコントラクト」（i18n）。アドレスがサブタイトルに出るのは
  既知と同じ
- ポップオーバーの説明文を差し替える: 「chainviz のカタログに載っていない
  ため、関数やイベントの意味（ABI）を復号できません。存在と呼び出しの
  発生だけを表示します」（GlossaryTerm: `abi`）
- アクティビティチップは `rawFunctionId` / `rawEventId` の短縮表示（6.6）
- 「全ノードで実行」ピル・デプロイエッジ・確定フラッシュは既知と同様に
  出す（未知でも事実は同じであり、差別化は「解釈できるか」の一点に絞る）

### 6.5 定型操作（送金・デプロイ・コントラクト呼び出し）の UI フロー

操作は「必ずワークベンチという実体から発する」（§3 の設計判断）ため、
UI の起点もワークベンチカードに置く。ツールバー（環境全体の操作）ではなく
カード（個体への操作）に置くことで、「誰の操作か」が押す前から明確になる。

**起点**: ワークベンチカード下部に全幅ボタン「操作を実行…」（nodrag）。

- ホバー/フォーカスで予告（ActionHint と同型）: 「このワークベンチの中で
  開発ツール（cast / forge）を実行します。RPC 呼び出しは {rpcTarget} に
  送られ、通常の操作と同じように観測・表示されます」。`rpcTargetNodeId` を
  解決できない場合は generic 文言（既存 Issue #123 のフォールバック流儀）

**操作パネル**: ボタン押下でカード脇に開くインタラクティブなポップオーバー
（nodrag / nowheel。Esc・外側クリック・×で閉じる。見た目は infra-popover
系に揃える）。上部に3つの操作タブ:

1. **送金**（`WorkbenchOperation: transfer`）
   - 宛先: キャンバス上の既存ウォレットから選択（表示は `shortHex` ＋
     所有ワークベンチのラベル）。自由入力（アドレス直打ち）も可
   - 金額: **ETH 単位の 10 進入力**（例: `0.5`）。フロントが wei 文字列へ
     変換してコマンドを送る（プロトコルの `amount` は最小単位のまま）
   - 実行ボタン「送金する」。フォーム末尾に予告文: 「tx は mempool に入り、
     ブロックに取り込まれると確定します」（GlossaryTerm: `mempool`）
2. **デプロイ**（`deployContract`）
   - コントラクト選択: カタログ掲載分（表示名＋一言説明。例:
     ChainvizToken「最小の ERC20 トークン」/ Counter「一番単純な学習用
     コントラクト」）
   - 実行ボタン「デプロイする」。予告文: 「ソースからコンパイルした
     コントラクトを配置する tx が送られ、取り込まれるとコントラクト
     カードが現れます」（GlossaryTerm: `deploy`）
3. **コントラクト呼び出し**（`callContract`）
   - 対象: キャンバス上のデプロイ済み・**カタログ既知**のコントラクトのみ
     選択肢に出す（未知のコントラクトはインターフェース不明でフォームを
     作れないため GUI 対象外。cast を手で叩く道は塞がない）。既知の
     コントラクトが 1 つも無い間は、タブ内にその旨と「先にデプロイする」
     導線を出す
   - 関数: フォーム定義（後述）からの選択。引数は引数名をラベルにした
     テキスト入力（アドレス型の引数には既存ウォレットの候補を提示）。
     payable な関数のみ金額欄を出す。掲載するのは状態を変更する関数のみ
     （`view`/`pure` はフォーム定義に含めない。GUI の定型操作は
     `cast send`（tx 送信）が前提で、読み取り専用関数を送っても無駄な
     ガス消費になるだけで観測できる変化（tx 確定・イベント）を生まない
     ため。「残高を読む」ような読み取り専用 UI が必要になった場合は
     `cast call` 相当の別経路が要る。Issue #167 実装時の判断）
   - 実行ボタン「実行する」

**実行後の流れ**:

- パネルを閉じ、ワークベンチカードにスピナー＋「実行中…」を出す
  （ツールバーの pending 表現と同型。`commandResult` で解除。二重送信
  防止ではないので操作は引き続き可能）
- 失敗は既存トースト（`command.error.runWorkbenchOperation` ＋ collector の
  error 詳細）
- **デプロイのみ**、コントラクト行へ仮カード「デプロイ中… {表示名}」を
  置く（Issue #102 の仮カードの流儀）。`entityAdded`（contract）の
  `catalogKey` 一致で置換し、対応が取れないときは FIFO 近似。
  `commandResult` 失敗時は仮カードを消す
- 成功の可視化は**追加配線なし**で既存機構がそのまま見せる: 操作エッジ
  パルス（ロギングプロキシの実測）→ ウォレットの pending チップ → 確定
  フラッシュ → 残高/トークン残高の変化・コントラクトカードの出現。
  「GUI から押しても、cast を手で叩いたときと同じ観測が返ってくる」
  一貫性がこの設計の軸で、確認ダイアログは挟まない（Issue #123 と同じ
  判断。気軽に触れて、結果は観測で必ず見える）

**操作フォーム定義の置き場所**: カタログキー →（表示名・一言説明・関数
フォーム定義（関数名・引数名・入力種別・payable か））の静的データを、
フロントのチェーンプロファイル表現セット `packages/frontend/src/
chain-profiles/ethereum/`（§1 で予約済み。このとき新設）に置く。ABI その
ものではなく「UI フォームの組み立てに必要な最小情報」であり、チェーン固有
語彙の解釈をフロント表現セットが担う既存の責務分担（`OperationEdge.
operation` と同じ）に沿う。カタログ（`profiles/ethereum/contracts/
catalog.json`）との二重管理になる点は許容する（サンプルコントラクトは
学習用に安定しており更新頻度が低い。乖離が問題になったら build-catalog.sh
での生成に寄せる）。

### 6.6 コントラクト呼び出し・イベントログの可視化

- **ウォレットの tx チップのラベルを「意味」優先にする**。優先順:
  `contractCall.functionName`（例: `transfer()`）→ `createdContractAddress`
  があれば「デプロイ」→ `rawFunctionId` の短縮表示 → 従来どおり hash 短縮
  （素の送金・情報なし）。ステータス色・pending 明滅・確定フラッシュは
  従来のまま
- **WalletPopover の tx 一覧**に呼び出し内容を追記する: 関数名（引数の
  先頭 1〜2 個のプレビュー）＋ 宛先コントラクト名（未知なら短縮アドレス）
- **確定時のコントラクトへのパルス**: 既存の確定検知
  （`detectTxSettlements`）を流用し、確定した tx がコントラクト宛て
  （`contractCall.contractAddress`、無ければ `to` と `ContractEntity.
  address` の照合でフォールバック。§4 の制約に対応）またはデプロイ
  （`createdContractAddress`）の場合、from のウォレットカード →
  コントラクトカードへ**揮発パルスを1本**流す（`useOperationPulses` と
  同型の一時エッジ。色はコントラクト色。表示時間は操作パルスと同程度）。
  パルス完了のタイミングでコントラクトカードに**確定フラッシュ**（tx
  チップの is-settling と同系の演出。failed の tx は失敗色のフラッシュ）
  を当てる。ウォレットカードが無い（追跡外アドレスからの呼び出し）場合は
  パルスを省きフラッシュのみ、コントラクトカードが無ければ何もしない
  （ダングリングガード）
- **コントラクトカードのアクティビティチップ列**: ワールドステートの tx
  から `contractAddress` 照合で導出する（確定済みのみ・新しい順・上限は
  ウォレットの tx チップと同じ 6 件）。専用フィールドの追加は不要
  - **呼び出しチップ**: `functionName`（復号不能なら `rawFunctionId`
    短縮）。ホバーで引数一覧（`DecodedArgument` の `name: value` を
    1 行ずつ）
  - **イベントチップ**: `eventName`（復号不能なら `rawEventId` 短縮）。
    呼び出しチップと見分けられるスタイル（イベント側にプレフィックス
    記号を付ける等）。ホバーで引数一覧
  - 復号できていないチップのホバーには「カタログに定義が無いため復号
    できません（生の識別子）」を出す（GlossaryTerm: `abi`）
  - ラベルは「直近の呼び出し・イベント」（GlossaryTerm: `event-log`）。
    1 件も無ければ「まだ呼び出しがありません」

### 6.7 ウォレットのトークン残高

- WalletCard の残高行（`… ETH · nonce n`）の下に**トークン残高チップ列**を
  足す: `tokenBalances` の各件を `ContractEntity.token`（`contractAddress`
  で照合）の `decimals` でフォーマットし「{amount} {symbol}」で表示。
  ラベルは「トークン残高」（GlossaryTerm: `token`）
- 対応する `ContractEntity` が未観測の `tokenBalance` は表示しない
  （ダングリングガードの流儀。symbol 不明の生の数値を出して混乱させない）
- `tokenBalances` が省略・空・全件照合不能なら行ごと出さない（Phase 3 まで
  のカードの見た目を変えない）
- WalletPopover にも「トークン残高」行（コントラクト名＋残高）を足す
- `formatEther` は decimals 可変の `formatUnits` へ一般化して共用する
- 残高変化の専用演出は付けない（ETH 残高の変化にも無く、一貫させる。
  transfer の因果は tx チップ・確定フラッシュ側が示す）

### 6.8 新設する i18n 文言（初稿）

| キー | ja | en |
| --- | --- | --- |
| `card.contract` | コントラクト | Contract |
| `contract.unknown` | 未知のコントラクト | Unknown contract |
| `contract.badge.everyNode` | 全ノードで実行 | Runs on every node |
| `contract.badge.uncataloged` | カタログ外 | Not in catalog |
| `contract.popover.description` | チェーンに複製され、全ノードが同じ実行をするプログラムです。特定のサーバーやノードの中では動いていません | A program replicated on the chain; every node runs the same execution. It does not live on any single server or node. |
| `contract.popover.unknownDescription` | chainviz のカタログに載っていないため、関数やイベントの意味（ABI）を復号できません。存在と呼び出しの発生だけを表示します | Not in the chainviz catalog, so function and event meanings (ABI) cannot be decoded. Only its existence and incoming calls are shown. |
| `field.deployer` | デプロイした人 | Deployed by |
| `field.createdByTx` | 作成 tx | Created by tx |
| `field.token` | トークン | Token |
| `field.tokenBalances` | トークン残高 | Token balances |
| `contract.activity` | 直近の呼び出し・イベント | Recent calls & events |
| `contract.noActivity` | まだ呼び出しがありません | No calls yet |
| `contract.chip.undecoded` | カタログに定義が無いため復号できません（生の識別子） | Not in the catalog, so it cannot be decoded (raw identifier). |
| `tx.chip.deploy` | デプロイ | Deploy |
| `edge.deployedBy` | {address} がデプロイしたコントラクト | Contract deployed by {address} |
| `action.workbenchOperations` | 操作を実行… | Run operation… |
| `action.workbenchOperations.hint` | このワークベンチの中で開発ツール（cast / forge）を実行します。RPC 呼び出しは {rpcTarget} に送られ、通常の操作と同じように観測・表示されます | Runs developer tools (cast / forge) inside this workbench. Its RPC calls go to {rpcTarget} and are observed and displayed like any other operation. |
| `action.workbenchOperations.hint.generic` | このワークベンチの中で開発ツール（cast / forge）を実行します。RPC 呼び出しは通常の操作と同じように観測・表示されます | Runs developer tools (cast / forge) inside this workbench. Its RPC calls are observed and displayed like any other operation. |
| `operation.tab.transfer` | 送金 | Transfer |
| `operation.tab.deploy` | デプロイ | Deploy |
| `operation.tab.call` | コントラクト呼び出し | Call contract |
| `operation.transfer.to` | 宛先 | To |
| `operation.transfer.amount` | 金額（ETH） | Amount (ETH) |
| `operation.transfer.submit` | 送金する | Send |
| `operation.transfer.note` | tx は mempool に入り、ブロックに取り込まれると確定します | The tx enters the mempool and becomes final once included in a block. |
| `operation.deploy.contract` | コントラクト | Contract |
| `operation.deploy.submit` | デプロイする | Deploy |
| `operation.deploy.note` | ソースからコンパイルしたコントラクトを配置する tx が送られ、取り込まれるとコントラクトカードがキャンバス下段（ウォレットの下の段）に現れます | Sends a tx that places the compiled contract on chain; once included, a contract card appears in the bottom row of the canvas (below the wallets). |
| `operation.call.target` | 対象コントラクト | Target contract |
| `operation.call.function` | 関数 | Function |
| `operation.call.amount` | 送金額（ETH、任意） | Amount (ETH, optional) |
| `operation.call.submit` | 実行する | Call |
| `operation.call.empty` | 呼び出せるコントラクトがまだありません。先に「デプロイ」タブからデプロイしてください | No callable contracts yet. Deploy one from the Deploy tab first. |
| `operation.pending` | 実行中… | Running… |
| `ghost.contract.deploying` | デプロイ中… {name} | Deploying… {name} |

（カタログ掲載コントラクトの表示名・一言説明はチェーンプロファイル表現
セット側のデータが持ち、`messages.ts` には入れない）

### 6.9 用語解説（C層拡張）の方針

定義文は既存 `glossary/ethereum/terms/c-transaction.yaml` と同じ3拍子
「定義 → **なぜ必要か** → chainviz ではどう見えるか」で書く（ユーザー要望
「なぜ必要なのかを伝えられるように」への直接の回答をここに置く）。
アンカー（UI 上の登場箇所）が無い用語は存在しないのと同じ（Issue #124 の
教訓）なので、追加する全用語に必ずアンカーを対応させる:

| termKey | 主なアンカー | 定義に必ず含めるポイント |
| --- | --- | --- |
| `contract` | コントラクトカードの種別ラベル | チェーン上に置かれたプログラム。**特定のサーバーではなく全ノードが同じ実行をする**ことで、特定の誰かを信頼せずにルール（支払い条件・トークンの台帳など）を自動執行できる。それがなぜ必要か（仲介者なしの約束事） |
| `deploy` | 操作パネルのデプロイタブ・ポップオーバーの「デプロイした人」・デプロイエッジ | プログラムをチェーン上に配置する tx。一度配置すると誰でも呼び出せる。関連サービス TIPS に Foundry / Hardhat（CONCEPT.md の決定済み方針） |
| `abi` | 未知コントラクトの説明文・未復号チップのホバー | チェーン上にあるのはバイト列だけで、関数名・引数名は載っていない。ABI はその呼び出し口の形の定義で、バイト列と人が読める名前の橋渡し。chainviz はカタログの ABI で復号している（だから**カタログに無いと「未知」になる**） |
| `event-log` | コントラクトカードの「直近の呼び出し・イベント」ラベル | コントラクトが実行中に書き残す記録。状態を直接読むより安価に「何が起きたか」を外部へ知らせる仕組みで、アプリがチェーンの変化を追う主要な手段 |
| `evm` | 「全ノードで実行」ピル | 全ノードが搭載する同一の仮想計算機。同じ tx を同じ順で実行すれば必ず同じ結果になることが、全ノードの状態が一致する（＝コントラクトがどこか 1 か所で動いているのではない）ことの根拠 |
| `token` | トークン残高ラベル・コントラクトカードのトークン表示 | コントラクトが管理する残高台帳。ETH と違いプロトコル本体の通貨ではなく、コントラクト内の帳簿。ERC20 という共通の呼び出し口のおかげで、どのウォレット・アプリからも同じ方法で扱える |

### 6.10 決定事項（統括確認済み）

以下4点はいずれも本文中の推奨案を採用として確定した(2026-07-07)。
理由はいずれも各項目の本文(6.3/6.5)に記載済みのとおり。

1. **「全ノードで実行」の表現**: ピル＋文言＋確定タイミングの同期（6.3）。
   コントラクトから全ノードへ薄いエッジを張る案は不採用（「エッジ＝
   実在の接続・呼び出し」という既存の視覚語彙を崩さないため）
2. **操作フォーム定義の置き場所**: フロント表現セットの静的データ
   （6.5）。collector がカタログ由来のフォームスキーマをプロトコルで
   配る案は不採用（shared 型変更・ChainAdapter 境界の見直しが不要な
   軽量な方を選んだ）
3. **金額の入力単位**: ETH 単位入力＋フロントで wei 変換
4. **操作パネルの形**: ワークベンチカード脇のポップオーバー

### 6.11 tx ライフサイクル表示（Issue #212 単位D）

- **背景**: `TransactionEntity.status` は `pending` / `included` / `failed`
  の3値（実質1段階）で、「署名中か」「どういう状態か」を区別できない。
  ただし署名・送信は collector が観測できないリアルタイム状態（collector
  が tx を検知できるのは mempool 投入後のみ）なので、`status` に段階を
  増やす（shared 型変更）のではなく、**既存 status から「経てきたはずの
  段階」を導出して見せる**。観測していない状態をあたかも観測したかの
  ように表示しない
- **4段階の導出**（`packages/frontend/src/entities/txLifecycle.ts` の
  `deriveTxLifecycle`）: 署名(signed) → 送信(sent) → mempool → ブロック
  取り込み(included)。`status` ごとの対応:
  - `pending`: 署名・送信は完了(`done`)、mempool は進行中(`active`)、
    ブロック取り込みは未到達(`pending`)
  - `included`: 全段階 `done`
  - `failed`: 署名・送信・mempool通過までは `done`、ブロック取り込みの
    段階のみ `failed`（tx 自体はブロックに取り込まれた上で実行が失敗
    として記録されているため、「取り込みに失敗した」のではなく「実行が
    失敗として記録された」という意味。一言説明の文言で区別する）
- **UI**: tx チップ（WalletCard）・tx 一覧行（WalletPopover）のホバーに
  共通の `TxLifecyclePopover` を出す。ヘッダ（`shortHex(hash)` + 既存の
  ステータスバッジ）+ 4段階の縦リスト（マーク ✓/●/✕ + `GlossaryTerm`
  付きラベル + 一言説明）。既存の `title` 属性（hash のみのネイティブ
  ツールチップ）はこのポップオーバーに置き換える
- **各段階のラベル・説明**（`tx.lifecycle.*`）:

  | 段階 | ラベル（GlossaryTerm） | 一言説明 |
  | --- | --- | --- |
  | 1 | 署名（`signature` 新設） | ワークベンチの中で秘密鍵により署名済み。この時点ではまだチェーンに触れていない |
  | 2 | 送信（`rpc-endpoint`。Issue #212 実装当初は未新設のため `workbench` に暫定フォールバックしていたが、Issue #215 で `rpc-endpoint` が新設されたため差し替え済み） | 署名済み tx が操作先ノードへ送られた |
  | 3 | mempool（`mempool`） | ノードが署名・nonce・残高を検査し、取り込み待ちの列に入れる |
  | 4 | ブロック取り込み（`block` 新設） | ブロックに取り込まれ、全ノードに複製されて確定した（failed 時は「実行が失敗として記録された」に差し替え） |

  段階1・2が常に完了扱いなのは「chainviz に tx が見えている時点で署名・
  送信は済んでいる」という観測事実に基づく。段階3の説明文が「バリデー
  ション」（署名・nonce・残高チェック）の説明を兼ねる（独立した状態
  としては見せない）
- **glossary 追加**（`glossary/ethereum/terms/c-transaction.yaml`）:
  `signature`（署名。関連: transaction, eoa, workbench）・`block`
  （ブロック。関連: transaction, mempool, gossip）。`block` はノード
  ポップオーバーの「ブロック高」ラベルにもアンカーを追加する
- **見送った範囲**（別 Issue の対象）: 「チェーンの繋がり方」の可視化
  そのもの（最新ブロックの帯・ブロックカードなど）と、コントラクト
  内部状態（Counter の現在値など。`eth_call` の collector 対応が必要）
  はこの Issue のスコープ外

## 7. Phase 5（D層: ノード内部）の設計

CONCEPT.md「D層: ノード内部（発展）」の実装設計。可視化するのは
①CL→EL の Engine API のやり取り（内部リンク）、②reth のステージ型同期の
進行状況、③txpool の内部状態、の 3 点。スキーマは §2 の
`NodeEntity.drivesNodeId` / `NodeEntity.internals` / `NodeLinkActivity`、
購読口は §4 の `subscribeNodeInternals`。

### 7.1 前提と決定事項

- **EL/CL 構成は既に満たしている**。CONCEPT.md ロードマップの「EL/CL 構成に
  して」は、Phase 2 以降の `profiles/ethereum/`（reth + lighthouse、Engine API
  ポート 8551 + JWT）で既に実現済み。Phase 5 で構成自体の変更は不要
- **Kurtosis へは移行しない**（決定）。CONCEPT.md の「Kurtosis 検討」は
  セットアップの手間の削減が目的だったが、compose 構成は既に安定稼働して
  おり、移行すると addNode/removeNode（managed ラベル・compose プロジェクト
  前提のライフサイクル）、genesis の自動再生成（Issue #148）、ハートビート、
  E2E テストの前提がすべて壊れる。得られる利益（セットアップ簡略化）は
  既に不要になっているため、失うものだけが残る
- **データ源は Prometheus メトリクスのみ**（決定）。CONCEPT.md は「メトリクス、
  構造化ログ」を挙げているが、Phase 5 のスコープ（上記 3 点）はすべて reth の
  メトリクスで観測でき、ログのテール・パースは購読管理／再接続／フォーマット
  追従のコストが大きい。構造化ログは将来「呼び出し 1 回ごとの離散イベントが
  必要になった場合」の拡張手段として残す
- **Engine API は EL（reth）側 = 受け手のメトリクスで観測する**（決定）。
  呼び出しは CL→EL であり、受け手のカウンタでも呼び出しの事実・回数は同じ
  ものが観測できる。lighthouse 側のメトリクス有効化は現スコープでは不要
  （先回りしない）

### 7.2 観測方法（Ethereum プロファイル）

- **node-env**: `reth-node.sh` の共通起動オプションに
  `--metrics 0.0.0.0:9001` を追加する。compose 起動ノードと addNode の動的
  追加ノードは同じスクリプトを bind mount して使うため、1 箇所の変更で両方に
  効く。ポートはホストへ公開しない（collector は Beacon API 5052 と同じく
  コンテナ IP へ直接到達する）
- **collector（EthereumAdapter）**: 各 Execution ノードの
  `http://<ip>:9001/metrics` を周期ポーリングし、Prometheus テキスト形式を
  パースする。対象の列挙は `targets.ts` の既存パターン（Docker 観測から導出）
  に従う。関心のあるメトリクス（下記）以外は読み捨て、**期待するメトリクスが
  無い場合はフィールドを省略して継続する**（reth のイメージは `:latest` で
  名前が変わりうるため、欠落で落ちない縮退動作にする）
  - Engine API 呼び出し: `engine_newPayload*` / `engine_forkchoiceUpdated*`
    系のカウンタ。前回スクレイプとの**増分**を `NodeLinkActivity.calls` に
    載せる（バージョン付きメソッド名 `engine_newPayloadV4` 等は生の値の
    まま載せ、まとめ方はフロントの表現セットが決める）。所要時間メトリクスが
    取れる場合のみ `latencyMs` を付ける
  - 同期ステージ: ステージ別チェックポイント（`reth_sync_checkpoint`
    {stage=...} 系）を `NodeInternals.syncStages` へ
  - txpool: pending / queued 件数のゲージ（`reth_transaction_pool_*` 系)を
    `NodeInternals.mempool` へ。メトリクスに無ければ既に有効化済みの
    `txpool_status` RPC へのフォールバックを検討してよい
  - **正確なメトリクス名は実装時に実環境の `/metrics` 出力で確定する**
    （上記は候補。設計段階では確定させない）。また「reth の
    `reth_sync_checkpoint` が追従運転中（Engine API 駆動）にも進むか、
    パイプライン同期（addNode 後のバックフィル）時のみ進むか」を実測で
    確認し、7.3 の syncStatus/blockHeight の情報源の最終判断に使うこと
- **カウンタのリセット**: ノード再起動でカウンタは 0 に戻る。前回値より
  小さい場合はリセットとみなし、増分 = 現在値として扱う（負の増分を配信
  しない）
- **スクレイプ間隔**: 3 秒（既存 `PEER_POLL_INTERVAL_MS` と同値の別定数）。
  この値はチェーンの進行状態に依存しないサンプリング周期であり、slot time
  2 秒の環境では毎スクレイプ 1〜2 件の増分が得られ「CL が EL を slot ごとに
  駆動し続けている」ことが連続的なパルスとして見える、という前提で選ぶ
  （前提条件はコードコメントと worklog に明記する）

#### 7.2.1 実装時に確定したメトリクス名（Issue #185）

上記の候補名を実機の `/metrics` 出力（`docker compose up` した
`profiles/ethereum` へ実際に `curl` して確認。詳細は
`docs/worklog/issue-185.md`）で確定させた結果。

- **同期ステージ**: `reth_sync_checkpoint{stage="..."}`（候補どおり）。ただし
  **このサンプルが `/metrics` レスポンス中に現れる順序はスクレイプのたびに
  変わる**ことを実機で確認した（reth 内部の HashMap 相当のイテレーション順と
  みられ、パイプラインの実行順ではない）。§7.6.5 の「`syncStages` の配列順 =
  パイプラインの実行順」という前提は、collector（`reth-metrics.ts`）が既知の
  順序（§7.6.7 の表）へ明示的に並べ替えたうえで返すことで成立させている
  （生テキストの出現順そのものには意味が無い）
  - 併せて確認した「追従運転中にも進むか」: 通常運転中（バックフィルではない）
    の reth でも `reth_sync_checkpoint`（特に `Finish`）が経過時間とともに
    進むことを確認した。§7.3 の `syncStatus`/`blockHeight` の情報源選定
    （Issue #187）にはこの実測結果を使ってよい
- **txpool**: `reth_transaction_pool_pending_pool_transactions` /
  `reth_transaction_pool_queued_pool_transactions`（gauge）
- **Engine API 呼び出し**: `engine_newPayload*` / `engine_forkchoiceUpdated*`
  という名前の直接のメトリクスは存在しない。代わりに
  `reth_engine_rpc_<method>_v<N>`（`summary` 型。`<name>_count` が呼び出し
  回数の累積値、`<name>_sum` が所要時間の累積合計秒）を使う。バージョン付き
  の実際の JSON-RPC メソッド名（例: `engine_newPayloadV4`）は、この
  summary の `# HELP` コメント文中にバッククォート付きで埋め込まれている
  ため、そこから抽出する（`reth_consensus_engine_beacon_new_payload_messages`
  のようなバージョン非区別の集計カウンタも存在するが、`reth_engine_rpc_*` と
  重複計上になるため使わない）

### 7.3 データフロー・store への反映

- `drivesNodeId` は **pollInfra（A層のポーリング）で毎回解決する**。既存の
  `beaconStableIdForExecution()`（reth→beacon の対応付け。compose サービス名
  のノード群キー + プロジェクトスコープ）を逆向きに使い、beacon エンティティ
  に対応する Execution ノードの id を設定する。対応が取れなければ省略
  （`rpcTargetNodeId` と同じ流儀）
- `NodeInternals` は store の新メソッド（例 `applyNodeInternals(nodeId,
  internals)`）で既存 NodeEntity への **`internals` フィールドのパッチ**として
  反映する。A層の `applyInfra` は `pollInfra` の出力に `internals` キーが
  含まれない限り既存値を上書きしない（`fieldPatch` は新エンティティに存在する
  キーだけを比較する）ため、両ループは衝突しない。対象ノードが store に
  無い観測は捨ててログに残す
- `NodeLinkActivity` は operationObserved と同じ扱い（store 反映なし・
  passthrough 配信・スナップショット非掲載）。beacon↔EL の対応が解決
  できない間は配信せず、その旨をログに残す（黙って握りつぶさない）
- **`NodeEntity.syncStatus` / `blockHeight` の更新**: 現状この 2 つは
  pollInfra が常に `"syncing"` / `0` を書くだけで一度も更新されない既知の
  ギャップがある（ポップオーバーに恒久的に「同期中・ブロック高 0」が出る）。
  D層で per-node の観測が入るのを機に埋める。ただし pollInfra が毎周期
  上書きするため、**情報源はアダプタ内のキャッシュとし、pollInfra が
  キャッシュから値を埋める**（書き手を applyInfra の 1 本に保つ）。値の
  導出元は「同期ステージのチェックポイント」か「newHeads の受信済み最新
  ブロック番号（BlockPropagationTracker が既に見ている）」のどちらが実態に
  即すかを 7.2 の実測結果で確定する
  - **実装時に確定（Issue #187）**: 情報源は `reth_sync_checkpoint{stage=
    "Finish"}`。実測でこの値が `eth_blockNumber` と一致し、既にIssue #185で
    パース済みで追加のRPC/購読が不要なため採用した（newHeads経路は「ノード
    単位の最大受信高さ」を問い合わせる状態を`BlockPropagationTracker`が
    持たず新規実装が必要だった）。`syncStatus`は「全ELノードの`Finish`
    checkpoint最大値との差が`SYNCED_TOLERANCE_BLOCKS`（既定5ブロック。
    並行スクレイプのタイミングずれによる一時的な差を実測した上での許容量。
    詳細は`docs/worklog/issue-187.md`）以内なら`"synced"`、それ以外は
    `"syncing"`と判定する。**CLノード（beacon）はD層メトリクスを持たない
    ため、この更新の対象外でsyncStatus/blockHeightは既存プレースホルダの
    ままという既知のギャップが残る**（EL側のギャップのみ解消）

### 7.4 フロントエンドの表現

- **レイヤー切り替えについて**: CONCEPT.md は「レイヤー切り替えで見る階層を
  変えられる」を挙げているが、現状のフロントに切り替え機構は存在せず、
  A〜C層は同一キャンバスに共存している（インフラ行・ウォレット行・
  コントラクト行の帯構造 + エッジ種別）。D層も**同じく共存**で設計する。
  データ・型はレイヤーの表示方法に依存しないため、表示の切り替え・フィルタを
  導入するかどうかは UX 設計（chainviz-ux）の判断に委ねる（スキーマへの
  影響は無い）
- **内部リンクエッジ（常設）**: `drivesNodeId` から導出して beacon カード →
  reth カード間に描く（`rpcTargetNodeId` → OperationTargetEdge と同じ
  「エンティティのフィールドから導出する」流儀。snapshot.edges には入れない）。
  ダングリングガード必須（相手ノードがキャンバスに無ければ描かない）。
  色は既存のエッジ体系（P2P・所有・操作・デプロイ）と混同しない別系統にする
- **活動パルス**: `nodeLinkActivity` 受信時に内部リンクエッジ上へパルスを
  流す（`useOperationPulses` と同型の分離経路。端点がキャンバスに無い観測は
  無視）。増分が複数メソッドあってもパルスは 1 回の観測につき 1 本で足りるか、
  メソッド別に見せるかは UX 判断
- **ノードカード / ポップオーバー**: EL ノードの詳細に「同期ステージ」
  （ステージ名と checkpoint の一覧）と「mempool の内訳」（pending / queued）を
  追加する。`internals` が省略されていれば行ごと出さない（既存の
  「観測できなかったフィールドは行ごと省略」の流儀）。ステージ名
  （"Headers" 等）の和訳・説明はチェーンプロファイル表現セット
  （`chain-profiles/ethereum/`）にマッピングを置く
- **用語解説**: `glossary/ethereum/terms/d-internal.yaml` を新設し、
  Engine API・EL/CL 分離・ステージ型同期・txpool（ノード内部視点）等を
  追加する。全用語に UI 上のアンカーを必ず対応させる（Issue #124 の教訓）

### 7.5 UX 設計（chainviz-ux）へ委ねる項目

型・データフローは上記で確定。以下は UX 設計で詰める（スキーマ変更を
伴わない範囲）:

1. 内部リンクエッジ・パルスの見た目（色・線種・パルスの粒度）と、
   「CL が EL を駆動している」「これは P2P ではなくノード内部の配管」を
   誤解なく伝える表現・文言
2. 同期ステージ・mempool 内訳の見せ方（カード常設かポップオーバーのみか、
   addNode 直後のバックフィル進行をどう目立たせるか）
3. D層の表示密度の制御（常時表示か、表示切り替え・フィルタを導入するか。
   導入する場合も A〜C層を含む一貫した仕組みとして設計する）
4. D層用語の定義文（既存の 3 拍子「定義 → なぜ必要か → chainviz では
   どう見えるか」）とアンカー配置

→ 4 項目とも §7.6 で設計済み。

### 7.6 Phase 5（D層）の UX 設計

§7.5 の委譲 4 項目の成果物。frontend 担当はこの節をそのまま着手指示として
使える。設計にあたっては frontend をモックデータで起動し（Playwright での
操作・スクリーンショット確認）、既存 UI の流儀（カード＝要約・ホバー＝詳細、
エッジの色体系、addNode 直後の「接続確立中…」遷移、ポップオーバー内の
GlossaryTerm アンカー）を実際に確認した。文言（i18n）は初稿であり、実装時に
語調を揃える微調整は frontend の裁量でよい（構成・意味を変える変更は不可）。

#### 7.6.1 何が伝わっていないか（設計の動機）

Phase 4 までの画面を実際に操作して確認した課題:

1. **CL と EL が「1つの論理ノード」であることが見えない**。lighthouse
   （beacon）カードと reth カードは互いに無関係な 2 枚のカードに見える。
   addNode で追加されるフォロワーも reth + beacon の 2 枚が同時に現れるのに、
   どれとどれが対なのかを示す要素がゼロ。The Merge 後の Ethereum の根幹
   （合意と実行の分離）が画面から読み取れない
2. **チェーンを「誰が動かしているか」の因果が見えない**。ブロック高が上がり
   伝播の光が流れるが、その起点（CL が slot ごとに Engine API で EL を駆動して
   いる往復）が見えない
3. **addNode 直後のフォロワーが「何をしているか」見えない**。詳細は
   「同期状態: 同期中 / ブロック高 0」のまま動かず（§7.3 の既知ギャップ）、
   実際に走っているステージ型同期（ヘッダ取得 → 実行 → …）の進行が全く
   見えない。「追いつく過程」は学習上の見せ場なのに、現状は静止画になっている
4. **mempool は用語解説にあるが実数がどこにも出ない**。C層の tx チップは
   ウォレット視点のみで、「このノードがいま何件抱えているか」（ノードごとに
   中身が違うローカルな待機列であること）を確かめる場所がない

#### 7.6.2 D層の見せ方の方針: 共存 + 「カードは要約・ホバーで詳細」を踏襲

- **A〜C層と同一キャンバスに共存させる**（§7.4 の設計どおり）。専用の詳細
  ビュー（クリックで開く別パネル等）は作らない。既存 UI は「カード面 =
  いま注目すべき要約、ホバーポップオーバー = 詳細」で一貫しており、D層だけ
  操作モデルを分裂させない
- **表示切り替え・フィルタは導入しない**。理由: (a) D層が常設で足すのは
  内部リンクエッジのみで、本数は「reth+beacon のペア数」（初期構成で 2 本、
  addNode ごとに +1 本）に限られ、氾濫しない。(b) 既存 A〜C層に切り替え
  機構が無く、D層のためだけに導入すると UI の一貫性が壊れる。(c) CONCEPT.md
  の「レイヤー切り替えで見る階層を変えられる」は「最終的に」の構想として
  残し、エッジ・パルスが読めなくなる実害が観測されてから A〜D層一貫の
  仕組みとして別 Issue で設計する（先回り実装をしない原則。スキーマへの
  影響は無いことを §7.4 で確認済み）

#### 7.6.3 内部リンクエッジ（常設）

`drivesNodeId` から導出する beacon カード → reth カードの常設エッジ
（§7.4）。「P2P の接続」でも「操作の呼び出し」でもなく「同じマシンの中の
配管」であることを、線種・色・文言の 3 経路で伝える:

- **線種: 二重線（配管）**。外側に太く低不透明度の「鞘」（目安 6px /
  opacity 0.18）、内側に細く明るい「芯」（目安 1.5px / opacity 0.8）を
  重ねて描く。単線しかない既存エッジ（P2P 実線・所有破線・操作先点線・
  デプロイ細線）のどれとも線種レベルで区別でき、「ケーブル・配管」の
  メタファーがそのまま見た目になる
- **色: 無彩色寄りのシルバー**（候補 `#c9d4e8`。CSS 変数 `--internal-edge`
  を新設）。ネットワーク色パレット（`peerEdge.ts` の NETWORK_COLORS）・
  所有の琥珀・操作のマゼンタ・コントラクトのインディゴはすべて「有彩色 =
  チェーン上/ネットワーク上の関係」に使っており、内部リンクは「色ではなく
  機構」を表す無彩色系で系統を分ける。実装時は Issue #95 の前例に倣い、
  既存色との見分け（ΔE）を確認して微調整してよい
- **矢印は付けない**。方向（CL が EL を駆動する）は活動パルスの進行方向
  （7.6.4）が伝える。常設エッジに矢印を付ける前例を作らない
- **ホバーで太くなる**（PeerPropagationEdge と同じ「今どの紐を見ているか」の
  流儀）+ **エッジポップオーバー**（PeerEdgePopover と同型）:
  - 見出し: 「内部リンク（Engine API）」（GlossaryTerm: `engine-api`）
  - 端点表記: `{beacon の containerName} → {reth の containerName}`
  - 説明文: 「この2つのコンテナは、合意（beacon）と実行（reth）を分担する
    1つの Ethereum ノードです。合意した結果を Engine API で実行クライアント
    へ伝えて駆動します」（「1つの Ethereum ノード」に GlossaryTerm:
    `el-cl-separation`）
  - 直近の活動（7.6.4 の最終観測を保持していれば）: メソッド別の増分一覧。
    例: 「直近3秒の呼び出し: engine_newPayloadV4 ×2 ·
    engine_forkchoiceUpdatedV3 ×2（平均 12 ms）」。メソッド名は生のまま
    見せ、7.6.7 の分類ラベルがあれば「（ブロックの実行依頼）」を併記する。
    最終観測から 10 秒（スクレイプ間隔 3 秒の 3 回分 + 余裕。観測が
    途絶えたと判断できる長さ）を過ぎたら「最近の呼び出しはありません」に
    切り替える（古い数字を出し続けない）
- **ダングリングガード必須**（§7.4）。相手ノードがキャンバスに無ければ
  描かない
- **CL 側ポップオーバー（InfraPopover）に「駆動する実行ノード」行を追加**。
  `drivesNodeId` が解決できた場合のみ、相手の containerName を表示する
  （ワークベンチの「操作先ノード」行と同じ流儀。ラベルに GlossaryTerm:
  `engine-api`）。
  **（Issue #215 で更新）** 当初は「EL 側への逆方向の行は追加しない（対応
  関係はエッジ自体と CL 側の行で足りる。逆引きのための走査を増やさない）」
  としていたが、Issue #215 の評価で reth カードのポップオーバーだけを見ても
  「どの beacon に駆動されているか」が分からないという指摘があったため、
  EL 側にも「駆動元（合意ノード）」行を追加する決定に更新した
  （`drivesNodeId` を全ノードから逆引きする。ラベルに GlossaryTerm:
  `engine-api`。フロント側の実装は `entities/infraNode.ts` の
  `drivenByContainerName` 導出を参照）

#### 7.6.4 活動パルス（nodeLinkActivity）

- **粒度: 1 観測 = パルス 1 本**（メソッド別に複数本は流さない）。
  `calls` はカウンタの増分であり個々の呼び出しは復元できない（§7.2）。
  メソッドごとに本数を分けると slot 2 秒 × スクレイプ 3 秒の環境で毎観測
  2 本以上が折り重なり、「パルス 1 本 = 呼び出し 1 回」という誤読を招く。
  パルスは「この間隔に呼び出しがあった」ことを示すハートビートに徹し、
  内訳（メソッド・回数）はエッジホバーのポップオーバー（7.6.3）で見せる。
  この「パルス 1 本 = 観測間隔内の 1 回以上の呼び出し」という意味は
  `engine-api` の用語解説（7.6.9）にも明記し、視覚とテキストの両方で
  増分観測であることに誠実な表現にする
- **進行方向は CL → EL 固定**（NodeLinkActivity の from/to のまま）。
  「CL が EL を駆動している」を方向で伝える。slot 2 秒 + スクレイプ 3 秒の
  前提（§7.2）では毎観測に増分が出るため、パルスがほぼ連続して流れ続け、
  「駆動し続けている」ことが動きとして見える
- **見た目**: `useOperationPulses` / OperationPulseEdge と同型の実装
  （offset-path アニメーション、r=5 の光点）。色はエッジと同系のシルバー
  発光（`.internal-pulse`）。B層の伝播パルス・C層の操作パルスと色で区別する
- **専用の到達演出は付けない**。newPayload 到達の直後に既存のブロック高
  更新・ブロック伝播発光が EL カードに起きるため、「Engine API パルス →
  カードが光る」の時間的一致がそのまま因果を見せる（§6.3 の「新しい演出は
  作らず、タイミングの一致だけで見せる」と同じ判断）
- 端点がキャンバスに無い観測は無視（§7.4）。store には畳み込まないが、
  エッジポップオーバー表示用に「エッジごとの最終観測」だけ描画側ローカル
  state で保持する（operationPulses と同じ流儀の分離経路）

#### 7.6.5 同期ステージの見せ方

**ポップオーバー（詳細）**: EL ノードの InfraPopover に「同期ステージ」
セクションを追加する（`internals.syncStages` がある場合のみ。省略時は
セクションごと出さない既存の流儀）:

- ラベル「同期ステージ」に GlossaryTerm: `staged-sync`
- `syncStages` の配列順（クライアントが公開するステージ順 = パイプラインの
  実行順）で全件を 1 行ずつ出す: `{ステージ表示名} {checkpoint}`。
  7.6.7 のマッピングに無いステージは生の名前のまま表示する（未知でも
  隠さない。reth のステージ構成が変わっても行が欠けない縮退動作）
- 各行に**ミニプログレスバー**を添える: 分母（目標高）は「キャンバス上の
  全 EL ノードの blockHeight の最大値」をフロントが導出する（§7.3 で
  blockHeight が実値になる前提。チェーン先端を別途観測する追加配線は
  作らない）。目標高が 0 のときはバーを出さず checkpoint の数値のみ
- 「上から順に埋まっていくバーの列」として、ステージ型同期のパイプライン
  構造そのものが見た目になる

**カード面（バックフィル進行の強調）**: `syncStatus === "syncing"` の EL
ノードカードにのみ、subtitle の下に 1 行のコンパクトな進行表示を出す:

- 内容: 「同期中: {現在のステージ表示名} {checkpoint}/{目標高}」 + 細い
  プログレスバー 1 本。「現在のステージ」= 配列順で最初の「checkpoint <
  目標高」のステージ（パイプラインは先頭から順に進むため、これが実行中の
  段階の近似になる）。目標高が取れない間はステージ名と checkpoint のみ
- ラベルに GlossaryTerm: `staged-sync`（addNode 直後に一番目に入る場所が
  そのまま用語解説の入口になる）
- `synced` になったら行ごと消える（カード面は「いま注目すべき変化」だけに
  保つ。既存の pending チップ・新着発光と同じ考え方）。ポップオーバー側の
  ステージ一覧は synced 後も残る（追従運転中も checkpoint が進み続けるか
  どうかは §7.2 の実測に依存するが、表示は観測値をそのまま出すだけなので
  どちらの結果でも壊れない）
- `internals.syncStages` が無い（旧 collector・観測不能）場合はカード面の
  行も出さない。その場合は従来どおりヘッダの琥珀ドットだけが同期中を示す

#### 7.6.6 txpool 内訳の見せ方

- EL ノードの InfraPopover に 1 行追加: ラベル「txpool」（GlossaryTerm:
  `txpool`）、値「pending {n} · queued {m}」。`internals.mempool` が
  省略されていれば行ごと出さない
- **カード面には出さない**。数字 2 つが常時貼り付いてもチェーンが動いて
  いる限りほぼ 0〜数件で変化に乏しく、ノイズになる。学習の起点としては
  ポップオーバーで足りる（tx を操作パネルから送った直後にホバーすれば
  pending が動くのが見える、という体験は残る）
- **C層の mempool 表現との整理**: 既存 glossary の `mempool`（C層）は
  「チェーン全体の概念としての待機列」、D層の `txpool` は「このノードが
  実際に抱えている実数（ノード内部の実体）」。用語解説を相互リンク
  （relatedTerms）で結び、`txpool` の定義側に「mempool のノード内実体。
  ノードごとに中身が違う」を明記して概念と実体の対応を学べるようにする。
  tx チップ（ウォレット視点のライフサイクル）はそのまま変えない

#### 7.6.7 チェーンプロファイル表現セットに置くマッピング

`packages/frontend/src/chain-profiles/ethereum/` に静的データを 2 つ新設する
（`OperationEdge.operation` の解釈と同じ「チェーン固有語彙の解釈はフロント
表現セットが担う」流儀。§7.4 の決定どおり glossary ではなくここに置く）:

- **ステージ表示名マッピング** `syncStageLabels`: reth の生ステージ名 →
  `{ja, en}` の表示名（+ 一言説明。ポップオーバー行の title 等で出す）。
  初稿（**実装時に実環境の `/metrics` に現れた生ステージ名へ合わせて確定
  する**こと。§7.2 のメトリクス名と同じ扱い）:

  | 生ステージ名 | ja | en |
  | --- | --- | --- |
  | Headers | ヘッダ取得 | Fetch headers |
  | Bodies | ボディ取得 | Fetch bodies |
  | SenderRecovery | 送信者復元 | Recover senders |
  | Execution | 実行 | Execute |
  | AccountHashing | アカウントのハッシュ化 | Hash accounts |
  | StorageHashing | ストレージのハッシュ化 | Hash storage |
  | MerkleExecute | 状態ルート検証 | Verify state root |
  | TransactionLookup | tx索引作成 | Index transactions |
  | IndexAccountHistory | アカウント履歴の索引 | Index account history |
  | IndexStorageHistory | ストレージ履歴の索引 | Index storage history |
  | Finish | 仕上げ | Finish |

  マッピングに無い名前（例: MerkleUnwind、Prune 系、Era）は生のまま表示
  する。全ステージ名の網羅より「主要な段階に日本語の足がかりがある」ことを
  優先する（生名の併記は不要。表示名があるものは表示名だけでよい）
- **Engine API メソッド分類ラベル** `engineApiMethodLabels`: 生メソッド名の
  前方一致 → `{ja, en}` の役割ラベル。エッジポップオーバーの内訳（7.6.3）で
  生メソッド名に併記する:

  | 前方一致 | ja | en |
  | --- | --- | --- |
  | engine_newPayload | ブロックの実行依頼 | Execute new block |
  | engine_forkchoiceUpdated | チェーン先端の更新 | Update chain head |
  | engine_getPayload | ブロック構築の依頼 | Request block build |

  一致しないメソッドは生名のみで表示する

#### 7.6.8 新設する i18n 文言（初稿）

| キー | ja | en |
| --- | --- | --- |
| `edge.internalLink` | 内部リンク（Engine API） | Internal link (Engine API) |
| `internalEdge.pair` | この2つのコンテナは、合意（beacon）と実行（reth）を分担する1つの Ethereum ノードです。合意した結果を Engine API で実行クライアントへ伝えて駆動します | These two containers form one Ethereum node, splitting consensus (beacon) and execution (reth). Each agreed result is pushed to the execution client over the Engine API. |
| `internalEdge.recentCalls` | 直近{seconds}秒の呼び出し | Calls in the last {seconds}s |
| `internalEdge.noRecentCalls` | 最近の呼び出しはありません | No recent calls |
| `internalEdge.latency` | 平均 {ms} ms | avg {ms} ms |
| `field.drivesNode` | 駆動する実行ノード | Drives execution node |
| `field.syncStages` | 同期ステージ | Sync stages |
| `field.txpool` | txpool | Txpool |
| `txpool.value` | pending {pending} · queued {queued} | pending {pending} · queued {queued} |
| `sync.progress` | 同期中: {stage} {checkpoint}/{target} | Syncing: {stage} {checkpoint}/{target} |
| `sync.progressNoTarget` | 同期中: {stage} {checkpoint} | Syncing: {stage} {checkpoint} |

#### 7.6.9 用語解説（D層）の方針

`glossary/ethereum/terms/d-internal.yaml` を新設する。定義文は既存の 3 拍子
「定義 → **なぜ必要か** → chainviz ではどう見えるか」で書く。アンカーの無い
用語は存在しないのと同じ（Issue #124 の教訓）なので、全用語にアンカーを
対応させる:

| termKey | 主なアンカー | 定義に必ず含めるポイント |
| --- | --- | --- |
| `engine-api` | 内部リンクエッジポップオーバーの見出し・CL ポップオーバーの「駆動する実行ノード」ラベル | 合意（CL）と実行（EL）を繋ぐ内部 API。CL が「このブロックを実行して」「チェーンの先端はここ」と EL へ指示することでチェーンが進む。**なぜ必要か**: 2 つの別プロセスが 1 つのノードとして動くための結び目。**chainviz では**: beacon→reth の内部リンクの紐と、その上を流れるパルス。パルス 1 本 = 観測間隔内の 1 回以上の呼び出し（回数の内訳は紐へのホバーで見える） |
| `el-cl-separation` | 内部リンクエッジポップオーバー本文の「1つの Ethereum ノード」 | 1 つの Ethereum ノードが EL と CL の 2 プロセスの組で構成されること（The Merge 以降の標準構成）。**なぜ必要か**: PoS 移行で合意の仕組みを丸ごと差し替える際、実行部分を温存して合意を別プロセスに分離した。役割分担により各クライアントを独立に開発・交換できる。**chainviz では**: ノードを追加すると必ず reth + beacon の 2 枚のカードが対で現れ、内部リンクで結ばれる |
| `staged-sync` | InfraPopover の「同期ステージ」ラベル・カード面の同期進行行 | 追いつき同期を「ヘッダ取得 → 実行 → 索引作成…」という段階に分け、ブロック範囲ごとにまとめて処理する方式（reth が採用）。**なぜ必要か**: 1 ブロックずつ全処理を繰り返すよりディスクアクセスがまとまり、桁違いに速く追いつける。**chainviz では**: 同期中の reth カードとその詳細に、各段階がどのブロック高まで済んだかがバーの列として見える |
| `txpool` | InfraPopover の「txpool」行ラベル | ノードが自分の中に持つ、ブロック未取り込み tx の置き場（mempool のノード内実体）。pending = すぐ取り込める tx、queued = nonce の飛び等の前提待ち。**なぜ必要か**: tx はブロックに入るまでどこかに保持される必要があり、それは各ノードのローカルな仕事（だからノードごとに中身が違う）。**chainviz では**: reth ノードの詳細に pending / queued の実数。relatedTerms で C層の `mempool` と相互リンク |

relatedTerms の配線: `engine-api` ↔ `el-cl-separation` ↔ `el-client` /
`cl-client`（既存 a-infra）、`staged-sync` → `el-client` / `block`系、
`txpool` ↔ `mempool` / `transaction` / `nonce`（既存 c-transaction）。
既存 `el-client` / `cl-client` / `mempool` の relatedTerms にも新用語への
逆リンクを追記する。

#### 7.6.10 決定事項（統括確認済み）

以下4点はいずれも本文中の推奨案を採用として確定した(2026-07-08)。
理由はいずれも各項目の本文(7.6.2/7.6.3/7.6.4/7.6.5)に記載済みのとおり。

1. **表示切り替え・フィルタは導入しない**（7.6.2。実害が出てから A〜D層
   一貫の仕組みとして別 Issue 化）
2. **パルスは 1 観測 1 本**（7.6.4。メソッド別に分けない。内訳はエッジ
   ホバーで見せる）
3. **カード常設はバックフィル進行の 1 行のみ**（7.6.5。同期ステージ一覧・
   txpool 内訳はポップオーバーのみ）
4. **内部リンクは無彩色シルバーの二重線**（7.6.3。有彩色 = ネットワーク/
   チェーン上の関係、無彩色 = ノード内部の機構、という色の系統分け）

## 8. E2E テストの構成（プロトコル層 + UI 層）

E2E（結合）テストは 2 層で構成する（2026-07-08 のユーザー指示
「E2E テストは Playwright で。自然言語ベースのシナリオを作り、基本操作から
異常系まで網羅する。UI でやれるところは全部 UI でやる」に基づく設計）。

### 8.1 二層の責務分担

| 層 | ランナー | 対象 | 検証の視点 |
| --- | --- | --- | --- |
| プロトコル層 | vitest + `ws` | collector の WebSocket 契約 | UI から到達できない検証（不正フレーム・不正コマンド・接続タイミング競合・ポート衝突・伝播時刻の数値検証・RPC によるブロック追従判定） |
| UI 層 | Playwright（chromium） | frontend + collector + 実 Docker | ユーザーが実際に見る・操作する結果（カード表示・エッジ描画・ボタン操作・トースト・言語切り替え） |

判断基準は「**UI で同等以上に検証できるシナリオは UI 層に一本化し、
プロトコル層と重複させない**」。両層とも実 Docker スタックを相手にするため、
重複させると実行時間が倍加する。既存のプロトコル層テストのうち UI 層へ
移行するもの・残すものの棚卸しは `packages/e2e/SCENARIOS.md` に記載する。

プロトコル層に残す検証（UI から到達不能なもの）:

- 不正 WebSocket フレーム（不正 JSON・type 欠落・未知 type）への耐性
- UI が送信し得ない不正コマンド（未対応 chainProfile・存在しない ID）の拒否
- 接続確立直後（snapshot 前）のコマンド取りこぼし・未接続クライアントの拒否
- collector 起動のポート衝突検出（Issue #64）
- ブロック伝播 `receivedAt` の数値検証（時刻差の範囲は UI に表示されない）
- addNode 後のブロック追従の数値判定（`eth_blockNumber` の RPC 比較。
  ノードカードのブロック高表示は Issue #187 実装後も「追いついたか」の
  数値判定は RPC が確実）
- D層 E2E（Issue #191。`NodeEntity.internals` / `nodeLinkActivity` の
  スキーマレベルの受信検証）

### 8.2 パッケージ構成

新規パッケージは作らず `packages/e2e` に同居させる。Docker 起動待ち・
collector 起動・排他ロックのハーネス（`src/helpers/`）を両層で共有するため。

```
packages/e2e/
  SCENARIOS.md            # シナリオカタログ（自然言語。§8.4）
  playwright.config.ts    # UI 層の設定（webServer で vite dev を起動）
  vitest.config.ts        # プロトコル層（既存）
  vitest.unit.config.ts   # Docker 非依存ユニット（既存。pnpm test 対象）
  src/
    *.test.ts             # プロトコル層のテスト（既存）
    helpers/              # 共有ハーネス（既存 + Playwright 用 globalSetup）
    ui/
      *.spec.ts           # UI 層（Playwright）。vitest の include と重ならない
```

実行コマンドは `pnpm test:e2e`（プロトコル層）と `pnpm test:e2e:ui`（UI 層）
に分ける。どちらも実 Docker を必要とし数分かかるため、**pre-push フックの
`pnpm test` には含めない**（既存方針を維持）。実行順の推奨はプロトコル層 →
UI 層（collector の契約が壊れているときに UI 層の失敗原因を切り分けやすい）。

### 8.3 起動トポロジ（UI 層）

```
playwright globalSetup:
  acquireE2eLock()            # vitest e2e と同一のホスト単位ロックを共用
  → ensureChainRunning()      # 既存スタックを再利用（helpers/docker.ts）
  → startCollector(4125)      # UI 層専用ポート（helpers/collector.ts）
playwright webServer:
  vite dev --port 5275        # VITE_COLLECTOR_URL=ws://127.0.0.1:4125
テスト実行（chromium が http://127.0.0.1:5275 を操作）
globalTeardown:
  collector 停止 → ロック解放  # Docker スタックは残置（既存方針と同じ）
```

- **排他ロックの共用**: `helpers/e2e-lock.ts` の既定パスをそのまま使う。
  これにより `test:e2e` と `test:e2e:ui` の同時実行（別 worktree 含む）も
  スタック・ポートの奪い合いにならない
- **ポート割り当て**: collector は dev 4000 / vitest e2e 4123 /
  ポート衝突テスト 4199 / **UI 層 4125**。frontend は dev 5173 /
  **UI 層 5275**。既存の実行系と同時に手元で使っても衝突しない
- `VITE_COLLECTOR_URL` は vite dev サーバー起動時に確定する（ビルド時
  埋め込み）ため、webServer の起動コマンドの環境変数で渡す。vite dev の
  起動は 1 秒未満（実測 0.6 秒）で、ビルド済み配布物との差異が問題に
  なったことはないため `vite build` + `preview` は使わない

### 8.4 シナリオ記法（自然言語ベース）

シナリオの正は **`packages/e2e/SCENARIOS.md`**（Markdown の箇条書き）に置く。
各シナリオは安定 ID（例: `UI-CMD-01`）とタイトルを持ち、
「前提 / 操作 / 確認」の 3 見出しの箇条書きで書く（Given/When/Then 相当）。

Playwright 側の実装規約:

- `test()` のタイトルは「`<シナリオID>: <タイトル>`」とし、SCENARIOS.md と
  1 対 1 に対応させる
- シナリオの各箇条書きは `test.step("<箇条書きと同じ文>", ...)` で実装する。
  テストレポートがそのまま自然言語のシナリオとして読める
- SCENARIOS.md とテストコードの対応はレビュー（sync-docs スキル）で確認する

Gherkin（cucumber）は採用しない。ステップ定義の間接層と依存関係が増える
一方、単一言語・単一リポジトリの本プロジェクトでは Markdown + `test.step`
で同じ可読性を得られるため。

**運用ルール**: 以後、新しい UI 機能を実装するステップには「SCENARIOS.md への
シナリオ追記 + UI 層テストの実装」をチェックボックスとして含める
（2026-07-08 ユーザー指示「これからもちゃんと追加すること」）。

### 8.5 frontend の計装方針

- ロケータは `data-testid` を正とする。文言（i18n）依存のロケータは言語
  切り替えシナリオ以外では使わない（文言変更でテストが壊れるのを防ぐ）
- カード類は計装済み（`infra-card-<id>` / `wallet-card-<address>` /
  `contract-card-<address>` / `ghost-card-<commandId>` /
  `operation-panel-<workbenchId>` / `toast-<id>` 等、34 箇所）
- 追加計装が必要な箇所（UI 層の実装 Issue で対応）: 接続ステータスバッジ・
  キャンバスツールバー（ノード追加ボタン・ワークベンチラベル入力・追加
  ボタン）・言語トグル・用語ポップオーバー・インフラポップオーバー。
  React Flow のエッジは `data-id`（`peer-...` 等の edge id）で特定できる
  ため追加計装は不要

### 8.6 実行環境の前提と実測値

- Playwright の chromium はシステムライブラリ（libnspr4 / libnss3 /
  libasound2 等）を必要とする。未導入のホストでは
  `pnpm exec playwright install chromium` に加えて
  `sudo pnpm exec playwright install-deps chromium`（または同等の apt
  インストール）が必要。CONTRIBUTING.md に前提として記載する
- 実測（2026-07-08、WSL2）: プロトコル層 21 テストがスタックのコールド
  スタート込みで 3 分 07 秒、稼働中スタック再利用ならさらに短い。vite dev
  の起動は 0.6 秒。UI 層を足しても手動実行に耐える範囲を維持する
- CJK フォントが無いホストではスクリーンショット上の日本語が豆腐（□）に
  なるが、DOM のテキスト自体は正常なのでアサーションには影響しない

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
  - 確定（Issue #129）: `addWorkbench` で動的追加したワークベンチの
    `ETH_RPC_URL` も、静的ワークベンチ（docker-compose.yml定義）と同様に
    このロギングプロキシ経由に向ける。プロキシへ到達するホスト名は
    環境変数 `CHAINVIZ_WORKBENCH_RPC_HOST`（既定 `host.docker.internal`、
    Docker の host-gateway 予約名）で上書きでき、ホスト名を使う場合は
    コンテナに `extra_hosts` で host-gateway を解決させる。
  - 確定（Issue #80）: プロキシが観測した RPC 呼び出し（`RpcObservation`）を
    `OperationEdge` へマッピングし、`operationObserved` イベントとして
    WebSocket で全クライアントへ passthrough 配信する。マッピングは
    `proxy/operation-observer.ts` に閉じ込め、`method` → `operation`・
    `timestamp` → `observedAt`、呼び出し元 IP（`callerIp`）は world-state
    store の `findWorkbenchByIp` で `fromWorkbenchId` に、中継先ホスト
    （`CHAINVIZ_PROXY_TARGET` の host 部）は `findNodeByIp` で `toNodeId` に
    解決する。解決は観測ごとに現在の store 状態へ問い合わせるため、後から
    追加されたワークベンチ/ノードにも追従する（固定の解決結果を埋め込まない）。
    どちらかの端点が解決できない観測は配信せず、どちらが引けなかったかを
    ログに残す（黙って握りつぶさない）。`operationObserved` は揮発性のため
    store の状態には畳み込まず（`WorldStateStore.applyEvent` は反映しない）、
    `broadcastDiff` 経由で配信のみ行う。
  - 確定（Issue #99）: ロギングプロキシ（4001）と WebSocket サーバー（4000）は
    いずれも listen 時に host を **`0.0.0.0`（IPv4 全アドレス）に明示指定**する。
    host を省くと Node は IPv6 の `::` に bind するが、WSL2 + VS Code Remote
    環境の localhost 転送は WSL 側 listener のアドレスファミリをそのまま
    Windows 側リレーへ写すため、IPv6 bind だと Windows の localhost
    （IPv4 の 127.0.0.1）から届かず、ブラウザの `ws://127.0.0.1:4000` 接続や
    `http://127.0.0.1:4001` が確定的に拒否される。プロキシは loopback 限定
    （`127.0.0.1`）にはできない。ワークベンチコンテナが Docker bridge の
    IPv4 ゲートウェイ経由で `host.docker.internal:4001` を叩くため、全 IPv4
    アドレスで待ち受ける `0.0.0.0` である必要がある。
    なお `0.0.0.0` は全インターフェースからの接続を受け付けるが、chainviz は
    ローカル開発用ツールであり、修正前の host 省略時点でも Node は既に IPv6 の
    `::`（全インターフェース）へ bind していたため、`0.0.0.0` への変更で外部への
    露出が増えるわけではない（IPv4 のみに限定される分、むしろ待ち受け範囲は
    狭まる）。
