import { describe, expect, it } from "vitest";
import { describeValidatorApiMethod } from "./validatorApiMethodLabels.js";

describe("describeValidatorApiMethod", () => {
  it("matches the block proposal counter regardless of the status label suffix", () => {
    expect(describeValidatorApiMethod("vc_signed_beacon_blocks_total:success")).toEqual({
      ja: "ブロック提案の署名",
      en: "Sign proposed block",
    });
    expect(describeValidatorApiMethod("vc_signed_beacon_blocks_total:slashable")).toEqual({
      ja: "ブロック提案の署名",
      en: "Sign proposed block",
    });
  });

  it("matches the attestation counter regardless of the status label suffix", () => {
    expect(describeValidatorApiMethod("vc_signed_attestations_total:success")).toEqual({
      ja: "証明（attestation）の署名",
      en: "Sign attestation",
    });
    expect(describeValidatorApiMethod("vc_signed_attestations_total:unregistered")).toEqual({
      ja: "証明（attestation）の署名",
      en: "Sign attestation",
    });
  });

  it("returns undefined for a method with no matching prefix (raw name fallback)", () => {
    expect(describeValidatorApiMethod("vc_signing_times_seconds:local_keystore")).toBeUndefined();
    expect(describeValidatorApiMethod("engine_newPayloadV4")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(describeValidatorApiMethod("")).toBeUndefined();
  });
});
