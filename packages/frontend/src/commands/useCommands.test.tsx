import type {
  Command,
  DiffEvent,
  NodeEntity,
  WorkbenchEntity,
  WorldStateEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import type { ConnectionStatus } from "../websocket/client.js";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
} from "../websocket/client.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { GHOST_TIMEOUT_MS, type GhostFlowNode } from "../entities/ghostNode.js";
import { defaultGridPosition } from "../entities/infraNode.js";
import { useCommands } from "./useCommands.js";

const t = (key: MessageKey) => translate(key, "en");

function setup() {
  let handlers: ChainvizClientHandlers | null = null;
  const sent: Command[] = [];
  const commandIds: string[] = [];
  let counter = 0;

  const factory: ClientFactory = (h): ChainvizClient => {
    handlers = h;
    return {
      connect() {},
      disconnect() {},
      sendCommand(command) {
        const id = `cmd-${++counter}`;
        sent.push(command);
        commandIds.push(id);
        return id;
      },
      getStatus: () => "connected",
    };
  };

  const notify = vi.fn();
  const view = renderHook(() => useCommands(factory, notify, t));
  return {
    ...view,
    notify,
    sent,
    commandIds,
    resolve: (commandIndex: number, ok: boolean, error?: string) =>
      act(() => {
        handlers?.onCommandResult?.(commandIds[commandIndex], ok, error);
      }),
    resolveById: (commandId: string, ok: boolean, error?: string) =>
      act(() => {
        handlers?.onCommandResult?.(commandId, ok, error);
      }),
    diff: (events: DiffEvent[]) =>
      act(() => {
        handlers?.onDiff?.(events);
      }),
    snapshot: (entities: WorldStateEntity[]) =>
      act(() => {
        const payload: WorldStateSnapshot = {
          chainType: "ethereum",
          timestamp: 0,
          entities,
          edges: [],
        };
        handlers?.onSnapshot?.(payload);
      }),
    setStatus: (statusValue: ConnectionStatus) =>
      act(() => {
        handlers?.onStatusChange?.(statusValue);
      }),
  };
}

function nodeEntity(id: string): NodeEntity {
  return {
    kind: "node",
    id,
    containerName: `chainviz-${id}`,
    ip: "172.20.0.10",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "syncing",
    blockHeight: 0,
    headBlockHash: "0x0",
  };
}

/** clientType を差し替えられる node ヘルパー（Issue #123: beacon/lighthouse 到着の再現用）。 */
function nodeEntityWithClientType(id: string, clientType: string): NodeEntity {
  return { ...nodeEntity(id), clientType };
}

function workbenchEntity(id: string, label = "Carol"): WorkbenchEntity {
  return {
    kind: "workbench",
    id,
    containerName: `chainviz-${id}`,
    ip: "172.20.0.50",
    ports: [],
    resources: { cpuPercent: 0.2, memMB: 40 },
    process: { name: "foundry" },
    label,
    walletIds: [],
  };
}

afterEach(cleanup);

