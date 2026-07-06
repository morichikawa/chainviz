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

describe("useCommands ghost nodes (Issue #102)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a ghost node immediately when addNode is dispatched", () => {
    const { result } = setup();
    expect(result.current.ghosts).toHaveLength(0);

    act(() => result.current.actions.addNode());

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.kind).toBe("node");
    expect(result.current.ghosts[0].data.label).toBe("ethereum");
  });

  it("shows a ghost node immediately when addWorkbench is dispatched, using the resolved label", () => {
    const { result } = setup();
    act(() => result.current.actions.addWorkbench("  Bob  "));

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.kind).toBe("workbench");
    expect(result.current.ghosts[0].data.label).toBe("Bob");
  });

  it("does not create a ghost for removeNode / removeWorkbench", () => {
    const { result } = setup();
    act(() => result.current.actions.removeNode("reth-1"));
    act(() => result.current.actions.removeWorkbench("wb-1"));
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("places multiple concurrently pending ghosts at distinct positions", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });

    expect(result.current.ghosts).toHaveLength(2);
    expect(result.current.ghosts[0].position).not.toEqual(
      result.current.ghosts[1].position,
    );
    expect(result.current.ghosts[0].id).not.toBe(result.current.ghosts[1].id);
  });

  it("removes the ghost when the command fails, without touching a differently-kinded ghost", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
    });
    expect(result.current.ghosts).toHaveLength(2);

    // 1番目に送った addNode が失敗。
    resolve(0, false, "boom");

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.kind).toBe("workbench");
  });

  it("keeps the ghost around on command success (it waits for the real entity via diff)", () => {
    const { result, resolve } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, true);
    expect(result.current.ghosts).toHaveLength(1);
  });

  it("removes the oldest matching ghost once the real entity arrives via diff", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(2);
    const firstGhostId = result.current.ghosts[0].id;
    const secondGhostId = result.current.ghosts[1].id;

    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);

    // 先に送った方（FIFO）が消え、後から送った方は残る。
    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].id).toBe(secondGhostId);
    expect(result.current.ghosts.some((g) => g.id === firstGhostId)).toBe(false);
  });

  it("only removes a ghost of the matching kind when an entity arrives", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
    });
    expect(result.current.ghosts).toHaveLength(2);

    // workbench の実体が届いても addNode のゴーストは残る。
    diff([{ type: "entityAdded", entity: workbenchEntity("wb-1") }]);

    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].data.kind).toBe("node");
  });

  it("ignores diff events unrelated to node/workbench entities (e.g. wallet)", () => {
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);

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

    expect(result.current.ghosts).toHaveLength(1);
  });

  it("does not remove a ghost for an entity that was already present before the command (re-sent snapshot)", () => {
    const { result, diff } = setup();
    // addNode より前から存在していたノードの再通知（entityUpdated など）は
    // 「新規到着」ではないので無視されるべき。まず一度 entityAdded で登録し、
    // それを「既知」とした状態で addNode → 同じ id の update が来ても消えない
    // ことを確認する。
    diff([{ type: "entityAdded", entity: nodeEntity("existing-1") }]);
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);

    diff([
      { type: "entityUpdated", id: "existing-1", patch: { blockHeight: 5 } },
    ]);
    expect(result.current.ghosts).toHaveLength(1);
  });

  it("removes a ghost automatically after the safety-net timeout if nothing else resolves it", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(GHOST_TIMEOUT_MS);
    });

    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not fire the safety-net timeout once the ghost was already resolved by a diff", () => {
    vi.useFakeTimers();
    const { result, diff } = setup();
    act(() => result.current.actions.addNode());
    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);
    expect(result.current.ghosts).toHaveLength(0);

    // タイマーが残っていて後から誤発火しても、既に空の配列に対する no-op なので
    // 例外は起きず、ghosts は空のまま。
    act(() => {
      vi.advanceTimersByTime(GHOST_TIMEOUT_MS);
    });
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not throw when unmounted while ghosts are still pending (timers are cleaned up)", () => {
    vi.useFakeTimers();
    const { result, unmount } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);

    expect(() => {
      unmount();
      vi.advanceTimersByTime(GHOST_TIMEOUT_MS);
    }).not.toThrow();
  });
});

