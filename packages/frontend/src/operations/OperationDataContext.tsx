import { type ReactNode, createContext, useContext } from "react";
import type { DeployedContractCandidate } from "./deployedContracts.js";
import type { WalletCandidate } from "./walletCandidates.js";

/**
 * 操作パネル（送金/デプロイ/呼び出しフォーム）が必要とする、キャンバス上の
 * 「今」の候補一覧（既存ウォレット・呼び出し可能なデプロイ済みコントラクト）。
 *
 * これらは React Flow のノード（InfraFlowNode）の一部としては渡さない。
 * ノード側は Issue #119 対策の `stabilizeNodes`（entity/position が変化して
 * いないノードは前回のオブジェクト参照をそのまま再利用する）を経由するため、
 * ノードの data にこの一覧を含めてしまうと、対象ワークベンチのカード自体が
 * 見た目上変化していない間は新しい候補（新規ウォレット・新規コントラクトの
 * 出現）が古いまま固定されてしまう（isSameInfraNode は entity/position しか
 * 比較しないため）。React Context 経由にすることで、操作パネルが開かれた
 * ときにだけ最新の一覧を読みに行く（CommandActionsContext と同じ、React
 * Flow ノードの内側からキャンバス全体の状態へアクセスするための仕組み）。
 */
export interface OperationDataValue {
  walletCandidates: WalletCandidate[];
  deployedContracts: DeployedContractCandidate[];
}

const OperationDataContext = createContext<OperationDataValue | null>(null);

export interface OperationDataProviderProps {
  value: OperationDataValue;
  children: ReactNode;
}

export function OperationDataProvider({
  value,
  children,
}: OperationDataProviderProps) {
  return (
    <OperationDataContext.Provider value={value}>
      {children}
    </OperationDataContext.Provider>
  );
}

/** Provider 配下で操作パネル用の候補一覧を取り出す。 */
export function useOperationData(): OperationDataValue {
  const ctx = useContext(OperationDataContext);
  if (!ctx) {
    throw new Error(
      "useOperationData must be used within an OperationDataProvider",
    );
  }
  return ctx;
}
