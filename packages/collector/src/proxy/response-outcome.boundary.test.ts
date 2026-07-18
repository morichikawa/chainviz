// resolveResponseOutcomes の境界値・判定不能パターン（Issue #352）。
// response-outcome.test.ts の基本仕様（forward失敗/非2xx/単発/バッチ）とは
// 別に、HTTPステータス境界・観測0件・error キーの値の扱い・応答形状と件数の
// 不一致など、抜けやすいエッジケースを固定する回帰テストとして分離する
// （CLAUDE.md のテスト分割方針）。
import { describe, expect, it } from "vitest";
import type { RpcObservation } from "./logging-proxy.js";
import { resolveResponseOutcomes } from "./response-outcome.js";

function observation(overrides: Partial<RpcObservation> = {}): RpcObservation {
  return {
    timestamp: 0,
    callerIp: "172.28.2.5",
    method: "eth_chainId",
    params: [],
    id: 1,
    ...overrides,
  };
}

function okBody(id: RpcObservation["id"]): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" });
}

describe("resolveResponseOutcomes: empty observations", () => {
  it("returns an empty array for forward failure with no observations", () => {
    expect(resolveResponseOutcomes([], { kind: "failure" })).toEqual([]);
  });

  it("returns an empty array for a non-2xx status with no observations", () => {
    expect(
      resolveResponseOutcomes([], { kind: "success", status: 500, body: "" }),
    ).toEqual([]);
  });

  it("returns an empty array for a 2xx object response with no observations", () => {
    expect(
      resolveResponseOutcomes([], {
        kind: "success",
        status: 200,
        body: okBody(1),
      }),
    ).toEqual([]);
  });

  it("returns an empty array for a 2xx array response with no observations", () => {
    expect(
      resolveResponseOutcomes([], {
        kind: "success",
        status: 200,
        body: "[]",
      }),
    ).toEqual([]);
  });
});

describe("resolveResponseOutcomes: HTTP status boundaries", () => {
  it("treats 199 (just below 2xx) as error", () => {
    const observations = [observation()];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 199,
        body: okBody(1),
      }),
    ).toEqual(["error"]);
  });

  it("treats 299 (upper edge of 2xx) as a success to be judged from the body", () => {
    const observations = [observation()];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 299,
        body: okBody(1),
      }),
    ).toEqual(["ok"]);
  });

  it("treats 300 (just above 2xx) as error", () => {
    const observations = [observation()];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 300,
        body: okBody(1),
      }),
    ).toEqual(["error"]);
  });

  it("leaves outcome undefined for a 2xx with an empty body (e.g. 204 No Content)", () => {
    // 空ボディは JSON.parse で throw するため判定不能（error に倒さない）。
    const observations = [observation()];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 204,
        body: "",
      }),
    ).toEqual([undefined]);
  });
});

describe("resolveResponseOutcomes: presence-based error detection (single)", () => {
  it("treats a response with error:null as error (key presence, not value)", () => {
    // 現仕様は `error` キーの存在だけで error に倒す（値は問わない）。
    // 非準拠なサーバが成功時に error:null を返すと error 扱いになる点は
    // 既知の割り切り（docs/worklog/issue-352.md §3.3）。
    const observations = [observation()];
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1", error: null });
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["error"]);
  });

  it("treats a response with error:false as error (key presence, not value)", () => {
    const observations = [observation()];
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, error: false });
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["error"]);
  });
});

describe("resolveResponseOutcomes: shape/count mismatch (2xx)", () => {
  it("leaves every outcome undefined when an object response is returned for multiple observations", () => {
    // 単発オブジェクト応答なのに観測が複数件: 形と件数が噛み合わず判定不能。
    const observations = [observation({ id: 1 }), observation({ id: 2 })];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 200,
        body: okBody(1),
      }),
    ).toEqual([undefined, undefined]);
  });

  it("leaves every outcome undefined for an empty array response with observations", () => {
    const observations = [observation({ id: 1 }), observation({ id: 2 })];
    expect(
      resolveResponseOutcomes(observations, {
        kind: "success",
        status: 200,
        body: "[]",
      }),
    ).toEqual([undefined, undefined]);
  });
});

describe("resolveResponseOutcomes: id matching quirks (batch)", () => {
  it("matches string ids as well as numeric ids", () => {
    const observations = [observation({ id: "abc" })];
    const body = JSON.stringify([{ jsonrpc: "2.0", id: "abc", result: "0x1" }]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["ok"]);
  });

  it("does not match when request id is a number but response id is the string form (strict equality)", () => {
    const observations = [observation({ id: 1 })];
    const body = JSON.stringify([{ jsonrpc: "2.0", id: "1", result: "0x1" }]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual([undefined]);
  });

  it("matches an id of 0 (falsy but a valid distinct id)", () => {
    const observations = [observation({ id: 0 })];
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 0, error: { code: -1, message: "boom" } },
    ]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["error"]);
  });

  it("judges matched observations while leaving a mixed-in notification (null id) undefined", () => {
    const observations = [
      observation({ id: 1 }),
      observation({ id: null }),
      observation({ id: 2 }),
    ];
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: "0x1" },
      { jsonrpc: "2.0", id: 2, error: { code: -1, message: "boom" } },
    ]);
    expect(
      resolveResponseOutcomes(observations, { kind: "success", status: 200, body }),
    ).toEqual(["ok", undefined, "error"]);
  });
});
