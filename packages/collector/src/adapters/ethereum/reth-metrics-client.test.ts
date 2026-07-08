import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchRethMetricsClient } from "./reth-metrics-client.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fakeResponse(init: {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
}): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: init.text ?? (async () => ""),
  } as unknown as Response;
}

describe("createFetchRethMetricsClient", () => {
  it("returns the response body as text on a 2xx response", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({ ok: true, status: 200, text: async () => "metric_a 1" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchRethMetricsClient();
    await expect(client.getText("http://x/metrics")).resolves.toBe(
      "metric_a 1",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/metrics",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("throws with the status code on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 500 })),
    );
    const client = createFetchRethMetricsClient();
    await expect(client.getText("http://x/metrics")).rejects.toThrow(
      "GET http://x/metrics failed with status 500",
    );
  });

  it("throws with the status code on a 404 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 404 })),
    );
    const client = createFetchRethMetricsClient();
    await expect(client.getText("http://x/metrics")).rejects.toThrow(
      "GET http://x/metrics failed with status 404",
    );
  });

  it("propagates a network-level fetch rejection (e.g. connection refused)", async () => {
    // fetch 自体が reject するケース(コンテナ停止・IP 到達不能)。ラップせずに
    // 呼び出し側へ伝える(pollRethNodeInternals 側で stableId 付きでログされる)。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 172.28.1.1:9001");
      }),
    );
    const client = createFetchRethMetricsClient();
    await expect(client.getText("http://172.28.1.1:9001/metrics")).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("does not abort after a successful response even if the timeout would later fire", async () => {
    // タイムアウト用タイマは成功時に必ず clear される。解決後に時間を進めても
    // AbortController が発火せず、返ったテキストがそのまま有効であること。
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      fakeResponse({ ok: true, status: 200, text: async () => "metric_a 1" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchRethMetricsClient(3000);
    await expect(client.getText("http://x/metrics")).resolves.toBe("metric_a 1");
    // 解決後にタイムアウト相当の時間を進めても副作用(未処理の abort 例外)が無い。
    await vi.advanceTimersByTimeAsync(5000);
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
    const client = createFetchRethMetricsClient(3000);
    const pending = client.getText("http://x/slow");
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});
