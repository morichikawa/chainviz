import { describe, expect, it } from "vitest";
import type { RpcObservation } from "./logging-proxy.js";
import { resolveResponseOutcomes } from "./response-outcome.js";

function observation(overrides: Partial<RpcObservation> = {}): RpcObservation {
  return {
    timestamp: 0,
    callerIp: "172.28.2.5",
    method: "eth_sendRawTransaction",
    params: [],
    id: 1,
    ...overrides,
  };
}

describe("resolveResponseOutcomes: forward failure / non-2xx", () => {
  it("marks every observation as error when forward threw", () => {
    const observations = [observation({ id: 1 }), observation({ id: 2 })];
    expect(
      resolveResponseOutcomes(observations, { kind: "failure" }),
    ).toEqual(["error", "error"]);
  });

  it("marks every observation as error for a non-2xx status even with a JSON body", () => {
    const observations = [observation({ id: 1 })];
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" });
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 500, body }),
    ).toEqual(["error"]);
  });

  it("treats 3xx as non-2xx (error)", () => {
    const observations = [observation({ id: 1 })];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 301,
        body: "",
      }),
    ).toEqual(["error"]);
  });
});

describe("resolveResponseOutcomes: single request (2xx)", () => {
  it("resolves ok when the response object has no error field", () => {
    const observations = [observation({ id: 1 })];
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" });
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["ok"]);
  });

  it("resolves error when the response object has an error field", () => {
    const observations = [observation({ id: 1 })];
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "method not found" },
    });
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["error"]);
  });

  it("leaves outcome undefined when the body is not valid JSON", () => {
    const observations = [observation({ id: 1 })];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 200,
        body: "not json",
      }),
    ).toEqual([undefined]);
  });

  it("leaves outcome undefined when a single-observation response is a scalar (not object/array)", () => {
    const observations = [observation({ id: 1 })];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 200,
        body: "null",
      }),
    ).toEqual([undefined]);
  });
});

describe("resolveResponseOutcomes: batch requests (2xx)", () => {
  it("matches each observation to its response element by id", () => {
    const observations = [
      observation({ id: 1, method: "eth_chainId" }),
      observation({ id: 2, method: "eth_blockNumber" }),
    ];
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 2, result: "0x10" },
      { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } },
    ]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["error", "ok"]);
  });

  it("leaves outcome undefined for an observation with no matching response element", () => {
    const observations = [
      observation({ id: 1 }),
      observation({ id: 2 }),
    ];
    const body = JSON.stringify([{ jsonrpc: "2.0", id: 1, result: "0x1" }]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["ok", undefined]);
  });

  it("leaves outcome undefined when the response has a duplicate id (ambiguous match)", () => {
    const observations = [observation({ id: 1 })];
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: "0x1" },
      { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "dup" } },
    ]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual([undefined]);
  });

  it("leaves outcome undefined for a notification (null id) that cannot be matched", () => {
    const observations = [observation({ id: null })];
    const body = JSON.stringify([{ jsonrpc: "2.0", id: 1, result: "0x1" }]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual([undefined]);
  });

  it("resolves a batch of a single element via the array response shape", () => {
    // JSON-RPC 仕様上、要素数 1 のバッチでも応答は配列になる。
    const observations = [observation({ id: 1 })];
    const body = JSON.stringify([{ jsonrpc: "2.0", id: 1, result: "0x1" }]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["ok"]);
  });

  it("leaves outcome undefined for every observation when the response array shape mismatches (non-record elements)", () => {
    const observations = [observation({ id: 1 }), observation({ id: 2 })];
    const body = JSON.stringify(["not", "records"]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual([undefined, undefined]);
  });
});
