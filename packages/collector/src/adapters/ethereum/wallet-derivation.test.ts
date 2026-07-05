import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALLET_INDEX,
  deriveWalletAddress,
  WALLET_INDEX_LABEL,
  workbenchWalletIndex,
} from "./wallet-derivation.js";

// profiles/ethereum/values.env の EL_AND_CL_MNEMONIC。cast wallet address
// --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index N と同じアドレスになる
// ことを固定ベクタで確かめる（導出パス m/44'/60'/0'/0/N の一致確認）。
const MNEMONIC =
  "sleep moment list remain like wall lake industry canvas wonder ecology elite duck salad naive syrup frame brass utility club odor country obey pudding";

describe("deriveWalletAddress", () => {
  it("derives Foundry-default addresses for the profile mnemonic", () => {
    expect(deriveWalletAddress(MNEMONIC, 0)).toBe(
      "0x2BB7DcEeB1964D1c2EdbCbB04Cd7893F6619d4c0",
    );
    expect(deriveWalletAddress(MNEMONIC, 1)).toBe(
      "0xfCd9569Ab54097047D3b512510674826aaf444d6",
    );
    expect(deriveWalletAddress(MNEMONIC, 2)).toBe(
      "0xaD777372eBde0e5E484362581D0aE962a17fc628",
    );
  });

  it("returns a checksummed 0x address of the right shape", () => {
    const address = deriveWalletAddress(MNEMONIC, 5);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("gives different addresses for different indexes", () => {
    const a = deriveWalletAddress(MNEMONIC, 3);
    const b = deriveWalletAddress(MNEMONIC, 4);
    expect(a).not.toBe(b);
  });
});

describe("workbenchWalletIndex", () => {
  it("reads the index from the label", () => {
    expect(workbenchWalletIndex({ [WALLET_INDEX_LABEL]: "3" })).toBe(3);
  });

  it("falls back to the default index when the label is absent", () => {
    expect(workbenchWalletIndex({})).toBe(DEFAULT_WALLET_INDEX);
  });

  it("falls back to the default index for a non-numeric label", () => {
    expect(workbenchWalletIndex({ [WALLET_INDEX_LABEL]: "abc" })).toBe(
      DEFAULT_WALLET_INDEX,
    );
  });

  it("falls back to the default index for a negative label", () => {
    expect(workbenchWalletIndex({ [WALLET_INDEX_LABEL]: "-1" })).toBe(
      DEFAULT_WALLET_INDEX,
    );
  });
});
