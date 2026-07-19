// secp256k1.ts の `prehash: false` 指定を守るための回帰テスト（Issue #402
// テスト強化）。
//
// なぜ専用のテストが要るか: `secp256k1.test.ts` の「sign + recoverAddress
// round trip」は、sign と recover の**両方**がライブラリ既定の
// `prehash: true`（内部で更に sha256 をかける）になっていても成立して
// しまう。sign が sha256(msgHash) に署名し、recover も sha256(msgHash) から
// 復元するため、往復自体は一致するからである（@noble/curves v2 で実測確認済
// み）。したがってラウンドトリップだけでは「両方の指定漏れ」を検出できない。
//
// ここでは既知の参照ベクトル（秘密鍵=1・既知メッセージハッシュ）に対する
// 署名 hex と復元アドレスの golden 値を固定する。Ethereum は keccak256 済みの
// メッセージにそのまま署名する（二重ハッシュしない）ため、この golden 値は
// `prehash: false` を両方の呼び出しで渡している現行実装でのみ再現する:
//   - sign が `prehash: true` に退行 → 署名 hex が別物になり最初の assert が落ちる
//   - recover が `prehash: true` に退行 → 復元アドレスが別物になり次の assert が落ちる
// （どちらの片側漏れも、両方同時の漏れも検出できる。値は @noble/curves v2 で
// 生成し、意図的に prehash を外すと赤くなることをローカルで確認済み。RFC6979
// により署名は決定的なので固定値として安定する）。
import { describe, expect, it } from "vitest";
import { deriveAddress, recoverAddress, sign } from "./secp256k1.js";

// 秘密鍵 = 1（`secp256k1.test.ts` の参照ベクトルと同じ既知の鍵）。
const SECRET_KEY = `0x${"0".repeat(63)}1`;
// keccak256("Alice sends 1 ETH to Bob")。テスト内で keccak256Hex に依存せず
// 値を直接固定し、「keccak256 済みハッシュに署名する」入力を明示する。
const MESSAGE_HASH = "0xc1d122d2f516a2a15d54531c32bbdd6f247779bd2096e1926c4550e03e7e90a8";
// 上記の鍵・ハッシュに対する、`prehash: false` での recoverable 署名（golden）。
const GOLDEN_SIGNATURE =
  "0x01f777e91ed9eb50bf011070f35939129eb6b8468cfb226e9673ecf4fe08fd42c256c60caf01e6b83aa6b843bc6025dff3c544c6c29e0cbb4be9c14b476b1cfbfe";
// 秘密鍵 = 1 の既知アドレス。
const KNOWN_ADDRESS = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";

describe("secp256k1 prehash: false is honored (golden vectors, not just a round trip)", () => {
  it("sign produces the golden signature for the known key + already-hashed message", () => {
    // sign が prehash 既定(true)へ退行すると sha256(MESSAGE_HASH) に署名して
    // しまい、この golden 値と一致しなくなる。
    expect(sign(SECRET_KEY, MESSAGE_HASH)).toBe(GOLDEN_SIGNATURE);
  });

  it("recoverAddress returns the known address for the golden signature", () => {
    // recover が prehash 既定(true)へ退行すると sha256(MESSAGE_HASH) から
    // 復元してしまい、全く別のアドレスになる。
    expect(recoverAddress(GOLDEN_SIGNATURE, MESSAGE_HASH)).toBe(KNOWN_ADDRESS);
  });

  it("the recovered address matches the key's own derived address (self-consistency)", () => {
    expect(recoverAddress(GOLDEN_SIGNATURE, MESSAGE_HASH)).toBe(deriveAddress(SECRET_KEY));
  });
});
