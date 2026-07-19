// signatureDemo.ts の純粋ロジックのユニットテスト（Issue #402。実装設計メモ
// docs/worklog/issue-402.md「テスト方針」）。View（React）は対象外
// （SignatureDemoView.*.test.tsx が扱う。CLAUDE.md の1ファイル1責務）。
// 境界値・往復操作等の補強テストは signatureDemo.edgeCases.test.ts に分ける。
import { describe, expect, it } from "vitest";
import {
  ALICE_ADDRESS,
  ATTACKER_ADDRESS,
  createInitialSignatureDemoState,
  deriveRecoveredAddress,
  deriveSignature,
  isValid,
  resetSignatureDemoState,
  resignAsAlice,
  resignAsAttacker,
  updateReceivedContent,
  updateWorkbenchContent,
} from "./signatureDemo.js";

describe("createInitialSignatureDemoState", () => {
  it("starts valid: the recovered address matches Alice's address", () => {
    const state = createInitialSignatureDemoState();
    expect(isValid(state)).toBe(true);
    expect(deriveRecoveredAddress(state)).toBe(ALICE_ADDRESS);
    expect(state.sent.signedBy).toBe("alice");
    expect(state.received).toEqual(state.sent.content);
  });

  it("is reproducible: two independent calls yield equal (deep) initial states", () => {
    expect(createInitialSignatureDemoState()).toEqual(createInitialSignatureDemoState());
  });

  it("Alice's address and the attacker's address are distinct", () => {
    expect(ALICE_ADDRESS).not.toBe(ATTACKER_ADDRESS);
  });
});

describe("updateWorkbenchContent: editing the workbench re-signs and stays valid", () => {
  it("changes the signature but keeps the demo valid, and received follows along", () => {
    const before = createInitialSignatureDemoState();
    const signatureBefore = deriveSignature(before);

    const after = updateWorkbenchContent(before, { amountEth: "999" });

    expect(deriveSignature(after)).not.toBe(signatureBefore);
    expect(isValid(after)).toBe(true);
    expect(after.received).toEqual(after.sent.content);
    expect(after.sent.content.amountEth).toBe("999");
  });

  it("always signs as alice, even if the previous state was signed by the attacker", () => {
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "666" });
    const attackerSigned = resignAsAttacker(tampered);
    expect(attackerSigned.sent.signedBy).toBe("attacker");

    const edited = updateWorkbenchContent(attackerSigned, { amountEth: "1" });
    expect(edited.sent.signedBy).toBe("alice");
    expect(isValid(edited)).toBe(true);
  });
});

describe("updateReceivedContent: tampering breaks verification", () => {
  it("invalidates the demo: the recovered address no longer matches Alice's address", () => {
    const before = createInitialSignatureDemoState();
    const after = updateReceivedContent(before, { amountEth: "999" });

    expect(isValid(after)).toBe(false);
    expect(deriveRecoveredAddress(after)).not.toBe(ALICE_ADDRESS);
    // 署名対象（sent）は変わっていない。
    expect(after.sent).toEqual(before.sent);
  });

  it("does not change the signature itself (only what arrived is edited)", () => {
    const before = createInitialSignatureDemoState();
    const after = updateReceivedContent(before, { to: "0xdeadbeef00000000000000000000000000dead" });
    expect(deriveSignature(after)).toBe(deriveSignature(before));
  });
});

describe("resignAsAttacker: signature becomes mathematically correct, but impersonation still fails", () => {
  it("recovers the attacker's own address, which never equals Alice's", () => {
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    expect(isValid(tampered)).toBe(false);

    const resigned = resignAsAttacker(tampered);
    expect(isValid(resigned)).toBe(false);
    expect(deriveRecoveredAddress(resigned)).toBe(ATTACKER_ADDRESS);
    expect(resigned.sent.content).toEqual(resigned.received);
  });
});

describe("resignAsAlice: only the real owner can produce a valid signature for new content", () => {
  it("returns to a valid state after Alice re-signs the (tampered) received content", () => {
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    expect(isValid(tampered)).toBe(false);

    const resigned = resignAsAlice(tampered);
    expect(isValid(resigned)).toBe(true);
    expect(deriveRecoveredAddress(resigned)).toBe(ALICE_ADDRESS);
    expect(resigned.sent.content).toEqual(resigned.received);
  });
});

describe("resetSignatureDemoState", () => {
  it("returns to a state equal to the pristine initial state after edits and resigns", () => {
    let state = createInitialSignatureDemoState();
    state = updateReceivedContent(state, { amountEth: "999" });
    state = resignAsAttacker(state);
    expect(isValid(state)).toBe(false);

    const reset = resetSignatureDemoState();
    expect(reset).toEqual(createInitialSignatureDemoState());
    expect(isValid(reset)).toBe(true);
  });
});
