import { describe, expect, it } from "vitest";
import type {
  ContractCall,
  ContractEntity,
  ContractEvent,
  DecodedArgument,
  NodeEntity,
  NodeInternals,
  NodeLinkActivity,
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
      // カタログキーは Solidity のコントラクト名そのまま（PascalCase）を使う
      // 実装（profiles/ethereum/contracts/catalog.json）に合わせる（Issue #161）。
      catalogKey: "ChainvizToken",
      deployerAddress: "0x0000000000000000000000000000000000a11ce",
      createdByTxHash: "0xdeadbeef",
      token: { symbol: "CVT", decimals: 18 },
    };
    const roundTripped = JSON.parse(JSON.stringify(contract)) as ContractEntity;
    expect(roundTripped.name).toBe("ChainvizToken");
    expect(roundTripped.catalogKey).toBe("ChainvizToken");
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

  it("discriminates a ContractEntity within the WorldStateEntity union by kind", () => {
    // Phase 4 で ContractEntity は既に WorldStateEntity 共用体のメンバー。
    // kind による絞り込みで contract 固有フィールドへ安全に到達できること
    // （コンパイル時の検証を兼ねる）。他メンバーと取り違えないことを確認する。
    const contract: WorldStateEntity = {
      kind: "contract",
      address: "0x00000000000000000000000000000000000c0de",
      chainType: "ethereum",
      name: "ChainvizToken",
    };
    const wallet: WorldStateEntity = {
      kind: "wallet",
      address: "0x0000000000000000000000000000000000a11ce",
      chainType: "ethereum",
      balance: "0",
      nonce: 0,
      isSmartAccount: false,
      ownerWorkbenchId: null,
      recentTxHashes: [],
    };
    const entities: WorldStateEntity[] = [contract, wallet];

    const names = entities.map((entity) => {
      switch (entity.kind) {
        case "contract":
          return `contract:${entity.name ?? "unknown"}`;
        case "wallet":
          return `wallet:${entity.address}`;
        default:
          return `other:${entity.kind}`;
      }
    });

    expect(names).toEqual([
      "contract:ChainvizToken",
      "wallet:0x0000000000000000000000000000000000a11ce",
    ]);
  });

  it("accepts a ContractCall carrying only contractAddress (neither decoded nor raw)", () => {
    // contractAddress 以外はすべて optional。関数名も rawFunctionId も付かない
    // 呼び出し（宛先だけ判っている最小ケース）が型として成立し、フロントは
    // 名前が無い＝関数名を出さない側に安全に倒れることを確認する。
    const bare: ContractCall = {
      contractAddress: "0x00000000000000000000000000000000000c0de",
    };
    const serialized = JSON.stringify(bare);
    expect(serialized).not.toContain("functionName");
    expect(serialized).not.toContain("rawFunctionId");
    expect(serialized).not.toContain("args");
    const parsed = JSON.parse(serialized) as ContractCall;
    expect(parsed.contractAddress).toBe(
      "0x00000000000000000000000000000000000c0de",
    );
    expect(parsed.functionName).toBeUndefined();
    expect(parsed.rawFunctionId).toBeUndefined();
  });

  it("accepts a ContractEvent carrying only contractAddress", () => {
    const bare: ContractEvent = {
      contractAddress: "0x00000000000000000000000000000000000c0de",
    };
    const serialized = JSON.stringify(bare);
    expect(serialized).not.toContain("eventName");
    expect(serialized).not.toContain("rawEventId");
    const parsed = JSON.parse(serialized) as ContractEvent;
    expect(parsed.eventName).toBeUndefined();
    expect(parsed.rawEventId).toBeUndefined();
  });

  it("distinguishes a decoded no-arg call (empty args array) from an omitted args", () => {
    // 引数ゼロの関数（例: increment()）を復号できたケースは args: [] を持つ。
    // これは「復号できず args 自体が無い」ケースと意味が異なる。空配列が
    // JSON 往復で保持され、[] と undefined を取り違えないことを確認する。
    const decodedNoArgs: ContractCall = {
      contractAddress: "0x00000000000000000000000000000000000c0de",
      functionName: "increment",
      args: [],
    };
    const roundTripped = JSON.parse(
      JSON.stringify(decodedNoArgs),
    ) as ContractCall;
    expect(roundTripped.args).toEqual([]);
    expect(roundTripped.args).toHaveLength(0);
    expect(roundTripped.args).not.toBeUndefined();

    const notDecoded: ContractCall = {
      contractAddress: "0x00000000000000000000000000000000000c0de",
      rawFunctionId: "0xd09de08a",
    };
    expect(notDecoded.args).toBeUndefined();
  });

  it("keeps a DecodedArgument value as a string, avoiding numeric precision loss", () => {
    // 大きな整数は数値化せず文字列で持つ設計。JSON 往復でも文字列のまま崩れ
    // ないこと、名前・値ともに空文字を許容する境界を確認する。
    const huge: DecodedArgument = {
      name: "amount",
      value: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    };
    const roundTripped = JSON.parse(JSON.stringify(huge)) as DecodedArgument;
    expect(typeof roundTripped.value).toBe("string");
    expect(roundTripped.value).toBe(huge.value);

    // 引数名が空（匿名引数など）でも型として成立する境界。
    const anonymous: DecodedArgument = { name: "", value: "0" };
    expect(anonymous.name).toBe("");
  });

  it("preserves a token with zero decimals across JSON (falsy 0 must survive)", () => {
    // decimals: 0 のトークン（NFT 相当・整数トークン）。0 は falsy だが
    // JSON.stringify は数値 0 を保持する。amount の解釈がずれないよう、
    // 0 がキーごと欠落しないことを確認する。
    const contract: ContractEntity = {
      kind: "contract",
      address: "0x00000000000000000000000000000000000c0de",
      chainType: "ethereum",
      token: { symbol: "PT", decimals: 0 },
    };
    const serialized = JSON.stringify(contract);
    expect(serialized).toContain('"decimals":0');
    const parsed = JSON.parse(serialized) as ContractEntity;
    expect(parsed.token?.decimals).toBe(0);
  });

  it("carries multiple token balances and distinguishes an empty array from omission", () => {
    // 複数トークンの残高一覧、および「追跡中だが残高ゼロ件（空配列）」と
    // 「トークン未追跡（省略）」の区別。空配列は JSON 往復で保持される。
    const balances: TokenBalance[] = [
      {
        contractAddress: "0x00000000000000000000000000000000000c0de",
        amount: "5000000000000000000",
      },
      {
        contractAddress: "0x000000000000000000000000000000000000f00d",
        amount: "0",
      },
    ];
    const wallet: WalletEntity = {
      kind: "wallet",
      address: "0x0000000000000000000000000000000000a11ce",
      chainType: "ethereum",
      balance: "1000",
      nonce: 1,
      isSmartAccount: false,
      ownerWorkbenchId: "workbench-alice",
      recentTxHashes: [],
      tokenBalances: balances,
    };
    const roundTripped = JSON.parse(JSON.stringify(wallet)) as WalletEntity;
    expect(roundTripped.tokenBalances).toHaveLength(2);
    // 残高ゼロは "0" として保持される（キーは残る）。
    expect(roundTripped.tokenBalances?.[1].amount).toBe("0");

    // 追跡中だが 0 件（空配列）は省略（undefined）と区別される。
    const emptyTracked: WalletEntity = { ...wallet, tokenBalances: [] };
    const emptyRoundTripped = JSON.parse(
      JSON.stringify(emptyTracked),
    ) as WalletEntity;
    expect(emptyRoundTripped.tokenBalances).toEqual([]);
    expect(emptyRoundTripped.tokenBalances).not.toBeUndefined();
  });

  it("carries node internals (sync stages / mempool) across JSON, omitted when unobserved", () => {
    // D層: EL ノードが内部メトリクスを公開している場合の NodeEntity。
    // ステージ名はクライアント依存の生の識別子をそのまま持つ（解釈はフロントの
    // チェーンプロファイル表現セットの責務）。
    const internals: NodeInternals = {
      syncStages: [
        { stage: "Headers", checkpoint: 120 },
        { stage: "Bodies", checkpoint: 120 },
        { stage: "Execution", checkpoint: 118 },
      ],
      mempool: { pending: 3, queued: 1 },
    };
    const node: NodeEntity = {
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
      blockHeight: 120,
      headBlockHash: "0xabc",
      internals,
    };
    const roundTripped = JSON.parse(JSON.stringify(node)) as NodeEntity;
    expect(roundTripped.internals?.syncStages).toHaveLength(3);
    expect(roundTripped.internals?.syncStages?.[2]).toEqual({
      stage: "Execution",
      checkpoint: 118,
    });
    expect(roundTripped.internals?.mempool).toEqual({ pending: 3, queued: 1 });

    // メトリクスを公開しないノード・旧スナップショットでは省略（キー自体が
    // 現れない）。フロントは表示を出さない側に倒す。
    const withoutInternals: NodeEntity = { ...node };
    delete withoutInternals.internals;
    const serialized = JSON.stringify(withoutInternals);
    expect(serialized).not.toContain("internals");
    const parsed = JSON.parse(serialized) as NodeEntity;
    expect(parsed.internals).toBeUndefined();
  });

  it("distinguishes partial internals (mempool のみ等) from full internals", () => {
    // NodeInternals の各フィールドは独立に省略できる（観測できたものだけ載る）。
    // mempool だけ観測できたケースが型として成立し、syncStages が無い =
    // ステージ表示を出さない側に安全に倒れることを確認する。
    const mempoolOnly: NodeInternals = { mempool: { pending: 0, queued: 0 } };
    const serialized = JSON.stringify(mempoolOnly);
    expect(serialized).not.toContain("syncStages");
    const parsed = JSON.parse(serialized) as NodeInternals;
    expect(parsed.syncStages).toBeUndefined();
    // pending/queued の 0 は falsy だが JSON 往復で欠落しない。
    expect(parsed.mempool?.pending).toBe(0);
    expect(parsed.mempool?.queued).toBe(0);
  });

  it("carries drivesNodeId on a driving node, omitted when the node drives nothing", () => {
    // D層: beacon（CL）ノードが対の Execution（EL）ノードを駆動する関係。
    const beacon: NodeEntity = {
      kind: "node",
      id: "beacon-1",
      containerName: "chainviz-ethereum-beacon1",
      ip: "172.28.2.1",
      ports: [5052],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "lighthouse" },
      chainType: "ethereum",
      clientType: "lighthouse",
      syncStatus: "synced",
      blockHeight: 0,
      headBlockHash: "",
      drivesNodeId: "node-1",
    };
    const roundTripped = JSON.parse(JSON.stringify(beacon)) as NodeEntity;
    expect(roundTripped.drivesNodeId).toBe("node-1");

    // 駆動関係を持たないノード（EL 側・解決不能・旧スナップショット）では
    // 省略（null は使わない。WorkbenchEntity.rpcTargetNodeId と同じ流儀）。
    const nonDriving: NodeEntity = { ...beacon };
    delete nonDriving.drivesNodeId;
    const serialized = JSON.stringify(nonDriving);
    expect(serialized).not.toContain("drivesNodeId");
    expect((JSON.parse(serialized) as NodeEntity).drivesNodeId).toBeUndefined();
  });

  it("represents internal API call activity as a NodeLinkActivity (増分・揮発性)", () => {
    // 呼び出し 1 回ごとではなく観測間隔内の増分として届く（OperationEdge との
    // 違い）。method はチェーン依存の生の識別子、latencyMs は観測できた場合のみ。
    const activity: NodeLinkActivity = {
      fromNodeId: "beacon-1",
      toNodeId: "node-1",
      calls: [
        { method: "engine_newPayload", count: 2, latencyMs: 12 },
        { method: "engine_forkchoiceUpdated", count: 2 },
      ],
      observedAt: 1_700_000_000_000,
    };
    const roundTripped = JSON.parse(
      JSON.stringify(activity),
    ) as NodeLinkActivity;
    expect(roundTripped.calls).toHaveLength(2);
    expect(roundTripped.calls[0].latencyMs).toBe(12);
    // latencyMs 未観測はキーごと現れない（省略 = 観測不能）。
    expect(JSON.stringify(roundTripped.calls[1])).not.toContain("latencyMs");
  });

  it("distinguishes empty NodeInternals fields (observed-but-zero) from full omission", () => {
    // 観測はできたが中身が空、という縮退の境界を確認する。
    // - internals: {} …… ノードは observable だが syncStages も mempool も
    //   観測できなかった（両フィールド省略）。フロントは両行とも出さない。
    // - syncStages: [] …… ステージ一覧を観測できたが 0 件（例: パイプライン
    //   同期を行っていないノード）。これは syncStages 省略と意味が異なるので
    //   [] が JSON 往復で保持され、undefined と取り違えないことを確認する。
    const emptyInternals: NodeInternals = {};
    const serializedEmpty = JSON.stringify(emptyInternals);
    expect(serializedEmpty).not.toContain("syncStages");
    expect(serializedEmpty).not.toContain("mempool");
    const parsedEmpty = JSON.parse(serializedEmpty) as NodeInternals;
    expect(parsedEmpty.syncStages).toBeUndefined();
    expect(parsedEmpty.mempool).toBeUndefined();

    const emptyStages: NodeInternals = { syncStages: [] };
    const roundTripped = JSON.parse(
      JSON.stringify(emptyStages),
    ) as NodeInternals;
    expect(roundTripped.syncStages).toEqual([]);
    expect(roundTripped.syncStages).not.toBeUndefined();
    expect(roundTripped.syncStages).toHaveLength(0);
  });

  it("preserves a sync stage checkpoint of 0 across JSON (falsy 0 must survive)", () => {
    // 起動直後・未着手のステージは checkpoint: 0。0 は falsy だが JSON は数値 0
    // を保持する。ステージ名だけ現れて checkpoint がキーごと欠落する、という
    // 崩れが起きないことを確認する（mempool の pending/queued 0 と同じ配慮）。
    const internals: NodeInternals = {
      syncStages: [
        { stage: "Headers", checkpoint: 0 },
        { stage: "Execution", checkpoint: 0 },
      ],
    };
    const serialized = JSON.stringify(internals);
    expect(serialized).toContain('"checkpoint":0');
    const parsed = JSON.parse(serialized) as NodeInternals;
    expect(parsed.syncStages?.[0].checkpoint).toBe(0);
    expect(parsed.syncStages?.[1]).toEqual({ stage: "Execution", checkpoint: 0 });
  });

  it("preserves an InternalCallStats latencyMs of 0 across JSON (falsy 0 must survive)", () => {
    // 所要時間 0ms（サブミリ秒で丸められた等）を観測できたケース。latencyMs は
    // optional だが、0 を観測した場合と「観測できず省略」は意味が異なる。
    // 0 がキーごと欠落せず、undefined と取り違えないことを確認する。
    const observedZero: NodeLinkActivity = {
      fromNodeId: "beacon-1",
      toNodeId: "node-1",
      calls: [{ method: "engine_forkchoiceUpdated", count: 1, latencyMs: 0 }],
      observedAt: 1_700_000_000_000,
    };
    const serialized = JSON.stringify(observedZero);
    expect(serialized).toContain('"latencyMs":0');
    const parsed = JSON.parse(serialized) as NodeLinkActivity;
    expect(parsed.calls[0].latencyMs).toBe(0);
    expect(parsed.calls[0].latencyMs).not.toBeUndefined();
  });

  it("keeps versioned method identifiers raw on InternalCallStats", () => {
    // method は「生の識別子をそのまま載せ、まとめ方はフロントの表現セットが
    // 決める」設計（entities.ts / ARCHITECTURE.md §7.2）。バージョン付きの
    // メソッド名（engine_newPayloadV4 等）を集約・改名せず生のまま持つこと、
    // 同一系統の別バージョンを別エントリとして区別できることを確認する。
    const activity: NodeLinkActivity = {
      fromNodeId: "beacon-1",
      toNodeId: "node-1",
      calls: [
        { method: "engine_newPayloadV3", count: 1 },
        { method: "engine_newPayloadV4", count: 2 },
        { method: "engine_forkchoiceUpdatedV3", count: 1 },
      ],
      observedAt: 1_700_000_000_000,
    };
    const roundTripped = JSON.parse(
      JSON.stringify(activity),
    ) as NodeLinkActivity;
    expect(roundTripped.calls.map((c) => c.method)).toEqual([
      "engine_newPayloadV3",
      "engine_newPayloadV4",
      "engine_forkchoiceUpdatedV3",
    ]);
    // V3 と V4 はまとめられず別カウントのまま。
    expect(roundTripped.calls[0].count).toBe(1);
    expect(roundTripped.calls[1].count).toBe(2);
  });

  it("distinguishes NodeLinkActivity with no calls (empty array) from populated", () => {
    // 「増分ゼロの種類は含めない」ため通常は calls に 1 件以上入るが、増分が
    // まったく無い観測は本来配信されない（アダプタ側の縮退）。型としては空配列
    // も成立する。空配列が JSON 往復で保持され、フロントが calls.length で
    // パルス本数を決める際に 0 件を安全に扱えることを確認する。
    const noCalls: NodeLinkActivity = {
      fromNodeId: "beacon-1",
      toNodeId: "node-1",
      calls: [],
      observedAt: 1_700_000_000_000,
    };
    const roundTripped = JSON.parse(JSON.stringify(noCalls)) as NodeLinkActivity;
    expect(roundTripped.calls).toEqual([]);
    expect(roundTripped.calls).toHaveLength(0);
  });

  it("accepts drivesNodeId as a plain string reference without referential integrity", () => {
    // drivesNodeId は rpcTargetNodeId と同じく「エンティティの id を指す生の
    // 文字列」であり、型は参照先の存在・一意性を保証しない（ダングリングガード
    // はフロント描画側の責務。ARCHITECTURE.md §7.4）。異常な指し先でも型として
    // 成立し、フロントが相手ノード不在を検出して描かない側に倒せることを確認する。
    const base: NodeEntity = {
      kind: "node",
      id: "beacon-1",
      containerName: "chainviz-ethereum-beacon1",
      ip: "172.28.2.1",
      ports: [5052],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "lighthouse" },
      chainType: "ethereum",
      clientType: "lighthouse",
      syncStatus: "synced",
      blockHeight: 0,
      headBlockHash: "",
    };

    // 自己参照（自分自身を駆動対象に指す）: 型は許容する。フロントは
    // from === to のエッジを描かない側に倒せるよう、値がそのまま保持される。
    const selfDriving: NodeEntity = { ...base, drivesNodeId: "beacon-1" };
    const selfRoundTripped = JSON.parse(
      JSON.stringify(selfDriving),
    ) as NodeEntity;
    expect(selfRoundTripped.drivesNodeId).toBe(selfRoundTripped.id);

    // 存在しないノード id（解決結果が古い・相手が削除済み）を指すダングリング。
    // 型は関知せず、キャンバス上に相手が居なければフロントが描画を抑止する。
    const dangling: NodeEntity = { ...base, drivesNodeId: "node-does-not-exist" };
    expect(dangling.drivesNodeId).toBe("node-does-not-exist");
  });

  it("distinguishes an included tx with no events (empty array) from an undecoded tx", () => {
    // ブロック取り込み確定後にイベントが 1 件も無い tx は contractEvents: []。
    // これは「まだ確定前でイベント情報が無い（省略）」と意味が異なる。
    const noEvents: TransactionEntity = {
      kind: "transaction",
      hash: "0xabcd",
      from: "0x0000000000000000000000000000000000a11ce",
      to: "0x00000000000000000000000000000000000c0de",
      status: "included",
      contractEvents: [],
    };
    const roundTripped = JSON.parse(
      JSON.stringify(noEvents),
    ) as TransactionEntity;
    expect(roundTripped.contractEvents).toEqual([]);
    expect(roundTripped.contractEvents).not.toBeUndefined();

    const pending: TransactionEntity = {
      kind: "transaction",
      hash: "0xabcd",
      from: "0x0000000000000000000000000000000000a11ce",
      to: "0x00000000000000000000000000000000000c0de",
      status: "pending",
    };
    expect(pending.contractEvents).toBeUndefined();
  });
});
