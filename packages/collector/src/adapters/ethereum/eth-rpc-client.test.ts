import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchEthRpcClient } from "./eth-rpc-client.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fakeResponse(init: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    json: init.json ?? (async () => ({})),
  } as unknown as Response;
}

describe("createFetchEthRpcClient.getTransactionByHash", () => {
  it("normalizes a full tx object into hash/from/to", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            hash: "0xtx",
            from: "0xsender",
            to: "0xrecipient",
            value: "0x1",
            nonce: "0x0",
          },
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rpc = createFetchEthRpcClient();
    await expect(rpc.getTransactionByHash("http://x", "0xtx")).resolves.toEqual({
      hash: "0xtx",
      from: "0xsender",
      to: "0xrecipient",
    });
    // JSON-RPC の method/params が正しく組まれている。
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body);
    expect(body.method).toBe("eth_getTransactionByHash");
    expect(body.params).toEqual(["0xtx"]);
  });

  it("maps a null 'to' (contract creation) to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: { hash: "0xtx", from: "0xsender", to: null },
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      rpc.getTransactionByHash("http://x", "0xtx"),
    ).resolves.toEqual({ hash: "0xtx", from: "0xsender", to: null });
  });

  it("returns null when the tx is unknown (result: null)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({ result: null }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      rpc.getTransactionByHash("http://x", "0xmissing"),
    ).resolves.toBeNull();
  });

  it("throws on a JSON-RPC error payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            error: { code: -32000, message: "boom" },
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      rpc.getTransactionByHash("http://x", "0xtx"),
    ).rejects.toThrow("boom");
  });

  it("throws on a non-2xx HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 500 })),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      rpc.getTransactionByHash("http://x", "0xtx"),
    ).rejects.toThrow("status 500");
  });

  it("aborts the request once the timeout elapses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rpc = createFetchEthRpcClient(3000);
    const pending = rpc.getTransactionByHash("http://x", "0xtx");
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});

describe("createFetchEthRpcClient.getBlockByHash", () => {
  it("requests full transactions and returns their hash/from/to", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            hash: "0xblock",
            number: "0x10",
            transactions: [
              { hash: "0xt1", from: "0xa", to: "0xb" },
              { hash: "0xt2", from: "0xc", to: null },
            ],
          },
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rpc = createFetchEthRpcClient();
    await expect(rpc.getBlockByHash("http://x", "0xblock")).resolves.toEqual({
      hash: "0xblock",
      transactions: [
        { hash: "0xt1", from: "0xa", to: "0xb" },
        { hash: "0xt2", from: "0xc", to: null },
      ],
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body);
    expect(body.method).toBe("eth_getBlockByHash");
    // fullTx=true を指定してブロック内 tx 本体を得る。
    expect(body.params).toEqual(["0xblock", true]);
  });

  it("returns an empty tx list for an empty block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: { hash: "0xblock", transactions: [] },
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(rpc.getBlockByHash("http://x", "0xblock")).resolves.toEqual({
      hash: "0xblock",
      transactions: [],
    });
  });

  it("returns null when the block is unknown (result: null)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({ result: null }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      rpc.getBlockByHash("http://x", "0xmissing"),
    ).resolves.toBeNull();
  });

  it("drops malformed tx entries while keeping the valid ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: {
              hash: "0xblock",
              transactions: [
                { hash: "0xt1", from: "0xa", to: "0xb" },
                { from: "0xc" }, // hash 欠落 → 捨てる
                "0xrawhash", // 文字列だけの tx（fullTx でない要素）→ 捨てる
              ],
            },
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(rpc.getBlockByHash("http://x", "0xblock")).resolves.toEqual({
      hash: "0xblock",
      transactions: [{ hash: "0xt1", from: "0xa", to: "0xb" }],
    });
  });
});