describe("useCommands ghost nodes: FIFO under bursts and interleaving (Issue #102)", () => {
  it("removes the correct oldest ghosts (FIFO) when several arrive in one diff after a 3-click burst", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(3);
    const survivorId = result.current.ghosts[2].id;

    // 2 件の実体が 1 通の diff でまとめて届く。
    diff([
      { type: "entityAdded", entity: nodeEntity("reth-1") },
      { type: "entityAdded", entity: nodeEntity("reth-2") },
    ]);

    // 先に送った 2 枚が消え、最後の 1 枚だけ残る。
    expect(result.current.ghosts).toHaveLength(1);
    expect(result.current.ghosts[0].id).toBe(survivorId);
  });

  it("keeps FIFO per-kind when node/workbench ghosts are interleaved", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode(); // node #1
      result.current.actions.addWorkbench("Alice"); // wb #1
      result.current.actions.addNode(); // node #2
      result.current.actions.addWorkbench("Bob"); // wb #2
    });
    expect(result.current.ghosts).toHaveLength(4);
    const secondNodeId = result.current.ghosts[2].id;
    const secondWbId = result.current.ghosts[3].id;

    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);
    diff([{ type: "entityAdded", entity: workbenchEntity("wb-1") }]);

    // 各種別の先頭（node #1 / wb #1）だけが消え、2 番目同士が残る。
    const remainingIds = result.current.ghosts.map((g) => g.id).sort();
    expect(result.current.ghosts).toHaveLength(2);
    expect(remainingIds).toEqual([secondNodeId, secondWbId].sort());
  });

  it("removes one of each kind when a single diff carries both a node and a workbench", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
    });
    expect(result.current.ghosts).toHaveLength(3);

    diff([
      { type: "entityAdded", entity: nodeEntity("reth-1") },
      { type: "entityAdded", entity: workbenchEntity("wb-1") },
    ]);

    // node が 1 枚、workbench が 0 枚残る。
    const kinds = result.current.ghosts.map((g) => g.data.kind);
    expect(kinds).toEqual(["node"]);
  });

  it("does not remove a node ghost when only a workbench entity arrives (no cross-kind mixups)", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(3);

    // workbench が 2 回連続で届いても（2 通目は対応するゴーストが無い）、node の
    // ゴーストには一切触れない。
    diff([{ type: "entityAdded", entity: workbenchEntity("wb-1") }]);
    diff([{ type: "entityAdded", entity: workbenchEntity("wb-2") }]);

    const kinds = result.current.ghosts.map((g) => g.data.kind).sort();
    expect(kinds).toEqual(["node", "node"]);
  });
});

describe("useCommands ghost nodes: failure/arrival races (Issue #102)", () => {
  it("does not throw when the real entity arrives after the ghost was already removed by a failure", () => {
    const { result, resolve, diff } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, false, "boom");
    expect(result.current.ghosts).toHaveLength(0);

    // 失敗で消えた後に（別ノードの）実体が届いても、消すゴーストが無いだけで例外にならない。
    expect(() =>
      diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]),
    ).not.toThrow();
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not double-remove when a late failure arrives after the ghost was consumed by a diff", () => {
    const { result, notify, resolve, diff } = setup();
    act(() => result.current.actions.addNode());
    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);
    expect(result.current.ghosts).toHaveLength(0);

    // 実体到着でゴーストは消費済み。その後に遅れて失敗が届いても no-op（例外なし）。
    // pending には残っているので通知はされる（現行仕様の明文化）。
    expect(() => resolve(0, false, "late failure")).not.toThrow();
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("clears both ghosts when one fails by commandId and an entity arrives for the other (same kind)", () => {
    const { result, resolve, diff } = setup();
    act(() => {
      result.current.actions.addNode(); // cmd index 0
      result.current.actions.addNode(); // cmd index 1
    });
    expect(result.current.ghosts).toHaveLength(2);

    // 1 枚は失敗で commandId 直指定で消え、もう 1 枚は実体到着（FIFO 近似）で消える。
    resolve(0, false, "boom");
    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);

    expect(result.current.ghosts).toHaveLength(0);
  });

  it("still removes exactly one ghost when a failure and an arrival hit within the same act()", () => {
    const { result, resolve, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(2);

    act(() => {
      resolve(1, false, "boom");
      diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);
    });

    // 失敗(cmd1)で 1 枚、到着で最古(cmd0)が 1 枚消え、合計 0 枚。二重消去の破綻はない。
    expect(result.current.ghosts).toHaveLength(0);
  });
});

