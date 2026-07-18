import type { ContractEntity, DiffEvent } from "@chainviz/shared";
import { describe, expect, it, vi } from "vitest";
import { createMockClient } from "./mockData.js";

/**
 * `createMockClient` の `runWorkbenchOperation` シミュレーション（Issue #167）
 * に絞ったテスト。既存の `mockData.test.ts` が肥大化しないよう別ファイルに
 * 分ける。以前はこのコマンドが常に `ok:false` を返す固定応答だったため
 * （設計時の申し送り）、実際に成功/失敗の両方をシミュレートするようになった
 * ことを確認する。
 */

describe("createMockClient runWorkbenchOperation: transfer", () => {
  it("resolves ok:true for a transfer with a non-empty destination", async () => {
    const onCommandResult = vi.fn();
    const client = createMockClient({ onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "transfer", to: "0xbob", amount: "1000000000000000000" },
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, true, undefined);
  });

  it("rejects a transfer with an empty destination address", async () => {
    const onCommandResult = vi.fn();
    const client = createMockClient({ onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "transfer", to: "   ", amount: "1" },
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, false, expect.any(String));
  });

  it("rejects any operation sent from an unknown workbenchId", async () => {
    const onCommandResult = vi.fn();
    const client = createMockClient({ onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "does-not-exist",
      operation: { type: "transfer", to: "0xbob", amount: "1" },
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, false, expect.any(String));
  });
});

describe("createMockClient runWorkbenchOperation: deployContract", () => {
  it("succeeds for a known catalog key and emits an entityAdded contract diff", async () => {
    const onDiff = vi.fn();
    const onCommandResult = vi.fn();
    const client = createMockClient({ onDiff, onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "deployContract", contractKey: "ChainvizToken" },
    });
    await Promise.resolve();

    expect(onCommandResult).toHaveBeenCalledWith(id, true, undefined);
    const diffs = onDiff.mock.calls.at(-1)?.[0] as DiffEvent[];
    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe("entityAdded");
    const entity = (diffs[0] as { entity: ContractEntity }).entity;
    expect(entity.kind).toBe("contract");
    expect(entity.catalogKey).toBe("ChainvizToken");
    expect(entity.name).toBe("ChainvizToken");
    expect(entity.token).toEqual({ symbol: "CVZDEMO", decimals: 18 });
  });

  it("succeeds for Counter (no token metadata)", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "deployContract", contractKey: "Counter" },
    });
    await Promise.resolve();
    const diffs = onDiff.mock.calls.at(-1)?.[0] as DiffEvent[];
    const entity = (diffs[0] as { entity: ContractEntity }).entity;
    expect(entity.catalogKey).toBe("Counter");
    expect(entity.token).toBeUndefined();
  });

  it("rejects an unknown catalog key", async () => {
    const onCommandResult = vi.fn();
    const client = createMockClient({ onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "deployContract", contractKey: "NotInCatalog" },
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, false, expect.any(String));
  });

  it("assigns each successful deploy a distinct address", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "deployContract", contractKey: "Counter" },
    });
    await Promise.resolve();
    client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "deployContract", contractKey: "Counter" },
    });
    await Promise.resolve();
    const first = (onDiff.mock.calls[0][0][0] as { entity: ContractEntity }).entity;
    const second = (onDiff.mock.calls[1][0][0] as { entity: ContractEntity }).entity;
    expect(first.address).not.toBe(second.address);
  });

  it("sets deployerAddress only when deployed from workbench-alice (the only wallet-bearing mock workbench)", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addWorkbench", label: "Bob" });
    await Promise.resolve();
    const newWorkbenchId = (onDiff.mock.calls[0][0][0] as { entity: { id: string } })
      .entity.id;

    client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: newWorkbenchId,
      operation: { type: "deployContract", contractKey: "Counter" },
    });
    await Promise.resolve();
    const entity = (onDiff.mock.calls.at(-1)?.[0][0] as { entity: ContractEntity })
      .entity;
    expect(entity.deployerAddress).toBeUndefined();
  });
});

describe("createMockClient runWorkbenchOperation: callContract", () => {
  it("succeeds when calling a contract present in the initial snapshot", async () => {
    const onCommandResult = vi.fn();
    const client = createMockClient({ onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: {
        type: "callContract",
        contractAddress: "0xcafe010000000000000000000000000000000000",
        functionName: "transfer(address,uint256)",
        args: ["0xbob", "1"],
      },
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, true, undefined);
  });

  it("succeeds when calling a contract deployed earlier in the same session", async () => {
    const onDiff = vi.fn();
    const onCommandResult = vi.fn();
    const client = createMockClient({ onDiff, onCommandResult }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: { type: "deployContract", contractKey: "Counter" },
    });
    await Promise.resolve();
    const deployed = (onDiff.mock.calls[0][0][0] as { entity: ContractEntity })
      .entity;

    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: {
        type: "callContract",
        contractAddress: deployed.address,
        functionName: "increment()",
        args: [],
      },
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, true, undefined);
  });

  it("rejects calling an address that has never been deployed/cataloged", async () => {
    const onCommandResult = vi.fn();
    const client = createMockClient({ onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: {
        type: "callContract",
        contractAddress: "0x0000000000000000000000000000000000dead",
        functionName: "transfer(address,uint256)",
        args: ["0xbob", "1"],
      },
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, false, expect.any(String));
  });
});
