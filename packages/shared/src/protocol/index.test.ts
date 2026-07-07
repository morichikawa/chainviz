import { describe, expect, it } from "vitest";
import type { ClientMessage, Command, WorkbenchOperation } from "./index.js";

describe("protocol commands", () => {
  it("builds a runWorkbenchOperation command for each operation type", () => {
    // WorkbenchOperation は type で判別する discriminated union。各バリアントの
    // 固有フィールドへ安全に絞り込めること（コンパイル時の検証を兼ねる）。
    // contractKey は型上は任意の string だが、実装（collector の
    // ContractAdapter・profiles/ethereum/contracts/catalog.json）は Solidity の
    // コントラクト名そのまま（PascalCase）をキーとして使うため、例もそれに
    // 合わせる（Issue #161 で kebab-case との不一致を解消）。
    const operations: WorkbenchOperation[] = [
      { type: "transfer", to: "0x0b0b", amount: "1000000000000000000" },
      { type: "deployContract", contractKey: "ChainvizToken" },
      {
        type: "callContract",
        contractAddress: "0x0c0de",
        functionName: "transfer",
        args: ["0x0b0b", "1000000000000000000"],
      },
    ];

    const described = operations.map((op) => {
      switch (op.type) {
        case "transfer":
          return `transfer ${op.amount} to ${op.to}`;
        case "deployContract":
          return `deploy ${op.contractKey}`;
        case "callContract":
          return `call ${op.contractAddress}.${op.functionName}(${op.args.join(",")})`;
      }
    });

    expect(described).toEqual([
      "transfer 1000000000000000000 to 0x0b0b",
      "deploy ChainvizToken",
      "call 0x0c0de.transfer(0x0b0b,1000000000000000000)",
    ]);
  });

  it("round-trips a runWorkbenchOperation client message through JSON", () => {
    // フロント → collector は WebSocket 上で JSON にシリアライズされて渡る。
    const command: Command = {
      action: "runWorkbenchOperation",
      workbenchId: "workbench-alice",
      operation: {
        type: "callContract",
        contractAddress: "0x0c0de",
        functionName: "transfer",
        args: ["0x0b0b", "1"],
        amount: "0",
      },
    };
    const message: ClientMessage = {
      type: "command",
      commandId: "cmd-1",
      command,
    };

    const roundTripped = JSON.parse(JSON.stringify(message)) as ClientMessage;
    expect(roundTripped.command.action).toBe("runWorkbenchOperation");
    if (roundTripped.command.action !== "runWorkbenchOperation") {
      throw new Error("unexpected action after round trip");
    }
    expect(roundTripped.command.workbenchId).toBe("workbench-alice");
    expect(roundTripped.command.operation).toEqual(command.operation);
  });

  it("omits the optional amount of callContract in JSON (省略 = 0 の意味論)", () => {
    const operation: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "increment",
      args: [],
    };
    const serialized = JSON.stringify(operation);
    expect(serialized).not.toContain("amount");
    const parsed = JSON.parse(serialized) as WorkbenchOperation;
    if (parsed.type !== "callContract") throw new Error("unexpected type");
    expect(parsed.amount).toBeUndefined();
  });

  it("round-trips the transfer variant through JSON", () => {
    // callContract 以外のバリアントも WebSocket 上で JSON 往復する。
    const operation: WorkbenchOperation = {
      type: "transfer",
      to: "0x0b0b",
      amount: "1000000000000000000",
    };
    const parsed = JSON.parse(JSON.stringify(operation)) as WorkbenchOperation;
    if (parsed.type !== "transfer") throw new Error("unexpected type");
    expect(parsed.to).toBe("0x0b0b");
    expect(parsed.amount).toBe("1000000000000000000");
  });

  it("round-trips the deployContract variant through JSON", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "ChainvizToken",
    };
    const parsed = JSON.parse(JSON.stringify(operation)) as WorkbenchOperation;
    if (parsed.type !== "deployContract") throw new Error("unexpected type");
    expect(parsed.contractKey).toBe("ChainvizToken");
  });

  it("preserves a callContract with an empty args array (no-arg function)", () => {
    // 引数ゼロの関数呼び出し。空配列が省略（undefined）と取り違えられず往復
    // することを確認する（args は callContract の必須フィールド）。
    const operation: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "increment",
      args: [],
    };
    const parsed = JSON.parse(JSON.stringify(operation)) as WorkbenchOperation;
    if (parsed.type !== "callContract") throw new Error("unexpected type");
    expect(parsed.args).toEqual([]);
    expect(parsed.args).not.toBeUndefined();
  });

  it("discriminates runWorkbenchOperation from the other Command actions by action", () => {
    // Command 共用体に runWorkbenchOperation が加わっても、既存アクションの
    // 判別（action による絞り込み）と衝突しないことを確認する。
    const commands: Command[] = [
      { action: "addNode", chainProfile: "ethereum" },
      { action: "removeNode", nodeId: "node-3" },
      { action: "addWorkbench", label: "alice" },
      { action: "removeWorkbench", workbenchId: "workbench-1" },
      {
        action: "runWorkbenchOperation",
        workbenchId: "workbench-alice",
        operation: { type: "transfer", to: "0x0b0b", amount: "1" },
      },
    ];

    const described = commands.map((command) => {
      switch (command.action) {
        case "addNode":
          return `addNode:${command.chainProfile}`;
        case "removeNode":
          return `removeNode:${command.nodeId}`;
        case "addWorkbench":
          return `addWorkbench:${command.label}`;
        case "removeWorkbench":
          return `removeWorkbench:${command.workbenchId}`;
        case "runWorkbenchOperation":
          return `runWorkbenchOperation:${command.workbenchId}:${command.operation.type}`;
      }
    });

    expect(described).toEqual([
      "addNode:ethereum",
      "removeNode:node-3",
      "addWorkbench:alice",
      "removeWorkbench:workbench-1",
      "runWorkbenchOperation:workbench-alice:transfer",
    ]);
  });

  it("rejects an unknown WorkbenchOperation discriminant at compile time", () => {
    // 判別共用体の型安全性の回帰ガード。存在しない type を渡すとコンパイル
    // エラーになること（@ts-expect-error が実際にエラーを検出すること）を
    // ビルド（tsc）で固定する。エラーが消えると @ts-expect-error 自体が
    // 未使用として tsc エラーになり、退行に気づける。
    const invalid: WorkbenchOperation =
      // @ts-expect-error "burn" は WorkbenchOperation のバリアントではない
      { type: "burn", amount: "1" };
    // 実行時にはオブジェクトとして評価できることだけ確認する。
    expect((invalid as { type: string }).type).toBe("burn");
  });

  it("rejects a callContract missing its required fields at compile time", () => {
    // callContract は contractAddress / functionName / args を必須とする。
    // functionName と args を欠いた呼び出しは型エラーになること。
    // @ts-expect-error functionName と args が欠けている
    const invalid: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
    };
    expect((invalid as { type: string }).type).toBe("callContract");
  });

  it("rejects mixing fields from different WorkbenchOperation variants", () => {
    // transfer に callContract 専用の functionName を混ぜるのは型エラー。
    // 判別共用体がバリアント間のフィールド混在を弾くことを固定する。
    const invalid: WorkbenchOperation = {
      type: "transfer",
      to: "0x0b0b",
      amount: "1",
      // @ts-expect-error transfer バリアントに functionName は存在しない
      functionName: "transfer",
    };
    expect((invalid as { type: string }).type).toBe("transfer");
  });
});
