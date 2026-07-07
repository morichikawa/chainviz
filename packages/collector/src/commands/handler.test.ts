import { describe, expect, it, vi } from "vitest";
import { CommandHandler } from "./handler.js";
import type { NodeLifecycle, WorkbenchOperationResult } from "./lifecycle.js";

function fakeLifecycle(overrides: Partial<NodeLifecycle> = {}): NodeLifecycle {
  return {
    addNode: vi.fn(async () => {}),
    removeNode: vi.fn(async () => {}),
    addWorkbench: vi.fn(async () => {}),
    removeWorkbench: vi.fn(async () => {}),
    runWorkbenchOperation: vi.fn(
      async (): Promise<WorkbenchOperationResult> => ({}),
    ),
    ...overrides,
  };
}

describe("CommandHandler", () => {
  it("dispatches addNode with the chain profile", async () => {
    const lifecycle = fakeLifecycle();
    const handler = new CommandHandler(lifecycle);

    const result = await handler.handle({
      action: "addNode",
      chainProfile: "ethereum",
    });

    expect(result).toEqual({ ok: true });
    expect(lifecycle.addNode).toHaveBeenCalledWith("ethereum");
  });

  it("dispatches removeNode with the node id", async () => {
    const lifecycle = fakeLifecycle();
    const handler = new CommandHandler(lifecycle);
    await handler.handle({ action: "removeNode", nodeId: "n1" });
    expect(lifecycle.removeNode).toHaveBeenCalledWith("n1");
  });

  it("dispatches addWorkbench with the label", async () => {
    const lifecycle = fakeLifecycle();
    const handler = new CommandHandler(lifecycle);
    await handler.handle({ action: "addWorkbench", label: "Alice" });
    expect(lifecycle.addWorkbench).toHaveBeenCalledWith("Alice");
  });

  it("dispatches removeWorkbench with the workbench id", async () => {
    const lifecycle = fakeLifecycle();
    const handler = new CommandHandler(lifecycle);
    await handler.handle({ action: "removeWorkbench", workbenchId: "w1" });
    expect(lifecycle.removeWorkbench).toHaveBeenCalledWith("w1");
  });

  it("converts a thrown error into a failing result with its message", async () => {
    const lifecycle = fakeLifecycle({
      addNode: vi.fn(async () => {
        throw new Error("no free node slot available in the network");
      }),
    });
    const handler = new CommandHandler(lifecycle);

    const result = await handler.handle({
      action: "addNode",
      chainProfile: "ethereum",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("no free node slot available in the network");
  });

  it("does not throw when the lifecycle rejects", async () => {
    const lifecycle = fakeLifecycle({
      removeNode: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const handler = new CommandHandler(lifecycle);
    await expect(
      handler.handle({ action: "removeNode", nodeId: "x" }),
    ).resolves.toEqual({ ok: false, error: "boom" });
  });

  it("reports an unknown command action", async () => {
    const lifecycle = fakeLifecycle();
    const handler = new CommandHandler(lifecycle);
    const result = await handler.handle({
      action: "explode",
    } as unknown as Parameters<CommandHandler["handle"]>[0]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown command action/);
  });

  it("names the offending action in the unknown-action error", async () => {
    const handler = new CommandHandler(fakeLifecycle());
    const result = await handler.handle({
      action: "reboot",
    } as unknown as Parameters<CommandHandler["handle"]>[0]);
    expect(result.error).toBe("unknown command action: reboot");
  });

  it("reports (none) when the command has no action", async () => {
    const handler = new CommandHandler(fakeLifecycle());
    const result = await handler.handle(
      {} as unknown as Parameters<CommandHandler["handle"]>[0],
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown command action: (none)");
  });

  it("does not dispatch to any lifecycle method for an unknown action", async () => {
    const lifecycle = fakeLifecycle();
    const handler = new CommandHandler(lifecycle);
    await handler.handle({
      action: "explode",
    } as unknown as Parameters<CommandHandler["handle"]>[0]);
    expect(lifecycle.addNode).not.toHaveBeenCalled();
    expect(lifecycle.removeNode).not.toHaveBeenCalled();
    expect(lifecycle.addWorkbench).not.toHaveBeenCalled();
    expect(lifecycle.removeWorkbench).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error thrown value into the result", async () => {
    const lifecycle = fakeLifecycle({
      addWorkbench: vi.fn(async () => {
        throw "plain string failure";
      }),
    });
    const handler = new CommandHandler(lifecycle);
    const result = await handler.handle({
      action: "addWorkbench",
      label: "Alice",
    });
    expect(result).toEqual({ ok: false, error: "plain string failure" });
  });

  describe("runWorkbenchOperation", () => {
    it("dispatches with the workbenchId and operation, unwrapped", async () => {
      const lifecycle = fakeLifecycle();
      const handler = new CommandHandler(lifecycle);

      const result = await handler.handle({
        action: "runWorkbenchOperation",
        workbenchId: "chainviz-ethereum/Alice",
        operation: { type: "transfer", to: "0x0b0b", amount: "1" },
      });

      expect(result).toEqual({ ok: true });
      expect(lifecycle.runWorkbenchOperation).toHaveBeenCalledWith(
        "chainviz-ethereum/Alice",
        { type: "transfer", to: "0x0b0b", amount: "1" },
      );
    });

    it("returns ok:true without leaking txHash/deployedAddress into commandResult", async () => {
      // docs/ARCHITECTURE.md §3 の設計どおり、commandResult は ok/error のみ。
      // 実際の反映は後続の diff（tx ライフサイクル購読）に委ねる。
      const lifecycle = fakeLifecycle({
        runWorkbenchOperation: vi.fn(async () => ({
          txHash: "0xabc123",
          deployedAddress: "0xdeadbeef",
        })),
      });
      const handler = new CommandHandler(lifecycle);
      const result = await handler.handle({
        action: "runWorkbenchOperation",
        workbenchId: "chainviz-ethereum/Alice",
        operation: { type: "deployContract", contractKey: "counter" },
      });
      expect(result).toEqual({ ok: true });
      expect(result).not.toHaveProperty("txHash");
      expect(result).not.toHaveProperty("deployedAddress");
    });

    it("logs the outcome (including txHash) on success", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const lifecycle = fakeLifecycle({
        runWorkbenchOperation: vi.fn(async () => ({ txHash: "0xabc123" })),
      });
      const handler = new CommandHandler(lifecycle);
      await handler.handle({
        action: "runWorkbenchOperation",
        workbenchId: "chainviz-ethereum/Alice",
        operation: { type: "transfer", to: "0x0b0b", amount: "1" },
      });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("0xabc123"));
      logSpy.mockRestore();
    });

    it("converts a thrown error (e.g. cast/forge exec failure) into a failing result", async () => {
      const lifecycle = fakeLifecycle({
        runWorkbenchOperation: vi.fn(async () => {
          throw new Error(
            "transfer 1 to 0x0b0b failed on workbench chainviz-ethereum/Alice: Error: insufficient funds",
          );
        }),
      });
      const handler = new CommandHandler(lifecycle);
      const result = await handler.handle({
        action: "runWorkbenchOperation",
        workbenchId: "chainviz-ethereum/Alice",
        operation: { type: "transfer", to: "0x0b0b", amount: "1" },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/insufficient funds/);
    });

    it("dispatches callContract operations with all their fields intact", async () => {
      const lifecycle = fakeLifecycle();
      const handler = new CommandHandler(lifecycle);
      const operation = {
        type: "callContract" as const,
        contractAddress: "0x0c0de",
        functionName: "transfer(address,uint256)",
        args: ["0x0b0b", "500"],
        amount: "0",
      };
      await handler.handle({
        action: "runWorkbenchOperation",
        workbenchId: "chainviz-ethereum/Alice",
        operation,
      });
      expect(lifecycle.runWorkbenchOperation).toHaveBeenCalledWith(
        "chainviz-ethereum/Alice",
        operation,
      );
    });
  });
});
