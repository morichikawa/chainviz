import type {
  NodeEntity,
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

const workbench: WorkbenchEntity = {
  kind: "workbench",
  id: "workbench-alice",
  containerName: "chainviz-workbench-alice",
  ip: "172.20.0.30",
  ports: [],
  resources: { cpuPercent: 0.3, memMB: 64 },
  process: { name: "foundry" },
  label: "Alice",
  walletIds: [],
};

/** collector 不在でも UI を確認するためのモックスナップショット。 */
export function createMockSnapshot(): WorldStateSnapshot {
  return {
    chainType: "ethereum",
    timestamp: Date.now(),
    entities: [rethNode(1, 128), rethNode(2, 128), lighthouseNode, workbench],
    edges: [],
  };
}

export interface MockClientOptions {
  /** ブロック高を進める diff の送出間隔(ms)。0 以下でタイマーを起動しない。 */
  intervalMs?: number;
}

/**
 * collector と同じ ChainvizClient インターフェースを満たすモック。
 * connect 時に snapshot を1回流し、以後は定期的に blockHeight を進める diff を
 * 送る（間隔は intervalMs、テストでは 0 を渡してタイマーを止められる）。
 */
export function createMockClient(
  handlers: ChainvizClientHandlers,
  options: MockClientOptions = {},
): ChainvizClient {
  const intervalMs = options.intervalMs ?? 3000;
  let status: ConnectionStatus = "disconnected";
  let timer: ReturnType<typeof setInterval> | null = null;
  let blockHeight = 128;
  let counter = 0;

  function setStatus(next: ConnectionStatus) {
    if (status === next) return;
    status = next;
    handlers.onStatusChange?.(next);
  }

  return {
    connect() {
      if (status === "connected") return;
      setStatus("connected");
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
          ]);
        }, intervalMs);
      }
    },

    disconnect() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      setStatus("disconnected");
    },

    sendCommand() {
      // モックは操作コマンドを受け付けるが何もしない。
      return `mock-cmd-${++counter}`;
    },

    getStatus() {
      return status;
    },
  };
}
