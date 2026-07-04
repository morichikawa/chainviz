// addNode で追加したノードが既存チェーンへ追従する（履歴バックフィル）のを
// 待つためのロジック。稼働中スタックを再利用する E2E ハーネスでは、テスト実行
// 時点でチェーンがどれだけ進行しているか（＝バックフィルすべき履歴の長さ）が
// 毎回変わる。固定タイムアウトだと長く進んだチェーンではバックフィルが間に
// 合わず落ちてしまうため、次の 2 点で「稼働時間が延びても安定して通る」よう
// にする:
//
//   1. 待ち開始時点の「追加ノードの高さ」と「ターゲット高さ」の差分から、
//      既知のバックフィル速度（安全マージンを見込んだ保守的な値）を使って
//      全体タイムアウトを動的に算出する。
//   2. 進捗が完全に停止した場合は全体タイムアウトを待たずに早期失敗する。
//      #44 / #46 の回帰は「追加ノードの高さが 0（またはある値）のまま進まない」
//      形で現れるため、停止検出でこれを速やかに捕まえられる。
//
// タイマー・I/O に触れない純粋なロジック（catchUpTimeoutMs / CatchUpMonitor）
// と、それらを実クロック・実 RPC で駆動する waitForBlockCatchUp に分けてある。

import { sleep } from "./wait.js";

/**
 * バックフィルすべきブロック数（gap）から全体タイムアウト(ms)を算出する。
 *
 * - `ratePerSec`: 想定バックフィル速度。実測は 9〜10 ブロック/秒だが、負荷や
 *   計測タイミングのばらつきを吸収するため既定は保守的に 5 ブロック/秒。
 * - `baseMs`: RPC 起動待ちなどブロック追従以外に要する固定オーバーヘッド。
 * - `minMs`: gap が小さくても最低限確保するタイムアウト（下限）。
 */
export function catchUpTimeoutMs({
  gap,
  ratePerSec = 5,
  baseMs = 30_000,
  minMs = 120_000,
}: {
  gap: number;
  ratePerSec?: number;
  baseMs?: number;
  minMs?: number;
}): number {
  const safeGap = Math.max(gap, 0);
  const backfillMs = Math.ceil(safeGap / ratePerSec) * 1_000;
  return Math.max(minMs, baseMs + backfillMs);
}

/** 追従待ちの結果。 */
export type CatchUpOutcome =
  | { kind: "reached"; height: number }
  | { kind: "stalled"; height: number; stalledForMs: number }
  | { kind: "timeout"; height: number; elapsedMs: number };

/** observe の判定結果。done が true のときのみ outcome を持つ。 */
export type CatchUpDecision =
  | { done: false }
  | { done: true; outcome: CatchUpOutcome };

/**
 * 追加ノードの高さ観測を畳み込み、「到達」「停止」「全体タイムアウト」を判定
 * する純粋な状態機械。時刻とブロック高を外部から与えるだけで、自身ではクロック
 * にも RPC にも触れない（そのためユニットテストで合成観測を流し込める）。
 *
 * 停止判定は「これまでに観測した最大高さ」が更新されない状態が stallTimeoutMs
 * 続いたかどうかで行う。初回観測は必ず「進捗あり」として扱われる（初期最大高さ
 * を -1 にしてあるため）ので、RPC 起動待ちで最初の観測が遅れても、その待ち時間
 * が停止としてカウントされることはない。
 */
export class CatchUpMonitor {
  private maxHeight = -1;
  private lastProgressAtMs: number;

  constructor(
    private readonly target: number,
    private readonly startMs: number,
    private readonly opts: { overallTimeoutMs: number; stallTimeoutMs: number },
  ) {
    this.lastProgressAtMs = startMs;
  }

  observe(nowMs: number, height: number): CatchUpDecision {
    if (height > this.maxHeight) {
      this.maxHeight = height;
      this.lastProgressAtMs = nowMs;
    }
    if (height >= this.target) {
      return { done: true, outcome: { kind: "reached", height } };
    }
    const stalledForMs = nowMs - this.lastProgressAtMs;
    if (stalledForMs >= this.opts.stallTimeoutMs) {
      return {
        done: true,
        outcome: { kind: "stalled", height, stalledForMs },
      };
    }
    const elapsedMs = nowMs - this.startMs;
    if (elapsedMs >= this.opts.overallTimeoutMs) {
      return { done: true, outcome: { kind: "timeout", height, elapsedMs } };
    }
    return { done: false };
  }
}

