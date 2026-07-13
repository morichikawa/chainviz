// Collector のエントリポイント。Docker ポーリング → Ethereum アダプタによる
// 正規化 → ワールドステート store → WebSocket 配信、を配線する。

import Docker from "dockerode";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readContractCatalog } from "./adapters/ethereum/catalog.js";
import { EthereumAdapter } from "./adapters/ethereum/index.js";
import {
  readProfileMnemonic,
  walletTrackingDisabledWarning,
} from "./adapters/ethereum/mnemonic.js";
import { EthereumNodeLifecycle } from "./adapters/ethereum/node-lifecycle.js";
import { WalletTracker } from "./adapters/ethereum/wallet-tracker.js";
import { CommandHandler } from "./commands/handler.js";
import { createDockerClient } from "./docker/dockerode-client.js";
import { createDockerOperations } from "./docker/dockerode-operations.js";
import { DockerPoller } from "./docker/poller.js";
import {
  createOperationObserver,
  parseProxyTargetHost,
} from "./proxy/operation-observer.js";
import {
  createFetchForwarder,
  LoggingProxy,
  type RpcObservation,
} from "./proxy/logging-proxy.js";
import { CollectorServer } from "./server/websocket-server.js";
import { WorldStateStore } from "./world-state/store.js";

/** ポーリング間隔（docs/CONCEPT.md の決定に従い 3 秒）。 */
export const POLL_INTERVAL_MS = 3000;

/** WebSocket サーバーの既定ポート。 */
export const DEFAULT_PORT = 4000;

/**
 * ワークベンチ RPC 観測用ロギングプロキシの既定ポート。collector 本体の
 * WebSocket サーバー（4000）と衝突しないよう 4001 を使う（Issue #79）。
 */
export const DEFAULT_PROXY_PORT = 4001;

/**
 * ロギングプロキシの転送先（実ノードの JSON-RPC）。ワークベンチは現状
 * reth1 を叩く（profiles/ethereum の docker-compose.yml）ため、その内部 IP
 * を既定にする。collector はノード群と同じホスト上で動くので、Docker bridge
 * 上のコンテナ IP へ直接到達できる。環境変数で上書きできる。
 */
export const DEFAULT_PROXY_TARGET = "http://172.28.1.1:8545";

/**
 * 待ち受けポートを解決する。環境変数 CHAINVIZ_COLLECTOR_PORT が有効な
 * 非負整数なら優先し、未設定・不正値なら DEFAULT_PORT を使う。既存の
 * collector プロセスとポートが衝突しうる状況（E2E テストなど）で、
 * 起動側がポートを差し替えられるようにするために用いる。
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CHAINVIZ_COLLECTOR_PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_PORT;
  return parsed;
}

/**
 * ロギングプロキシの待受ポートを解決する。環境変数 CHAINVIZ_PROXY_PORT が
 * 有効な非負整数なら優先し、未設定・不正値なら DEFAULT_PROXY_PORT を使う。
 */
export function resolveProxyPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CHAINVIZ_PROXY_PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PROXY_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_PROXY_PORT;
  return parsed;
}

/**
 * ロギングプロキシの転送先 URL を解決する。環境変数
 * CHAINVIZ_PROXY_TARGET があれば優先し、なければ DEFAULT_PROXY_TARGET を使う。
 */
export function resolveProxyTarget(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.CHAINVIZ_PROXY_TARGET;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PROXY_TARGET;
  return raw.trim();
}

/**
 * collector（ロギングプロキシ）自体が動いているホストを、ワークベンチ
 * コンテナから見てどう名指すかの既定値。collector はコンテナではなくホスト
 * マシン上のプロセスとして動くため、コンテナ内から到達するには Docker の
 * host-gateway 予約名（Docker Engine 20.10+）を使う（静的ワークベンチの
 * `profiles/ethereum/docker-compose.yml` と同じ仕組み。extra_hosts で
 * この名前を host-gateway へ割り当てる必要がある）。
 */
export const DEFAULT_WORKBENCH_RPC_HOST = "host.docker.internal";

