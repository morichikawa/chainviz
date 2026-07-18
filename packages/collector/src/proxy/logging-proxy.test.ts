import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchForwarder,
  extractObservations,
  handleRpcRequest,
  LoggingProxy,
  normalizeCallerIp,
  type ForwardFn,
  type ForwardResponse,
  type RpcObservation,
} from "./logging-proxy.js";

afterEach(() => {
  vi.restoreAllMocks();
  // stubGlobal("fetch") は restoreAllMocks では戻らないため明示的に外す。
  // 外さないと後続の実ソケットテストが漏れた fetch スタブを掴んでしまう。
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 常に固定のレスポンスを返す転送関数を作る。 */
function stubForward(response: ForwardResponse): ForwardFn {
  return vi.fn(async () => response);
}

const OK_RESPONSE: ForwardResponse = {
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }),
};

describe("extractObservations", () => {
  it("extracts a single call from an object request", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "eth_chainId",
      params: [],
    });
    expect(extractObservations(body, "172.28.9.9", 1000)).toEqual([
      {
        timestamp: 1000,
        callerIp: "172.28.9.9",
        method: "eth_chainId",
        params: [],
        id: 7,
      },
    ]);
  });

  it("extracts one observation per element of a batch request", () => {
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    ]);
    const observations = extractObservations(body, "172.28.9.9", 2000);
    expect(observations.map((o) => o.method)).toEqual([
      "eth_chainId",
      "eth_blockNumber",
    ]);
    expect(observations.map((o) => o.id)).toEqual([1, 2]);
  });

  it("preserves method-specific params untouched", () => {
    const params = [{ to: "0xabc", data: "0xdeadbeef" }, "latest"];
    const body = JSON.stringify({ id: 1, method: "eth_call", params });
    expect(extractObservations(body, "ip", 0)[0].params).toEqual(params);
  });

  it("returns no observations when the body is not valid JSON", () => {
    expect(extractObservations("not json", "ip", 0)).toEqual([]);
  });

  it("skips elements without a string method", () => {
    const body = JSON.stringify([
      { id: 1, method: "eth_chainId" },
      { id: 2 }, // method 欠落
      { id: 3, method: 42 }, // method が文字列でない
    ]);
    expect(extractObservations(body, "ip", 0).map((o) => o.method)).toEqual([
      "eth_chainId",
    ]);
  });

  it("normalizes a missing or non-scalar id to null", () => {
    const body = JSON.stringify([
      { method: "a" },
      { method: "b", id: { nested: true } },
    ]);
    expect(extractObservations(body, "ip", 0).map((o) => o.id)).toEqual([
      null,
      null,
    ]);
  });
});

describe("normalizeCallerIp", () => {
  it("strips the IPv4-mapped IPv6 prefix", () => {
    expect(normalizeCallerIp("::ffff:172.28.0.5")).toBe("172.28.0.5");
  });

  it("passes a plain IPv4 address through", () => {
    expect(normalizeCallerIp("172.28.0.5")).toBe("172.28.0.5");
  });

  it("returns 'unknown' when the address is undefined", () => {
    expect(normalizeCallerIp(undefined)).toBe("unknown");
  });
});