describe("useCommands", () => {
  it("sends addNode with the default chain profile", () => {
    const { result, sent } = setup();
    act(() => result.current.actions.addNode());
    expect(sent).toEqual([{ action: "addNode", chainProfile: "ethereum" }]);
  });

  it("sends removeNode / removeWorkbench with the given ids", () => {
    const { result, sent } = setup();
    act(() => result.current.actions.removeNode("reth-follower-1"));
    act(() => result.current.actions.removeWorkbench("workbench-1"));
    expect(sent).toEqual([
      { action: "removeNode", nodeId: "reth-follower-1" },
      { action: "removeWorkbench", workbenchId: "workbench-1" },
    ]);
  });

  it("normalizes the workbench label before sending", () => {
    const { result, sent } = setup();
    act(() => result.current.actions.addWorkbench("  Bob  "));
    act(() => result.current.actions.addWorkbench("   "));
    expect(sent).toEqual([
      { action: "addWorkbench", label: "Bob" },
      { action: "addWorkbench", label: "workbench" },
    ]);
  });

  it("notifies with a descriptive error when a command fails", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.removeNode("reth-node-1"));
    resolve(0, false, "cannot remove a validator node");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to remove node: cannot remove a validator node",
    });
  });

  it("does not notify when a command succeeds", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("maps each result to the command that produced it", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addWorkbench("Bob"));
    act(() => result.current.actions.removeNode("reth-node-1"));

    // 2番目に送ったコマンド（removeNode）が失敗した場合。
    resolve(1, false, "boom");
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to remove node: boom",
    });
  });

  it("notifies only once per command when the same result arrives twice", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.removeNode("reth-node-1"));

    // 1回目は pending から removeNode を特定して詳細付きで通知。
    resolve(0, false, "boom");
    // 2回目は pending から消えているため command 不明の汎用文言になる。
    resolve(0, false, "boom");

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, {
      kind: "error",
      message: "Failed to remove node: boom",
    });
    // 2回目は command を特定できないため、詳細は残るが定型文が汎用になる。
    expect(notify).toHaveBeenNthCalledWith(2, {
      kind: "error",
      message: "Command failed: boom",
    });
  });

  it("falls back to a generic message for a stray failure after success", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addNode());

    // 成功で pending から除かれた後に、同じ id で遅れて失敗が届いた場合。
    resolve(0, true);
    resolve(0, false, "late failure");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Command failed: late failure",
    });
  });

  it("ignores a result for a commandId that was never sent", () => {
    const { notify, resolveById } = setup();
    // 送っていない id に対する成功結果は何も通知しない。
    resolveById("phantom", true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("tracks every command independently when the same action is fired repeatedly", () => {
    const { result, notify, sent, resolve } = setup();
    act(() => result.current.actions.removeNode("reth-node-1"));
    act(() => result.current.actions.removeNode("reth-node-1"));
    act(() => result.current.actions.removeNode("reth-node-1"));

    expect(sent).toHaveLength(3);
    // 3連打のうち2件が失敗した場合、失敗した分だけ通知される。
    resolve(0, false, "boom");
    resolve(2, false, "boom");
    resolve(1, true);

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not notify while a result never arrives", () => {
    const { result, notify } = setup();
    act(() => result.current.actions.addNode());
    // commandResult を送らない限り、pending のまま何も起こらない。
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("useCommands ghost nodes (Issue #102 / #123)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an execution + consensus ghost pair when addNode is dispatched (reth + beacon, Issue #123)", () => {
    const { result } = setup();
    expect(result.current.ghosts).toHaveLength(0);

    act(() => result.current.actions.addNode());

    expect(result.current.ghosts).toHaveLength(2);
    const kinds = result.current.ghosts.map((g) => g.data.kind);
    expect(kinds).toEqual(["node", "node"]);
    const layers = result.current.ghosts.map((g) => g.data.layer).sort();
    expect(layers).toEqual(["consensus", "execution"]);
    // 両方とも同じ label（chainProfile）を持つが、id・位置は別々。
    expect(result.current.ghosts[0].data.label).toBe("ethereum");
    expect(result.current.ghosts[1].data.label).toBe("ethereum");
    expect(result.current.ghosts[0].id).not.toBe(result.current.ghosts[1].id);
    expect(result.current.ghosts[0].position).not.toEqual(
      result.current.ghosts[1].position,
    );
  });

  it("shows a single ghost node immediately when addWorkbench is dispatched, using the resolved label", () => {
    const { result } = setup();
    act(() => result.current.actions.addWorkbench("  Bob  "));

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.kind).toBe("workbench");
    expect(result.current.ghosts[0].data.label).toBe("Bob");
    expect(result.current.ghosts[0].data.layer).toBeUndefined();
  });

  it("does not create a ghost for removeNode / removeWorkbench", () => {
    const { result } = setup();
    act(() => result.current.actions.removeNode("reth-1"));
    act(() => result.current.actions.removeWorkbench("wb-1"));
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("places every concurrently pending ghost (across two addNode calls) at a distinct position", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });

    expect(result.current.ghosts).toHaveLength(4);
    const positions = result.current.ghosts.map(
      (g) => `${g.position.x},${g.position.y}`,
    );
    expect(new Set(positions).size).toBe(4);
    const ids = result.current.ghosts.map((g) => g.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("useCommands ghost nodes: layer-aware arrival matching (Issue #123)", () => {
  it("removes only the execution ghost when a reth entity arrives, leaving the consensus ghost", () => {
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    diff([{ type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") }]);

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.layer).toBe("consensus");
  });

  it("removes only the consensus ghost when a lighthouse entity arrives, leaving the execution ghost", () => {
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    diff([
      { type: "entityAdded", entity: nodeEntityWithClientType("lighthouse-1", "lighthouse") },
    ]);

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.layer).toBe("execution");
  });

  it("clears both ghosts of the pair once both the reth and beacon entities have arrived", () => {
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    diff([{ type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") }]);
    diff([
      { type: "entityAdded", entity: nodeEntityWithClientType("lighthouse-1", "lighthouse") },
    ]);

    expect(result.current.ghosts).toHaveLength(0);
  });

  it("removes the workbench ghost on workbench arrival without touching pending node ghosts", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
    });
    expect(result.current.ghosts).toHaveLength(3);

    diff([{ type: "entityAdded", entity: workbenchEntity("wb-1") }]);

    expect(result.current.ghosts).toHaveLength(2);
    expect(result.current.ghosts.every((g) => g.data.kind === "node")).toBe(true);
  });

  it("ignores diff events unrelated to node/workbench entities (e.g. wallet)", () => {
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    diff([
      {
        type: "entityAdded",
        entity: {
          kind: "wallet",
          address: "0xabc",
          chainType: "ethereum",
          balance: "0",
          nonce: 0,
          isSmartAccount: false,
          ownerWorkbenchId: null,
          recentTxHashes: [],
        },
      },
    ]);

    expect(result.current.ghosts).toHaveLength(2);
  });

  it("does not remove a ghost for an entity that was already present before the command (re-sent snapshot)", () => {
    const { result, diff } = setup();
    diff([{ type: "entityAdded", entity: nodeEntityWithClientType("existing-1", "reth") }]);
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    diff([
      { type: "entityUpdated", id: "existing-1", patch: { blockHeight: 5 } },
    ]);
    expect(result.current.ghosts).toHaveLength(2);
  });

  it("falls back to kind-only FIFO when the arriving node's category has no matching-layer ghost pending", () => {
    // consensus 側だけが先に実体化済みで、もう1件 reth が届いた場合。
    // 一致する execution レイヤーのゴーストがあればそれを消費する（正常系）。
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);
    diff([{ type: "entityAdded", entity: nodeEntityWithClientType("lighthouse-1", "lighthouse") }]);
    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.layer).toBe("execution");

    // 想定外に別の reth が重ねて届いても、残っている execution ゴーストが消費される。
    diff([{ type: "entityAdded", entity: nodeEntityWithClientType("reth-2", "reth") }]);
    expect(result.current.ghosts).toHaveLength(0);
  });
});

describe("useCommands ghost nodes: failure clears the whole addNode pair (Issue #123)", () => {
  it("removes both the execution and consensus ghosts when the shared addNode command fails", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
    });
    expect(result.current.ghosts).toHaveLength(3);

    // 1番目に送った addNode が失敗（reth/beacon 両ゴーストが同じ commandId を共有する）。
    resolve(0, false, "boom");

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.kind).toBe("workbench");
  });

  it("keeps both ghosts of the pair around on command success (they wait for the real entities via diff)", () => {
    const { result, resolve } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, true);
    expect(result.current.ghosts).toHaveLength(2);
  });
});

