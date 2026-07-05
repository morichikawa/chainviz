import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchEthRpcClient,
  fetchBalanceWei,
  fetchNonce,
  getBlockByHash,
  getTransactionByHash,
  type EthRpcClient,
} from "./eth-rpc-client.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** call をスタブする最小の EthRpcClient。 */
function stubRpc(
  handler: (method: string, params: unknown[]) => unknown,
): EthRpcClient {
  return {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      return handler(method, params) as T;
    },
  };
}

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

describe("fetchBalanceWei", () => {
  it("converts a hex wei result into a decimal string without precision loss", async () => {
    // 10 ETH = 0x8ac7230489e80000 wei。number では桁落ちする大きさ。
    const rpc = stubRpc(() => "0x8ac7230489e80000");
    const balance = await fetchBalanceWei(rpc, "http://node", "0xabc");
    expect(balance).toBe("10000000000000000000");
  });

  it("passes the address and 'latest' block tag", async () => {
    const seen: unknown[] = [];
    const rpc = stubRpc((_method, params) => {
      seen.push(params);
      return "0x0";
    });
    await fetchBalanceWei(rpc, "http://node", "0xdead");
    expect(seen[0]).toEqual(["0xdead", "latest"]);
  });

  it("returns '0' for a zero balance", async () => {
    const rpc = stubRpc(() => "0x0");
    expect(await fetchBalanceWei(rpc, "http://node", "0xabc")).toBe("0");
  });
});

describe("fetchNonce", () => {
  it("parses a hex nonce into a number", async () => {
    const rpc = stubRpc(() => "0x2a");
    expect(await fetchNonce(rpc, "http://node", "0xabc")).toBe(42);
  });

  it("returns 0 for a fresh account", async () => {
    const rpc = stubRpc(() => "0x0");
    expect(await fetchNonce(rpc, "http://node", "0xabc")).toBe(0);
  });

  it("uses eth_getTransactionCount with the latest tag", async () => {
    let method = "";
    let params: unknown[] = [];
    const rpc = stubRpc((m, p) => {
      method = m;
      params = p;
      return "0x1";
    });
    await fetchNonce(rpc, "http://node", "0xfeed");
    expect(method).toBe("eth_getTransactionCount");
    expect(params).toEqual(["0xfeed", "latest"]);
  });
});

describe("createFetchEthRpcClient", () => {
  it("posts a JSON-RPC envelope and returns the result", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x5" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchEthRpcClient();
    const result = await client.call<string>("http://node", "eth_getBalance", [
      "0xabc",
      "latest",
    ]);
    expect(result).toBe("0x5");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://node");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: ["0xabc", "latest"],
    });
  });

  it("throws on an HTTP error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    const client = createFetchEthRpcClient();
    await expect(
      client.call("http://node", "eth_getBalance", []),
    ).rejects.toThrow(/status 500/);
  });

  it("throws when the JSON-RPC response carries an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "boom" },
        }),
      })),
    );
    const client = createFetchEthRpcClient();
    await expect(
      client.call("http://node", "eth_getBalance", []),
    ).rejects.toThrow(/boom/);
  });

  it("throws when the response has neither result nor error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1 }),
      })),
    );
    const client = createFetchEthRpcClient();
    await expect(
      client.call("http://node", "eth_getBalance", []),
    ).rejects.toThrow(/no result/);
  });
});

describe("getTransactionByHash", () => {
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
    await expect(getTransactionByHash(rpc, "http://x", "0xtx")).resolves.toEqual(
      {
        hash: "0xtx",
        from: "0xsender",
        to: "0xrecipient",
      },
    );
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
      getTransactionByHash(rpc, "http://x", "0xtx"),
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
      getTransactionByHash(rpc, "http://x", "0xmissing"),
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
      getTransactionByHash(rpc, "http://x", "0xtx"),
    ).rejects.toThrow("boom");
  });

  it("throws on a non-2xx HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 500 })),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getTransactionByHash(rpc, "http://x", "0xtx"),
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
    const pending = getTransactionByHash(rpc, "http://x", "0xtx");
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});

describe("getBlockByHash", () => {
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
    await expect(getBlockByHash(rpc, "http://x", "0xblock")).resolves.toEqual({
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
    await expect(getBlockByHash(rpc, "http://x", "0xblock")).resolves.toEqual({
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
      getBlockByHash(rpc, "http://x", "0xmissing"),
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
    await expect(getBlockByHash(rpc, "http://x", "0xblock")).resolves.toEqual({
      hash: "0xblock",
      transactions: [{ hash: "0xt1", from: "0xa", to: "0xb" }],
    });
  });
});
