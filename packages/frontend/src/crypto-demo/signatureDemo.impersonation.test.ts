// 「署名の妥当性」と「from との一致」が独立した2つの検証軸であることを
// 明示的に固定するテスト（Issue #402 テスト強化。依頼観点2）。
//
// 攻撃者再署名（resignAsAttacker）の核心は次の2点が両立することにある:
//   軸1（署名の妥当性）: 攻撃者が作った署名は、改ざん後の「届いた内容」に
//     対して**暗号学的に妥当**な署名である（その内容から復元されるアドレスが
//     攻撃者自身のアドレスにきれいに一致する = 署名検証という軸では合格）。
//   軸2（from との一致）: それでも復元アドレスは送信者 Alice のアドレスと
//     一致しないため、なりすましは成立しない（isValid は false）。
//
// 基本の遷移テスト（signatureDemo.test.ts）や境界値（edgeCases）とは別に、
// 「この2軸が別物であること」を関心事として1ファイルに切り出す
// （CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  ALICE_ADDRESS,
  ATTACKER_ADDRESS,
  createInitialSignatureDemoState,
  deriveRecoveredAddress,
  isValid,
  resignAsAttacker,
  updateReceivedContent,
} from "./signatureDemo.js";

describe("resignAsAttacker: signature validity and from-match are separate axes", () => {
  it("axis 1: the attacker's re-signature IS cryptographically valid for the received content", () => {
    // 復元アドレスが攻撃者自身のアドレスに**ちょうど一致する**ことが、
    // 「届いた内容に対する妥当な署名である」ことの証拠。ゴミ署名なら
    // 意味のあるアドレスへは復元されない。
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    const resigned = resignAsAttacker(tampered);
    expect(deriveRecoveredAddress(resigned)).toBe(ATTACKER_ADDRESS);
  });

  it("axis 2: yet the recovered address is not Alice's, so from-match (isValid) fails", () => {
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    const resigned = resignAsAttacker(tampered);
    expect(deriveRecoveredAddress(resigned)).not.toBe(ALICE_ADDRESS);
    expect(isValid(resigned)).toBe(false);
  });

  it("contrast: before re-signing, the tampered signature is valid for NO meaningful party", () => {
    // 改ざんだけした状態（署名し直していない）では、復元アドレスは Alice でも
    // 攻撃者でもない、意味を持たないアドレスになる。つまり「届いた内容に
    // 対する妥当な署名ですらない」（軸1を満たさない）。これが攻撃者再署名後
    // （軸1は満たすが軸2で落ちる）との違い。
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    const recovered = deriveRecoveredAddress(tampered);
    expect(recovered).not.toBe(ALICE_ADDRESS);
    expect(recovered).not.toBe(ATTACKER_ADDRESS);
    expect(isValid(tampered)).toBe(false);
  });

  it("the two axes are orthogonal: a valid signature (attacker) still cannot satisfy from-match", () => {
    // 「署名として妥当」を満たしても「from と一致」は別途満たす必要がある、
    // という直交性を1テストで束ねて明示する。
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    const resigned = resignAsAttacker(tampered);
    const signatureIsValidForReceived = deriveRecoveredAddress(resigned) === ATTACKER_ADDRESS;
    const fromMatches = isValid(resigned);
    expect(signatureIsValidForReceived).toBe(true);
    expect(fromMatches).toBe(false);
  });
});
