import type {
  Command,
  ContractEntity,
  DiffEvent,
  NodeEntity,
  OperationEdge,
  PeerEdge,
  TransactionEntity,
  WalletEntity,
  WorkbenchEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
  ConnectionStatus,
} from "./client.js";

function rethNode(n: number, blockHeight: number): NodeEntity {
  return {
    kind: "node",
    id: `reth-node-${n}`,
    containerName: `chainviz-reth-${n}`,
    ip: `172.20.0.${10 + n}`,
    ports: [8545, 30303],
    resources: { cpuPercent: 4.2 + n, memMB: 512 + n * 32 },
    process: { name: "reth node", version: "1.1.0" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight,
    headBlockHash: `0x${blockHeight.toString(16).padStart(8, "0")}`,
  };
}

const lighthouseNode: NodeEntity = {
  kind: "node",
  id: "lighthouse-1",
  containerName: "chainviz-lighthouse-1",
  ip: "172.20.0.20",
  ports: [5052, 9000],
  resources: { cpuPercent: 3.1, memMB: 384 },
  process: { name: "lighthouse bn", version: "5.3.0" },
  chainType: "ethereum",
  clientType: "lighthouse",
  syncStatus: "synced",
  blockHeight: 128,
  headBlockHash: "0x00000080",
  // D層: このbeaconがEngine APIで駆動するreth（ARCHITECTURE.md §7.6.3。
  // Issue #188）。内部リンクエッジ1本をオフラインで確認できるようにする。
  drivesNodeId: "reth-node-1",
};

/**
 * reth-node-1 / lighthouse-1 を EL/CL それぞれのブートノードとして扱う
 * （実環境の node-lifecycle.ts と同じく、reth1 / beacon1 が入口に固定される。
 * Issue #123 UX設計 §5）。それ以外のノードは通常のピア。
 */
const EL_BOOTNODE_ID = "reth-node-1";
const CL_BOOTNODE_ID = "lighthouse-1";

/** addWorkbench の RPC 接続先（実環境の既定 `ETH_RPC_URL` = reth1 と同じ）。 */
const RPC_TARGET_NODE_ID = EL_BOOTNODE_ID;

/** 0x + 指定プレフィックス + ゼロ埋めで 40 桁のダミーアドレスを作る。 */
function addr(prefix: string): string {
  return `0x${prefix.padEnd(40, "0")}`;
}

/** 0x + 指定シード + ゼロ埋めで 64 桁のダミー tx ハッシュを作る。 */
function txHash(seed: string): string {
  return `0x${seed.padEnd(64, "0")}`;
}

/** eth（整数）を wei 建ての整数文字列に変換する。 */
function ethWei(eth: bigint): string {
  return (eth * 10n ** 18n).toString();
}

// C層のモック用ウォレット・トランザクション。collector 側（#76/#77）が
// 未完成のため、フロントの表示・アニメーション確認用にここでサンプルを持つ。
const ALICE_WALLET = addr("a11ce");
const BOB_WALLET = addr("b0b");
const SAFE_WALLET = addr("5afe");

const ALICE_TX1 = txHash("a11ce01");
const BOB_TX1 = txHash("b0b01");

// C層拡張: ウォレットのトークン残高（Issue #168）のモック用サンプル。
// TOKEN_CONTRACT（ChainvizToken/CVZ、decimals 18）は下の
// chainvizTokenContract() と同じアドレス定数を後方で宣言して共有する
// （モジュール評価順の都合上、値そのものは下方の TOKEN_CONTRACT 定義を参照。
// 参照するのは aliceWallet()/bobWallet() 呼び出し時＝モジュール初期化後の
// ため問題ない）。
/** Alice の CVZ 残高（1000.5 CVZ 相当。ETH 残高と異なる小数部にして
 * decimals 変換の桁を目視確認できるようにする）。 */
const ALICE_CVZ_BALANCE_WEI = (10005n * 10n ** 17n).toString();
/** Bob の CVZ 残高（250.25 CVZ 相当）。 */
const BOB_CVZ_BALANCE_WEI = (25025n * 10n ** 16n).toString();
/**
 * まだ観測されていない（またはカタログに無い）コントラクトのアドレス。
 * Bob の tokenBalances に混ぜ、ダングリングガード（対応する ContractEntity
 * が見つからない tokenBalance は表示しない。ARCHITECTURE.md §6.7）を
 * オフラインで確認できるようにする。
 */
const UNTRACKED_TOKEN_CONTRACT = addr("de1e7ed");
const BOB_UNTRACKED_TOKEN_BALANCE_WEI = ethWei(999n);

/** Alice ウォレットの初期状態（createMockSnapshot と live 更新で共有）。 */
const INITIAL_ALICE_NONCE = 3;
const INITIAL_ALICE_BALANCE_WEI = 5n * 10n ** 18n;

const workbench: WorkbenchEntity = {
  kind: "workbench",
  id: "workbench-alice",
  containerName: "chainviz-workbench-alice",
  ip: "172.20.0.30",
  ports: [],
  resources: { cpuPercent: 0.3, memMB: 64 },
  process: { name: "foundry" },
  label: "Alice",
  walletIds: [ALICE_WALLET, SAFE_WALLET],
  // 実環境の既定 ETH_RPC_URL（reth1 直）と同じ対象を模す（Issue #123）。
  rpcTargetNodeId: RPC_TARGET_NODE_ID,
};

/** Alice の EOA。workbench-alice が所有し、tx ライフサイクルの主役になる。 */
function aliceWallet(): WalletEntity {
  return {
    kind: "wallet",
    address: ALICE_WALLET,
    chainType: "ethereum",
    balance: INITIAL_ALICE_BALANCE_WEI.toString(),
    nonce: INITIAL_ALICE_NONCE,
    isSmartAccount: false,
    ownerWorkbenchId: "workbench-alice",
    // 新しい順: mempool 待機中の素の送金、復号済みのトークン呼び出し、
    // デプロイ（Issue #166: 「意味」優先の tx チップ表示を確認できる組み合わせ）。
    recentTxHashes: [ALICE_TX1, TOKEN_CALL_TX, TOKEN_DEPLOY_TX],
    // Issue #168: CVZ トークン残高（ウォレットカードのトークン残高チップ・
    // ポップオーバー表示の確認用）。
    tokenBalances: [
      { contractAddress: TOKEN_CONTRACT, amount: ALICE_CVZ_BALANCE_WEI },
    ],
  };
}

/**
 * Bob の EOA。所有していたワークベンチが削除された状態（ownerWorkbenchId:
 * null）を再現する。CONCEPT.md の決定どおり、所有エッジは消えるがウォレット
 * 自体のカードは残る（カード上に「所有者は削除済み」を表示）。
 */
function bobWallet(): WalletEntity {
  return {
    kind: "wallet",
    address: BOB_WALLET,
    chainType: "ethereum",
    balance: ethWei(2n),
    nonce: 7,
    isSmartAccount: false,
    ownerWorkbenchId: null,
    // カタログ外コントラクトへの復号不能な呼び出しと、Counter のデプロイを
    // 含める（Issue #166: 未復号チップ・デプロイチップの確認用）。
    recentTxHashes: [BOB_TX1, UNKNOWN_CALL_TX, COUNTER_DEPLOY_TX],
    // Issue #168: 正常に突き合わせられる CVZ 残高と、対応する ContractEntity
    // が存在しない（未観測/カタログ外）tokenBalance を両方含める。後者は
    // ダングリングガードで非表示になることの確認用（表示されてはいけない）。
    tokenBalances: [
      { contractAddress: TOKEN_CONTRACT, amount: BOB_CVZ_BALANCE_WEI },
      {
        contractAddress: UNTRACKED_TOKEN_CONTRACT,
        amount: BOB_UNTRACKED_TOKEN_BALANCE_WEI,
      },
    ],
  };
}

/** スマートアカウント（コントラクトウォレット）。workbench-alice が所有。 */
function safeWallet(): WalletEntity {
  return {
    kind: "wallet",
    address: SAFE_WALLET,
    chainType: "ethereum",
    balance: ethWei(10n),
    nonce: 0,
    isSmartAccount: true,
    ownerWorkbenchId: "workbench-alice",
    recentTxHashes: [],
  };
}

/** Alice が送信し mempool で待機中（pending）の tx。 */
function alicePendingTx(): TransactionEntity {
  return {
    kind: "transaction",
    hash: ALICE_TX1,
    from: ALICE_WALLET,
    to: BOB_WALLET,
    status: "pending",
  };
}

/** Bob の確定済み（included）tx。 */
function bobIncludedTx(): TransactionEntity {
  return {
    kind: "transaction",
    hash: BOB_TX1,
    from: BOB_WALLET,
    to: ALICE_WALLET,
    status: "included",
    blockHash: "0x00000080",
  };
}

// C層拡張（コントラクト。Issue #165）のモック用サンプル。collector 側の
// カタログ・デプロイ検知（#158/#159/#161）はオフラインのモックには反映
// されないため、フロントの表示・ポップオーバー・デプロイエッジ確認用に
// ここでサンプルを持つ（実カタログの ChainvizToken / Counter に合わせた名前
// にして、実環境と見比べたときに違和感が無いようにする）。
const TOKEN_CONTRACT = addr("cafe01");
const COUNTER_CONTRACT = addr("c0de02");
const UNKNOWN_CONTRACT = addr("dead01");

const TOKEN_DEPLOY_TX = txHash("dep70ken1");
const COUNTER_DEPLOY_TX = txHash("dep70cnt1");

// C層拡張（コントラクト呼び出し・イベントログの可視化。Issue #166）のモック
// 用サンプル。#165 のコントラクトサンプルと組み合わせて使えるよう、既存の
// TOKEN_CONTRACT / COUNTER_CONTRACT / UNKNOWN_CONTRACT のアドレスをそのまま
// 参照する。「復号済み（カタログ既知）」「復号不能（カタログ外）」の両方を
// 確認できるサンプルを用意する（ARCHITECTURE.md §6.6）。
const TOKEN_CALL_TX = txHash("70kenca11");
const UNKNOWN_CALL_TX = txHash("dead0ca11");

/** 1 ETH 相当の wei 建て転送量（トークンのモックにも金額の桁感を合わせて流用）。 */
const MOCK_TRANSFER_AMOUNT_WEI = ethWei(1n);

/**
 * Alice が ChainvizToken.transfer を呼び出し、確定して Transfer イベントも
 * 観測できた tx。関数名・引数・イベント名がすべて復号済みのサンプル
 * （コントラクトカードの活動チップ・ウォレットの tx チップ双方の確認用）。
 */
function tokenTransferCallTx(): TransactionEntity {
  return {
    kind: "transaction",
    hash: TOKEN_CALL_TX,
    from: ALICE_WALLET,
    to: TOKEN_CONTRACT,
    status: "included",
    blockHash: "0x00000080",
    contractCall: {
      contractAddress: TOKEN_CONTRACT,
      functionName: "transfer",
      args: [
        { name: "to", value: BOB_WALLET },
        { name: "amount", value: MOCK_TRANSFER_AMOUNT_WEI },
      ],
    },
    contractEvents: [
      {
        contractAddress: TOKEN_CONTRACT,
        eventName: "Transfer",
        args: [
          { name: "from", value: ALICE_WALLET },
          { name: "to", value: BOB_WALLET },
          { name: "value", value: MOCK_TRANSFER_AMOUNT_WEI },
        ],
      },
    ],
  };
}

/**
 * Bob がカタログ外のコントラクトを呼び出した tx。ABI を持たないため
 * `functionName`/`eventName` を復号できず、`rawFunctionId`/`rawEventId`
 * （生の 4byte セレクタ/トピック相当）だけが入る（ARCHITECTURE.md §6.4/§6.6）。
 */
function unknownContractCallTx(): TransactionEntity {
  return {
    kind: "transaction",
    hash: UNKNOWN_CALL_TX,
    from: BOB_WALLET,
    to: UNKNOWN_CONTRACT,
    status: "included",
    blockHash: "0x00000080",
    contractCall: {
      contractAddress: UNKNOWN_CONTRACT,
      rawFunctionId: "0xa9059cbb",
    },
    contractEvents: [
      {
        contractAddress: UNKNOWN_CONTRACT,
        rawEventId: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      },
    ],
  };
}

/** ChainvizToken のデプロイ tx（Alice 発）。ウォレットの tx チップで
 * 「デプロイ」表示を確認できるようにする。 */
function tokenDeployTx(): TransactionEntity {
  return {
    kind: "transaction",
    hash: TOKEN_DEPLOY_TX,
    from: ALICE_WALLET,
    to: null,
    status: "included",
    blockHash: "0x00000060",
    createdContractAddress: TOKEN_CONTRACT,
  };
}

/** Counter のデプロイ tx（Bob 発）。 */
function counterDeployTx(): TransactionEntity {
  return {
    kind: "transaction",
    hash: COUNTER_DEPLOY_TX,
    from: BOB_WALLET,
    to: null,
    status: "included",
    blockHash: "0x00000060",
    createdContractAddress: COUNTER_CONTRACT,
  };
}

/** カタログ既知・トークンを持つコントラクト。Alice がデプロイした体で、
 * デプロイエッジ（Alice ウォレット → このカード）を確認できる。
 * `catalogKey`/`token.symbol` は実カタログ（profiles/ethereum/contracts/
 * catalog.json）の "ChainvizToken" / "CVZ" と完全に一致させる（Issue #167 で
 * 修正: 以前は "chainviz-token" / "CVT" という実環境と異なる値だった。値が
 * ずれると操作パネルの呼び出しタブの照合 §6.5 が実環境と噛み合わなくなる）。 */
function chainvizTokenContract(): ContractEntity {
  return {
    kind: "contract",
    address: TOKEN_CONTRACT,
    chainType: "ethereum",
    name: "ChainvizToken",
    catalogKey: "ChainvizToken",
    deployerAddress: ALICE_WALLET,
    createdByTxHash: TOKEN_DEPLOY_TX,
    token: { symbol: "CVZ", decimals: 18 },
  };
}

/** カタログ既知・トークンを持たないコントラクト。所有者が削除された Bob
 * ウォレットがデプロイした体にし、「所有者は削除済み」のウォレットでも
 * デプロイエッジ自体は張られる（ウォレットカードの生存だけを見る）ことを
 * 確認できるようにする。`catalogKey` は実カタログの "Counter" と一致させる
 * （chainvizTokenContract の docstring 参照）。 */
function counterContract(): ContractEntity {
  return {
    kind: "contract",
    address: COUNTER_CONTRACT,
    chainType: "ethereum",
    name: "Counter",
    catalogKey: "Counter",
    deployerAddress: BOB_WALLET,
    createdByTxHash: COUNTER_DEPLOY_TX,
  };
}

/**
 * カタログ未登録（手動デプロイ・追跡外アドレスからのデプロイを想定）の
 * コントラクト。名前・カタログキー・デプロイ元のいずれも観測できなかった
 * 状態を再現し、「未知のコントラクト」表示（破線ボーダー・カタログ外ピル・
 * デプロイエッジ無し）をオフラインで確認できるようにする
 * （ARCHITECTURE.md §6.4）。
 */
function unknownContract(): ContractEntity {
  return {
    kind: "contract",
    address: UNKNOWN_CONTRACT,
    chainType: "ethereum",
  };
}

/**
 * 実環境（Ethereum プロファイル1つ）の P2P ネットワーク ID。
 * profiles/ethereum の CHAIN_ID と揃える。networkId は今のところ1種類。
 */
export const MOCK_NETWORK_ID = "1337";

/**
 * ワークベンチ → ノードの操作観測イベント（operationObserved）のモックを作る。
 * 実環境ではロギングプロキシが観測した RPC 呼び出しから collector が生成するが、
 * オフライン確認用に、workbench-alice が reth-node-1 へ RPC を送った瞬間を模す。
 * 揮発性イベントなのでスナップショットには含めず、live 差分としてのみ流す。
 */
export function mockOperationObserved(operation: string): DiffEvent {
  const edge: OperationEdge = {
    kind: "operation",
    fromWorkbenchId: "workbench-alice",
    toNodeId: "reth-node-1",
    operation,
    observedAt: Date.now(),
  };
  return { type: "operationObserved", edge };
}

/**
 * D層: 内部リンク（beacon → reth の Engine API 呼び出し）の観測イベント
 * （nodeLinkActivity）のモックを作る（ARCHITECTURE.md §7.6.4。Issue #188）。
 * lighthouse-1（drivesNodeId: reth-node-1）上の内部リンクエッジへ、活動
 * パルスをオフラインで確認できるようにする。実環境では collector が reth の
 * `/metrics` ポーリングから増分を検知して生成するが、モックでは固定の
 * カウンタ増分（1観測あたり newPayload/forkchoiceUpdated 各1回相当）を返す
 * （実測値ではなく UI 確認用の演出値）。
 */
export function mockNodeLinkActivity(): DiffEvent {
  return {
    type: "nodeLinkActivity",
    activity: {
      fromNodeId: "lighthouse-1",
      toNodeId: "reth-node-1",
      calls: [
        { method: "engine_newPayloadV4", count: 1, latencyMs: 8 },
        { method: "engine_forkchoiceUpdatedV3", count: 1, latencyMs: 4 },
      ],
      observedAt: Date.now(),
    },
  };
}

/** collector 不在でも UI を確認するためのモックスナップショット。 */
export function createMockSnapshot(): WorldStateSnapshot {
  return {
    chainType: "ethereum",
    timestamp: Date.now(),
    entities: [
      // reth-node-1 / lighthouse-1 がそれぞれ EL/CL のブートノード（Issue #123）。
      { ...rethNode(1, 128), p2pRole: "bootnode" },
      { ...rethNode(2, 128), p2pRole: "peer" },
      { ...lighthouseNode, p2pRole: "bootnode" },
      workbench,
      aliceWallet(),
      bobWallet(),
      safeWallet(),
      alicePendingTx(),
      bobIncludedTx(),
      tokenTransferCallTx(),
      unknownContractCallTx(),
      tokenDeployTx(),
      counterDeployTx(),
      chainvizTokenContract(),
      counterContract(),
      unknownContract(),
    ],
    // 2つの reth ノードが実行層 P2P で直接ピア接続している状態を表す。
    edges: [
      {
        kind: "peer",
        fromNodeId: "reth-node-1",
        toNodeId: "reth-node-2",
        networkId: MOCK_NETWORK_ID,
      },
    ],
  };
}

/**
 * networkId 単位のグルーピング表示（#24）を確認するためのサンプル。
 * 実環境では networkId は1種類しかないため既定のスナップショットには
 * 含めない。2つの異なる networkId のクラスタを持ち、色分けと
 * グルーピングの挙動を目視・テストで確認できる。
 */
export function createMultiNetworkMockSnapshot(): WorldStateSnapshot {
  const secondNetworkId = "2337";
  const nodeC: NodeEntity = {
    ...rethNode(3, 64),
    id: "reth-node-3",
    containerName: "chainviz-reth-3",
  };
  const nodeD: NodeEntity = {
    ...rethNode(4, 64),
    id: "reth-node-4",
    containerName: "chainviz-reth-4",
  };
  const edges: PeerEdge[] = [
    {
      kind: "peer",
      fromNodeId: "reth-node-1",
      toNodeId: "reth-node-2",
      networkId: MOCK_NETWORK_ID,
    },
    {
      kind: "peer",
      fromNodeId: "reth-node-3",
      toNodeId: "reth-node-4",
      networkId: secondNetworkId,
    },
  ];
  return {
    chainType: "ethereum",
    timestamp: Date.now(),
    entities: [rethNode(1, 128), rethNode(2, 128), nodeC, nodeD],
    edges,
  };
}

/**
 * 初期スナップショットに含まれるノード（compose 起動のバリデーター相当）。
 * 実環境の完了条件どおり、これらは削除できずエラーが返る。追加した
 * フォロワーノード / ワークベンチは削除できる。
 */
const NON_REMOVABLE_NODE_IDS = new Set([
  "reth-node-1",
  "reth-node-2",
  "lighthouse-1",
]);

/**
 * addNode で追加するフォロワーの reth + beacon ペア（Issue #123 UX設計 §4-6。
 * 実環境の node-lifecycle.ts が addNode で reth/beacon の2コンテナを追加する
 * 挙動をモックでも再現する）。どちらも同期中から始まり、EL/CL それぞれの
 * ブートノードを入口に参加する `p2pRole: "peer"` のノードとして追加する。
 */
function newFollowerNodePair(seq: number): { reth: NodeEntity; beacon: NodeEntity } {
  const reth: NodeEntity = {
    kind: "node",
    id: `reth-follower-${seq}`,
    containerName: `chainviz-reth-follower-${seq}`,
    ip: `172.20.0.${100 + seq}`,
    ports: [8545, 30303],
    resources: { cpuPercent: 2.0, memMB: 400 },
    process: { name: "reth node", version: "1.1.0" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "syncing",
    blockHeight: 0,
    headBlockHash: "0x00000000",
    p2pRole: "peer",
    removable: true,
  };
  const beacon: NodeEntity = {
    kind: "node",
    id: `beacon-follower-${seq}`,
    containerName: `chainviz-beacon-follower-${seq}`,
    ip: `172.20.0.${120 + seq}`,
    ports: [5052, 9000],
    resources: { cpuPercent: 1.6, memMB: 320 },
    process: { name: "lighthouse bn", version: "5.3.0" },
    chainType: "ethereum",
    clientType: "lighthouse",
    syncStatus: "syncing",
    blockHeight: 0,
    headBlockHash: "0x00000000",
    p2pRole: "peer",
    removable: true,
    // D層: addNode後のペアでも内部リンクエッジが張られることを確認できる
    // ようにする（ARCHITECTURE.md §7.6.3。Issue #188）。
    drivesNodeId: reth.id,
  };
  return { reth, beacon };
}

/** addWorkbench で追加するワークベンチ。 */
function newWorkbench(seq: number, label: string): WorkbenchEntity {
  return {
    kind: "workbench",
    id: `workbench-${seq}`,
    containerName: `chainviz-workbench-${seq}`,
    ip: `172.20.0.${150 + seq}`,
    ports: [],
    resources: { cpuPercent: 0.2, memMB: 48 },
    process: { name: "foundry" },
    label,
    walletIds: [],
    removable: true,
    // 実環境の既定 ETH_RPC_URL（reth1 直）と同じ対象を模す（Issue #123）。
    rpcTargetNodeId: RPC_TARGET_NODE_ID,
  };
}

/**
 * addNode 成功から、新しい reth/beacon ペアの実 PeerEdge がブートノードとの
 * 間に張られるまでの模擬遅延（Issue #123 UX設計 §4-4「接続予定エッジは実
 * カード到着後も残し、実PeerEdgeが1本でも届いた時点で消す」の遷移をオフライン
 * 確認できるようにするための演出値。実測タイムアウトではなく、UI 上で
 * 「接続確立中…」表示から実エッジへの切り替えを目視できれば十分という
 * 固定 UX 値）。
 */
export const ADD_NODE_PEER_CONNECT_DELAY_MS = 4000;

/**
 * runWorkbenchOperation(deployContract) のモック応答が組み立てる、最小限の
 * カタログ表示情報（Issue #167）。実カタログ（profiles/ethereum/contracts/
 * catalog.json）の ChainvizToken/Counter に対応する。ABI は持たない
 * （型解釈は実際には collector 側 ChainAdapter の責務であり、モックは
 * その結果だけを模す）。
 */
const MOCK_DEPLOYABLE_CATALOG: Record<
  string,
  { name: string; token?: { symbol: string; decimals: number } }
> = {
  ChainvizToken: { name: "ChainvizToken", token: { symbol: "CVZ", decimals: 18 } },
  Counter: { name: "Counter" },
};

export interface MockClientOptions {
  /** ブロック高を進める diff の送出間隔(ms)。0 以下でタイマーを起動しない。 */
  intervalMs?: number;
  /**
   * コマンド送信から結果を返すまでの遅延(ms)。0 以下ならマイクロタスクで
   * 即時に返す（テスト用）。既定は 0。
   */
  commandLatencyMs?: number;
}

/**
 * collector と同じ ChainvizClient インターフェースを満たすモック。
 * connect 時に snapshot を1回流し、以後は定期的に blockHeight を進める diff を
 * 送る（間隔は intervalMs、テストでは 0 を渡してタイマーを止められる）。
 *
 * 操作コマンド（addNode / removeNode / addWorkbench / removeWorkbench）は
 * collector が未完成のため、ここで簡易にシミュレートする。成功時は対応する
 * entityAdded / entityRemoved diff を流したうえで commandResult(ok:true) を、
 * 失敗時（存在しない id / 削除不可のノード）は commandResult(ok:false, error)
 * を返す。これにより成功・失敗双方の見た目を collector なしで確認できる。
 */
export function createMockClient(
  handlers: ChainvizClientHandlers,
  options: MockClientOptions = {},
): ChainvizClient {
  const intervalMs = options.intervalMs ?? 3000;
  const commandLatencyMs = options.commandLatencyMs ?? 0;
  let status: ConnectionStatus = "disconnected";
  let timer: ReturnType<typeof setInterval> | null = null;
  const commandTimers = new Set<ReturnType<typeof setTimeout>>();
  let blockHeight = 128;
  let counter = 0;
  let entitySeq = 0;

  // 追加・削除の判定に使う、現在存在するエンティティ id の集合。
  const nodeIds = new Set(["reth-node-1", "reth-node-2", "lighthouse-1"]);
  const workbenchIds = new Set(["workbench-alice"]);

  // runWorkbenchOperation(callContract) の対象照合に使う、デプロイ済み・
  // カタログ既知コントラクトの address -> catalogKey 索引（Issue #167）。
  // 初期スナップショットの2件（ChainvizToken/Counter）で種を蒔き、
  // deployContract が成功するたびに追加する。
  const deployedContractCatalogKeys = new Map<string, string>([
    [TOKEN_CONTRACT, "ChainvizToken"],
    [COUNTER_CONTRACT, "Counter"],
  ]);
  let deploySeq = 0;

  // C層 tx ライフサイクルの live シミュレーション状態。connect のたびに
  // resetTxState で初期化し、送出するスナップショットと整合させる。
  let aliceNonce = INITIAL_ALICE_NONCE;
  let aliceBalanceWei = INITIAL_ALICE_BALANCE_WEI;
  let aliceRecent: string[] = [ALICE_TX1];
  let pendingHash: string | null = ALICE_TX1;
  // 現在 pending 中の tx が素の送金かコントラクト呼び出しか（次の tick で
  // 確定させる際に contractEvents を足すかどうかの判定に使う。Issue #166）。
  let pendingKind: "plain" | "call" = "plain";
  let txSeq = 0;

  function resetTxState() {
    aliceNonce = INITIAL_ALICE_NONCE;
    aliceBalanceWei = INITIAL_ALICE_BALANCE_WEI;
    aliceRecent = [ALICE_TX1];
    pendingHash = ALICE_TX1;
    pendingKind = "plain";
    txSeq = 0;
  }

  /**
   * 1 tick 分の tx ライフサイクルを進める差分を返す。前回 pending だった tx を
   * included に確定させて Alice の nonce/残高を更新し、新しい pending tx を
   * mempool へ投入する。recentTxHashes からあふれた古い tx は掃除する。
   *
   * 3回に1回、新しい pending tx を ChainvizToken.transfer への呼び出しに
   * する（Issue #166: tx確定時のコントラクトへのパルス・確定フラッシュを
   * live で確認できるようにするための演出頻度。実データの分布を模した
   * ものではない UX 上の固定値）。呼び出しが確定した瞬間、契約カードの
   * アニメーション（`useContractSettlementEffects`）と Transfer イベント
   * チップの両方をオフラインで確認できる。
   */
  function advanceTxLifecycle(): DiffEvent[] {
    const diffs: DiffEvent[] = [];

    if (pendingHash) {
      const blockHash = `0x${blockHeight.toString(16).padStart(8, "0")}`;
      const patch: Partial<TransactionEntity> = {
        status: "included",
        blockHash,
      };
      if (pendingKind === "call") {
        // ARCHITECTURE.md §6.6: contractEvents はブロック取り込みが確定した
        // 後にのみ入る。
        patch.contractEvents = [
          {
            contractAddress: TOKEN_CONTRACT,
            eventName: "Transfer",
            args: [
              { name: "from", value: ALICE_WALLET },
              { name: "to", value: BOB_WALLET },
              { name: "value", value: MOCK_TRANSFER_AMOUNT_WEI },
            ],
          },
        ];
      }
      diffs.push({ type: "entityUpdated", id: pendingHash, patch });
      aliceNonce += 1;
      // gas 概算(21000 gas × 1 gwei)を残高から差し引く。
      aliceBalanceWei -= 21_000n * 1_000_000_000n;
      diffs.push({
        type: "entityUpdated",
        id: ALICE_WALLET,
        patch: { nonce: aliceNonce, balance: aliceBalanceWei.toString() },
      });
    }

    const hash = txHash(`feed${txSeq++}`);
    pendingHash = hash;
    const makeCall = txSeq % 3 === 0;
    pendingKind = makeCall ? "call" : "plain";
    const tx: TransactionEntity = makeCall
      ? {
          kind: "transaction",
          hash,
          from: ALICE_WALLET,
          to: TOKEN_CONTRACT,
          status: "pending",
          contractCall: {
            contractAddress: TOKEN_CONTRACT,
            functionName: "transfer",
            args: [
              { name: "to", value: BOB_WALLET },
              { name: "amount", value: MOCK_TRANSFER_AMOUNT_WEI },
            ],
          },
        }
      : {
          kind: "transaction",
          hash,
          from: ALICE_WALLET,
          to: BOB_WALLET,
          status: "pending",
        };
    diffs.push({ type: "entityAdded", entity: tx });

    const nextRecent = [hash, ...aliceRecent];
    const overflow = nextRecent.slice(6);
    aliceRecent = nextRecent.slice(0, 6);
    diffs.push({
      type: "entityUpdated",
      id: ALICE_WALLET,
      patch: { recentTxHashes: [...aliceRecent] },
    });
    for (const dropped of overflow) {
      diffs.push({ type: "entityRemoved", id: dropped });
    }
    return diffs;
  }

  function setStatus(next: ConnectionStatus) {
    if (status === next) return;
    status = next;
    handlers.onStatusChange?.(next);
  }

  /**
   * addNode で追加した reth/beacon ペアそれぞれとブートノードとの間に、
   * 実 PeerEdge が張られたことを模す（Issue #123 UX設計 §4-4 の遷移確認用。
   * ADD_NODE_PEER_CONNECT_DELAY_MS 経過後に1回だけ発火する）。ペアの片方
   * だけが既に削除されていても、残っている側の edgeAdded はそのまま送る
   * （world-state 側が端点存在チェックで無視するので害はない）。
   */
  function scheduleFollowerPeerConnect(rethId: string, beaconId: string) {
    const t = setTimeout(() => {
      commandTimers.delete(t);
      const edges: DiffEvent[] = [
        {
          type: "edgeAdded",
          edge: {
            kind: "peer",
            fromNodeId: rethId,
            toNodeId: EL_BOOTNODE_ID,
            networkId: MOCK_NETWORK_ID,
          },
        },
        {
          type: "edgeAdded",
          edge: {
            kind: "peer",
            fromNodeId: beaconId,
            toNodeId: CL_BOOTNODE_ID,
            networkId: MOCK_NETWORK_ID,
          },
        },
      ];
      handlers.onDiff?.(edges);
    }, ADD_NODE_PEER_CONNECT_DELAY_MS);
    commandTimers.add(t);
  }

  /** コマンドを適用し、流す diff 列と結果を返す。 */
  function applyCommand(
    command: Command,
  ): { ok: boolean; error?: string; diffs?: DiffEvent[] } {
    switch (command.action) {
      case "addNode": {
        const { reth, beacon } = newFollowerNodePair(++entitySeq);
        nodeIds.add(reth.id);
        nodeIds.add(beacon.id);
        scheduleFollowerPeerConnect(reth.id, beacon.id);
        return {
          ok: true,
          diffs: [
            { type: "entityAdded", entity: reth },
            { type: "entityAdded", entity: beacon },
          ],
        };
      }
      case "addWorkbench": {
        const wb = newWorkbench(++entitySeq, command.label);
        workbenchIds.add(wb.id);
        return { ok: true, diffs: [{ type: "entityAdded", entity: wb }] };
      }
      case "removeNode": {
        if (!nodeIds.has(command.nodeId)) {
          return { ok: false, error: `node not found: ${command.nodeId}` };
        }
        if (NON_REMOVABLE_NODE_IDS.has(command.nodeId)) {
          return {
            ok: false,
            error: "cannot remove a validator node started by compose",
          };
        }
        nodeIds.delete(command.nodeId);
        return {
          ok: true,
          diffs: [{ type: "entityRemoved", id: command.nodeId }],
        };
      }
      case "removeWorkbench": {
        if (!workbenchIds.has(command.workbenchId)) {
          return { ok: false, error: `workbench not found: ${command.workbenchId}` };
        }
        workbenchIds.delete(command.workbenchId);
        return {
          ok: true,
          diffs: [{ type: "entityRemoved", id: command.workbenchId }],
        };
      }
      case "runWorkbenchOperation": {
        // Issue #167: 操作パネル（送金/デプロイ/コントラクト呼び出し）を
        // collector なしで確認できるよう、実際に成功/失敗をシミュレートする
        // （以前は ok:false 固定だった）。
        const { workbenchId, operation } = command;
        if (!workbenchIds.has(workbenchId)) {
          return { ok: false, error: `workbench not found: ${workbenchId}` };
        }
        switch (operation.type) {
          case "transfer": {
            if (operation.to.trim() === "") {
              return {
                ok: false,
                error: "transfer requires a non-empty destination address",
              };
            }
            return { ok: true };
          }
          case "deployContract": {
            const catalogEntry = MOCK_DEPLOYABLE_CATALOG[operation.contractKey];
            if (!catalogEntry) {
              return {
                ok: false,
                error: `unknown contract catalog key: ${operation.contractKey}`,
              };
            }
            const address = addr(`dep1${++deploySeq}`);
            const createdByTxHash = txHash(`dep1${deploySeq}`);
            deployedContractCatalogKeys.set(address, operation.contractKey);
            const entity: ContractEntity = {
              kind: "contract",
              address,
              chainType: "ethereum",
              name: catalogEntry.name,
              catalogKey: operation.contractKey,
              // モック上、デプロイ元ウォレットを解決できるのは
              // workbench-alice（Alice のウォレットを所有）だけ。それ以外の
              // ワークベンチはウォレットの対応関係を持たないため省略する
              // （実環境の「解決できなければ省略」フォールバックと同じ流儀）。
              deployerAddress:
                workbenchId === "workbench-alice" ? ALICE_WALLET : undefined,
              createdByTxHash,
              token: catalogEntry.token,
            };
            return { ok: true, diffs: [{ type: "entityAdded", entity }] };
          }
          case "callContract": {
            if (!deployedContractCatalogKeys.has(operation.contractAddress)) {
              return {
                ok: false,
                error: `not a deployed/cataloged contract: ${operation.contractAddress}`,
              };
            }
            return { ok: true };
          }
        }
      }
    }
  }

  function resolveCommand(commandId: string, command: Command) {
    const result = applyCommand(command);
    if (result.diffs && result.diffs.length > 0) handlers.onDiff?.(result.diffs);
    handlers.onCommandResult?.(commandId, result.ok, result.error);
  }

  return {
    connect() {
      if (status === "connected") return;
      setStatus("connected");
      resetTxState();
      handlers.onSnapshot?.(createMockSnapshot());

      if (intervalMs > 0) {
        timer = setInterval(() => {
          blockHeight += 1;
          handlers.onDiff?.([
            {
              type: "entityUpdated",
              id: "reth-node-1",
              patch: { blockHeight, headBlockHash: `0x${blockHeight}` },
            },
            {
              type: "entityUpdated",
              id: "reth-node-2",
              patch: { blockHeight },
            },
            // 毎 tick、workbench-alice が新しい tx を投入する（advanceTxLifecycle）。
            // その裏で走る RPC 呼び出し（cast send 相当）を操作エッジとして観測させ、
            // ワークベンチ → reth-node-1 のパルスを流す。
            mockOperationObserved("eth_sendRawTransaction"),
            // D層: 内部リンク（beacon → reth の Engine API 呼び出し）の
            // 活動パルスをオフラインで確認できるようにする（Issue #188）。
            mockNodeLinkActivity(),
            ...advanceTxLifecycle(),
          ]);
        }, intervalMs);
      }
    },

    disconnect() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const t of commandTimers) clearTimeout(t);
      commandTimers.clear();
      setStatus("disconnected");
    },

    sendCommand(command) {
      const commandId = `mock-cmd-${++counter}`;
      // sendCommand の呼び出し側（useCommands）が commandId を pending へ記録
      // し終えてから結果を返すよう、必ず非同期で resolve する。
      if (commandLatencyMs > 0) {
        const t = setTimeout(() => {
          commandTimers.delete(t);
          resolveCommand(commandId, command);
        }, commandLatencyMs);
        commandTimers.add(t);
      } else {
        queueMicrotask(() => resolveCommand(commandId, command));
      }
      return commandId;
    },

    getStatus() {
      return status;
    },
  };
}
