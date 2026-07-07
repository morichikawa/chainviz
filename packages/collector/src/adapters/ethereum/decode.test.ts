import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  type Address,
} from "viem";
import type { CatalogEntry } from "./catalog.js";
import { decodeContractCall, decodeContractEvent } from "./decode.js";
import type { RpcLog } from "./eth-rpc-client.js";

const to = getAddress(`0x${"00".repeat(18)}aaaa`);
const spender = getAddress(`0x${"00".repeat(18)}bbbb`);

// ChainvizToken の一部だけを模した ABI（transfer/allowance/mint + Transfer/
// Approval イベント）。allowance は catalog.json 実物と同じく inputs が
// 無名（name: ""）であることを再現し、arg0/arg1 フォールバックを検証する。
const tokenAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  // bool 引数を持つ関数。stringifyArgValue の boolean 分岐を検証する。
  {
    type: "function",
    name: "setFlag",
    stateMutability: "nonpayable",
    inputs: [{ name: "on", type: "bool" }],
    outputs: [],
  },
  // 配列引数を持つ関数。stringifyArgValue の JSON.stringify（bigint replacer）
  // 分岐を検証する。ChainvizToken/Counter には無いが、ネストした構造の復号が
  // 精度を保つことを念のため確認する。
  {
    type: "function",
    name: "batchMint",
    stateMutability: "nonpayable",
    inputs: [{ name: "amounts", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

// Counter を模した ABI（引数なし関数・引数なしイベント）。
const counterAbi = [
  {
    type: "function",
    name: "increment",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "event",
    name: "Reset",
    inputs: [{ name: "caller", type: "address", indexed: true }],
  },
] as const;

const tokenEntry: CatalogEntry = { name: "ChainvizToken", abi: tokenAbi as unknown as unknown[] };
const counterEntry: CatalogEntry = { name: "Counter", abi: counterAbi as unknown as unknown[] };

describe("decodeContractCall", () => {
  it("decodes a function call with named arguments", () => {
    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [to, 1000n],
    });
    const result = decodeContractCall(tokenEntry, "0xtoken", input);
    expect(result).toEqual({
      contractAddress: "0xtoken",
      functionName: "transfer",
      args: [
        { name: "to", value: to },
        { name: "amount", value: "1000" },
      ],
    });
  });

  it("falls back to positional arg names (argN) when the ABI inputs are unnamed", () => {
    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "allowance",
      args: [to, spender],
    });
    const result = decodeContractCall(tokenEntry, "0xtoken", input);
    expect(result).toEqual({
      contractAddress: "0xtoken",
      functionName: "allowance",
      args: [
        { name: "arg0", value: to },
        { name: "arg1", value: spender },
      ],
    });
  });

  it("decodes a zero-argument function call with an empty args array", () => {
    const input = encodeFunctionData({ abi: counterAbi, functionName: "increment" });
    const result = decodeContractCall(counterEntry, "0xcounter", input);
    expect(result).toEqual({
      contractAddress: "0xcounter",
      functionName: "increment",
      args: [],
    });
  });

  it("falls back to rawFunctionId when the selector is not in the catalog's ABI", () => {
    const input = "0xdeadbeef0000";
    const result = decodeContractCall(tokenEntry, "0xtoken", input);
    expect(result).toEqual({ contractAddress: "0xtoken", rawFunctionId: "0xdeadbeef" });
  });

  it("logs the decode failure instead of silently swallowing it", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    decodeContractCall(tokenEntry, "0xtoken", "0xdeadbeef0000");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("0xdeadbeef"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("returns undefined (not a function call) for input '0x' (plain value transfer)", () => {
    expect(decodeContractCall(tokenEntry, "0xtoken", "0x")).toBeUndefined();
  });

  it("returns undefined for input shorter than a 4-byte selector", () => {
    expect(decodeContractCall(tokenEntry, "0xtoken", "0xab")).toBeUndefined();
  });

  it("decodes correctly when the input hex uses lowercase (as returned by reth)", () => {
    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [to, 1000n],
    }).toLowerCase();
    const result = decodeContractCall(tokenEntry, "0xtoken", input);
    expect(result?.functionName).toBe("transfer");
  });

  it("keeps a large uint256 argument's precision as a decimal string (no bigint->number loss)", () => {
    const huge = 2n ** 200n + 12345n;
    const input = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [to, huge] });
    const result = decodeContractCall(tokenEntry, "0xtoken", input);
    expect(result?.args?.[1]).toEqual({ name: "amount", value: huge.toString(10) });
  });

  it("stringifies a boolean argument as 'true'/'false'", () => {
    const input = encodeFunctionData({ abi: tokenAbi, functionName: "setFlag", args: [true] });
    const result = decodeContractCall(tokenEntry, "0xtoken", input);
    expect(result?.args).toEqual([{ name: "on", value: "true" }]);

    const off = encodeFunctionData({ abi: tokenAbi, functionName: "setFlag", args: [false] });
    expect(decodeContractCall(tokenEntry, "0xtoken", off)?.args).toEqual([
      { name: "on", value: "false" },
    ]);
  });

  it("stringifies an array argument via JSON while preserving each element's bigint precision", () => {
    // 配列・タプルなどスカラーでない引数は JSON 文字列化される。ネストした
    // bigint が number へ丸められず 10 進文字列として保たれることを確認する。
    const huge = 2n ** 128n;
    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "batchMint",
      args: [[1n, huge]],
    });
    const result = decodeContractCall(tokenEntry, "0xtoken", input);
    expect(result?.functionName).toBe("batchMint");
    expect(result?.args).toEqual([
      { name: "amounts", value: JSON.stringify(["1", huge.toString(10)]) },
    ]);
  });

  it("falls back to rawFunctionId when the selector matches the ABI but the argument data is malformed (viem throws)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 正しい transfer セレクタに、引数として復号できない短すぎるバイト列を付ける
    // （uint256/address 2 引数分に満たない）。viem の decodeFunctionData は
    // AbiDecodingDataSizeTooSmallError を投げるため、rawFunctionId へフォールバック
    // すること（例外を握りつぶして復号成功に見せかけないこと）を確認する。
    const selector = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [to, 1n],
    }).slice(0, 10);
    const malformed = `${selector}00`;
    const result = decodeContractCall(tokenEntry, "0xtoken", malformed);
    expect(result).toEqual({ contractAddress: "0xtoken", rawFunctionId: selector });
    warnSpy.mockRestore();
  });

  it("returns undefined for input whose selector-length prefix is followed by non-hex characters", () => {
    // input 全体が 16 進として不正（末尾に非 16 進文字）な場合、セレクタ抽出の
    // 段階で「関数呼び出しではない」と判定して contractCall 自体を省略する
    // （rawFunctionId も積まない）。
    expect(decodeContractCall(tokenEntry, "0xtoken", "0xa9059cbbzz")).toBeUndefined();
  });

  it("returns only rawFunctionId when the destination contract is not cataloged (catalogEntry undefined)", () => {
    // レビュー差し戻し(2026-07-07): decodeContractEvent と対称に、catalogEntry
    // が undefined（追跡中だがカタログ未照合の「未知のコントラクト」）でも
    // rawFunctionId は載せる。セレクタが無い入力なら従来どおり undefined。
    const input = encodeFunctionData({
      abi: tokenAbi,
      functionName: "transfer",
      args: [to, 1000n],
    });
    const result = decodeContractCall(undefined, "0xunknown", input);
    expect(result).toEqual({ contractAddress: "0xunknown", rawFunctionId: input.slice(0, 10) });
  });

  it("returns undefined (not a function call) for input '0x' even when catalogEntry is undefined", () => {
    expect(decodeContractCall(undefined, "0xunknown", "0x")).toBeUndefined();
  });
});