describe("useCommands ghost nodes: FIFO under bursts and interleaving (Issue #102 / #123)", () => {
  it("removes the correct oldest ghost per layer when two addNode bursts are followed by matching arrivals", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(4);
    const survivingExecutionId = result.current.ghosts.filter(
      (g) => g.data.layer === "execution",
    )[1].id;
    const survivingConsensusId = result.current.ghosts.filter(
      (g) => g.data.layer === "consensus",
    )[1].id;

    // 1組分の実体（reth + beacon）が1通の diff でまとめて届く。
    diff([
      { type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") },
      { type: "entityAdded", entity: nodeEntityWithClientType("lighthouse-1", "lighthouse") },
    ]);

    expect(result.current.ghosts).toHaveLength(2);
    const remainingIds = result.current.ghosts.map((g) => g.id).sort();
    expect(remainingIds).toEqual([survivingExecutionId, survivingConsensusId].sort());
  });

  it("keeps FIFO per-kind when node/workbench ghosts are interleaved", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode(); // node pair #1
      result.current.actions.addWorkbench("Alice"); // wb #1
      result.current.actions.addNode(); // node pair #2
      result.current.actions.addWorkbench("Bob"); // wb #2
    });
    expect(result.current.ghosts).toHaveLength(6);
    const secondWbId = result.current.ghosts.filter(
      (g) => g.data.kind === "workbench",
    )[1].id;

    diff([{ type: "entityAdded", entity: workbenchEntity("wb-1") }]);

    const remainingKinds = result.current.ghosts.map((g) => g.data.kind);
    expect(remainingKinds).toEqual(["node", "node", "node", "node", "workbench"]);
    expect(result.current.ghosts.find((g) => g.data.kind === "workbench")?.id).toBe(
      secondWbId,
    );
  });

  it("does not remove a node ghost when only a workbench entity arrives (no cross-kind mixups)", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
    });
    expect(result.current.ghosts).toHaveLength(3);

    diff([{ type: "entityAdded", entity: workbenchEntity("wb-1") }]);

    const kinds = result.current.ghosts.map((g) => g.data.kind).sort();
    expect(kinds).toEqual(["node", "node"]);
  });
});

