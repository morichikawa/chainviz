import { describe, expect, it, vi } from "vitest";
import { CommandHandler } from "./handler.js";
import type { NodeLifecycle } from "./lifecycle.js";

function fakeLifecycle(overrides: Partial<NodeLifecycle> = {}): NodeLifecycle {
  return {
    addNode: vi.fn(async () => {}),
    removeNode: vi.fn(async () => {}),
    addWorkbench: vi.fn(async () => {}),
    removeWorkbench: vi.fn(async () => {}),
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
});