describe("handleRpcRequest", () => {
  it("forwards the raw body verbatim and returns the upstream response", async () => {
    const forward = stubForward(OK_RESPONSE);
    const rawBody = JSON.stringify({ id: 1, method: "eth_chainId", params: [] });
    const result = await handleRpcRequest({
      rawBody,
      callerIp: "172.28.0.9",
      contentType: "application/json",
      forward,
    });
    expect(result).toEqual({
      status: 200,
      contentType: "application/json",
      body: OK_RESPONSE.body,
    });
    // ボディは改変せずそのまま転送されること。
    expect(forward).toHaveBeenCalledWith(rawBody, "application/json");
  });

  it("emits an observation for the observed call, with outcome/durationMs from the response", async () => {
    const observed: RpcObservation[] = [];
    // timestamp 取得（受信時） → forward → durationMs 計測（応答受信時）の
    // 2 回だけ now() が呼ばれる想定で固定値を返す。
    const now = vi.fn().mockReturnValueOnce(12_345).mockReturnValueOnce(12_357);
    await handleRpcRequest({
      rawBody: JSON.stringify({ id: 1, method: "eth_sendRawTransaction", params: ["0xraw"] }),
      callerIp: "172.28.0.9",
      contentType: "application/json",
      forward: stubForward(OK_RESPONSE),
      onObserve: (o) => observed.push(o),
      now,
    });
    expect(observed).toEqual([
      {
        timestamp: 12_345,
        callerIp: "172.28.0.9",
        method: "eth_sendRawTransaction",
        params: ["0xraw"],
        id: 1,
        outcome: "ok",
        durationMs: 12,
      },
    ]);
  });

  it("emits onObserve only after the forward call resolves (not before)", async () => {
    const events: string[] = [];
    const forward: ForwardFn = vi.fn(async () => {
      events.push("forward-called");
      return OK_RESPONSE;
    });
    await handleRpcRequest({
      rawBody: JSON.stringify({ id: 1, method: "eth_chainId", params: [] }),
      callerIp: "ip",
      contentType: "application/json",
      forward,
      onObserve: () => events.push("observed"),
    });
    expect(events).toEqual(["forward-called", "observed"]);
  });

  it("rounds durationMs to a non-negative integer", async () => {
    const observed: RpcObservation[] = [];
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1000.6);
    await handleRpcRequest({
      rawBody: JSON.stringify({ id: 1, method: "eth_chainId", params: [] }),
      callerIp: "ip",
      contentType: "application/json",
      forward: stubForward(OK_RESPONSE),
      onObserve: (o) => observed.push(o),
      now,
    });
    expect(observed[0].durationMs).toBe(1);
  });

  it("shares a single durationMs across all observations in a batch", async () => {
    const observed: RpcObservation[] = [];
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(20);
    const batchResponse: ForwardResponse = {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, result: "0x1" },
        { jsonrpc: "2.0", id: 2, result: "0x2" },
      ]),
    };
    await handleRpcRequest({
      rawBody: JSON.stringify([
        { id: 1, method: "eth_chainId", params: [] },
        { id: 2, method: "eth_blockNumber", params: [] },
      ]),
      callerIp: "ip",
      contentType: "application/json",
      forward: stubForward(batchResponse),
      onObserve: (o) => observed.push(o),
      now,
    });
    expect(observed.map((o) => o.durationMs)).toEqual([20, 20]);
    expect(observed.map((o) => o.outcome)).toEqual(["ok", "ok"]);
  });

  it("omits outcome when the response cannot be judged (e.g. non-JSON body)", async () => {
    const observed: RpcObservation[] = [];
    const badResponse: ForwardResponse = {
      status: 200,
      contentType: "application/json",
      body: "not json",
    };
    await handleRpcRequest({
      rawBody: JSON.stringify({ id: 1, method: "eth_chainId", params: [] }),
      callerIp: "ip",
      contentType: "application/json",
      forward: stubForward(badResponse),
      onObserve: (o) => observed.push(o),
    });
    expect(observed[0].outcome).toBeUndefined();
    expect(observed[0].durationMs).toBeTypeOf("number");
  });

  it("still forwards when the body cannot be parsed for observation", async () => {
    const observed: RpcObservation[] = [];
    const forward = stubForward(OK_RESPONSE);
    const result = await handleRpcRequest({
      rawBody: "garbage",
      callerIp: "ip",
      contentType: "application/json",
      forward,
      onObserve: (o) => observed.push(o),
    });
    expect(observed).toEqual([]);
    expect(forward).toHaveBeenCalledWith("garbage", "application/json");
    expect(result.status).toBe(200);
  });

  it("returns a 502 JSON-RPC error and logs when forwarding fails", async () => {
    const log = vi.fn();
    const forward: ForwardFn = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const result = await handleRpcRequest({
      rawBody: JSON.stringify({ id: 5, method: "eth_chainId", params: [] }),
      callerIp: "ip",
      contentType: "application/json",
      forward,
      log,
    });
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({
      jsonrpc: "2.0",
      id: 5,
      error: { code: -32603, message: "logging proxy: upstream request failed" },
    });
    // 転送失敗を握りつぶさずログに残していること。
    expect(log).toHaveBeenCalledWith(
      "[proxy] forward to upstream failed:",
      expect.any(Error),
    );
  });

  it("emits observations with outcome error and a measured durationMs even when forwarding fails", async () => {
    const observed: RpcObservation[] = [];
    const now = vi.fn().mockReturnValueOnce(5000).mockReturnValueOnce(5030);
    await handleRpcRequest({
      rawBody: JSON.stringify({ id: 1, method: "eth_chainId", params: [] }),
      callerIp: "ip",
      contentType: "application/json",
      forward: vi.fn(async () => {
        throw new Error("down");
      }),
      onObserve: (o) => observed.push(o),
      log: vi.fn(),
      now,
    });
    expect(observed).toEqual([
      {
        timestamp: 5000,
        callerIp: "ip",
        method: "eth_chainId",
        params: [],
        id: 1,
        outcome: "error",
        durationMs: 30,
      },
    ]);
  });

  it("marks every observation in a batch as error when forwarding fails", async () => {
    const observed: RpcObservation[] = [];
    await handleRpcRequest({
      rawBody: JSON.stringify([
        { id: 1, method: "eth_chainId", params: [] },
        { id: 2, method: "eth_blockNumber", params: [] },
      ]),
      callerIp: "ip",
      contentType: "application/json",
      forward: vi.fn(async () => {
        throw new Error("down");
      }),
      onObserve: (o) => observed.push(o),
      log: vi.fn(),
    });
    expect(observed.map((o) => o.outcome)).toEqual(["error", "error"]);
  });
});

