import type {
  EthWsClient,
  NewHeadHeader,
  Subscription,
} from "../eth-ws-client.js";

/**
 * Issue #309: peer-block-adapter.test.ts から切り出した共有fixture。
 * newHeads/pendingTransactions 購読向けの EthWsClient モックと、
 * newHeads ヘッダのファクトリ。
 */

/** 手動でヘッダ・pending tx を発火できる制御可能な EthWsClient。 */
export function controllableWsClient(): {
  client: EthWsClient;
  emit: (wsUrl: string, header: NewHeadHeader) => void;
  emitPending: (wsUrl: string, hash: string) => void;
  closed: string[];
  subscribedUrls: string[];
  pendingSubscribedUrls: string[];
} {
  // 同じ wsUrl に newHeads が複数回購読される（B 層と C 層）ので配列で保持する。
  const headHandlers = new Map<string, ((h: NewHeadHeader) => void)[]>();
  const pendingHandlers = new Map<string, (hash: string) => void>();
  const closed: string[] = [];
  const subscribedUrls: string[] = [];
  const pendingSubscribedUrls: string[] = [];
  const client: EthWsClient = {
    subscribeNewHeads(wsUrl, onHeader): Subscription {
      const list = headHandlers.get(wsUrl) ?? [];
      list.push(onHeader);
      headHandlers.set(wsUrl, list);
      subscribedUrls.push(wsUrl);
      return {
        close(): void {
          closed.push(wsUrl);
          // 実際の WebSocket close と同様、close 済みのハンドラには以後の
          // emit を届けない（この特定のハンドラだけを取り除く。同じ wsUrl
          // への他の購読（B 層/C 層、または張り直し後の新しい購読）には
          // 影響しない。Issue #301: リコンサイルが signature 変化で
          // close→open する際、古いハンドラが emit で呼ばれ続けないことを
          // テストで確認できるようにするため）。
          const current = headHandlers.get(wsUrl);
          if (current) {
            const idx = current.indexOf(onHeader);
            if (idx !== -1) current.splice(idx, 1);
          }
        },
      };
    },
    subscribePendingTransactions(wsUrl, onTxHash): Subscription {
      pendingHandlers.set(wsUrl, onTxHash);
      pendingSubscribedUrls.push(wsUrl);
      return {
        close(): void {
          closed.push(`pending:${wsUrl}`);
        },
      };
    },
  };
  return {
    client,
    emit: (wsUrl, header) => {
      for (const handler of headHandlers.get(wsUrl) ?? []) handler(header);
    },
    emitPending: (wsUrl, hash) => pendingHandlers.get(wsUrl)?.(hash),
    closed,
    subscribedUrls,
    pendingSubscribedUrls,
  };
}

export function header(overrides: Partial<NewHeadHeader> = {}): NewHeadHeader {
  return {
    hash: "0xblock1",
    number: "0x10",
    parentHash: "0xparent",
    timestamp: "0x64",
    ...overrides,
  };
}
