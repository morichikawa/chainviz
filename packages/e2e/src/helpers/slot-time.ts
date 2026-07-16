// E2E テストの待ち時間・タイムアウトが依存する slot time（ブロック生成間隔）の
// 単一の出所。`profiles/ethereum/values.env` の `SLOT_DURATION_IN_SECONDS` を
// パースして導出する。
//
// なぜ一元化するか（CLAUDE.md「今この瞬間に観測できる状態に依存した固定値を
// ロジックに埋め込まない」への対応）: slot time を各テストファイルに
// `const SLOT_DURATION_SECONDS = 2` のように決め打ちで複製すると、プロファイル
// 側で slot time を変えた（例: 2 秒 → 12 秒）ときに追従漏れが起き、待ち時間が
// 実際の slot 間隔と食い違って flaky になる。値の出所を values.env 1 箇所に
// 集約し、各テストはここから導出した `SLOT_DURATION_MS` を基に自分の
// タイムアウトを計算する。

import { readFileSync } from "node:fs";
import { valuesEnvFile } from "./paths.js";

/**
 * values.env の内容文字列から `SLOT_DURATION_IN_SECONDS` の値（正の数）を
 * 取り出す。見つからない・数値でない・0 以下なら undefined を返す。
 * `export SLOT_DURATION_IN_SECONDS="2"` / `='2'` / `=2` のいずれの記法にも対応する
 * （collector 側 `adapters/ethereum/mnemonic.ts` の parseMnemonic と同じ流儀）。
 */
export function parseSlotDurationSeconds(valuesEnv: string): number | undefined {
  const match = valuesEnv.match(
    /^\s*export\s+SLOT_DURATION_IN_SECONDS=(?:"([^"]*)"|'([^']*)'|(\S+))/m,
  );
  if (!match) return undefined;
  const raw = match[1] ?? match[2] ?? match[3];
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

/**
 * values.env を読み、slot time（秒）を返す。読めない・値が無い・不正なら
 * throw する。誤った既定値へ静かにフォールバックすると slot time に依存する
 * すべてのタイムアウトが実チェーンとずれて flaky になるため、値が確定できない
 * ときは黙って進めず明示的に失敗させる。
 */
function loadSlotDurationSeconds(): number {
  let content: string;
  try {
    content = readFileSync(valuesEnvFile, "utf8");
  } catch (err) {
    throw new Error(
      `failed to read profile values.env at ${valuesEnvFile}: ${String(err)}`,
    );
  }
  const seconds = parseSlotDurationSeconds(content);
  if (seconds === undefined) {
    throw new Error(
      `SLOT_DURATION_IN_SECONDS not found or invalid in ${valuesEnvFile}`,
    );
  }
  return seconds;
}

/** プロファイルの slot time（秒）。テストの待ち時間計算の基準。 */
export const SLOT_DURATION_SECONDS = loadSlotDurationSeconds();

/** プロファイルの slot time（ミリ秒）。タイムアウト計算で使う。 */
export const SLOT_DURATION_MS = SLOT_DURATION_SECONDS * 1000;
