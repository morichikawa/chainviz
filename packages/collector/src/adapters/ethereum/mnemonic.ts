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

/**
 * mnemonic を取得できなかったときに起動ログへ出す警告文を返す。有効な
 * mnemonic があれば undefined（警告不要）。readProfileMnemonic は
 * values.env が無い・読めない・mnemonic 未定義のいずれでも undefined を
 * 返し、加えて EL_AND_CL_MNEMONIC="" のように空文字列が設定されている
 * ケースもある。ウォレット層（C 層）を無効化する側（wallet-tracker /
 * adapters/ethereum/index）はいずれも falsy 判定（!this.mnemonic）で
 * 無効化するため、警告の判定もそれに揃える。そうしないと空文字列の
 * ときに警告なしでウォレット層が黙って無効化されてしまう。
 */
export function walletTrackingDisabledWarning(
  mnemonic: string | undefined,
): string | undefined {
  if (mnemonic) return undefined;
  return "mnemonic not found in profile values.env; wallet tracking disabled";
}
