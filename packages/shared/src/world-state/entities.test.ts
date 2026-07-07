import { describe, expect, it } from "vitest";
import type {
  ContractCall,
  ContractEntity,
  ContractEvent,
  DecodedArgument,
  NodeEntity,
  OperationEdge,
  PeerEdge,
  TokenBalance,
  TransactionEntity,
  WalletEntity,
  WorkbenchEntity,
  WorldStateEdge,
  WorldStateEntity,
  WorldStateSnapshot,
} from "./entities.js";

describe("world-state entities", () => {
  it("accepts a wallet with no owning workbench (deleted case)", () => {
    const wallet: WalletEntity = {
      kind: "wallet",
      address: "0x0000000000000000000000000000000000dEaD",
      chainType: "ethereum",
      balance: "0",
      nonce: 0,
      isSmartAccount: false,
      ownerWorkbenchId: null,
      recentTxHashes: [],
    };

    expect(wallet.ownerWorkbenchId).toBeNull();
  });

  it("builds an empty snapshot", () => {
    const snapshot: WorldStateSnapshot = {
      chainType: "ethereum",
      timestamp: Date.now(),
      entities: [],
      edges: [],
    };

    expect(snapshot.entities).toHaveLength(0);
  });

  it("marks an addNode-created node as removable", () => {
    const added: NodeEntity = {
      kind: "node",
      id: "node-3",
      containerName: "chainviz-node-3",
      ip: "172.28.1.3",
      ports: [8545],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "reth" },
      chainType: "ethereum",
      clientType: "reth",
      syncStatus: "syncing",
      blockHeight: 0,
      headBlockHash: "",
      removable: true,
    };

    expect(added.removable).toBe(true);
  });

  it("treats an entity without the removable flag as non-removable (omitted = false)", () => {
    // compose 起動時からある初期構成のコンテナ、またはフィールド追加前の
    // 旧スナップショット。省略は「削除不可」の安全側に倒す。
    const composeLaunched: WorkbenchEntity = {
      kind: "workbench",
      id: "workbench-1",
      containerName: "chainviz-workbench-1",
      ip: "172.28.3.1",
      ports: [],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "foundry" },
      label: "workbench",
      walletIds: [],
    };

    expect(composeLaunched.removable).toBeUndefined();
    expect(composeLaunched.removable ?? false).toBe(false);
  });

  it("preserves the removable flag across JSON serialization (snapshot/diff の往復)", () => {
    // collector → frontend は WebSocket 上で JSON にシリアライズされて渡る。
    // true/false が往復で崩れないことを確認する。
    const removableNode: NodeEntity = {
      kind: "node",
      id: "node-3",
      containerName: "chainviz-node-3",
      ip: "172.28.1.3",
      ports: [8545],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "reth" },
      chainType: "ethereum",
      clientType: "reth",
      syncStatus: "syncing",
      blockHeight: 0,
      headBlockHash: "",
      removable: true,
    };
    const roundTripped = JSON.parse(
      JSON.stringify(removableNode),
    ) as NodeEntity;
    expect(roundTripped.removable).toBe(true);

    const nonRemovable = JSON.parse(
      JSON.stringify({ ...removableNode, removable: false }),
    ) as NodeEntity;
    expect(nonRemovable.removable).toBe(false);
  });

  it("drops an omitted removable flag through JSON, keeping omitted = false semantics", () => {
    // 省略時（= 削除不可）の意味論が collector-frontend 間で一致すること。
    // JSON.stringify は undefined のプロパティを落とすため、旧 collector が
    // 送るスナップショットにはキー自体が現れず、受信側は同じく「省略 = false」
    // として解釈できる。
    const composeLaunched: WorkbenchEntity = {
      kind: "workbench",
      id: "workbench-1",
      containerName: "chainviz-workbench-1",
      ip: "172.28.3.1",
      ports: [],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "foundry" },
      label: "workbench",
      walletIds: [],
      removable: undefined,
    };
    const serialized = JSON.stringify(composeLaunched);
    expect(serialized).not.toContain("removable");

    const parsed = JSON.parse(serialized) as WorkbenchEntity;
    expect(parsed.removable).toBeUndefined();
    // 受信側の「true のときだけ削除 UI を出す」判定と同じ帰結になる。
    expect(parsed.removable === true).toBe(false);
    expect(parsed.removable ?? false).toBe(false);
  });

  it("preserves p2pRole across JSON serialization (bootnode / peer)", () => {
    // collector → frontend は WebSocket 上で JSON にシリアライズされて渡る。
    // "bootnode" / "peer" の両値が往復で崩れないことを確認する。
    const bootnode: NodeEntity = {
      kind: "node",
      id: "node-1",
      containerName: "chainviz-ethereum-reth1",
      ip: "172.28.1.1",
      ports: [8545],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "reth" },
      chainType: "ethereum",
      clientType: "reth",
      syncStatus: "synced",
      blockHeight: 100,
      headBlockHash: "0xabc",
      p2pRole: "bootnode",
    };
    const roundTripped = JSON.parse(JSON.stringify(bootnode)) as NodeEntity;
    expect(roundTripped.p2pRole).toBe("bootnode");

    const peer = JSON.parse(
      JSON.stringify({ ...bootnode, p2pRole: "peer" }),
    ) as NodeEntity;
    expect(peer.p2pRole).toBe("peer");
  });

  it("treats an omitted p2pRole as unknown (not a bootnode)", () => {
    // フィールド未付与の旧スナップショット（旧 collector）。省略は「不明」で
    // あり、フロントの判定は p2pRole === "bootnode" のみなので、省略時は
    // ブートノード前提の表示を出さない安全側に倒れる。
    const legacy: NodeEntity = {
      kind: "node",
      id: "node-2",
      containerName: "chainviz-ethereum-reth2",
      ip: "172.28.1.2",
      ports: [8545],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "reth" },
      chainType: "ethereum",
      clientType: "reth",
      syncStatus: "synced",
      blockHeight: 100,
      headBlockHash: "0xabc",
    };
    expect(legacy.p2pRole).toBeUndefined();
    expect(legacy.p2pRole === "bootnode").toBe(false);

    // JSON.stringify は undefined のプロパティを落とすため、旧 collector が
    // 送るスナップショットと同じくキー自体が現れない。
    const serialized = JSON.stringify({ ...legacy, p2pRole: undefined });
    expect(serialized).not.toContain("p2pRole");
  });

  it("carries the workbench RPC target as rpcTargetNodeId, omitted when unresolved", () => {
    const resolved: WorkbenchEntity = {
      kind: "workbench",
      id: "workbench-alice",
      containerName: "chainviz-ethereum-alice",
      ip: "172.28.3.1",
      ports: [],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "foundry" },
      label: "alice",
      walletIds: [],
      rpcTargetNodeId: "node-1",
    };
    const roundTripped = JSON.parse(
      JSON.stringify(resolved),
    ) as WorkbenchEntity;
    expect(roundTripped.rpcTargetNodeId).toBe("node-1");

    // 解決不能・旧スナップショットでは省略（null は使わない）。フロントは
    // 値が無ければ操作先の表示を出さないフォールバックに倒す。
    const unresolved: WorkbenchEntity = { ...resolved };
    delete unresolved.rpcTargetNodeId;
    const serialized = JSON.stringify(unresolved);
    expect(serialized).not.toContain("rpcTargetNodeId");
    const parsed = JSON.parse(serialized) as WorkbenchEntity;
    expect(parsed.rpcTargetNodeId).toBeUndefined();
  });

  it("represents a cataloged contract with metadata, preserved across JSON", () => {
    // collector → frontend は WebSocket 上で JSON にシリアライズされて渡る。
    // カタログ由来のメタ情報（name / catalogKey / token）が往復で崩れないこと。
    const contract: ContractEntity = {
      kind: "contract",
      address: "0x00000000000000000000000000000000000c0de",
      chainType: "ethereum",
      name: "ChainvizToken",
      catalogKey: "chainviz-token",
      deployerAddress: "0x0000000000000000000000000000000000a11ce",
      createdByTxHash: "0xdeadbeef",
      token: { symbol: "CVT", decimals: 18 },
    };
    const roundTripped = JSON.parse(JSON.stringify(contract)) as ContractEntity;
    expect(roundTripped.name).toBe("ChainvizToken");
    expect(roundTripped.catalogKey).toBe("chainviz-token");
    expect(roundTripped.token).toEqual({ symbol: "CVT", decimals: 18 });
  });

  it("represents an unknown contract with only address (all catalog fields omitted)", () => {
    // カタログ外のコントラクト（ユーザーが独自にデプロイしたもの）。
    // 省略フィールドは JSON にキー自体が現れず、「未知のコントラクト」として
    // 表示する判定（name が無い）に安全に倒れる。
    const unknown: ContractEntity = {
      kind: "contract",
      address: "0x000000000000000000000000000000000000f00d",
      chainType: "ethereum",
    };
    const serialized = JSON.stringify(unknown);
    expect(serialized).not.toContain("catalogKey");
    expect(serialized).not.toContain("name");
    const parsed = JSON.parse(serialized) as ContractEntity;
    expect(parsed.name).toBeUndefined();
  });

  it("carries decoded contract call and events on a transaction", () => {
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1234",
      from: "0x0000000000000000000000000000000000a11ce",
      to: "0x00000000000000000000000000000000000c0de",
      status: "included",
      blockHash: "0xabc",
      contractCall: {
        contractAddress: "0x00000000000000000000000000000000000c0de",
        functionName: "transfer",
        args: [
          { name: "to", value: "0x0000000000000000000000000000000000000b0b" },
          { name: "amount", value: "1000000000000000000" },
        ],
      },
      contractEvents: [
        {
          contractAddress: "0x00000000000000000000000000000000000c0de",
          eventName: "Transfer",
          args: [
            { name: "from", value: "0x0000000000000000000000000000000000a11ce" },
            { name: "to", value: "0x0000000000000000000000000000000000000b0b" },
            { name: "value", value: "1000000000000000000" },
          ],
        },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(tx)) as TransactionEntity;
    expect(roundTripped.contractCall?.functionName).toBe("transfer");
    expect(roundTripped.contractEvents).toHaveLength(1);
    expect(roundTripped.contractEvents?.[0].args?.[2].value).toBe(
      "1000000000000000000",
    );
  });

  it("keeps only the raw identifiers when a call/event cannot be decoded", () => {
    // 復号できない呼び出し・イベントはチェーン依存の生の識別子だけを持つ
    // （解釈・表示はフロントのチェーンプロファイル表現セットの責務）。
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x5678",
      from: "0x0000000000000000000000000000000000a11ce",
      to: "0x000000000000000000000000000000000000f00d",
      status: "included",
      contractCall: {
        contractAddress: "0x000000000000000000000000000000000000f00d",
        rawFunctionId: "0xa9059cbb",
      },
      contractEvents: [
        {
          contractAddress: "0x000000000000000000000000000000000000f00d",
          rawEventId: "0xddf252ad",
        },
      ],
    };
    expect(tx.contractCall?.functionName).toBeUndefined();
    expect(tx.contractCall?.rawFunctionId).toBe("0xa9059cbb");
    expect(tx.contractEvents?.[0].eventName).toBeUndefined();
  });

  it("treats a legacy transaction without contract fields as a plain transfer", () => {
    // フィールド未付与の旧スナップショット互換。省略はすべて「情報なし」で、
    // フロントは to と ContractEntity のアドレス照合ができない限り
    // コントラクト関連の表示を出さない側に倒れる。
    const legacy: TransactionEntity = {
      kind: "transaction",
      hash: "0x9999",
      from: "0x0000000000000000000000000000000000a11ce",
      to: "0x0000000000000000000000000000000000000b0b",
      status: "pending",
    };
    expect(legacy.contractCall).toBeUndefined();
    expect(legacy.createdContractAddress).toBeUndefined();
    expect(legacy.contractEvents).toBeUndefined();
    const serialized = JSON.stringify(legacy);
    expect(serialized).not.toContain("contractCall");
    expect(serialized).not.toContain("contractEvents");
  });

  it("records the created contract address on a deployment transaction", () => {
    const deployTx: TransactionEntity = {
      kind: "transaction",
      hash: "0xdep1",
      from: "0x0000000000000000000000000000000000a11ce",
      to: null, // コントラクト作成 tx は to を持たない
      status: "included",
      createdContractAddress: "0x00000000000000000000000000000000000c0de",
    };
    const roundTripped = JSON.parse(JSON.stringify(deployTx)) as TransactionEntity;
    expect(roundTripped.to).toBeNull();
    expect(roundTripped.createdContractAddress).toBe(
      "0x00000000000000000000000000000000000c0de",
    );
  });

  it("carries wallet token balances, omitted when not tracked", () => {
    const withTokens: WalletEntity = {
      kind: "wallet",
      address: "0x0000000000000000000000000000000000a11ce",
      chainType: "ethereum",
      balance: "1000",
      nonce: 1,
      isSmartAccount: false,
      ownerWorkbenchId: "workbench-alice",
      recentTxHashes: [],
      tokenBalances: [
        {
          contractAddress: "0x00000000000000000000000000000000000c0de",
          amount: "5000000000000000000",
        },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(withTokens)) as WalletEntity;
    expect(roundTripped.tokenBalances?.[0].amount).toBe("5000000000000000000");

    // トークン未追跡・旧スナップショットでは省略（キー自体が現れない）。
    const withoutTokens: WalletEntity = { ...withTokens };
    delete withoutTokens.tokenBalances;
    expect(JSON.stringify(withoutTokens)).not.toContain("tokenBalances");
  });

  it("represents a workbench-to-node call as an OperationEdge", () => {
    const edge: OperationEdge = {
      kind: "operation",
      fromWorkbenchId: "workbench-alice",
      toNodeId: "node-1",
      operation: "sendRawTransaction",
      observedAt: 1_700_000_000_000,
    };

    expect(edge.fromWorkbenchId).toBe("workbench-alice");
    expect(edge.toNodeId).toBe("node-1");
    expect(edge.operation).toBe("sendRawTransaction");
  });

  it("discriminates WorldStateEdge members by kind", () => {
    const peer: PeerEdge = {
      kind: "peer",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      networkId: "chainviz-net",
    };
    const operation: OperationEdge = {
      kind: "operation",
      fromWorkbenchId: "workbench-alice",
      toNodeId: "node-1",
      operation: "call",
      observedAt: 1_700_000_000_000,
    };
    const edges: WorldStateEdge[] = [peer, operation];

    const described = edges.map((edge) => {
      // kind による判別で各メンバーの固有フィールドへ安全に絞り込めること
      // （コンパイル時の検証を兼ねる）。
      switch (edge.kind) {
        case "peer":
          return `${edge.fromNodeId}->${edge.toNodeId}`;
        case "operation":
          return `${edge.fromWorkbenchId}->${edge.toNodeId}:${edge.operation}`;
      }
    });

    expect(described).toEqual([
      "node-1->node-2",
      "workbench-alice->node-1:call",
    ]);
  });
});
