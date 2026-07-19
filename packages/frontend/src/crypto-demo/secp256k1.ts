import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * secp256k1（Ethereum が EOA の署名・検証(ecrecover)に実際に使う曲線）の
 * 薄いラッパー（Issue #402。`docs/worklog/issue-402.md` 実装設計メモ）。
 *
 * `keccak256.ts`（Issue #401）と同じ役割・同じ流儀: 「署名と検証のしくみ」
 * デモは記号的な図解ではなく本物の署名・公開鍵復元を行うことが核となる
 * 体験のため、監査済みの `@noble/curves` を使う。入出力はすべて `0x` 始まり
 * の hex 文字列（表示・保存のしやすさのため。呼び出し側の `signatureDemo.ts`
 * は byte 配列を一切扱わない）。
 *
 * `@noble/curves` は v2 系で sub-path import に拡張子 `.js` が必須
 * （`@noble/hashes` と同じ）。API は `secp256k1.sign` / `recoverPublicKey` /
 * `getPublicKey` / `Point` を直接 export する形（v1 系の
 * `Signature.fromCompact` 等とは形が異なる。実装設計メモに確認結果を記録）。
 */

function toBytes(hex: string): Uint8Array {
  return hexToBytes(hex.startsWith("0x") ? hex.slice(2) : hex);
}

function toHex(bytes: Uint8Array): string {
  return `0x${bytesToHex(bytes)}`;
}

/**
 * 公開鍵（圧縮・非圧縮のどちらでも可）から Ethereum アドレスを導出する。
 * 圧縮公開鍵は一旦非圧縮（65byte, 先頭 `0x04`）へ展開し、先頭1byteを除いた
 * 64byte（x, y 座標）を keccak256 でハッシュ化して末尾20byteを取る
 * （Ethereum のアドレス導出そのもの。`@noble/curves` の `recoverPublicKey` /
 * `getPublicKey` は既定で圧縮形式(33byte)を返すため、この展開が必要）。
 */
function addressFromPublicKey(publicKey: Uint8Array): string {
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  const hash = keccak_256(uncompressed.slice(1));
  return `0x${bytesToHex(hash).slice(-40)}`;
}

/** 秘密鍵（32byte hex）からアドレスを導出する（秘密鍵→公開鍵→そのハッシュの末尾20byte）。 */
export function deriveAddress(secretKeyHex: string): string {
  return addressFromPublicKey(secp256k1.getPublicKey(toBytes(secretKeyHex)));
}

/**
 * メッセージハッシュ（32byte hex。呼び出し側が keccak256 で計算済みのもの）に
 * 対して secp256k1 で署名する。`format: "recovered"` で復元に必要な recovery
 * byte を含む署名（65byte）を返す。`prehash: false` を渡し、ライブラリが
 * 既定で行う内部ハッシュ（sha256）を無効化する（Ethereum は呼び出し側で
 * 既に keccak256 済みのメッセージにそのまま署名するため、二重にハッシュしては
 * ならない）。
 */
export function sign(secretKeyHex: string, messageHashHex: string): string {
  return toHex(
    secp256k1.sign(toBytes(messageHashHex), toBytes(secretKeyHex), {
      prehash: false,
      format: "recovered",
    }),
  );
}

/**
 * 署名とメッセージハッシュから公開鍵を復元し（ecrecover）、そのアドレスを
 * 返す。秘密鍵は不要（誰でも検証できる）。`sign` と対になるよう
 * `prehash: false` を渡す。
 *
 * r・s・recovery byte が揃った署名であれば、対応するメッセージハッシュが
 * 署名時と異なっていても数学的に何らかの公開鍵が求まる（これが
 * 「メッセージが改ざんされていても署名検証自体は失敗せず、代わりに
 * 全く別のアドレスが復元される」というこのデモの核となる性質）。したがって
 * このデモの入力（このモジュール内で生成した署名 hex）に対しては通常
 * 例外は発生しない。
 */
export function recoverAddress(signatureHex: string, messageHashHex: string): string {
  return addressFromPublicKey(
    secp256k1.recoverPublicKey(toBytes(signatureHex), toBytes(messageHashHex), {
      prehash: false,
    }),
  );
}
