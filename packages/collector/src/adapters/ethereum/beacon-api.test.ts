import { describe, expect, it } from "vitest";
import { fetchConnectedPeerIds, fetchNodePeerId } from "./beacon-api.js";
import type { HttpClient } from "./http-client.js";

function httpFrom(responses: Record<string, unknown>): HttpClient {
  return {
    getJson: (async (url: string) => {
      if (!(url in responses)) throw new Error(`unexpected url ${url}`);
      return responses[url];
    }) as HttpClient["getJson"],
  };
}

const BASE = "http://node:5052";

describe("fetchNodePeerId", () => {
  it("returns the peer_id from the identity endpoint", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/identity`]: { data: { peer_id: "16Uiu2-self" } },
    });
    await expect(fetchNodePeerId(http, BASE)).resolves.toBe("16Uiu2-self");
  });

  it("propagates errors from the http client", async () => {
    const http: HttpClient = {
      getJson: (async () => {
        throw new Error("connection refused");
      }) as HttpClient["getJson"],
    };
    await expect(fetchNodePeerId(http, BASE)).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("fetchConnectedPeerIds", () => {
  it("returns the peer_ids of connected peers", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: {
        data: [
          { peer_id: "peer-a", state: "connected", direction: "inbound" },
          { peer_id: "peer-b", state: "connected", direction: "outbound" },
        ],
      },
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual([
      "peer-a",
      "peer-b",
    ]);
  });

  it("filters out peers not in the connected state", async () => {
    // state クエリを無視するサーバーでも、二重に connected だけを残す。
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: {
        data: [
          { peer_id: "peer-a", state: "connected" },
          { peer_id: "peer-b", state: "disconnected" },
        ],
      },
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual(["peer-a"]);
  });

  it("drops entries with a missing peer_id", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: {
        data: [
          { peer_id: "peer-a", state: "connected" },
          { state: "connected" },
        ],
      },
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual(["peer-a"]);
  });

  it("returns an empty array when there is no data field", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: {},
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual([]);
  });

  it("returns an empty array when data is explicitly null", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: { data: null },
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual([]);
  });

  it("returns an empty array when all peers are disconnected", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: {
        data: [
          { peer_id: "peer-a", state: "disconnected" },
          { peer_id: "peer-b", state: "disconnecting" },
        ],
      },
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual([]);
  });

  it("drops entries with an empty-string peer_id", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: {
        data: [
          { peer_id: "", state: "connected" },
          { peer_id: "peer-b", state: "connected" },
        ],
      },
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual(["peer-b"]);
  });

  it("drops entries whose peer_id is not a string", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/peers?state=connected`]: {
        data: [
          { peer_id: 42, state: "connected" },
          { peer_id: null, state: "connected" },
          { peer_id: "peer-c", state: "connected" },
        ],
      },
    });
    await expect(fetchConnectedPeerIds(http, BASE)).resolves.toEqual(["peer-c"]);
  });

  it("propagates errors from the http client", async () => {
    const http: HttpClient = {
      getJson: (async () => {
        throw new Error("beacon unreachable");
      }) as HttpClient["getJson"],
    };
    await expect(fetchConnectedPeerIds(http, BASE)).rejects.toThrow(
      "beacon unreachable",
    );
  });
});