describe("useCommands ghost nodes: connection target resolution (Issue #123)", () => {
  function bootReth(id: string): NodeEntity {
    return { ...nodeEntityWithClientType(id, "reth"), p2pRole: "bootnode" };
  }
  function bootLighthouse(id: string): NodeEntity {
    return { ...nodeEntityWithClientType(id, "lighthouse"), p2pRole: "bootnode" };
  }

  it("resolves the execution/consensus bootnode container names when p2pRole is known", () => {
    const { result, diff } = setup();
    diff([
      { type: "entityAdded", entity: bootReth("reth-1") },
      { type: "entityAdded", entity: bootLighthouse("lighthouse-1") },
    ]);

    act(() => result.current.actions.addNode());

    const execution = result.current.ghosts.find((g) => g.data.layer === "execution");
    const consensus = result.current.ghosts.find((g) => g.data.layer === "consensus");
    expect(execution?.data.targetContainerName).toBe("chainviz-reth-1");
    expect(execution?.data.targetNodeId).toBe("reth-1");
    expect(consensus?.data.targetContainerName).toBe("chainviz-lighthouse-1");
    expect(consensus?.data.targetNodeId).toBe("lighthouse-1");
  });

  it("omits the connection target fields when no bootnode can be resolved (Issue #123 §4-5 fallback)", () => {
    const { result } = setup();
    act(() => result.current.actions.addNode());

    for (const ghost of result.current.ghosts) {
      expect(ghost.data.targetContainerName).toBeUndefined();
      expect(ghost.data.targetNodeId).toBeUndefined();
    }
  });

  it("resolves the workbench ghost's RPC target from an existing workbench's rpcTargetNodeId", () => {
    const { result, diff } = setup();
    const target = nodeEntityWithClientType("reth-1", "reth");
    diff([
      { type: "entityAdded", entity: target },
      {
        type: "entityAdded",
        entity: { ...workbenchEntity("wb-existing"), rpcTargetNodeId: "reth-1" },
      },
    ]);

    act(() => result.current.actions.addWorkbench("Carol"));

    const ghost = result.current.ghosts.find((g) => g.data.kind === "workbench");
    expect(ghost?.data.targetContainerName).toBe("chainviz-reth-1");
    expect(ghost?.data.targetNodeId).toBe("reth-1");
  });

  it("omits the workbench ghost's RPC target when no existing workbench resolves one", () => {
    const { result } = setup();
    act(() => result.current.actions.addWorkbench("Carol"));

    const ghost = result.current.ghosts.find((g) => g.data.kind === "workbench");
    expect(ghost?.data.targetContainerName).toBeUndefined();
    expect(ghost?.data.targetNodeId).toBeUndefined();
  });
});

