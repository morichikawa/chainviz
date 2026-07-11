import { describe, expect, it } from "vitest";
import {
  fetchBeaconSyncing,
  fetchConnectedPeerIds,
  fetchNodePeerId,
} from "./beacon-api.js";
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

describe("fetchBeaconSyncing", () => {
  it("parses the string-encoded head_slot and all three flags (実測レスポンス形状)", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: {
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
          head_slot: "16587",
          sync_distance: "0",
        },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toEqual({
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
      headSlot: 16587,
    });
  });

  it("parses is_syncing/is_optimistic/el_offline true", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: {
          is_syncing: true,
          is_optimistic: true,
          el_offline: true,
          head_slot: "42",
        },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toEqual({
      isSyncing: true,
      isOptimistic: true,
      elOffline: true,
      headSlot: 42,
    });
  });

  it("treats a missing is_optimistic / el_offline as false (older CL client / version gap)", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: false, head_slot: "100" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toEqual({
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
      headSlot: 100,
    });
  });

  it("parses head_slot of 0 (genesis) as 0, not a parse failure", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: true, head_slot: "0" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toMatchObject({
      headSlot: 0,
    });
  });

  it("parses a head_slot returned as a JSON number, not a decimal string", async () => {
    // 仕様上 head_slot は 10進文字列だが、クライアント/バージョンによっては
    // 数値で返ることもありうる。Number() はどちらも受けるためパースできる。
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: false, head_slot: 16587 },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toMatchObject({
      headSlot: 16587,
    });
  });

  it("treats a non-boolean truthy is_optimistic (string \"true\") as false (strict === true)", async () => {
    // 補助フラグは `=== true` の厳密判定。boolean 以外の真値（文字列 "true" や
    // 数値 1）は「不調」の根拠として扱わず false に倒す（欠落した補助フラグを
    // 理由に不調表示へ倒さない方針と一貫。決定事項 3）。
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: false, is_optimistic: "true", head_slot: "10" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toMatchObject({
      isOptimistic: false,
    });
  });

  it("treats a non-boolean truthy el_offline (number 1) as false (strict === true)", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: false, el_offline: 1, head_slot: "10" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toMatchObject({
      elOffline: false,
    });
  });

  it("keeps a genuine boolean el_offline: true (only real booleans flip the flag)", async () => {
    // 上の 2 件（非 boolean 真値 → false）の対。実際の boolean true は
    // そのまま透過し、resolveBeaconSyncStatus 側で "syncing" に倒される。
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: false, el_offline: true, head_slot: "10" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toMatchObject({
      elOffline: true,
    });
  });

  it("throws when is_syncing is missing or not a boolean", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { head_slot: "10" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(
      /is_syncing/,
    );
  });

  it("throws when is_syncing is a non-boolean value (e.g. a string)", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: "false", head_slot: "10" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(
      /is_syncing/,
    );
  });

  it("throws when head_slot cannot be parsed as a number", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: false, head_slot: "not-a-number" },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(
      /head_slot/,
    );
  });

  it("throws when head_slot is missing entirely", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: false },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(
      /head_slot/,
    );
  });

  // Issue #282: Number(...) の緩い変換規則（空文字列/nullを0に、16進・
  // 指数表記を受理する等）に頼らず、10進整数文字列 または 非負整数の
  // JSON 数値のみを受理する。それ以外は非準拠値として throw する。
  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["null", null],
    ["hex string", "0x10"],
    ["exponential notation string", "1e3"],
    ["leading/trailing whitespace around digits", " 10 "],
    ["negative decimal string", "-5"],
    ["decimal point string", "10.5"],
    ["negative number", -5],
    ["non-integer number", 3.5],
    ["boolean true", true],
    ["array", [16587]],
    ["object", { value: 16587 }],
  ])(
    "throws for a non-conforming head_slot value: %s",
    async (_label, headSlot) => {
      const http = httpFrom({
        [`${BASE}/eth/v1/node/syncing`]: {
          data: { is_syncing: false, head_slot: headSlot },
        },
      });
      await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(
        /head_slot/,
      );
    },
  );

  it("accepts a non-negative integer head_slot of 0 as a JSON number", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {
        data: { is_syncing: true, head_slot: 0 },
      },
    });
    await expect(fetchBeaconSyncing(http, BASE)).resolves.toMatchObject({
      headSlot: 0,
    });
  });

  // Issue #282: 受理する 10進整数の境界値。10進整数文字列（`/^\d+$/`）
  // または非負整数の JSON 数値である限り受理する（precision の限界を
  // 超える巨大値の扱いも含めて現挙動を固定する）。
  it.each([
    // 先頭ゼロ付きの 10進文字列は数字のみなので受理し、10進として解釈する
    // （8進などとは解釈しない。`Number("007") === 7`）。
    ["leading zeros in a decimal string", "007", 7],
    ["genesis 0 as a decimal string", "0", 0],
    // Number.MAX_SAFE_INTEGER 相当までは正確に保持される。
    ["MAX_SAFE_INTEGER decimal string", "9007199254740991", 9007199254740991],
    ["MAX_SAFE_INTEGER JSON number", Number.MAX_SAFE_INTEGER, 9007199254740991],
    // MAX_SAFE_INTEGER を超える 10進文字列も「10進整数文字列」の形は満たす
    // ため受理する。ただし JS の Number は倍精度浮動小数なので precision が
    // 失われる（`Number("9007199254740993") === 9007199254740992`）。head_slot
    // は表示・比較用の観測値でありこの桁数の slot は現実的に到達しないため、
    // ここではパース段階で弾かず現挙動（精度欠落を伴う受理）を固定する。
    [
      "decimal string beyond MAX_SAFE_INTEGER (precision is lost, still accepted)",
      "9007199254740993",
      9007199254740992,
    ],
  ])(
    "accepts a boundary head_slot value: %s",
    async (_label, headSlot, expected) => {
      const http = httpFrom({
        [`${BASE}/eth/v1/node/syncing`]: {
          data: { is_syncing: false, head_slot: headSlot },
        },
      });
      await expect(fetchBeaconSyncing(http, BASE)).resolves.toMatchObject({
        headSlot: expected,
      });
    },
  );

  // Issue #282: ASCII の 10進数字（U+0030..U+0039）以外の「数字に見える」
  // 文字列や符号付き文字列は非準拠として throw する。`/^\d+$/` の `\d` は
  // Unicode フラグ無しでは ASCII 数字のみに一致するため、全角数字や
  // Arabic-Indic 数字は弾かれる。JSON 数値でも Infinity/NaN のような
  // 非整数は Number.isInteger で弾かれる（JSON.parse では通常現れないが、
  // 直接オブジェクトを渡す経路での防御）。
  it.each([
    ["full-width digits", "１２３"],
    ["arabic-indic digits", "٣"],
    ["plus-signed decimal string", "+5"],
    ["Infinity number", Number.POSITIVE_INFINITY],
    ["NaN number", Number.NaN],
  ])(
    "throws for a boundary non-conforming head_slot value: %s",
    async (_label, headSlot) => {
      const http = httpFrom({
        [`${BASE}/eth/v1/node/syncing`]: {
          data: { is_syncing: false, head_slot: headSlot },
        },
      });
      await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(/head_slot/);
    },
  );

  it("throws when the data field itself is missing", async () => {
    const http = httpFrom({
      [`${BASE}/eth/v1/node/syncing`]: {},
    });
    await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(
      /is_syncing/,
    );
  });

  it("propagates errors from the http client", async () => {
    const http: HttpClient = {
      getJson: (async () => {
        throw new Error("beacon unreachable");
      }) as HttpClient["getJson"],
    };
    await expect(fetchBeaconSyncing(http, BASE)).rejects.toThrow(
      "beacon unreachable",
    );
  });
});