describe("createFetchForwarder", () => {
  it("POSTs the raw body to the target and returns the response text", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => '{"result":"0x1"}',
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const forward = createFetchForwarder("http://172.28.1.1:8545");
    const response = await forward('{"method":"eth_chainId"}', "application/json");
    expect(response).toEqual({
      status: 200,
      contentType: "application/json",
      body: '{"result":"0x1"}',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://172.28.1.1:8545",
      expect.objectContaining({
        method: "POST",
        body: '{"method":"eth_chainId"}',
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("falls back to application/json when the response has no content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        headers: { get: () => null },
        text: async () => "{}",
      })) as unknown as typeof fetch,
    );
    const forward = createFetchForwarder("http://x");
    const response = await forward("{}", "application/json");
    expect(response.contentType).toBe("application/json");
  });

  it("aborts the request once the timeout elapses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const forward = createFetchForwarder("http://x", 3000);
    const pending = forward("{}", "application/json");
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});

/** private な server にテストからアクセスして bind アドレスを見るヘルパー。 */
function internalServer(proxy: LoggingProxy): import("node:http").Server {
  return (proxy as unknown as { server: import("node:http").Server }).server;
}

describe("LoggingProxy (integration over a real socket)", () => {
  it("binds on IPv4 (0.0.0.0) so WSL2 localhost forwarding and container access reach it", async () => {
    // Issue #99: host を省くと Node は IPv6 "::" に bind し、WSL2 の localhost
    // 転送が Windows 側の IPv4 localhost から届かなくなる。ワークベンチ
    // コンテナも Docker bridge の IPv4 ゲートウェイ経由で叩くため、
    // listen(port, "0.0.0.0") を渡した効果として実際に IPv4（0.0.0.0）で
    // 待ち受けていることを確認する。
    const proxy = new LoggingProxy({ forward: stubForward(OK_RESPONSE), log: vi.fn() });
    await proxy.listen(0);
    try {
      const addr = internalServer(proxy).address();
      expect(addr).not.toBeNull();
      if (addr && typeof addr === "object") {
        expect(addr.family).toBe("IPv4");
        expect(addr.address).toBe("0.0.0.0");
      }
    } finally {
      await proxy.close();
    }
  });

  it("forwards a POST and returns the upstream response body", async () => {
    const forward = stubForward(OK_RESPONSE);
    const observed: RpcObservation[] = [];
    const proxy = new LoggingProxy({
      forward,
      onObserve: (o) => observed.push(o),
      log: vi.fn(),
    });
    await proxy.listen(0);
    const port = proxy.address?.port;
    expect(port).toBeGreaterThan(0);
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1, method: "eth_chainId", params: [] }),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(OK_RESPONSE.body);
      expect(observed.map((o) => o.method)).toEqual(["eth_chainId"]);
    } finally {
      await proxy.close();
    }
  });

  it("rejects non-POST requests with 405", async () => {
    const proxy = new LoggingProxy({ forward: stubForward(OK_RESPONSE), log: vi.fn() });
    await proxy.listen(0);
    const port = proxy.address?.port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, { method: "GET" });
      expect(res.status).toBe(405);
    } finally {
      await proxy.close();
    }
  });

  it("rejects PUT and DELETE requests with 405 and does not forward them", async () => {
    const forward = stubForward(OK_RESPONSE);
    const proxy = new LoggingProxy({ forward, log: vi.fn() });
    await proxy.listen(0);
    const port = proxy.address?.port;
    try {
      for (const method of ["PUT", "DELETE"]) {
        const res = await fetch(`http://127.0.0.1:${port}`, { method });
        expect(res.status).toBe(405);
      }
      // 非 POST は転送対象外なので upstream へは一切送られないこと。
      expect(forward).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });

  it("emits one observation per element for a batch POST over the socket", async () => {
    const forward = stubForward(OK_RESPONSE);
    const observed: RpcObservation[] = [];
    const proxy = new LoggingProxy({
      forward,
      onObserve: (o) => observed.push(o),
      log: vi.fn(),
    });
    await proxy.listen(0);
    const port = proxy.address?.port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { id: 1, method: "eth_chainId", params: [] },
          { id: 2, method: "eth_blockNumber", params: [] },
          { id: 3, method: "eth_gasPrice", params: [] },
        ]),
      });
      expect(res.status).toBe(200);
      expect(observed.map((o) => o.method)).toEqual([
        "eth_chainId",
        "eth_blockNumber",
        "eth_gasPrice",
      ]);
      // バッチでも本体は 1 度だけ、改変せずまとめて転送されること。
      expect(forward).toHaveBeenCalledTimes(1);
    } finally {
      await proxy.close();
    }
  });

  it("returns a 502 JSON-RPC error over the socket when the upstream refuses the connection", async () => {
    const forward: ForwardFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const proxy = new LoggingProxy({ forward, log: vi.fn() });
    await proxy.listen(0);
    const port = proxy.address?.port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 9, method: "eth_chainId", params: [] }),
      });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        jsonrpc: "2.0",
        id: 9,
        error: { code: -32603, message: "logging proxy: upstream request failed" },
      });
    } finally {
      await proxy.close();
    }
  });
});

