import { describe, expect, it } from "vitest";
import {
  describeDrivenByField,
  describeDrivesField,
  describeInternalLinkKind,
} from "./internalLinkKinds.js";

describe("describeInternalLinkKind (consensus -> execution, Engine API)", () => {
  it("resolves the existing Engine API heading/glossary/description with activity shown", () => {
    const kind = describeInternalLinkKind("consensus", "execution");
    expect(kind.headingKey).toBe("edge.internalLink");
    expect(kind.headingGlossaryKey).toBe("engine-api");
    expect(kind.description).toEqual({
      kind: "segmented",
      prefixKey: "internalEdge.pair.prefix",
      termKey: "internalEdge.pair.term",
      termGlossaryKey: "el-cl-separation",
      suffixKey: "internalEdge.pair.suffix",
    });
    expect(kind.showsActivity).toBe(true);
  });
});

describe("describeInternalLinkKind (validator -> consensus, Beacon API, Issue #285)", () => {
  it("resolves the Beacon API heading/glossary/description with activity hidden", () => {
    const kind = describeInternalLinkKind("validator", "consensus");
    expect(kind.headingKey).toBe("edge.internalLinkValidator");
    expect(kind.headingGlossaryKey).toBe("beacon-api");
    expect(kind.description).toEqual({ kind: "flat", textKey: "internalEdge.validatorPair" });
    expect(kind.showsActivity).toBe(false);
  });
});

describe("describeInternalLinkKind (fallback for unmapped/unknown role pairs)", () => {
  it("falls back to a generic heading without a glossary anchor and activity hidden when both roles are undefined", () => {
    const kind = describeInternalLinkKind(undefined, undefined);
    expect(kind.headingKey).toBe("edge.internalLinkGeneric");
    expect(kind.headingGlossaryKey).toBeUndefined();
    expect(kind.description).toEqual({ kind: "flat", textKey: "internalEdge.genericPair" });
    expect(kind.showsActivity).toBe(false);
  });

  it("falls back for the reverse of the known pairs (execution -> consensus is not a real pair)", () => {
    const kind = describeInternalLinkKind("execution", "consensus");
    expect(kind.headingKey).toBe("edge.internalLinkGeneric");
  });

  it("falls back for a validator driving an execution node directly (not a real topology)", () => {
    const kind = describeInternalLinkKind("validator", "execution");
    expect(kind.headingKey).toBe("edge.internalLinkGeneric");
  });

  it("falls back when only one endpoint's role is known", () => {
    expect(describeInternalLinkKind("consensus", undefined).headingKey).toBe(
      "edge.internalLinkGeneric",
    );
    expect(describeInternalLinkKind(undefined, "execution").headingKey).toBe(
      "edge.internalLinkGeneric",
    );
  });

  it("falls back for a completely unknown chain-profile role value", () => {
    expect(describeInternalLinkKind("sequencer", "prover").headingKey).toBe(
      "edge.internalLinkGeneric",
    );
  });
});

describe("describeDrivesField (own role -> forward field label, InfraPopover)", () => {
  it("uses the connectsToBeacon/beacon-api field for a validator", () => {
    expect(describeDrivesField("validator")).toEqual({
      labelKey: "field.connectsToBeacon",
      glossaryKey: "beacon-api",
    });
  });

  it("defaults to the existing drivesNode/engine-api field for consensus", () => {
    expect(describeDrivesField("consensus")).toEqual({
      labelKey: "field.drivesNode",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivesNode/engine-api field when the own role is undefined (legacy snapshot; does not hide the field)", () => {
    expect(describeDrivesField(undefined)).toEqual({
      labelKey: "field.drivesNode",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivesNode/engine-api field for an unmapped role value", () => {
    expect(describeDrivesField("sequencer")).toEqual({
      labelKey: "field.drivesNode",
      glossaryKey: "engine-api",
    });
  });
});

describe("describeDrivenByField (driving counterpart's role -> backward field label, InfraPopover)", () => {
  it("uses the validatorClient/validator field when driven by a validator", () => {
    expect(describeDrivenByField("validator")).toEqual({
      labelKey: "field.validatorClient",
      glossaryKey: "validator",
    });
  });

  it("defaults to the existing drivenBy/engine-api field when driven by a consensus node", () => {
    expect(describeDrivenByField("consensus")).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivenBy/engine-api field when the driving role is undefined (legacy snapshot; does not hide the field)", () => {
    expect(describeDrivenByField(undefined)).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivenBy/engine-api field for an unmapped driving role value", () => {
    expect(describeDrivenByField("sequencer")).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });
});
