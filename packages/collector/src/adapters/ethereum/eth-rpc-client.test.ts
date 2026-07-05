import { describe, expect, it, vi } from "vitest";
import {
  createFetchEthRpcClient,
  fetchBalanceWei,
  fetchNonce,
  type EthRpcClient,
} from "./eth-rpc-client.js";

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
    try {
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
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws on an HTTP error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    try {
      const client = createFetchEthRpcClient();
      await expect(
        client.call("http://node", "eth_getBalance", []),
      ).rejects.toThrow(/status 500/);
    } finally {
      vi.unstubAllGlobals();
    }
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
    try {
      const client = createFetchEthRpcClient();
      await expect(
        client.call("http://node", "eth_getBalance", []),
      ).rejects.toThrow(/boom/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws when the response has neither result nor error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1 }),
      })),
    );
    try {
      const client = createFetchEthRpcClient();
      await expect(
        client.call("http://node", "eth_getBalance", []),
      ).rejects.toThrow(/no result/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
