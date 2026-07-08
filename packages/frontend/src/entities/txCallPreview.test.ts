import type { ContractEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { deriveTxCallPreview, MAX_ARG_PREVIEW } from "./txCallPreview.js";

const CONTRACT_ADDRESS = `0x${"c".repeat(40)}`;
const UNKNOWN_CONTRACT_ADDRESS = `0x${"d".repeat(40)}`;
const DEPLOYED_CONTRACT_ADDRESS = `0x${"e".repeat(40)}`;

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: CONTRACT_ADDRESS,
    chainType: "ethereum",
    name: "ChainvizToken",
    ...overrides,
  };
}

function baseTx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: `0x${"1".repeat(64)}`,
    from: `0x${"a".repeat(40)}`,
    to: CONTRACT_ADDRESS,
    status: "included",
    ...overrides,
  };
}

describe("deriveTxCallPreview", () => {
  it("returns undefined for a plain transfer with no contract info", () => {
    expect(deriveTxCallPreview(baseTx(), new Map())).toBeUndefined();
  });

  it("uses the decoded function name and resolves the contract name", () => {
    const tx = baseTx({
      contractCall: {
        contractAddress: CONTRACT_ADDRESS,
        functionName: "transfer",
        args: [
          { name: "to", value: `0x${"b".repeat(40)}` },
          { name: "amount", value: "1000000000000000000" },
        ],
      },
    });
    const byAddress = new Map([[CONTRACT_ADDRESS, contract()]]);
    const preview = deriveTxCallPreview(tx, byAddress);

    expect(preview).toEqual({
      kind: "call",
      label: "transfer",
      argsPreview: [
        { name: "to", value: `0x${"b".repeat(40)}` },
        { name: "amount", value: "1000000000000000000" },
      ],
      contractAddress: CONTRACT_ADDRESS,
      contractName: "ChainvizToken",
    });
  });

  it("caps the args preview at MAX_ARG_PREVIEW entries", () => {
    const tx = baseTx({
      contractCall: {
        contractAddress: CONTRACT_ADDRESS,
        functionName: "swap",
        args: [
          { name: "a", value: "1" },
          { name: "b", value: "2" },
          { name: "c", value: "3" },
        ],
      },
    });
    const preview = deriveTxCallPreview(tx, new Map());
    expect(preview?.argsPreview).toHaveLength(MAX_ARG_PREVIEW);
    expect(preview?.argsPreview.map((a) => a.name)).toEqual(["a", "b"]);
  });

  it("falls back to a shortened rawFunctionId when undecoded", () => {
    const tx = baseTx({
      contractCall: {
        contractAddress: UNKNOWN_CONTRACT_ADDRESS,
        rawFunctionId: "0xa9059cbb",
      },
      to: UNKNOWN_CONTRACT_ADDRESS,
    });
    const preview = deriveTxCallPreview(tx, new Map());
    expect(preview?.kind).toBe("call");
    expect(preview?.label).toBe("0xa9059cbb");
    expect(preview?.contractName).toBeUndefined();
  });

  it("falls back to a shortened tx hash when neither functionName nor rawFunctionId is present", () => {
    const tx = baseTx({
      contractCall: { contractAddress: CONTRACT_ADDRESS },
    });
    const preview = deriveTxCallPreview(tx, new Map());
    expect(preview?.kind).toBe("call");
    expect(preview?.label).toBe(`0x${"1".repeat(6)}…${"1".repeat(4)}`);
  });

  it("treats a deploy tx (createdContractAddress) as kind 'deploy' with no label", () => {
    const tx = baseTx({
      to: null,
      createdContractAddress: DEPLOYED_CONTRACT_ADDRESS,
    });
    const byAddress = new Map([
      [DEPLOYED_CONTRACT_ADDRESS, contract({ address: DEPLOYED_CONTRACT_ADDRESS, name: "Counter" })],
    ]);
    const preview = deriveTxCallPreview(tx, byAddress);

    expect(preview).toEqual({
      kind: "deploy",
      argsPreview: [],
      contractAddress: DEPLOYED_CONTRACT_ADDRESS,
      contractName: "Counter",
    });
  });

  it("prioritizes deploy over a rawFunctionId when both are present (matches txChipLabel's priority order)", () => {
    // 実運用ではデプロイ tx は to: null かつ contractCall を持たないため
    // 同居しないが、判定順序を transaction.ts の txChipLabel と揃えるための
    // 回帰テスト（Issue #166 差し戻し対応の軽微な指摘）。
    const tx = baseTx({
      to: null,
      createdContractAddress: DEPLOYED_CONTRACT_ADDRESS,
      contractCall: {
        contractAddress: CONTRACT_ADDRESS,
        rawFunctionId: "0xa9059cbb",
      },
    });
    const preview = deriveTxCallPreview(tx, new Map());
    expect(preview?.kind).toBe("deploy");
    expect(preview?.contractAddress).toBe(DEPLOYED_CONTRACT_ADDRESS);
  });

  it("leaves contractName undefined for a contract not present in the lookup", () => {
    const tx = baseTx({
      contractCall: { contractAddress: UNKNOWN_CONTRACT_ADDRESS, functionName: "call" },
      to: UNKNOWN_CONTRACT_ADDRESS,
    });
    const preview = deriveTxCallPreview(tx, new Map());
    expect(preview?.contractName).toBeUndefined();
    expect(preview?.contractAddress).toBe(UNKNOWN_CONTRACT_ADDRESS);
  });
});