describe("useCommands ghost nodes: failure/arrival races (Issue #102 / #123)", () => {
  it("does not throw when the real entity arrives after the pair was already removed by a failure", () => {
    const { result, resolve, diff } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, false, "boom");
    expect(result.current.ghosts).toHaveLength(0);

    expect(() =>
      diff([{ type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") }]),
    ).not.toThrow();
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not double-remove when a late failure arrives after both ghosts were consumed by diffs", () => {
    const { result, notify, resolve, diff } = setup();
    act(() => result.current.actions.addNode());
    diff([
      { type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") },
      { type: "entityAdded", entity: nodeEntityWithClientType("lighthouse-1", "lighthouse") },
    ]);
    expect(result.current.ghosts).toHaveLength(0);

    expect(() => resolve(0, false, "late failure")).not.toThrow();
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("still resolves independently when a failure and an arrival hit within the same act()", () => {
    const { result, resolve, diff } = setup();
    act(() => {
      result.current.actions.addNode(); // cmd0
      result.current.actions.addNode(); // cmd1
    });
    expect(result.current.ghosts).toHaveLength(4);

    act(() => {
      resolve(1, false, "boom"); // cmd1 の2枚が失敗で消える
      diff([{ type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") }]); // cmd0 の execution が消える
    });

    // cmd0 の consensus ゴーストだけが残る。
    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.layer).toBe("consensus");
  });
});

describe("useCommands ghost nodes: safety-net timer independence (Issue #102)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires each ghost on its own schedule (staggered creation)", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.actions.addWorkbench("Alice"));

    // 30 秒後に2枚目を追加。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS / 2));
    act(() => result.current.actions.addWorkbench("Bob"));
    expect(result.current.ghosts).toHaveLength(2);

    // さらに30秒（=1枚目は60秒到達、2枚目はまだ30秒）。1枚目だけ消える。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS / 2));
    expect(result.current.ghosts).toHaveLength(1);

    // さらに30秒で2枚目も60秒到達。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS / 2));
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("leaves the surviving ghosts' timers intact when one ghost of a pair is resolved early", () => {
    vi.useFakeTimers();
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    diff([{ type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") }]);
    expect(result.current.ghosts).toHaveLength(1);

    // 残った consensus ゴーストは自身の安全網で最終的に消える。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS));
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not resurrect or double-fire after a pair is resolved by failure then time advances", () => {
    vi.useFakeTimers();
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, false, "boom");
    expect(result.current.ghosts).toHaveLength(0);

    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS * 2));
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("useCommands ghost nodes: disconnect / reconnect (Issue #102 / #123)", () => {
  it("removes both ghosts of a pair once a reconnect snapshot contains both real entities", () => {
    const { result, setStatus, snapshot } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    setStatus("disconnected");
    setStatus("connected");
    snapshot([
      nodeEntityWithClientType("reth-1", "reth"),
      nodeEntityWithClientType("lighthouse-1", "lighthouse"),
    ]);

    expect(result.current.ghosts).toHaveLength(0);
  });

  it("keeps pending ghosts across a reconnect whose snapshot lacks the entities (no spurious removal)", () => {
    const { result, setStatus, snapshot } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    setStatus("disconnected");
    setStatus("connected");
    snapshot([]);

    expect(result.current.ghosts).toHaveLength(2);
  });

  it("does not remove a ghost twice when the entity appears in both the reconnect snapshot and a later diff", () => {
    const { result, snapshot, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(4);

    // 再接続スナップショットに reth-1 が含まれる → 最古の execution ゴーストを1枚消す。
    snapshot([nodeEntityWithClientType("reth-1", "reth")]);
    expect(result.current.ghosts).toHaveLength(3);

    // 同じ reth-1 が update として再送されても「既知」なので変化しない。
    diff([{ type: "entityUpdated", id: "reth-1", patch: { blockHeight: 3 } }]);
    expect(result.current.ghosts).toHaveLength(3);
  });
});

/**
 * Issue #113 の配置 index 計算（Math.max(ghostIndexRef, infraCount) の単調増加
 * カウンタ）に対する境界値の確認。addNode は1回で2つの index を消費するように
 * なった(Issue #123)が、単調増加・重複しないという不変条件自体は変わらない。
 */
function positionKey(node: GhostFlowNode): string {
  return `${node.position.x},${node.position.y}`;
}

describe("useCommands ghost nodes: placement index survives infra removal between adds (Issue #113 / #123)", () => {
  it("does not place a new ghost on the same grid cell as a still-pending ghost after an existing infra entity is removed in between", () => {
    const { result, diff } = setup();

    // 1. 既存 node を登録（infraCount=1）。
    diff([{ type: "entityAdded", entity: nodeEntity("existing-1") }]);

    // 2. addWorkbench → 仮カードが1枚。
    act(() => result.current.actions.addWorkbench("Alice"));
    expect(result.current.ghosts).toHaveLength(1);
    const firstGhostPosition = result.current.ghosts[0].position;

    // 3. 既存 node を削除（infraCount=0）。まだ手順2の仮カードは実体化していない。
    diff([{ type: "entityRemoved", id: "existing-1" }]);

    // 4. addWorkbench → 仮カードが2枚目。旧実装ではここで手順2の仮カードと同一
    //    グリッドセルに重なっていた。
    act(() => result.current.actions.addWorkbench("Bob"));
    expect(result.current.ghosts).toHaveLength(2);

    const secondGhostPosition = result.current.ghosts[1].position;
    expect(secondGhostPosition).not.toEqual(firstGhostPosition);
    const positions = result.current.ghosts.map(positionKey);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("keeps placement monotonic across repeated removal of existing infra between adds", () => {
    const { result, diff } = setup();

    diff([{ type: "entityAdded", entity: nodeEntity("existing-1") }]);
    diff([{ type: "entityAdded", entity: nodeEntity("existing-2") }]);

    act(() => result.current.actions.addWorkbench("A")); // ghost #1 (infraCount=2)
    diff([{ type: "entityRemoved", id: "existing-1" }]); // infraCount=1
    act(() => result.current.actions.addWorkbench("B")); // ghost #2
    diff([{ type: "entityRemoved", id: "existing-2" }]); // infraCount=0
    act(() => result.current.actions.addWorkbench("C")); // ghost #3

    expect(result.current.ghosts).toHaveLength(3);
    const positions = result.current.ghosts.map(positionKey);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("consumes two consecutive grid slots atomically for a single addNode pair", () => {
    const { result } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts.map((g) => g.position)).toEqual(
      [0, 1].map((i) => defaultGridPosition(i)),
    );

    // 続く addWorkbench は index 2 へ押し出される（addNode が2つ消費した分だけ前進）。
    act(() => result.current.actions.addWorkbench("Alice"));
    expect(result.current.ghosts[2].position).toEqual(defaultGridPosition(2));
  });

  it("pushes a new ghost forward past a burst of infra added by other clients (Math.max lower bound)", () => {
    const { result, diff } = setup();

    act(() => result.current.actions.addWorkbench("Bob"));
    const workbenchPosition = result.current.ghosts[0].position;

    diff([
      { type: "entityAdded", entity: nodeEntity("reth-1") },
      { type: "entityAdded", entity: nodeEntity("reth-2") },
      { type: "entityAdded", entity: nodeEntity("reth-3") },
      { type: "entityAdded", entity: nodeEntity("reth-4") },
      { type: "entityAdded", entity: nodeEntity("reth-5") },
    ]);
    expect(result.current.ghosts).toHaveLength(1);

    act(() => result.current.actions.addWorkbench("Carol"));
    expect(result.current.ghosts).toHaveLength(2);

    const newGhost = result.current.ghosts[1];
    expect(newGhost.position).toEqual(defaultGridPosition(5));
    expect(newGhost.position).not.toEqual(workbenchPosition);
    const infraCells = [0, 1, 2, 3, 4].map(
      (i) => `${defaultGridPosition(i).x},${defaultGridPosition(i).y}`,
    );
    expect(infraCells).not.toContain(positionKey(newGhost));
  });

  it("never assigns two concurrently-pending ghosts the same cell through a long interleaving", () => {
    const { result, diff, resolve } = setup();
    const assertDistinct = () => {
      const positions = result.current.ghosts.map(positionKey);
      expect(new Set(positions).size).toBe(positions.length);
    };

    act(() => result.current.actions.addNode()); // cmd0: 2 node ghosts, index 0-1
    assertDistinct();
    act(() => result.current.actions.addWorkbench("Alice")); // cmd1 wb, index 2
    assertDistinct();

    diff([{ type: "entityAdded", entity: nodeEntityWithClientType("reth-1", "reth") }]);
    assertDistinct();

    act(() => result.current.actions.addNode()); // cmd2: index 3-4
    assertDistinct();

    diff([{ type: "entityRemoved", id: "reth-1" }]);
    assertDistinct();

    resolve(2, false, "boom"); // cmd2 の2枚が失敗で消える
    assertDistinct();

    act(() => result.current.actions.addWorkbench("Bob")); // cmd3 wb, index 5
    assertDistinct();
    act(() => result.current.actions.addNode()); // cmd4: index 6-7
    assertDistinct();

    // 最終的に残る仮カード: consensus(cmd0), wb(cmd1), wb(cmd3), execution+consensus(cmd4)。
    expect(result.current.ghosts).toHaveLength(5);
  });
});
