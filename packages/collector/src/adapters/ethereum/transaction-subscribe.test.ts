import type { TransactionEntity } from "@chainviz/shared";
import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { EthereumAdapter } from "./index.js";
import {
  beaconFixture,
  clientFrom,
  rethFixture,
} from "./test-helpers/docker-fixtures.js";
import type { RawReceiptFixture } from "./test-helpers/tx-rpc-fixtures.js";
import { flushAsync, stubRpcClient } from "./test-helpers/tx-rpc-fixtures.js";
import { controllableWsClient, header } from "./test-helpers/ws-fixtures.js";

describe("EthereumAdapter.subscribeTransactions", () => {
  it("subscribes to pending txs and newHeads on every execution node", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });

    await adapter.subscribeTransactions(() => {});
    expect(ws.pendingSubscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
    // 各 execution ノードに inclusion 用の newHeads も張る（beacon は対象外）。
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
  });

  it("emits a pending tx after fetching its from/to via RPC", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: "0xb", input: "0x" } },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();

    expect(rpc.txCalls).toEqual(["0xt1"]);
    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt1",
        from: "0xa",
        to: "0xb",
        status: "pending",
      },
    ]);
  });

  it("carries the observed nonce through to the pending TransactionEntity (Issue #319)", async () => {
    // stubRpcClient の txs フィクスチャは正規化後の RpcTransaction 型で
    // 固定されており nonce（16 進文字列 → 数値）の正規化を経由できないため、
    // ここでは eth_getTransactionByHash の生レスポンス（nonce: 16進文字列）を
    // 返す EthRpcClient を直接組み立て、正規化を含めた end-to-end を確認する。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc: EthRpcClient = {
      async call<T>(_url: string, method: string): Promise<T> {
        if (method === "eth_getTransactionByHash") {
          return {
            hash: "0xt1",
            from: "0xa",
            to: "0xb",
            input: "0x",
            nonce: "0x2a",
          } as T;
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    };
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();

    expect(txs).toHaveLength(1);
    expect(txs[0].nonce).toBe(42);
  });

  it("does not emit when the pending tx detail is not yet available", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({ txs: { "0xt1": null } });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();

    expect(txs).toEqual([]);
  });

  it("promotes a pending tx to included when a block containing it arrives", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: "0xb", input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xt1",
            from: "0xa",
            to: "0xb",
            status: "0x1",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toHaveLength(2);
    expect(txs[0].status).toBe("pending");
    expect(txs[1]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
      status: "included",
      blockHash: "0xblock1",
    });
  });

  it("promotes a pending tx to failed when its receipt reports status 0x0", async () => {
    // ブロックに取り込まれたが実行に失敗した tx(cast send --create 0xfe 等)。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: null, input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xt1",
            from: "0xa",
            to: null,
            status: "0x0",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toHaveLength(2);
    expect(txs[0].status).toBe("pending");
    expect(txs[1]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: null,
      status: "failed",
      blockHash: "0xblock1",
    });
  });

  it("surfaces the receipt's contractAddress as createdContractAddress end-to-end (Issue #160)", async () => {
    // デプロイ tx（to: null）が取り込まれ、receipt.contractAddress が
    // TransactionEntity.createdContractAddress へマッピングされることを、
    // アダプタ経由（getBlockReceipts + recordInclusion）で確認する。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xdeploy": { hash: "0xdeploy", from: "0xdeployer", to: null, input: "0x" } },
      blocks: {
        "0xblock1": [
          {
            transactionHash: "0xdeploy",
            from: "0xdeployer",
            to: null,
            status: "0x1",
            contractAddress: "0xnewcontract",
          },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xdeploy");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toHaveLength(2);
    expect(txs[0].status).toBe("pending");
    expect(txs[0].createdContractAddress).toBeUndefined();
    expect(txs[1]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xdeploy",
      from: "0xdeployer",
      to: null,
      status: "included",
      blockHash: "0xblock1",
      createdContractAddress: "0xnewcontract",
    });
  });

  it("omits createdContractAddress for an ordinary tx (contractAddress absent, Issue #160)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      txs: { "0xt1": { hash: "0xt1", from: "0xa", to: "0xb", input: "0x" } },
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs[1].createdContractAddress).toBeUndefined();
    expect(txs[1]).not.toHaveProperty("createdContractAddress");
  });

  it("routes a mixed block end-to-end: success -> included, failed -> failed", async () => {
    // 同一ブロックに success と failed の tx が混在するときの振り分けを
    // アダプタ経由（getBlockReceipts + recordInclusion）で確認する。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xok", from: "0xa", to: "0xb", status: "0x1" },
          { transactionHash: "0xbad", from: "0xc", to: null, status: "0x0" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xok",
        from: "0xa",
        to: "0xb",
        status: "included",
        blockHash: "0xblock1",
      },
      {
        kind: "transaction",
        hash: "0xbad",
        from: "0xc",
        to: null,
        status: "failed",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("drops a malformed receipt but still emits the valid txs in the same block", async () => {
    // ブロック内に transactionHash 欠落の receipt が混じっても、正常な
    // receipt だけが included/failed として通知される（不正 receipt は無視）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          // transactionHash 欠落 → getBlockReceipts が捨てる。
          {
            transactionHash: undefined as unknown as string,
            from: "0xz",
            to: "0xy",
            status: "0x0",
          },
          { transactionHash: "0xok", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xok",
        from: "0xa",
        to: "0xb",
        status: "included",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("adds a tx seen only in a block (pending missed) directly as failed", async () => {
    // pending 通知を取りこぼした失敗 tx も、ブロックの receipt から直接
    // failed として可視化に載せる（未知ハッシュの failed 経路）。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt9", from: "0xc", to: null, status: "0x0" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt9",
        from: "0xc",
        to: null,
        status: "failed",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("adds a tx seen only in a block (pending missed) directly as included", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt9", from: "0xc", to: null, status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();

    expect(txs).toEqual<TransactionEntity[]>([
      {
        kind: "transaction",
        hash: "0xt9",
        from: "0xc",
        to: null,
        status: "included",
        blockHash: "0xblock1",
      },
    ]);
  });

  it("fetches each block's receipts only once even when several nodes announce it", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({
      blocks: {
        "0xblock1": [
          { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
        ],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    // 同一ブロックは 2 ノードから届くが eth_getBlockReceipts は 1 回だけ。
    expect(rpc.blockCalls).toEqual(["0xblock1"]);
    expect(txs).toHaveLength(1);
  });

  it("retries block inclusion on a later node's notification when the first fetch returns null", async () => {
    // 回帰テスト: 1 ノード目の eth_getBlockReceipts が null（伝播遅延）を返しても
    // processedBlocks に残らず、同一ブロックを通知する 2 ノード目の newHeads で
    // included へ回復できること。以前は初回で処理済みにしてしまい、後続通知が
    // 弾かれて tx が pending のまま固まる不具合があった。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const receipts: RawReceiptFixture[] = [
      { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
    ];
    let blockAttempts = 0;
    const rpc: EthRpcClient = {
      async call<T>(_url: string, method: string): Promise<T> {
        if (method === "eth_getTransactionByHash") return null as T;
        // 1 回目の取得は null（まだ伝播していない）、2 回目以降は成功。
        blockAttempts += 1;
        return (blockAttempts === 1 ? null : receipts) as T;
      },
    };
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    // reth1 が先に通知するが取得は null。ここで固まらないことを確認する。
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(txs).toEqual([]);

    // reth2 が同一ブロックを通知すると再試行され、included になる。
    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    expect(blockAttempts).toBe(2);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toEqual<TransactionEntity>({
      kind: "transaction",
      hash: "0xt1",
      from: "0xa",
      to: "0xb",
      status: "included",
      blockHash: "0xblock1",
    });
  });

  it("retries block inclusion on a later node's notification when the first fetch throws", async () => {
    // 回帰テスト（例外版）: 1 ノード目の eth_getBlockReceipts が例外を投げても
    // processedBlocks に残らず、後続ノードの通知で回復できること。
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const receipts: RawReceiptFixture[] = [
      { transactionHash: "0xt1", from: "0xa", to: "0xb", status: "0x1" },
    ];
    let blockAttempts = 0;
    const rpc: EthRpcClient = {
      async call<T>(_url: string, method: string): Promise<T> {
        if (method === "eth_getTransactionByHash") return null as T;
        blockAttempts += 1;
        if (blockAttempts === 1) throw new Error("rpc timeout");
        return receipts as T;
      },
    };
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emit("ws://172.28.1.1:8546", header());
    await flushAsync();
    expect(txs).toEqual([]);

    ws.emit("ws://172.28.1.2:8546", header());
    await flushAsync();

    expect(blockAttempts).toBe(2);
    expect(txs).toHaveLength(1);
    expect(txs[0].status).toBe("included");
    vi.restoreAllMocks();
  });

  it("keeps looping after a failed RPC fetch (error is swallowed and logged)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc: EthRpcClient = {
      async call<T>(_url: string, method: string): Promise<T> {
        if (method === "eth_getTransactionByHash") {
          throw new Error("rpc down");
        }
        return null as T;
      },
    };
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc,
    });
    const txs: TransactionEntity[] = [];

    await adapter.subscribeTransactions((t) => txs.push(t));
    ws.emitPending("ws://172.28.1.1:8546", "0xt1");
    await flushAsync();

    // 失敗しても例外は外に漏れず、onTx も呼ばれない。
    expect(txs).toEqual([]);
    vi.restoreAllMocks();
  });

  it("closes pending and inclusion subscriptions on dispose", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });

    await adapter.subscribeTransactions(() => {});
    adapter.dispose();
    expect(ws.closed).toContain("pending:ws://172.28.1.1:8546");
    expect(ws.closed).toContain("ws://172.28.1.1:8546");
  });

  it("does not subscribe when there are no execution nodes", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const ws = controllableWsClient();
    const rpc = stubRpcClient({});
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      ethRpcClient: rpc.client,
    });
    await adapter.subscribeTransactions(() => {});
    expect(ws.pendingSubscribedUrls).toEqual([]);
    expect(ws.subscribedUrls).toEqual([]);
  });
});
