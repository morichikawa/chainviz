import type { BlockEntity } from "@chainviz/shared";

/**
 * ブロック生成タイミングのインジケータ（Issue #343。ARCHITECTURE.md §10.5）の
 * 純粋関数群。次のブロックが生成されるまでの残り時間・進捗をチェーンリボン
 * カードのヘッダに表示するための下地で、shared/collector は変更しない
 * （既にフロントへ届いている `BlockEntity.timestamp` の差分から導出する。
 * 設計の全文は docs/worklog/issue-343.md 参照）。React・タイマー側の責務は
 * `useBlockCadence.ts` に分離する（テスト容易性のため）。
 */

/** ブロック生成の間隔（interval）と位相（anchor）。 */
export interface BlockCadence {
  /** ブロック生成間隔（ms）。 */
  intervalMs: number;
  /** 直近ブロックの生成時刻（ms, epoch）。カウントダウンの位相基準。 */
  anchorMs: number;
}

/**
 * 導出した interval が妥当とみなす範囲（秒）。1秒未満は observed timestamp の
 * 丸め誤差・異常データ、600秒超は明らかに不規則（PoW 等の確率的な生成、または
 * ホストとチェーンの時計が大きくずれている）とみなし、無意味なカウントダウンを
 * 出さない（docs/worklog/issue-343.md §2）。
 */
const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 600;

/**
 * 停滞判定の閾値倍率。1〜2 slot 分の空白（空 slot・観測遅延）は正常運転でも
 * 起こりうるため許容し、3 slot 連続で新ブロックが観測されない状態を
 * 「ノード停止・接続断など、待っていても次は来ない状況」とみなす。チェーンの
 * 進行状態（稼働時間・ブロック高）に依存しない相対値であり、CLAUDE.md の
 * 固定値ルール上も安全（docs/worklog/issue-343.md §2）。
 */
const STALL_THRESHOLD_MULTIPLIER = 3;

/** ユークリッドの互除法（非負整数前提。呼び出し側は正の差分のみ渡す）。 */
function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/**
 * `BlockEntity[]` の timestamp（秒）から、ブロック生成間隔（interval）と
 * 位相（anchor）を導出する（docs/worklog/issue-343.md §2）。
 *
 * 導出手順:
 * 1. number 昇順に並べ、timestamp を取り出す。同一 timestamp の重複
 *    （同一 number のフォークブロック等）は除去する
 * 2. 隣接する timestamp の正の差分列を作る。差分が1つも無い
 *    （観測ブロックが実質1件以下）なら null
 * 3. 差分列の GCD を interval（秒）とする。1〜600秒の範囲を外れたら null
 * 4. anchor = 最新（number 最大）ブロックの timestamp × 1000
 * 5. `anchorMs > now + intervalMs` なら null（ホストとチェーンの時計が
 *    大きくずれている場合の防御）
 *
 * 導出不成立（null）はインジケータの非表示を意味する（「観測できないものは
 * 出さない」という既存の流儀）。
 */
export function deriveBlockCadence(
  blocks: readonly BlockEntity[],
  now: number,
): BlockCadence | null {
  if (blocks.length === 0) return null;

  const sortedByNumber = [...blocks].sort((a, b) => a.number - b.number);

  // 同一 timestamp の重複除去。sortedByNumber の順序を保ったまま最初の
  // 出現だけを残す（Set は挿入順を保持する）。
  const uniqueTimestamps = [...new Set(sortedByNumber.map((b) => b.timestamp))];

  const diffs: number[] = [];
  for (let i = 1; i < uniqueTimestamps.length; i += 1) {
    const diff = uniqueTimestamps[i] - uniqueTimestamps[i - 1];
    if (diff > 0) diffs.push(diff);
  }
  if (diffs.length === 0) return null;

  const intervalSec = diffs.reduce((acc, diff) => gcd(acc, diff));
  if (intervalSec < MIN_INTERVAL_SEC || intervalSec > MAX_INTERVAL_SEC) return null;

  const latestBlock = sortedByNumber[sortedByNumber.length - 1];
  const anchorMs = latestBlock.timestamp * 1000;
  const intervalMs = intervalSec * 1000;

  if (anchorMs > now + intervalMs) return null;

  return { intervalMs, anchorMs };
}

/** 表示側が毎 tick 計算する、カウントダウン・進捗・停滞状態。 */
export interface BlockCadenceProgress {
  /** 次のブロックまでの残り時間（ms）。0以上、intervalMs未満。 */
  remainingMs: number;
  /** 現在の周期内の経過率（0以上1未満）。 */
  progress: number;
  /** 3 interval 分（§2）以上新しいブロックが観測されていない「停滞」状態か。 */
  stalled: boolean;
}

/**
 * `deriveBlockCadence` が返した interval/anchor から、現在時刻 `now` 時点の
 * 残り時間・進捗・停滞状態を計算する（純粋な剰余計算。docs/worklog/issue-343.md
 * §2）。`deriveBlockCadence` はブロック集合が変わったときだけ呼べば良いのに対し、
 * こちらは毎 tick 呼ぶ想定（`useBlockCadence.ts` 参照）。
 */
export function computeBlockCadenceProgress(
  cadence: BlockCadence,
  now: number,
): BlockCadenceProgress {
  const { intervalMs, anchorMs } = cadence;
  const elapsedSinceAnchor = now - anchorMs;
  const stalled = elapsedSinceAnchor > intervalMs * STALL_THRESHOLD_MULTIPLIER;

  // anchorMs が now より未来（時計ずれガードの範囲内 = intervalMs 以内）の
  // ケースを含め、剰余を常に [0, intervalMs) に正規化する。
  const elapsed = ((elapsedSinceAnchor % intervalMs) + intervalMs) % intervalMs;
  const remainingMs = intervalMs - elapsed;
  const progress = elapsed / intervalMs;

  return { remainingMs, progress, stalled };
}
