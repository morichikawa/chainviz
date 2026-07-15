import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchEthRpcClient,
  ethCall,
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

describe("ethCall (Issue #164)", () => {
  it("sends eth_call with {to, data} and the 'latest' block tag, returning the raw result", async () => {
    const seen: { method: string; params: unknown[] }[] = [];
    const rpc = stubRpc((method, params) => {
      seen.push({ method, params });
      return "0x0000000000000000000000000000000000000000000000000000000000002a";
    });
    const result = await ethCall(rpc, "http://node", "0xtoken", "0xdeadbeef");
    expect(seen[0]).toEqual({
      method: "eth_call",
      params: [{ to: "0xtoken", data: "0xdeadbeef" }, "latest"],
    });
    expect(result).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000002a",
    );
  });

  it("propagates errors from the underlying RPC client", async () => {
    const rpc = stubRpc(() => {
      throw new Error("execution reverted");
    });
    await expect(
      ethCall(rpc, "http://node", "0xtoken", "0xdeadbeef"),
    ).rejects.toThrow("execution reverted");
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
            input: "0xa9059cbb",
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
        input: "0xa9059cbb",
        // nonce: "0x0" は数値の 0 になる（省略ではなく明示的な値。Issue #319）。
        nonce: 0,
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
    ).resolves.toEqual({ hash: "0xtx", from: "0xsender", to: null, input: "0x" });
  });

  describe("input (call data for contract call decoding, Issue #162)", () => {
    it("defaults input to '0x' when the field is missing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: { hash: "0xtx", from: "0xsender", to: "0xrecipient" },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result?.input).toBe("0x");
    });

    it("defaults input to '0x' when the field is not a string (defensive)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: {
                hash: "0xtx",
                from: "0xsender",
                to: "0xrecipient",
                input: 12345,
              },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result?.input).toBe("0x");
    });

    it("passes through a full call-data input verbatim", async () => {
      const input =
        "0xa9059cbb000000000000000000000000000000000000000000000000000000000000aaaa00000000000000000000000000000000000000000000000000000000000003e8";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: { hash: "0xtx", from: "0xsender", to: "0xrecipient", input },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result?.input).toBe(input);
    });
  });

  describe("nonce (sender account tx counter, Issue #319)", () => {
    it("normalizes a hex nonce into a number", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: {
                hash: "0xtx",
                from: "0xsender",
                to: "0xrecipient",
                nonce: "0x2a",
              },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result?.nonce).toBe(42);
    });

    it("normalizes '0x0' to 0 (a meaningful value, not omission)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: {
                hash: "0xtx",
                from: "0xsender",
                to: "0xrecipient",
                nonce: "0x0",
              },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result?.nonce).toBe(0);
      expect(result).toHaveProperty("nonce");
    });

    it("omits nonce when the field is missing (not an error)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: { hash: "0xtx", from: "0xsender", to: "0xrecipient" },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result).not.toHaveProperty("nonce");
    });

    it("omits nonce and logs when the field is not a string (defensive)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: {
                hash: "0xtx",
                from: "0xsender",
                to: "0xrecipient",
                nonce: 42,
              },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result).not.toHaveProperty("nonce");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain("0xtx");
    });

    it("omits nonce and logs when the value is unparsable as BigInt (defensive)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: {
                hash: "0xtx",
                from: "0xsender",
                to: "0xrecipient",
                nonce: "not-a-hex-number",
              },
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const result = await getTransactionByHash(rpc, "http://x", "0xtx");
      expect(result).not.toHaveProperty("nonce");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain("0xtx");
    });
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
      {
        transactionHash: "0xt2",
        from: "0xc",
        to: null,
        succeeded: false,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt2",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: null,
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
      {
        transactionHash: "0xt2",
        from: "0xa",
        to: null,
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xt1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
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
      {
        transactionHash: "0xok1",
        from: "0xa",
        to: "0xb",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
      {
        transactionHash: "0xbad",
        from: "0xc",
        to: null,
        succeeded: false,
        contractAddress: null,
        logs: [],
      },
      {
        transactionHash: "0xok2",
        from: "0xe",
        to: "0xf",
        succeeded: true,
        contractAddress: null,
        logs: [],
      },
    ]);
  });

  describe("contractAddress (contract creation detection, Issue #160)", () => {
    it("surfaces a non-null contractAddress for a contract-creation receipt", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: [
                {
                  transactionHash: "0xdeploy",
                  from: "0xdeployer",
                  to: null,
                  status: "0x1",
                  contractAddress: "0xnewcontract",
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].contractAddress).toBe("0xnewcontract");
    });

    it("defaults contractAddress to null for an ordinary (non-creation) tx", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: [
                { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].contractAddress).toBeNull();
    });

    it("treats a non-string contractAddress field as null (defensive)", async () => {
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
                  status: "0x1",
                  contractAddress: 123,
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].contractAddress).toBeNull();
    });

    it("preserves a zero-address contractAddress verbatim as a non-null string", async () => {
      // ゼロアドレスは正規のアドレス表記であり「作成なし」を意味する null とは
      // 区別される。この層はアドレスの意味解釈をせず、文字列としてそのまま通す
      // （ゼロアドレスかどうかの判定は消費側の責務）。
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
                  to: null,
                  status: "0x1",
                  contractAddress: "0x0000000000000000000000000000000000000000",
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].contractAddress).toBe(
        "0x0000000000000000000000000000000000000000",
      );
    });

    it("preserves a mixed-case (EIP-55 checksummed) contractAddress without folding case", async () => {
      // アドレスの大文字小文字は EIP-55 チェックサム情報を担う。この層で
      // 小文字化などの正規化をすると checksum が壊れるため、受け取った表記を
      // 一切変えずに通すことを確認する。
      const checksummed = "0xAbC0000000000000000000000000000000000dEf";
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
                  to: null,
                  status: "0x1",
                  contractAddress: checksummed,
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].contractAddress).toBe(checksummed);
    });

    it("surfaces both contractAddress and a non-null 'to' when a receipt carries both (no reconciliation)", async () => {
      // 実際のチェーンでは作成 tx の to は必ず null であり両立しないが、万一
      // 両方入った矛盾レシートが来ても、この層は一方を落とす防御をせず両者を
      // そのまま通す（矛盾検出は消費側の判断に委ね、観測データを歪めない）。
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
                  to: "0xrecipient",
                  status: "0x1",
                  contractAddress: "0xnewcontract",
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].to).toBe("0xrecipient");
      expect(receipts?.[0].contractAddress).toBe("0xnewcontract");
    });
  });

  describe("logs (raw event log passthrough, Issue #160)", () => {
    it("normalizes logs into address/topics/data, untouched (no decoding)", async () => {
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
                  status: "0x1",
                  logs: [
                    {
                      address: "0xtoken",
                      topics: ["0xddf252ad", "0xfrom", "0xto"],
                      data: "0x00000000000000000000000000000000000000000000000000000000000003e8",
                    },
                  ],
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([
        {
          address: "0xtoken",
          topics: ["0xddf252ad", "0xfrom", "0xto"],
          data: "0x00000000000000000000000000000000000000000000000000000000000003e8",
        },
      ]);
    });

    it("defaults logs to an empty array when the field is missing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          fakeResponse({
            ok: true,
            status: 200,
            json: async () => ({
              result: [
                { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([]);
    });

    it("defaults logs to an empty array when the field is not an array (defensive)", async () => {
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
                  status: "0x1",
                  logs: "not-an-array",
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([]);
    });

    it("drops individual malformed log entries while keeping the valid ones", async () => {
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
                  status: "0x1",
                  logs: [
                    { address: "0xgood", topics: ["0x1"], data: "0xabc" },
                    { address: "0xbad", data: "0xabc" }, // topics 欠落 → 捨てる
                    { topics: ["0x1"], data: "0xabc" }, // address 欠落 → 捨てる
                    "not-an-object", // オブジェクトでない要素 → 捨てる
                  ],
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([
        { address: "0xgood", topics: ["0x1"], data: "0xabc" },
      ]);
    });

    it("filters non-string entries out of topics while keeping the log", async () => {
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
                  status: "0x1",
                  logs: [
                    { address: "0xtoken", topics: ["0x1", 42, "0x2"], data: "0xabc" },
                  ],
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([
        { address: "0xtoken", topics: ["0x1", "0x2"], data: "0xabc" },
      ]);
    });

    it("keeps an anonymous-event log whose topics array is empty", async () => {
      // 匿名イベント（indexed 引数なし）は topics が空配列になる。空配列は
      // 正当なログであり、topics 欠落（= 不正で破棄）とは区別して保持する。
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
                  status: "0x1",
                  logs: [{ address: "0xtoken", topics: [], data: "0xabc" }],
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([
        { address: "0xtoken", topics: [], data: "0xabc" },
      ]);
    });

    it("keeps a log whose topics are all non-strings, collapsing topics to empty", async () => {
      // topics が配列でありさえすれば（型が正しくない要素だけでも）ログ自体は
      // 保持し、topics を空配列に畳む（1 件の型ノイズでログを丸ごと諦めない）。
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
                  status: "0x1",
                  logs: [
                    { address: "0xtoken", topics: [1, 2, null, {}], data: "0xabc" },
                  ],
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([
        { address: "0xtoken", topics: [], data: "0xabc" },
      ]);
    });

    it("drops a log whose address is numeric and one whose data is numeric (non-string types)", async () => {
      // address / data はいずれも文字列必須。数値型で来た要素は個別に破棄し、
      // 型の正しいログだけを残す（レシート全体はクラッシュさせない）。
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
                  status: "0x1",
                  logs: [
                    { address: 123, topics: ["0x1"], data: "0xabc" }, // address 数値 → 捨てる
                    { address: "0xtoken", topics: ["0x1"], data: 999 }, // data 数値 → 捨てる
                    { address: "0xgood", topics: ["0x1"], data: "0xdef" }, // 正常 → 残す
                  ],
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toEqual([
        { address: "0xgood", topics: ["0x1"], data: "0xdef" },
      ]);
    });

    it("normalizes a large logs array without dropping or crashing on any entry", async () => {
      // 多数のイベントを発する tx（バッチ mint 等）でも、全ログが順序を保って
      // 正規化されることを確認する（件数上限による切り捨てが無いこと）。
      const bigLogs = Array.from({ length: 500 }, (_, i) => ({
        address: `0xtoken${i}`,
        topics: [`0xtopic${i}`],
        data: `0xdata${i}`,
      }));
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
                  status: "0x1",
                  logs: bigLogs,
                },
              ],
            }),
          }),
        ),
      );
      const rpc = createFetchEthRpcClient();
      const receipts = await getBlockReceipts(rpc, "http://x", "0xblock");
      expect(receipts?.[0].logs).toHaveLength(500);
      expect(receipts?.[0].logs[0]).toEqual({
        address: "0xtoken0",
        topics: ["0xtopic0"],
        data: "0xdata0",
      });
      expect(receipts?.[0].logs[499]).toEqual({
        address: "0xtoken499",
        topics: ["0xtopic499"],
        data: "0xdata499",
      });
    });
  });
});
