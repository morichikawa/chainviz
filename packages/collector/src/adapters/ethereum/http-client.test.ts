import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchHttpClient } from "./http-client.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Response 風のスタブを作る（fetch のモック返却用）。 */
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

describe("createFetchHttpClient", () => {
  it("returns the parsed JSON body on a 2xx response", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({ ok: true, status: 200, json: async () => ({ hello: 1 }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const http = createFetchHttpClient();
    await expect(http.getJson("http://x/api")).resolves.toEqual({ hello: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/api",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("throws with the status code on a 4xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 404 })),
    );
    const http = createFetchHttpClient();
    await expect(http.getJson("http://x/missing")).rejects.toThrow(
      "GET http://x/missing failed with status 404",
    );
  });

  it("throws with the status code on a 5xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 503 })),
    );
    const http = createFetchHttpClient();
    await expect(http.getJson("http://x/down")).rejects.toThrow("status 503");
  });

  it("propagates a JSON parse failure on an otherwise-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("invalid json");
          },
        }),
      ),
    );
    const http = createFetchHttpClient();
    await expect(http.getJson("http://x/bad")).rejects.toThrow("invalid json");
  });

  it("aborts the request once the timeout elapses", async () => {
    vi.useFakeTimers();
    // fetch は abort シグナルが立つまで解決しないふりをする。
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const http = createFetchHttpClient(3000);
    const pending = http.getJson("http://x/slow");
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal })
      .signal;
    expect(signal.aborted).toBe(true);
  });

  it("does not abort a request that resolves before the timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      return fakeResponse({
        ok: true,
        status: 200,
        json: async () => ({ done: true, aborted: init?.signal?.aborted }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const http = createFetchHttpClient(3000);
    await expect(http.getJson("http://x/fast")).resolves.toEqual({
      done: true,
      aborted: false,
    });
    // タイマーを進めても既に解決済みなので abort は発火しない。
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal })
      .signal;
    await vi.advanceTimersByTimeAsync(10000);
    expect(signal.aborted).toBe(false);
  });
});