describe("useCommands ghost nodes: safety-net timer independence (Issue #102)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires each ghost on its own schedule (staggered creation)", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.actions.addNode());

    // 30 秒後に 2 枚目を追加。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS / 2));
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    // さらに 30 秒（=1 枚目は 60 秒到達、2 枚目はまだ 30 秒）。1 枚目だけ消える。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS / 2));
    expect(result.current.ghosts).toHaveLength(1);

    // さらに 30 秒で 2 枚目も 60 秒到達。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS / 2));
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("leaves the surviving ghost's timer intact when another ghost is resolved early", () => {
    vi.useFakeTimers();
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    // 1 枚を実体到着で早期に解決。
    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);
    expect(result.current.ghosts).toHaveLength(1);

    // 残った 1 枚は自身の安全網で最終的に消える。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS));
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not resurrect or double-fire after a ghost is resolved by failure then time advances", () => {
    vi.useFakeTimers();
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, false, "boom");
    expect(result.current.ghosts).toHaveLength(0);

    // 失敗で消した後にタイムアウト時刻を跨いでも、ゴーストは 0 のまま・追加通知も無い。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS * 2));
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("useCommands ghost nodes: disconnect / reconnect (Issue #102)", () => {
  it("removes a pending ghost once a reconnect snapshot contains the real entity", () => {
    const { result, setStatus, snapshot } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);

    // 切断 → 再接続。再接続時のスナップショットに実体が含まれていれば、
    // それを新規到着とみなして仮カードを消す。
    setStatus("disconnected");
    setStatus("connected");
    snapshot([nodeEntity("reth-1")]);

    expect(result.current.ghosts).toHaveLength(0);
  });

  it("keeps a pending ghost across a reconnect whose snapshot lacks the entity (no spurious removal)", () => {
    const { result, setStatus, snapshot } = setup();
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);

    // 実体がまだ立ち上がっておらず、再接続スナップショットが空のケース。
    setStatus("disconnected");
    setStatus("connected");
    snapshot([]);

    // ゴーストは（安全網タイムアウトまで）残り続ける。空スナップショットで
    // 誤って消えたりしない。
    expect(result.current.ghosts).toHaveLength(1);
  });

  it("does not remove a ghost twice when the entity appears in both the reconnect snapshot and a later diff", () => {
    const { result, snapshot, diff } = setup();
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(2);

    // 再接続スナップショットに reth-1 が含まれる → 最古のゴーストを 1 枚消す。
    snapshot([nodeEntity("reth-1")]);
    expect(result.current.ghosts).toHaveLength(1);

    // その後、同じ reth-1 が update として再送されても「既知」なので 2 枚目は消えない。
    diff([{ type: "entityUpdated", id: "reth-1", patch: { blockHeight: 3 } }]);
    expect(result.current.ghosts).toHaveLength(1);
  });

  it("removes a ghost when a fresh entity id appears in the reconnect snapshot even if a prior entity was already seen", () => {
    const { result, diff, snapshot } = setup();
    // 初回スナップショット相当で既存ノードを 1 件認知。
    diff([{ type: "entityAdded", entity: nodeEntity("existing-1") }]);
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);

    // 再接続スナップショットに既存ノード + 新規ノードが含まれる。新規 id の
    // 到着分だけがゴーストを消す。
    snapshot([nodeEntity("existing-1"), nodeEntity("reth-2")]);
    expect(result.current.ghosts).toHaveLength(0);
  });
});

