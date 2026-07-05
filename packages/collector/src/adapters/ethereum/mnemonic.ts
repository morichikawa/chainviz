// profiles/ethereum の values.env から mnemonic を読み取る部分。
// mnemonic は genesis のプリマイン鍵とワークベンチの鍵の共通の出所
// （values.env の EL_AND_CL_MNEMONIC）であり、その解析・読み込みは
// Ethereum プロファイル固有の知識なのでこのアダプタ配下に閉じ込める。

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * values.env の内容文字列から EL_AND_CL_MNEMONIC の値を取り出す。
 * ワークベンチが cast --mnemonic で使うのと同じ値。見つからなければ undefined。
 */
export function parseMnemonic(valuesEnv: string): string | undefined {
  const match = valuesEnv.match(
    /^\s*export\s+EL_AND_CL_MNEMONIC=(?:"([^"]*)"|'([^']*)'|(\S+))/m,
  );
  if (!match) return undefined;
  return match[1] ?? match[2] ?? match[3];
}

/**
 * profiles/ethereum の絶対パスから values.env を読み、mnemonic を返す。
 * ファイルが無い・読めない・mnemonic 未定義なら undefined。
 */
export function readProfileMnemonic(profileDir: string): string | undefined {
  try {
    const content = readFileSync(path.join(profileDir, "values.env"), "utf8");
    return parseMnemonic(content);
  } catch {
    return undefined;
  }
}