describe("LoggingProxy maxBodyBytes", () => {
  const LIMIT = 32;

  it("forwards a body whose byte length is exactly maxBodyBytes", async () => {
    const forward = stubForward(OK_RESPONSE);
    const proxy = new LoggingProxy({ forward, log: vi.fn(), maxBodyBytes: LIMIT });
    await proxy.listen(0);
    const port = proxy.address?.port;
    // ちょうど上限（境界値）: 拒否されず素通しされること。
    const body = "a".repeat(LIMIT);
    expect(Buffer.byteLength(body)).toBe(LIMIT);
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(res.status).toBe(200);
      expect(forward).toHaveBeenCalledWith(body, "application/json");
    } finally {
      await proxy.close();
    }
  });

  it("does not forward a body one byte over maxBodyBytes and fails the request", async () => {
    const forward = stubForward(OK_RESPONSE);
    const log = vi.fn();
    const proxy = new LoggingProxy({ forward, log, maxBodyBytes: LIMIT });
    await proxy.listen(0);
    const port = proxy.address?.port;
    // 上限 +1 バイト（境界値）: upstream へ転送されてはならない。
    const body = "a".repeat(LIMIT + 1);
    expect(Buffer.byteLength(body)).toBe(LIMIT + 1);
    let outcome: { status: number } | { error: unknown };
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      outcome = { status: res.status };
    } catch (err) {
      outcome = { error: err };
    } finally {
      await proxy.close();
    }
    // 過大なボディは上流ノードへ渡らないこと（メモリ枯渇・透過性の観点で最重要）。
    expect(forward).not.toHaveBeenCalled();
    // サイズ超過を握りつぶさずログに残していること。
    expect(log).toHaveBeenCalledWith(
      "[proxy] failed to read request body:",
      expect.any(Error),
    );
    // 成功レスポンス（2xx）は決して返さないこと。「2xx でない」ことのみを表明し、
    // 具体的なステータスコードの検証は下の 413 テストで明示的に行う。
    if ("status" in outcome) {
      expect(outcome.status).toBeGreaterThanOrEqual(400);
    } else {
      expect(outcome.error).toBeInstanceOf(Error);
    }
  });

  it("returns a 413 response body (not a socket reset) when the body is too large", async () => {
    const forward = stubForward(OK_RESPONSE);
    const proxy = new LoggingProxy({ forward, log: vi.fn(), maxBodyBytes: LIMIT });
    await proxy.listen(0);
    const port = proxy.address?.port;
    // 上限 +1 バイト（境界値）: 接続リセットではなく 413 レスポンスが届くこと。
    const body = "a".repeat(LIMIT + 1);
    expect(Buffer.byteLength(body)).toBe(LIMIT + 1);
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      // クライアントは接続エラーではなく明示的な 413 を受け取ること。
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        error: "logging proxy: request body too large",
      });
      // 過大なボディは上流ノードへ渡らないこと。
      expect(forward).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });
});

describe("LoggingProxy.listen startup failure", () => {
  it("rejects the listen promise when the port is already in use", async () => {
    const first = new LoggingProxy({ forward: stubForward(OK_RESPONSE), log: vi.fn() });
    await first.listen(0);
    const port = first.address?.port ?? 0;
    expect(port).toBeGreaterThan(0);

    const second = new LoggingProxy({ forward: stubForward(OK_RESPONSE), log: vi.fn() });
    try {
      // 同じポートで待ち受け開始 → listening 前に error が発火し reject されること。
      await expect(second.listen(port)).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
    } finally {
      await first.close();
    }
  });
});
