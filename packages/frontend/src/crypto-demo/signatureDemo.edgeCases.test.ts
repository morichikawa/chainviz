// signatureDemo.ts の異常系・境界値・往復操作の補強テスト（Issue #402
// テスト強化）。ハッピーパス中心の基本ケースは signatureDemo.test.ts が扱う。
// ここは以下を重点的に検証する:
//   - 改ざん→元に戻す往復・同値編集の無害性（ハッシュは中身から決まる性質）
//   - 空文字列・特殊文字を含む入力でも壊れないこと
//   - どちらのフィールド（to/amount）を改ざんしても無効化されること
//   - resign の繰り返し・状態不変性（入力 state を書き換えない）
// （CLAUDE.md の1ファイル1責務。基本テストの肥大化を避けるため分割）。
import { describe, expect, it } from "vitest";
import {
  ALICE_ADDRESS,
  ATTACKER_ADDRESS,
  createInitialSignatureDemoState,
  deriveRecoveredAddress,
  deriveSignature,
  isValid,
  resignAsAlice,
  resignAsAttacker,
  updateReceivedContent,
  updateWorkbenchContent,
} from "./signatureDemo.js";

describe("tamper then restore: hash is a fingerprint of content, not history", () => {
  it("restoring the original 'received' content re-validates without any resign", () => {
    const initial = createInitialSignatureDemoState();
    const tampered = updateReceivedContent(initial, { amountEth: "999" });
    expect(isValid(tampered)).toBe(false);

    const restored = updateReceivedContent(tampered, { amountEth: initial.received.amountEth });
    expect(isValid(restored)).toBe(true);
    expect(deriveRecoveredAddress(restored)).toBe(ALICE_ADDRESS);
  });

  it("editing 'received' to the identical value is a harmless no-op for validity", () => {
    const initial = createInitialSignatureDemoState();
    const after = updateReceivedContent(initial, { amountEth: initial.received.amountEth });
    expect(isValid(after)).toBe(true);
    expect(deriveSignature(after)).toBe(deriveSignature(initial));
  });
});

describe("either field can break verification independently", () => {
  it.each([
    { patch: { to: "0x0000000000000000000000000000000000dead" } },
    { patch: { amountEth: "1234.5" } },
  ])("tampering with $patch invalidates the demo", ({ patch }) => {
    const state = updateReceivedContent(createInitialSignatureDemoState(), patch);
    expect(isValid(state)).toBe(false);
  });
});

describe("empty and unusual string inputs do not throw", () => {
  it("handles an empty amount field", () => {
    const state = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "" });
    expect(() => isValid(state)).not.toThrow();
    expect(isValid(state)).toBe(false);
  });

  it("handles a workbench edit to an empty destination address", () => {
    const state = updateWorkbenchContent(createInitialSignatureDemoState(), { to: "" });
    expect(() => isValid(state)).not.toThrow();
    expect(isValid(state)).toBe(true); // received も追従するため有効のまま
  });

  it("handles multibyte and unusual characters in the amount field", () => {
    const state = updateReceivedContent(createInitialSignatureDemoState(), {
      amountEth: "5 ETH 👍 こんにちは",
    });
    expect(() => deriveRecoveredAddress(state)).not.toThrow();
    expect(isValid(state)).toBe(false);
  });
});

describe("resign is idempotent in effect and does not mutate the input state", () => {
  it("resigning as attacker twice yields the same resulting validity and recovered address", () => {
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    const once = resignAsAttacker(tampered);
    const twice = resignAsAttacker(once);
    expect(deriveRecoveredAddress(once)).toBe(ATTACKER_ADDRESS);
    expect(deriveRecoveredAddress(twice)).toBe(ATTACKER_ADDRESS);
    expect(isValid(twice)).toBe(false);
  });

  it("does not mutate the input state object", () => {
    const before = createInitialSignatureDemoState();
    const beforeSentContent = { ...before.sent.content };
    updateReceivedContent(before, { amountEth: "999" });
    updateWorkbenchContent(before, { amountEth: "999" });
    expect(before.sent.content).toEqual(beforeSentContent);
  });

  it("switching from attacker back to alice on the same tampered content restores validity", () => {
    const tampered = updateReceivedContent(createInitialSignatureDemoState(), { amountEth: "999" });
    const attackerSigned = resignAsAttacker(tampered);
    expect(isValid(attackerSigned)).toBe(false);

    const aliceSigned = resignAsAlice(attackerSigned);
    expect(isValid(aliceSigned)).toBe(true);
    expect(deriveRecoveredAddress(aliceSigned)).toBe(ALICE_ADDRESS);
  });
});
