// C 層（新 Phase 4）: 追跡中の NFT（ERC-721）コントラクトの所有台帳
// （tokenId → 所有者）を totalSupply + ownerOf の eth_call ポーリングで構築
// する部分（Issue #315）。wallet-tracker.ts と同型の 3 秒周期ポーリングだが、
// 観測対象がウォレット単位ではなくコントラクト単位であるため、1 ファイル
// 1 責務の原則により wallet-tracker.ts には足さず別ファイルに分離する。

import type { NftToken } from "@chainviz/shared";
import type { DockerPoller } from "../../docker/poller.js";
import { fetchErc721Ledger } from "./erc721.js";
import {
  createFetchEthRpcClient,
  type EthRpcClient,
} from "./eth-rpc-client.js";
import { executionRpcUrls } from "./targets.js";

/** NFT 所有台帳ポーリングの既定間隔（他層と揃えて 3 秒）。 */
export const NFT_POLL_INTERVAL_MS = 3000;

/** 1 コントラクト分の所有台帳の観測結果。 */
export interface NftLedgerObservation {
  address: string;
  /**
   * この周期で取得できた所有台帳。取得に失敗した（totalSupply/ownerOf の
   * どれか 1 つでも eth_call が失敗した）場合は undefined（呼び出し側は
   * 前回の台帳を維持し、更新を行わない）。
   */
  tokens: NftToken[] | undefined;
}

export interface NftTrackerDeps {
  rpc?: EthRpcClient;
  pollIntervalMs?: number;
  /**
   * 現在追跡中（デプロイ検知済み・カタログの nft メタ情報あり）の NFT
   * コントラクトのアドレス一覧を返す関数。EthereumAdapter.
   * trackedNftContractAddresses() を collector 本体（index.ts）が渡す想定
   * （wallet-tracker.ts の getTokenContractAddresses と同型）。未指定
   * （テストでの省略時含む）は常に空配列を返す関数を既定にし、その場合
   * ポーリング自体（Docker 観測含む）を一切行わない。
   */
  getNftContractAddresses?: () => string[];
}

/**
 * 追跡中の NFT コントラクトそれぞれについて、所有台帳を周期ポーリングする。
 * ウォレット残高・トークン残高（wallet-tracker.ts / erc20.ts）と同じ
 * 「チェーンに直接問い合わせる」流儀で、Docker の観測値から Execution RPC の
 * URL を求める点も共通する。NFT コントラクトが 1 つも追跡されていなければ
 * Docker 観測自体を省略する（無駄なポーリングを避ける。wallet-tracker.ts の
 * トークン残高ポーリングと同じ判断）。
 */
export class NftTracker {
  private readonly rpc: EthRpcClient;
  private readonly pollIntervalMs: number;
  private readonly getNftContractAddresses: () => string[];

  private running = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly poller: DockerPoller,
    deps: NftTrackerDeps = {},
  ) {
    this.rpc = deps.rpc ?? createFetchEthRpcClient();
    this.pollIntervalMs = deps.pollIntervalMs ?? NFT_POLL_INTERVAL_MS;
    this.getNftContractAddresses =
      deps.getNftContractAddresses ?? (() => []);
  }

  /**
   * 追跡中の NFT コントラクトそれぞれについて所有台帳を取得し、
   * NftLedgerObservation[] を返す。追跡中の NFT コントラクトが 1 つも
   * 無ければ空配列を返す（Docker 観測も行わない）。到達可能な Execution
   * ノードが 1 つも無い場合、各コントラクトの tokens は undefined になる
   * （取得を試みたが失敗、として扱う）。
   */
  async pollOnce(): Promise<NftLedgerObservation[]> {
    const addresses = this.getNftContractAddresses();
    if (addresses.length === 0) return [];

    const observations = await this.poller.pollOnce();
    const urls = executionRpcUrls(observations);

    return Promise.all(
      addresses.map(
        async (address): Promise<NftLedgerObservation> => ({
          address,
          tokens: await this.fetchLedger(urls, address),
        }),
      ),
    );
  }

  /**
   * ポーリングを開始する。毎回の NftLedgerObservation[] を onObservations に
   * 渡す（追跡中の NFT コントラクトが無い周期は呼ばない）。前回のポーリング
   * 完了後に次を予約する（重複実行を避ける）。
   */
  subscribe(
    onObservations: (observations: NftLedgerObservation[]) => void,
  ): void {
    if (this.running) return;
    this.running = true;

    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        const observations = await this.pollOnce();
        if (observations.length > 0) onObservations(observations);
      } catch (err) {
        console.error("[ethereum] nft ledger poll failed:", err);
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

  /**
   * 与えられた Execution RPC URL を先頭から順に試し、最初に成功したノードから
   * このコントラクトの所有台帳全体を取得する。すべて失敗したら理由をログして
   * undefined を返す（呼び出し側はこのコントラクトの今回の更新を諦め、前回の
   * 台帳を維持する）。
   *
   * 失敗理由は URL への到達不能とは限らない（ownerOf の revert、viem での
   * デコード失敗、HTTP エラーなどもここに含まれる）。固定文言にすり替えず、
   * 最後に捕捉した実際のエラーをログに含める（CLAUDE.md「エラーを握りつぶす
   * コードを見逃さない」）。
   */
  private async fetchLedger(
    urls: string[],
    address: string,
  ): Promise<NftToken[] | undefined> {
    let lastError: unknown;
    for (const url of urls) {
      try {
        return await fetchErc721Ledger(this.rpc, url, address);
      } catch (err) {
        lastError = err;
      }
    }
    console.error(
      `[ethereum] nft ledger poll failed for contract ${address}:`,
      lastError ?? new Error("no reachable execution RPC endpoint"),
    );
    return undefined;
  }
}