/**
 * ワークベンチコンテナから見た、ロギングプロキシへの到達ホスト名を解決する。
 * 環境変数 CHAINVIZ_WORKBENCH_RPC_HOST があれば優先し、なければ
 * DEFAULT_WORKBENCH_RPC_HOST を使う。collector が動くホストの参照名が
 * 通常と異なる環境（合成テスト環境等）向けの上書き口。
 */
export function resolveWorkbenchRpcHost(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.CHAINVIZ_WORKBENCH_RPC_HOST;
  if (raw === undefined || raw.trim() === "") return DEFAULT_WORKBENCH_RPC_HOST;
  return raw.trim();
}

/**
 * addWorkbench で動的に追加するワークベンチが叩く RPC 接続先 URL を解決する。
 * 静的ワークベンチ（docker-compose.yml の `workbench` サービス）と同じく
 * ロギングプロキシ（resolveWorkbenchRpcHost():resolveProxyPort()）を指す
 * ようにし、プロキシを経由しない直結を避ける（Issue #129。直結だと
 * ロギングプロキシがワークベンチの RPC 呼び出しを観測できず、操作エッジが
 * 描画されない）。ポートはロギングプロキシの実際の待受設定
 * （resolveProxyPort()）と常に一致させ、決め打ちの値を別途持たない。
 */
export function resolveWorkbenchRpcUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `http://${resolveWorkbenchRpcHost(env)}:${resolveProxyPort(env)}`;
}

/**
 * profiles/ethereum のホスト絶対パスを解決する。addNode/addWorkbench で
 * scripts/*.sh・values.env を bind mount / 読み込みするために必要。
 * 環境変数 CHAINVIZ_ETHEREUM_PROFILE_DIR で上書きでき、未設定なら
 * リポジトリ構成（packages/collector/dist/index.js の 4 つ上が repo ルート）
 * から導出する。
 */
export function resolveProfileDir(): string {
  const override = process.env.CHAINVIZ_ETHEREUM_PROFILE_DIR;
  if (override) return override;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/index.js -> dist -> collector -> packages -> repo ルート
  return path.resolve(here, "../../..", "profiles/ethereum");
}

export interface PollingLoop {
  stop(): void;
}

/**
 * プロセス全体を巻き込む未捕捉のエラーに対する安全網を張る。
 *
 * Issue #63 の時点では、addNode/addWorkbench で作成した managed コンテナの
 * 参照がメモリ上のレジストリだけに存在し、プロセスが落ちるとレジストリが
 * 失われて作成済みコンテナが孤児になる（削除できなくなる）ことを理由に、
 * uncaughtException も含めて「ログして継続する」方針を採っていた。
 *
 * Issue #65 で collector 起動時に `com.chainviz.managed` ラベルから
 * レジストリを再構築するようになったため、その前提（プロセス消滅 = 全コン
 * テナ孤児化）は解消した。孤児化の心配がなくなった以上、uncaughtException
 * については Node 公式の指針どおり「例外を捕捉できなかった時点でプロセスの
 * 状態は不定であり、そのまま実行を続けるべきではない」という原則に戻し、
 * ログを残したうえでプロセスを終了する。
 *
 * collector は `node dist/index.js` でホスト上に手動起動される開発・学習用
 * ツールであり、自動再起動の仕組み（supervisor やコンテナの restart ポリシー）
 * は用意していない。したがって exit(1) 後は開発者が手動で再起動するまで停止
 * したままになるが、クラッシュはこのターミナルの終了とフロント側の切断表示で
 * 即座に可視化されるため、不定状態のプロセスが壊れた観測結果を配信し続ける
 * よりも望ましい。再起動後は recoverManagedContainers が既存の managed
 * コンテナを回収するため、実行中のノード/ワークベンチが失われることはない。
 * 将来 supervisor 等の自動再起動を導入した場合も、この exit(1) はそのまま
 * 再起動の契機として機能する。
 *
 * 一方 unhandledRejection は「await し忘れた・catch し忘れた promise の
 * 失敗」であることが多く、必ずしもプロセス全体の状態が破損しているとは
 * 限らないため、引き続きログして継続する（個々の操作コマンドのエラーは
 * CommandHandler が commandResult(ok:false) としてフロントへ返す経路が別に
 * あるため、ここはあくまで「どのハンドラにも紐づかない背景のエラー」だけを
 * 受け止める最後の砦である）。
 */
