// チェーンリセット（観測対象のチェーン自体が破棄され、別のチェーンとして
// 再作成されたこと。例: `docker compose down -v` → `up` による genesis の
// 再生成）の検知（Issue #357）。
//
// 検知方法は genesis（block 0）のハッシュの変化。ブロック番号の後退では
// 判定しない（addNode 直後の追いつき中ノードが過去ブロックの newHeads を
// 大量に流すケースと区別できないため。docs/worklog/issue-357.md 参照）。
// `generate-genesis.sh` は生成のたびに現在時刻を genesis に焼き込むため、
// `down -v` → `up` を経ると genesis ハッシュは必ず変わる。
//
// subscribePeers/WalletTracker と同型の周期ポーリングループを自前で持ち
// （1ファイル1責務のため、ループ・キャッシュ・判定をこのファイルに閉じる）、
// RPC 到達は既存の eth-rpc-client.ts / targets.ts を再利用する。

import type { DockerPoller } from "../../docker/poller.js";
import {
  createFetchEthRpcClient,
  fetchGenesisHash,
  type EthRpcClient,
} from "./eth-rpc-client.js";
import { executionRpcUrls } from "./targets.js";

/** チェーンリセット監視の既定ポーリング間隔（他層のループと揃えて3秒）。 */
export const CHAIN_RESET_POLL_INTERVAL_MS = 3000;

export interface ChainResetWatcherDeps {
  rpc?: EthRpcClient;
  pollIntervalMs?: number;
}

/**
 * genesis（block 0）ハッシュを周期観測し、前回観測できたハッシュと異なる
 * ハッシュを実際に観測できたときだけチェーンリセットとして onReset を呼ぶ。
 *
 * - 初回の観測はキャッシュを埋めるだけで onReset は呼ばない（比較対象が
 *   無いため「変化した」と判定できない）
 * - 到達可能な Execution ノードが1つも無い等、観測そのものに失敗した場合は
 *   前回のキャッシュ値を維持し、onReset を呼ばない（欠測をリセットの証拠に
 *   しない。Issue #288 と同じ原則。チェーン停止中の一時的な観測不能を
 *   誤ってリセットと判定しない）
 * - 到達可能なノードは observeOnce 内で先頭から順に試し、最初に成功した
 *   ノードの値を使う（`executionRpcUrls` の想定用途どおり、genesis ハッシュ
 *   はチェーン全体の状態でどの Execution ノードに聞いても同じため）
 */
export class ChainResetWatcher {
  private readonly rpc: EthRpcClient;
  private readonly pollIntervalMs: number;

  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private lastGenesisHash: string | undefined;

  constructor(
    private readonly poller: DockerPoller,
    deps: ChainResetWatcherDeps = {},
  ) {
    this.rpc = deps.rpc ?? createFetchEthRpcClient();
    this.pollIntervalMs = deps.pollIntervalMs ?? CHAIN_RESET_POLL_INTERVAL_MS;
  }

  /**
   * 現在の genesis ハッシュを1回観測する。到達可能な Execution ノードを
   * 先頭から順に試し、最初に成功したノードの値を返す。全滅時は undefined
   * （観測失敗。呼び出し側はリセットの証拠として扱わない）。
   */
  async observeOnce(): Promise<string | undefined> {
    const observations = await this.poller.pollOnce();
    const urls = executionRpcUrls(observations);
    for (const url of urls) {
      try {
        return await fetchGenesisHash(this.rpc, url);
      } catch {
        // このノードは到達不能・エラー。次のノードを試す。
      }
    }
    return undefined;
  }

  /**
   * 監視を開始する。前回のポーリング完了後に次を予約する（重複実行を
   * 避ける、他の周期ループと同じ流儀）。
   */
  subscribe(onReset: () => void): void {
    if (this.running) return;
    this.running = true;

    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        const hash = await this.observeOnce();
        if (hash !== undefined) {
          if (this.lastGenesisHash === undefined) {
            this.lastGenesisHash = hash;
          } else if (hash !== this.lastGenesisHash) {
            this.lastGenesisHash = hash;
            onReset();
          }
        }
      } catch (err) {
        console.error("[ethereum] chain reset watch failed:", err);
      }
      if (this.running) {
        this.timer = setTimeout(() => void tick(), this.pollIntervalMs);
      }
    };

    void tick();
  }

  /** 監視を停止する（テスト・シャットダウン用）。 */
  dispose(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** 現在キャッシュしている genesis ハッシュ（テスト・確認用）。 */
  get observedGenesisHash(): string | undefined {
    return this.lastGenesisHash;
  }
}
