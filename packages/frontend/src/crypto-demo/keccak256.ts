import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * keccak256（Ethereum がブロックハッシュ・トランザクションハッシュ等に
 * 実際に使うハッシュ関数）を計算する薄いラッパー（Issue #401。
 * `docs/worklog/issue-401.md` UX設計 §2）。
 *
 * 「ハッシュのしくみ」デモは記号的な図解ではなく本物の計算を行うことが
 * 核となる体験のため、監査済み・依存ゼロの `@noble/hashes` を使う。
 * 入力は UTF-8 文字列、出力は `0x` + 64桁hex（32byte）。
 *
 * `@noble/hashes` は v2 系で sub-path import に拡張子 `.js` が必須
 * （`package.json` の `exports` がこの2本しか公開していない）。
 */
export function keccak256Hex(input: string): string {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(input)))}`;
}