export function installProcessSafetyNet(
  log: (message: string, detail: unknown) => void = (message, detail) =>
    console.error(message, detail),
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  process.on("unhandledRejection", (reason) => {
    log(
      "[collector] unhandled promise rejection; keeping the collector alive:",
      reason,
    );
  });
  process.on("uncaughtException", (err) => {
    log(
      "[collector] uncaught exception; exiting (restart the collector manually to resume):",
      err,
    );
    exit(1);
  });
}

/**
 * アダプタでポーリング→store へ取り込み→差分を配信、を周期実行する。
 * 前回のポーリングが完了してから次を予約する（重複実行を避ける）。
 */
export function startPollingLoop(
  adapter: EthereumAdapter,
  store: WorldStateStore,
  server: CollectorServer,
  intervalMs: number = POLL_INTERVAL_MS,
  onError: (err: unknown) => void = (err) => console.error("[collector] poll failed:", err),
): PollingLoop {
  let running = true;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    if (!running) return;
    try {
      const partial = await adapter.pollInfra();
      const diff = store.applyInfra(partial.entities ?? []);
      server.broadcastDiff(diff);
    } catch (err) {
      onError(err);
    }
    if (running) timer = setTimeout(() => void tick(), intervalMs);
  };

  void tick();

  return {
    stop(): void {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * ワークベンチ RPC 観測用ロギングプロキシを起動する。ワークベンチからの
 * JSON-RPC を受けて実ノードへ透過転送しつつ、呼び出しを観測データとして
 * 発行する。`onObserve` には `main()` で `operation-observer` の
 * `createOperationObserver` を差し込み、解決できた観測を `operationObserved`
 * として world-state 経由でフロントへ配信する（Issue #80）。
 */
export async function startLoggingProxy(
  port: number = DEFAULT_PROXY_PORT,
  target: string = DEFAULT_PROXY_TARGET,
  onObserve?: (observation: RpcObservation) => void,
): Promise<LoggingProxy> {
  const proxy = new LoggingProxy({
    forward: createFetchForwarder(target),
    onObserve,
  });
  await proxy.listen(port);
  console.log(
    `[collector] logging proxy listening on port ${port} -> ${target}`,
  );
  return proxy;
}

export async function main(port: number = DEFAULT_PORT): Promise<void> {
  const docker = new Docker();
  const poller = new DockerPoller(createDockerClient(docker));
  const profileDir = resolveProfileDir();
  // ワークベンチのウォレットアドレス導出に使う mnemonic を values.env から読む。
  // genesis のプリマイン鍵とワークベンチの鍵の共通の出所（Issue #77）。
  const mnemonic = readProfileMnemonic(profileDir);
  // values.env が無い/読めない/EL_AND_CL_MNEMONIC 未定義のいずれかで mnemonic を
  // 取得できないと、ウォレット層（C 層）が黙って無効化される。原因を追跡できる
  // よう起動時に明示的に警告する（エラーを握りつぶさない）。
  const walletWarning = walletTrackingDisabledWarning(mnemonic);
  if (walletWarning) console.warn(`[collector] ${walletWarning}`);
  // ワークベンチの rpcTargetNodeId 解決（Issue #123）に使う転送先ホストを、
  // ロギングプロキシと同じ resolveProxyTarget() から導出する。プロキシの
  // 実際の待受設定と常に一致させるため、ここでは決め打ちにしない。
  const proxyTarget = resolveProxyTarget();
  const rpcTargetHost = parseProxyTargetHost(proxyTarget);
  // コントラクトカタログ（profiles/ethereum/contracts/catalog.json）を読み込む
  // （Issue #161）。読み込み・パース失敗時は readContractCatalog が具体的な
  // 理由をログした上で undefined を返し、コントラクトのデプロイ検知自体は
  // 継続しつつカタログ由来の情報（name/token 等）だけ付与しない「未知のコント
  // ラクト」縮退動作になる（docs/ARCHITECTURE.md §4）。
  const catalog = readContractCatalog(profileDir);
  const adapter = new EthereumAdapter(poller, {
    mnemonic,
    rpcTargetHost,
    catalog,
  });
  const store = new WorldStateStore("ethereum");

  // 操作コマンド（ノード/ワークベンチの追加・削除）の処理を配線する。
  // addWorkbench が作るワークベンチの RPC 接続先は、静的ワークベンチと
  // 同様にロギングプロキシ経由にする（Issue #129）。ここで渡す URL は
  // 上のロギングプロキシ起動設定（proxyTarget/resolveProxyPort()）と
  // 別に決め打ちにせず、resolveWorkbenchRpcUrl() で同じ実行時設定から導出する。
  const lifecycle = new EthereumNodeLifecycle(createDockerOperations(docker), {
    profileDir,
    ethRpcUrl: resolveWorkbenchRpcUrl(),
    // GUI の定型操作（runWorkbenchOperation の deployContract）が成功した
    // デプロイについて、デプロイ先アドレスとカタログキーの対応を adapter の
    // コントラクト追跡へ登録する（Issue #161/#163 の統合）。lifecycle と
    // adapter は互いを import せず、このコールバック注入だけで結合する
    // （循環依存を避けるため）。
    onContractDeployed: (address, contractKey) =>
      adapter.registerContractDeployment(address, contractKey),
  });
  // com.chainviz.managed ラベルから、前回起動時に addNode/addWorkbench で
  // 作成した既存コンテナを回収し、レジストリ（this.nodes/this.workbenches）を
  // 再構築する。CommandHandler をワイヤリングする（= removeNode 等を受け付け
  // 始める）前に必ず完了させる（Issue #65）。
  await lifecycle.recoverManagedContainers();
  const commands = new CommandHandler(lifecycle);
  const server = new CollectorServer(store, commands);

  await server.listen(port);
  console.log(`[collector] WebSocket server listening on port ${port}`);

  // ワークベンチ → ノードの JSON-RPC 呼び出しを観測するロギングプロキシを
  // 起動する（Issue #79）。ワークベンチはこのプロキシ経由で reth を叩く。
  // 観測データは OperationEdge へ解決し、operationObserved イベントとして
  // フロントへ passthrough 配信する（Issue #80）。呼び出し元 IP・転送先ホストは
  // world-state store（＝解決口）へ観測ごとに問い合わせて id を引く。
  // 転送先ホスト（rpcTargetHost）は上で adapter に渡したものと同じ値を使う
  // （EthereumAdapter の rpcTargetNodeId 解決と対象が食い違わないようにする）。
  let onObserve: ((observation: RpcObservation) => void) | undefined;
  if (rpcTargetHost) {
    onObserve = createOperationObserver({
      targetHost: rpcTargetHost,
      resolver: store,
      broadcast: (events) => server.broadcastDiff(events),
    });
  } else {
    // 転送先 URL からホストを取り出せない場合は操作エッジを配信できない。
    // 黙って無効化せず理由を残す（CLAUDE.md「エラーを握りつぶさない」）。
    console.warn(
      `[collector] could not parse host from proxy target ${proxyTarget}; ` +
        `operation edges will not be broadcast`,
    );
  }
  await startLoggingProxy(resolveProxyPort(), proxyTarget, onObserve);

  // A 層: Docker のインフラ観測を周期ポーリングして配信する。
  startPollingLoop(adapter, store, server);

  // B 層: ピア接続（Beacon API）とブロック受信タイミング（eth_subscribe）を
  // 購読し、差分をワールドステート store 経由でフロントへ配信する。
  adapter.subscribePeers((edges) => {
    const diff = store.applyPeers(edges);
    server.broadcastDiff(diff);
  });
  adapter
    .subscribeBlocks((block) => {
      const diff = store.applyBlock(block);
      server.broadcastDiff(diff);
    })
    .catch((err) => console.error("[collector] block subscription failed:", err));

  // C 層: tx ライフサイクル（mempool 投入 → ブロック取り込み）を購読し、
  // TransactionEntity の差分をワールドステート store 経由でフロントへ配信する。
  // 併せて、この tx の from/to に一致する既存ウォレットの recentTxHashes
  // へ反映する（ウォレットカードの tx チップ表示。Issue #201 の E2E 実装で
  // 発覚した、この配線自体が欠落していたバグの修正）。
  //
  // `applyTransaction` は Issue #303 の入口ガードにより、対応する block を
  // store がまだ持たない included/failed tx（addNode 直後の追いつきで届く
  // 過去ブロックの tx 等）を空差分で捨てることがある。その場合は tx が store
  // に存在しないため、`linkTransactionToWallets` は呼ばない（store に無い
  // tx をウォレットの recentTxHashes に載せる無駄・紛らわしさを避ける）。
  adapter
    .subscribeTransactions((tx) => {
      const applied = store.applyTransaction(tx);
      const diff = store.hasTransaction(tx.hash)
        ? [...applied, ...store.linkTransactionToWallets(tx)]
        : applied;
      server.broadcastDiff(diff);
    })
    .catch((err) =>
      console.error("[collector] transaction subscription failed:", err),
    );

  // C 層（新 Phase 4）: コントラクトのデプロイ検知・内容更新（カタログ照合含む）
  // を購読し、ContractEntity の差分をワールドステート store 経由でフロントへ
  // 配信する（Issue #161）。EthereumAdapter の実装は subscribeTransactions が
  // 張る newHeads 購読を内部で共有するため、追加の購読・ポーリングは発生しない。
  adapter
    .subscribeContracts((contract) => {
      const diff = store.applyContract(contract);
      server.broadcastDiff(diff);
    })
    .catch((err) =>
      console.error("[collector] contract subscription failed:", err),
    );

  // C 層: ワークベンチが持つウォレットの残高・nonce・トークン残高を周期
  // ポーリングし、WalletEntity としてワールドステート store 経由でフロントへ
  // 配信する（Issue #77、トークン残高は Issue #164）。追跡中のトークン
  // コントラクト一覧は EthereumAdapter の ContractTracker（デプロイ検知・
  // カタログ照合済みの token メタ情報を持つコントラクト）から都度取得する。
  const walletTracker = new WalletTracker(poller, mnemonic, {
    getTokenContractAddresses: () => adapter.trackedTokenContractAddresses(),
  });
  walletTracker.subscribe((wallets) => {
    const diff = store.applyWallets(wallets);
    server.broadcastDiff(diff);
  });

  // D層: ノード内部の観測（Issue #185/#186）を購読し、ノード内部状態
  // （NodeEntity.internals）はワールドステート store 経由で、駆動リンク上の
  // 呼び出し活動（nodeLinkActivity）は operationObserved と同じく store に
  // 畳み込まず passthrough でフロントへ配信する（docs/ARCHITECTURE.md
  // §7.3）。
  adapter
    .subscribeNodeInternals({
      onInternals: (nodeId, internals) => {
        const diff = store.applyNodeInternals(nodeId, internals);
        server.broadcastDiff(diff);
      },
      onLinkActivity: (activity) => {
        server.broadcastDiff([{ type: "nodeLinkActivity", activity }]);
      },
    })
    .catch((err) =>
      console.error("[collector] node internals subscription failed:", err),
    );
}

// 直接実行されたときだけサーバーを起動する（import 時は副作用なし）。
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  // 背景の非同期エラーでプロセスごと落ちて managed コンテナを孤児化させないよう、
  // サーバー起動前に安全網を張る（Issue #63）。
  installProcessSafetyNet();
  main(resolvePort()).catch((err) => {
    console.error("[collector] fatal:", err);
    process.exit(1);
  });
}