describe("decodeContractEvent", () => {
  function tokenTransferLog(from: Address, target: Address, value: bigint): RpcLog {
    const topics = encodeEventTopics({
      abi: tokenAbi,
      eventName: "Transfer",
      args: { from, to: target },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [value]);
    return { address: "0xtoken", topics: topics as string[], data };
  }

  it("decodes an event log with named indexed and non-indexed arguments", () => {
    const log = tokenTransferLog(to, spender, 500n);
    const result = decodeContractEvent(tokenEntry, log);
    expect(result).toEqual({
      contractAddress: "0xtoken",
      eventName: "Transfer",
      args: [
        { name: "from", value: to },
        { name: "to", value: spender },
        { name: "value", value: "500" },
      ],
    });
  });

  it("decodes an event log with a single indexed argument (no non-indexed data)", () => {
    // Reset は非 indexed 引数を持たない (indexed の caller のみ)。
    const topics = encodeEventTopics({ abi: counterAbi, eventName: "Reset", args: { caller: to } });
    const log: RpcLog = { address: "0xcounter", topics: topics as string[], data: "0x" };
    const result = decodeContractEvent(counterEntry, log);
    expect(result).toEqual({
      contractAddress: "0xcounter",
      eventName: "Reset",
      args: [{ name: "caller", value: to }],
    });
  });

  it("returns only rawEventId when the emitting contract is not cataloged (catalogEntry undefined)", () => {
    const log = tokenTransferLog(to, spender, 500n);
    const result = decodeContractEvent(undefined, log);
    expect(result).toEqual({ contractAddress: "0xtoken", rawEventId: log.topics[0] });
  });

  it("falls back to rawEventId when the log's topics[0] does not match any event in the ABI", () => {
    const unknownSignature = keccak256(toHex("SomeOtherEvent(address)"));
    const log: RpcLog = { address: "0xtoken", topics: [unknownSignature], data: "0x" };
    const result = decodeContractEvent(tokenEntry, log);
    expect(result).toEqual({ contractAddress: "0xtoken", rawEventId: unknownSignature });
  });

  it("logs the decode failure instead of silently swallowing it", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unknownSignature = keccak256(toHex("SomeOtherEvent(address)"));
    decodeContractEvent(tokenEntry, { address: "0xtoken", topics: [unknownSignature], data: "0x" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(unknownSignature),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("falls back to rawEventId when topics[0] matches a known event but the data is malformed (viem throws)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Transfer の topic0 は正しいが、非 indexed の value(uint256) 分の data が
    // 空。viem の decodeEventLog は DecodeLogDataMismatch を投げるため、
    // rawEventId（正しい Transfer signature）へフォールバックすることを確認する。
    const topics = encodeEventTopics({
      abi: tokenAbi,
      eventName: "Transfer",
      args: { from: to, to: spender },
    });
    const log: RpcLog = { address: "0xtoken", topics: topics as string[], data: "0x" };
    const result = decodeContractEvent(tokenEntry, log);
    expect(result).toEqual({ contractAddress: "0xtoken", rawEventId: topics[0] });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("omits rawEventId (not just falls back to it) for an anonymous log with empty topics", () => {
    const log = { address: "0xtoken", topics: [], data: "0x" };
    const result = decodeContractEvent(tokenEntry, log);
    expect(result).toEqual({ contractAddress: "0xtoken" });
    expect(result).not.toHaveProperty("rawEventId");
  });

  it("omits rawEventId for an anonymous log with empty topics even when the contract is uncataloged", () => {
    const log = { address: "0xtoken", topics: [], data: "0x" };
    const result = decodeContractEvent(undefined, log);
    expect(result).toEqual({ contractAddress: "0xtoken" });
  });
});
