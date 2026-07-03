import { type ChainvizClient, createChainvizClient } from "../websocket/client.js";
import { createMockClient } from "../websocket/mockData.js";
import type { ClientFactory } from "../world-state/useWorldState.js";

export interface DefaultClient {
  factory: ClientFactory;
  isMock: boolean;
}

/**
 * VITE_COLLECTOR_URL が設定されていれば実 WebSocket クライアント、無ければ
 * モッククライアントを使う。collector 未起動でも UI を確認できるようにする。
 */
export function resolveDefaultClient(
  collectorUrl: string | undefined,
): DefaultClient {
  if (collectorUrl) {
    const factory: ClientFactory = (handlers): ChainvizClient =>
      createChainvizClient({ url: collectorUrl, ...handlers });
    return { factory, isMock: false };
  }
  return {
    factory: (handlers) => createMockClient(handlers),
    isMock: true,
  };
}
