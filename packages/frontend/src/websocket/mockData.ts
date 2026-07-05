import type {
  Command,
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
};

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
    recentTxHashes: [ALICE_TX1],
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
    recentTxHashes: [BOB_TX1],
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

/** collector 不在でも UI を確認するためのモックスナップショット。 */
export function createMockSnapshot(): WorldStateSnapshot {
  return {
    chainType: "ethereum",
    timestamp: Date.now(),
    entities: [
      rethNode(1, 128),
      rethNode(2, 128),
      lighthouseNode,
      workbench,
      aliceWallet(),
      bobWallet(),
      safeWallet(),
      alicePendingTx(),
      bobIncludedTx(),
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

/** addNode で追加するフォロワー reth ノード（同期中から始まる）。 */
function newFollowerNode(seq: number): NodeEntity {
  return {
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
  };
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
  };
}

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

  // C層 tx ライフサイクルの live シミュレーション状態。connect のたびに
  // resetTxState で初期化し、送出するスナップショットと整合させる。
  let aliceNonce = INITIAL_ALICE_NONCE;
  let aliceBalanceWei = INITIAL_ALICE_BALANCE_WEI;
  let aliceRecent: string[] = [ALICE_TX1];
  let pendingHash: string | null = ALICE_TX1;
  let txSeq = 0;

  function resetTxState() {
    aliceNonce = INITIAL_ALICE_NONCE;
    aliceBalanceWei = INITIAL_ALICE_BALANCE_WEI;
    aliceRecent = [ALICE_TX1];
    pendingHash = ALICE_TX1;
    txSeq = 0;
  }

  /**
   * 1 tick 分の tx ライフサイクルを進める差分を返す。前回 pending だった tx を
   * included に確定させて Alice の nonce/残高を更新し、新しい pending tx を
   * mempool へ投入する。recentTxHashes からあふれた古い tx は掃除する。
   */
  function advanceTxLifecycle(): DiffEvent[] {
    const diffs: DiffEvent[] = [];

    if (pendingHash) {
      const blockHash = `0x${blockHeight.toString(16).padStart(8, "0")}`;
      diffs.push({
        type: "entityUpdated",
        id: pendingHash,
        patch: { status: "included", blockHash },
      });
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
    diffs.push({
      type: "entityAdded",
      entity: {
        kind: "transaction",
        hash,
        from: ALICE_WALLET,
        to: BOB_WALLET,
        status: "pending",
      },
    });

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

  /** コマンドを適用し、流す diff と結果を返す。 */
  function applyCommand(command: Command): { ok: boolean; error?: string; diff?: DiffEvent } {
    switch (command.action) {
      case "addNode": {
        const node = newFollowerNode(++entitySeq);
        nodeIds.add(node.id);
        return { ok: true, diff: { type: "entityAdded", entity: node } };
      }
      case "addWorkbench": {
        const wb = newWorkbench(++entitySeq, command.label);
        workbenchIds.add(wb.id);
        return { ok: true, diff: { type: "entityAdded", entity: wb } };
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
          diff: { type: "entityRemoved", id: command.nodeId },
        };
      }
      case "removeWorkbench": {
        if (!workbenchIds.has(command.workbenchId)) {
          return { ok: false, error: `workbench not found: ${command.workbenchId}` };
        }
        workbenchIds.delete(command.workbenchId);
        return {
          ok: true,
          diff: { type: "entityRemoved", id: command.workbenchId },
        };
      }
    }
  }

  function resolveCommand(commandId: string, command: Command) {
    const result = applyCommand(command);
    if (result.diff) handlers.onDiff?.([result.diff]);
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
