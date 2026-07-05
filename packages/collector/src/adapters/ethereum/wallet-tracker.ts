// C 層（ウォレット）: 稼働中のワークベンチが保持するウォレットの残高・nonce を
// 周期ポーリングし、WalletObservation としてワールドステート store へ渡す部分。
//
// mnemonic からのアドレス導出・eth_getBalance / eth_getTransactionCount という
// Ethereum 固有の語彙はこのアダプタ配下（このファイルと wallet-derivation.ts /
// eth-rpc-client.ts）に閉じ込め、共通層には「アドレス・残高・nonce・所有者」と
// いうチェーン非依存の語彙（WalletObservation）だけを渡す。

import type { WalletObservation } from "../../world-state/diff.js";
import type { DockerPoller } from "../../docker/poller.js";
import type { ContainerObservation } from "../../docker/types.js";
import { classifyContainer } from "./classify.js";
import {
  createFetchEthRpcClient,
  fetchBalanceWei,
  fetchNonce,
  type EthRpcClient,
} from "./eth-rpc-client.js";
import { executionRpcUrls } from "./targets.js";
import {
  deriveWalletAddress,
  workbenchWalletIndex,
} from "./wallet-derivation.js";

/** ウォレットポーリングの既定間隔（他層と揃えて 3 秒）。 */
export const WALLET_POLL_INTERVAL_MS = 3000;

export interface WalletTrackerDeps {
  rpc?: EthRpcClient;
  pollIntervalMs?: number;
  /** mnemonic + index からアドレスを導出する関数（テスト差し替え用）。 */
  deriveAddress?: (mnemonic: string, index: number) => string;
}

/** 稼働中ワークベンチ 1 件に対応するウォレットの識別情報。 */
interface WorkbenchWallet {
  ownerWorkbenchId: string;
  address: string;
}

/**
 * ワークベンチのウォレット残高・nonce を周期ポーリングする。所有関係は Docker の
 * 観測値（どのワークベンチコンテナが動いているか）から決め、残高・nonce は
 * Execution ノードの JSON-RPC から取る。RPC が一時的に落ちても所有関係の判定は
 * Docker 観測に依存するので、RPC 失敗を「ワークベンチ消滅（= 所有者を null に
 * する）」と取り違えない（store 側の computeWalletDiff がこの前提で動く）。
 */
export class WalletTracker {
  private readonly rpc: EthRpcClient;
  private readonly pollIntervalMs: number;
  private readonly deriveAddress: (mnemonic: string, index: number) => string;

  private running = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly poller: DockerPoller,
    private readonly mnemonic: string | undefined,
    deps: WalletTrackerDeps = {},
  ) {
    this.rpc = deps.rpc ?? createFetchEthRpcClient();
    this.pollIntervalMs = deps.pollIntervalMs ?? WALLET_POLL_INTERVAL_MS;
    this.deriveAddress = deps.deriveAddress ?? deriveWalletAddress;
  }

  /**
   * Docker を 1 巡観測して稼働中ワークベンチのウォレットを列挙し、各アドレスの
   * 残高・nonce を Execution ノードの JSON-RPC から取得して WalletObservation[]
   * を返す。mnemonic が無ければ（アドレスを導出できないので）空配列を返す。
   * RPC 取得に失敗したアドレスは balance/nonce を undefined のままにする
   * （store 側が既存値を維持し、新規アドレスは値が取れるまで追加を保留する）。
   */
  async pollOnce(): Promise<WalletObservation[]> {
    if (!this.mnemonic) return [];
    const observations = await this.poller.pollOnce();
    const wallets = this.workbenchWallets(observations);
    if (wallets.length === 0) return [];

    const urls = executionRpcUrls(observations);
    return Promise.all(
      wallets.map(async (wallet): Promise<WalletObservation> => {
        const state = await this.fetchWalletState(urls, wallet.address);
        return {
          address: wallet.address,
          ownerWorkbenchId: wallet.ownerWorkbenchId,
          balance: state.balance,
          nonce: state.nonce,
        };
      }),
    );
  }

  /**
   * ポーリングを開始する。毎回の WalletObservation[] を onWallets に渡す。
   * 前回のポーリング完了後に次を予約する（重複実行を避ける）。
   */
  subscribe(onWallets: (wallets: WalletObservation[]) => void): void {
    if (this.running) return;
    this.running = true;

    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        const wallets = await this.pollOnce();
        onWallets(wallets);
      } catch (err) {
        console.error("[ethereum] wallet poll failed:", err);
      }
      if (this.running) {
        this.timer = setTimeout(() => void tick(), this.pollIntervalMs);
      }
    };

    void tick();
  }

  /** ポーリングを停止する（テスト・シャットダウン用）。 */
  dispose(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** 観測値からワークベンチを抽出し、それぞれのウォレットアドレスを導出する。 */
  private workbenchWallets(
    observations: ContainerObservation[],
  ): WorkbenchWallet[] {
    const mnemonic = this.mnemonic;
    if (!mnemonic) return [];
    const wallets: WorkbenchWallet[] = [];
    for (const obs of observations) {
      if (classifyContainer(obs).kind !== "workbench") continue;
      const index = workbenchWalletIndex(obs.labels);
      wallets.push({
        ownerWorkbenchId: obs.stableId,
        address: this.deriveAddress(mnemonic, index),
      });
    }
    return wallets;
  }

  /**
   * 与えられた Execution RPC URL を先頭から順に試し、最初に成功したノードから
   * 残高・nonce を返す。すべて失敗したら空オブジェクト（値なし）を返す。
   */
  private async fetchWalletState(
    urls: string[],
    address: string,
  ): Promise<{ balance?: string; nonce?: number }> {
    for (const url of urls) {
      try {
        const [balance, nonce] = await Promise.all([
          fetchBalanceWei(this.rpc, url, address),
          fetchNonce(this.rpc, url, address),
        ]);
        return { balance, nonce };
      } catch {
        // このノードは到達不能・エラー。次のノードを試す。全滅時のみ値なしを返す。
      }
    }
    return {};
  }
}
