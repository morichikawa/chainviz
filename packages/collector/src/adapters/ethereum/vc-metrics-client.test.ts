// Issue #420 テスト強化: VC（validator client）の /metrics へ HTTP 到達する
// IO 境界の異常系を固定する。reth-metrics-client.test.ts と同じ観点
// （非2xx・ネットワーク断・タイムアウト・成功時のタイマー解放）を VC 側にも
// そろえる（実装時点ではこのファイルに対応するテストが無かった）。

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VALIDATOR_METRICS_PORT,
  createFetchVcMetricsClient,
} from "./vc-metrics-client.js";

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

describe("VALIDATOR_METRICS_PORT", () => {
  it("matches the port that the node environment template exposes", () => {
    // profiles/ethereum/scripts/lighthouse-vc.sh が
    // `--metrics-port 5064` で待ち受ける値と一致していること。パッケージを
    // またぐ暗黙の結合なので、片方だけ変更されたらここで気付けるようにする。
    expect(VALIDATOR_METRICS_PORT).toBe(5064);
  });
});

describe("createFetchVcMetricsClient", () => {
  it("returns the response body as text on a 2xx response", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse({
        ok: true,
        status: 200,
        text: async () => 'vc_signed_attestations_total{status="success"} 7',
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createFetchVcMetricsClient();
    await expect(client.getText("http://172.28.0.3:5064/metrics")).resolves.toBe(
      'vc_signed_attestations_total{status="success"} 7',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://172.28.0.3:5064/metrics",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("throws with the status code on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 500 })),
    );
    const client = createFetchVcMetricsClient();
    await expect(client.getText("http://x/metrics")).rejects.toThrow(
      "GET http://x/metrics failed with status 500",
    );
  });

  it("throws with the status code when --metrics is not enabled on the VC (404)", async () => {
    // node-env 側の lighthouse-vc.sh に --metrics が無い状態のまま
    // collector を動かした場合に相当する（設計時に想定した縮退経路）。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 404 })),
    );
    const client = createFetchVcMetricsClient();
    await expect(client.getText("http://x/metrics")).rejects.toThrow(
      "GET http://x/metrics failed with status 404",
    );
  });

  it("does not read the body of a non-2xx response", async () => {
    const text = vi.fn(async () => "should not be read");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse({ ok: false, status: 503, text })),
    );
    const client = createFetchVcMetricsClient();
    await expect(client.getText("http://x/metrics")).rejects.toThrow("503");
    expect(text).not.toHaveBeenCalled();
  });

  it("propagates a network-level fetch rejection (e.g. VC container stopped)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 172.28.0.3:5064");
      }),
    );
    const client = createFetchVcMetricsClient();
    await expect(
      client.getText("http://172.28.0.3:5064/metrics"),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("does not abort after a successful response even if the timeout would later fire", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, text: async () => "metric_a 1" }),
      ),
    );
    const client = createFetchVcMetricsClient(3000);
    await expect(client.getText("http://x/metrics")).resolves.toBe("metric_a 1");
    // 解決後にタイムアウト相当の時間を進めても副作用（未処理の abort 例外）が無い。
    await vi.advanceTimersByTimeAsync(5000);
  });

  it("aborts the request once the timeout elapses", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      ),
    );
    const client = createFetchVcMetricsClient(3000);
    const pending = client.getText("http://x/slow");
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("does not abort before the timeout elapses", async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((resolve) => {
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
            });
            setTimeout(
              () =>
                resolve(
                  fakeResponse({
                    ok: true,
                    status: 200,
                    text: async () => "metric_a 1",
                  }),
                ),
              2999,
            );
          }),
      ),
    );
    const client = createFetchVcMetricsClient(3000);
    const pending = client.getText("http://x/slow-but-in-time");
    await vi.advanceTimersByTimeAsync(2999);
    await expect(pending).resolves.toBe("metric_a 1");
    expect(aborted).toBe(false);
  });
});
