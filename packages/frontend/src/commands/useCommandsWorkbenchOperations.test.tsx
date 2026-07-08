import type {
  Command,
  ContractEntity,
  DiffEvent,
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
import { useCommands } from "./useCommands.js";

/**
 * `useCommands.ts` の runWorkbenchOperation まわり（ARCHITECTURE.md §6.5:
 * ワークベンチの保留状態・デプロイの仮カード）に絞ったテスト。既存の
 * useCommands.test.tsx が肥大化しないよう、対象ロジックごとにファイルを
 * 分ける（Issue #167）。addNode/addWorkbench 周りの既存挙動は
 * useCommands.test.tsx でカバー済みなのでここでは扱わない。
 */

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

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0xcccccccccccccccccccccccccccccccccccccc",
    chainType: "ethereum",
    ...overrides,
  };
}

afterEach(cleanup);

describe("useCommands: runWorkbenchOperation pending tracking (ARCHITECTURE.md §6.5)", () => {
  it("marks the workbench pending immediately after dispatch", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "transfer",
        to: "0xbob",
        amount: "1",
      });
    });
    expect(result.current.pendingOperationWorkbenchIds.has("workbench-alice")).toBe(
      true,
    );
  });

  it("clears the pending flag once commandResult(ok:true) arrives", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "transfer",
        to: "0xbob",
        amount: "1",
      });
    });
    resolve(0, true);
    expect(result.current.pendingOperationWorkbenchIds.has("workbench-alice")).toBe(
      false,
    );
  });

  it("clears the pending flag on commandResult(ok:false) too (failure still resolves the pending state)", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "transfer",
        to: "0xbob",
        amount: "1",
      });
    });
    resolve(0, false, "insufficient funds");
    expect(result.current.pendingOperationWorkbenchIds.has("workbench-alice")).toBe(
      false,
    );
  });

  it("keeps the workbench pending until every in-flight operation for it resolves (no double-submit guard)", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "transfer",
        to: "0xbob",
        amount: "1",
      });
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "transfer",
        to: "0xcarol",
        amount: "2",
      });
    });
    resolve(0, true);
    // 2件目がまだ保留中なので pending は維持される。
    expect(result.current.pendingOperationWorkbenchIds.has("workbench-alice")).toBe(
      true,
    );
    resolve(1, true);
    expect(result.current.pendingOperationWorkbenchIds.has("workbench-alice")).toBe(
      false,
    );
  });

  it("tracks pending state independently per workbench", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "transfer",
        to: "0xbob",
        amount: "1",
      });
      result.current.actions.runWorkbenchOperation("workbench-bob", {
        type: "transfer",
        to: "0xalice",
        amount: "1",
      });
    });
    resolve(0, true);
    expect(result.current.pendingOperationWorkbenchIds.has("workbench-alice")).toBe(
      false,
    );
    expect(result.current.pendingOperationWorkbenchIds.has("workbench-bob")).toBe(
      true,
    );
  });

  it("notifies an error on failure, same as other commands", () => {
    const { result, resolve, notify } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "transfer",
        to: "0xbob",
        amount: "1",
      });
    });
    resolve(0, false, "boom");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error" }),
    );
  });
});

describe("useCommands: deploy ghost card (ARCHITECTURE.md §6.5)", () => {
  it("adds a contract ghost immediately after dispatching a deployContract operation", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "ChainvizToken",
      });
    });
    const ghost = result.current.ghosts.find((g) => g.data.kind === "contract");
    expect(ghost).toBeDefined();
    expect(ghost?.data.catalogKey).toBe("ChainvizToken");
    expect(ghost?.data.label).toBe("ChainvizToken");
  });

  it("does not add any ghost for transfer/callContract operations", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "callContract",
        contractAddress: "0xc0de",
        functionName: "increment()",
        args: [],
      });
    });
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("removes the deploy ghost when a contract with the matching catalogKey arrives", () => {
    const { result, snapshot, diff } = setup();
    snapshot([]);
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "ChainvizToken",
      });
    });
    expect(result.current.ghosts).toHaveLength(1);

    diff([
      {
        type: "entityAdded",
        entity: contract({ catalogKey: "ChainvizToken", name: "ChainvizToken" }),
      },
    ]);
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("removes the deploy ghost when commandResult(ok:false) arrives (deploy failed)", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "ChainvizToken",
      });
    });
    expect(result.current.ghosts).toHaveLength(1);
    resolve(0, false, "forge create failed");
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("marks the workbench pending when the operation is a deployContract too", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "Counter",
      });
    });
    expect(
      result.current.pendingOperationWorkbenchIds.has("workbench-alice"),
    ).toBe(true);
  });

  it("gives simultaneously-live deploy ghosts distinct grid positions even after the contract count drops to zero (Issue #113 regression)", () => {
    // Issue #113 の算術的な取り違えを CONTRACT_GRID でも防げているかの回帰。
    // 「デプロイ→実体到着(count=1)→削除(count=0)→再デプロイ」で count が
    // 下がっても、単調増加インデックスにより新旧のゴーストが同じグリッド位置に
    // 重ならないことを確認する（合算方式のままだと衝突していた）。
    const { result, snapshot, diff } = setup();
    snapshot([]);
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "Counter",
      });
    });
    // 1件目が実体化して count=1 になり、ゴーストは消える。
    diff([
      {
        type: "entityAdded",
        entity: contract({ address: "0xc0de01", catalogKey: "Counter", name: "Counter" }),
      },
    ]);
    // その実体が削除されて count=0 に戻る（Issue #113 の起点となる状況）。
    diff([{ type: "entityRemoved", id: "0xc0de01" }]);
    // 続けて2件を再デプロイする（同一ハンドラ内での連続発行）。
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "Counter",
      });
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "ChainvizToken",
      });
    });
    const contractGhosts = result.current.ghosts.filter(
      (g) => g.data.kind === "contract",
    );
    expect(contractGhosts).toHaveLength(2);
    const positions = contractGhosts.map((g) => JSON.stringify(g.position));
    expect(new Set(positions).size).toBe(2);
  });

  it("removes a pending deploy ghost via FIFO fallback when a non-matching contract arrives (approximate matching, ARCHITECTURE.md §6.5)", () => {
    const { result, snapshot, diff } = setup();
    snapshot([]);
    act(() => {
      result.current.actions.runWorkbenchOperation("workbench-alice", {
        type: "deployContract",
        contractKey: "ChainvizToken",
      });
    });
    // catalogKey が一致しない到着では FIFO 近似で最古のコントラクトゴーストを
    // 消す（node/workbench ゴーストの clientType 不一致フォールバックと同じ
    // 設計判断。厳密な対応付けにはできないことを許容する）。
    diff([
      {
        type: "entityAdded",
        entity: contract({
          address: "0xc0de",
          catalogKey: "Counter",
          name: "Counter",
        }),
      },
    ]);
    expect(
      result.current.ghosts.filter((g) => g.data.kind === "contract"),
    ).toHaveLength(0);
  });
});