describe("useCommands ghost nodes: placement index survives infra removal between adds (Issue #113)", () => {
  it("does not place a new ghost on the same grid cell as a still-pending ghost after an existing infra entity is removed in between", () => {
    const { result, diff } = setup();

    // 1. 既存 node を登録（infraCount=1）。
    diff([{ type: "entityAdded", entity: nodeEntity("existing-1") }]);

    // 2. addNode → 仮カードが1枚 (旧実装では index = infraCount(1) + seq(0) = 1)。
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);
    const firstGhostPosition = result.current.ghosts[0].position;

    // 3. 既存 node を削除（infraCount=0）。まだ手順2の仮カードは実体化していない
    //    ため残ったまま。
    diff([{ type: "entityRemoved", id: "existing-1" }]);

    // 4. addNode → 仮カードが2枚目 (旧実装では index = infraCount(0) + seq(1) = 1
    //    となり、手順2の仮カードと同一グリッドセルに重なっていた)。
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    const secondGhostPosition = result.current.ghosts[1].position;
    expect(secondGhostPosition).not.toEqual(firstGhostPosition);
    // 全ての仮カードが互いに異なるグリッドセルにあること（既存カード削除の
    // 有無に関わらず、仮カード同士は常に別セルに置かれる）。
    const positions = result.current.ghosts.map((g) => `${g.position.x},${g.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("keeps ghost placement monotonic across repeated removal of existing infra between adds", () => {
    const { result, diff } = setup();

    // 既存 node を2件登録（infraCount=2）。
    diff([{ type: "entityAdded", entity: nodeEntity("existing-1") }]);
    diff([{ type: "entityAdded", entity: nodeEntity("existing-2") }]);

    act(() => result.current.actions.addNode()); // ghost #1 (infraCount=2)
    diff([{ type: "entityRemoved", id: "existing-1" }]); // infraCount=1
    act(() => result.current.actions.addNode()); // ghost #2
    diff([{ type: "entityRemoved", id: "existing-2" }]); // infraCount=0
    act(() => result.current.actions.addNode()); // ghost #3

    // どの仮カードも entityAdded による実体化を経ていないため、3枚とも残っている。
    expect(result.current.ghosts).toHaveLength(3);
    const positions = result.current.ghosts.map((g) => `${g.position.x},${g.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

/**
 * Issue #113 の配置 index 計算（Math.max(ghostIndexRef, infraCount) の単調増加
 * カウンタ）に対する異常系・境界値の追加検証。位置の一致/不一致は実装が使う
 * defaultGridPosition で直接確認し、「index が巻き戻らない」「infraCount の
 * 急増で前方へ押し出される」「node/workbench 混在でも独立して別セルに置く」
 * といった不変条件を固定する。
 */
function positionKey(node: GhostFlowNode): string {
  return `${node.position.x},${node.position.y}`;
}

describe("useCommands ghost nodes: placement index edge cases (Issue #113)", () => {
  it("assigns a fresh grid cell to a re-added ghost even after a middle ghost was removed by failure", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.addNode(); // cmd0 / index 0
      result.current.actions.addNode(); // cmd1 / index 1
      result.current.actions.addNode(); // cmd2 / index 2
    });
    expect(result.current.ghosts).toHaveLength(3);

    // 途中（2番目に送った）の仮カードだけが失敗で消える。
    resolve(1, false, "boom");
    expect(result.current.ghosts).toHaveLength(2);

    // 再度 addNode。空いた index 1 のセルを再利用せず、単調増加で index 3 へ。
    act(() => result.current.actions.addNode()); // cmd3 / index 3
    expect(result.current.ghosts).toHaveLength(3);

    const newGhost = result.current.ghosts[2];
    expect(newGhost.position).toEqual(defaultGridPosition(3));
    // 消えた仮カードの旧セル（index 1）を再利用していないこと。
    expect(newGhost.position).not.toEqual(defaultGridPosition(1));
    const positions = result.current.ghosts.map(positionKey);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("keeps placement monotonic when a ghost is confirmed then its entity is removed before re-adding", () => {
    const { result, diff } = setup();
    act(() => {
      result.current.actions.addNode(); // A / index 0
      result.current.actions.addNode(); // B / index 1
    });
    const ghostBPosition = result.current.ghosts[1].position; // index 1

    // A が実体到着で確定（FIFO で最古の A が消える）。B は残る。
    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);
    expect(result.current.ghosts).toHaveLength(1);

    // 確定した実体がその後削除され infraCount が 0 に戻る。
    diff([{ type: "entityRemoved", id: "reth-1" }]);

    // 再度 addNode。infraCount が下がっても index は巻き戻らず、まだ表示中の B と
    // 衝突しない index 2 へ。
    act(() => result.current.actions.addNode()); // C / index 2
    expect(result.current.ghosts).toHaveLength(2);

    const cPosition = result.current.ghosts[1].position;
    expect(cPosition).toEqual(defaultGridPosition(2));
    expect(cPosition).not.toEqual(ghostBPosition);
  });

  it("places interleaved node and workbench ghosts on independent, monotonically increasing cells", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.addNode(); // index 0 (node)
      result.current.actions.addWorkbench("Alice"); // index 1 (workbench)
      result.current.actions.addNode(); // index 2 (node)
      result.current.actions.addWorkbench("Bob"); // index 3 (workbench)
    });
    expect(result.current.ghosts).toHaveLength(4);

    // node/workbench は同一の単調カウンタを共有し、種別に関わらず別セルへ。
    expect(result.current.ghosts.map((g) => g.position)).toEqual(
      [0, 1, 2, 3].map((i) => defaultGridPosition(i)),
    );
    const positions = result.current.ghosts.map(positionKey);
    expect(new Set(positions).size).toBe(4);
  });

  it("pushes a new ghost forward past a burst of infra added by other clients (Math.max lower bound)", () => {
    const { result, diff } = setup();

    // node の到着では消えない workbench の仮カードを1枚出しておく（index 0）。
    act(() => result.current.actions.addWorkbench("Bob"));
    const workbenchPosition = result.current.ghosts[0].position;

    // 他クライアントからの一括追加で node が一気に5件増える（infraCount=5）。
    diff([
      { type: "entityAdded", entity: nodeEntity("reth-1") },
      { type: "entityAdded", entity: nodeEntity("reth-2") },
      { type: "entityAdded", entity: nodeEntity("reth-3") },
      { type: "entityAdded", entity: nodeEntity("reth-4") },
      { type: "entityAdded", entity: nodeEntity("reth-5") },
    ]);
    // node の仮カードは無いので workbench の仮カードは消費されず残る。
    expect(result.current.ghosts).toHaveLength(1);

    // addNode。ghostIndexRef(1) より infraCount(5) が大きいので index は 5 へ
    // 押し出され、既存 infra カード（grid index 0..4）と重ならない。
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    const nodeGhost = result.current.ghosts[1];
    expect(nodeGhost.position).toEqual(defaultGridPosition(5));
    expect(nodeGhost.position).not.toEqual(workbenchPosition);
    const infraCells = [0, 1, 2, 3, 4].map((i) => `${defaultGridPosition(i).x},${defaultGridPosition(i).y}`);
    expect(infraCells).not.toContain(positionKey(nodeGhost));
  });

  it("assigns distinct forward cells to two ghosts created in the same tick when infra already exists", () => {
    const { result, diff } = setup();

    // 既存 node を3件登録（infraCount=3）。仮カードは無いので消費されない。
    diff([
      { type: "entityAdded", entity: nodeEntity("existing-1") },
      { type: "entityAdded", entity: nodeEntity("existing-2") },
      { type: "entityAdded", entity: nodeEntity("existing-3") },
    ]);

    // 同一イベントハンドラ内での連続 addNode。render を挟まなくても両者の index が
    // 進み、かつ infraCount(3) を下限に前方へ置かれる（index 3, 4）。
    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
    });
    expect(result.current.ghosts).toHaveLength(2);
    expect(result.current.ghosts[0].position).toEqual(defaultGridPosition(3));
    expect(result.current.ghosts[1].position).toEqual(defaultGridPosition(4));

    const infraCells = [0, 1, 2].map((i) => `${defaultGridPosition(i).x},${defaultGridPosition(i).y}`);
    for (const ghost of result.current.ghosts) {
      expect(infraCells).not.toContain(positionKey(ghost));
    }
  });

  it("never assigns two concurrently-pending ghosts the same cell through a long interleaving", () => {
    const { result, diff, resolve } = setup();
    const assertDistinct = () => {
      const positions = result.current.ghosts.map(positionKey);
      expect(new Set(positions).size).toBe(positions.length);
    };

    act(() => result.current.actions.addNode()); // cmd0 node / index 0
    assertDistinct();
    act(() => result.current.actions.addWorkbench("Alice")); // cmd1 wb / index 1
    assertDistinct();

    // node の実体到着で最古の node 仮カード（cmd0）が消える。
    diff([{ type: "entityAdded", entity: nodeEntity("reth-1") }]);
    assertDistinct();

    act(() => result.current.actions.addNode()); // cmd2 node / index 2
    assertDistinct();

    // 実体が削除され infraCount が下がる。
    diff([{ type: "entityRemoved", id: "reth-1" }]);
    assertDistinct();

    // 直近に送った addNode（cmd2）が失敗して消える。
    resolve(2, false, "boom");
    assertDistinct();

    act(() => result.current.actions.addWorkbench("Bob")); // cmd3 wb / index 3
    assertDistinct();
    act(() => result.current.actions.addNode()); // cmd4 node / index 4
    assertDistinct();

    // 最終的に残る仮カードは wb(cmd1,index1), wb(cmd3,index3), node(cmd4,index4)。
    expect(result.current.ghosts.map((g) => g.position)).toEqual(
      [1, 3, 4].map((i) => defaultGridPosition(i)),
    );
  });

  it("does not collide a workbench ghost with a still-pending node ghost after infra was removed in between", () => {
    const { result, diff } = setup();

    // 既存 node を1件登録（infraCount=1）。
    diff([{ type: "entityAdded", entity: nodeEntity("existing-1") }]);

    // addNode → 仮カードを1枚。旧 infraCount+seq 方式では index = 1 + 0 = 1。
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(1);
    const nodeGhostPosition = result.current.ghosts[0].position;

    // 既存 node を削除（infraCount=0）。手順前の node 仮カードは実体化していない
    // ため残る。
    diff([{ type: "entityRemoved", id: "existing-1" }]);

    // 続けて addWorkbench → 別種の仮カード。旧方式では index = 0 + 1 = 1 となり、
    // まだ表示中の node 仮カード（index 1）と同一グリッドセルに重なっていた。
    // 単調カウンタ方式では index 2 へ押し出され重ならない。
    act(() => result.current.actions.addWorkbench("Bob"));
    expect(result.current.ghosts).toHaveLength(2);

    const workbenchGhost = result.current.ghosts[1];
    expect(workbenchGhost.data.kind).toBe("workbench");
    expect(workbenchGhost.position).toEqual(defaultGridPosition(2));
    expect(workbenchGhost.position).not.toEqual(nodeGhostPosition);
    const positions = result.current.ghosts.map(positionKey);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
