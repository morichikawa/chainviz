export type ChainType = "ethereum";

export interface InfraEntity {
  id: string;
  containerName: string;
  ip: string;
  ports: number[];
  resources: { cpuPercent: number; memMB: number };
  process: { name: string; version?: string };
}

export interface NodeEntity extends InfraEntity {
  kind: "node";
  chainType: ChainType;
  clientType: string;
  syncStatus: "syncing" | "synced";
  blockHeight: number;
  headBlockHash: string;
}

export interface WorkbenchEntity extends InfraEntity {
  kind: "workbench";
  label: string;
  walletIds: string[];
}

export interface PeerEdge {
  kind: "peer";
  fromNodeId: string;
  toNodeId: string;
  networkId: string;
}

export interface WalletEntity {
  kind: "wallet";
  address: string;
  chainType: ChainType;
  balance: string;
  nonce: number;
  isSmartAccount: boolean;
  ownerWorkbenchId: string | null;
  recentTxHashes: string[];
}

export interface BlockEntity {
  kind: "block";
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
  receivedAt: Record<string, number>;
}

export interface TransactionEntity {
  kind: "transaction";
  hash: string;
  from: string;
  to: string | null;
  status: "pending" | "included" | "failed";
  blockHash?: string;
}

export interface ContractEntity {
  kind: "contract";
  address: string;
  abiRef?: string;
}

export interface UserOperationEntity {
  kind: "userOperation";
  hash: string;
  sender: string;
  status: "altMempool" | "bundled" | "included";
}

export type WorldStateEntity =
  | NodeEntity
  | WorkbenchEntity
  | WalletEntity
  | BlockEntity
  | TransactionEntity
  | ContractEntity
  | UserOperationEntity;

export interface WorldStateSnapshot {
  chainType: ChainType;
  timestamp: number;
  entities: WorldStateEntity[];
  edges: PeerEdge[];
}
