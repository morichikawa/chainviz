import type {
  BlockEntity,
  ContractEntity,
  NodeEntity,
  TransactionEntity,
  WorkbenchEntity,
} from "@chainviz/shared";

/**
 * comms-log の各テストファイル（derive/dedup/filter/hook）が共通で使う、
 * 最小構成のワールドステートエンティティ・フィクスチャ。1ファイル1責務の
 * 原則をテストファイルにも適用する（CLAUDE.md）ため、フィクスチャ生成
 * だけをここへ集約し、重複を避ける。
 */

export function testNode(overrides: Partial<NodeEntity> & { id: string }): NodeEntity {
  return {
    kind: "node",
    containerName: overrides.id,
    ip: "172.20.0.10",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 256 },
    process: { name: "node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 0,
    headBlockHash: "",
    ...overrides,
  };
}

export function testWorkbench(
  overrides: Partial<WorkbenchEntity> & { id: string; label: string },
): WorkbenchEntity {
  return {
    kind: "workbench",
    containerName: overrides.id,
    ip: "172.20.0.20",
    ports: [],
    resources: { cpuPercent: 0, memMB: 64 },
    process: { name: "workbench" },
    walletIds: [],
    ...overrides,
  };
}

export function testContract(
  overrides: Partial<ContractEntity> & { address: string },
): ContractEntity {
  return {
    kind: "contract",
    chainType: "ethereum",
    ...overrides,
  };
}

export function testBlock(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 1,
    parentHash: "0xparent",
    timestamp: 1_000,
    receivedAt: {},
    ...overrides,
  };
}

export function testTransaction(
  overrides: Partial<TransactionEntity> & { hash: string },
): TransactionEntity {
  return {
    kind: "transaction",
    from: "0xfrom",
    to: "0xto",
    status: "pending",
    ...overrides,
  };
}
