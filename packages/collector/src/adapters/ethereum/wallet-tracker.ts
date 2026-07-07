// C 層（ウォレット）: 稼働中のワークベンチが保持するウォレットの残高・nonce を
// 周期ポーリングし、WalletObservation としてワールドステート store へ渡す部分。
//
// mnemonic からのアドレス導出・eth_getBalance / eth_getTransactionCount という
// Ethereum 固有の語彙はこのアダプタ配下（このファイルと wallet-derivation.ts /
// eth-rpc-client.ts）に閉じ込め、共通層には「アドレス・残高・nonce・所有者」と
// いうチェーン非依存の語彙（WalletObservation）だけを渡す。

import type { TokenBalance } from "@chainviz/shared";
import type { WalletObservation } from "../../world-state/diff.js";
import type { DockerPoller } from "../../docker/poller.js";
import type { ContainerObservation } from "../../docker/types.js";
import { classifyContainer } from "./classify.js";
import { fetchErc20Balance } from "./erc20.js";
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
  /**
   * 現在追跡中（デプロイ検知済み・カタログの token メタ情報あり）のトークン
   * コントラクトのアドレス一覧を返す関数。EthereumAdapter.
   * trackedTokenContractAddresses() を collector 本体（index.ts）が渡す
   * 想定（Issue #164）。未指定（テストでの省略時含む）は常に空配列を返す
   * 関数を既定にし、その場合トークン残高のポーリング自体を行わない
   * （docs/ARCHITECTURE.md §4「トークンが 1 つもデプロイされていなければ
   * 何もしない」）。
   */
  getTokenContractAddresses?: () => string[];
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
  private readonly getTokenContractAddresses: () => string[];

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
    this.getTokenContractAddresses = deps.getTokenContractAddresses ?? (() => []);
  }

  /**
   * Docker を 1 巡観測して稼働中ワークベンチのウォレットを列挙し、各アドレスの
   * 残高・nonce を Execution ノードの JSON-RPC から取得して WalletObservation[]
   * を返す。mnemonic が無ければ（アドレスを導出できないので）空配列を返す。
   * RPC 取得に失敗したアドレスは balance/nonce を undefined のままにする
   * （store 側が既存値を維持し、新規アドレスは値が取れるまで追加を保留する）。
   *
   * 追跡中のトークンコントラクト（getTokenContractAddresses()）が 1 つでも
   * あれば、各ウォレット × 各トークンコントラクトの balanceOf を同じ周期で
   * 追加取得し tokenBalances に載せる（Issue #164。docs/ARCHITECTURE.md §4）。
   * トークンコントラクトが 1 つも無ければ、この追加取得自体を一切行わない
   * （無駄なポーリングを避ける）。
   */
  async pollOnce(): Promise<WalletObservation[]> {
    if (!this.mnemonic) return [];
    const observations = await this.poller.pollOnce();
    const wallets = this.workbenchWallets(observations);
    if (wallets.length === 0) return [];

    const urls = executionRpcUrls(observations);
    const tokenAddresses = this.getTokenContractAddresses();
    return Promise.all(
      wallets.map(async (wallet): Promise<WalletObservation> => {
        const state = await this.fetchWalletState(urls, wallet.address);
        const tokenBalances =
          tokenAddresses.length > 0
            ? await this.fetchTokenBalances(urls, wallet.address, tokenAddresses)
            : undefined;
        return {
          address: wallet.address,
          ownerWorkbenchId: wallet.ownerWorkbenchId,
          balance: state.balance,
          nonce: state.nonce,
          ...(tokenBalances !== undefined ? { tokenBalances } : {}),
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

  /**
   * 与えられたウォレット × トークンコントラクトの組み合わせについて、各
   * コントラクトの balanceOf を並行に取得する。個別のトークンの取得に失敗
   * しても他のトークンの取得は継続し、失敗したトークンは戻り値の配列から
   * 単に除外する（diff.ts の mergeTokenBalances が、前回値を維持する形で
   * 埋め合わせる）。
   */
  private async fetchTokenBalances(
    urls: string[],
    walletAddress: string,
    tokenAddresses: string[],
  ): Promise<TokenBalance[]> {
    const results = await Promise.all(
      tokenAddresses.map(async (contractAddress) => {
        const amount = await this.fetchTokenBalance(
          urls,
          contractAddress,
          walletAddress,
        );
        return amount !== undefined ? { contractAddress, amount } : null;
      }),
    );
    return results.filter((r): r is TokenBalance => r !== null);
  }

  /**
   * 与えられた Execution RPC URL を先頭から順に試し、最初に成功したノードから
   * 指定トークンコントラクトの残高を取得する。すべて失敗したら理由をログして
   * undefined を返す（呼び出し側はこのトークンだけ今回の観測から除外する）。
   *
   * 失敗理由は URL への到達不能とは限らない（balanceOf の revert、viem での
   * デコード失敗、HTTP エラーなどもここに含まれる）。固定文言にすり替えず、
   * 最後に捕捉した実際のエラーをログに含める（CLAUDE.md「エラーを握りつぶす
   * コードを見逃さない」）。
   */
  private async fetchTokenBalance(
    urls: string[],
    tokenAddress: string,
    walletAddress: string,
  ): Promise<string | undefined> {
    let lastError: unknown;
    for (const url of urls) {
      try {
        return await fetchErc20Balance(this.rpc, url, tokenAddress, walletAddress);
      } catch (err) {
        // このノードでは取得できなかった（到達不能とは限らない）。理由を
        // 保持しつつ次のノードを試す。
        lastError = err;
      }
    }
    console.error(
      `[ethereum] token balance poll failed for token ${tokenAddress} / wallet ${walletAddress}:`,
      lastError,
    );
    return undefined;
  }
}
