import { describe, expect, it, vi } from "vitest";
import { resolveDefaultClient } from "./defaultClient.js";

describe("resolveDefaultClient", () => {
  it("uses the mock client when no collector url is set", () => {
    const { isMock, factory } = resolveDefaultClient(undefined);
    expect(isMock).toBe(true);
    const onSnapshot = vi.fn();
    const client = factory({ onSnapshot });
    client.connect();
    expect(onSnapshot).toHaveBeenCalled();
    client.disconnect();
  });

  it("builds a real client factory when a collector url is provided", () => {
    const { isMock, factory } = resolveDefaultClient("ws://localhost:4000");
    expect(isMock).toBe(false);
    expect(typeof factory).toBe("function");
  });
});