export interface WaitForCatchUpOptions {
  /** ポーリング間隔(ms)。 */
  intervalMs?: number;
  /** 動的タイムアウト算出に使う想定バックフィル速度（ブロック/秒）。 */
  ratePerSec?: number;
  /** バックフィル以外の固定オーバーヘッド(ms)。 */
  baseTimeoutMs?: number;
  /** 全体タイムアウトの下限(ms)。 */
  minTimeoutMs?: number;
  /**
   * 全体タイムアウトの上限(ms)。呼び出し側（vitest の it タイムアウト）が
   * 内部の全体タイムアウトより先に発火して分かりにくいエラーになるのを防ぐため、
   * 動的に算出した値をこの上限で頭打ちにする。
   */
  maxTimeoutMs?: number;
  /** 高さが更新されないまま経過したら停止とみなす時間(ms)。 */
  stallTimeoutMs?: number;
  /** エラーメッセージに使う説明。 */
  description?: string;
  /** 現在時刻(ms)。テスト用に差し替え可能。 */
  now?: () => number;
  /** スリープ関数。テスト用に差し替え可能。 */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * 追加ノードの高さを `getHeight` でポーリングし、`target` に到達したらその高さを
 * 返す。到達前に進捗が停止したか全体タイムアウトを超えたら例外を投げる。
 *
 * `getHeight` が例外を投げる間（RPC がまだ起動していない等）は「観測なし」と
 * みなし、停止判定には数えず全体タイムアウトのみを見張る。
 */
export async function waitForBlockCatchUp(
  getHeight: () => Promise<number>,
  target: number,
  options: WaitForCatchUpOptions = {},
): Promise<number> {
  const {
    intervalMs = 3_000,
    ratePerSec = 5,
    baseTimeoutMs = 30_000,
    minTimeoutMs = 120_000,
    maxTimeoutMs = 540_000,
    stallTimeoutMs = 45_000,
    description = "added node to catch up",
    now = () => Date.now(),
    sleepFn = sleep,
  } = options;

  // 待ち開始時点の高さを測ってバックフィル量を見積もる。まだ RPC が応答しない
  // 場合は gap を target 全量とみなす（最も長く待つ側に倒す）。
  let startHeight = 0;
  try {
    startHeight = await getHeight();
  } catch {
    startHeight = 0;
  }
  const gap = Math.max(target - startHeight, 0);
  const overallTimeoutMs = Math.min(
    maxTimeoutMs,
    catchUpTimeoutMs({
      gap,
      ratePerSec,
      baseMs: baseTimeoutMs,
      minMs: minTimeoutMs,
    }),
  );

  const startMs = now();
  const monitor = new CatchUpMonitor(target, startMs, {
    overallTimeoutMs,
    stallTimeoutMs,
  });

  let lastError: unknown;
  for (;;) {
    let height: number | undefined;
    try {
      height = await getHeight();
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }
    const nowMs = now();

    if (height !== undefined) {
      const decision = monitor.observe(nowMs, height);
      if (decision.done) {
        const outcome = decision.outcome;
        if (outcome.kind === "reached") return outcome.height;
        if (outcome.kind === "stalled") {
          throw new Error(
            `${description}: 進捗が ${outcome.stalledForMs}ms 停止 ` +
              `(高さ ${outcome.height} / ターゲット ${target})。` +
              `EL 間 P2P（履歴バックフィル）の回帰の可能性。`,
          );
        }
        throw new Error(
          `${description}: 全体タイムアウト ${overallTimeoutMs}ms 超過 ` +
            `(高さ ${outcome.height} / ターゲット ${target}, ` +
            `経過 ${outcome.elapsedMs}ms)。`,
        );
      }
    } else if (now() - startMs >= overallTimeoutMs) {
      throw new Error(
        `${description}: RPC 到達不能のまま全体タイムアウト ${overallTimeoutMs}ms 超過` +
          (lastError ? ` (last error: ${String(lastError)})` : ""),
      );
    }

    await sleepFn(intervalMs);
  }
}
