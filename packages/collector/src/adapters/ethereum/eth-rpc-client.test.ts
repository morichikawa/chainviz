import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchEthRpcClient,
  fetchBalanceWei,
  fetchNonce,
  getBlockReceipts,
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

describe("getBlockReceipts", () => {
  it("requests receipts by block hash and normalizes hash/from/to/succeeded", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        ok: true,
        status: 200,
        json: async () => ({
          result: [
            {
              transactionHash: "0xt1",
              from: "0xa",
              to: "0xb",
              status: "0x1",
            },
            {
              transactionHash: "0xt2",
              from: "0xc",
              to: null,
              status: "0x0",
            },
          ],
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: "0xb", succeeded: true },
      { transactionHash: "0xt2", from: "0xc", to: null, succeeded: false },
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body);
    expect(body.method).toBe("eth_getBlockReceipts");
    expect(body.params).toEqual(["0xblock"]);
  });

  it("treats a missing status field as succeeded (pre-Byzantium fallback)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [{ transactionHash: "0xt1", from: "0xa", to: "0xb" }],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: "0xb", succeeded: true },
    ]);
  });

  it("treats an unexpected status value as succeeded (conservative: only '0x0' fails)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              {
                transactionHash: "0xt1",
                from: "0xa",
                to: "0xb",
                status: "weird",
              },
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: "0xb", succeeded: true },
    ]);
  });

  it("returns an empty receipt list for an empty block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({ result: [] }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([]);
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
      getBlockReceipts(rpc, "http://x", "0xmissing"),
    ).resolves.toBeNull();
  });

  it("drops malformed receipt entries while keeping the valid ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
              { from: "0xc" }, // transactionHash 欠落 → 捨てる
              "0xrawhash", // オブジェクトでない要素 → 捨てる
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: "0xb", succeeded: true },
    ]);
  });

  it("drops a receipt whose 'from' is missing (safe side: skip, never marked failed)", async () => {
    // transactionHash はあるが from が欠落。証拠不足として捨て、
    // 誤って failed 表示に倒れないことを確認する。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { transactionHash: "0xt1", to: "0xb", status: "0x0" },
              { transactionHash: "0xt2", from: "0xa", to: "0xb", status: "0x1" },
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt2", from: "0xa", to: "0xb", succeeded: true },
    ]);
  });

  it("maps a missing or non-string 'to' to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { transactionHash: "0xt1", from: "0xa", status: "0x1" }, // to 欠落
              { transactionHash: "0xt2", from: "0xa", to: 123, status: "0x1" }, // 非文字列
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: null, succeeded: true },
      { transactionHash: "0xt2", from: "0xa", to: null, succeeded: true },
    ]);
  });

  it("treats a null status as succeeded (only the exact string '0x0' fails)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { transactionHash: "0xt1", from: "0xa", to: "0xb", status: null },
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: "0xb", succeeded: true },
    ]);
  });

  it("treats a numeric status 0 as succeeded (conservative: only the string '0x0' fails)", async () => {
    // JSON-RPC は status を 16 進文字列で返すが、万一数値 0 が来ても
    // 文字列 "0x0" と一致しないため failed には倒さない（安全側）。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { transactionHash: "0xt1", from: "0xa", to: "0xb", status: 0 },
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: "0xb", succeeded: true },
    ]);
  });

  it("treats '0x00' (a differently-formatted zero) as succeeded (exact '0x0' match only)", async () => {
    // 失敗判定は文字列 "0x0" の完全一致のみ。ゼロ相当でも表記が違えば
    // failed には倒さない（証拠なしに failed 表示をしない保守的判断）。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              {
                transactionHash: "0xt1",
                from: "0xa",
                to: "0xb",
                status: "0x00",
              },
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xt1", from: "0xa", to: "0xb", succeeded: true },
    ]);
  });

  it("returns null when the result is a non-array object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({ result: { transactionHash: "0xt1" } }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toBeNull();
  });

  it("returns null when the result is a scalar (unexpected shape)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({ result: "0xdeadbeef" }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toBeNull();
  });

  it("routes a mixed block (success + failed + malformed) correctly, keeping order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              { transactionHash: "0xok1", from: "0xa", to: "0xb", status: "0x1" },
              { transactionHash: "0xbad", from: "0xc", to: null, status: "0x0" },
              { to: "0xd", status: "0x0" }, // transactionHash 欠落 → 捨てる
              { transactionHash: "0xok2", from: "0xe", to: "0xf", status: "0x1" },
            ],
          }),
        }),
      ),
    );
    const rpc = createFetchEthRpcClient();
    await expect(
      getBlockReceipts(rpc, "http://x", "0xblock"),
    ).resolves.toEqual([
      { transactionHash: "0xok1", from: "0xa", to: "0xb", succeeded: true },
      { transactionHash: "0xbad", from: "0xc", to: null, succeeded: false },
      { transactionHash: "0xok2", from: "0xe", to: "0xf", succeeded: true },
    ]);
  });
});
